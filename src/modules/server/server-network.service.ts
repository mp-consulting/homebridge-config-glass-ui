import type { Systeminformation } from 'systeminformation'

import type { AccessoryConfig, HomebridgeConfig, PlatformConfig } from '../../core/config/config.interfaces.js'
import type { NetworkOverviewEntry } from '../../core/matter/matter.interfaces.js'

import { join } from 'node:path'

import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import { pathExists, readJson } from 'fs-extra/esm'
import NodeCache from 'node-cache'
import { networkInterfaces } from 'systeminformation'

import { ConfigService } from '../../core/config/config.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { findFreePort, isPortInUse } from '../../core/net/port.js'
import { RE_COLON, RE_VALID_NAME } from '../../core/regex.constants.js'
import { ConfigEditorService } from '../config-editor/config-editor.service.js'
import { HomebridgeMdnsSettingDto } from './server.dto.js'

/**
 * Bridge network settings: interfaces, mDNS advertiser, name, ports and the network overview.
 */
@Injectable()
export class ServerNetworkService {
  private serverServiceCache = new NodeCache({ stdTTL: 300 })

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(ConfigEditorService) private readonly configEditorService: ConfigEditorService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Returns a list of network adapters on the current host
   */
  public async getSystemNetworkInterfaces(): Promise<Systeminformation.NetworkInterfacesData[]> {
    const fromCache: Systeminformation.NetworkInterfacesData[] = this.serverServiceCache.get('network-interfaces')

    const interfaces = fromCache || (await networkInterfaces()).filter((adapter) => {
      return !adapter.internal
        && (adapter.ip4 || (adapter.ip6))
    })

    if (!fromCache) {
      this.serverServiceCache.set('network-interfaces', interfaces)
    }

    return interfaces
  }

  /**
   * Returns a list of network adapters the bridge is currently configured to listen on
   */
  public async getHomebridgeNetworkInterfaces() {
    const config = await this.configEditorService.getConfigFile()

    if (!config.bridge?.bind) {
      return []
    }

    if (Array.isArray(config.bridge?.bind)) {
      return config.bridge.bind
    }

    if (typeof config.bridge?.bind === 'string') {
      return [config.bridge.bind]
    }

    return []
  }

  /**
   * Return the current setting for the config.bridge.advertiser value
   */
  public async getHomebridgeMdnsSetting(): Promise<HomebridgeMdnsSettingDto> {
    const config = await this.configEditorService.getConfigFile()

    if (!config.bridge.advertiser) {
      config.bridge.advertiser = 'bonjour-hap'
    }

    return {
      advertiser: config.bridge.advertiser,
    }
  }

  /**
   * Return the current setting for the config.bridge.advertiser value
   */
  public async setHomebridgeMdnsSetting(setting: HomebridgeMdnsSettingDto) {
    const config = await this.configEditorService.getConfigFile()

    config.bridge.advertiser = setting.advertiser

    await this.configEditorService.updateConfigFile(config)
  }

  /**
   * Set the bridge interfaces
   */
  public async setHomebridgeNetworkInterfaces(adapters: string[]) {
    const config = await this.configEditorService.getConfigFile()

    if (!config.bridge) {
      config.bridge = {} as HomebridgeConfig['bridge']
    }

    if (!adapters.length) {
      delete config.bridge.bind
    } else {
      config.bridge.bind = adapters
    }

    await this.configEditorService.updateConfigFile(config)
  }

  /**
   * Generate a random, unused port and return it
   */
  public async lookupUnusedPort() {
    // We should adhere to any port ranges defined in the config
    const min = this.configService.homebridgeConfig.ports?.start ?? 30000
    const max = this.configService.homebridgeConfig.ports?.end ?? 60000

    return { port: await findFreePort(min, max) }
  }

  /**
   * Generate a random, unused port from the Matter port range (5530-5541) and return it
   * Checks existing Matter port usage in config.json and verifies port availability
   * @returns Object containing an available port number
   * @throws InternalServerErrorException if no ports are available in the range
   */
  public async lookupUnusedMatterPort(): Promise<{ port: number }> {
    const config = await this.configEditorService.getConfigFile()
    const min = config.matterPorts?.start ?? 5530
    const max = config.matterPorts?.end ?? 5541

    // Collect used matter ports into a set
    const usedMatterPorts = new Set<number>()

    if (config.bridge?.matter?.port) {
      usedMatterPorts.add(config.bridge.matter.port)
    }

    // Check child bridges
    for (const block of [...(config.accessories || []), ...(config.platforms || [])] as (AccessoryConfig | PlatformConfig)[]) {
      if (block._bridge?.matter?.port) {
        // Only count Matter ports from platform-based plugins (not accessory-based)
        if ('accessory' in block) {
          this.logger.warn(`Found Matter configuration on accessory-based plugin block, skipping port ${block._bridge.matter.port}`)
          continue
        }
        usedMatterPorts.add(block._bridge.matter.port)
      }
    }

    // Find first available port
    for (let port = min; port <= max; port += 1) {
      if (!usedMatterPorts.has(port) && !await isPortInUse(port)) {
        return { port }
      }
    }

    throw new InternalServerErrorException(`No available ports in the Matter port range (${min}-${max})`)
  }

  /**
   * Get the Homebridge port
   */
  public async getHomebridgePort(): Promise<{ port: number }> {
    const config = await this.configEditorService.getConfigFile()

    return { port: config.bridge.port }
  }

  /**
   * Get the usable ports
   */
  public async getUsablePorts(): Promise<{ start?: number, end?: number }> {
    const config = await this.configEditorService.getConfigFile()

    // config.ports may not exist
    let start: number
    let end: number

    if (config.ports && typeof config.ports === 'object') {
      if (config.ports.start) {
        start = config.ports.start
      }
      if (config.ports.end) {
        end = config.ports.end
      }
    }

    return { start, end }
  }

  /**
   * Set the Homebridge name
   */
  public async setHomebridgeName(name: string): Promise<void> {
    // https://github.com/homebridge/HAP-NodeJS/blob/ee41309fd9eac383cdcace39f4f6f6a3d54396f3/src/lib/util/checkName.ts#L12
    if (!name || !RE_VALID_NAME.test(name)) {
      throw new BadRequestException('Invalid name')
    }

    const config = await this.configEditorService.getConfigFile()

    config.bridge.name = name

    await this.configEditorService.updateConfigFile(config)
  }

  /**
   * Set the Homebridge port
   */
  public async setHomebridgePort(port: number): Promise<void> {
    // Validate port is between 1 and 65535
    if (!port || typeof port !== 'number' || !Number.isInteger(port) || port < 1025 || port > 65533) {
      throw new BadRequestException('Invalid port number')
    }

    const config = await this.configEditorService.getConfigFile()

    config.bridge.port = port

    await this.configEditorService.updateConfigFile(config)
  }

  /**
   * Set the usable ports in the config file
   */
  public async setUsablePorts(value: { start?: number, end?: number }) {
    // 1. Get the current config
    let config = await this.configEditorService.getConfigFile()

    // 2. Validate the input
    if (value.start === null) {
      delete value.start
    }
    if (value.end === null) {
      delete value.end
    }

    if ('start' in value && (typeof value.start !== 'number' || value.start < 1025 || value.start > 65533)) {
      throw new BadRequestException('Port start must be a number between 1025 and 65533.')
    }
    if ('end' in value && (typeof value.end !== 'number' || value.end < 1025 || value.end > 65533)) {
      throw new BadRequestException('Port end must be a number between 1025 and 65533.')
    }
    if ('start' in value && 'end' in value && value.start >= value.end) {
      throw new BadRequestException('Ports start must be less than end.')
    }
    if ('start' in value && !('end' in value) && config.ports?.end && value.start >= config.ports.end) {
      throw new BadRequestException('Ports start must be less than end.')
    }
    if ('end' in value && !('start' in value) && config.ports?.start && config.ports.start >= value.end) {
      throw new BadRequestException('Ports start must be less than end.')
    }

    // 3. Update the config with the new ports
    // Remove ports if neither start nor end is specified
    if (!value.start && !value.end) {
      delete config.ports
    } else {
      config.ports = {}
      if (value.start) {
        config.ports.start = value.start
      }
      if (value.end) {
        config.ports.end = value.end
      }
    }

    // 4. Bring the ports object to the front of the config, after the bridge object
    const { bridge, ports, ...rest } = config
    config = ports ? { bridge, ports, ...rest } : { bridge, ...rest }

    // 5. Save the config file
    await this.configEditorService.updateConfigFile(config)
  }

  /**
   * Get a unified network overview of all port assignments, Matter diagnostics, and detect conflicts
   */
  public async getNetworkOverview(): Promise<{ entries: NetworkOverviewEntry[], conflicts: string[] }> {
    const config = await this.configEditorService.getConfigFile()
    const entries: NetworkOverviewEntry[] = []
    const portMap = new Map<number, string[]>()
    const matterDir = join(this.configService.storagePath, 'matter')

    const trackPort = (port: number, label: string, protocol: string) => {
      if (!port) {
        return
      }
      if (!portMap.has(port)) {
        portMap.set(port, [])
      }
      portMap.get(port).push(`${label} (${protocol})`)
    }

    const readMatterDiagnostics = async (username: string): Promise<{ commissioned: boolean, deviceCount: number }> => {
      const deviceId = username.replace(RE_COLON, '').toUpperCase()
      let commissioned = false
      let deviceCount = 0

      if (await pathExists(matterDir)) {
        const commissioningPath = join(matterDir, deviceId, 'commissioning.json')
        if (await pathExists(commissioningPath)) {
          try {
            const info = await readJson(commissioningPath)
            commissioned = info.commissioned || false
          } catch {
            // Corrupted file, default to false
          }
        }

        const accessoriesPath = join(matterDir, deviceId, 'accessories.json')
        if (await pathExists(accessoriesPath)) {
          try {
            const accessories = await readJson(accessoriesPath)
            deviceCount = Array.isArray(accessories) ? accessories.length : 0
          } catch {
            // Corrupted file, default to 0
          }
        }
      }

      return { commissioned, deviceCount }
    }

    // Main bridge
    const mainBridgeName = config.bridge.name || 'Homebridge'
    const mainEntry: NetworkOverviewEntry = {
      service: 'Homebridge',
      port: config.bridge.port,
      protocol: 'HAP',
      bridge: mainBridgeName,
      status: 'ok',
    }
    trackPort(config.bridge.port, mainBridgeName, 'HAP')

    if (config.bridge.matter?.port) {
      mainEntry.matterPort = config.bridge.matter.port
      trackPort(config.bridge.matter.port, mainBridgeName, 'Matter')
      const diag = await readMatterDiagnostics(config.bridge.username)
      mainEntry.commissioned = diag.commissioned
      mainEntry.deviceCount = diag.deviceCount
    }
    entries.push(mainEntry)

    // Child bridges
    for (const block of [...(config.accessories || []), ...(config.platforms || [])] as (AccessoryConfig | PlatformConfig)[]) {
      if (block._bridge) {
        const bridgeName = block._bridge.name || block.name || ('platform' in block ? block.platform : block.accessory)
        const entry: NetworkOverviewEntry = {
          service: bridgeName,
          port: block._bridge.port || 0,
          protocol: 'HAP',
          bridge: bridgeName,
          status: 'ok',
        }
        if (block._bridge.port) {
          trackPort(block._bridge.port, bridgeName, 'HAP')
        }

        if (block._bridge.matter?.port && !('accessory' in block)) {
          entry.matterPort = block._bridge.matter.port
          trackPort(block._bridge.matter.port, bridgeName, 'Matter')
          const diag = await readMatterDiagnostics(block._bridge.username)
          entry.commissioned = diag.commissioned
          entry.deviceCount = diag.deviceCount
        }
        entries.push(entry)
      }
    }

    // UI port
    const uiConfig = config.platforms?.find(x => x.platform === 'config')
    const uiPort = uiConfig?.port || this.configService.ui.port
    entries.push({
      service: 'Config UI',
      port: uiPort,
      protocol: 'UI',
      bridge: 'UI',
      status: 'ok',
    })
    trackPort(uiPort, 'UI', 'UI')

    // Detect conflicts
    const conflicts: string[] = []
    for (const [port, services] of portMap) {
      if (services.length > 1) {
        conflicts.push(`Port ${port} is used by: ${services.join(', ')}`)
      }
    }

    // Mark conflicting ports
    for (const entry of entries) {
      if (portMap.get(entry.port)?.length > 1) {
        entry.status = 'conflict'
      }
      if (entry.matterPort && portMap.get(entry.matterPort)?.length > 1) {
        entry.status = 'conflict'
      }
    }

    return { entries, conflicts }
  }
}
