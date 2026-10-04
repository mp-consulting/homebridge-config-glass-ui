import { api } from '@/core/api'

export type CompatibilityEngine = 'node' | 'homebridge'

export interface UpgradeTarget {
  node?: string
  homebridge?: string
}

export interface PluginCompatibilityEntry {
  name: string
  displayName: string
  installedVersion?: string
  engines: { node?: string, homebridge?: string }
  engineIssues: CompatibilityEngine[]
}

/** `GET /plugins/compatibility`: what an upgrade to the target versions would break. */
export interface PluginCompatibilityReport {
  target: UpgradeTarget
  incompatible: PluginCompatibilityEntry[]
  unknown: PluginCompatibilityEntry[]
  checked: number
}

/** Ask the server which installed plugins do not accept the target Node.js / Homebridge versions. */
export function fetchUpgradeCompatibility(target: UpgradeTarget): Promise<PluginCompatibilityReport> {
  const params = new URLSearchParams()
  if (target.node) {
    params.set('node', target.node)
  }
  if (target.homebridge) {
    params.set('homebridge', target.homebridge)
  }
  return api.get<PluginCompatibilityReport>(`/plugins/compatibility?${params}`)
}
