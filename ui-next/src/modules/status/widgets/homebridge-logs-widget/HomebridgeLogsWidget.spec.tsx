import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { HomebridgeLogsWidget } from '@/modules/status/widgets/homebridge-logs-widget/HomebridgeLogsWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'
import { makeAuthState, makeSettingsState, renderWithProviders } from '@/testing'

const fakes = vi.hoisted(() => ({ log: {} as Record<string, any> }))

// The log service is faked: everything the widget does goes through a handful of its methods
vi.mock('@/core/utilities/terminal/instances', async () => {
  const { useSettingsStore: store } = await import('@/core/settings')
  return {
    terminalService: {},
    terminalNavigationGuard: {},
    createLogService: () => fakes.log,
    getTerminalSettings: () => store.getState().env?.terminal,
    confirmModal: vi.fn(),
  }
})

/**
 * The live Homebridge log on the dashboard. A search filter set here is
 * cleared on the way out, or the log would carry it with nothing on screen to
 * explain why.
 */
describe('the log widget', () => {
  let resizeEvent: ReturnType<typeof createWidgetEvent>
  let getTerminalOptions: ReturnType<typeof vi.spyOn>
  let getTerminalThemeOptions: ReturnType<typeof vi.spyOn>

  async function open(options: { settings?: Record<string, any>, widget?: Record<string, any>, admin?: boolean } = {}) {
    useSettingsStore.setState(makeSettingsState(options.settings))
    useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }))
    resizeEvent = createWidgetEvent()
    const result = renderWithProviders(
      <HomebridgeLogsWidget
        widget={{ component: 'HomebridgeLogsWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false, ...options.widget }}
        resizeEvent={resizeEvent}
        configureEvent={createWidgetEvent()}
        updateWidget={vi.fn()}
        saveWidgets={vi.fn()}
      />,
    )
    await act(async () => {})
    return result
  }

  const root = (container: HTMLElement) => container.querySelector('.hb-homebridge-logs-widget')!
  const body = (container: HTMLElement) => container.querySelector<HTMLElement>('.logs-body')!
  const searchInput = () => screen.getByPlaceholderText('logs.placeholder_search_logs') as HTMLInputElement
  const type = (value: string) => fireEvent.change(searchInput(), { target: { value } })

  beforeEach(() => {
    fakes.log = {
      // The widget reads options off the live terminal to apply font changes
      term: { options: { fontSize: 14, fontWeight: 400 }, scrollToBottom: vi.fn() },
      startTerminal: vi.fn(),
      destroyTerminal: vi.fn(),
      setSearchFilter: vi.fn(),
      clearSearchFilter: vi.fn(),
      scrollToBottom: vi.fn(),
      downloadLogFile: vi.fn(async () => undefined),
      truncateLogFile: vi.fn(async () => undefined),
    }
    getTerminalOptions = vi.spyOn(settingsActions, 'getTerminalOptions')
    getTerminalThemeOptions = vi.spyOn(settingsActions, 'getTerminalThemeOptions')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('follows the effective terminal theme', async () => {
    const dark = await open()
    expect(root(dark.container)).toHaveClass('widget-container-dark')
    dark.unmount()

    const light = await open({ settings: { actualLightingMode: 'light', env: { terminal: { lightingMode: 'light' } } } })
    expect(root(light.container)).not.toHaveClass('widget-container-dark')
  })

  it('opens a read-only terminal with no blinking cursor', async () => {
    await open()

    // A blinking cursor on a log nobody types into just draws the eye, and an
    // enabled stdin makes the hidden textarea a tab stop
    expect(getTerminalOptions).toHaveBeenCalledWith({ cursorBlink: false, disableStdin: true }, true)
    expect(fakes.log.startTerminal).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Object), resizeEvent, undefined)
  })

  it('fits itself to the box once the terminal is up', async () => {
    vi.useFakeTimers()
    const { container } = await open()
    vi.spyOn(root(container) as HTMLElement, 'offsetHeight', 'get').mockReturnValue(300)
    vi.spyOn(container.querySelector('.logs-card-header') as HTMLElement, 'offsetHeight', 'get').mockReturnValue(50)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(body(container).style.height).toBe('250px')
  })

  it('hides the toolbar from a non-admin, and when it is switched off', async () => {
    const off = await open({ widget: { showToolbar: false } })
    expect(off.container.querySelector('.logs-toolbar')).toBeNull()
    off.unmount()

    const user = await open({ admin: false, widget: { showToolbar: true } })
    expect(user.container.querySelector('.logs-toolbar')).toBeNull()
  })

  it('hands the download and truncate buttons to the service', async () => {
    await open({ widget: { showToolbar: true } })

    fireEvent.click(screen.getByLabelText('form.button_download'))
    fireEvent.click(screen.getByLabelText('form.button_delete'))

    expect(fakes.log.downloadLogFile).toHaveBeenCalled()
    expect(fakes.log.truncateLogFile).toHaveBeenCalled()
    expect(screen.getByLabelText('status.widget.logs_open_page')).toHaveAttribute('href', '/logs')
  })

  it('keeps a press on a toolbar button from dragging the widget', async () => {
    await open({ widget: { showToolbar: true } })
    const parent = vi.fn()
    document.addEventListener('mousedown', parent)

    fireEvent.mouseDown(screen.getByLabelText('form.search'))

    expect(parent).not.toHaveBeenCalled()
    document.removeEventListener('mousedown', parent)
  })

  it('clears a search filter it set on the way out', async () => {
    const { unmount } = await open({ widget: { showToolbar: true } })
    fireEvent.click(screen.getByLabelText('form.search'))
    type('homebridge')
    fireEvent.submit(searchInput().form!)
    expect(fakes.log.setSearchFilter).toHaveBeenCalledWith('homebridge')
    fakes.log.clearSearchFilter.mockClear()

    unmount()

    // Cleared while the terminal is still up, then the terminal goes
    expect(fakes.log.clearSearchFilter).toHaveBeenCalled()
    expect(fakes.log.destroyTerminal).toHaveBeenCalled()
    expect(fakes.log.clearSearchFilter.mock.invocationCallOrder[0]).toBeLessThan(fakes.log.destroyTerminal.mock.invocationCallOrder[0])
  })

  it('does not clear a filter it never set', async () => {
    const { unmount } = await open()
    fakes.log.clearSearchFilter.mockClear()

    unmount()

    expect(fakes.log.clearSearchFilter).not.toHaveBeenCalled()
  })

  it('stays collapsed for a screen reader until asked', async () => {
    const { container } = await open()
    const toggle = screen.getByRole('button', { name: 'status.widget.homebridge_logs' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', body(container).id)
    expect(body(container)).toHaveAttribute('aria-hidden', 'true')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(body(container)).not.toHaveAttribute('aria-hidden')
  })

  describe('searching', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    async function openSearch() {
      const result = await open({ widget: { showToolbar: true } })
      fireEvent.click(screen.getByLabelText('form.search'))
      return result
    }

    it('needs three characters, like the full page', async () => {
      await openSearch()

      type('ho')
      expect(searchInput()).toHaveClass('is-invalid')

      type('hom')
      expect(searchInput()).not.toHaveClass('is-invalid')
    })

    it('searches by itself after the user stops typing', async () => {
      await openSearch()

      type('homebridge')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(fakes.log.setSearchFilter).toHaveBeenCalledWith('homebridge')
    })

    it('trims the query in the box as well as the filter', async () => {
      await openSearch()

      type('  homebridge  ')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(fakes.log.setSearchFilter).toHaveBeenCalledWith('homebridge')
      expect(searchInput().value).toBe('homebridge')
    })

    it('clears an active search when the query gets too short', async () => {
      await openSearch()
      type('homebridge')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      type('ho')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(fakes.log.clearSearchFilter).toHaveBeenCalled()
    })

    it('closes the search box on an empty enter', async () => {
      await openSearch()

      fireEvent.submit(searchInput().form!)

      // The box takes room from a small widget, so an empty enter gives it back
      expect(screen.queryByPlaceholderText('logs.placeholder_search_logs')).toBeNull()
    })

    it('clears the filter when the search box is closed', async () => {
      await openSearch()
      type('homebridge')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      fireEvent.click(screen.getByLabelText('form.search'))

      expect(screen.queryByPlaceholderText('logs.placeholder_search_logs')).toBeNull()
      expect(fakes.log.clearSearchFilter).toHaveBeenCalled()
    })

    it('clears the search from the clear button', async () => {
      await openSearch()
      type('homebridge')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      fireEvent.click(screen.getByLabelText('form.button_clear'))

      expect(searchInput().value).toBe('')
      expect(fakes.log.clearSearchFilter).toHaveBeenCalled()
    })

    it('re-measures itself when the search box opens or closes', async () => {
      await open({ widget: { showToolbar: true } })
      const resized = vi.fn()
      resizeEvent.subscribe(resized)

      fireEvent.click(screen.getByLabelText('form.search'))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      // The terminal has to shrink to make room, or its last lines fall off the bottom
      expect(resized).toHaveBeenCalled()
    })
  })

  describe('following the global terminal settings', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('applies a new font size to the live terminal', async () => {
      await open()

      settingsActions.emitTerminalSettingsChanged({ fontSize: 20 })

      expect(fakes.log.term.options.fontSize).toBe(20)
    })

    it('applies a new font weight', async () => {
      await open()

      settingsActions.emitTerminalSettingsChanged({ fontWeight: '700' })

      expect(fakes.log.term.options.fontWeight).toBe('700')
    })

    it('applies a new lighting mode as a whole theme', async () => {
      await open()
      getTerminalThemeOptions.mockReturnValue({ theme: { background: '#ffffff' }, allowTransparency: true })

      settingsActions.emitTerminalSettingsChanged({ lightingMode: 'light' })

      // The theme is a block of colours from the settings, not one value
      expect(getTerminalThemeOptions).toHaveBeenCalledWith(true)
      expect(fakes.log.term.options.theme).toEqual({ background: '#ffffff' })
      expect(fakes.log.term.options.allowTransparency).toBe(true)
    })

    it('re-measures and scrolls after a change', async () => {
      await open()
      const resized = vi.fn()
      resizeEvent.subscribe(resized)

      settingsActions.emitTerminalSettingsChanged({ fontSize: 20 })
      await vi.advanceTimersByTimeAsync(100)

      // A bigger font means fewer lines fit, so the view has to come back to the newest output
      expect(resized).toHaveBeenCalled()
      expect(fakes.log.term.scrollToBottom).toHaveBeenCalled()
    })

    it('does nothing when the settings have not actually changed', async () => {
      await open()

      settingsActions.emitTerminalSettingsChanged({ fontSize: 14 })
      await vi.advanceTimersByTimeAsync(100)

      // Re-fitting the terminal for nothing makes the whole dashboard jump
      expect(fakes.log.term.scrollToBottom).not.toHaveBeenCalled()
    })

    it('ignores settings changes before the terminal exists', async () => {
      await open()
      fakes.log.term = null
      getTerminalThemeOptions.mockClear()

      settingsActions.emitTerminalSettingsChanged({ fontSize: 20 })

      expect(getTerminalThemeOptions).not.toHaveBeenCalled()
    })

    it('stops following once it is gone', async () => {
      const { unmount } = await open()
      unmount()

      settingsActions.emitTerminalSettingsChanged({ fontSize: 20 })

      expect(fakes.log.term.options.fontSize).toBe(14)
    })
  })
})
