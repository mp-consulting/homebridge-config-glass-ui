import axios from 'axios'
import { gt, gte, parse } from 'semver'

import { isNodeV24SupportedArchitecture, MIN_NODE_VERSION } from '../node-version.constants.js'

export const NODE_RELEASES_URL = 'https://nodejs.org/dist/index.json'

/**
 * One entry of nodejs.org/dist/index.json (the fields used here). The list is
 * ordered newest first.
 */
export interface NodeRelease {
  version: string
  lts: string | false
  modules?: string
}

export type NodeUpdatePolicy = 'all' | 'none' | 'major'

/**
 * Fetch the Node.js release list. `httpGet` defaults to axios; the UI server
 * passes its Nest HttpService. Resolves to null when the response is not a list.
 */
export async function fetchNodeReleases(
  httpGet: (url: string) => Promise<{ data: unknown }> = url => axios.get(url),
): Promise<NodeRelease[] | null> {
  const { data } = await httpGet(NODE_RELEASES_URL)
  return Array.isArray(data) ? data : null
}

/**
 * The newest release of a major version (undefined when there is none)
 */
export function latestOfMajor(releases: NodeRelease[], major: number): NodeRelease | undefined {
  return releases.find(x => x.version.startsWith(`v${major}.`))
}

export interface NodeUpdateSuggestion {
  updateAvailable: boolean
  latestVersion: string
  showNodeUnsupportedWarning: boolean
}

/**
 * The Node.js update the UI suggests for the running `current` version (e.g.
 * `v22.12.0`) under the user's update policy: a newer patch/minor of the same
 * major first, else v24 from v22 when `arch` can run it. A major the package
 * does not support gets the unsupported warning instead. Throws when the list
 * lacks a supported major's releases.
 */
export function pickNodeUpdate(
  releases: NodeRelease[],
  { current, policy, arch }: { current: string, policy: NodeUpdatePolicy, arch?: string },
): NodeUpdateSuggestion {
  const latest = (major: number) => latestOfMajor(releases, major)

  let updateAvailable = false
  let latestVersion = current
  let showNodeUnsupportedWarning = false

  switch (current.split('.')[0]) {
    case 'v22': {
      if (gt(latest(22).version, current)) {
        // A new minor/patch version of v22
        updateAvailable = true
        latestVersion = latest(22).version
      } else if (isNodeV24SupportedArchitecture(arch)) {
        // v24 needs a 64-bit architecture
        updateAvailable = true
        latestVersion = latest(24).version
      }
      break
    }
    case 'v24':
    case 'v26': {
      // Only possible on 64-bit architectures - just a new minor/patch version
      const newest = latest(Number.parseInt(current.slice(1), 10)).version
      if (gt(newest, current)) {
        updateAvailable = true
        latestVersion = newest
      }
      break
    }
    default: {
      showNodeUnsupportedWarning = true
    }
  }

  if (policy === 'none') {
    // Hide all Node.js update notifications
    updateAvailable = false
  } else if (policy === 'major') {
    // Only show updates within the same major version
    const currentMajor = Number.parseInt(current.split('.')[0].replace('v', ''), 10)
    const latestMajor = Number.parseInt(latestVersion.split('.')[0].replace('v', ''), 10)

    if (latestMajor > currentMajor) {
      const latestInCurrentMajor = releases
        .filter(x => x.version.startsWith(`v${currentMajor}`))
        .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: 'base' }))[0]

      if (latestInCurrentMajor && gt(latestInCurrentMajor.version, current)) {
        latestVersion = latestInCurrentMajor.version
        updateAvailable = true
      } else {
        updateAvailable = false
      }
    }
  }

  return { updateAvailable, latestVersion, showNodeUnsupportedWarning }
}

export type NodeInstallPlan
  = | { action: 'install', reason: 'requested' | 'update', target: string, rebuild: boolean }
    | { action: 'too-old', target: string }
    | { action: 'unknown-version' }
    | { action: 'up-to-date' }

/**
 * What `hb-service update-node [version]` installs over the running `current`
 * version (whose native module ABI is `currentModules`): the `requested`
 * version when given (if it exists and is at least MIN_NODE_VERSION), else
 * the latest LTS when it is newer, else the newest release of the current
 * major when that is newer. `rebuild` says whether the ABI changes.
 */
export function pickNodeInstall(
  releases: NodeRelease[],
  { current, currentModules, requested }: { current: string, currentModules: string, requested?: string | null },
): NodeInstallPlan {
  const plan = (reason: 'requested' | 'update', release: NodeRelease): NodeInstallPlan => ({
    action: 'install',
    reason,
    target: release.version,
    rebuild: release.modules !== currentModules,
  })

  if (requested) {
    const wanted = releases.find(x => x.version.startsWith(`v${requested}`))
    if (!wanted) {
      return { action: 'unknown-version' }
    }
    if (!gte(wanted.version, MIN_NODE_VERSION)) {
      return { action: 'too-old', target: wanted.version }
    }
    return plan('requested', wanted)
  }

  const currentLts = releases.find(x => x.lts)
  if (gt(currentLts.version, current)) {
    return plan('update', currentLts)
  }

  const currentMajor = parse(current).major
  const latestVersion = releases.find(x => parse(x.version).major === currentMajor)
  if (gt(latestVersion.version, current)) {
    return plan('update', latestVersion)
  }

  return { action: 'up-to-date' }
}
