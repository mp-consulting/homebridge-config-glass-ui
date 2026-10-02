import { intersects } from 'semver'

export interface InstalledPlugin {
  name: string
  hb2Ready: 'hide' | 'supported' | 'unknown'
  engines?: {
    homebridge?: string
  }
  [key: string]: unknown
}

export const DEFAULT_ICON = 'assets/hb-icon.png'

/**
 * Whether each installed plugin declares Homebridge v2 support, and whether
 * they all do. A plugin declares `engines.homebridge` as a semver range, so
 * this asks semver whether the range overlaps the v2 line: a prefix check
 * misses valid ranges like '2.x' or '>= 2.0.0'.
 * @param plugins - the installed plugins
 * @param homebridgeVersion - the version running now
 */
export function assessHbV2Readiness(plugins: any[], homebridgeVersion: string): { installedPlugins: InstalledPlugin[], allPluginsSupported: boolean } {
  const homebridgeMajor = homebridgeVersion.split('.')[0]
  let allPluginsSupported = true
  const installedPlugins = plugins
    .filter((x: any) => x.name !== '@mp-consulting/homebridge-config-glass-ui')
    .map((x: any) => {
      const hbEngines: string[] = x.engines?.homebridge?.split('||').map((range: string) => range.trim()) || []
      const supportsV2 = hbEngines.some((range) => {
        try {
          return intersects(range, '2.x')
        } catch {
          return false
        }
      })
      const hb2Ready = homebridgeMajor === '2' ? 'hide' : supportsV2 ? 'supported' : 'unknown'
      if (hb2Ready === 'unknown') {
        allPluginsSupported = false
      }
      return { ...x, hb2Ready } as InstalledPlugin
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return { installedPlugins, allPluginsSupported }
}
