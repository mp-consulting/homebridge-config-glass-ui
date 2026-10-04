import type { HomebridgePlugin } from './plugins.interfaces.js'

import { BadRequestException } from '@nestjs/common'
import { coerce, satisfies, valid, validRange } from 'semver'

/** The engines an upgrade would change. */
export type CompatibilityEngine = 'node' | 'homebridge'

export interface CompatibilityTarget {
  node?: string
  homebridge?: string
}

export interface PluginCompatibilityEntry {
  name: string
  displayName: string
  installedVersion?: string
  engines: { node?: string, homebridge?: string }
  /** The engines the plugin's range excludes (incompatible) or does not state (unknown). */
  engineIssues: CompatibilityEngine[]
}

export interface PluginCompatibilityReport {
  target: CompatibilityTarget
  /** Installed plugins whose `engines` range does not accept the target. */
  incompatible: PluginCompatibilityEntry[]
  /** Installed plugins that state no range (or an unparseable one) for a targeted engine. */
  unknown: PluginCompatibilityEntry[]
  /** How many plugins were checked. */
  checked: number
}

/**
 * A query-string version as a clean semver version: `v24.1.0` and `24` are
 * accepted (coerced), anything else is a 400.
 */
export function parseTargetVersion(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value !== 'string' || value.length > 64) {
    throw new BadRequestException(`Invalid ${label} version.`)
  }
  const version = valid(value.trim().replace(/^v/i, '')) ?? coerce(value)?.version
  if (!version) {
    throw new BadRequestException(`Invalid ${label} version.`)
  }
  return version
}

/**
 * Which installed plugins would break, or might, if Node.js and/or Homebridge
 * were upgraded to the target versions. Only the plugins' declared `engines`
 * ranges are checked (prereleases count as satisfying, as npm does for the
 * engine check). Homebridge itself is not a plugin and is skipped.
 */
export function checkPluginCompatibility(plugins: HomebridgePlugin[], target: CompatibilityTarget): PluginCompatibilityReport {
  const engines: CompatibilityEngine[] = (['node', 'homebridge'] as const).filter(engine => !!target[engine])
  const incompatible: PluginCompatibilityEntry[] = []
  const unknown: PluginCompatibilityEntry[] = []
  const checkedPlugins = plugins.filter(plugin => plugin.name !== 'homebridge')

  for (const plugin of checkedPlugins) {
    const failing: CompatibilityEngine[] = []
    const missing: CompatibilityEngine[] = []
    for (const engine of engines) {
      const range = plugin.engines?.[engine]
      if (!range || !validRange(range)) {
        missing.push(engine)
      } else if (!satisfies(target[engine]!, range, { includePrerelease: true })) {
        failing.push(engine)
      }
    }
    const entry = (engineIssues: CompatibilityEngine[]): PluginCompatibilityEntry => ({
      name: plugin.name,
      displayName: plugin.displayName || plugin.name,
      installedVersion: plugin.installedVersion,
      engines: { node: plugin.engines?.node, homebridge: plugin.engines?.homebridge },
      engineIssues,
    })
    if (failing.length) {
      incompatible.push(entry(failing))
    } else if (missing.length) {
      unknown.push(entry(missing))
    }
  }

  const byName = (a: PluginCompatibilityEntry, b: PluginCompatibilityEntry) => a.name.localeCompare(b.name)
  return {
    target: Object.fromEntries(engines.map(engine => [engine, target[engine]])),
    incompatible: incompatible.sort(byName),
    unknown: unknown.sort(byName),
    checked: checkedPlugins.length,
  }
}
