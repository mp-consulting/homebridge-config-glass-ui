import type { FakeApi, FakeOpenModal } from '@/testing'

import { act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import { Settings } from '@/modules/settings/Settings'
import { SslSettingsModal } from '@/modules/settings/ssl-settings-modal/SslSettingsModal'
import { Wallpaper } from '@/modules/settings/wallpaper/Wallpaper'
import { fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const modal = modalModule as unknown as FakeOpenModal

/**
 * The settings page as rendered: the sections, the index beside them, the search
 * box and the controls. The saves themselves are pinned in settings.spec.tsx;
 * these check that each section shows what the Angular template showed, and that
 * its controls reach those saves.
 */
describe('the settings page, rendered', () => {
  let api: FakeApi

  async function render(env: Record<string, any> = {}, deps: Record<string, any> = {}) {
    useSettingsStore.setState(makeSettingsState({ env }))
    const result = renderWithProviders(
      <Settings deps={{ isPwa: false, bootLocale: 'en', terminal: { hasActiveSession: () => false, destroyPersistentSession: async () => {} }, ...deps }} />,
      { route: '/settings' },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    return result
  }

  const settle = () => act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    modal.opened.length = 0
    resetSettingsStore()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsActions, 'showRestartToast').mockImplementation(() => {})
    vi.spyOn(settingsActions, 'setPageTitle').mockImplementation(() => {})
    api = fakeApi()
      .respond('get', '/platform-tools/hb-service/homebridge-startup-settings', { HOMEBRIDGE_DEBUG: false, HOMEBRIDGE_KEEP_ORPHANS: false, HOMEBRIDGE_INSECURE: true, ENV_DEBUG: '', ENV_NODE_OPTIONS: '' })
      .respond('get', '/server/network-interfaces/system', [{ iface: 'eth0', ip4: '192.168.1.10' }])
      .respond('get', '/server/network-interfaces/bridge', ['eth0', 'wlan0'])
      .respond('get', '/server/mdns-advertiser', { advertiser: 'ciao' })
      .respond('get', '/server/port', { port: 51826 })
      .respond('get', '/server/ports', { start: 52100, end: 52200 })
      .respond('get', '/config-editor/matter', { enabled: true, port: 5540 })
      .respond('get', '/config-editor/matter/ports', { start: 5550, end: 5560 })
      .respond('get', '/config-editor/hap', { enabled: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows a spinner until the settings are read, then the sections', async () => {
    useSettingsStore.setState(makeSettingsState())
    const { container } = renderWithProviders(<Settings deps={{ isPwa: false, bootLocale: 'en' }} />, { route: '/settings' })
    expect(container.querySelector('.app-spinner-container')).not.toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(container.querySelector('.app-spinner-container')).toBeNull()
    expect(container.querySelector('.settings-layout')).not.toBeNull()
  })

  it('sets the page title', async () => {
    await render()

    expect(settingsActions.setPageTitle).toHaveBeenCalledWith('menu.label_settings')
  })

  it('renders every section in the order of the Angular page', async () => {
    const { container } = await render()

    const ids = [...container.querySelectorAll('.settings-section')].map(section => section.id)
    expect(ids).toEqual([
      'settings-section-general',
      'settings-section-display',
      'settings-section-startup',
      'settings-section-network',
      'settings-section-terminal',
      'settings-section-security',
      'settings-section-cache',
      'settings-section-reset',
    ])
  })

  it('adds the hap and matter sections with matter support', async () => {
    const { container } = await render({ featureFlags: { matterSupport: true } })

    expect(container.querySelector('#settings-section-hap #fieldsHap')).not.toBeNull()
    expect(container.querySelector('#settings-section-matter #fieldsMatter')).not.toBeNull()
    // The matter port row only exists while matter is on
    expect(container.querySelector('#fieldsMatter input[placeholder="5540"]')).not.toBeNull()
    expect([...container.querySelectorAll('.settings-nav-item span')].map(span => span.textContent)).toContain('settings.hap.title')
  })

  it('lists the sections in the index, the first one current', async () => {
    const { container } = await render()

    const items = [...container.querySelectorAll('.settings-nav .settings-nav-item')]
    expect(items).toHaveLength(8)
    expect(items[0]).toHaveClass('active')
    expect(items[0]).toHaveAttribute('aria-current', 'true')
    expect(items[1]).not.toHaveAttribute('aria-current')
  })

  it('collapses and expands a section from its heading', async () => {
    const { container } = await render()
    const toggle = container.querySelector<HTMLButtonElement>('#settings-section-general .disclosure-toggle')!

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'fieldsGeneral')
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('#fieldsGeneral')).toBeNull()
    expect(toggle.querySelector('i')).toHaveClass('fa-chevron-right')
  })

  it('opens a collapsed section when its index entry is picked', async () => {
    const { container } = await render()
    fireEvent.click(container.querySelector('#settings-section-display .disclosure-toggle')!)

    fireEvent.click(container.querySelectorAll('.settings-nav-item')[1])

    expect(container.querySelector('#fieldsDisplay')).not.toBeNull()
    expect(container.querySelectorAll('.settings-nav-item')[1]).toHaveClass('active')
  })

  describe('the search box', () => {
    it('is opened by the search button and focused', async () => {
      const { container } = await render()
      const button = container.querySelector<HTMLButtonElement>('[aria-controls="settings-search-region"]')!

      fireEvent.click(button)

      const input = container.querySelector<HTMLInputElement>('#settings-search-region .search-bar')!
      expect(input).not.toBeNull()
      expect(document.activeElement).toBe(input)
      expect(button).toHaveAttribute('aria-expanded', 'true')
      expect(button.querySelector('i')).toHaveClass('fas', 'fa-search', 'primary-text')
    })

    it('collapses the rows that do not match and drops empty sections', async () => {
      const { container } = await render()
      fireEvent.click(container.querySelector('[aria-controls="settings-search-region"]')!)

      fireEvent.change(container.querySelector('.search-bar')!, { target: { value: 'settings.display.lang' } })

      expect(container.querySelector('#settings-section-general')).toBeNull()
      const rows = [...container.querySelectorAll('#fieldsDisplay > li')]
      expect(rows[0]).not.toHaveClass('setting-hidden')
      expect(rows[1]).toHaveClass('setting-hidden')
      expect(rows[1]).toHaveAttribute('inert')
      expect([...container.querySelectorAll('.settings-nav-item')]).toHaveLength(1)
    })

    it('is cleared by its clear button', async () => {
      const { container } = await render()
      fireEvent.click(container.querySelector('[aria-controls="settings-search-region"]')!)
      fireEvent.change(container.querySelector('.search-bar')!, { target: { value: 'nothing-matches-this' } })
      expect(container.querySelector('.settings-section')).toBeNull()

      fireEvent.click(container.querySelector('.search-bar-clear')!)

      expect(container.querySelectorAll('.settings-section')).toHaveLength(8)
      expect(container.querySelector('.search-bar-clear')).toBeNull()
    })
  })

  describe('the controls', () => {
    it('fills each control from what was read', async () => {
      const { container } = await render({ homebridgeInstanceName: 'Front Room', temperatureUnits: 'f' })

      expect(container.querySelector<HTMLInputElement>('#fieldsGeneral input')!.value).toBe('Front Room')
      expect(container.querySelector<HTMLInputElement>('input[aria-label="settings.network.port_hb"]')!.value).toBe('51826')
      expect(container.querySelector<HTMLInputElement>('#homebridgeInsecureMode')!.checked).toBe(true)
      expect(container.querySelector<HTMLInputElement>('#uiGlassMode')!.checked).toBe(true)
    })

    it('saves the homebridge name typed into its box', async () => {
      const { container } = await render()

      fireEvent.change(container.querySelector('#fieldsGeneral input')!, { target: { value: 'Back Room' } })
      await settle()

      expect(api.lastCall('put', '/server/name')?.body).toEqual({ name: 'Back Room' })
      expect(container.querySelector('#fieldsGeneral .save-indicator')).not.toBeNull()
    })

    it('marks a refused value in its box', async () => {
      const { container } = await render()
      const input = container.querySelector<HTMLInputElement>('input[aria-label="settings.network.port_ui"]')!

      fireEvent.change(input, { target: { value: '80' } })
      await settle()

      expect(input).toHaveClass('is-invalid')
      expect(input.value).toBe('80')
    })

    it('saves a switch as soon as it settles', async () => {
      const { container } = await render()

      fireEvent.click(container.querySelector('#accessoryDebug')!)
      await settle()

      expect(api.lastCall('patch', '/config-editor/ui')?.body).toMatchObject({ 'accessoryControl.debug': true })
    })

    it('saves the font size as a number', async () => {
      const { container } = await render()

      fireEvent.change(container.querySelector('select[aria-label="settings.terminal.font_size"]')!, { target: { value: '16' } })
      await settle()

      expect(api.lastCall('patch', '/config-editor/ui')?.body).toMatchObject({ 'terminal.fontSize': 16 })
    })

    it('shows the security-control row only in insecure mode', async () => {
      const { container } = await render()
      const row = container.querySelector('[aria-label="settings.security.ui_control"]')!.closest('li')!

      expect(row).not.toHaveClass('setting-hidden')
      fireEvent.click(container.querySelector('#homebridgeInsecureMode')!)
      expect(row).toHaveClass('setting-hidden')
    })

    it('shows the interfaces the bridge is on, and the one that has gone', async () => {
      const { container } = await render()

      const badges = [...container.querySelectorAll('#fieldsNetwork .badge')]
      expect(badges.map(badge => badge.className)).toEqual(['badge badge-primary me-1 badge-info', 'badge badge-primary me-1 badge-danger'])
      expect(badges[1].textContent).toContain('settings.mdns_advertiser_not_connected')
    })

    it('opens the https modal from the https switch', async () => {
      const { container } = await render()

      fireEvent.click(container.querySelector('#httpsEnabled')!)

      expect(modal.lastOpened()!.component).toBe(SslSettingsModal)
    })

    it('opens the wallpaper modal from its row', async () => {
      const { container } = await render()

      fireEvent.click(container.querySelector('[aria-label="settings.display.wallpaper"]')!)

      expect(modal.lastOpened()!.component).toBe(Wallpaper)
    })

    it('locks the host, proxy, port and https switch in an installed app', async () => {
      const { container } = await render({}, { isPwa: true })

      expect(container.querySelector('input[aria-label="settings.network.host"]')).toBeDisabled()
      expect(container.querySelector('input[aria-label="settings.network.proxy"]')).toBeDisabled()
      expect(container.querySelector('input[aria-label="settings.network.port_ui"]')).toBeDisabled()
      expect(container.querySelector('#httpsEnabled')).toBeDisabled()
      expect(container.querySelectorAll('.fa-exclamation-triangle.red-text').length).toBeGreaterThanOrEqual(4)
    })

    it('hides the linux rows on another platform', async () => {
      const { container } = await render({ platform: 'darwin' })

      expect(container.querySelector('input[placeholder="shutdown"]')).toBeNull()
    })

    it('links to the user accounts and the docker startup script', async () => {
      const { container } = await render({ runningInDocker: true })

      expect(container.querySelector('a[aria-label="menu.tooltip_user_accounts"]')).toHaveAttribute('href', '/users')
      expect(container.querySelector('a[aria-label="menu.docker.startup_script"]')).toHaveAttribute('href', '/platform-tools/docker/startup-script')
    })

    it('title-cases the reset-all heading', async () => {
      const { container } = await render()

      expect(container.querySelector('[aria-label="reset.bridge_all.title"]')!.closest('li')!.textContent).toContain('Reset.bridge_all.title')
    })
  })
})
