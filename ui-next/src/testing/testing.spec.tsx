import { screen } from '@testing-library/react'
import { useNavigate, useParams } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { api } from '@/core/api'
import {
  cacheStub,
  fakeApi,
  fakeIoNamespace,
  fakeOpenModal,
  fakeTerminals,
  fakeWs,
  installBrowserStubs,
  locationReload,
  makeAuthState,
  makeEnv,
  makeSettingsState,
  renderWithProviders,
  resetBrowserStubs,
  setMatchMedia,
  toastStub,
} from '@/testing'

describe('testing toolkit', () => {
  describe('browser stubs', () => {
    it('provides the browser APIs jsdom is missing', () => {
      installBrowserStubs()

      expect(typeof window.matchMedia).toBe('function')
      expect(typeof Element.prototype.scrollIntoView).toBe('function')
      setMatchMedia(true)
      expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(true)
      resetBrowserStubs()
      expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false)
    })

    it('replaces location.reload, which jsdom refuses to run', () => {
      installBrowserStubs()

      window.location.reload()

      expect(locationReload).toHaveBeenCalledOnce()
      resetBrowserStubs()
    })
  })

  describe('fakeApi', () => {
    it('resolves a registered response and records the call', async () => {
      const fake = fakeApi().respond('get', '/plugins', [{ name: 'homebridge-test' }])

      await expect(api.get('/plugins')).resolves.toHaveLength(1)
      expect(fake.lastCall('get', '/plugins')?.url).toBe('/plugins')
    })

    it('rejects with the registered error', async () => {
      fakeApi().fail('post', '/auth/login', { status: 401 })

      await expect(api.post('/auth/login', {})).rejects.toEqual({ status: 401 })
    })
  })

  describe('fakeWs', () => {
    it('returns the identical namespace on a second connect', () => {
      const ws = fakeWs()

      expect(ws.connectToNamespace('status')).toBe(ws.connectToNamespace('status'))
      expect(ws.getExistingNamespace('status')).toBe(ws.connectToNamespace('status'))
    })

    it('has no existing namespace until one is opened', () => {
      expect(fakeWs().getExistingNamespace('status')).toBeUndefined()
    })

    it('replays the connected event to a late subscriber', () => {
      const io = fakeIoNamespace({ connected: false })
      const early = vi.fn()
      io.connected.subscribe(early)
      expect(early).not.toHaveBeenCalled()

      io.markConnected()
      const late = vi.fn()
      io.connected.subscribe(late)

      expect(early).toHaveBeenCalledOnce()
      expect(late).toHaveBeenCalledOnce()
    })

    it('stops calling a subscriber once it unsubscribes', () => {
      const io = fakeIoNamespace({ connected: false })
      const cb = vi.fn()
      const unsubscribe = io.connected.subscribe(cb)

      unsubscribe()
      io.markConnected()

      expect(cb).not.toHaveBeenCalled()
      expect(io.connected.subscriberCount()).toBe(0)
    })

    it('delivers server events to the registered handlers', () => {
      const io = fakeIoNamespace()
      const seen: string[] = []
      const handler = (line: string) => seen.push(line)

      io.socket.on('stdout', handler)
      io.socket.fire('stdout', 'hello')
      io.socket.off('stdout', handler)
      io.socket.fire('stdout', 'ignored')

      expect(seen).toEqual(['hello'])
      expect(io.socket.handlers('stdout')).toHaveLength(0)
    })

    it('maps an error acknowledgement to a failed request', async () => {
      const io = fakeIoNamespace()
      io.socket.respondTo('do-thing', { error: 'nope' })

      await expect(io.request('do-thing', { id: 1 })).rejects.toEqual({ error: 'nope' })
      expect(io.requests).toEqual([{ resource: 'do-thing', payload: { id: 1 } }])
    })

    it('tolerates a null acknowledgement', async () => {
      const io = fakeIoNamespace()
      io.socket.respondTo('do-thing', null)

      await expect(io.request('do-thing')).resolves.toBeNull()
    })
  })

  describe('makeSettingsState', () => {
    it('is loaded, so a route loader waiting on it does not hang', () => {
      expect(makeSettingsState().settingsLoaded).toBe(true)
    })

    it('merges env overrides over the defaults', () => {
      const settings = makeSettingsState({ env: { runningInDocker: true } })

      expect(settings.env.runningInDocker).toBe(true)
      expect(settings.env.enableAccessories).toBe(true)
    })
  })

  describe('makeAuthState', () => {
    it('agrees with makeEnv on the instance id', () => {
      expect(makeAuthState().user?.instanceId).toBe(makeEnv().instanceId)
    })

    it('can be signed out', () => {
      expect(makeAuthState({ token: null, user: null })).toEqual({ token: null, user: null })
    })
  })

  describe('fakeOpenModal', () => {
    it('records the props a modal was opened with', () => {
      const modal = fakeOpenModal()

      modal.openModal(() => null, { title: 'Remove', message: 'Are you sure?' }, { size: 'lg' })

      expect(modal.propsFor()?.title).toBe('Remove')
      expect(modal.lastOpened()?.options).toEqual({ size: 'lg' })
    })

    it('resolves the modal result on close and rejects it on dismiss', async () => {
      const modal = fakeOpenModal()

      const closed = modal.openModal(() => null)
      closed.close('done')
      const dismissed = modal.openModal(() => null)
      dismissed.dismiss('cancelled')

      await expect(closed.result).resolves.toBe('done')
      await expect(dismissed.result).rejects.toBe('cancelled')
    })
  })

  describe('toastStub', () => {
    it('records what was raised', () => {
      const toast = toastStub()

      toast.error('Something broke', 'toast.title_error')

      expect(toast.at('error')).toHaveLength(1)
      expect(toast.last()?.title).toBe('toast.title_error')
    })
  })

  describe('cacheStub', () => {
    it('resolves the value it was given until told otherwise', async () => {
      const cache = cacheStub(1)
      await expect(cache.get()).resolves.toBe(1)

      cache.setValue(2)
      await expect(cache.get()).resolves.toBe(2)
    })
  })

  describe('fakeTerminals', () => {
    it('records each terminal built and what was written to it', () => {
      const xterm = fakeTerminals()

      const term = xterm.factory.createTerminal({ fontSize: 12 })
      term.write('hello')

      expect(xterm.term().options).toEqual({ fontSize: 12 })
      expect(xterm.term().written).toEqual(['hello'])
    })
  })

  describe('renderWithProviders', () => {
    function Plugin() {
      const { name } = useParams()
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/elsewhere')}>{name}</button>
    }

    it('mounts the component at its route, with params', () => {
      renderWithProviders(<Plugin />, { route: '/plugins/:name', initialEntries: ['/plugins/homebridge-hue'] })

      expect(screen.getByRole('button')).toHaveTextContent('homebridge-hue')
    })

    it('shows a placeholder for any other route, so navigation is visible', async () => {
      const { router } = renderWithProviders(<Plugin />, { route: '/plugins/:name', initialEntries: ['/plugins/x'] })

      screen.getByRole('button').click()

      expect(await screen.findByTestId('other-route')).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/elsewhere')
    })
  })
})
