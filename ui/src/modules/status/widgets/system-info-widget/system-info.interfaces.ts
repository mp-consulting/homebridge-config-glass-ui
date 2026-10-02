export interface NodeJsInfo {
  currentVersion: string
  installPath: string
  latestVersion: string
  npmVersion: string
  showNodeUnsupportedWarning: boolean
  updateAvailable: boolean
  architecture: string
  supportsNodeJs24: boolean
}

export interface ServerInfo {
  homebridgeCustomPluginPath?: string
  homebridgeConfigJsonPath: string
  homebridgeInsecureMode: boolean
  homebridgePluginPath: string
  homebridgeRunningInDocker: boolean
  homebridgeRunningInPackageMode: boolean
  homebridgeRunningInSynologyPackage: boolean
  homebridgeStoragePath: string
  network: {
    iface: string
    ifaceName: string
    default: boolean
    ip4: string
    ip4subnet: string
    ip6?: string
    ip6subnet?: string
  }
  nodeVersion: string
  os: {
    hostname: string
    arch: string
    platform: string
    distro: string
    release: string
    codename: string
    kernel: string
  }
  serviceUser: string
  time: {
    current: number
    uptime: number
    timezone: string
    timezoneName: string
  }
}
