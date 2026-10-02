import type { FakeOpenModal, FakeToast } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authActions, useAuthStore } from '@/core/auth'
import { Information } from '@/core/components/information/Information'
import { notifications } from '@/core/notifications'
import { useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import { toast as realToast } from '@/core/ui/toast'
import { locationReload, makeAuthState, makeSettingsState, renderWithProviders } from '@/testing'

import { handleMenuKeydown } from './menu-keydown'
import { Sidebar } from './Sidebar'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const modal = modalModule as unknown as FakeOpenModal
const toast = realToast as unknown as FakeToast

/**
 * The sidebar is the app's permission surface: what a user can see here is
 * what they can reach. The matrix below is the whole of it, so a condition
 * accidentally dropped or inverted shows up as a menu item appearing for
 * someone who should not have it.
 *
 * The sidebar is hosted with a `.content` sibling because that is how the
 * layout renders it, and the component reaches out for that element.
 */
describe('sidebar', () => {
  interface Options {
    admin?: boolean
    terminal?: boolean
    restrictLogs?: boolean
    formAuth?: boolean
    pwa?: boolean
    narrow?: boolean
    menuMode?: 'default' | 'freeze'
  }

  function render(options: Options = {}) {
    // Read when the menu is created: the mobile and desktop paths attach
    // different listeners and there is no switching between them afterwards
    Object.defineProperty(window, 'innerWidth', { value: options.narrow ? 400 : 1024, configurable: true, writable: true })
    Object.defineProperty(window.navigator, 'standalone', { value: options.pwa ?? false, configurable: true })

    useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }))
    useSettingsStore.setState(makeSettingsState({
      formAuth: options.formAuth ?? true,
      menuMode: options.menuMode ?? 'default',
      env: {
        enableTerminalAccess: options.terminal ?? true,
        restrictLogsToAdmins: options.restrictLogs ?? false,
      },
    }))

    const result = renderWithProviders(
      <>
        <Sidebar />
        <div className="content"></div>
      </>,
      { route: '*', initialEntries: ['/'] },
    )
    return result
  }

  /**
   * Every item the menu currently offers, by its label. Specs see translation
   * keys, which are the stable thing to assert on.
   */
  function items(): string[] {
    return [...document.querySelectorAll('.sidebar .title')]
      .map(node => node.textContent!.trim())
      .filter(Boolean)
  }

  const sidebar = () => document.querySelector('.sidebar') as HTMLElement
  const header = () => document.querySelector('.m-header') as HTMLElement
  const content = () => document.querySelector('.content') as HTMLElement
  const isExpanded = () => sidebar().classList.contains('expanded')
  const toggle = () => fireEvent.click(header())

  beforeEach(() => {
    notifications.reset()
    modal.opened.length = 0
    modal.openModal.mockClear()
    toast.shown.length = 0
    toast.warning.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('what an admin can reach', () => {
    it('offers every section', () => {
      render({ admin: true, terminal: true })

      expect(items()).toEqual([
        'menu.label_status',
        'menu.label_plugins',
        'menu.label_accessories',
        'menu.linux.label_logs',
        'menu.linux.label_terminal',
        'menu.config_json_editor',
        'menu.label_settings',
        'support.title',
        'menu.restart.title',
        'menu.tooltip_logout',
      ])
    })
  })

  describe('what a non-admin can reach', () => {
    it('offers only the sections they are allowed', () => {
      render({ admin: false })

      expect(items()).toEqual([
        'menu.label_status',
        'menu.label_plugins',
        'menu.label_accessories',
        'menu.linux.label_logs',
        'support.title',
        'menu.tooltip_logout',
      ])
    })

    it.each([
      ['the config editor', 'menu.config_json_editor'],
      ['the settings page', 'menu.label_settings'],
      ['the power options', 'menu.restart.title'],
      ['the terminal', 'menu.linux.label_terminal'],
    ])('hides %s', (_name, label) => {
      render({ admin: false, terminal: true })

      expect(items()).not.toContain(label)
    })
  })

  describe('the terminal', () => {
    it.each([
      ['an admin with terminal access', { admin: true, terminal: true }, true],
      ['an admin without terminal access', { admin: true, terminal: false }, false],
      ['a non-admin with terminal access', { admin: false, terminal: true }, false],
      ['a non-admin without terminal access', { admin: false, terminal: false }, false],
    ])('is %s shown: %s', (_case, options, expected) => {
      render(options)

      expect(items().includes('menu.linux.label_terminal')).toBe(expected)
    })
  })

  describe('the log viewer', () => {
    it.each([
      ['an admin while unrestricted', { admin: true, restrictLogs: false }, true],
      ['an admin while restricted', { admin: true, restrictLogs: true }, true],
      ['a non-admin while unrestricted', { admin: false, restrictLogs: false }, true],
      ['a non-admin while restricted', { admin: false, restrictLogs: true }, false],
    ])('is %s shown: %s', (_case, options, expected) => {
      render(options)

      expect(items().includes('menu.linux.label_logs')).toBe(expected)
    })
  })

  describe('the links', () => {
    it('marks the current page, for sight and for screen readers', () => {
      render()

      const status = screen.getByRole('button', { name: 'menu.label_status, menu.current_page' })
      expect(status).toHaveClass('active')
      expect(screen.getByRole('button', { name: 'menu.label_plugins' })).not.toHaveClass('active')
    })

    it('goes to the page it names', async () => {
      const { router } = render()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'menu.label_plugins' }))
      })

      expect(router.state.location.pathname).toBe('/plugins')
      expect(screen.getByRole('button', { name: 'menu.label_plugins, menu.current_page' })).toHaveClass('active')
    })

    it('keeps a section marked on its sub pages', async () => {
      const { router } = render()

      await act(async () => {
        await router.navigate('/plugins/homebridge-hue')
      })

      expect(screen.getByRole('button', { name: 'menu.label_plugins, menu.current_page' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'menu.label_status' })).not.toHaveClass('active')
    })

    it('is labelled as the menu on a desktop', () => {
      render()

      expect(screen.getByRole('navigation', { name: 'menu.sidebar.aria_menu' })).toBe(sidebar())
    })
  })

  describe('signing out', () => {
    it('is offered when the ui has a login', () => {
      render({ formAuth: true })

      expect(items()).toContain('menu.tooltip_logout')
    })

    it('is hidden when the ui has no login', () => {
      // There is nothing to sign out of, and the button would just reload
      render({ formAuth: false })

      expect(items()).not.toContain('menu.tooltip_logout')
    })

    it('signs the user out', () => {
      const logout = vi.spyOn(authActions, 'logout').mockImplementation(() => {})
      render()

      fireEvent.click(screen.getByRole('button', { name: 'menu.tooltip_logout' }))

      expect(logout).toHaveBeenCalled()
    })
  })

  describe('the reload button', () => {
    it('is offered in an installed app', () => {
      // A standalone PWA has no browser reload control of its own
      render({ pwa: true })

      expect(items()).toContain('menu.reload')

      fireEvent.click(screen.getByRole('button', { name: 'menu.reload' }))
      expect(locationReload).toHaveBeenCalled()
    })

    it('is hidden in a normal browser tab', () => {
      render({ pwa: false })

      expect(items()).not.toContain('menu.reload')
    })
  })

  describe('the raspberry pi power warning', () => {
    it('is hidden while the power is healthy', () => {
      render()

      expect(items()).not.toContain('rpi.throttled.undervoltage_title')
    })

    it.each([
      ['the pi is under voltage now', 'Under Voltage'],
      ['the pi was under voltage earlier', 'Under-voltage has occurred'],
    ])('appears once %s', (_case, flag) => {
      render()

      act(() => notifications.set('raspberryPiThrottled', { [flag]: true }))

      expect(items()).toContain('rpi.throttled.undervoltage_title')
    })

    it('stays once the flag clears', () => {
      // The warning is about the session, not the moment
      render()
      act(() => notifications.set('raspberryPiThrottled', { 'Under Voltage': true }))

      act(() => notifications.set('raspberryPiThrottled', {}))

      expect(items()).toContain('rpi.throttled.undervoltage_title')
    })
  })

  /**
   * Navigating away from the page.
   *
   * ⚠️ **The sidebar is what checks the session is still good.** With form auth on,
   * a token that expired while the page sat open would otherwise let the user click
   * into a page that then fails every request. It redirects to the login page and
   * keeps the route they wanted, so signing in again takes them there rather than
   * back to the dashboard.
   */
  describe('navigating with an expired session', () => {
    /** Navigate through a slow loader, so the navigation is pending for a while. */
    function renderWithSlowPage(options: Options & { authenticated: boolean }) {
      const isAuthenticated = vi.spyOn(authActions, 'isAuthenticated').mockResolvedValue(options.authenticated)
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true })
      useAuthStore.setState(makeAuthState())
      useSettingsStore.setState(makeSettingsState({ formAuth: options.formAuth ?? true }))
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const result = renderWithProviders(
        <>
          <Sidebar />
          <div className="content"></div>
        </>,
        {
          route: '/',
          routes: [
            { path: '/plugins', loader: () => gate.then(() => null), element: <div data-testid="plugins" /> },
            { path: '/login', element: <div data-testid="login" /> },
          ],
        },
      )
      return { ...result, isAuthenticated, release }
    }

    async function go(router: { navigate: (to: string) => Promise<void> }, to: string) {
      await act(async () => {
        void router.navigate(to)
        for (let tick = 0; tick < 8; tick += 1) {
          await Promise.resolve()
        }
      })
    }

    it('sends the user to the login page when the token has gone stale', async () => {
      const { router } = renderWithSlowPage({ authenticated: false })

      await go(router, '/plugins?tab=1')

      expect(router.state.location.pathname).toBe('/login')
      // ...remembering where they were going
      expect(window.sessionStorage.getItem('target_route')).toBe('/plugins?tab=1')
    })

    it('lets a good session through', async () => {
      const { router, release } = renderWithSlowPage({ authenticated: true })

      await go(router, '/plugins')
      release()
      await act(async () => {})

      expect(router.state.location.pathname).toBe('/plugins')
    })

    it('does not check the session on the way to the login page', async () => {
      // It would redirect the login page to itself
      const { router, isAuthenticated } = renderWithSlowPage({ authenticated: false })

      await go(router, '/login')

      expect(isAuthenticated).not.toHaveBeenCalled()
    })

    it('checks nothing when login is switched off', async () => {
      const { router, isAuthenticated } = renderWithSlowPage({ formAuth: false, authenticated: false })

      await go(router, '/plugins')

      expect(isAuthenticated).not.toHaveBeenCalled()
    })
  })

  describe('after a navigation', () => {
    it('closes the menu once a page has loaded', async () => {
      const { router } = render()
      toggle()
      expect(isExpanded()).toBe(true)

      await act(async () => {
        await router.navigate('/plugins')
      })

      expect(isExpanded()).toBe(false)
    })

    it('holds the menu shut briefly, so a hover does not reopen it', async () => {
      // ⚠️ Without the freeze, the pointer left sitting where the menu button was
      // opens it again the moment the new page renders
      vi.useFakeTimers()
      const { router } = render()

      await act(async () => {
        await router.navigate('/plugins')
      })
      toggle()
      expect(isExpanded()).toBe(false)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })
      toggle()
      expect(isExpanded()).toBe(true)
    })
  })

  describe('what the server tells it', () => {
    it('follows the form-auth setting when it arrives', () => {
      render({ formAuth: true })

      act(() => notifications.set('formAuthEnabled', false))

      expect(items()).not.toContain('menu.tooltip_logout')
    })

    it('ignores a form-auth value that has not been decided yet', () => {
      render({ formAuth: true })

      act(() => notifications.set('formAuthEnabled', null))

      expect(items()).toContain('menu.tooltip_logout')
    })
  })

  describe('the under voltage explanation', () => {
    const openExplanation = () => fireEvent.click(screen.getByRole('button', { name: 'rpi.throttled.undervoltage_title - rpi.throttled.undervoltage_description' }))

    it('says the power is failing now when it is', () => {
      render()
      act(() => notifications.set('raspberryPiThrottled', { 'Under Voltage': true }))

      openExplanation()

      expect(modal.lastOpened()!.component).toBe(Information)
      expect(modal.propsFor()?.message).toBe('rpi.throttled.currently_message')
      expect(modal.lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static' })
    })

    it('says it happened earlier when the power has recovered', () => {
      render()
      act(() => notifications.set('raspberryPiThrottled', { 'Under-voltage has occurred': true }))

      openExplanation()

      expect(modal.propsFor()?.message).toBe('rpi.throttled.previously_message')
    })

    it('links out to an explanation of the warning', () => {
      render()
      act(() => notifications.set('raspberryPiThrottled', { 'Under Voltage': true }))

      openExplanation()

      expect(modal.propsFor()?.ctaButtonLink).toContain('raspberry-pi-low-voltage-warning')
    })
  })

  describe('the legacy two factor warning', () => {
    it('warns the user, once, a few seconds after the page settles', async () => {
      // ⚠️ Delayed on purpose: it would otherwise land on top of everything else a
      // fresh page load throws up
      vi.useFakeTimers()
      render()

      act(() => notifications.set('legacyOtpDetected', true))
      expect(toast.warning).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(toast.warning).toHaveBeenCalledTimes(1)
    })

    it('leaves it on screen until the user dismisses it', async () => {
      // It needs acting on, so it must not time out unseen
      vi.useFakeTimers()
      render()

      act(() => notifications.set('legacyOtpDetected', true))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      expect(toast.warning.mock.calls[0][2]).toMatchObject({ disableTimeOut: true, tapToDismiss: true })
    })

    it('does not warn twice', async () => {
      vi.useFakeTimers()
      render()

      act(() => notifications.set('legacyOtpDetected', true))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      act(() => notifications.set('legacyOtpDetected', false))
      act(() => notifications.set('legacyOtpDetected', true))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      expect(toast.warning).toHaveBeenCalledTimes(1)
    })

    it('says nothing when no legacy secret was found', async () => {
      vi.useFakeTimers()
      render()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      expect(toast.warning).not.toHaveBeenCalled()
    })
  })

  describe('opening and closing the menu', () => {
    it('opens and closes on the toggle', () => {
      render()

      toggle()
      expect(isExpanded()).toBe(true)

      toggle()
      expect(isExpanded()).toBe(false)
    })

    it('dims the page behind it while it is open', () => {
      render()

      toggle()

      expect(content().style.opacity).toBe('20%')
      expect(content().style.pointerEvents).toBe('none')
    })

    it('gives the page back when it closes', () => {
      render()
      toggle()

      toggle()

      expect(content().style.opacity).toBe('')
      expect(content().style.pointerEvents).toBe('')
    })
  })

  describe('keyboard use', () => {
    it('activates a menu item on enter', () => {
      const target = document.createElement('a')
      target.setAttribute('role', 'menuitem')
      const click = vi.spyOn(target, 'click')

      handleMenuKeydown({ key: 'Enter', target } as unknown as KeyboardEvent)

      expect(click).toHaveBeenCalled()
    })

    it('does nothing for any other key', () => {
      const target = document.createElement('a')
      target.setAttribute('role', 'menuitem')
      const click = vi.spyOn(target, 'click')

      handleMenuKeydown({ key: 'a', target } as unknown as KeyboardEvent)

      expect(click).not.toHaveBeenCalled()
    })

    it('does nothing for an element that is not a control', () => {
      const target = document.createElement('div')
      target.setAttribute('role', 'presentation')
      const click = vi.spyOn(target, 'click')

      handleMenuKeydown({ key: 'Enter', target } as unknown as KeyboardEvent)

      expect(click).not.toHaveBeenCalled()
    })

    it('toggles the menu from the phone header with enter', () => {
      render({ narrow: true })

      fireEvent.keyDown(header(), { key: 'Enter' })

      expect(isExpanded()).toBe(true)
      expect(header()).toHaveAttribute('aria-expanded', 'true')
    })
  })

  /**
   * Closing the menu by touch on a narrow screen.
   *
   * ⚠️ **On a phone the open menu covers the page.** There is no room for a close
   * button beside it, so tapping the page behind it is the way out — and the tap
   * has to be swallowed, or it also activates whatever it landed on underneath.
   */
  describe('the menu on a narrow screen', () => {
    function tap(target: Element) {
      const event = new Event('touchstart', { bubbles: true, cancelable: true })
      act(() => {
        target.dispatchEvent(event)
      })
      return event
    }

    function openOnPhone() {
      render({ narrow: true })
      toggle()
      expect(isExpanded()).toBe(true)
    }

    it('is a button that controls the menu', () => {
      render({ narrow: true })

      expect(header()).toHaveAttribute('role', 'button')
      expect(header()).toHaveAttribute('aria-controls', 'sidebar')
      expect(sidebar()).not.toHaveAttribute('role')
    })

    it('closes the menu when the page behind it is tapped', () => {
      openOnPhone()

      tap(content())

      expect(isExpanded()).toBe(false)
    })

    it('swallows that tap rather than letting it through', () => {
      // ⚠️ Otherwise the tap that closes the menu also presses whatever was under
      // it, and the user lands on a page they never chose
      openOnPhone()

      const event = tap(content())

      expect(event.defaultPrevented).toBe(true)
    })

    it('closes the menu when anything else outside it is tapped', () => {
      openOnPhone()
      const elsewhere = document.createElement('div')
      document.body.append(elsewhere)

      tap(elsewhere)

      expect(isExpanded()).toBe(false)
      elsewhere.remove()
    })

    it('leaves a tap inside the menu alone', () => {
      // The menu items have to stay usable
      openOnPhone()

      tap(sidebar())

      expect(isExpanded()).toBe(true)
    })

    it('does nothing while the menu is already closed', () => {
      render({ narrow: true })

      const event = tap(content())

      expect(isExpanded()).toBe(false)
      expect(event.defaultPrevented).toBe(false)
    })

    it('does not listen for taps on a desktop window', () => {
      // The desktop layout closes on click instead, and both at once would close
      // the menu twice over
      render()
      toggle()

      const event = tap(content())

      expect(event.defaultPrevented).toBe(false)
    })
  })

  /**
   * The menu on a desktop window.
   *
   * ⚠️ **The menu opens on hover and closes on a click past it.** The 60-pixel
   * cut-off is what separates "clicked an item in the collapsed strip" from
   * "clicked in the expanded panel".
   */
  describe('the menu on a desktop window', () => {
    function clickAt(target: Element, clientX: number) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, clientX })
      act(() => {
        target.dispatchEvent(event)
      })
      return event
    }

    const hover = (target: Element, type: 'mouseenter' | 'mouseleave') => act(() => {
      target.dispatchEvent(new Event(type))
    })

    it('opens when the pointer enters the header', () => {
      render()

      hover(header(), 'mouseenter')

      expect(isExpanded()).toBe(true)
    })

    it('closes again when the pointer leaves', () => {
      render()
      hover(header(), 'mouseenter')

      hover(header(), 'mouseleave')

      expect(isExpanded()).toBe(false)
    })

    it('opens when the pointer enters the menu itself', () => {
      render()

      hover(sidebar(), 'mouseenter')

      expect(isExpanded()).toBe(true)
    })

    it('does not open on hover while the menu mode is frozen', () => {
      render({ menuMode: 'freeze' })

      hover(sidebar(), 'mouseenter')

      expect(isExpanded()).toBe(false)
    })

    it('stays put while the menu is held shut after a navigation', async () => {
      // ⚠️ The freeze is what stops the menu flapping open as the pointer crosses
      // it on the way somewhere else
      const { router } = render()
      await act(async () => {
        await router.navigate('/plugins')
      })

      hover(header(), 'mouseenter')

      expect(isExpanded()).toBe(false)
    })

    it('closes on a click in the expanded part of the menu', () => {
      render()
      toggle()

      clickAt(sidebar(), 200)

      expect(isExpanded()).toBe(false)
    })

    it('leaves it open for a click in the collapsed strip', () => {
      // That strip is the icon column, and closing on it would take the menu away
      // as the user reaches for the item they just pressed
      render()
      toggle()

      clickAt(sidebar(), 30)

      expect(isExpanded()).toBe(true)
    })

    it('ignores a click outside the menu entirely', () => {
      render()
      toggle()

      clickAt(content(), 400)

      expect(isExpanded()).toBe(true)
    })

    it('does not listen for clicks on a narrow window', () => {
      // The phone layout closes on touch instead, and both at once would fight
      render({ narrow: true })
      toggle()

      clickAt(sidebar(), 200)

      expect(isExpanded()).toBe(true)
    })
  })
})
