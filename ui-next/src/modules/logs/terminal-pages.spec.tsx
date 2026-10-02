import type { ReactElement } from 'react'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth'
import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import { Logs } from '@/modules/logs/Logs'
import { Terminal } from '@/modules/platform-tools/terminal/Terminal'
import { makeAuthState, makeSettingsState, renderWithProviders } from '@/testing'

const fakes = vi.hoisted(() => ({
  log: {} as Record<string, any>,
  terminal: {} as Record<string, any>,
  guard: {} as Record<string, any>,
}))

// The services are faked rather than mocked at the xterm level: everything these
// pages do goes through a handful of their methods
vi.mock('@/core/utilities/terminal/instances', async () => {
  const { useSettingsStore: store } = await import('@/core/settings')
  return {
    get terminalService() {
      return fakes.terminal
    },
    get terminalNavigationGuard() {
      return fakes.guard
    },
    createLogService: () => fakes.log,
    getTerminalSettings: () => store.getState().env?.terminal,
    confirmModal: vi.fn(),
  }
})

/**
 * The two full-screen terminal pages: the Homebridge log, and the shell.
 *
 * Neither draws anything itself - both hand a target element to a service that
 * owns the xterm instance - so what is actually under test is the surrounding
 * behaviour: which body classes are set so the page is not briefly white on a
 * black terminal, the fade timings the leave guard waits for, and (on the log
 * page) the three-character minimum on the search box.
 */
describe('the terminal pages', () => {
  let getTerminalOptions: ReturnType<typeof vi.spyOn>
  let setPageTitle: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetSettingsStore()
    useAuthStore.setState(makeAuthState())
    fakes.log = {
      startTerminal: vi.fn(),
      destroyTerminal: vi.fn(),
      setSearchFilter: vi.fn(),
      clearSearchFilter: vi.fn(),
      scrollToBottom: vi.fn(),
      downloadLogFile: vi.fn(async () => undefined),
      truncateLogFile: vi.fn(async () => undefined),
    }
    fakes.terminal = {
      startTerminal: vi.fn(),
      reconnectTerminal: vi.fn(),
      destroyTerminal: vi.fn(),
      detachTerminal: vi.fn(),
      destroyPersistentSession: vi.fn(async () => undefined),
      activateTerminal: vi.fn(),
      isTerminalReady: vi.fn(() => false),
      hasActiveSession: vi.fn(() => false),
      onTouchStart: vi.fn(),
      onTouchEnd: vi.fn(),
    }
    fakes.guard = {
      canDeactivate: vi.fn(async () => true),
      handleBeforeUnload: vi.fn(),
    }
    getTerminalOptions = vi.spyOn(settingsActions, 'getTerminalOptions')
    setPageTitle = vi.spyOn(settingsActions, 'setPageTitle')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /**
   * Render one of the two pages at `/page`, so a navigation to either terminal
   * path counts as leaving it.
   */
  async function open(ui: ReactElement, options: { settings?: Parameters<typeof makeSettingsState>[0], arrange?: () => void } = {}) {
    useSettingsStore.setState(makeSettingsState(options.settings) as any)
    options.arrange?.()
    const view = renderWithProviders(ui, { route: '/page' })
    await act(async () => {})
    return view
  }

  /** The classes currently on the body element. */
  function bodyClasses(): string[] {
    return [...document.body.classList]
  }

  /**
   * Start a navigation away, and let the router and the blocker get as far as
   * the page's leave handler (it takes a few scheduler ticks), so the fade
   * timings below count from the moment the fade starts.
   *
   * The navigation is not wrapped in `act`: one held by the blocker would keep
   * an async act scope open, and every later render would queue behind it.
   */
  async function leave(view: Awaited<ReturnType<typeof open>>, to: string) {
    const from = view.router.state.location.pathname
    void view.router.navigate(to)
    const terminal = () => document.querySelector('#log-output, #docker-terminal')
    for (let tick = 0; tick < 100; tick += 1) {
      if (terminal()?.classList.contains('fade-out') || view.router.state.location.pathname !== from) {
        break
      }
      await act(() => vi.advanceTimersByTimeAsync(1))
    }
    return {
      path: () => view.router.state.location.pathname,
    }
  }

  describe('the log page', () => {
    it('names itself in the page title', async () => {
      await open(<Logs />)

      expect(setPageTitle).toHaveBeenCalledWith('menu.linux.label_logs')
    })

    it('hands the log service a target and read-only options', async () => {
      await open(<Logs />)

      // Logs cannot be typed into, and an enabled stdin would make the hidden
      // xterm textarea a tab stop on a page with nothing to type into
      expect(getTerminalOptions).toHaveBeenCalledWith({ disableStdin: true })
      expect(fakes.log.startTerminal).toHaveBeenCalledWith(document.getElementById('log-output'), expect.anything(), expect.anything(), undefined)
    })

    it('paints the page black behind a dark terminal', async () => {
      await open(<Logs />)

      // Without this the page flashes white around a black terminal while the
      // route loads
      expect(bodyClasses()).toContain('bg-black')
    })

    it('paints the page white behind a light terminal', async () => {
      await open(<Logs />, {
        settings: { actualLightingMode: 'light', env: { terminal: { lightingMode: 'light' } } as any },
      })

      expect(bodyClasses()).toContain('bg-white')
      expect(bodyClasses()).not.toContain('bg-black')
    })

    it('eases the change only when a light theme meets a dark terminal', async () => {
      await open(<Logs />, { settings: { actualLightingMode: 'light' } })

      // The jarring case: the rest of the app is light and this page is black
      expect(bodyClasses()).toContain('theme-transition')
      expect(document.getElementById('log-output')?.classList).toContain('theme-transition')
    })

    it('does not ease the change when the app is already dark', async () => {
      await open(<Logs />, { settings: { actualLightingMode: 'dark' } })

      expect(bodyClasses()).not.toContain('theme-transition')
    })

    it('tears the terminal down when the page closes', async () => {
      const view = await open(<Logs />)

      view.unmount()

      // The terminal holds a socket to the server tailing a file
      expect(fakes.log.destroyTerminal).toHaveBeenCalled()
    })

    it('shows the toolbar to admins only', async () => {
      useAuthStore.setState(makeAuthState({ user: { admin: false } }))
      const view = await open(<Logs />)

      expect(screen.queryByLabelText('form.search')).toBeNull()
      view.unmount()

      useAuthStore.setState(makeAuthState({ user: { admin: true } }))
      await open(<Logs />)
      expect(screen.getByLabelText('form.search')).toBeInTheDocument()
    })

    it('quietens the live region xterm sets up', async () => {
      vi.useFakeTimers()
      await open(<Logs />)
      const live = document.createElement('div')
      live.setAttribute('aria-live', 'assertive')
      document.getElementById('log-output')!.append(live)

      // A frame callback; fake timers run frames every 16ms
      await act(() => vi.advanceTimersByTimeAsync(20))

      expect(live.getAttribute('aria-live')).toBe('polite')
      expect(live.getAttribute('role')).toBe('status')
      expect(live.getAttribute('aria-atomic')).toBe('true')
    })
  })

  describe('searching the log', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    const searchBox = () => document.getElementById('logs-search') as HTMLInputElement
    const type = (value: string) => fireEvent.change(searchBox(), { target: { value } })
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
    const toggleSearch = () => fireEvent.click(screen.getByLabelText('form.search'))
    const submit = () => fireEvent.submit(searchBox().form!)

    /** The log page with the search bar open. */
    async function openSearch() {
      const view = await open(<Logs />)
      toggleSearch()
      return view
    }

    it('treats one or two characters as not yet a search', async () => {
      await openSearch()

      expect(searchBox().classList).not.toContain('is-invalid')

      type('ab')
      // A one or two character filter would match nearly every line, and
      // filtering the whole buffer is not free
      expect(searchBox().classList).toContain('is-invalid')

      type('abc')
      expect(searchBox().classList).not.toContain('is-invalid')
    })

    it('searches by itself once there is enough to go on', async () => {
      await openSearch()

      type('homebridge')
      await advance(500)

      expect(fakes.log.setSearchFilter).toHaveBeenCalledWith('homebridge')
    })

    it('waits for the user to stop typing', async () => {
      await openSearch()

      type('home')
      type('homebridge')
      await advance(500)

      // Every keystroke would otherwise re-filter the entire scrollback
      expect(fakes.log.setSearchFilter).toHaveBeenCalledTimes(1)
      expect(fakes.log.setSearchFilter).toHaveBeenCalledWith('homebridge')
    })

    it('trims what the user typed, in the box as well as the filter', async () => {
      await openSearch()

      type('  homebridge  ')
      await advance(500)

      expect(fakes.log.setSearchFilter).toHaveBeenCalledWith('homebridge')
      // Written back without re-triggering the search, or this would loop
      expect(searchBox().value).toBe('homebridge')
      await advance(1000)
      expect(fakes.log.setSearchFilter).toHaveBeenCalledTimes(1)
    })

    it('clears an active search when the query gets too short', async () => {
      await openSearch()
      type('homebridge')
      await advance(500)

      type('ho')
      await advance(500)

      expect(fakes.log.clearSearchFilter).toHaveBeenCalled()
    })

    it('does not clear a search that was never running', async () => {
      await openSearch()

      type('ho')
      await advance(500)

      // Nothing was filtered, so there is nothing to clear or scroll
      expect(fakes.log.clearSearchFilter).not.toHaveBeenCalled()
    })

    it('searches on enter when the query is long enough', async () => {
      await openSearch()
      type('  homebridge ')

      submit()

      expect(fakes.log.setSearchFilter).toHaveBeenCalledWith('homebridge')
    })

    it('clears the box on enter when the query is too short', async () => {
      await openSearch()
      type('ho')

      submit()

      // Enter with an unusable query means show me everything, not nothing
      expect(searchBox().value).toBe('')
      expect(fakes.log.clearSearchFilter).toHaveBeenCalled()
    })

    it('closes the search bar on enter with an empty box', async () => {
      await openSearch()

      submit()

      expect(document.getElementById('logs-search-region')).toBeNull()
    })

    it('opens the search bar and focuses it', async () => {
      await openSearch()
      await advance(10)

      expect(document.getElementById('logs-search-region')).not.toBeNull()
      expect(screen.getByLabelText('form.search').getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement).toBe(searchBox())
      expect(fakes.log.scrollToBottom).toHaveBeenCalled()
    })

    it('clears the filter when the search bar is closed again', async () => {
      await openSearch()
      type('homebridge')
      await advance(500)

      toggleSearch()

      // Leaving the filter running with the box hidden would look like the log
      // had stopped receiving lines
      expect(document.getElementById('logs-search-region')).toBeNull()
      expect(fakes.log.clearSearchFilter).toHaveBeenCalled()
      toggleSearch()
      expect(searchBox().value).toBe('')
    })

    it('clears the search from the exit button', async () => {
      await openSearch()
      type('homebridge')
      await advance(500)

      fireEvent.click(screen.getByLabelText('form.button_clear'))

      expect(searchBox().value).toBe('')
      expect(fakes.log.clearSearchFilter).toHaveBeenCalled()
      expect(screen.queryByLabelText('form.button_clear')).toBeNull()
    })

    it('hands the download and truncate buttons to the service', async () => {
      await open(<Logs />)

      fireEvent.click(screen.getByLabelText('form.button_download'))
      fireEvent.click(screen.getByLabelText('form.button_delete'))

      // Both need a confirmation the service owns, so the page must not
      // reimplement either
      expect(fakes.log.downloadLogFile).toHaveBeenCalled()
      expect(fakes.log.truncateLogFile).toHaveBeenCalled()
    })
  })

  describe('leaving a terminal page', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    /**
     * ⚠️ Both pages run this transition (shared in terminal-page.ts), so the
     * cases below run against both.
     */
    const PAGES: Array<[string, () => ReactElement]> = [
      ['the log page', () => <Logs />],
      ['the shell page', () => <Terminal />],
    ]

    it.each(PAGES)('%s goes immediately when there is no theme change to ease', async (_name, page) => {
      const view = await open(page(), { settings: { actualLightingMode: 'dark' } })

      const nav = await leave(view, '/plugins')
      await act(() => vi.advanceTimersByTimeAsync(0))

      expect(nav.path()).toBe('/plugins')
      // The background colours have to go, or the next page inherits them
      expect(bodyClasses()).not.toContain('bg-black')
      expect(bodyClasses()).not.toContain('bg-white')
    })

    it.each(PAGES)('%s waits for both animations before navigating away', async (_name, page) => {
      const view = await open(page(), { settings: { actualLightingMode: 'light' } })
      const nav = await leave(view, '/plugins')

      await act(() => vi.advanceTimersByTimeAsync(250))
      // The terminal has faded but the page is still on its way out
      expect(nav.path()).toBe('/page')
      expect(bodyClasses()).not.toContain('bg-black')

      await act(() => vi.advanceTimersByTimeAsync(250))
      expect(nav.path()).toBe('/plugins')
    })

    it.each(PAGES)('%s leaves the background alone when the next page is also a terminal', async (_name, page) => {
      const view = await open(page(), { settings: { actualLightingMode: 'light' } })
      // Read at the moment the navigation lands: the shell page's own teardown
      // clears the body afterwards, and the next terminal page repaints it
      let classesAtNavigation: string[] = []
      const unsubscribe = view.router.subscribe(() => {
        classesAtNavigation = bodyClasses()
      })

      const nav = await leave(view, '/platform-tools/terminal')
      await act(() => vi.advanceTimersByTimeAsync(250))
      unsubscribe()

      expect(nav.path()).toBe('/platform-tools/terminal')
      // Fading the page back to white only to blacken it again would flash
      expect(classesAtNavigation).toContain('bg-black')
    })

    it.each(PAGES)('%s keeps the background when going to the other terminal page', async (_name, page) => {
      const view = await open(page(), { settings: { actualLightingMode: 'light' } })
      let classesAtNavigation: string[] = []
      const unsubscribe = view.router.subscribe(() => {
        classesAtNavigation = bodyClasses()
      })

      const nav = await leave(view, '/logs')
      await act(() => vi.advanceTimersByTimeAsync(250))
      unsubscribe()

      expect(nav.path()).toBe('/logs')
      expect(classesAtNavigation).toContain('bg-black')
    })

    it('hides the search bar before fading, to avoid a mismatched strip', async () => {
      const view = await open(<Logs />, { settings: { actualLightingMode: 'light' } })
      fireEvent.click(screen.getByLabelText('form.search'))

      await leave(view, '/plugins')
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(document.getElementById('logs-search-region')).toBeNull()
      expect(document.getElementById('log-output')?.classList).toContain('fade-out')

      await act(() => vi.advanceTimersByTimeAsync(500))
    })

    it('stays on the shell when the guard refuses', async () => {
      const view = await open(<Terminal />, {
        arrange: () => {
          fakes.guard.canDeactivate = vi.fn(async () => false)
        },
      })

      const nav = await leave(view, '/plugins')
      await act(() => vi.advanceTimersByTimeAsync(500))

      // A running command would be killed, so the guard's answer wins before any
      // of the theme handling runs
      expect(nav.path()).toBe('/page')
      expect(bodyClasses()).toContain('bg-black')
    })
  })

  describe('the shell page', () => {
    it('names itself in the page title', async () => {
      await open(<Terminal />)

      expect(setPageTitle).toHaveBeenCalledWith('menu.linux.label_terminal')
    })

    it('starts a fresh session by default', async () => {
      await open(<Terminal />)

      expect(fakes.terminal.startTerminal).toHaveBeenCalled()
      expect(fakes.terminal.reconnectTerminal).not.toHaveBeenCalled()
    })

    it('asks for screen reader mode, unlike the log page', async () => {
      await open(<Terminal />)

      // This terminal is typed into, so its hidden textarea is the input the
      // user is actually using
      expect(getTerminalOptions).toHaveBeenCalledWith({ screenReaderMode: true })
    })

    it('reconnects to a session that is being kept alive', async () => {
      await open(<Terminal />, {
        settings: { env: { terminal: { persistence: true } } as any },
        arrange: () => {
          fakes.terminal.hasActiveSession = vi.fn(() => true)
        },
      })

      // With persistence on, the command the user left running is still going
      expect(fakes.terminal.reconnectTerminal).toHaveBeenCalled()
      expect(fakes.terminal.startTerminal).not.toHaveBeenCalled()
    })

    it('throws away a leftover session when persistence is off', async () => {
      await open(<Terminal />, {
        arrange: () => {
          fakes.terminal.hasActiveSession = vi.fn(() => true)
        },
      })

      // The setting may have been switched off while a session was open, and
      // leaving it running would hold a shell on the server forever
      expect(fakes.terminal.destroyPersistentSession).toHaveBeenCalled()
      expect(fakes.terminal.startTerminal).toHaveBeenCalled()
    })

    it('clears an existing terminal before starting another', async () => {
      await open(<Terminal />, {
        arrange: () => {
          fakes.terminal.isTerminalReady = vi.fn(() => true)
        },
      })

      // Revisiting the page otherwise stacks a second set of event handlers on
      // the same element
      expect(fakes.terminal.destroyTerminal).toHaveBeenCalled()
    })

    it('keeps the session alive on the way out when persistence is on', async () => {
      const view = await open(<Terminal />, { settings: { env: { terminal: { persistence: true } } as any } })

      view.unmount()

      expect(fakes.terminal.detachTerminal).toHaveBeenCalled()
      expect(fakes.terminal.destroyPersistentSession).not.toHaveBeenCalled()
    })

    it('ends the session on the way out when persistence is off', async () => {
      const view = await open(<Terminal />)

      view.unmount()

      expect(fakes.terminal.destroyPersistentSession).toHaveBeenCalled()
      expect(fakes.terminal.detachTerminal).not.toHaveBeenCalled()
    })

    it('leaves no body classes behind', async () => {
      const view = await open(<Terminal />, { settings: { actualLightingMode: 'light' } })
      expect(bodyClasses()).toContain('bg-black')

      view.unmount()

      // Navigating away from a crash or a hard route change skips the leave
      // guard, so teardown has to clean up too
      expect(bodyClasses()).not.toContain('bg-black')
      expect(bodyClasses()).not.toContain('theme-transition')
    })

    it('wakes the terminal up when the user comes back to it', async () => {
      await open(<Terminal />)
      // The page focuses the terminal once on mount through a frame callback;
      // let that land before counting, or it is mistaken for the wake-up
      await act(() => new Promise(resolve => setTimeout(resolve, 0)))
      fakes.terminal.isTerminalReady = vi.fn(() => true)
      fakes.terminal.activateTerminal.mockClear()

      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise(resolve => setTimeout(resolve, 0))

      // Switching browser tabs loses focus, and a terminal you have to click
      // before typing feels broken
      expect(fakes.terminal.activateTerminal).toHaveBeenCalled()
    })

    it('stops listening for tab changes once the page is gone', async () => {
      const view = await open(<Terminal />)
      await act(() => new Promise(resolve => setTimeout(resolve, 0)))

      view.unmount()
      fakes.terminal.activateTerminal.mockClear()
      document.dispatchEvent(new Event('visibilitychange'))
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(fakes.terminal.activateTerminal).not.toHaveBeenCalled()
    })

    it('lets the guard decide about closing the browser tab', async () => {
      await open(<Terminal />)
      const event = new Event('beforeunload') as BeforeUnloadEvent

      window.dispatchEvent(event)

      expect(fakes.guard.handleBeforeUnload).toHaveBeenCalledWith(event)
    })

    it.each([
      ['touchStart', 'onTouchStart'],
      ['touchEnd', 'onTouchEnd'],
    ] as const)('hands %s to the terminal, which decides scroll from select', async (eventName, delegate) => {
      // ⚠️ Without these the terminal cannot be scrolled on a phone at all: the
      // service is what tells a drag-to-scroll apart from a drag-to-select
      await open(<Terminal />)

      fireEvent[eventName](document.getElementById('docker-terminal')!)

      expect(fakes.terminal[delegate]).toHaveBeenCalledTimes(1)
    })

    it('redraws the terminal when the window is resized', async () => {
      // xterm sizes itself in character cells, so it has to be told to re-measure
      // or the output keeps wrapping to the old width
      await open(<Terminal />)
      const resize = fakes.terminal.startTerminal.mock.calls[0][2]
      const resized = vi.fn()
      resize.subscribe(resized)

      window.dispatchEvent(new Event('resize'))

      expect(resized).toHaveBeenCalled()
    })

    /**
     * The full-page terminal's own copy of the live-region patch. xterm asks for
     * `assertive`, which interrupts a screen reader for every line of output.
     */
    describe('what a screen reader hears', () => {
      it('quietens the live region xterm sets up', async () => {
        vi.useFakeTimers()
        await open(<Terminal />)
        const live = document.createElement('div')
        live.setAttribute('aria-live', 'assertive')
        document.getElementById('docker-terminal')!.append(live)

        await act(() => vi.advanceTimersByTimeAsync(0))

        expect(live.getAttribute('aria-live')).toBe('polite')
        expect(live.getAttribute('role')).toBe('status')
        expect(live.getAttribute('aria-atomic')).toBe('true')
      })

      it('copes with xterm not having built one yet', async () => {
        // The patch runs on a timer that can beat the terminal into existence
        vi.useFakeTimers()
        await open(<Terminal />)

        await expect(act(() => vi.advanceTimersByTimeAsync(0))).resolves.not.toThrow()
      })
    })

    it('activates the terminal when clicked or the window regains focus', async () => {
      await open(<Terminal />)
      fakes.terminal.activateTerminal.mockClear()

      fireEvent.click(document.getElementById('docker-terminal')!)
      window.dispatchEvent(new Event('focus'))

      expect(fakes.terminal.activateTerminal).toHaveBeenCalledTimes(2)
    })
  })
})
