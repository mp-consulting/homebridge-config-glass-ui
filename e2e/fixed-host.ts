/**
 * Preloaded by e2e/serve.mjs (`tsx --import ./e2e/fixed-host.ts`): the
 * backend the browser tests run against reports one made-up host instead of
 * the machine it runs on, and never reaches the network.
 *
 * Without it the dashboard prints this machine's host name, IPs, OS, paths,
 * Node.js version, uptime and live CPU / memory / network figures, and the
 * plugin list carries whatever npm and the GitHub plugin list say today.
 * That is what kept e2e/specs/visual.spec.ts machine-specific; with it a
 * screenshot depends only on the code and the browser that renders it.
 *
 * It patches service prototypes before Nest builds the app (tsx shares one
 * module graph between this file and src/bin/standalone.ts).
 */

import { HttpService } from '@nestjs/axios'
import { throwError } from 'rxjs'

import { InstalledPluginsService } from '../src/modules/plugins/installed-plugins.service.js'
import { StatusService } from '../src/modules/status/status.service.js'
import { SystemMetricsService } from '../src/modules/status/system-metrics.service.js'

const NODE_VERSION = 'v24.11.0'
const HOMEBRIDGE_VERSION = '1.8.0'
const UI_VERSION = '2.0.0'
const DAY = 86_400
const GB = 1024 ** 3
const TIME = { current: Date.UTC(2026, 0, 1, 12), uptime: 3 * DAY + 4 * 3600, timezone: 'UTC', timezoneName: 'Coordinated Universal Time' }

// npm, nodejs.org, GitHub: fail at once, as if offline. The callers already
// cope (no update badges, no registry metadata), and nothing waits on a DNS
// timeout.
const offline = () => throwError(() => new Error('the e2e backend is offline (e2e/fixed-host.ts)'))
for (const method of ['get', 'head', 'post', 'put', 'patch', 'delete', 'request'] as const) {
  HttpService.prototype[method] = offline as any
}

// All made up rather than the real answer patched over: the real one asks the
// OS (systeminformation spawns processes), which is slow and may differ
StatusService.prototype.getHomebridgeServerInfo = async function (this: StatusService) {
  const configService = (this as any).configService
  return {
    serviceUser: 'homebridge',
    homebridgeConfigJsonPath: '/var/lib/homebridge/config.json',
    homebridgeStoragePath: '/var/lib/homebridge',
    homebridgeInsecureMode: configService.homebridgeInsecureMode,
    homebridgeCustomPluginPath: '/var/lib/homebridge/node_modules',
    homebridgePluginPath: '/opt/homebridge/lib/node_modules',
    homebridgeRunningInDocker: false,
    homebridgeRunningInSynologyPackage: false,
    homebridgeRunningInPackageMode: false,
    nodeVersion: NODE_VERSION,
    os: {
      platform: 'linux',
      distro: 'Debian GNU/Linux',
      codename: 'bookworm',
      release: '12',
      kernel: '6.1.0',
      arch: 'arm64',
      hostname: 'homebridge',
      fqdn: 'homebridge.local',
    } as any,
    time: TIME,
    network: { iface: 'eth0', ifaceName: 'eth0', ip4: '192.168.1.20', ip4subnet: '255.255.255.0', ip6: 'fe80::1', mac: '00:00:5e:00:53:01' } as any,
  }
}

StatusService.prototype.getNodeVersionInfo = async function () {
  return {
    currentVersion: NODE_VERSION,
    latestVersion: NODE_VERSION,
    updateAvailable: false,
    showNodeUnsupportedWarning: false,
    installPath: '/usr/local/bin',
    npmVersion: 'v11.6.2',
    architecture: 'arm64',
    supportsNodeJs24: true,
  }
}

StatusService.prototype.getServerUptimeInfo = async function () {
  return {
    time: TIME,
    processUptime: 2 * 3600 + 5 * 60,
  }
}

// A fixed, gently varying history, so the charts draw something recognisable
const history = (base: number, swing: number) => Array.from({ length: 60 }, (_, i) => base + swing * Math.sin(i / 6))

SystemMetricsService.prototype.getServerCpuInfo = async function () {
  const cpuLoadHistory = history(18, 6)
  return {
    cpuTemperature: { main: 48, cores: [], max: 52 },
    currentLoad: cpuLoadHistory.at(-1),
    cpuLoadHistory,
  }
}

SystemMetricsService.prototype.getServerMemoryInfo = async function () {
  return {
    mem: { total: 8 * GB, free: 3 * GB, used: 5 * GB, active: 4 * GB, available: 4 * GB } as any,
    memoryUsageHistory: history(50, 4),
  }
}

SystemMetricsService.prototype.getCurrentNetworkUsage = async function (netInterfaces?: string[]) {
  const iface = netInterfaces?.[0] || 'eth0'
  const received = 96 * 1024
  const sent = 24 * 1024
  return { net: { iface, rx_sec: received, tx_sec: sent } as any, point: (received + sent) / 1024 / 1024, received, sent }
}

// The versions the update widget shows: the lockfile's Homebridge and this
// package's own version would otherwise change the dashboard on every bump
// (the version the UI reports for itself comes from the package.json
// e2e/build.mjs writes, pinned to the same value)
function pinVersion(method: 'getHomebridgePackage' | 'getHomebridgeUiPackage', version: string) {
  const original = InstalledPluginsService.prototype[method]
  InstalledPluginsService.prototype[method] = async function (this: InstalledPluginsService) {
    const plugin = await original.call(this)
    return { ...plugin, installedVersion: version, latestVersion: version, updateAvailable: false, betaUpdateAvailable: false }
  }
}
pinVersion('getHomebridgePackage', HOMEBRIDGE_VERSION)
pinVersion('getHomebridgeUiPackage', UI_VERSION)
