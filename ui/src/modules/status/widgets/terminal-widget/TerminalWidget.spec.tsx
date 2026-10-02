import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settingsActions, useSettingsStore } from '@/core/settings'
import { TerminalWidget } from '@/modules/status/widgets/terminal-widget/TerminalWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'
import { makeSettingsState } from '@/testing'

const fakes = vi.hoisted(() => ({
  terminal: {} as Record<string, any>,
  guard: {} as Record<string, any>,
}))

vi.mock('@/core/utilities/terminal/instances', async () => {
  const { useSettingsStore: store } = await import('@/core/settings')
  return {
    get terminalService() {
      return fakes.terminal
    },
    get terminalNavigationGuard() {
      return fakes.guard
    },
    createLogService: vi.fn(),
    getTerminalSettings: () => store.getState().env?.terminal,
    confirmModal: vi.fn(),
  }
})

/**
 * The shell on the dashboard. A terminal that grabs focus on load scrolls the
 * page down to itself, and a collapsed terminal must not be a tab stop at all,
 * so the widget has an explicit expand control that owns whether the hidden
 * xterm textarea is reachable.
 */
describe('the shell widget', () => {
  let resizeEvent: ReturnType<typeof createWidgetEvent>
  let getTerminalOptions: ReturnType<typeof vi.spyOn>
  let getTerminalThemeOptions: ReturnType<typeof vi.spyOn>

  async function open(options: { settings?: Record<string, any>, arrange?: () => void } = {}) {
    useSettingsStore.setState(makeSettingsState(options.settings))
    options.arrange?.()
    resizeEvent = createWidgetEvent()
    const result = render(
      <TerminalWidget
        widget={{ component: 'TerminalWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false }}
        resizeEvent={resizeEvent}
        configureEvent={createWidgetEvent()}
        updateWidget={vi.fn()}
        saveWidgets={vi.fn()}
      />,
    )
    await act(async () => {})
    return result
  }

  const root = (container: HTMLElement) => container.querySelector<HTMLElement>('.hb-terminal-widget')!
  const toggleButton = () => screen.getByRole('button', { name: 'menu.docker.terminal' })

  /** Expand or collapse, and let the deferred patching run. */
  async function toggle() {
    fireEvent.click(toggleButton())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
  }

  /** Put xterm's own elements (its input textarea and live region) inside the widget's terminal host. */
  function withXtermElements(container: HTMLElement) {
    const host = container.querySelector('.terminal')!
    const textarea = document.createElement('textarea')
    const live = document.createElement('div')
    live.setAttribute('aria-live', 'assertive')
    host.append(textarea, live)
    return { host, textarea, live }
  }

  /** jsdom gives every element a zero-size rect, which reads as off-screen. */
  function giveWidgetASize(container: HTMLElement) {
    root(container).getBoundingClientRect = () => ({ width: 400, height: 300 }) as DOMRect
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fakes.terminal = {
      // The widget reads options off the live terminal to apply font and theme changes
      term: { options: { fontSize: 14, fontWeight: 400 }, scrollToBottom: vi.fn() },
      startTerminal: vi.fn(),
      onTouchStart: vi.fn(),
      onTouchEnd: vi.fn(),
      reconnectTerminal: vi.fn(),
      destroyTerminal: vi.fn(),
      detachTerminal: vi.fn(),
      destroyPersistentSession: vi.fn(async () => undefined),
      activateTerminal: vi.fn(),
      isTerminalReady: vi.fn(() => false),
      hasActiveSession: vi.fn(() => false),
    }
    fakes.guard = { canDeactivate: vi.fn(async () => true), handleBeforeUnload: vi.fn() }
    getTerminalOptions = vi.spyOn(settingsActions, 'getTerminalOptions')
    getTerminalThemeOptions = vi.spyOn(settingsActions, 'getTerminalThemeOptions')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts a session without stealing focus', async () => {
    await open()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })

    // Focusing on load scrolls the page down to a widget that may be well below the fold
    expect(getTerminalOptions).toHaveBeenCalledWith({ cursorBlink: false }, true)
    expect(fakes.terminal.startTerminal).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Object), resizeEvent, false)
    expect(fakes.terminal.activateTerminal).not.toHaveBeenCalled()
  })

  it('reconnects to a session that is already running', async () => {
    await open({ arrange: () => fakes.terminal.isTerminalReady.mockReturnValue(true) })

    expect(fakes.terminal.reconnectTerminal).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Object), resizeEvent, false)
    expect(fakes.terminal.startTerminal).not.toHaveBeenCalled()
  })

  it('reconnects to a persisted session', async () => {
    await open({
      settings: { env: { terminal: { persistence: true } } },
      arrange: () => fakes.terminal.hasActiveSession.mockReturnValue(true),
    })

    expect(fakes.terminal.reconnectTerminal).toHaveBeenCalled()
    expect(fakes.terminal.startTerminal).not.toHaveBeenCalled()
  })

  it('follows the effective terminal theme', async () => {
    const dark = await open()
    expect(root(dark.container)).toHaveClass('widget-container-dark')
    dark.unmount()

    const light = await open({ settings: { actualLightingMode: 'light', env: { terminal: { lightingMode: 'light' } } } })
    expect(root(light.container)).not.toHaveClass('widget-container-dark')
  })

  it('starts collapsed for a screen reader', async () => {
    const { container } = await open()

    // A shell nobody has asked to use should not be in the tab order of a page of read-only widgets
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector(`#${toggleButton().getAttribute('aria-controls')}`)).toHaveAttribute('aria-hidden', 'true')
  })

  it('makes the terminal reachable and focused when expanded', async () => {
    const { container } = await open()
    fakes.terminal.activateTerminal.mockClear()
    const resized = vi.fn()
    resizeEvent.subscribe(resized)

    await act(async () => {
      toggleButton().focus()
    })
    await toggle()

    expect(toggleButton()).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector(`#${toggleButton().getAttribute('aria-controls')}`)).not.toHaveAttribute('aria-hidden')
    // Now the user has asked for it, so focus is what they want
    expect(fakes.terminal.activateTerminal).toHaveBeenCalled()
    expect(resized).toHaveBeenCalled()
  })

  it('stops the click reaching the widget behind the button', async () => {
    await open()
    fakes.terminal.activateTerminal.mockClear()

    fireEvent.click(toggleButton())

    // The whole widget is clickable to focus the terminal, which would undo what the collapse button just did
    expect(fakes.terminal.activateTerminal).not.toHaveBeenCalled()
  })

  it('collapses again on a second press', async () => {
    await open()

    await toggle()
    await toggle()

    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false')
  })

  it('fits the terminal under its title on a resize', async () => {
    const { container } = await open()
    vi.spyOn(root(container), 'offsetHeight', 'get').mockReturnValue(300)
    vi.spyOn(container.querySelector('.drag-handler') as HTMLElement, 'offsetHeight', 'get').mockReturnValue(40)

    await act(async () => resizeEvent.next())

    expect(container.querySelector<HTMLElement>('.p-2[id]')!.style.height).toBe('260px')
  })

  /**
   * ⚠️ The log and shell widgets share these rules (useFollowTerminalSettings),
   * against different services; these cases are the drift alarm for the shell.
   */
  describe('following the global terminal settings', () => {
    it('applies a new font size to the live shell', async () => {
      await open()

      settingsActions.emitTerminalSettingsChanged({ fontSize: 20 })

      expect(fakes.terminal.term.options.fontSize).toBe(20)
    })

    it('applies a new font weight', async () => {
      await open()

      settingsActions.emitTerminalSettingsChanged({ fontWeight: '600' })

      expect(fakes.terminal.term.options.fontWeight).toBe('600')
    })

    it('applies a new lighting mode as a whole theme', async () => {
      await open()
      getTerminalThemeOptions.mockReturnValue({ theme: { background: '#ffffff' }, allowTransparency: true })

      settingsActions.emitTerminalSettingsChanged({ lightingMode: 'light' })

      expect(getTerminalThemeOptions).toHaveBeenCalledWith(true)
      expect(fakes.terminal.term.options.theme).toEqual({ background: '#ffffff' })
      // ⚠️ Both, not just the colours
      expect(fakes.terminal.term.options.allowTransparency).toBe(true)
    })

    it('re-measures and scrolls after a change', async () => {
      await open()

      settingsActions.emitTerminalSettingsChanged({ fontSize: 20 })
      await vi.advanceTimersByTimeAsync(100)

      expect(fakes.terminal.term.scrollToBottom).toHaveBeenCalled()
    })

    it('does nothing when the settings have not actually changed', async () => {
      await open()

      settingsActions.emitTerminalSettingsChanged({ fontSize: 14 })
      await vi.advanceTimersByTimeAsync(100)

      expect(fakes.terminal.term.scrollToBottom).not.toHaveBeenCalled()
    })

    it('ignores settings changes before the shell exists', async () => {
      await open()
      fakes.terminal.term = null
      getTerminalThemeOptions.mockClear()

      settingsActions.emitTerminalSettingsChanged({ fontSize: 20 })

      expect(getTerminalThemeOptions).not.toHaveBeenCalled()
    })
  })

  /**
   * ⚠️ One-line delegations, which is exactly why they break quietly: a tap
   * that never reaches the service leaves the terminal unfocused with no error,
   * and a touch it never sees means the terminal cannot be scrolled on a phone.
   */
  describe('the gestures it passes on', () => {
    it('focuses the terminal when the widget is tapped', async () => {
      const { container } = await open()
      fakes.terminal.activateTerminal.mockClear()

      fireEvent.click(root(container))

      expect(fakes.terminal.activateTerminal).toHaveBeenCalled()
    })

    it.each([
      ['touchStart', 'onTouchStart'],
      ['touchEnd', 'onTouchEnd'],
    ] as const)('hands %s to the terminal, which decides scroll from select', async (gesture, delegate) => {
      const { container } = await open()

      fireEvent[gesture](root(container))

      expect(fakes.terminal[delegate]).toHaveBeenCalledWith(expect.objectContaining({ type: gesture.toLowerCase() }))
    })

    it('asks the guard whether the tab may close', async () => {
      // ⚠️ A shell with something running is lost when the tab closes, and this is the only warning
      await open()

      window.dispatchEvent(new Event('beforeunload'))

      expect(fakes.guard.handleBeforeUnload).toHaveBeenCalled()
    })
  })

  /**
   * ⚠️ xterm builds its own textarea and live region, and neither is written
   * for a widget that starts collapsed.
   */
  describe('what a screen reader sees', () => {
    it('keeps the shell input out of the tab order while collapsed', async () => {
      const { container } = await open()
      const { textarea } = withXtermElements(container)

      await toggle()
      await toggle()

      expect(textarea.getAttribute('aria-hidden')).toBe('true')
      expect(textarea.getAttribute('tabindex')).toBe('-1')
    })

    it('hides the shell input once the terminal is up', async () => {
      const { container } = await open()
      const { textarea } = withXtermElements(container)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(textarea.getAttribute('tabindex')).toBe('-1')
    })

    it('puts it back in the tab order when the user expands it', async () => {
      const { container } = await open()
      const { textarea } = withXtermElements(container)

      await toggle()

      expect(textarea.hasAttribute('aria-hidden')).toBe(false)
      expect(textarea.hasAttribute('tabindex')).toBe(false)
    })

    it('quietens the live region xterm sets up', async () => {
      const { container } = await open()
      const { live } = withXtermElements(container)

      await toggle()

      expect(live.getAttribute('aria-live')).toBe('polite')
      expect(live.getAttribute('role')).toBe('status')
      expect(live.getAttribute('aria-atomic')).toBe('true')
    })

    it('copes with xterm not having built anything yet', async () => {
      await open()

      await expect(toggle()).resolves.not.toThrow()
    })

    it('moves focus off the terminal when it is collapsed', async () => {
      // ⚠️ Focus left inside a hidden textarea is a focus trap
      const { container } = await open()
      const { textarea } = withXtermElements(container)

      await toggle()
      textarea.focus()
      await toggle()

      // The widget's own collapse button, which is where the user just was
      expect(document.activeElement).toBe(toggleButton())
    })

    it('leaves focus alone when it was never in the terminal', async () => {
      const { container } = await open()
      withXtermElements(container)
      const elsewhere = document.createElement('button')
      document.body.append(elsewhere)
      elsewhere.focus()

      await toggle()
      elsewhere.focus()
      await toggle()

      expect(document.activeElement).toBe(elsewhere)
      elsewhere.remove()
    })

    it('takes focus back to the terminal when the window is focused again', async () => {
      await open()
      await toggle()
      fakes.terminal.activateTerminal.mockClear()

      window.dispatchEvent(new Event('focus'))

      expect(fakes.terminal.activateTerminal).toHaveBeenCalled()
    })

    it('does not steal focus back into a collapsed terminal', async () => {
      await open()
      fakes.terminal.activateTerminal.mockClear()

      window.dispatchEvent(new Event('focus'))

      expect(fakes.terminal.activateTerminal).not.toHaveBeenCalled()
    })
  })

  it('keeps the session alive on the way out when persistence is on', async () => {
    const { unmount } = await open({ settings: { env: { terminal: { persistence: true } } } })

    unmount()

    // Switching the widget off on the dashboard should not kill a command the user left running
    expect(fakes.terminal.detachTerminal).toHaveBeenCalled()
    expect(fakes.terminal.destroyTerminal).not.toHaveBeenCalled()
  })

  it('ends the session on the way out when persistence is off', async () => {
    const { unmount } = await open()

    unmount()

    expect(fakes.terminal.destroyTerminal).toHaveBeenCalled()
    expect(fakes.terminal.detachTerminal).not.toHaveBeenCalled()
  })

  it('stops listening for tab changes once it is gone', async () => {
    const { container, unmount } = await open({ arrange: () => fakes.terminal.isTerminalReady.mockReturnValue(true) })
    giveWidgetASize(container)
    await toggle()
    unmount()
    fakes.terminal.activateTerminal.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(200)

    expect(fakes.terminal.activateTerminal).not.toHaveBeenCalled()
  })

  it('does not focus on a tab change while collapsed', async () => {
    const { container } = await open({ arrange: () => fakes.terminal.isTerminalReady.mockReturnValue(true) })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    giveWidgetASize(container)
    fakes.terminal.activateTerminal.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(200)

    // Coming back to the browser tab must not pull focus into a terminal the user has not expanded
    expect(fakes.terminal.activateTerminal).not.toHaveBeenCalled()
  })

  it('focuses on a tab change once expanded', async () => {
    const { container } = await open({ arrange: () => fakes.terminal.isTerminalReady.mockReturnValue(true) })
    giveWidgetASize(container)
    await toggle()
    fakes.terminal.activateTerminal.mockClear()

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(200)

    expect(fakes.terminal.activateTerminal).toHaveBeenCalled()
  })

  it('ignores a tab change for a widget that is not on screen', async () => {
    await open({ arrange: () => fakes.terminal.isTerminalReady.mockReturnValue(true) })
    await toggle()
    fakes.terminal.activateTerminal.mockClear()

    // Left at zero size: a widget hidden on this screen size must not grab focus
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(200)

    expect(fakes.terminal.activateTerminal).not.toHaveBeenCalled()
  })
})
