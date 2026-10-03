import type { FakeApi, FakeIoNamespace, FakeOpenModal, FakeWs } from '@/testing'
import type { MockInstance } from 'vitest'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authActions, useAuthStore } from '@/core/auth'
import { Confirm } from '@/core/components/confirm/Confirm'
import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import { ws as realWs } from '@/core/ws'
import { environment } from '@/environments/environment'
import { fakeApi, makeAuthState, makeSettingsState, renderWithProviders } from '@/testing'
import { showKeys } from '@/testing/i18n'

import { Layout } from './Layout'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
// The sidebar is tested on its own
vi.mock('@/shared/layout/sidebar/Sidebar', () => ({ Sidebar: () => <div className="sidebar-stub" /> }))

const ws = realWs as unknown as FakeWs
const modal = modalModule as unknown as FakeOpenModal

/**
 * The application shell.
 *
 * It draws almost nothing itself, but it owns two things that have caused real
 * outages. The first is what happens when the websocket reconnects: a rolling
 * restart makes the socket flap several times in a few seconds, and each flap
 * used to re-check the token against a backend that was still starting up. The
 * 401s that came back reload the page, the fresh socket reconnects immediately,
 * and the loop feeds itself - so reconnect checks are throttled.
 *
 * The second is the reconnect listener itself. The `app` namespace is cached and
 * shared, so a layout that is torn down without detaching leaves its handler
 * behind; logging out and back in would then check the token twice per
 * reconnect, three times after the next one, and so on.
 */
describe('layout', () => {
  let io: FakeIoNamespace
  let api: FakeApi
  let checkToken: MockInstance<typeof authActions.checkToken>

  async function open(options: {
    uiVersion?: string
    url?: string
    settingsLoaded?: boolean
    admin?: boolean
    sslStartupError?: string
  } = {}) {
    useAuthStore.setState(makeAuthState({ user: { admin: options.admin ?? true } }))
    useSettingsStore.setState(makeSettingsState({
      // Matching the bundled version is the ordinary case: no mismatch, no modal
      uiVersion: options.uiVersion ?? environment.serverTarget,
      settingsLoaded: options.settingsLoaded ?? true,
      ...(options.sslStartupError ? { env: { ssl: { startupError: options.sslStartupError } } as any } : {}),
    }))

    const url = options.url ?? '/'
    const result = renderWithProviders(<Layout />, {
      route: '/',
      initialEntries: [url],
      routes: [
        { path: '/restart', element: <Layout /> },
        { path: '/plugins', element: <div data-testid="plugins" /> },
      ],
    })
    await settle()
    return result
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    resetSettingsStore()
    ws.namespaces.clear()
    ws.connectToNamespace.mockClear()
    io = ws.namespace('app')
    modal.opened.length = 0
    modal.openModal.mockClear()
    api = fakeApi()
    checkToken = vi.spyOn(authActions, 'checkToken').mockResolvedValue(undefined)
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    // A settings load switches the language to the server's
    await showKeys()
  })

  describe('update all stays closed on page load', () => {
    // ⚠️ Deliberate behaviour change: the modal used to reopen after the UI's
    // self-restart. The shell must not even ask the server about the journal.
    it('never asks for the journal and never opens a modal', async () => {
      await open()

      expect(api.callsTo('get', '/update-all/journal')).toEqual([])
      expect(modal.opened).toHaveLength(0)
    })
  })

  describe('the shared socket', () => {
    it('opens the app namespace', async () => {
      await open()

      expect(ws.connectToNamespace).toHaveBeenCalledWith('app')
    })

    it('listens for reconnect on the manager, where socket.io 4 emits it', async () => {
      // A `reconnect` listener on the Socket itself never fires in 4.x
      await open()

      expect(io.socket.io.handlers('reconnect')).toHaveLength(1)
      expect(io.socket.handlers('reconnect')).toHaveLength(0)
    })

    it('re-checks the token when the socket comes back', async () => {
      await open()

      io.socket.io.fire('reconnect')

      // The server may have restarted, so the token this page is holding might
      // no longer be one it will accept
      expect(checkToken).toHaveBeenCalledTimes(1)
    })

    it('ignores a flapping socket for five seconds', async () => {
      await open()

      io.socket.io.fire('reconnect')
      await vi.advanceTimersByTimeAsync(1000)
      io.socket.io.fire('reconnect')
      await vi.advanceTimersByTimeAsync(1000)
      io.socket.io.fire('reconnect')

      // A rolling restart flaps the socket repeatedly; one check per flap meant
      // a burst of 401s, and each 401 reloads the page
      expect(checkToken).toHaveBeenCalledTimes(1)
    })

    it('checks again once the cooldown has passed', async () => {
      await open()

      io.socket.io.fire('reconnect')
      await vi.advanceTimersByTimeAsync(5001)
      io.socket.io.fire('reconnect')

      // A genuine reconnect minutes later still has to be checked, so this is a
      // throttle rather than a one-shot
      expect(checkToken).toHaveBeenCalledTimes(2)
    })

    it('does not let a failed check escape', async () => {
      checkToken.mockRejectedValue(Object.assign(new Error('401'), { status: 401 }))
      await open()

      io.socket.io.fire('reconnect')
      await settle()

      expect(checkToken).toHaveBeenCalled()
    })

    it('detaches its listener when the shell is replaced', async () => {
      const { unmount } = await open()
      expect(io.socket.io.handlers('reconnect')).toHaveLength(1)

      unmount()

      // Logging out and back in mounts a fresh shell; a leftover handler would
      // make every future reconnect check the token twice
      expect(io.socket.io.handlers('reconnect')).toHaveLength(0)
    })

    it('does not check the token after teardown', async () => {
      const { unmount } = await open()

      unmount()
      io.socket.io.fire('reconnect')

      expect(checkToken).not.toHaveBeenCalled()
    })

    it('closes the namespace it opened', async () => {
      const { unmount } = await open()

      unmount()

      expect(io.end).toHaveBeenCalled()
    })
  })

  describe('a server running older code than the page', () => {
    it('says nothing when the versions match', async () => {
      await open()

      expect(modal.opened).toHaveLength(0)
    })

    it('asks the user to restart when the server is behind', async () => {
      await open({ uiVersion: '0.9.0' })

      // The bundled page was served by a newer install than the process now
      // answering it, which means the service was updated but never restarted
      expect(modal.lastOpened()?.component).toBe(Confirm)
      expect(modal.propsFor()?.title).toBe('platform.version.service_restart_required')
    })

    it('says nothing when the server is somehow ahead', async () => {
      await open({ uiVersion: '99.0.0' })

      // Only an out-of-date server is a problem; a newer one serves its own page
      expect(modal.opened).toHaveLength(0)
    })

    it('refuses to be dismissed with the keyboard', async () => {
      await open({ uiVersion: '0.9.0' })

      // Escaping this leaves the user in a half-broken UI with no explanation
      expect(modal.lastOpened()?.options?.keyboard).toBe(false)
      expect(modal.lastOpened()?.options?.backdrop).toBe('static')
    })

    it('sends the user to restart when they agree', async () => {
      const { router } = await open({ uiVersion: '0.9.0' })

      modal.lastOpened()!.ref.close()
      await settle()

      expect(router.state.location.pathname).toBe('/restart')
    })

    it('leaves the user where they are when they decline', async () => {
      const { router } = await open({ uiVersion: '0.9.0' })

      modal.lastOpened()!.ref.dismiss('Dismiss')
      await settle()

      expect(router.state.location.pathname).toBe('/')
    })

    it('stays quiet on the restart page itself', async () => {
      await open({ uiVersion: '1.0.0', url: '/restart' })

      // The user is already doing the thing the modal would ask for, and it
      // would sit on top of the progress they are watching
      expect(modal.opened).toHaveLength(0)
    })

    it('waits for the settings before comparing anything', async () => {
      await open({ uiVersion: '0.9.0', settingsLoaded: false })

      // The shell renders before /auth/settings answers, and the version is not
      // known until it does
      expect(modal.opened).toHaveLength(0)

      fakeApi().respond('get', '/auth/settings', {
        env: { ...useSettingsStore.getState().env, packageVersion: '0.9.0', homebridgeInstanceName: 'Homebridge' },
        formAuth: true,
        theme: 'deep-purple',
        lightingMode: 'auto',
        serverTimestamp: new Date().toISOString(),
      })
      await act(async () => {
        await settingsActions.getAppSettings()
      })
      await settle()

      expect(modal.lastOpened()?.component).toBe(Confirm)
    })
  })

  describe('the https fallback warning', () => {
    const reason = 'Could not load the configured certificate: ENOENT'

    it('warns an admin that HTTPS could not be enabled', async () => {
      await open({ sslStartupError: reason })

      expect(screen.getByRole('alert')).toHaveClass('alert-warning')
      expect(screen.getByRole('alert')).toHaveTextContent('layout.ssl_fallback_warning')
    })

    it('does not show the warning to a non-admin, who cannot fix it', async () => {
      await open({ admin: false, sslStartupError: reason })

      expect(document.querySelector('.alert-warning')).toBeNull()
    })

    it('shows nothing when HTTPS is fine', async () => {
      await open()

      expect(document.querySelector('.alert-warning')).toBeNull()
    })
  })

  describe('the page', () => {
    it('renders the routed page inside the content wrapper', async () => {
      await open()

      const content = document.querySelector('.hb-layout > .content')
      expect(content).toHaveClass('px-3', 'p-md-4')
      expect(content).not.toHaveClass('sidebarExpanded')
    })

    it('is the main landmark', async () => {
      await open()

      const main = screen.getByRole('main')
      expect(main).toHaveAttribute('id', 'main-content')
      expect(main).toHaveClass('content')
    })

    it('offers a skip link as the first stop, which moves focus to the page', async () => {
      await open()

      const skip = screen.getByRole('link', { name: 'layout.skip_to_content' })
      expect(document.querySelector('.hb-layout')!.firstElementChild).toBe(skip)
      fireEvent.click(skip)
      expect(document.activeElement).toBe(screen.getByRole('main'))
    })
  })
})
