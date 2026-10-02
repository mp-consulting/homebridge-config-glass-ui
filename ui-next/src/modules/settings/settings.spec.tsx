import type { SettingsFieldValues, SettingsPage } from '@/modules/settings/settings-page.store'
import type { FakeApi, FakeOpenModal, FakeToast } from '@/testing'
import type { Mock } from 'vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Confirm } from '@/core/components/confirm/Confirm'
import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import * as toastModule from '@/core/ui/toast'
import { AccessoryControlLists } from '@/modules/settings/accessory-control-lists/AccessoryControlLists'
import { Backup } from '@/modules/settings/backup/Backup'
import { PortOverviewModal } from '@/modules/settings/port-overview-modal/PortOverviewModal'
import { RemoveAllAccessories } from '@/modules/settings/remove-all-accessories/RemoveAllAccessories'
import { RemoveBridgeAccessories } from '@/modules/settings/remove-bridge-accessories/RemoveBridgeAccessories'
import { RemoveIndividualAccessories } from '@/modules/settings/remove-individual-accessories/RemoveIndividualAccessories'
import { ResetAllBridges } from '@/modules/settings/reset-all-bridges/ResetAllBridges'
import { ResetIndividualBridges } from '@/modules/settings/reset-individual-bridges/ResetIndividualBridges'
import { SelectNetworkInterfaces } from '@/modules/settings/select-network-interfaces/SelectNetworkInterfaces'
import { createSettingsPage } from '@/modules/settings/settings-page.store'
import { getItemsContent, getSectionContent } from '@/modules/settings/settings-search'
import { SslSettingsModal } from '@/modules/settings/ssl-settings-modal/SslSettingsModal'
import { Wallpaper } from '@/modules/settings/wallpaper/Wallpaper'
import { fakeApi, locationReload, makeSettingsState } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const modal = modalModule as unknown as FakeOpenModal
const toast = (toastModule as unknown as { toast: FakeToast }).toast

/**
 * The settings page has no save button: every control writes as soon as it
 * settles. That makes a mis-wired control silent - the user changes one thing
 * and something else is written, with nothing on screen to say so.
 *
 * These specs pin each control to the request it makes. Values are put in the
 * way the sections put them in (`page.change`), then the debounce and the
 * coalescing window are advanced by hand.
 */
describe('the settings page', () => {
  let api: FakeApi
  let page: SettingsPage
  let navigate: Mock
  // Stubbed rather than faked at the socket level: the page only asks whether a
  // terminal session is open
  let terminal: { hasActiveSession: () => boolean, destroyPersistentSession: Mock }
  let showRestartToast: ReturnType<typeof vi.spyOn>

  /** Longest debounce (1500ms) plus the 150ms coalescing window, with room. */
  const SETTLE_MS = 2000

  interface CreateOptions {
    /** The locale the app booted with. */
    locale?: string
    /** The browser language, for the 'auto' cases. */
    browser?: string
    /** Running as an installed app. */
    isPwa?: boolean
    /**
     * A chance to make a startup read fail. It has to happen here rather than
     * after the call: the reads go out straight away.
     */
    breakApi?: (api: FakeApi) => void
  }

  /**
   * Build the settings page.
   * @param env - environment overrides for the settings store
   * @param options - how to build it
   */
  function create(env: Record<string, any> = {}, options: CreateOptions = {}): SettingsPage {
    page?.destroy()
    api = fakeApi()
      .respond('get', '/platform-tools/hb-service/homebridge-startup-settings', { HOMEBRIDGE_DEBUG: false, HOMEBRIDGE_KEEP_ORPHANS: false, HOMEBRIDGE_INSECURE: true, ENV_DEBUG: '', ENV_NODE_OPTIONS: '' })
      .respond('get', '/server/network-interfaces/system', [])
      .respond('get', '/server/network-interfaces/bridge', [])
      .respond('get', '/server/mdns-advertiser', { advertiser: 'ciao' })
      .respond('get', '/server/port', { port: 51826 })
      .respond('get', '/server/ports', { start: 52100, end: 52200 })
      .respond('get', '/config-editor/matter', { enabled: true, port: 5540 })
      .respond('get', '/config-editor/matter/ports', { start: 5550, end: 5560 })
      .respond('get', '/config-editor/hap', { enabled: true, externalsOnly: false, disableIdentifyingMaterial: false })
      .respond('get', '/server/port/new/matter', { port: 5541 })

    options.breakApi?.(api)

    useSettingsStore.setState(makeSettingsState({ env }))
    terminal = { hasActiveSession: () => false, destroyPersistentSession: vi.fn(async () => {}) }
    navigate = vi.fn()

    page = createSettingsPage({
      navigate,
      terminal,
      isPwa: options.isPwa,
      bootLocale: options.locale ?? 'en',
      browserLang: () => ({ lang: options.browser, culture: options.browser }),
    })
    void page.init()
    return page
  }

  const state = () => page.store.getState()
  const values = () => state().values
  const saving = (key: string) => !!(state().saving as Record<string, boolean>)[key]
  const invalid = (key: string) => !!(state().invalid as Record<string, boolean>)[key]

  /** Let the awaits inside a save settle, without advancing any timers. */
  async function settleMicrotasks() {
    for (let tick = 0; tick < 12; tick += 1) {
      await Promise.resolve()
    }
  }

  /**
   * Change a control the way the page does, then let it settle.
   * @param field - the field
   * @param value - the new value
   */
  async function change(field: keyof SettingsFieldValues, value: unknown): Promise<void> {
    api.clearCalls()
    page.change(field, value as never)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
  }

  /** The body of the single coalesced PATCH to the ui config. */
  function uiPatch(): Record<string, any> | undefined {
    return api.lastCall('patch', '/config-editor/ui')?.body
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    modal.opened.length = 0
    toast.shown.length = 0
    resetSettingsStore()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    showRestartToast = vi.spyOn(settingsActions, 'showRestartToast').mockImplementation(() => {})
    // The real one switches the test's own language
    vi.spyOn(settingsActions, 'setLang').mockImplementation((lang: string) => {
      window.localStorage.setItem('uix.lang', lang)
    })
    create()
    // Let the parallel startup reads resolve before a spec touches anything
    await vi.advanceTimersByTimeAsync(0)
  })

  afterEach(() => {
    page.destroy()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('settings stored in the ui config', () => {
    it.each([
      ['uiLang', 'de', 'lang', 'de'],
      ['uiTheme', 'teal', 'theme', 'teal'],
      ['uiTemp', 'f', 'tempUnits', 'f'],
      ['uiMenu', 'freeze', 'menuMode', 'freeze'],
      ['hbPackage', '/usr/lib/homebridge', 'homebridgePackagePath', '/usr/lib/homebridge'],
      ['uiHost', '192.168.1.10', 'host', '192.168.1.10'],
      ['uiProxyHost', 'proxy.local', 'proxyHost', 'proxy.local'],
      ['uiTerminalBufferSize', 5000, 'terminal.bufferSize', 5000],
      ['uiAccDebug', true, 'accessoryControl.debug', true],
      ['hbLinuxShutdown', '/sbin/poweroff', 'linux.shutdown', '/sbin/poweroff'],
      ['hbLinuxRestart', '/sbin/reboot', 'linux.restart', '/sbin/reboot'],
      ['uiTempFile', '/sys/class/thermal/thermal_zone0/temp', 'temp', '/sys/class/thermal/thermal_zone0/temp'],
      ['enableMdnsAdvertise', false, 'enableMdnsAdvertise', false],
      ['uiTerminalFontSize', 14, 'terminal.fontSize', 14],
      ['uiGlass', false, 'glassMode', false],
    ] as const)('%s writes %s', async (field, value, key, expected) => {
      await change(field, value)

      expect(uiPatch()).toMatchObject({ [key]: expected })
    })

    it('turns the metrics switch into the disable flag the server stores', async () => {
      // The switch reads "monitoring on", the config key means the opposite
      await change('uiMetrics', false)

      expect(uiPatch()).toMatchObject({ disableServerMetricsMonitoring: true })
    })

    it('turns the login switch into an auth mode', async () => {
      await change('uiAuth', false)

      expect(uiPatch()).toMatchObject({ auth: 'none' })
    })

    it('sends one request when several settings settle together', async () => {
      api.clearCalls()
      page.change('uiLang', 'fr')
      page.change('uiTemp', 'f')
      page.change('uiAccDebug', true)
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      // The coalescing window is what stops three quick changes becoming
      // three writes to the same file
      expect(api.callsTo('patch', '/config-editor/ui')).toHaveLength(1)
      expect(uiPatch()).toMatchObject({ 'lang': 'fr', 'tempUnits': 'f', 'accessoryControl.debug': true })
    })

    it('saves nothing for a change that has not settled yet', async () => {
      api.clearCalls()
      page.change('hbPackage', '/usr/lib/homebridge')
      await vi.advanceTimersByTimeAsync(1000)

      expect(api.callsTo('patch')).toEqual([])
    })

    it('drops a change still settling when the page goes away', async () => {
      // takeUntilDestroyed: leaving the page mid-edit does not write the half-typed value
      api.clearCalls()
      page.change('hbPackage', '/usr/lib/home')
      page.destroy()
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      expect(api.callsTo('patch')).toEqual([])
    })
  })

  /**
   * Changing the language has to reload the page.
   *
   * ⚠️ Translated text switches straight away, but the locale every date, time
   * and number formatter reads is decided once, when the app loads. Without the
   * reload the page keeps formatting for the previous language until the user
   * happens to refresh.
   *
   * The reload must come **after** the choice has been saved, and must not happen
   * when the formats would not change anyway.
   */
  describe('changing the language', () => {
    async function open(options: { locale: string, browser?: string }) {
      window.localStorage.clear()
      create({}, options)
      await vi.advanceTimersByTimeAsync(0)
      locationReload.mockClear()
    }

    it('reloads so dates and numbers follow the new language', async () => {
      await open({ locale: 'en' })

      await change('uiLang', 'de')

      expect(locationReload).toHaveBeenCalled()
    })

    it('saves the choice before reloading it away', async () => {
      // A reload with the write still in flight loses the language the user just picked
      await open({ locale: 'en' })

      await change('uiLang', 'de')

      expect(uiPatch()).toMatchObject({ lang: 'de' })
      expect(vi.mocked(api.patch).mock.invocationCallOrder[0])
        .toBeLessThan(locationReload.mock.invocationCallOrder[0])
    })

    it('does not reload when the save failed', async () => {
      // The old language is still the saved one, and the error toast would be wiped off the screen
      await open({ locale: 'en' })
      api.fail('patch', '/config-editor/ui', new Error('config not writable'))

      await change('uiLang', 'de')

      expect(locationReload).not.toHaveBeenCalled()
    })

    it('does not reload when both languages format the same way', async () => {
      // Portuguese and Brazilian portuguese share one locale
      await open({ locale: 'pt' })

      await change('uiLang', 'pt-BR')

      expect(locationReload).not.toHaveBeenCalled()
    })

    it('does not reload when auto lands on the language already in use', async () => {
      await open({ locale: 'de', browser: 'de' })

      await change('uiLang', 'auto')

      expect(locationReload).not.toHaveBeenCalled()
    })

    it('reloads when auto lands on a different language', async () => {
      await open({ locale: 'de', browser: 'fr' })

      await change('uiLang', 'auto')

      expect(locationReload).toHaveBeenCalled()
    })

    it('still tells the settings store, so the ui text changes at once', async () => {
      await open({ locale: 'en' })

      await change('uiLang', 'de')

      expect(settingsActions.setLang).toHaveBeenCalledWith('de')
    })
  })

  describe('settings with their own endpoint', () => {
    it('sends the homebridge name to the server endpoint', async () => {
      await change('hbName', 'Front Room')

      expect(api.lastCall('put', '/server/name')?.body).toEqual({ name: 'Front Room' })
    })

    it('sends the mdns advertiser', async () => {
      await change('hbMDns', 'avahi')

      expect(api.lastCall('put', '/server/mdns-advertiser')?.body).toEqual({ advertiser: 'avahi' })
    })

    it('sends the homebridge port', async () => {
      await change('hbPort', 51830)

      expect(api.lastCall('put', '/server/port')?.body).toEqual({ port: 51830 })
    })

    it('sends the homebridge port range', async () => {
      await change('hbStartPort', 52000)

      expect(api.lastCall('put', '/server/ports')?.body).toMatchObject({ start: 52000 })
    })
  })

  /**
   * ⚠️ **Some of these settings can make the UI unreachable from the very window
   * you are changing them in.** Installed as a home-screen app there is no address
   * bar to type the new one into.
   */
  describe('the rows the page will not let you change', () => {
    it.each([
      ['the ui port', 'uiPort'],
      ['the host it binds to', 'uiHost'],
      ['the proxy host', 'uiProxyHost'],
      ['the certificate mode', 'uiSslType'],
    ] as const)('locks %s in an installed app', async (_case, field) => {
      create({}, { isPwa: true })
      await vi.advanceTimersByTimeAsync(0)

      expect(state().disabled[field]).toBe(true)
    })

    it('leaves them alone in an ordinary browser tab', () => {
      expect(state().disabled.uiPort).toBeFalsy()
      expect(state().disabled.uiHost).toBeFalsy()
    })

    it('locks the certificate mode on the raspberry pi image', async () => {
      // The image manages its own certificates, so a change here would be undone
      create({ runningOnRaspbianImage: true })
      await vi.advanceTimersByTimeAsync(0)

      expect(state().disabled.uiSslType).toBe(true)
    })

    it('locks the terminal colours when the whole ui is dark', async () => {
      // A light terminal inside a dark page is the one combination that is not offered
      create()
      useSettingsStore.setState({ actualLightingMode: 'dark' })
      await vi.advanceTimersByTimeAsync(0)

      expect(state().disabled.uiTerminalLightingMode).toBe(true)
      expect(values().uiTerminalLightingMode).toBe('dark')
    })
  })

  /**
   * ⚠️ **A bad value is deleted, not just ignored.** Left in place it would be
   * read again on every load, and the box would keep showing the default while
   * the file said something else.
   */
  describe('stored values it refuses to trust', () => {
    function deleted(): string[] {
      return api.callsTo('delete').map(call => call.url)
    }

    it.each([
      ['a font size below the smallest offered', { fontSize: 8 }, 'terminal.fontSize'],
      ['a font size above the largest offered', { fontSize: 24 }, 'terminal.fontSize'],
      ['a font weight that is not one of the choices', { fontWeight: '450' }, 'terminal.fontWeight'],
    ])('deletes %s', async (_case, terminal, key) => {
      create({ terminal })
      await vi.advanceTimersByTimeAsync(0)

      expect(deleted()).toContain(`/config-editor/ui/${key}`)
    })

    it.each([
      ['the font size', { fontSize: 8 }, 'uiTerminalFontSize', 13],
      ['the font weight', { fontWeight: '450' }, 'uiTerminalFontWeight', '400'],
    ] as const)('falls back to the default for %s', async (_case, terminal, field, expected) => {
      create({ terminal })
      await vi.advanceTimersByTimeAsync(0)

      expect(values()[field]).toBe(expected)
    })

    it.each([
      ['a font size inside the range', { fontSize: 16 }],
      ['a listed font weight', { fontWeight: 'bold' }],
      ['nothing stored at all', {}],
    ])('leaves %s alone', async (_case, terminal) => {
      create({ terminal })
      await vi.advanceTimersByTimeAsync(0)

      expect(deleted()).toEqual([])
    })

    it('keeps the stored value when it is a good one', async () => {
      create({ terminal: { fontSize: 16, fontWeight: 'bold' } })
      await vi.advanceTimersByTimeAsync(0)

      expect(values().uiTerminalFontSize).toBe(16)
      expect(values().uiTerminalFontWeight).toBe('bold')
    })

    it('carries on when the delete itself fails', async () => {
      // ⚠️ Deliberately quiet: the user did not ask for this
      create({ terminal: { fontSize: 8 } }, {
        breakApi: broken => broken.fail('delete', '/config-editor/ui/terminal.fontSize', new Error('config not writable')),
      })
      await vi.advanceTimersByTimeAsync(0)

      expect(toast.error).not.toHaveBeenCalled()
      expect(values().uiTerminalFontSize).toBe(13)
      expect(state().loading).toBe(false)
    })
  })

  describe('startup settings', () => {
    it.each([
      ['hbDebug', 'HOMEBRIDGE_DEBUG'],
      ['hbInsecure', 'HOMEBRIDGE_INSECURE'],
      ['hbKeep', 'HOMEBRIDGE_KEEP_ORPHANS'],
    ] as const)('%s writes the whole startup block', async (field, key) => {
      await change(field, true)

      const body = api.lastCall('put', '/platform-tools/hb-service/homebridge-startup-settings')?.body
      // The endpoint replaces the block wholesale, so every field has to be
      // sent or the others are wiped
      expect(body).toMatchObject({ [key]: true })
      expect(Object.keys(body!)).toEqual(expect.arrayContaining(['HOMEBRIDGE_DEBUG', 'HOMEBRIDGE_INSECURE', 'HOMEBRIDGE_KEEP_ORPHANS', 'ENV_DEBUG', 'ENV_NODE_OPTIONS']))
    })

    it('remembers keep-orphans for the plugin pages', async () => {
      const setKeepOrphans = vi.spyOn(settingsActions, 'setKeepOrphans')

      await change('hbKeep', true)

      expect(setKeepOrphans).toHaveBeenCalledWith(true)
    })

    it.each([
      ['hbDebug', true],
      ['hbEnvDebug', 'homebridge*'],
      ['uiMetrics', false],
      ['uiTempFile', '/tmp/temp'],
      ['hbLinuxShutdown', '/sbin/poweroff'],
    ] as const)('%s asks for a full service restart', async (field, value) => {
      await change(field, value)
      await vi.advanceTimersByTimeAsync(2000)

      // These only take effect when the whole service restarts
      expect(api.callsTo('put', '/platform-tools/hb-service/set-full-service-restart-flag')).toHaveLength(1)
    })

    it('wires none of them up when they cannot be read', async () => {
      create({}, { breakApi: broken => broken.fail('get', '/platform-tools/hb-service/homebridge-startup-settings', new Error('server unavailable')) })
      await vi.advanceTimersByTimeAsync(0)

      expect(toast.error).toHaveBeenCalled()
      await change('hbDebug', true)
      expect(api.callsTo('put', '/platform-tools/hb-service/homebridge-startup-settings')).toEqual([])
    })
  })

  describe('refusing values that would break things', () => {
    it.each([
      ['an empty homebridge name', ''],
      ['a homebridge name with a leading space', ' Front Room'],
      ['a homebridge name of punctuation', '***'],
    ])('rejects %s', async (_case, value) => {
      await change('hbName', value)

      // HAP refuses these outright, so the accessory would never publish
      expect(api.callsTo('put', '/server/name')).toHaveLength(0)
      expect(invalid('hbName')).toBe(true)
    })

    it.each([
      ['below the reserved range', 1024],
      ['above the maximum', 65534],
      ['not a whole number', 8581.5],
    ])('rejects a ui port %s', async (_case, port) => {
      await change('uiPort', port)

      expect(uiPatch()?.port).toBeUndefined()
      expect(invalid('uiPort')).toBe(true)
    })

    it('refuses to put the ui on the homebridge port', async () => {
      // They are two servers; sharing a port means one of them fails to bind
      await change('uiPort', values().hbPort)

      expect(uiPatch()?.port).toBeUndefined()
      expect(invalid('uiPort')).toBe(true)
    })

    it('refuses a homebridge port range that ends before it starts', async () => {
      page.change('hbEndPort', 52000)
      await vi.advanceTimersByTimeAsync(SETTLE_MS)
      await change('hbStartPort', 53000)

      expect(api.callsTo('put', '/server/ports')).toHaveLength(0)
    })

    it('refuses to put homebridge on the ui port', async () => {
      await change('hbPort', values().uiPort)

      expect(api.callsTo('put', '/server/port')).toHaveLength(0)
      expect(invalid('hbPort')).toBe(true)
    })

    it.each([
      ['the start', 'hbStartPort'],
      ['the end', 'hbEndPort'],
    ] as const)('rejects %s of the child bridge range outside the usable ports', async (_case, field) => {
      // Below 1025 is reserved and above 65533 does not exist
      for (const port of [1024, 65534, 52000.5]) {
        await change(field, port)

        expect(api.callsTo('put', '/server/ports')).toHaveLength(0)
        expect(invalid(field)).toBe(true)
      }
    })

    it('refuses an end port that is not above the start', async () => {
      // Equal is as broken as inverted: the range has to hold at least one port
      page.change('hbStartPort', 52000)
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      await change('hbEndPort', 52000)

      expect(api.callsTo('put', '/server/ports')).toHaveLength(0)
      expect(invalid('hbEndPort')).toBe(true)
    })

    it.each([
      ['a terminal buffer size', 'uiTerminalBufferSize'],
      ['a log truncate size', 'hbLogTruncate'],
    ] as const)('rejects %s that is negative or fractional', async (_case, field) => {
      for (const value of [-1, 10.5]) {
        await change(field, value)

        expect(api.callsTo('patch', '/config-editor/ui')).toHaveLength(0)
        expect(invalid(field)).toBe(true)
      }
    })

    it.each([5353, 8080, 8443])('refuses the reserved matter port %s', async (port) => {
      await change('matterPort', port)

      expect(api.callsTo('put', '/config-editor/matter')).toHaveLength(0)
      expect(invalid('matterPort')).toBe(true)
    })

    it.each([
      ['too few fields', '* * *'],
      ['a letter in a field', '0 4 * * MON'],
    ])('rejects a restart schedule with %s', async (_case, cron) => {
      await change('scheduledRestartCron', cron)

      expect(uiPatch()?.scheduledRestartCron).toBeUndefined()
      expect(invalid('scheduledRestartCron')).toBe(true)
    })

    it('accepts a valid restart schedule', async () => {
      await change('scheduledRestartCron', '0 4 * * *')

      expect(uiPatch()).toMatchObject({ scheduledRestartCron: '0 4 * * *' })
    })

    it('clears the schedule when the field is emptied', async () => {
      await change('scheduledRestartCron', '')

      expect(uiPatch()).toMatchObject({ scheduledRestartCron: null })
    })

    it('rejects a log size below the unlimited marker', async () => {
      await change('hbLogSize', -2)

      expect(uiPatch()?.['log.maxSize']).toBeUndefined()
    })

    it('clears the truncate size when the log is set to unlimited', async () => {
      await change('hbLogSize', -1)

      // A truncate size means nothing without a maximum. The clear is awaited
      // before the size is written, so the two arrive as separate requests
      const written = Object.assign({}, ...api.callsTo('patch', '/config-editor/ui').map(call => call.body))
      expect(written).toMatchObject({ 'log.maxSize': -1, 'log.truncateSize': null })
    })
  })

  describe('the session timeout', () => {
    it('adds the three fields up into seconds', async () => {
      page.change('uiSessionTimeoutHours', 2)
      page.change('uiSessionTimeoutMinutes', 30)
      await change('uiSessionTimeoutDays', 1)

      expect(uiPatch()).toMatchObject({ sessionTimeout: 95400 })
    })

    it('refuses a timeout shorter than ten minutes', async () => {
      page.change('uiSessionTimeoutDays', 0)
      page.change('uiSessionTimeoutHours', 0)
      await change('uiSessionTimeoutMinutes', 5)

      // Anything shorter logs the user out mid-task
      expect(uiPatch()?.sessionTimeout).toBeUndefined()
      expect(invalid('uiSessionTimeoutMinutes')).toBe(true)
    })

    it.each([
      ['more days than a year', 'uiSessionTimeoutDays', 400],
      ['more hours than a day', 'uiSessionTimeoutHours', 24],
      ['more minutes than an hour', 'uiSessionTimeoutMinutes', 60],
      ['part of a day', 'uiSessionTimeoutDays', 1.5],
      ['a negative number of hours', 'uiSessionTimeoutHours', -1],
    ] as const)('refuses %s', async (_case, field, value) => {
      // Each field carries its own units, so 90 minutes has to be entered as an
      // hour and a half rather than overflowing into the next field
      await change(field, value)

      expect(uiPatch()?.sessionTimeout).toBeUndefined()
      expect(invalid(field)).toBe(true)
    })

    it.each([
      ['a year of days', 'uiSessionTimeoutDays', 365, 31536000],
      ['the last hour of a day', 'uiSessionTimeoutHours', 23, 82800],
      ['the last minute of an hour', 'uiSessionTimeoutMinutes', 59, 3540],
    ] as const)('accepts %s', async (_case, field, value, expected) => {
      // The top of each field's range is a valid entry, not one past it
      page.patch('uiSessionTimeoutDays', 0)
      page.patch('uiSessionTimeoutHours', 0)
      page.patch('uiSessionTimeoutMinutes', 0)

      await change(field, value)

      expect(uiPatch()).toMatchObject({ sessionTimeout: expected })
    })

    it('treats an emptied field as zero', async () => {
      // Clearing the days box should mean "no days", not "no timeout"
      page.change('uiSessionTimeoutDays', null)
      page.change('uiSessionTimeoutMinutes', 0)
      await change('uiSessionTimeoutHours', 12)

      expect(uiPatch()).toMatchObject({ sessionTimeout: 43200 })
      expect(invalid('uiSessionTimeoutDays')).toBe(false)
    })

    it('puts the zero back in an emptied box', async () => {
      page.patch('uiSessionTimeoutDays', null)

      await change('uiSessionTimeoutHours', 12)

      expect(values().uiSessionTimeoutDays).toBe(0)
    })

    it('asks for a restart, because sessions are minted at startup', async () => {
      await change('uiSessionTimeoutHours', 12)
      await vi.advanceTimersByTimeAsync(1000)

      expect(showRestartToast).toHaveBeenCalled()
    })

    it('saves the inactivity setting on its own', async () => {
      const setItem = vi.spyOn(settingsActions, 'setItem')

      await change('uiSessionTimeoutInactivityBased', true)

      expect(uiPatch()).toMatchObject({ sessionTimeoutInactivityBased: true })
      expect(setItem).toHaveBeenCalledWith('sessionTimeoutInactivityBased', true)
    })
  })

  /**
   * ⚠️ **There is no save button, so the error toast and the spinner stopping are
   * the only things telling the user a setting did not stick.** Every control has
   * to let the failure reach its own catch block.
   */
  describe('when a write fails', () => {
    const UI_CONFIG = { method: 'patch', url: '/config-editor/ui' }
    const STARTUP = { method: 'put', url: '/platform-tools/hb-service/homebridge-startup-settings' }

    /** Every control, the write it makes, and the spinner it owns. */
    const CONTROLS: Array<{ field: keyof SettingsFieldValues, value: unknown, saving: string, method: string, url: string }> = [
      { field: 'uiTheme', value: 'teal', saving: 'uiTheme', ...UI_CONFIG },
      { field: 'uiLight', value: 'dark', saving: 'uiLight', ...UI_CONFIG },
      { field: 'uiMenu', value: 'freeze', saving: 'uiMenu', ...UI_CONFIG },
      { field: 'uiTemp', value: 'f', saving: 'uiTemp', ...UI_CONFIG },
      { field: 'uiGlass', value: false, saving: 'uiGlass', ...UI_CONFIG },
      { field: 'uiTerminalPersistence', value: true, saving: 'uiTerminalPersistence', ...UI_CONFIG },
      { field: 'uiTerminalHideWarning', value: true, saving: 'uiTerminalHideWarning', ...UI_CONFIG },
      { field: 'uiTerminalBufferSize', value: 5000, saving: 'uiTerminalBufferSize', ...UI_CONFIG },
      { field: 'uiTerminalFontSize', value: 14, saving: 'uiTerminalFontSize', ...UI_CONFIG },
      { field: 'uiTerminalFontWeight', value: '600', saving: 'uiTerminalFontWeight', ...UI_CONFIG },
      { field: 'uiTerminalLightingMode', value: 'light', saving: 'uiTerminalLightingMode', ...UI_CONFIG },
      { field: 'hbLogSize', value: 100, saving: 'hbLogSize', ...UI_CONFIG },
      { field: 'hbLogTruncate', value: 50, saving: 'hbLogTruncate', ...UI_CONFIG },
      { field: 'enableMdnsAdvertise', value: true, saving: 'enableMdnsAdvertise', ...UI_CONFIG },
      { field: 'uiPort', value: 8582, saving: 'uiPort', ...UI_CONFIG },
      { field: 'uiAuth', value: false, saving: 'uiAuth', ...UI_CONFIG },
      { field: 'uiSessionTimeoutInactivityBased', value: true, saving: 'uiSessionTimeoutInactivityBased', ...UI_CONFIG },
      { field: 'uiSessionTimeoutHours', value: 12, saving: 'uiSessionTimeout', ...UI_CONFIG },
      { field: 'uiHost', value: '192.168.1.5', saving: 'uiHost', ...UI_CONFIG },
      { field: 'uiProxyHost', value: 'proxy.local', saving: 'uiProxyHost', ...UI_CONFIG },
      { field: 'hbPackage', value: '/usr/lib/homebridge', saving: 'hbPackage', ...UI_CONFIG },
      { field: 'uiMetrics', value: false, saving: 'uiMetrics', ...UI_CONFIG },
      { field: 'uiAccDebug', value: true, saving: 'uiAccDebug', ...UI_CONFIG },
      { field: 'uiTempFile', value: '/tmp/temp', saving: 'uiTempFile', ...UI_CONFIG },
      { field: 'hbLinuxShutdown', value: '/sbin/poweroff', saving: 'hbLinuxShutdown', ...UI_CONFIG },
      { field: 'hbLinuxRestart', value: '/sbin/reboot', saving: 'hbLinuxRestart', ...UI_CONFIG },
      { field: 'scheduledRestartCron', value: '0 4 * * *', saving: 'scheduledRestartCron', ...UI_CONFIG },
      { field: 'hbName', value: 'Front Room', saving: 'hbName', method: 'put', url: '/server/name' },
      { field: 'hbMDns', value: 'avahi', saving: 'hbMDns', method: 'put', url: '/server/mdns-advertiser' },
      { field: 'hbPort', value: 51830, saving: 'hbPort', method: 'put', url: '/server/port' },
      { field: 'hbStartPort', value: 52000, saving: 'hbStartPort', method: 'put', url: '/server/ports' },
      { field: 'hbEndPort', value: 52500, saving: 'hbEndPort', method: 'put', url: '/server/ports' },
      { field: 'hbDebug', value: true, saving: 'hbDebug', ...STARTUP },
      { field: 'hbInsecure', value: false, saving: 'hbInsecure', ...STARTUP },
      { field: 'hbKeep', value: true, saving: 'hbKeep', ...STARTUP },
      { field: 'hbEnvDebug', value: 'homebridge*', saving: 'hbEnvDebug', ...STARTUP },
      { field: 'hbEnvNode', value: '--max-old-space-size=256', saving: 'hbEnvNode', ...STARTUP },
    ]

    beforeEach(() => {
      vi.mocked(console.error).mockClear()
      showRestartToast.mockClear()
      toast.error.mockClear()
      locationReload.mockClear()
    })

    it.each(CONTROLS)('tells the user $field could not be saved', async ({ field, value, method, url, saving: savingKey }) => {
      api.fail(method as any, url, new Error('config not writable'))

      await change(field, value)
      // Past the one-second delay the success path uses, so a spinner cleared
      // there rather than in the catch would look the same as one cleared here
      await vi.advanceTimersByTimeAsync(2000)

      expect(toast.error).toHaveBeenCalledOnce()
      expect(console.error).toHaveBeenCalled()
      expect(saving(savingKey)).toBe(false)
    })

    it.each(CONTROLS)('does not ask for a restart when $field fails', async ({ field, value, method, url }) => {
      // A restart applies what is on disk, and the failed write is not on disk
      api.fail(method as any, url, new Error('config not writable'))

      await change(field, value)
      await vi.advanceTimersByTimeAsync(2000)

      expect(showRestartToast).not.toHaveBeenCalled()
    })

    it('does not reload the page when the menu mode fails to save', async () => {
      // ⚠️ The reload is how the frozen menu takes effect, and it wipes the error toast
      api.fail('patch', '/config-editor/ui', new Error('config not writable'))

      await change('uiMenu', 'freeze')

      expect(locationReload).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledOnce()
    })

    it.each([
      ['hbStartPort', 52000],
      ['hbEndPort', 52500],
    ] as const)('marks %s as unsaved when the range write fails', async (field, value) => {
      // The value in the box is not the value in use
      api.fail('put', '/server/ports', new Error('config not writable'))

      await change(field, value)

      expect(invalid(field)).toBe(true)
    })

    it('leaves the log size marked invalid when its write fails', async () => {
      api.fail('patch', '/config-editor/ui', new Error('config not writable'))
      page.setInvalid('hbLogSize', true)

      await change('hbLogSize', 100)

      expect(invalid('hbLogSize')).toBe(true)
    })

    it('stops the theme fading back in when the theme fails to save', async () => {
      // Left on, the whole page stays half-transparent with no way back but a reload
      api.fail('patch', '/config-editor/ui', new Error('config not writable'))

      await change('uiTheme', 'teal')

      expect(state().isThemeTransitioning).toBe(false)
      expect(saving('uiTheme')).toBe(false)
    })
  })

  /**
   * ⚠️ **Switching the persistent terminal off throws away whatever is running in
   * it**, so the user is asked first — but only when there is a session to lose.
   */
  describe('turning off the persistent terminal', () => {
    beforeEach(() => {
      terminal.hasActiveSession = () => true
    })

    it('asks before throwing a live session away', async () => {
      page.change('uiTerminalPersistence', false)
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      expect(modal.lastOpened()!.component).toBe(Confirm)
      expect(modal.propsFor()).toMatchObject({ confirmButtonClass: 'btn-primary' })
    })

    it('cannot be clicked away, so the answer is deliberate', async () => {
      page.change('uiTerminalPersistence', false)
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      expect(modal.lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static' })
    })

    it('closes the session and saves once the user agrees', async () => {
      page.change('uiTerminalPersistence', false)
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      modal.lastOpened()!.ref.close()
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      expect(terminal.destroyPersistentSession).toHaveBeenCalled()
      expect(uiPatch()).toMatchObject({ 'terminal.persistence': false })
    })

    it('puts the switch back and keeps the session when they change their mind', async () => {
      // ⚠️ Silently, and without a write
      page.change('uiTerminalPersistence', false)
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      modal.lastOpened()!.ref.dismiss()
      await vi.advanceTimersByTimeAsync(SETTLE_MS)

      expect(values().uiTerminalPersistence).toBe(true)
      expect(terminal.destroyPersistentSession).not.toHaveBeenCalled()
      expect(uiPatch()?.['terminal.persistence']).toBeUndefined()
    })

    it('asks nothing when there is no session to lose', async () => {
      terminal.hasActiveSession = () => false

      await change('uiTerminalPersistence', false)

      expect(modal.opened).toEqual([])
      expect(uiPatch()).toMatchObject({ 'terminal.persistence': false })
    })

    it('asks nothing when the setting is being switched on', async () => {
      await change('uiTerminalPersistence', true)

      expect(modal.opened).toEqual([])
      expect(terminal.destroyPersistentSession).not.toHaveBeenCalled()
      expect(uiPatch()).toMatchObject({ 'terminal.persistence': true })
    })
  })

  describe('changing the theme and the lighting mode', () => {
    it.each([
      ['uiTheme', 'teal', 'setTheme'],
      ['uiLight', 'dark', 'setLightingMode'],
    ] as const)('%s applies at once and clears its spinner afterwards', async (field, value, setter) => {
      const spy = vi.spyOn(settingsActions, setter)

      await change(field, value)

      // Applied straight away rather than after the write
      expect(spy).toHaveBeenCalled()
      expect(saving(field)).toBe(true)

      await vi.advanceTimersByTimeAsync(1000)
      expect(saving(field)).toBe(false)
      expect(state().isThemeTransitioning).toBe(false)
    })

    it('dims the page while the theme is being applied', async () => {
      page.change('uiTheme', 'teal')
      // Into the fade-out, before the write goes anywhere
      await vi.advanceTimersByTimeAsync(800)

      expect(state().isThemeTransitioning).toBe(true)
    })

    it('reloads the page for a menu mode that did save', async () => {
      const setMenuMode = vi.spyOn(settingsActions, 'setMenuMode')
      locationReload.mockClear()

      await change('uiMenu', 'freeze')

      expect(setMenuMode).toHaveBeenCalledWith('freeze')
      expect(locationReload).toHaveBeenCalled()
    })

    it('writes the lighting mode down as a deliberate choice', async () => {
      // ⚠️ The second argument is the source; anything else keeps following the system setting
      const setLightingMode = vi.spyOn(settingsActions, 'setLightingMode')

      await change('uiLight', 'dark')

      expect(setLightingMode).toHaveBeenCalledWith('dark', 'user')
      expect(uiPatch()).toMatchObject({ lightingMode: 'dark' })
    })

    it('repaints the terminal theme when its lighting changes', async () => {
      const updateTerminalBodyClass = vi.spyOn(settingsActions, 'updateTerminalBodyClass')

      await change('uiTerminalLightingMode', 'light')

      expect(updateTerminalBodyClass).toHaveBeenCalled()
      expect(uiPatch()).toMatchObject({ 'terminal.lightingMode': 'light' })
    })
  })

  /**
   * ⚠️ **Hiding a row is not the same as it not being there.** A section is shown
   * when at least one of its rows is still visible, so anything the page was
   * never rendering has to be counted as hidden too.
   */
  describe('searching the settings', () => {
    const search = (query: string) => page.onSearchChange(query)

    it('opens the box on the search button', () => {
      page.toggleSearch()

      expect(state().showSearchBar).toBe(true)
    })

    it('clears the query when the box is closed again', () => {
      page.toggleSearch()
      search('backup')

      page.toggleSearch()

      expect(state().showSearchBar).toBe(false)
      expect(state().searchQuery).toBe('')
      expect(page.isItemHidden('setting-lang')).toBe(false)
    })

    it('shows everything before anything is typed', () => {
      expect(page.isItemHidden('setting-name')).toBe(false)
      expect(page.isSectionVisible('display')).toBe(true)
    })

    it('keeps a row whose name matches', () => {
      search(getItemsContent()['setting-lang'])

      expect(page.isItemHidden('setting-lang')).toBe(false)
    })

    it('hides the rows that do not match', () => {
      search(getItemsContent()['setting-lang'])

      expect(page.isItemHidden('setting-name')).toBe(true)
    })

    it('ignores the case of what was typed', () => {
      search(getItemsContent()['setting-lang'].toUpperCase())

      expect(page.isItemHidden('setting-lang')).toBe(false)
    })

    it('keeps a whole section when the section name matches', () => {
      search(getSectionContent().display)

      expect(page.isSectionVisible('display')).toBe(true)
      expect(page.isItemHidden('setting-theme')).toBe(false)
      expect(page.isItemHidden('setting-menu')).toBe(false)
    })

    it('hides a section with nothing left in it', () => {
      search(getItemsContent()['setting-lang'])

      expect(page.isSectionVisible('general')).toBe(false)
    })

    it('hides every section when nothing matches at all', () => {
      search('a-string-no-setting-contains')

      expect(page.isSectionVisible('general')).toBe(false)
      expect(page.isSectionVisible('display')).toBe(false)
    })

    it('shows a section it has no row list for', () => {
      // A new section added to the page but not to the index should not vanish
      search('anything')

      expect(page.isSectionVisible('a-section-nobody-mapped')).toBe(true)
    })

    it('brings everything back when the box is cleared', () => {
      search('a-string-no-setting-contains')

      page.clearSearch()

      expect(page.isItemHidden('setting-name')).toBe(false)
      expect(page.isSectionVisible('general')).toBe(true)
    })

    it('leaves a hidden section out of the index beside the page', () => {
      search(getItemsContent()['setting-lang'])

      expect(page.sectionNav().map(section => section.key)).toEqual(['display'])
    })

    it('leaves the protocol sections out of the index without matter support', () => {
      expect(page.sectionNav().map(section => section.key)).not.toContain('hap')
      expect(page.sectionNav().map(section => section.key)).not.toContain('matter')
    })

    describe('rows the page was not showing anyway', () => {
      const unavailable = () => page.getUnavailableItems()
      const setFlags = (flags: Record<string, unknown>) =>
        page.store.setState(current => ({ flags: { ...current.flags, ...flags } }))

      it('counts the linux rows out on any other platform', () => {
        // ⚠️ Without this a search for "restart" on macOS shows a Startup section
        // whose only match is a row the page never rendered
        setFlags({ platform: 'darwin' })

        expect(unavailable()).toContain('setting-linux-shutdown')
        expect(unavailable()).toContain('setting-linux-restart')
        expect(unavailable()).toContain('setting-linux-temp')
      })

      it('counts the temperature file out on linux that is not a pi', () => {
        setFlags({ platform: 'linux', runningOnRaspberryPi: false })

        expect(unavailable()).toContain('setting-linux-temp')
        expect(unavailable()).not.toContain('setting-linux-restart')
      })

      it('keeps all three on a raspberry pi', () => {
        setFlags({ platform: 'linux', runningOnRaspberryPi: true })

        expect(unavailable()).not.toContain('setting-linux-temp')
      })

      it('counts the docker startup script out when not in docker', () => {
        setFlags({ runningInDocker: false })

        expect(unavailable()).toContain('setting-docker-startup')
      })

      it('counts the matter rows out while matter is off', () => {
        page.patch('matterEnabled', false)

        expect(unavailable()).toContain('setting-matter-port')
        expect(unavailable()).toContain('setting-matter-port-range')
      })

      it('counts the log truncate row out when no log size is set', () => {
        page.patch('hbLogSize', 0)

        expect(unavailable()).toContain('setting-terminal-log-truncate')
      })

      it('counts the terminal rows out when terminal access is off', () => {
        setFlags({ enableTerminalAccess: false })

        expect(unavailable()).toContain('setting-terminal-persistence')
        expect(unavailable()).toContain('setting-terminal-warning')
        expect(unavailable()).toContain('setting-terminal-buffer')
      })

      it('counts the unload warning out when the session persists anyway', () => {
        setFlags({ enableTerminalAccess: true })
        page.patch('uiTerminalPersistence', true)

        expect(unavailable()).toContain('setting-terminal-warning')
        expect(unavailable()).not.toContain('setting-terminal-persistence')
      })

      it('counts the buffer size out when the session does not persist', () => {
        setFlags({ enableTerminalAccess: true })
        page.patch('uiTerminalPersistence', false)

        expect(unavailable()).toContain('setting-terminal-buffer')
        expect(unavailable()).not.toContain('setting-terminal-warning')
      })

      it('counts the session rows out when login is switched off', () => {
        page.patch('uiAuth', false)

        expect(unavailable()).toContain('setting-session-inactivity')
        expect(unavailable()).toContain('setting-security-session')
      })

      it('hides them from a search that would otherwise match them', () => {
        setFlags({ platform: 'darwin' })
        search(getItemsContent()['setting-linux-restart'])

        expect(page.isItemHidden('setting-linux-restart')).toBe(true)
      })
    })
  })

  describe('the modals it opens', () => {
    it.each([
      ['the backup modal', 'openBackupModal', Backup],
      ['the wallpaper picker', 'openWallpaperModal', Wallpaper],
      ['the full bridge reset', 'resetHomebridgeState', ResetAllBridges],
      ['the single bridge reset', 'unpairAccessory', ResetIndividualBridges],
      ['the remove-all-accessories modal', 'removeAllCachedAccessories', RemoveAllAccessories],
      ['the remove-bridge-accessories modal', 'removeBridgeAccessories', RemoveBridgeAccessories],
      ['the port overview', 'openPortOverview', PortOverviewModal],
    ] as const)('opens %s', (_label, method, expected) => {
      ;(page[method] as () => void)()

      expect(modal.lastOpened()!.component).toBe(expected)
      expect(modal.lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static' })
    })

    it('sends the user to the config editor to restore a config backup', () => {
      // The backups live with the editor, not here
      page.openConfigBackup()

      expect(navigate).toHaveBeenCalledWith('/config?action=restore')
      expect(modal.openModal).not.toHaveBeenCalled()
    })

    it('opens the individual-accessory removal with no bridge chosen', () => {
      // Reached from settings rather than from one accessory
      page.removeSingleCachedAccessories()

      expect(modal.lastOpened()!.component).toBe(RemoveIndividualAccessories)
      expect(modal.propsFor()?.selectedBridge).toBe('')
    })

    describe('the ssl modal', () => {
      it('shows the mode the modal saved', async () => {
        // The modal does the saving; this value only has to catch up with it
        const pending = page.openSslModal()
        await Promise.resolve()
        api.clearCalls()
        expect(modal.lastOpened()!.component).toBe(SslSettingsModal)
        modal.lastOpened()!.ref.close('letsencrypt')
        await pending
        await vi.advanceTimersByTimeAsync(SETTLE_MS)

        expect(values().uiSslType).toBe('letsencrypt')
        expect(api.calls).toEqual([])
      })

      it('asks for a restart, because certificates load at startup', async () => {
        const pending = page.openSslModal()
        await Promise.resolve()
        modal.lastOpened()!.ref.close('selfsigned')
        await pending

        expect(showRestartToast).toHaveBeenCalled()
      })

      it('changes nothing when it is dismissed', async () => {
        const before = values().uiSslType

        const pending = page.openSslModal()
        await Promise.resolve()
        modal.lastOpened()!.ref.dismiss()
        await pending

        expect(values().uiSslType).toBe(before)
        expect(showRestartToast).not.toHaveBeenCalled()
      })

      it.each([
        [{ selfSigned: true }, 'selfsigned'],
        [{ key: '/k.pem', cert: '/c.pem' }, 'keycert'],
        [{ pfx: '/a.pfx' }, 'pfx'],
        [{ hasPassphrase: true }, 'pfx'],
        [{}, 'off'],
      ])('starts from the mode the config has (%o)', async (ssl, expected) => {
        create({ ssl })
        await vi.advanceTimersByTimeAsync(0)

        expect(values().uiSslType).toBe(expected)
      })
    })

    describe('the accessory control lists', () => {
      it('hands over the blacklist as it stands', async () => {
        settingsActions.setEnvItem('accessoryControl', { instanceBlacklist: ['0E:11:22:33:44:55'] })

        const pending = page.accessoryUiControl()
        await Promise.resolve()

        expect(modal.lastOpened()!.component).toBe(AccessoryControlLists)
        expect(modal.propsFor()?.existingBlacklist).toEqual(['0E:11:22:33:44:55'])

        modal.lastOpened()!.ref.close()
        await pending
      })

      it('starts from an empty list when nothing is blacklisted', async () => {
        const pending = page.accessoryUiControl()
        await Promise.resolve()

        expect(modal.propsFor()?.existingBlacklist).toEqual([])

        modal.lastOpened()!.ref.close()
        await pending
      })

      it('asks for a restart once the list is saved', async () => {
        const pending = page.accessoryUiControl()
        await Promise.resolve()
        modal.lastOpened()!.ref.close()
        await pending

        expect(showRestartToast).toHaveBeenCalled()
      })

      it('says nothing when the user simply closed it', async () => {
        // 'Dismiss' is the modal's own close reason, not a failure
        const pending = page.accessoryUiControl()
        await Promise.resolve()
        modal.lastOpened()!.ref.dismiss('Dismiss')
        await pending

        expect(toast.error).not.toHaveBeenCalled()
        expect(showRestartToast).not.toHaveBeenCalled()
      })

      it('reports a real failure', async () => {
        const pending = page.accessoryUiControl()
        await Promise.resolve()
        modal.lastOpened()!.ref.dismiss(new Error('server unavailable'))
        await pending

        expect(toast.error).toHaveBeenCalled()
      })
    })

    describe('choosing which network interfaces the bridge uses', () => {
      it('offers what is available and what is already chosen', async () => {
        page.store.setState({
          adaptersAvailable: [{ iface: 'eth0', ip4: '192.168.1.10' }] as any,
          adaptersSelected: [{ iface: 'eth0' }] as any,
        })

        const pending = page.selectNetworkInterfaces()
        await Promise.resolve()

        expect(modal.lastOpened()!.component).toBe(SelectNetworkInterfaces)
        expect(modal.propsFor()?.adaptersAvailable).toHaveLength(1)
        expect(modal.propsFor()?.adaptersSelected).toHaveLength(1)

        modal.lastOpened()!.ref.dismiss('Dismiss')
        await pending
      })

      it('marks an adapter the machine no longer has', async () => {
        // ⚠️ A network card that has been removed, or renamed by a system update.
        // Marking it lets the page say so and keep the choice
        create({}, {
          breakApi: (broken) => {
            broken.respond('get', '/server/network-interfaces/system', [{ iface: 'eth0', ip4: '192.168.1.10' }])
            broken.respond('get', '/server/network-interfaces/bridge', ['eth0', 'wlan0'])
          },
        })
        await vi.advanceTimersByTimeAsync(0)

        expect(state().adaptersSelected).toEqual([
          expect.objectContaining({ iface: 'eth0', selected: true, missing: false }),
          expect.objectContaining({ iface: 'wlan0', selected: true, missing: true }),
        ])
      })

      it('selects nothing when the bridge is on no particular interface', async () => {
        create({}, {
          breakApi: (broken) => {
            broken.respond('get', '/server/network-interfaces/system', [{ iface: 'eth0', ip4: '192.168.1.10' }])
            broken.respond('get', '/server/network-interfaces/bridge', [])
          },
        })
        await vi.advanceTimersByTimeAsync(0)

        expect(state().adaptersSelected).toEqual([])
      })

      it('offers the avahi and resolved advertisers on linux', () => {
        expect(state().showAvahiMdnsOption).toBe(true)
        expect(state().showResolvedMdnsOption).toBe(true)
      })

      it('saves the chosen adapters and asks for a restart', async () => {
        // The bridge binds its interfaces at startup
        const pending = page.selectNetworkInterfaces()
        await Promise.resolve()
        modal.lastOpened()!.ref.close(['eth0'])
        await pending

        expect(api.lastCall('put', '/server/network-interfaces/bridge')?.body).toEqual({ adapters: ['eth0'] })
        expect(showRestartToast).toHaveBeenCalled()
      })

      it('saves nothing when the picker is dismissed', async () => {
        const pending = page.selectNetworkInterfaces()
        await Promise.resolve()
        modal.lastOpened()!.ref.dismiss('Dismiss')
        await pending

        expect(api.callsTo('put', '/server/network-interfaces/bridge')).toEqual([])
      })

      it('reports a failed save', async () => {
        api.fail('put', '/server/network-interfaces/bridge', new Error('config not writable'))

        const pending = page.selectNetworkInterfaces()
        await Promise.resolve()
        modal.lastOpened()!.ref.close(['eth0'])
        await pending

        expect(toast.error).toHaveBeenCalled()
        expect(showRestartToast).not.toHaveBeenCalled()
      })
    })
  })

  /**
   * ⚠️ **At least one protocol has to stay on**, unless the running Homebridge is
   * new enough to allow neither.
   *
   * ⚠️ **Disabling Matter used to destroy its commissioning.** On a newer
   * Homebridge it is disabled *in place*; on an older one the block and its
   * storage are deleted, and that path asks the user to confirm first.
   */
  describe('turning the protocols on and off', () => {
    async function withProtocols(options: { disableInPlace?: boolean, disableAll?: boolean, externalsOnly?: boolean } = {}) {
      create({
        featureFlags: {
          matterSupport: true,
          matterDisableInPlace: options.disableInPlace ?? true,
          disableAllProtocols: options.disableAll ?? false,
          protocolExternalsOnly: options.externalsOnly ?? false,
        },
      })
      // ⚠️ Let the startup reads land first. They patch the matter port and fill
      // the config cache, so a value set before this is overwritten
      await vi.advanceTimersByTimeAsync(0)
      return page
    }

    /** Run one of the save methods and let it settle. */
    async function save(method: keyof SettingsPage, value: unknown) {
      await (page[method] as (value: unknown) => Promise<void>)(value)
      await vi.advanceTimersByTimeAsync(SETTLE_MS)
    }

    describe('refusing to leave the box with no protocol', () => {
      it('will not switch matter off while hap is already off', async () => {
        await withProtocols({ disableAll: false })
        page.patch('hapEnabled', false)
        page.patch('matterEnabled', true)

        await save('matterEnabledSave', false)

        expect(toast.info).toHaveBeenCalled()
        expect(values().matterEnabled).toBe(true)
        expect(api.callsTo('put')).toEqual([])
      })

      it('will not switch hap off while matter is already off', async () => {
        await withProtocols({ disableAll: false })
        page.patch('matterEnabled', false)
        page.patch('hapEnabled', true)

        await save('hapEnabledSave', false)

        expect(toast.info).toHaveBeenCalled()
        expect(values().hapEnabled).toBe(true)
      })

      it('allows it on a homebridge that supports having neither', async () => {
        await withProtocols({ disableAll: true })
        page.patch('hapEnabled', false)

        await save('matterEnabledSave', false)

        expect(api.lastCall('put', '/config-editor/matter/enabled')).toBeDefined()
      })
    })

    describe('matter, on a homebridge that disables it in place', () => {
      it('keeps the commissioning when switched off', async () => {
        await withProtocols({ disableInPlace: true })
        page.patch('hapEnabled', true)
        page.patch('matterPort', 5540)

        await save('matterEnabledSave', false)

        expect(api.lastCall('put', '/config-editor/matter/enabled')?.body).toMatchObject({ enabled: false, restart: false })
        expect(api.callsTo('delete', '/config-editor/matter')).toEqual([])
      })

      it('asks for nothing before doing it, because nothing is lost', async () => {
        await withProtocols({ disableInPlace: true })
        page.patch('hapEnabled', true)

        await save('matterEnabledSave', false)

        expect(modal.opened).toEqual([])
      })

      it('remembers the port it was on, to restore it later', async () => {
        await withProtocols({ disableInPlace: true })
        page.patch('hapEnabled', true)
        page.patch('matterPort', 5555)

        await save('matterEnabledSave', false)
        api.clearCalls()
        await save('matterEnabledSave', true)

        expect(api.lastCall('put', '/config-editor/matter')?.body).toMatchObject({ port: 5555 })
      })

      it('asks the server for a port the first time it is switched on', async () => {
        await withProtocols({ disableInPlace: true })
        api.respond('get', '/server/port/new/matter', { port: 5541 })
        page.internals.matterConfigCache = {}

        await save('matterEnabledSave', true)

        expect(api.lastCall('put', '/config-editor/matter')?.body).toMatchObject({ port: 5541 })
      })

      it('falls back to a port in the matter range when the server cannot pick one', async () => {
        await withProtocols({ disableInPlace: true })
        api.fail('get', '/server/port/new/matter', new Error('server unavailable'))
        page.internals.matterConfigCache = {}

        await save('matterEnabledSave', true)

        const port = api.lastCall('put', '/config-editor/matter')?.body.port
        expect(port).toBeGreaterThanOrEqual(5530)
        expect(port).toBeLessThanOrEqual(5541)
      })

      it('falls back to a port when tearing matter down and building it again', async () => {
        // ⚠️ The same fallback, on the destructive route
        await withProtocols({ disableInPlace: false })
        api.fail('get', '/server/port/new/matter', new Error('server unavailable'))
        page.internals.matterConfigCache = {}

        await save('matterEnabledSave', true)

        const port = api.lastCall('put', '/config-editor/matter')?.body.port
        expect(port).toBeGreaterThanOrEqual(5530)
        expect(port).toBeLessThanOrEqual(5541)
      })

      it('clears the externals-only flag when matter comes back on', async () => {
        // The backend rejects enabled together with externalsOnly
        await withProtocols({ disableInPlace: true, externalsOnly: true })
        page.patch('matterExternalsOnly', true)
        page.internals.matterConfigCache = { port: 5540 }

        await save('matterEnabledSave', true)

        expect(values().matterExternalsOnly).toBe(false)
      })

      it('sends the externals-only flag when matter goes off', async () => {
        await withProtocols({ disableInPlace: true, externalsOnly: true })
        page.patch('hapEnabled', true)
        page.patch('matterExternalsOnly', true)

        await save('matterEnabledSave', false)

        expect(api.lastCall('put', '/config-editor/matter/enabled')?.body).toMatchObject({ enabled: false, externalsOnly: true })
      })

      it('flags a full service restart rather than restarting there and then', async () => {
        await withProtocols({ disableInPlace: true })
        page.patch('hapEnabled', true)

        await save('matterEnabledSave', false)

        expect(api.lastCall('put', '/platform-tools/hb-service/set-full-service-restart-flag')).toBeDefined()
        expect(showRestartToast).toHaveBeenCalled()
      })

      it('puts the toggle back when the write fails', async () => {
        // Otherwise the switch says off and matter is still running
        await withProtocols({ disableInPlace: true })
        page.patch('hapEnabled', true)
        api.fail('put', '/config-editor/matter/enabled', new Error('config not writable'))

        await save('matterEnabledSave', false)

        expect(values().matterEnabled).toBe(true)
        expect(toast.error).toHaveBeenCalled()
      })

      it('is saved straight from the switch, with no debounce', async () => {
        await withProtocols({ disableInPlace: true })
        api.clearCalls()

        page.change('matterEnabled', false)
        await settleMicrotasks()

        expect(api.lastCall('put', '/config-editor/matter/enabled')).toBeDefined()
      })
    })

    describe('matter, on an older homebridge that has to tear it down', () => {
      it('asks the user first, and says it is destructive', async () => {
        await withProtocols({ disableInPlace: false })
        page.patch('hapEnabled', true)

        void page.matterEnabledSave(false)
        await settleMicrotasks()

        expect(modal.lastOpened()!.component).toBe(Confirm)
        expect(modal.propsFor()).toMatchObject({ confirmButtonClass: 'btn-danger' })
      })

      it('deletes the matter block once confirmed', async () => {
        await withProtocols({ disableInPlace: false })
        page.patch('hapEnabled', true)

        void page.matterEnabledSave(false)
        await settleMicrotasks()
        modal.lastOpened()!.ref.close()
        await settleMicrotasks()

        expect(api.callsTo('delete', '/config-editor/matter')).toHaveLength(1)
      })

      it('sends the user to the restart page, already restarting', async () => {
        await withProtocols({ disableInPlace: false })
        page.patch('hapEnabled', true)

        void page.matterEnabledSave(false)
        await settleMicrotasks()
        modal.lastOpened()!.ref.close()
        await settleMicrotasks()

        expect(navigate).toHaveBeenCalledWith('/restart?alreadyRestarting=true')
      })

      it('puts the toggle back when the user changes their mind', async () => {
        await withProtocols({ disableInPlace: false })
        page.patch('hapEnabled', true)

        void page.matterEnabledSave(false)
        await settleMicrotasks()
        modal.lastOpened()!.ref.dismiss('Dismiss')
        await settleMicrotasks()

        expect(values().matterEnabled).toBe(true)
        expect(api.callsTo('delete', '/config-editor/matter')).toEqual([])
      })

      it('writes the port and asks for a restart when switched on', async () => {
        await withProtocols({ disableInPlace: false })
        page.internals.matterConfigCache = { port: 5540 }

        await save('matterEnabledSave', true)

        expect(api.lastCall('put', '/config-editor/matter')?.body).toMatchObject({ port: 5540 })
        expect(showRestartToast).toHaveBeenCalled()
      })
    })

    describe('hap', () => {
      it('writes the new state and flags a restart', async () => {
        await withProtocols({ disableInPlace: true })
        page.patch('matterEnabled', true)

        await save('hapEnabledSave', false)

        expect(api.lastCall('put', '/config-editor/hap')?.body).toMatchObject({ enabled: false, restart: false })
        expect(showRestartToast).toHaveBeenCalled()
      })

      it('clears externals-only when hap comes back on', async () => {
        await withProtocols({ disableInPlace: true, externalsOnly: true })
        page.patch('hapExternalsOnly', true)

        await save('hapEnabledSave', true)

        expect(values().hapExternalsOnly).toBe(false)
      })

      it('sends externals-only when hap goes off', async () => {
        await withProtocols({ disableInPlace: true, externalsOnly: true })
        page.patch('matterEnabled', true)
        page.patch('hapExternalsOnly', true)

        await save('hapEnabledSave', false)

        expect(api.lastCall('put', '/config-editor/hap')?.body).toMatchObject({ externalsOnly: true })
      })

      it('puts the toggle back when the write fails', async () => {
        await withProtocols({ disableInPlace: true })
        page.patch('matterEnabled', true)
        api.fail('put', '/config-editor/hap', new Error('config not writable'))

        await save('hapEnabledSave', false)

        expect(values().hapEnabled).toBe(true)
        expect(toast.error).toHaveBeenCalled()
      })

      it('asks first on an older homebridge, because pairings are lost', async () => {
        await withProtocols({ disableInPlace: false })
        page.patch('matterEnabled', true)

        void page.hapEnabledSave(false)
        await settleMicrotasks()

        expect(modal.lastOpened()!.component).toBe(Confirm)
      })

      it('writes the change once confirmed on an older homebridge', async () => {
        await withProtocols({ disableInPlace: false })
        page.patch('matterEnabled', true)

        void page.hapEnabledSave(false)
        await settleMicrotasks()
        modal.lastOpened()!.ref.close()
        await settleMicrotasks()

        expect(api.lastCall('put', '/config-editor/hap')?.body).toMatchObject({ enabled: false })
      })

      it('puts the toggle back when the user cancels', async () => {
        await withProtocols({ disableInPlace: false })
        page.patch('matterEnabled', true)

        void page.hapEnabledSave(false)
        await settleMicrotasks()
        modal.lastOpened()!.ref.dismiss('Dismiss')
        await settleMicrotasks()

        expect(values().hapEnabled).toBe(true)
      })
    })

    describe('the matter port', () => {
      it('writes the port alongside the ipv4 preference', async () => {
        // ⚠️ PUT /config-editor/matter replaces the whole block
        await withProtocols()
        page.patch('matterDisableIpv4', true)

        await save('matterPortSave', 5555)

        expect(api.lastCall('put', '/config-editor/matter')?.body).toEqual({ port: 5555, disableIpv4: true })
      })

      it('accepts an empty port, because it is optional', async () => {
        await withProtocols()
        page.patch('matterDisableIpv4', false)

        await save('matterPortSave', null)

        expect(api.lastCall('put', '/config-editor/matter')?.body).toEqual({ port: undefined, disableIpv4: undefined })
        expect(invalid('matterPort')).toBe(false)
      })

      it('keeps the port when only the ipv4 preference changes', async () => {
        await withProtocols()
        page.patch('matterPort', 5540)

        await save('matterDisableIpv4Save', true)

        expect(api.lastCall('put', '/config-editor/matter')?.body).toEqual({ port: 5540, disableIpv4: true })
      })

      it('puts the ipv4 toggle back when its write fails', async () => {
        await withProtocols()
        api.fail('put', '/config-editor/matter', new Error('config not writable'))
        page.patch('matterDisableIpv4', false)

        await save('matterDisableIpv4Save', true)

        expect(values().matterDisableIpv4).toBe(false)
        expect(toast.error).toHaveBeenCalled()
      })
    })

    /**
     * ⚠️ **The pairings go with a teardown.** The confirmation is the only thing
     * standing between a mis-click and an evening of re-pairing.
     */
    describe('tearing a protocol down on an older homebridge', () => {
      async function confirmTeardown(method: 'matterEnabledSave' | 'hapEnabledSave', answer: 'confirm' | 'cancel' | Error, withRestartToast = false) {
        await withProtocols({ disableInPlace: false })
        if (withRestartToast) {
          showRestartToast.mockRestore()
          settingsActions.showRestartToast()
        }
        page.patch('hapEnabled', true)
        page.patch('matterEnabled', true)

        void page[method](false)
        await settleMicrotasks()

        const ref = modal.lastOpened()!.ref
        if (answer === 'confirm') {
          ref.close()
        } else if (answer === 'cancel') {
          // ⚠️ Dismissed with the string the modal uses, not an Error: the page
          // tells a cancellation apart from a real failure by that exact value
          ref.dismiss('Dismiss')
        } else {
          ref.dismiss(answer)
        }
        await settleMicrotasks()
      }

      it.each(['matterEnabledSave', 'hapEnabledSave'] as const)('takes the restart notice off the screen before restarting for %s', async (method) => {
        // ⚠️ The page is about to navigate to the restart screen itself; a second
        // restart button over a restart under way is the wrong thing to leave up
        await confirmTeardown(method, 'confirm', true)

        const notice = toast.at('info')[0]
        expect(toast.clear).toHaveBeenCalledWith(notice.toastId)
        expect(settingsActions.hasRestartToast()).toBe(false)
      })

      it('tears the matter block down once confirmed, with no notice to clear', async () => {
        await confirmTeardown('matterEnabledSave', 'confirm')

        // The block goes rather than being marked off: an older homebridge has no
        // way to read `enabled: false`
        expect(api.callsTo('delete', '/config-editor/matter')).toHaveLength(1)
        expect(toast.clear).not.toHaveBeenCalled()
      })

      it('writes hap off once confirmed, with no notice to clear', async () => {
        await confirmTeardown('hapEnabledSave', 'confirm')

        expect(api.lastCall('put', '/config-editor/hap')?.body).toMatchObject({ enabled: false })
        expect(toast.clear).not.toHaveBeenCalled()
      })

      it.each([
        ['matterEnabledSave', 'matterEnabled'],
        ['hapEnabledSave', 'hapEnabled'],
      ] as const)('puts %s back without a word when the user changes their mind', async (method, field) => {
        // ⚠️ Not an error: a cancelled confirmation is the user deciding
        await confirmTeardown(method, 'cancel')

        expect(values()[field]).toBe(true)
        expect(saving(field)).toBe(false)
        expect(toast.error).not.toHaveBeenCalled()
      })

      it.each([
        ['matterEnabledSave', 'matterEnabled'],
        ['hapEnabledSave', 'hapEnabled'],
      ] as const)('reports a real failure during %s and puts the toggle back', async (method, field) => {
        await confirmTeardown(method, new Error('config not writable'))

        expect(toast.error).toHaveBeenCalled()
        expect(values()[field]).toBe(true)
        expect(saving(field)).toBe(false)
      })
    })

    describe('the matter port on its own', () => {
      it('sends the port alongside the ipv4 preference', async () => {
        await withProtocols()
        page.patch('matterDisableIpv4', true)

        await save('matterPortSave', 5545)

        expect(api.lastCall('put', '/config-editor/matter')?.body).toEqual({ port: 5545, disableIpv4: true })
      })

      it.each([null, undefined, ''])('accepts %s, because the port is optional', async (value) => {
        // ⚠️ Zero is NOT one of these: it takes the validated route and is refused
        await withProtocols()

        await save('matterPortSave', value)

        expect(api.lastCall('put', '/config-editor/matter')?.body?.port).toBeUndefined()
        expect(invalid('matterPort')).toBe(false)
      })

      it.each([
        ['zero', 0],
        ['below the reserved range', 1023],
        ['above the maximum', 65536],
        ['not a whole number', 5545.5],
      ])('refuses a port %s', async (_case, port) => {
        await withProtocols()

        await save('matterPortSave', port)

        expect(api.callsTo('put', '/config-editor/matter')).toEqual([])
        expect(invalid('matterPort')).toBe(true)
      })

      it('marks the port unsaved when the write fails', async () => {
        await withProtocols()
        api.fail('put', '/config-editor/matter', new Error('config not writable'))

        await save('matterPortSave', 5545)

        expect(toast.error).toHaveBeenCalled()
        expect(saving('matterPort')).toBe(false)
        expect(invalid('matterPort')).toBe(true)
      })

      it('reports a failure to clear the port too', async () => {
        await withProtocols()
        api.fail('put', '/config-editor/matter', new Error('config not writable'))

        await save('matterPortSave', null)

        expect(toast.error).toHaveBeenCalled()
        expect(saving('matterPort')).toBe(false)
      })

      it('asks for a restart once the port is written', async () => {
        await withProtocols()
        showRestartToast.mockClear()

        await save('matterPortSave', 5545)

        expect(showRestartToast).toHaveBeenCalled()
      })
    })

    describe('the externals-only flag on its own', () => {
      it('writes it while the protocol is off', async () => {
        await withProtocols({ disableInPlace: true, externalsOnly: true })
        page.patch('matterEnabled', false)

        await save('matterExternalsOnlySave', true)

        expect(api.lastCall('put', '/config-editor/matter/enabled')?.body).toMatchObject({ enabled: false, externalsOnly: true })
      })

      it('does nothing while the protocol is still on', async () => {
        await withProtocols({ disableInPlace: true, externalsOnly: true })
        page.patch('matterEnabled', true)

        await save('matterExternalsOnlySave', true)

        expect(api.callsTo('put', '/config-editor/matter/enabled')).toEqual([])
      })

      it('puts the flag back when the write fails', async () => {
        await withProtocols({ disableInPlace: true, externalsOnly: true })
        page.patch('matterEnabled', false)
        page.patch('matterExternalsOnly', false)
        api.fail('put', '/config-editor/matter/enabled', new Error('config not writable'))

        await save('matterExternalsOnlySave', true)

        expect(values().matterExternalsOnly).toBe(false)
      })
    })

    /**
     * ⚠️ **Both boxes send both ends.** The endpoint replaces the pair, so a save
     * that sent only the box that changed would wipe the other one.
     */
    describe('the matter port range', () => {
      it.each([
        ['matterStartPortSave', 5551, { start: 5551, end: 5560 }],
        ['matterEndPortSave', 5559, { start: 5550, end: 5559 }],
      ] as const)('%s sends both ends of the range', async (method, value, expected) => {
        await withProtocols()

        await save(method, value)

        expect(api.lastCall('put', '/config-editor/matter/ports')?.body).toEqual(expected)
      })

      it.each([
        ['a start below the reserved range', 'matterStartPortSave', 1024, 'matterStartPort'],
        ['a start above the maximum', 'matterStartPortSave', 65534, 'matterStartPort'],
        ['a start that is not a whole number', 'matterStartPortSave', 5551.5, 'matterStartPort'],
        ['an end below the reserved range', 'matterEndPortSave', 1024, 'matterEndPort'],
        ['an end above the maximum', 'matterEndPortSave', 65534, 'matterEndPort'],
        ['an end that is not a whole number', 'matterEndPortSave', 5559.5, 'matterEndPort'],
      ] as const)('refuses %s', async (_case, method, value, field) => {
        await withProtocols()

        await save(method, value)

        expect(api.callsTo('put', '/config-editor/matter/ports')).toEqual([])
        expect(invalid(field)).toBe(true)
      })

      it('refuses a start at or past the end', async () => {
        await withProtocols()

        await save('matterStartPortSave', 5560)

        expect(api.callsTo('put', '/config-editor/matter/ports')).toEqual([])
        expect(invalid('matterStartPort')).toBe(true)
      })

      it('refuses an end at or before the start', async () => {
        await withProtocols()

        await save('matterEndPortSave', 5550)

        expect(api.callsTo('put', '/config-editor/matter/ports')).toEqual([])
        expect(invalid('matterEndPort')).toBe(true)
      })

      it.each([
        ['matterStartPortSave', 'start'],
        ['matterEndPortSave', 'end'],
      ] as const)('sends no %s when its box is emptied', async (method, key) => {
        // Sent as 0 or null the server would take it as a real port
        await withProtocols()

        await save(method, null)

        expect(api.lastCall('put', '/config-editor/matter/ports')?.body?.[key]).toBeUndefined()
      })

      it.each([
        ['matterStartPortSave', 5551, 'matterStartPort'],
        ['matterEndPortSave', 5559, 'matterEndPort'],
      ] as const)('marks %s unsaved when the write fails', async (method, value, field) => {
        await withProtocols()
        api.fail('put', '/config-editor/matter/ports', new Error('config not writable'))

        await save(method, value)

        expect(toast.error).toHaveBeenCalled()
        expect(saving(field)).toBe(false)
        expect(invalid(field)).toBe(true)
      })

      it.each(['matterStartPortSave', 'matterEndPortSave'] as const)('asks for a restart after %s', async (method) => {
        await withProtocols()
        showRestartToast.mockClear()

        await save(method, 5555)

        expect(showRestartToast).toHaveBeenCalled()
      })
    })

    describe('the hap identifying material flag', () => {
      async function withFlag(hapEnabled = true) {
        create({ featureFlags: { matterSupport: true, hapDisableIdentifyingMaterial: true } })
        await vi.advanceTimersByTimeAsync(0)
        page.patch('hapEnabled', hapEnabled)
      }

      it('sends the whole hap block, not just the flag', async () => {
        // ⚠️ Sending the flag alone would turn hap off as a side effect
        await withFlag()

        await save('hapDisableIdentifyingMaterialSave', true)

        expect(api.lastCall('put', '/config-editor/hap')?.body)
          .toEqual({ enabled: true, externalsOnly: false, disableIdentifyingMaterial: true, restart: false })
      })

      it('keeps hap off when it was already off', async () => {
        await withFlag(false)

        await save('hapDisableIdentifyingMaterialSave', true)

        expect(api.lastCall('put', '/config-editor/hap')?.body).toMatchObject({ enabled: false })
        expect(saving('hapDisableIdentifyingMaterial')).toBe(false)
      })

      it('carries the flag along when hap itself is switched on', async () => {
        // ⚠️ Dropping the flag would publish the identifying material once
        await withFlag(false)
        page.patch('hapDisableIdentifyingMaterial', true)

        await save('hapEnabledSave', true)

        expect(api.lastCall('put', '/config-editor/hap')?.body).toMatchObject({ enabled: true, disableIdentifyingMaterial: true })
      })

      it('carries the flag along when hap is switched off', async () => {
        create({
          featureFlags: {
            matterSupport: true,
            hapDisableIdentifyingMaterial: true,
            protocolExternalsOnly: true,
            disableAllProtocols: true,
            // Without this the save takes the destructive path, which waits on a confirmation
            matterDisableInPlace: true,
          },
        })
        await vi.advanceTimersByTimeAsync(0)
        page.patch('hapDisableIdentifyingMaterial', true)

        await save('hapEnabledSave', false)

        expect(api.lastCall('put', '/config-editor/hap')?.body).toMatchObject({ enabled: false, disableIdentifyingMaterial: true })
      })

      it('flags a full service restart rather than restarting there and then', async () => {
        await withFlag()

        await save('hapDisableIdentifyingMaterialSave', true)

        expect(api.callsTo('put', '/platform-tools/hb-service/set-full-service-restart-flag')).toHaveLength(1)
      })

      it('puts the toggle back when the write fails', async () => {
        await withFlag()
        page.patch('hapDisableIdentifyingMaterial', false)
        api.fail('put', '/config-editor/hap', new Error('config not writable'))

        await save('hapDisableIdentifyingMaterialSave', true)

        expect(values().hapDisableIdentifyingMaterial).toBe(false)
        expect(saving('hapDisableIdentifyingMaterial')).toBe(false)
        expect(toast.error).toHaveBeenCalled()
      })
    })

    describe('the hap externals-only flag', () => {
      async function withExternalsOnly(hapEnabled = false) {
        create({ featureFlags: { matterSupport: true, protocolExternalsOnly: true } })
        await vi.advanceTimersByTimeAsync(0)
        page.patch('hapEnabled', hapEnabled)
      }

      it('writes it while hap is off', async () => {
        await withExternalsOnly()

        await save('hapExternalsOnlySave', true)

        expect(api.lastCall('put', '/config-editor/hap')?.body).toMatchObject({ enabled: false, externalsOnly: true })
      })

      it('does nothing while hap is still on', async () => {
        // Writing it here would send `enabled: false` and switch hap off
        await withExternalsOnly(true)

        await save('hapExternalsOnlySave', true)

        expect(api.callsTo('put', '/config-editor/hap')).toEqual([])
      })

      it('puts the flag back when the write fails', async () => {
        await withExternalsOnly()
        page.patch('hapExternalsOnly', false)
        api.fail('put', '/config-editor/hap', new Error('config not writable'))

        await save('hapExternalsOnlySave', true)

        expect(values().hapExternalsOnly).toBe(false)
        expect(saving('hapExternalsOnly')).toBe(false)
      })
    })

    describe('when the protocol settings cannot be read', () => {
      async function withBrokenHapRead() {
        create(
          { featureFlags: { matterSupport: true, hapDisableIdentifyingMaterial: true } },
          { breakApi: broken => broken.fail('get', '/config-editor/hap', new Error('server unavailable')) },
        )
        await vi.advanceTimersByTimeAsync(0)
      }

      it('assumes hap is on, so the user can still switch it off', async () => {
        // ⚠️ A page that assumed off would show hap disabled on a working install
        await withBrokenHapRead()

        expect(values().hapEnabled).toBe(true)
        expect(values().hapExternalsOnly).toBe(false)
        expect(values().hapDisableIdentifyingMaterial).toBe(false)
      })

      it('still wires the toggles up', async () => {
        // ⚠️ Wired only on success, a failed read would leave every hap control
        // silently doing nothing
        await withBrokenHapRead()
        api.clearCalls()

        page.change('hapDisableIdentifyingMaterial', true)
        await vi.advanceTimersByTimeAsync(SETTLE_MS)

        expect(api.callsTo('put', '/config-editor/hap')).toHaveLength(1)
      })

      it('says nothing about matter that is simply not set up yet', async () => {
        // ⚠️ No toast: a fresh install has no matter block at all
        create(
          { featureFlags: { matterSupport: true } },
          { breakApi: broken => broken.fail('get', '/config-editor/matter', new Error('not configured')) },
        )
        await vi.advanceTimersByTimeAsync(0)

        expect(toast.error).not.toHaveBeenCalled()
        expect(values().matterEnabled).toBe(false)
      })

      it('still lets matter be switched on when it is not set up yet', async () => {
        create(
          { featureFlags: { matterSupport: true, matterDisableInPlace: true } },
          { breakApi: broken => broken.fail('get', '/config-editor/matter', new Error('not configured')) },
        )
        await vi.advanceTimersByTimeAsync(0)
        api.clearCalls()

        page.change('matterEnabled', true)
        await vi.advanceTimersByTimeAsync(SETTLE_MS)

        expect(api.lastCall('put', '/config-editor/matter')?.body).toMatchObject({ port: 5541 })
      })
    })
  })
})
