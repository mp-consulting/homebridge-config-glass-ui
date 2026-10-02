import type { RestartState } from './restart-scope'

import { describe, expect, it, vi } from 'vitest'

import { detectConfigPlatformChanges, determineRestartType } from './restart-scope'

/**
 * Which restart a save needs.
 *
 * ⚠️ **This is the difference between reloading one plugin and dropping every
 * accessory in the house off the network for a minute.** A save that only
 * touched a plugin running on its own child bridge should restart that bridge
 * alone; anything that could affect Homebridge itself must restart the lot. The
 * eight checks below are the whole of that decision, and each one is a case
 * where guessing "child" would leave the change unapplied.
 */
describe('deciding what has to restart', () => {
  const bridged = (platform: string, username = '0E:11:22:33:44:55', extra: Record<string, any> = {}) => ({
    platform,
    name: platform,
    _bridge: { username },
    ...extra,
  })

  /**
   * Ask what a save would need.
   * @param options - the before and after
   * @param options.saved - the config as last saved
   * @param options.edited - the config in the editor now
   * @param options.bridges - the child bridges the save response reported
   * @param options.pending - whether homebridge is already awaiting a restart
   * @param options.queued - bridges already queued for restart
   * @param options.getChildBridges - the fallback read of the running bridges
   */
  async function restartFor(options: {
    saved: Record<string, any>
    edited?: Record<string, any>
    bridges?: any[]
    pending?: boolean
    queued?: any[]
    getChildBridges?: () => Promise<any[]>
  }) {
    const state: RestartState = {
      latestSavedConfig: options.saved as any,
      hbPendingRestart: options.pending ?? false,
      childBridgesToRestart: options.queued ?? [],
    }
    const onNothingChanged = vi.fn()
    const getChildBridges = vi.fn(options.getChildBridges ?? (async () => []))
    const decision = await determineRestartType(state, JSON.stringify(options.edited ?? options.saved, null, 4), {
      affectedBridges: options.bridges,
      getChildBridges,
      onNothingChanged,
    })
    return { decision, state, onNothingChanged, getChildBridges }
  }

  it('restarts everything when homebridge is already waiting to restart', async () => {
    // Whatever else changed, the pending change still has to be applied
    const saved = { bridge: { name: 'Homebridge' }, platforms: [bridged('example')] }

    expect((await restartFor({ saved, pending: true })).decision).toBe('full')
  })

  it('restarts nothing when the config is unchanged, and says so', async () => {
    const saved = { bridge: { name: 'Homebridge' }, platforms: [] }

    const { decision, onNothingChanged } = await restartFor({ saved })

    expect(decision).toBe('none')
    expect(onNothingChanged).toHaveBeenCalled()
  })

  it('still restarts when nothing changed but a bridge is already queued', async () => {
    // The queue comes from an earlier save in the same visit
    const saved = { bridge: { name: 'Homebridge' }, platforms: [] }

    expect((await restartFor({ saved, queued: [{ username: 'AA' }] })).decision).not.toBe('none')
  })

  it('restarts everything when a top level key is added', async () => {
    const saved = { bridge: { name: 'Homebridge' }, platforms: [bridged('example')] }

    expect((await restartFor({ saved, edited: { ...saved, mdns: { interface: 'eth0' } } })).decision).toBe('full')
  })

  it('restarts everything when a top level key is removed', async () => {
    const saved = { bridge: { name: 'Homebridge' }, ports: { start: 52100 }, platforms: [bridged('example')] }
    const edited = { bridge: { name: 'Homebridge' }, platforms: [bridged('example')] }

    expect((await restartFor({ saved, edited })).decision).toBe('full')
  })

  it('restarts everything when nothing runs on a child bridge', async () => {
    // There is nothing smaller to restart
    const saved = { bridge: { name: 'Homebridge' }, platforms: [{ platform: 'example', name: 'Example' }] }
    const edited = { bridge: { name: 'Homebridge' }, platforms: [{ platform: 'example', name: 'Changed' }] }

    expect((await restartFor({ saved, edited })).decision).toBe('full')
  })

  it('treats an empty bridge block as not being on a child bridge', async () => {
    const saved = { bridge: { name: 'Homebridge' }, platforms: [{ platform: 'example', _bridge: {} }] }
    const edited = { bridge: { name: 'Homebridge' }, platforms: [{ platform: 'example', _bridge: {}, name: 'Changed' }] }

    expect((await restartFor({ saved, edited })).decision).toBe('full')
  })

  it('restarts everything when a bridge setting changed', async () => {
    const saved = { bridge: { name: 'Homebridge', port: 51826 }, platforms: [bridged('example')] }
    const edited = { bridge: { name: 'Homebridge', port: 51827 }, platforms: [bridged('example')] }

    expect((await restartFor({ saved, edited })).decision).toBe('full')
  })

  it('restarts everything when a platform is added', async () => {
    const saved = { bridge: {}, platforms: [bridged('example')] }
    const edited = { bridge: {}, platforms: [bridged('example'), bridged('other', 'AA:BB:CC:DD:EE:FF')] }

    expect((await restartFor({ saved, edited })).decision).toBe('full')
  })

  it('restarts everything when an accessory is removed', async () => {
    const saved = { bridge: {}, platforms: [bridged('example')], accessories: [{ accessory: 'Light', _bridge: { username: 'AA' } }] }
    const edited = { bridge: {}, platforms: [bridged('example')], accessories: [] }

    expect((await restartFor({ saved, edited })).decision).toBe('full')
  })

  it('restarts everything when a plugin is moved onto a child bridge', async () => {
    // The bridge itself has to be created, which homebridge only does at startup
    const saved = { bridge: {}, platforms: [{ platform: 'example' }, bridged('other', 'AA:BB:CC:DD:EE:FF')] }
    const edited = { bridge: {}, platforms: [bridged('example'), bridged('other', 'AA:BB:CC:DD:EE:FF')] }

    expect((await restartFor({ saved, edited })).decision).toBe('full')
  })

  it('restarts everything when the ui own config changed', async () => {
    // Restarting the UI's own bridge would not reload the UI itself.
    //
    // ⚠️ Both bridges are supplied deliberately. Without them the lookup below
    // fails to find either one and answers 'full' for that reason instead, and
    // this case passes whether the ui-config check exists or not
    const saved = { bridge: {}, platforms: [bridged('config'), bridged('example', 'AA:BB:CC:DD:EE:FF')] }
    const edited = { bridge: {}, platforms: [bridged('config', '0E:11:22:33:44:55', { port: 8582 }), bridged('example', 'AA:BB:CC:DD:EE:FF')] }

    const { decision } = await restartFor({
      saved,
      edited,
      bridges: [
        { name: 'UI Bridge', username: '0E:11:22:33:44:55' },
        { name: 'Example Bridge', username: 'AA:BB:CC:DD:EE:FF' },
      ],
    })

    expect(decision).toBe('full')
  })

  it('restarts everything when a changed plugin is not on a bridge', async () => {
    const saved = { bridge: {}, platforms: [bridged('example'), { platform: 'other', name: 'Other' }] }
    const edited = { bridge: {}, platforms: [bridged('example'), { platform: 'other', name: 'Renamed' }] }

    expect((await restartFor({ saved, edited })).decision).toBe('full')
  })

  it('restarts just the child bridge of the plugin that changed', async () => {
    // The whole point of the exercise
    const saved = { bridge: {}, platforms: [bridged('example')] }
    const edited = { bridge: {}, platforms: [bridged('example', '0E:11:22:33:44:55', { debug: true })] }

    const { decision, state } = await restartFor({
      saved,
      edited,
      bridges: [{ name: 'Example Bridge', username: '0E:11:22:33:44:55' }],
    })

    expect(decision).toBe('child')
    expect(state.childBridgesToRestart).toEqual([
      { name: 'Example Bridge', username: '0E:11:22:33:44:55', matterSerialNumber: undefined },
    ])
  })

  it('matches the bridge whatever case the config wrote its username in', async () => {
    const saved = { bridge: {}, platforms: [bridged('example', '0e:11:22:33:44:55')] }
    const edited = { bridge: {}, platforms: [bridged('example', '0e:11:22:33:44:55', { debug: true })] }

    const { decision } = await restartFor({
      saved,
      edited,
      bridges: [{ name: 'Example Bridge', username: '0E:11:22:33:44:55' }],
    })

    expect(decision).toBe('child')
  })

  it('carries the matter serial number, so a matter bridge can be found', async () => {
    const saved = { bridge: {}, platforms: [bridged('example')] }
    const edited = { bridge: {}, platforms: [bridged('example', '0E:11:22:33:44:55', { debug: true })] }

    const { state } = await restartFor({
      saved,
      edited,
      bridges: [{ name: 'Example Bridge', username: '0E:11:22:33:44:55', matterSerialNumber: 'MTR-1' }],
    })

    expect(state.childBridgesToRestart[0].matterSerialNumber).toBe('MTR-1')
  })

  it('queues a bridge once, however many of its entries changed', async () => {
    const saved = { bridge: {}, platforms: [bridged('a'), bridged('b')] }
    const edited = {
      bridge: {},
      platforms: [bridged('a', '0E:11:22:33:44:55', { debug: true }), bridged('b', '0E:11:22:33:44:55', { debug: true })],
    }

    const { state } = await restartFor({ saved, edited, bridges: [{ name: 'Shared', username: '0E:11:22:33:44:55' }] })

    expect(state.childBridgesToRestart).toHaveLength(1)
  })

  it('restarts everything when the bridge it needs is not running', async () => {
    // Nothing to send the restart to
    const saved = { bridge: {}, platforms: [bridged('example')] }
    const edited = { bridge: {}, platforms: [bridged('example', '0E:11:22:33:44:55', { debug: true })] }

    expect((await restartFor({ saved, edited, bridges: [] })).decision).toBe('full')
  })

  it('restarts everything when a bridge block has no username', async () => {
    const saved = { bridge: {}, platforms: [{ platform: 'example', _bridge: { port: 52100 } }, bridged('other', 'AA:BB:CC:DD:EE:FF')] }
    const edited = { bridge: {}, platforms: [{ platform: 'example', _bridge: { port: 52101 } }, bridged('other', 'AA:BB:CC:DD:EE:FF')] }

    expect((await restartFor({ saved, edited })).decision).toBe('full')
  })

  it('asks the server for the bridges when the save did not report them', async () => {
    const saved = { bridge: {}, platforms: [bridged('example')] }
    const edited = { bridge: {}, platforms: [bridged('example', '0E:11:22:33:44:55', { debug: true })] }

    const { decision, getChildBridges } = await restartFor({
      saved,
      edited,
      getChildBridges: async () => [{ name: 'Example Bridge', username: '0E:11:22:33:44:55' }],
    })

    expect(decision).toBe('child')
    expect(getChildBridges).toHaveBeenCalled()
  })

  it('does not ask when the save already reported them', async () => {
    // Saves a round trip
    const saved = { bridge: {}, platforms: [bridged('example')] }
    const edited = { bridge: {}, platforms: [bridged('example', '0E:11:22:33:44:55', { debug: true })] }

    const { getChildBridges } = await restartFor({ saved, edited, bridges: [{ name: 'Example Bridge', username: '0E:11:22:33:44:55' }] })

    expect(getChildBridges).not.toHaveBeenCalled()
  })

  it('restarts everything when the bridge list cannot be read', async () => {
    // The safe answer: a full restart applies the change either way
    const saved = { bridge: {}, platforms: [bridged('example')] }
    const edited = { bridge: {}, platforms: [bridged('example', '0E:11:22:33:44:55', { debug: true })] }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { decision } = await restartFor({
      saved,
      edited,
      getChildBridges: async () => {
        throw new Error('server unavailable')
      },
    })

    expect(decision).toBe('full')
    vi.restoreAllMocks()
  })
})

/**
 * Whether a save needs the whole service restarted, or just Homebridge.
 *
 * ⚠️ **Changing the UI's own config entry needs the service restarted, not just
 * Homebridge.** The UI runs inside that service; restarting Homebridge alone
 * leaves the UI running on its old port, settings and SSL certificate.
 */
describe('deciding whether the service itself has to restart', () => {
  const serviceRestartFor = (saved: Record<string, any>, edited: Record<string, any>) =>
    detectConfigPlatformChanges(saved as any, JSON.stringify(edited, null, 4))

  const ui = (overrides: Record<string, any> = {}) => ({ platform: 'config', name: 'Config', port: 8581, ...overrides })

  it('says yes when a ui setting changed', () => {
    expect(serviceRestartFor({ platforms: [ui()] }, { platforms: [ui({ port: 8582 })] })).toBe(true)
  })

  it('says yes when the ui entry was added', () => {
    expect(serviceRestartFor({ platforms: [] }, { platforms: [ui()] })).toBe(true)
  })

  it('says yes when the ui entry was removed', () => {
    // Which stops the UI coming back at all, so the service has to restart
    expect(serviceRestartFor({ platforms: [ui()] }, { platforms: [] })).toBe(true)
  })

  it('says no when the ui entry is untouched', () => {
    expect(serviceRestartFor(
      { platforms: [ui(), { platform: 'other', name: 'Other' }] },
      { platforms: [ui(), { platform: 'other', name: 'Renamed' }] },
    )).toBe(false)
  })

  it('says no when there is no ui entry either side', () => {
    expect(serviceRestartFor({ platforms: [] }, { platforms: [] })).toBe(false)
  })

  it('says no when the config has no platforms at all', () => {
    expect(serviceRestartFor({}, {})).toBe(false)
  })

  it('says no when the edited config cannot be read', () => {
    // ⚠️ Deliberately the *less* disruptive answer: restarting the whole service
    // tears down the UI the user is looking at, so an unreadable config falls
    // back to restarting Homebridge alone
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(detectConfigPlatformChanges({ platforms: [ui()] } as any, '{ not json')).toBe(false)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
