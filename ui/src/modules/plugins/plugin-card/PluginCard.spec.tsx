import type { ChildBridge, Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { FakeApi, FakeOpenModal, FakeWs } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth/auth.store'
import { pluginsCache } from '@/core/caching/plugins-cache'
import { Confirm } from '@/core/components/confirm/Confirm'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { DisablePlugin } from '@/core/plugins/disable-plugin/DisablePlugin'
import { Donate } from '@/core/plugins/donate/Donate'
import { managePlugins as realManagePlugins } from '@/core/plugins/manage-plugins'
import { PluginInfo } from '@/core/plugins/plugin-info/PluginInfo'
import { PluginLogs } from '@/core/plugins/plugin-logs/PluginLogs'
import { useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import * as modalModule from '@/core/ui/modal'
import { mobileDetect } from '@/core/utilities/mobile-detect'
import { ws as realWs } from '@/core/ws'
import { PluginCard } from '@/modules/plugins/plugin-card/PluginCard'
import { fakeApi, makeAuthState, makeChildBridge, makePlugin, makeSettingsState, renderWithProviders, toastStub } from '@/testing'

const toast = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/plugins/plugin-logs/PluginLogs', () => ({ PluginLogs: () => null }))
vi.mock('@/core/plugins/manage-plugins', () => ({
  managePlugins: {
    settings: vi.fn(),
    bridgeSettings: vi.fn(),
    checkAndUpdatePlugin: vi.fn(),
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    switchToScoped: vi.fn(),
    installAlternateVersion: vi.fn(),
    jsonEditor: vi.fn(),
    externalAccessories: vi.fn(),
    resetChildBridges: vi.fn(),
  },
}))

const managePlugins = realManagePlugins as unknown as Record<string, Mock>
const modal = modalModule as unknown as FakeOpenModal
const ws = realWs as unknown as FakeWs

/**
 * One plugin card can be in a lot of states at once, and the single "call to
 * action" icon it shows is chosen by a stack of conditions in the template.
 * Showing the wrong one sends the user to the wrong place - offering a set-up
 * prompt for a plugin that is already configured, or hiding an available
 * update behind a bridge warning.
 */
describe('pluginCard', () => {
  let api: FakeApi
  let current: Plugin

  beforeEach(() => {
    useAuthStore.setState(makeAuthState({ user: { admin: true } }) as any)
    useSettingsStore.setState(makeSettingsState())
    api = fakeApi()
    toast.current = toastStub()
    modal.opened.length = 0
    ws.namespaces.clear()
    ws.namespace('child-bridges')
    Object.values(managePlugins).forEach(fn => fn.mockClear())
    vi.spyOn(pluginsCache, 'invalidate').mockImplementation(() => {})
    vi.spyOn(mobileDetect.detect, 'mobile').mockReturnValue(null as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function render(plugin: Partial<Plugin> = {}, childBridges: ChildBridge[] = [], isSearchResult = false): HTMLElement {
    // A fresh plugin object per render: the card flips `disabled` on the
    // object it is given, so a shared fixture would leak between cases
    current = makePlugin(plugin)
    return renderWithProviders(<PluginCard plugin={current} childBridges={childBridges} isSearchResult={isSearchResult} />).container
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  /** Click an item of the actions menu by its label. */
  function menuItem(label: string): HTMLElement {
    const item = [...document.querySelectorAll<HTMLElement>('.dropdown-item')].find(node => node.textContent!.trim() === label)
    if (!item) {
      throw new Error(`no menu item ${label}`)
    }
    return item
  }

  /**
   * Which call-to-action icon the card is showing, if any.
   *
   * Scoped to the row beside the plugin name: the same icon names appear
   * again inside the actions menu, where they mean something different.
   */
  function actionIcon(element: HTMLElement): string | undefined {
    const header = element.querySelector('.card-title')!.parentElement!
    const icons = [
      'fa-arrow-alt-circle-up',
      'fa-arrow-right-arrow-left',
      'fa-sliders',
      'fa-bridge',
      'fa-qrcode',
      'fa-bridge-circle-exclamation',
      'fa-bridge-circle-xmark',
    ]
    return icons.find(icon => header.querySelector(`.${icon}:not([hidden])`))
  }

  describe('the call to action icon', () => {
    it('offers the update when one is available', () => {
      expect(actionIcon(render({ updateAvailable: true }))).toBe('fa-arrow-alt-circle-up')
    })

    it('offers the move to the homebridge scope', () => {
      const element = render({
        installedVersion: '1.0.0',
        newHbScope: { from: 'homebridge-test', to: '@homebridge-plugins/homebridge-test', switch: '1.0.0' },
      } as Partial<Plugin>)

      expect(actionIcon(element)).toBe('fa-arrow-right-arrow-left')
    })

    it('offers to set up a plugin that has no config yet', () => {
      expect(actionIcon(render({ isConfigured: false }))).toBe('fa-sliders')
    })

    it('suggests a child bridge when one is recommended', () => {
      const element = render({ isConfigured: true, hasChildBridges: false, recommendChildBridge: true })

      expect(actionIcon(element)).toBe('fa-bridge')
    })

    it('offers the pairing code for a bridge that is not paired yet', () => {
      const element = render(
        { isConfigured: true, hasChildBridges: true, hasChildBridgesUnpaired: true },
        [makeChildBridge({ status: 'ok' })],
      )

      expect(actionIcon(element)).toBe('fa-qrcode')
    })

    it('warns while a child bridge is still starting', () => {
      const element = render(
        { isConfigured: true, hasChildBridges: true, hasChildBridgesUnpaired: false },
        [makeChildBridge({ status: 'pending' })],
      )

      expect(actionIcon(element)).toBe('fa-bridge-circle-exclamation')
    })

    it('warns when a child bridge is down', () => {
      const element = render(
        { isConfigured: true, hasChildBridges: true, hasChildBridgesUnpaired: false },
        [makeChildBridge({ status: 'down' })],
      )

      expect(actionIcon(element)).toBe('fa-bridge-circle-xmark')
    })

    it('shows nothing when everything is healthy', () => {
      const element = render(
        { isConfigured: true, hasChildBridges: true, hasChildBridgesUnpaired: false },
        [makeChildBridge({ status: 'ok' })],
      )

      expect(actionIcon(element)).toBeUndefined()
    })

    it('says nothing to a non-admin', () => {
      useAuthStore.setState(makeAuthState({ user: { admin: false } }) as any)

      // A non-admin cannot act on any of it, so the prompts are pointless
      expect(actionIcon(render({ updateAvailable: true }))).toBeUndefined()
    })

    it('leaves a disabled plugin alone', () => {
      const element = render({ disabled: true, isConfigured: false })

      expect(actionIcon(element)).toBeUndefined()
    })
  })

  describe('the verification shield', () => {
    it.each([
      ['a homebridge scoped plugin', { isHbScoped: true, verifiedPlugin: false }, 'purple-text'],
      ['a verified plugin', { isHbScoped: false, verifiedPlugin: true }, 'green-text'],
      ['a verified plus plugin', { isHbScoped: false, verifiedPlugin: false, verifiedPlusPlugin: true }, 'green-text'],
      ['an unverified plugin', { isHbScoped: false, verifiedPlugin: false, verifiedPlusPlugin: false }, 'orange-text'],
    ])('is %s coloured %s', (_case, plugin, expected) => {
      const shield = render(plugin).querySelector('.fa-shield-alt')!

      expect(shield.classList.contains(expected)).toBe(true)
    })

    it('shows the scoped colour even for a verified plugin', () => {
      // Being in the homebridge scope is the stronger statement of the two
      const shield = render({ isHbScoped: true, verifiedPlusPlugin: true }).querySelector('.fa-shield-alt')!

      expect(shield.classList.contains('purple-text')).toBe(true)
      expect(shield.classList.contains('green-text')).toBe(false)
    })
  })

  describe('the child bridge status', () => {
    /** What the card shows for its bridges: the warning icon, or the restart button when all is well. */
    function shownStatus(element: HTMLElement): string {
      if (element.querySelector('.fa-bridge-circle-xmark')) {
        return 'down'
      }
      if (element.querySelector('.fa-bridge-circle-exclamation')) {
        return 'pending'
      }
      return element.querySelector('button > .fa-power-off.fa-lg') ? 'ok' : 'none'
    }

    it.each([
      ['all running', ['ok', 'ok'], 'ok'],
      ['one still starting', ['ok', 'pending'], 'pending'],
      ['one down', ['ok', 'down'], 'down'],
      ['one down and one starting', ['pending', 'down'], 'down'],
    ])('reports %s as %s', (_case, statuses, expected) => {
      // Worst first: a single failed bridge has to surface even when its
      // siblings are fine
      const element = render(
        { isConfigured: true, hasChildBridges: true },
        statuses.map(status => makeChildBridge({ status: status as any })),
      )

      expect(shownStatus(element)).toBe(expected)
    })
  })

  describe('the transport icons', () => {
    /** [hap enabled, matter enabled] as the card is showing them. */
    function transports(element: HTMLElement): boolean[] {
      return [...element.querySelectorAll('.transport-icon')].map(icon => icon.classList.contains('enabled'))
    }

    it('are only shown on a search result', () => {
      // An installed plugin already sits under whichever bridge it uses, so
      // the protocol badges only mean something while browsing
      expect(render({}, [], false).querySelector('.transport-icons')).toBeNull()
      expect(render({}, [], true).querySelector('.transport-icons')).not.toBeNull()
    })

    it.each([
      ['both protocols', { supportsHap: true, supportsMatter: true }, [true, true]],
      ['hap only', { supportsHap: true, supportsMatter: false }, [true, false]],
      ['matter only', { supportsHap: false, supportsMatter: true }, [false, true]],
      ['neither declared', {}, [true, false]],
    ])('shows %s', (_case, plugin, expected) => {
      // A plugin that declares nothing predates the keywords, and everything
      // from that era is hap
      expect(transports(render(plugin as Partial<Plugin>, [], true))).toEqual(expected)
    })
  })

  describe('the actions menu', () => {
    function menuItems(element: HTMLElement): string[] {
      return [...element.querySelectorAll('.dropdown-item')]
        .map(node => node.textContent!.trim())
        .filter(Boolean)
    }

    it('offers the usual actions for an installed plugin', () => {
      const items = menuItems(render({ isConfigured: true })).join(' ')

      expect(items).toContain('plugins.button_settings')
      expect(items).toContain('plugins.manage.json_config')
      expect(items).toContain('plugins.button_uninstall')
    })

    it('keeps the ui plugin out of the uninstall and disable options', () => {
      // Uninstalling or disabling the ui from inside the ui would lock the
      // user out of the only place they could undo it
      const items = menuItems(render({ name: '@mp-consulting/homebridge-config-glass-ui' })).join(' ')

      expect(items).not.toContain('plugins.button_uninstall')
      expect(items).not.toContain('plugins.manage.disable')
    })

    it('has no menu for a plugin that is not installed, only the install button', () => {
      const element = render({ installedVersion: undefined as any, publicPackage: true })

      expect(element.querySelector('.dropdown-menu')).toBeNull()
      expect(screen.getByLabelText('plugins.manage.install')).toBeInTheDocument()
    })
  })

  /**
   * Switching a plugin off and on again.
   *
   * ⚠️ **Disabling has to stop the plugin's child bridges too.** A disabled plugin
   * whose bridge is still running leaves its accessories in the Home app,
   * responding to nothing — which looks like broken hardware rather than a plugin
   * the user switched off.
   */
  describe('disabling and enabling a plugin', () => {
    async function disable() {
      fireEvent.click(menuItem('plugins.manage.disable'))
      await settle()
    }

    async function enable() {
      fireEvent.click(menuItem('plugins.manage.enable'))
      await settle()
    }

    it('asks first, telling the modal what it will affect', async () => {
      render({ name: 'homebridge-example', displayName: 'Example', isConfigured: true, isConfiguredDynamicPlatform: true })
      useSettingsStore.setState({ keepOrphans: true })

      await disable()

      expect(modal.lastOpened()!.component).toBe(DisablePlugin)
      expect(modal.lastOpened()!.props).toMatchObject({
        pluginName: 'Example',
        isConfigured: true,
        isConfiguredDynamicPlatform: true,
        keepOrphans: true,
      })
    })

    it('falls back to the package name when there is no display name', async () => {
      render({ name: 'homebridge-example', displayName: '' })

      await disable()

      expect(modal.lastOpened()!.props?.pluginName).toBe('homebridge-example')
    })

    it('disables the plugin once confirmed', async () => {
      const element = render({ name: 'homebridge-example' })

      await disable()
      act(() => modal.opened[0].ref.close())
      await settle()

      expect(api.lastCall('put')?.url).toBe('/config-editor/plugin/homebridge-example/disable')
      expect(current.disabled).toBe(true)
      // and the card shows it
      expect(element.querySelector('.red-text .fa-pause-circle')).not.toBeNull()
    })

    it('url-encodes a scoped plugin name', async () => {
      render({ name: '@scope/homebridge-example' })

      await disable()
      act(() => modal.opened[0].ref.close())
      await settle()

      expect(api.lastCall('put')?.url).toBe('/config-editor/plugin/%40scope%2Fhomebridge-example/disable')
    })

    it('forgets the cached plugin list, so the page reflects the change', async () => {
      render({ name: 'homebridge-example' })

      await disable()
      act(() => modal.opened[0].ref.close())
      await settle()

      expect(pluginsCache.invalidate).toHaveBeenCalled()
    })

    it('stops the child bridges it was running on', async () => {
      const bridge = makeChildBridge({ username: '0E:11:22:33:44:55', status: 'ok' })
      render({ name: 'homebridge-example', isConfigured: true, hasChildBridges: true }, [bridge])

      await disable()
      act(() => modal.opened[0].ref.close())
      await settle()

      expect(ws.namespace('child-bridges').requests.map(r => r.resource)).toContain('stop-child-bridge')
    })

    it('asks for a restart afterwards', async () => {
      render({ name: 'homebridge-example' })

      await disable()
      act(() => modal.opened[0].ref.close())
      await settle()

      expect(modal.lastOpened()!.component).toBe(RestartHomebridge)
    })

    it('changes nothing when the prompt is dismissed', async () => {
      render({ name: 'homebridge-example' })

      await disable()
      act(() => modal.opened[0].ref.dismiss())
      await settle()

      expect(api.callsTo('put')).toEqual([])
      expect(current.disabled).toBeFalsy()
    })

    it('says so when the plugin cannot be disabled', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('put', /disable/, new Error('config not writable'))
      render({ name: 'homebridge-example' })

      await disable()
      act(() => modal.opened[0].ref.close())
      await settle()

      expect(toast.current.error).toHaveBeenCalledWith('plugins.disable.error', 'toast.title_error')
      expect(current.disabled).toBeFalsy()
    })

    it('confirms before enabling, naming the plugin', async () => {
      render({ name: 'homebridge-example', displayName: 'Example', disabled: true })

      await enable()

      expect(modal.lastOpened()!.component).toBe(Confirm)
      expect(modal.lastOpened()!.props).toMatchObject({ title: 'homebridge-example' })
    })

    it('enables from the disabled icon as well', async () => {
      render({ name: 'homebridge-example', disabled: true })

      fireEvent.click(screen.getByLabelText('common.labels.disabled'))
      await settle()

      expect(modal.lastOpened()!.component).toBe(Confirm)
    })

    it('escapes the plugin name before it reaches the confirm dialog markup', async () => {
      // The confirm message is rendered as HTML, and the display name is
      // whatever the plugin author put in package.json
      render({ name: 'homebridge-example', displayName: '<img src=x>Example', disabled: true })
      const translate = vi.spyOn(i18n, 't')

      await enable()

      expect(translate).toHaveBeenCalledWith('plugins.manage.confirm_enable', { pluginName: '&lt;img src=x&gt;Example' })
    })

    it('enables the plugin once confirmed', async () => {
      render({ name: 'homebridge-example', disabled: true })

      await enable()
      act(() => modal.opened[0].ref.close())
      await settle()

      expect(api.lastCall('put')?.url).toBe('/config-editor/plugin/homebridge-example/enable')
      expect(current.disabled).toBe(false)
    })

    it('starts the child bridges again', async () => {
      const bridge = makeChildBridge({ username: '0E:11:22:33:44:55', status: 'down' })
      render({ name: 'homebridge-example', disabled: true, isConfigured: true, hasChildBridges: true }, [bridge])
      ws.namespace('child-bridges').socket.respondTo('start-child-bridge', {})

      await enable()
      act(() => modal.opened[0].ref.close())
      await settle()

      expect(ws.namespace('child-bridges').requests.map(r => r.resource)).toContain('start-child-bridge')
    })

    it('says so when the plugin cannot be enabled', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('put', /enable/, new Error('config not writable'))
      render({ name: 'homebridge-example', disabled: true })

      await enable()
      act(() => modal.opened[0].ref.close())
      await settle()

      expect(toast.current.error).toHaveBeenCalledWith('plugins.enable.error', 'toast.title_error')
    })
  })

  describe('acting on the child bridges', () => {
    const spinner = (element: HTMLElement) => element.querySelector('.fa-circle-notch')!

    function respondToAll() {
      const socket = ws.namespace('child-bridges').socket
      for (const action of ['restart', 'stop', 'start']) {
        socket.respondTo(`${action}-child-bridge`, {})
      }
    }

    it('sends the action to every bridge of the plugin', async () => {
      const bridges = [
        makeChildBridge({ username: '0E:11:22:33:44:55' }),
        makeChildBridge({ username: 'AA:BB:CC:DD:EE:FF' }),
      ]
      respondToAll()
      render({ isConfigured: true, hasChildBridges: true }, bridges)

      fireEvent.click(menuItem('child_bridge.restart_plural'))
      await settle()

      const requests = ws.namespace('child-bridges').requests
      expect(requests.map(r => r.payload)).toEqual(['0E:11:22:33:44:55', 'AA:BB:CC:DD:EE:FF'])
      expect(requests.every(r => r.resource === 'restart-child-bridge')).toBe(true)
    })

    it('shows the card as busy while it works', async () => {
      vi.useFakeTimers()
      respondToAll()
      const element = render({ isConfigured: true, hasChildBridges: true }, [makeChildBridge()])
      expect(spinner(element)).toHaveAttribute('hidden')

      fireEvent.click(menuItem('child_bridge.restart'))
      expect(spinner(element)).not.toHaveAttribute('hidden')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(12000)
      })
      expect(spinner(element)).toHaveAttribute('hidden')
    })

    it.each([
      ['restart', 'child_bridge.restart', 12000],
      ['stop', 'child_bridge.stop', 6000],
      ['start', 'child_bridge.start', 1000],
    ])('waits the %s settling time before saying it is done', async (_action, label, wait) => {
      // A bridge takes time to come back up, and the card would otherwise offer
      // the action again while it is still restarting
      vi.useFakeTimers()
      respondToAll()
      const stopped = label === 'child_bridge.start'
      const element = render({ isConfigured: true, hasChildBridges: true }, [makeChildBridge({ manuallyStopped: stopped })])

      fireEvent.click(menuItem(label))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(wait - 1)
      })
      expect(spinner(element)).not.toHaveAttribute('hidden')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(spinner(element)).toHaveAttribute('hidden')
    })

    it('says so when a bridge will not answer', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const element = render({ isConfigured: true, hasChildBridges: true }, [makeChildBridge()])
      ws.namespace('child-bridges').socket.respondTo('restart-child-bridge', { error: 'socket error' })

      fireEvent.click(menuItem('child_bridge.restart'))
      await settle()

      expect(toast.current.error).toHaveBeenCalled()
      expect(spinner(element)).toHaveAttribute('hidden')
    })

    it('offers start rather than stop once every bridge is stopped', () => {
      const element = render({ isConfigured: true, hasChildBridges: true }, [makeChildBridge({ manuallyStopped: true })])
      const items = [...element.querySelectorAll('.dropdown-item')].map(node => node.textContent!.trim())

      expect(items).toContain('child_bridge.start')
      expect(items).not.toContain('child_bridge.stop')
    })
  })

  describe('the plugin log and the info panels', () => {
    it('opens the log with the plugin and its bridges', () => {
      // The log is filtered per bridge, so it needs both
      const bridge = makeChildBridge({ username: '0E:11:22:33:44:55' })
      render({ name: 'homebridge-example', isConfigured: true, hasChildBridges: true }, [bridge])

      fireEvent.click(menuItem('plugins.manage.plugin_logs'))

      expect(modal.lastOpened()!.component).toBe(PluginLogs)
      expect(modal.lastOpened()!.props?.plugin.name).toBe('homebridge-example')
      expect(modal.lastOpened()!.props?.childBridges).toHaveLength(1)
    })

    it('opens the log wide, because log lines are long', () => {
      render({ name: 'homebridge-example' })

      fireEvent.click(menuItem('plugins.manage.plugin_logs'))

      expect(modal.lastOpened()!.options).toMatchObject({ size: 'xl', backdrop: 'static' })
    })

    it('opens the funding panel for the plugin asked about', () => {
      render({ name: 'homebridge-example', verifiedPlugin: true, funding: { type: 'github', url: 'https://github.com/sponsors/x' } })

      fireEvent.click(screen.getByLabelText('plugins.donate.tile_donate_to'))

      expect(modal.lastOpened()!.component).toBe(Donate)
      expect(modal.lastOpened()!.props?.plugin.name).toBe('homebridge-example')
    })

    it('opens the plugin information panel', () => {
      render({ name: 'homebridge-example' })

      fireEvent.click(screen.getByLabelText('plugins.button_info'))

      expect(modal.lastOpened()!.component).toBe(PluginInfo)
      expect(modal.lastOpened()!.props?.plugin.name).toBe('homebridge-example')
    })
  })

  describe('what the card hands to the plugin service', () => {
    it('asks for an update to the latest version', () => {
      render({ name: 'homebridge-example', latestVersion: '2.0.0', updateAvailable: true })

      fireEvent.click(screen.getByLabelText('plugins.button_update'))

      expect(managePlugins.checkAndUpdatePlugin).toHaveBeenCalledWith(current, '2.0.0')
    })

    it.each([
      ['the settings', { isConfigured: true }, () => menuItem('plugins.button_settings'), 'settings'],
      ['the bridge settings', { isConfigured: true, hasChildBridges: true }, () => menuItem('child_bridge.bridge_settings'), 'bridgeSettings'],
      ['the external accessories', { hasExternalAccessories: true }, () => menuItem('external_accessories.menu_label'), 'externalAccessories'],
      [
        'the scope switch',
        { newHbScope: { from: 'homebridge-example', to: '@homebridge-plugins/homebridge-example', switch: '1.0.0' } },
        () => screen.getByLabelText('plugins.manage.scoped.switch'),
        'switchToScoped',
      ],
      ['the version picker', {}, () => menuItem('plugins.manage.manage_version'), 'installAlternateVersion'],
      ['the json editor', {}, () => menuItem('plugins.manage.json_config'), 'jsonEditor'],
    ] as Array<[string, Partial<Plugin>, () => HTMLElement, string]>)('passes on %s', (_label, overrides, target, expected) => {
      render({ name: 'homebridge-example', ...overrides })

      fireEvent.click(target())

      expect(managePlugins[expected]).toHaveBeenCalledWith(current)
    })

    it('hands the uninstall its child bridges as well', () => {
      // They have to be torn down with it
      const bridge = makeChildBridge({ username: '0E:11:22:33:44:55' })
      render({ name: 'homebridge-example', isConfigured: true, hasChildBridges: true }, [bridge])

      fireEvent.click(menuItem('plugins.button_uninstall'))

      expect(managePlugins.uninstallPlugin).toHaveBeenCalledWith(current, expect.arrayContaining([bridge]))
    })

    it('hands the bridge reset the bridges to reset', () => {
      const bridge = makeChildBridge({ username: '0E:11:22:33:44:55' })
      render({ isConfigured: true, hasChildBridges: true }, [bridge])

      fireEvent.click(menuItem('child_bridge.reset_accessories'))

      expect(managePlugins.resetChildBridges).toHaveBeenCalledWith(expect.arrayContaining([bridge]))
    })
  })

  describe('the plugin icon and name', () => {
    const icon = (element: HTMLElement) => element.querySelector<HTMLImageElement>('img.plugin-icon-card')!
    const name = (element: HTMLElement) => element.querySelector('.card-title')!.textContent

    it('falls back to the homebridge icon when a plugin has none', () => {
      expect(icon(render({ icon: undefined }))).toHaveAttribute('src', 'assets/hb-icon.png')
    })

    it('falls back when the icon it was given will not load', () => {
      const element = render({ icon: 'https://example.com/gone.png' })

      fireEvent.error(icon(element))

      expect(icon(element)).toHaveAttribute('src', 'assets/hb-icon.png')
    })

    it('drops the homebridge prefix on a narrow screen', () => {
      // "Homebridge Example" wraps onto two lines on a phone; "Example" does not
      vi.mocked(mobileDetect.detect.mobile).mockReturnValue('iPhone')

      expect(name(render({ displayName: 'Homebridge Example' }))).toBe('Example')
    })

    it('keeps the full name on a desktop', () => {
      expect(name(render({ displayName: 'Homebridge Example' }))).toBe('Homebridge Example')
    })

    it('leaves a name that does not start with homebridge alone', () => {
      vi.mocked(mobileDetect.detect.mobile).mockReturnValue('iPhone')

      expect(name(render({ displayName: 'Example Plugin' }))).toBe('Example Plugin')
    })

    it('shows the release date of a plugin that is not installed', () => {
      const element = render({ installedVersion: undefined as any, latestVersion: '2.0.0', lastUpdated: '2024-03-05T12:00:00Z' })

      expect(element.querySelector('.card-text.grey-text')!.textContent).toContain('v2.0.0 (2024-03-05)')
    })

    it('gives the package name its full text as a title, for when it is cut short', () => {
      const element = render({ name: 'homebridge-a-very-long-package-name' })

      expect(element.querySelector('.card-text.text-truncate .card-link')).toHaveAttribute('title', 'homebridge-a-very-long-package-name')
    })

    it('shows the author line only when there is an author', () => {
      expect(render({ author: 'someone' }).textContent).toContain('@someone')
    })

    it('does not show a bare @ when the author is empty', () => {
      const element = render({ author: '' })

      expect(element.querySelector('.heart-muted')).toBeNull()
      expect(element.textContent).not.toContain('@')
    })
  })

  describe('rendering', () => {
    it('is memoised, so the same props do not render it again', () => {
      expect((PluginCard as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})
