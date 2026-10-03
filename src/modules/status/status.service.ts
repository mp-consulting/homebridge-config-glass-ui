/* global NodeJS */
import type { Subscription } from 'rxjs'
import type { Systeminformation } from 'systeminformation'

import type { HomebridgeStatusMatterUpdate } from '../../core/matter/matter.interfaces.js'

import { exec } from 'node:child_process'
import { userInfo } from 'node:os'
import { dirname } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { HttpService } from '@nestjs/axios'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import NodeCache from 'node-cache'
import { firstValueFrom, Subject } from 'rxjs'
import {
  networkInterfaces,
  osInfo,
  time,
} from 'systeminformation'

import { ConfigService } from '../../core/config/config.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { getUiNodeModulesPath } from '../../core/install-paths.js'
import { Logger } from '../../core/logger/logger.service.js'
import { isNodeV24SupportedArchitecture } from '../../core/node-version.constants.js'
import { fetchNodeReleases, pickNodeUpdate } from '../../core/node-version/node-release.js'
import { npmVersion as getNpmVersion } from '../../core/npm/npm-runner.js'
import { RE_BETA_DATE, RE_STABLE_DATE, RE_TEST_DATE, RE_TRAILING_DATE } from '../../core/regex.constants.js'
import { DockerRelease, DockerReleaseInfo } from '../platform-tools/docker/docker.interfaces.js'
import { PluginsService } from '../plugins/plugins.service.js'
import { ServerService } from '../server/server.service.js'
import { DashboardLayoutService } from './dashboard-layout.service.js'
import {
  HomebridgeStatsResponse,
  HomebridgeStatus,
  HomebridgeStatusUpdate,
} from './status.interfaces.js'
import { NetworkUsage, SystemMetricsService } from './system-metrics.service.js'

export { type NetworkUsage, requestedIntervalMs } from './system-metrics.service.js'

const execAsync = promisify(exec)

/**
 * Drop the pairing codes (HomeKit PIN and setup URI, and their Matter
 * equivalents) from a status payload for anyone but an administrator. Whoever
 * holds them can add an unpaired bridge to their own Home, which is why the
 * REST equivalent (/server/pairing) is admin-only too.
 */
export function withoutPairingCodes<T extends { pin?: unknown, setupUri?: unknown, matter?: { pin?: unknown, setupUri?: unknown } | null }>(
  status: T,
  admin: boolean,
): T {
  if (admin) {
    return status
  }
  // Copies, so the cached status the next caller gets is left intact
  const redacted = { ...status }
  delete redacted.pin
  delete redacted.setupUri
  if (status.matter) {
    redacted.matter = { ...status.matter }
    delete redacted.matter.pin
    delete redacted.matter.setupUri
  }
  return redacted
}

/**
 * Server details only an administrator gets: filesystem paths, the account the
 * service runs as and the host's network addresses help an attacker map the
 * host and are of no use on a non-admin dashboard (the system info widget
 * shows only what it is given). The OS serial (a machine identifier) goes too.
 * `network` is left as an empty object rather than removed, as the widget reads
 * its fields.
 */
export function serverInfoForUser<T extends Record<string, any>>(info: T, admin: boolean): T {
  if (admin || !info || typeof info !== 'object') {
    return info
  }
  const redacted: Record<string, any> = { ...info }
  for (const key of ['serviceUser', 'homebridgeConfigJsonPath', 'homebridgeStoragePath', 'homebridgeCustomPluginPath', 'homebridgePluginPath']) {
    delete redacted[key]
  }
  if ('network' in info) {
    redacted.network = {}
  }
  if (info.os && typeof info.os === 'object') {
    redacted.os = { ...info.os }
    delete redacted.os.serial
  }
  return redacted as T
}

/** An object without its `installPath` for a non-admin, as with the server paths above. */
export function withoutInstallPath<T>(info: T, admin: boolean): T {
  if (admin || !info || typeof info !== 'object' || !('installPath' in info)) {
    return info
  }
  const rest: Record<string, unknown> = { ...info }
  delete rest.installPath
  return rest as T
}

/** The version overview as a user may see it: paths for administrators only. */
export function versionOverviewForUser<T extends { serverInfo?: any, node?: any, outOfDatePlugins?: any[] }>(overview: T, admin: boolean): T {
  if (admin) {
    return overview
  }
  return {
    ...overview,
    serverInfo: overview.serverInfo ? serverInfoForUser(overview.serverInfo, false) : overview.serverInfo,
    node: withoutInstallPath(overview.node, false),
    outOfDatePlugins: Array.isArray(overview.outOfDatePlugins)
      ? overview.outOfDatePlugins.map(plugin => withoutInstallPath(plugin, false))
      : overview.outOfDatePlugins,
  }
}

/** The verified user on a socket (set by the WS guards) is an administrator */
function isAdminClient(client: any): boolean {
  return client?.data?.user?.admin === true
}

@Injectable()
export class StatusService {
  private statusCache = new NodeCache({ stdTTL: 3600 })
  private homebridgeStatus: HomebridgeStatus = HomebridgeStatus.DOWN
  private homebridgeStatusChange = new Subject<HomebridgeStatus>()
  private matterInfo: HomebridgeStatusMatterUpdate = {
    enabled: false,
  }

  // Sockets already receiving server stats, as LogService.activeClients
  private statsClients = new WeakSet<object>()

  private rpiGetThrottledMapping = {
    0: 'Under-voltage detected',
    1: 'Arm frequency capped',
    2: 'Currently throttled',
    3: 'Soft temperature limit active',
    16: 'Under-voltage has occurred',
    17: 'Arm frequency capping has occurred',
    18: 'Throttled has occurred',
    19: 'Soft temperature limit has occurred',
  }

  constructor(
    @Inject(HttpService) private readonly httpService: HttpService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(ServerService) private readonly serverService: ServerService,
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
    @Inject(SystemMetricsService) private readonly systemMetrics: SystemMetricsService,
    @Inject(DashboardLayoutService) private readonly dashboardLayout: DashboardLayoutService,
  ) {
    this.homebridgeIpcService.on('serverStatusUpdate', (data: HomebridgeStatusUpdate) => {
      this.homebridgeStatus = data.status

      if (data.status === HomebridgeStatus.DOWN) {
        // Reset Matter info when Homebridge goes down
        this.matterInfo = { enabled: false }
      }

      if (data?.setupUri) {
        this.serverService.setupCode = data.setupUri
        this.serverService.paired = data.paired
      }

      // Store Matter info if provided
      if (data?.matter) {
        this.matterInfo = data.matter
      }

      this.homebridgeStatusChange.next(this.homebridgeStatus)
    })
  }

  /**
   * Get the current dashboard layout
   */
  public async getDashboardLayout() {
    return this.dashboardLayout.getLayout()
  }

  /**
   * Aggregated init payload for the dashboard page — collapses the
   * historical two-event load (`get-dashboard-layout` + an optional
   * `get-raspberry-pi-throttled-status`) into a single WS round-trip.
   * `rpiThrottled` is only attached when the host is actually a Raspberry
   * Pi; non-Pi clients see `{ layout }` and the field is absent.
   */
  public async getDashboardInit(): Promise<{ layout: any, rpiThrottled?: Record<string, boolean> }> {
    const layout = await this.getDashboardLayout()
    if (!this.configService.runningOnRaspberryPi) {
      return { layout }
    }
    try {
      const rpiThrottled = await this.getRaspberryPiThrottledStatus()
      return { layout, rpiThrottled }
    } catch (e) {
      this.logger.debug(`Failed to attach Raspberry Pi throttled status to dashboard init: ${e.message}.`)
      return { layout }
    }
  }

  /**
   * Saves the current dashboard layout
   */
  public async setDashboardLayout(layout: any) {
    return this.dashboardLayout.setLayout(layout)
  }

  /**
   * Returns server CPU Load and temperature information
   */
  public async getServerCpuInfo(interval?: number) {
    return this.systemMetrics.getServerCpuInfo(interval)
  }

  /**
   * Returns server Memory usage information
   */
  public async getServerMemoryInfo(interval?: number) {
    return this.systemMetrics.getServerMemoryInfo(interval)
  }

  /**
   * Returns the current network usage
   */
  public async getCurrentNetworkUsage(netInterfaces?: string[], interval?: number): Promise<NetworkUsage> {
    return this.systemMetrics.getCurrentNetworkUsage(netInterfaces, interval)
  }

  /**
   * Returns server and process uptime information
   */
  public async getServerUptimeInfo() {
    return {
      time: time(),
      processUptime: process.uptime(),
    }
  }

  /**
   * Returns Homebridge pairing information
   */
  public async getHomebridgePairingPin() {
    return {
      pin: this.configService.homebridgeConfig.bridge.pin,
      setupUri: await this.serverService.getSetupCode(),
      paired: this.serverService.paired,
      hap: this.getHapInfo(),
      matter: this.matterInfo,
    }
  }

  private getHapInfo() {
    const hap = this.configService.homebridgeConfig.bridge.hap
    // Tolerate both the legacy boolean form (`hap: false`) and the nested
    // object form (`hap: { enabled: false, externalsOnly: true }`). The
    // bridge accessory itself is "enabled" only when the protocol is on
    // AND externalsOnly is not set.
    let enabled = true
    let externalsOnly = false
    if (hap === false) {
      enabled = false
    } else if (typeof hap === 'object' && hap !== null) {
      enabled = hap.enabled !== false
      externalsOnly = hap.externalsOnly === true
    }
    return { enabled, externalsOnly }
  }

  /**
   * Returns Homebridge up/down status from cache
   */
  public async getHomebridgeStatus() {
    return {
      status: this.homebridgeStatus,
      consolePort: this.configService.ui.port,
      name: this.configService.homebridgeConfig.bridge.name,
      port: this.configService.homebridgeConfig.bridge.port,
      pin: this.configService.homebridgeConfig.bridge.pin,
      setupUri: this.serverService.setupCode,
      packageVersion: this.configService.package.version,
      paired: this.serverService.paired,
      hap: this.getHapInfo(),
      matter: this.matterInfo,
    }
  }

  /**
   * Socket Handler - Per Client
   * Start emitting server stats to client
   * @param client
   */
  public async watchStats(client: any) {
    // A repeat `monitor-server-status` on the same socket (e.g. navigating
    // back to the status page) only re-sends the current status. Subscribing
    // again would stack a second subscription, and a second pair of
    // disconnect handlers, on top of the first.
    if (this.statsClients.has(client)) {
      client.emit('homebridge-status', withoutPairingCodes(await this.getHomebridgeStats(), isAdminClient(client)))
      return
    }
    this.statsClients.add(client)

    let homebridgeStatusInterval: NodeJS.Timeout
    // Closure-scoped flag flipped by `onEnd`. The subscription callback
    // is async and awaits `getHomebridgeStats()`; without this check
    // the emit could land on a disconnected client (or fire after the
    // socket was reused by another component).
    let disposed = false

    const homebridgeStatusChangeSub: Subscription = this.homebridgeStatusChange.subscribe(async () => {
      const stats = withoutPairingCodes(await this.getHomebridgeStats(), isAdminClient(client))
      if (disposed) {
        return
      }
      client.emit('homebridge-status', stats)
    })

    // Cleanup on disconnect. Registered before the first `await`, so a
    // client leaving while the initial status is gathered is still released.
    const onEnd = () => {
      disposed = true
      this.statsClients.delete(client)
      // Only our own pair: removeAllListeners would also strip the WS auth
      // registry's and socket.io's own disconnect listeners
      client.off('end', onEnd)
      client.off('disconnect', onEnd)

      if (homebridgeStatusInterval) {
        clearInterval(homebridgeStatusInterval)
      }

      homebridgeStatusChangeSub.unsubscribe()
    }

    client.on('end', onEnd)
    client.on('disconnect', onEnd)

    const stats = withoutPairingCodes(await this.getHomebridgeStats(), isAdminClient(client))
    if (!disposed) {
      client.emit('homebridge-status', stats)
    }
  }

  /**
   * Returns Homebridge Status From Healthcheck
   */
  private async getHomebridgeStats(): Promise<HomebridgeStatsResponse> {
    return {
      consolePort: this.configService.ui.port,
      port: this.configService.homebridgeConfig.bridge.port,
      pin: this.configService.homebridgeConfig.bridge.pin,
      setupUri: await this.serverService.getSetupCode(),
      paired: this.serverService.paired,
      packageVersion: this.configService.package.version,
      status: await this.checkHomebridgeStatus(),
      hap: this.getHapInfo(),
      matter: this.matterInfo,
    }
  }

  /**
   * Check if homebridge is running on the local system
   */
  public async checkHomebridgeStatus() {
    return this.homebridgeStatus
  }

  /**
   * Get / Cache the default interface
   */
  private async getDefaultInterface(): Promise<Systeminformation.NetworkInterfacesData> {
    const cachedResult = this.statusCache.get('defaultInterface') as Systeminformation.NetworkInterfacesData

    if (cachedResult) {
      return cachedResult
    }

    const defaultInterfaceName = await this.systemMetrics.getDefaultInterfaceName()
    const defaultInterface = defaultInterfaceName ? (await networkInterfaces()).find(x => x.iface === defaultInterfaceName) : undefined

    if (defaultInterface) {
      this.statusCache.set('defaultInterface', defaultInterface)
    }

    return defaultInterface
  }

  /**
   * Get / Cache the OS Information
   */
  private async getOsInfo(): Promise<Systeminformation.OsData> {
    const cachedResult = this.statusCache.get('osInfo') as Systeminformation.OsData

    if (cachedResult) {
      return cachedResult
    }

    const osInformation = await osInfo()

    this.statusCache.set('osInfo', osInformation, 86400)
    return osInformation
  }

  /**
   * Returns details about this Homebridge server
   */
  public async getHomebridgeServerInfo() {
    return {
      serviceUser: userInfo().username,
      homebridgeConfigJsonPath: this.configService.configPath,
      homebridgeStoragePath: this.configService.storagePath,
      homebridgeInsecureMode: this.configService.homebridgeInsecureMode,
      homebridgeCustomPluginPath: this.configService.customPluginPath,
      homebridgePluginPath: getUiNodeModulesPath(),
      homebridgeRunningInDocker: this.configService.runningInDocker,
      homebridgeRunningInSynologyPackage: this.configService.runningInSynologyPackage,
      homebridgeRunningInPackageMode: this.configService.runningInPackageMode,
      nodeVersion: process.version,
      os: await this.getOsInfo(),
      time: time(),
      network: await this.getDefaultInterface() || {},
    }
  }

  /**
   * Return the Homebridge package
   */
  public async getHomebridgeVersion() {
    return this.pluginsService.getHomebridgePackage()
  }

  /**
   * Aggregated payload for the dashboard "Update Info" widget.
   * Replaces 6 separate WS calls + 1 HTTP call on widget load.
   * Per-field null on rejection so a single upstream failure doesn't
   * fail the whole call.
   */
  public async getVersionOverview() {
    const [
      serverInfoResult,
      nodeResult,
      homebridgeResult,
      homebridgeUiResult,
      outOfDatePluginsResult,
      installedPluginsResult,
    ] = await Promise.allSettled([
      this.getHomebridgeServerInfo(),
      this.getNodeVersionInfo(),
      this.pluginsService.getHomebridgePackage(),
      this.pluginsService.getHomebridgeUiPackage(),
      this.pluginsService.getOutOfDatePlugins(),
      this.pluginsService.getInstalledPlugins(),
    ])

    const settled = <T>(result: PromiseSettledResult<T>, label: string, fallback: T): T => {
      if (result.status === 'fulfilled') {
        return result.value
      }
      this.logger.error(`Failed to load ${label} for version overview as ${result.reason?.message ?? result.reason}.`)
      return fallback
    }

    const serverInfo = settled(serverInfoResult, 'server info', null)
    const node = settled(nodeResult, 'node version info', null)
    const homebridge = settled(homebridgeResult, 'homebridge package', null)
    const homebridgeUi = settled(homebridgeUiResult, 'homebridge-ui package', null)
    const outOfDatePlugins = settled(outOfDatePluginsResult, 'out-of-date plugins', [])
    const installedPlugins = settled(installedPluginsResult, 'installed plugins', [])

    // hbV2Ready: every non-ui plugin's `engines.homebridge` accepts a v2 range.
    // Cheap because installedPlugins is already memoised in PluginsService.
    const hbV2Ready = installedPlugins
      .filter(p => p.name !== '@mp-consulting/homebridge-config-glass-ui')
      .every((p) => {
        const hbEngines = p.engines?.homebridge?.split('||').map(s => s.trim()) || []
        return hbEngines.some(v => v.startsWith('^2') || v.startsWith('>=2'))
      })

    // Only fetch docker details when actually running in docker (matches
    // the frontend's previous gating). Done after the parallel batch so we
    // can read serverInfo. Adds at most one extra round trip on docker.
    let docker = null
    if (serverInfo?.homebridgeRunningInDocker) {
      try {
        docker = await this.getDockerDetails()
      } catch (e) {
        this.logger.error(`Failed to load docker details for version overview as ${e.message}.`)
      }
    }

    return {
      serverInfo,
      node,
      homebridge,
      homebridgeUi,
      outOfDatePlugins,
      docker,
      hbV2Ready,
    }
  }

  /**
   * Clear the Node.js version cache
   * Used when Node.js update policy changes
   */
  public clearNodeJsVersionCache() {
    // Clear cache for all policy variants
    this.statusCache.del('nodeVersion:all')
    this.statusCache.del('nodeVersion:none')
    this.statusCache.del('nodeVersion:major')
  }

  /**
   * Checks the current version of Node.js and compares to the latest LTS
   */
  public async getNodeVersionInfo() {
    // Get the current policy to include in cache key
    const nodeUpdatePolicy = this.configService.getNodeUpdatePolicy()
    const cacheKey = `nodeVersion:${nodeUpdatePolicy}`

    const cachedResult = this.statusCache.get(cacheKey)

    if (cachedResult) {
      return cachedResult
    }

    const isNodeJs24Supported = isNodeV24SupportedArchitecture()

    try {
      const releases = await fetchNodeReleases(url => firstValueFrom(this.httpService.get(url)))
      if (!releases) {
        throw new TypeError('the release list is not an array')
      }

      // The official glibc floor has been 2.28 since Node.js 18 and has not
      // changed since (through v26), so it plays no part in the suggestion
      const { updateAvailable, latestVersion, showNodeUnsupportedWarning } = pickNodeUpdate(releases, {
        current: process.version,
        policy: nodeUpdatePolicy,
      })

      // Also return the npm version here
      let npmVersion = null
      try {
        npmVersion = `v${await getNpmVersion()}`
      } catch (e) {
        this.logger.debug(`Could not check npm version as ${e.message}.`)
      }

      const versionInformation = {
        currentVersion: process.version,
        latestVersion,
        updateAvailable,
        showNodeUnsupportedWarning,
        installPath: dirname(process.execPath),
        npmVersion,
        architecture: process.arch,
        supportsNodeJs24: isNodeJs24Supported,
      }

      this.statusCache.set(cacheKey, versionInformation, 86400)
      return versionInformation
    } catch (e) {
      this.logger.log(`Failed to check for Node.js version updates (check your internet connection) as ${e.message}.`)
      const versionInformation = {
        currentVersion: process.version,
        latestVersion: process.version,
        updateAvailable: false,
        showNodeUnsupportedWarning: false,
        architecture: process.arch,
        supportsNodeJs24: isNodeJs24Supported,
      }
      this.statusCache.set(cacheKey, versionInformation, 3600)
      return versionInformation
    }
  }

  /**
   * Returns information about the current state of the Raspberry Pi
   */
  public async getRaspberryPiThrottledStatus() {
    if (!this.configService.runningOnRaspberryPi) {
      throw new BadRequestException('This command is only available on Raspberry Pi')
    }

    const output = {}

    for (const bit of Object.keys(this.rpiGetThrottledMapping)) {
      output[this.rpiGetThrottledMapping[bit]] = false
    }

    try {
      const { stdout } = await execAsync('vcgencmd get_throttled')
      const throttledHex = Number.parseInt(stdout.trim().replace('throttled=', ''))

      if (!Number.isNaN(throttledHex)) {
        for (const bit of Object.keys(this.rpiGetThrottledMapping)) {
          output[this.rpiGetThrottledMapping[bit]] = !!((throttledHex >> Number.parseInt(bit, 10)) & 1)
        }
      }
    } catch (e) {
      this.logger.debug(`Could not check vcgencmd get_throttled as ${e.message}.`)
    }

    return output
  }

  /**
   * Fetches Docker package details, including version information, release body, and system details.
   * Accounts for version tag formats: YYYY-MM-DD (stable), beta-YYYY-MM-DD or test-YYYY-MM-DD (test).
   * If currentVersion is beta/test, latestVersion is the latest beta/test version; otherwise, it's the latest stable.
   * @returns A promise resolving to the Docker details object.
   */
  public async getDockerDetails() {
    const currentVersion = process.env.DOCKER_HOMEBRIDGE_VERSION
    let latestVersion: string | null = null
    let latestReleaseBody = ''
    let updateAvailable = false

    try {
      const { releases, rawReleases } = await this.getRecentReleases()

      // Determine the type of currentVersion and select the appropriate latest version
      if (currentVersion) {
        const lowerCurrentVersion = currentVersion.toLowerCase()
        let targetReleases: DockerReleaseInfo[] = []

        if (lowerCurrentVersion.startsWith('beta-')) {
          // Current version is beta; select latest beta version
          targetReleases = releases
            .filter(release => release.testTag === 'beta' && RE_BETA_DATE.test(release.version))
            .sort((a, b) => b.version.localeCompare(a.version)) // Sort by date descending
          latestVersion = targetReleases[0]?.version || null
        } else if (lowerCurrentVersion.startsWith('test-')) {
          // Current version is test; select latest test version
          targetReleases = releases
            .filter(release => release.testTag === 'test' && RE_TEST_DATE.test(release.version))
            .sort((a, b) => b.version.localeCompare(a.version)) // Sort by date descending
          latestVersion = targetReleases[0]?.version || null
        } else {
          // Current version is stable or invalid; select latest stable version
          const stableRelease = releases.find(release => release.isLatestStable)
          latestVersion = stableRelease?.version || null
        }

        if (currentVersion && latestVersion) {
          // Compare versions as dates if they match the expected format
          if (RE_TRAILING_DATE.test(currentVersion) && RE_TRAILING_DATE.test(latestVersion)) {
            const currentDate = new Date(currentVersion.match(RE_TRAILING_DATE)![0])
            const latestDate = new Date(latestVersion.match(RE_TRAILING_DATE)![0])
            updateAvailable = latestDate > currentDate
          } else {
            // Fallback to string comparison
            updateAvailable = currentVersion !== latestVersion
          }
        }
      } else {
        // No currentVersion; default to latest stable
        const stableRelease = releases.find(release => release.isLatestStable)
        latestVersion = stableRelease?.version || null
      }

      // Fetch the release body for the latestVersion
      if (latestVersion) {
        const rawRelease = rawReleases.find(r => r.tag_name === latestVersion)
        latestReleaseBody = rawRelease?.body || ''
      }
    } catch (error) {
      console.error('Failed to fetch Docker details:', error instanceof Error ? error.message : error)
    }

    return {
      currentVersion,
      latestVersion,
      latestReleaseBody,
      updateAvailable,
    }
  }

  private readonly DOCKER_GITHUB_API_URL = 'https://api.github.com/repos/homebridge/docker-homebridge/releases'

  /**
   * Fetches the most recent releases (up to 100) of the homebridge/docker-homebridge package from GitHub,
   * tagging test versions (tags starting with 'beta-' or 'test-') and the latest stable version (YYYY-MM-DD format).
   * Includes a testTag field for test versions.
   * @returns A promise resolving to an object with processed releases and raw release data, or empty arrays if an error occurs.
   */
  public async getRecentReleases(): Promise<{ releases: DockerReleaseInfo[], rawReleases: DockerRelease[] }> {
    try {
      // Fetch the first page of up to 100 releases
      const response = await fetch(`${this.DOCKER_GITHUB_API_URL}?per_page=100`, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          // Optional: Add GitHub token for higher rate limits
          // 'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        },
      })

      if (!response.ok) {
        console.error(`GitHub API error: ${response.status} ${response.statusText}`)
        return { releases: [], rawReleases: [] }
      }

      const data: DockerRelease[] = await response.json()

      if (!Array.isArray(data)) {
        console.error('Invalid response from GitHub API: Expected an array')
        return { releases: [], rawReleases: [] }
      }

      // Find the latest stable release by sorting YYYY-MM-DD tags
      const stableReleases = data
        .filter(release => RE_STABLE_DATE.test(release.tag_name)) // Stable: YYYY-MM-DD
        .sort((a, b) => b.tag_name.localeCompare(a.tag_name)) // Sort descending (most recent first)
      const latestStableTag = stableReleases[0]?.tag_name || null

      const releases = data.map((release) => {
        const tagName = release.tag_name.toLowerCase()
        let testTag: 'beta' | 'test' | null = null
        if (tagName.startsWith('beta-')) {
          testTag = 'beta'
        } else if (tagName.startsWith('test-')) {
          testTag = 'test'
        }

        return {
          version: release.tag_name,
          publishedAt: release.published_at,
          isPrerelease: release.prerelease,
          isTest: testTag !== null,
          testTag,
          isLatestStable: release.tag_name === latestStableTag,
        }
      })

      return { releases, rawReleases: data }
    } catch (error) {
      console.error('Failed to fetch docker-homebridge releases:', error instanceof Error ? error.message : error)
      return { releases: [], rawReleases: [] }
    }
  }
}
