import type { NodeRelease } from '../../src/core/node-version/node-release.js'

import { describe, expect, it, vi } from 'vitest'

import {
  fetchNodeReleases,
  latestOfMajor,
  NODE_RELEASES_URL,
  pickNodeInstall,
  pickNodeUpdate,
} from '../../src/core/node-version/node-release.js'

// nodejs.org/dist/index.json is ordered newest first
const releases: NodeRelease[] = [
  { version: 'v26.1.0', lts: false, modules: '141' },
  { version: 'v26.0.0', lts: false, modules: '141' },
  { version: 'v24.2.0', lts: 'Krypton', modules: '137' },
  { version: 'v24.1.0', lts: 'Krypton', modules: '137' },
  { version: 'v22.13.0', lts: 'Jod', modules: '127' },
  { version: 'v22.12.0', lts: 'Jod', modules: '127' },
  { version: 'v20.19.0', lts: 'Iron', modules: '115' },
]

describe('fetchNodeReleases', () => {
  it('returns the release list from nodejs.org', async () => {
    const get = vi.fn(async () => ({ data: releases }))
    expect(await fetchNodeReleases(get)).toBe(releases)
    expect(get).toHaveBeenCalledWith(NODE_RELEASES_URL)
  })

  it('returns null for a response that is not a list', async () => {
    expect(await fetchNodeReleases(async () => ({ data: { error: 'nope' } }))).toBeNull()
  })
})

describe('latestOfMajor', () => {
  it('picks the newest release of a major only', () => {
    expect(latestOfMajor(releases, 24)?.version).toBe('v24.2.0')
    expect(latestOfMajor([{ version: 'v220.0.0', lts: false }, ...releases], 22)?.version).toBe('v22.13.0')
    expect(latestOfMajor(releases, 18)).toBeUndefined()
  })
})

describe('pickNodeUpdate', () => {
  const pick = (current: string, policy: 'all' | 'none' | 'major' = 'all', arch = 'x64') =>
    pickNodeUpdate(releases, { current, policy, arch })

  it('offers a newer v22 patch first', () => {
    expect(pick('v22.12.0')).toEqual({ updateAvailable: true, latestVersion: 'v22.13.0', showNodeUnsupportedWarning: false })
  })

  it('offers v24 on an up-to-date v22 when the architecture runs it', () => {
    expect(pick('v22.13.0')).toEqual({ updateAvailable: true, latestVersion: 'v24.2.0', showNodeUnsupportedWarning: false })
    expect(pick('v22.13.0', 'all', 'arm')).toEqual({ updateAvailable: false, latestVersion: 'v22.13.0', showNodeUnsupportedWarning: false })
  })

  it('offers only patch/minor updates on v24 and v26', () => {
    expect(pick('v24.1.0')).toMatchObject({ updateAvailable: true, latestVersion: 'v24.2.0' })
    expect(pick('v24.2.0')).toMatchObject({ updateAvailable: false, latestVersion: 'v24.2.0' })
    expect(pick('v26.0.0')).toMatchObject({ updateAvailable: true, latestVersion: 'v26.1.0' })
  })

  it('warns on an unsupported major instead of suggesting anything', () => {
    expect(pick('v20.19.0')).toEqual({ updateAvailable: false, latestVersion: 'v20.19.0', showNodeUnsupportedWarning: true })
    expect(pick('v25.0.0')).toMatchObject({ updateAvailable: false, showNodeUnsupportedWarning: true })
  })

  it('hides every update with the "none" policy', () => {
    expect(pick('v22.12.0', 'none')).toMatchObject({ updateAvailable: false, latestVersion: 'v22.13.0' })
  })

  it('keeps to the current major with the "major" policy', () => {
    // v22 -> v24 is a major upgrade; there is no newer v22, so nothing
    expect(pick('v22.13.0', 'major')).toMatchObject({ updateAvailable: false })
    // A newer v22 is still offered
    expect(pick('v22.12.0', 'major')).toMatchObject({ updateAvailable: true, latestVersion: 'v22.13.0' })
  })

  it('throws when the list has no release of the running major', () => {
    expect(() => pickNodeUpdate([], { current: 'v24.1.0', policy: 'all' })).toThrow()
  })
})

describe('pickNodeInstall', () => {
  const plan = (current: string, requested?: string, currentModules = '127') =>
    pickNodeInstall(releases, { current, currentModules, requested })

  it('installs a requested version, rebuilding when the module ABI changes', () => {
    expect(plan('v22.12.0', '24')).toEqual({ action: 'install', reason: 'requested', target: 'v24.2.0', rebuild: true })
    expect(plan('v22.12.0', '22.13')).toEqual({ action: 'install', reason: 'requested', target: 'v22.13.0', rebuild: false })
  })

  it('refuses a requested version below the supported minimum', () => {
    expect(plan('v22.12.0', '20')).toEqual({ action: 'too-old', target: 'v20.19.0' })
  })

  it('reports a requested version that does not exist', () => {
    expect(plan('v22.12.0', '19')).toEqual({ action: 'unknown-version' })
  })

  it('updates to the latest LTS when it is newer', () => {
    expect(plan('v22.13.0')).toEqual({ action: 'install', reason: 'update', target: 'v24.2.0', rebuild: true })
  })

  it('updates within the current major when it is ahead of LTS', () => {
    expect(plan('v26.0.0', undefined, '141')).toEqual({ action: 'install', reason: 'update', target: 'v26.1.0', rebuild: false })
  })

  it('is up to date on the newest release', () => {
    expect(plan('v26.1.0', undefined, '141')).toEqual({ action: 'up-to-date' })
  })
})
