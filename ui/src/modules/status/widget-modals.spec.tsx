import type { Widget } from '@/modules/status/widgets/widget.types'
import type { FakeApi, FakeIoNamespace, FakeWs } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatDatePattern } from '@/core/pipes/date-pattern'
import { useSettingsStore } from '@/core/settings'
import { Credits } from '@/modules/status/credits/Credits'
import { hasChanges, searchCountryCodeFormatter } from '@/modules/status/widget-control/widget-control.helpers'
import { WidgetControl } from '@/modules/status/widget-control/WidgetControl'
import { WidgetVisibility } from '@/modules/status/widget-visibility/WidgetVisibility'
import { activeModalStub, fakeApi, fakeWs, makeSettingsState } from '@/testing'

const holder = vi.hoisted(() => ({ ws: null as FakeWs | null }))
vi.mock('@/core/ws', () => ({
  get ws() {
    return holder.ws
  },
}))

/**
 * The two modals that configure the dashboard.
 *
 * The visibility modal decides which widgets exist at all, and stores the
 * decision inverted: the checkboxes are "show on desktop" and "show on mobile",
 * while the saved layout carries `hideOnDesktop` and `hideOnMobile`. It also has
 * to leave out widgets the server has switched off entirely, because offering a
 * terminal widget on an install with terminal access disabled produces a widget
 * that can never work.
 *
 * The control modal edits one widget's own settings, and does it on a copy -
 * dismissing has to leave the widget exactly as it was, which is easy to break
 * by editing the object the dashboard is holding.
 */
describe('the dashboard widget modals', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>
  let io: FakeIoNamespace
  let resetLayout: Mock<() => void>

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  /**
   * Build the visibility modal.
   * @param options - how to set it up
   * @param options.dashboard - the widgets currently on the dashboard
   * @param options.env - settings env overrides
   * @param options.featureFlags - the feature flags to enable
   */
  function openVisibility(options: {
    dashboard?: any[]
    env?: Record<string, any>
    featureFlags?: Record<string, boolean>
  } = {}) {
    useSettingsStore.setState(makeSettingsState({ env: { ...options.env, featureFlags: options.featureFlags ?? {} } }))
    activeModal = activeModalStub()
    resetLayout = vi.fn<() => void>()
    return render(<WidgetVisibility activeModal={activeModal as any} dashboard={options.dashboard ?? []} resetLayout={resetLayout} />)
  }

  /** The widget rows of the visibility modal, as { name, component, desktop, mobile }. */
  function rows() {
    return [...document.querySelectorAll<HTMLInputElement>('input[id^="desktop-"]')].map((desktop) => {
      const component = desktop.id.replace('desktop-', '')
      const mobile = document.getElementById(`mobile-${component}`) as HTMLInputElement
      return { name: desktop.closest('li')!.querySelector('.mb-2')!.textContent, component, desktop, mobile }
    })
  }
  const row = (component: string) => rows().find(r => r.component === component)!
  const saveButton = () => screen.getByRole('button', { name: 'form.button_save' })

  /**
   * Build the control modal for one widget.
   * @param widget - the widget being configured
   * @param options - how to set it up
   * @param options.serverInfoFails - make the server info request error
   * @param options.serverInfo - what the server info request returns
   * @param options.interfaces - the bridge network interfaces to offer
   */
  async function openControl(widget: Record<string, any>, options: {
    serverInfoFails?: boolean
    serverInfo?: Record<string, any>
    interfaces?: string[]
  } = {}) {
    api = fakeApi().respond('get', '/server/network-interfaces/bridge', options.interfaces ?? ['eth0', 'wlan0'])
    useSettingsStore.setState(makeSettingsState())
    activeModal = activeModalStub()
    holder.ws = fakeWs()
    io = holder.ws.namespace('status')
    io.socket.respondTo('get-homebridge-server-info', options.serverInfoFails
      ? { error: 'offline' }
      : (options.serverInfo ?? { nodeVersion: '22.0.0', homebridgeVersion: '2.0.0' }))

    const view = render(<WidgetControl activeModal={activeModal as any} widget={widget as Widget} />)
    await settle()
    return view
  }

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('choosing which widgets exist', () => {
    it('offers every widget the install supports', () => {
      openVisibility()

      const components = rows().map(entry => entry.component)
      expect(components).toContain('CpuWidgetComponent')
      expect(components).toContain('ClockWidgetComponent')
      expect(components).toContain('HapQrcodeWidgetComponent')
    })

    it('lists them in alphabetical order of their names', () => {
      openVisibility()

      // Translations return their own keys here, so this checks the sort is
      // applied rather than the English wording
      const names = rows().map(entry => entry.name!)
      expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names)
    })

    it('leaves out the accessories widget when accessory control is off', () => {
      openVisibility({ env: { enableAccessories: false } })

      // The widget would render an empty box with no way to fix it
      expect(rows().map(entry => entry.component)).not.toContain('AccessoriesWidgetComponent')
    })

    it('leaves out the terminal widget when terminal access is off', () => {
      openVisibility({ env: { enableTerminalAccess: false } })

      expect(rows().map(entry => entry.component)).not.toContain('TerminalWidgetComponent')
    })

    it('offers the matter pairing widget only when matter is supported', () => {
      const without = openVisibility()
      expect(rows().map(entry => entry.component)).not.toContain('MatterQrcodeWidgetComponent')
      without.unmount()

      openVisibility({ featureFlags: { matterSupport: true } })
      expect(rows().map(entry => entry.component)).toContain('MatterQrcodeWidgetComponent')
    })

    it('treats a widget that is not on the dashboard as hidden everywhere', () => {
      openVisibility({ dashboard: [] })

      expect(row('CpuWidgetComponent').desktop.checked).toBe(false)
      expect(row('CpuWidgetComponent').mobile.checked).toBe(false)
    })

    it('treats a widget on the dashboard as shown unless it says otherwise', () => {
      openVisibility({ dashboard: [{ component: 'CpuWidgetComponent' }] })

      // Older saved layouts have no hide flags at all, and those widgets are
      // visible on both
      expect(row('CpuWidgetComponent').desktop.checked).toBe(true)
      expect(row('CpuWidgetComponent').mobile.checked).toBe(true)
    })

    it('reads a widget hidden on one screen size only', () => {
      openVisibility({ dashboard: [{ component: 'CpuWidgetComponent', hideOnDesktop: true, hideOnMobile: false }] })

      expect(row('CpuWidgetComponent').desktop.checked).toBe(false)
      expect(row('CpuWidgetComponent').mobile.checked).toBe(true)
    })

    it('starts with nothing to save', () => {
      openVisibility({ dashboard: [{ component: 'CpuWidgetComponent' }] })

      expect(saveButton()).toBeDisabled()
    })

    it('notices a checkbox being ticked', () => {
      openVisibility()

      fireEvent.click(row('CpuWidgetComponent').desktop)

      expect(saveButton()).toBeEnabled()
    })

    it('goes back to unchanged when the tick is undone', () => {
      openVisibility()

      fireEvent.click(row('CpuWidgetComponent').desktop)
      fireEvent.click(row('CpuWidgetComponent').desktop)

      expect(saveButton()).toBeDisabled()
    })

    it('keeps the two screen sizes independent', () => {
      openVisibility({ dashboard: [{ component: 'CpuWidgetComponent' }] })

      fireEvent.click(row('CpuWidgetComponent').desktop)

      // A user hiding a big widget on their phone must not lose it on the desktop
      expect(row('CpuWidgetComponent').desktop.checked).toBe(false)
      expect(row('CpuWidgetComponent').mobile.checked).toBe(true)
    })

    it('keeps the two screen sizes independent from the mobile side too', () => {
      // ⚠️ The mobile toggle is its own copy of the desktop one. Written against
      // the wrong flag it would hide the widget on the desktop instead, which is
      // the opposite of what the user asked for
      openVisibility({ dashboard: [{ component: 'CpuWidgetComponent' }] })

      fireEvent.click(row('CpuWidgetComponent').mobile)

      expect(row('CpuWidgetComponent').mobile.checked).toBe(false)
      expect(row('CpuWidgetComponent').desktop.checked).toBe(true)
    })

    it('notices a mobile checkbox being ticked', () => {
      openVisibility()

      fireEvent.click(row('CpuWidgetComponent').mobile)

      expect(saveButton()).toBeEnabled()
    })

    it('leaves the other widgets alone when one is toggled', () => {
      openVisibility({ dashboard: [{ component: 'CpuWidgetComponent' }, { component: 'MemoryWidgetComponent' }] })

      fireEvent.click(row('CpuWidgetComponent').mobile)

      expect(row('MemoryWidgetComponent').mobile.checked).toBe(true)
      expect(row('MemoryWidgetComponent').desktop.checked).toBe(true)
    })

    it('closes with the hide flags the layout actually stores', () => {
      openVisibility({ dashboard: [{ component: 'CpuWidgetComponent' }] })
      fireEvent.click(row('CpuWidgetComponent').desktop)

      fireEvent.click(saveButton())

      // The checkboxes are positives and the saved layout is negatives, so this
      // inversion is the one thing that has to be right
      const result = activeModal.close.mock.calls[0][0]
      const cpu = result.find((entry: any) => entry.component === 'CpuWidgetComponent')
      expect(cpu.showOnDesktop).toBe(false)
      expect(cpu.hideOnDesktop).toBe(true)
      expect(cpu.hideOnMobile).toBe(false)
    })

    it('sends the size and order the widget should be created at, and which need configuring', () => {
      openVisibility()
      fireEvent.click(row('CpuWidgetComponent').desktop)

      fireEvent.click(saveButton())

      // The caller needs these to place a newly enabled widget on the grid
      const result = activeModal.close.mock.calls[0][0]
      const cpu = result.find((entry: any) => entry.component === 'CpuWidgetComponent')
      expect(cpu).toMatchObject({ cols: 5, rows: 3, mobileOrder: 40 })
      expect(cpu.requiresConfig).toBeUndefined()
      // The weather widget needs a location picking
      expect(result.find((entry: any) => entry.component === 'WeatherWidgetComponent').requiresConfig).toBe(true)
    })

    it('resets the layout through the callback and gets out of the way', () => {
      openVisibility()

      fireEvent.click(screen.getByRole('button', { name: 'form.button_reset' }))

      // Dismissed rather than closed: the caller must not then apply this
      // modal's own entries on top of the freshly reset layout
      expect(resetLayout).toHaveBeenCalled()
      expect(activeModal.dismiss).toHaveBeenCalled()
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('dismisses from the close buttons', () => {
      openVisibility()

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[0])

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })
  })

  describe('editing one widget', () => {
    it('reads the existing server info for the panel', async () => {
      await openControl({ component: 'UpdateInfoWidgetComponent' }, { serverInfo: { homebridgeRunningInDocker: true } })

      // `getExistingNamespace`, not a fresh connection: the status page behind
      // this modal already has the socket open
      expect(holder.ws!.getExistingNamespace).toHaveBeenCalledWith('status')
      expect(holder.ws!.connectToNamespace).not.toHaveBeenCalled()
      // Running in docker offers the docker panel setting
      expect(screen.getByLabelText('status.widget.expand_docker')).toBeInTheDocument()
    })

    it('copes with the server info being unavailable', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await openControl({ component: 'UpdateInfoWidgetComponent' }, { serverInfoFails: true })

      expect(screen.queryByLabelText('status.widget.expand_docker')).toBeNull()
      expect(screen.getByLabelText('status.widget.hide_npm')).toBeInTheDocument()
    })

    it('offers the bridge network interfaces for the network widget', async () => {
      await openControl({ component: 'NetworkWidgetComponent' })

      const options = [...screen.getByLabelText<HTMLSelectElement>('status.widget.network.network_interface').options].map(o => o.value)
      expect(options).toEqual(['eth0', 'wlan0'])
    })

    it('lets the network widget switch between bits and bytes', async () => {
      await openControl({ component: 'NetworkWidgetComponent' })

      const select = screen.getByLabelText<HTMLSelectElement>('status.widget.network.unit')
      expect(select.value).toBe('bits')
      fireEvent.change(select, { target: { value: 'bytes' } })

      expect(saveButton()).toBeEnabled()
    })

    it('says so when there are no interfaces to offer', async () => {
      await openControl({ component: 'NetworkWidgetComponent' }, { interfaces: [] })

      expect(screen.getByText('status.widget.network.none_selected')).toBeInTheDocument()
    })

    it('does not ask for network interfaces for other widgets', async () => {
      await openControl({ component: 'CpuWidgetComponent' })

      // Only one widget can use them, and the lookup is a server round trip
      expect(api.callsTo('get', '/server/network-interfaces/bridge')).toHaveLength(0)
    })

    it('starts with nothing to save', async () => {
      await openControl({ component: 'CpuWidgetComponent', refreshInterval: 10 })

      expect(saveButton()).toBeDisabled()
    })

    it('notices each setting a widget can change', () => {
      const cases: Array<[string, any]> = [
        ['showNpmVersion', true],
        ['dockerExpanded', true],
        ['timeFormat', 'H:mm'],
        ['dateFormat', 'EEEE'],
        ['refreshInterval', 30],
        ['historyItems', 50],
        ['networkInterface', 'wlan0'],
        ['networkUnit', 'bytes'],
        ['showToolbar', true],
      ]

      const original = { component: 'CpuWidgetComponent' } as Widget
      // Collected rather than asserted per field, so a failure names every
      // setting the change check has forgotten about rather than just the first
      const missed = cases.filter(([field, value]) => !hasChanges({ ...original, [field]: value }, original)).map(([field]) => field)
      expect(missed).toEqual([])
    })

    it('notices the weather location changing', () => {
      const original = { component: 'WeatherWidgetComponent', location: { id: '1', name: 'London' } } as unknown as Widget

      // Compared by id, because the typeahead hands back a fresh object every
      // time even for the same city
      expect(hasChanges({ ...original, location: { id: '2', name: 'Paris' } }, original)).toBe(true)
      expect(hasChanges({ ...original, location: { id: '1', name: 'London' } }, original)).toBe(false)
    })

    it('edits a number setting', async () => {
      await openControl({ component: 'CpuWidgetComponent', refreshInterval: 10, historyItems: 60 })

      fireEvent.change(screen.getByLabelText('status.widget.network.refresh_interval'), { target: { value: '30' } })
      fireEvent.click(saveButton())

      // Saved as a number, as ngModel on a number input gave
      expect(activeModal.close).toHaveBeenCalledWith(expect.objectContaining({ refreshInterval: 30, historyItems: 60 }))
    })

    it('edits the clock formats, showing each as it would look', async () => {
      await openControl({ component: 'ClockWidgetComponent', timeFormat: 'H:mm', dateFormat: 'yyyy-MM-dd' })

      const time = screen.getByLabelText<HTMLSelectElement>('status.widget.clock_timeformat')
      expect(time.options).toHaveLength(4)
      expect(time.options[2].textContent).toBe(formatDatePattern(new Date(), 'H:mm'))
      fireEvent.change(time, { target: { value: 'h:mm a' } })
      fireEvent.change(screen.getByLabelText('status.widget.clock_dateformat'), { target: { value: 'EEEE' } })
      fireEvent.click(saveButton())

      expect(activeModal.close).toHaveBeenCalledWith(expect.objectContaining({ timeFormat: 'h:mm a', dateFormat: 'EEEE' }))
    })

    it('edits a checkbox setting', async () => {
      await openControl({ component: 'HomebridgeLogsWidgetComponent' })

      fireEvent.click(screen.getByLabelText('status.widget.show_toolbar'))
      fireEvent.click(saveButton())

      expect(activeModal.close).toHaveBeenCalledWith(expect.objectContaining({ showToolbar: true }))
    })

    it('leaves the widget alone when dismissed', async () => {
      const widget = { component: 'CpuWidgetComponent', refreshInterval: 10 }
      await openControl(widget)
      fireEvent.change(screen.getByLabelText('status.widget.network.refresh_interval'), { target: { value: '60' } })

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[0])

      // The modal edits a copy for exactly this reason: cancelling has to leave
      // the running widget untouched
      expect(widget.refreshInterval).toBe(10)
      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })

    it('hands the edited copy back when saved', async () => {
      const widget = { component: 'CpuWidgetComponent', refreshInterval: 10, x: 3 }
      await openControl(widget)
      fireEvent.change(screen.getByLabelText('status.widget.network.refresh_interval'), { target: { value: '60' } })

      fireEvent.click(saveButton())

      // The dashboard merges it into the layout item; every other key comes back as it was
      expect(activeModal.close).toHaveBeenCalledWith({ component: 'CpuWidgetComponent', refreshInterval: 60, x: 3 })
      expect(widget.refreshInterval).toBe(10)
    })
  })

  describe('searching for a weather location', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
      fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
    })

    const respond = (body: any, ok = true) => fetchMock.mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })
    const input = () => screen.getByLabelText<HTMLInputElement>('status.widget.weather.label_search_for_your_city')

    async function type(...terms: string[]) {
      for (const term of terms) {
        fireEvent.change(input(), { target: { value: term } })
      }
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })
      await settle()
    }

    async function openWeather(location?: Record<string, any>) {
      await openControl({ component: 'WeatherWidgetComponent', location })
      vi.useFakeTimers()
    }

    it('shows the current location', async () => {
      await openWeather({ id: 2643743, name: 'London', country: 'GB' })

      expect(input().value).toBe('London, GB')
    })

    it('ignores a query too short to be a place name', async () => {
      await openWeather()

      await type('Lo')

      // Two letters would match half the world, and this is a third-party API
      // with a rate limit
      expect(fetchMock).not.toHaveBeenCalled()
      expect(screen.queryByRole('listbox')).toBeNull()
    })

    it('waits for the user to stop typing', async () => {
      respond({ list: [] })
      await openWeather()

      await type('Lon', 'Lond', 'London')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const url = new URL(fetchMock.mock.calls[0][0])
      expect(url.origin + url.pathname).toBe('https://api.openweathermap.org/data/2.5/find')
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ q: 'London', type: 'like', sort: 'population', cnt: '30' })
    })

    it('offers the cities and stores the one picked', async () => {
      respond({ list: [{ id: 2643743, name: 'London', sys: { country: 'GB' }, coord: { lat: 51.5, lon: -0.13 } }] })
      await openWeather()

      await type('London')
      fireEvent.click(screen.getByRole('option', { name: 'London, GB' }))
      fireEvent.click(saveButton())

      expect(input().value).toBe('London, GB')
      expect(activeModal.close).toHaveBeenCalledWith(expect.objectContaining({
        location: { id: 2643743, name: 'London', country: 'GB', coord: { lat: 51.5, lon: -0.13 } },
      }))
      expect(searchCountryCodeFormatter({ name: 'London', country: 'GB' })).toBe('London, GB')
    })

    it('picks with the keyboard', async () => {
      respond({ list: [
        { id: 1, name: 'London', sys: { country: 'GB' }, coord: {} },
        { id: 2, name: 'London', sys: { country: 'CA' }, coord: {} },
      ] })
      await openWeather()

      await type('London')
      fireEvent.keyDown(input(), { key: 'ArrowDown' })
      fireEvent.keyDown(input(), { key: 'Enter' })

      expect(input().value).toBe('London, CA')
    })

    it('gives up quietly when the weather service cannot be reached', async () => {
      respond('nope', false)
      await openWeather()

      await type('London')

      // An error here must not kill the search, or the box stops working until
      // the modal is reopened
      expect(screen.queryByRole('listbox')).toBeNull()
      expect(document.querySelector('.fa-city')).not.toBeNull()

      respond({ list: [{ id: 1, name: 'Paris', sys: { country: 'FR' }, coord: {} }] })
      await type('Paris')
      expect(screen.getByRole('option', { name: 'Paris, FR' })).toBeInTheDocument()
    })

    it('shows the spinner while searching', async () => {
      let resolve: (value: any) => void = () => {}
      fetchMock.mockReturnValue(new Promise((r) => {
        resolve = r
      }))
      await openWeather()

      await type('London')
      expect(document.querySelector('.fa-circle-notch.fa-spin')).not.toBeNull()

      await act(async () => resolve({ ok: true, json: async () => ({ list: [] }) }))
      await settle()

      expect(document.querySelector('.fa-city')).not.toBeNull()
    })

    it('forgets the location while the typed text is not a picked city', async () => {
      // `editable: false`: free text is never saved as a location
      await openWeather({ id: 1, name: 'London', country: 'GB' })

      fireEvent.change(input(), { target: { value: 'Somewhere' } })
      fireEvent.click(saveButton())

      expect(activeModal.close).toHaveBeenCalledWith(expect.objectContaining({ location: undefined }))
    })
  })

  describe('the credits', () => {
    it('thanks the translators and closes', () => {
      activeModal = activeModalStub()
      render(<Credits activeModal={activeModal as any} />)

      expect(screen.getByRole('link', { name: 'seidnerj' })).toHaveAttribute('href', 'https://github.com/seidnerj')

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[1])
      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })
  })
})
