import type { MockInstance } from 'vitest'

import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authActions } from '@/core/auth'
import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { fireMatchMediaChange, locationReload, setMatchMedia } from '@/testing'
import { showKeys } from '@/testing/i18n'

import { App } from './App'
import { isChunkLoadError } from './chunk-error'
import { RouteError } from './RouteError'

// The real table lazy-loads every page; the shell is tested with its own router
vi.mock('@/app/routes', () => ({
  getAppRouter: () => {
    throw new Error('specs pass a router')
  },
}))

/**
 * The app shell. Its own job is small and entirely about recovery and locale:
 *
 * ⚠️ **the chunk-load reload.** After a deploy the router asks for a hashed JS
 * file that no longer exists, the route's `lazy` rejects, and the user is left on
 * a blank page with only a console error. Detecting that and forcing a reload is
 * the difference between "it fixed itself" and "the UI is broken".
 */
describe('app', () => {
  let init: MockInstance<typeof authActions.init>

  function shell(routes = [{ path: '*', element: <div data-testid="page" /> }]) {
    const router = createMemoryRouter(routes)
    return render(<App router={router} />)
  }

  function setBrowserLanguage(lang: string) {
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(lang)
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue([lang])
  }

  beforeEach(() => {
    resetSettingsStore()
    init = vi.spyOn(authActions, 'init').mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await showKeys()
  })

  it('restores the session on start', () => {
    shell()

    expect(init).toHaveBeenCalled()
  })

  it('renders the routed page', () => {
    shell()

    expect(screen.getByTestId('page')).toBeInTheDocument()
  })

  describe('recovering from a stale chunk after a deploy', () => {
    it.each([
      ['a ChunkLoadError by name', { name: 'ChunkLoadError', message: 'whatever' }],
      ['the webpack message', { name: 'Error', message: 'Loading chunk 42 failed' }],
      ['the vite message', { name: 'TypeError', message: 'Failed to fetch dynamically imported module: /x.js' }],
      ['the firefox message', { name: 'TypeError', message: 'error loading dynamically imported module: /x.js' }],
      ['the safari message', { name: 'TypeError', message: 'Importing a module script failed.' }],
    ])('recognises %s', (_label, error) => {
      expect(isChunkLoadError(error)).toBe(true)
    })

    it('matches the chunk message whatever its case', () => {
      expect(isChunkLoadError({ name: 'Error', message: 'loading CHUNK 42 failed' })).toBe(true)
    })

    it.each([
      ['an ordinary failure', new Error('Cannot match any routes')],
      ['a non-object error', 'something went wrong'],
      ['no error at all', null],
    ])('leaves %s alone', (_label, error) => {
      // A guard rejecting, or a 404 route, must not reload in a loop
      expect(isChunkLoadError(error)).toBe(false)
    })

    it('reloads the page when a lazy page cannot be fetched', async () => {
      shell([{
        path: '*',
        ErrorBoundary: RouteError,
        lazy: async () => {
          throw Object.assign(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))
        },
      } as any])

      await vi.waitFor(() => expect(locationReload).toHaveBeenCalled())
    })

    it('leaves an ordinary navigation failure alone', async () => {
      shell([{
        path: '*',
        ErrorBoundary: RouteError,
        loader: () => {
          throw new Error('Cannot match any routes')
        },
      } as any])

      await vi.waitFor(() => expect(console.error).toHaveBeenCalled())
      expect(locationReload).not.toHaveBeenCalled()
    })
  })

  describe('following the browser theme', () => {
    it('tells the settings which way the browser is set on load', () => {
      const setLighting = vi.spyOn(settingsActions, 'setBrowserLightingMode')
      setMatchMedia(true)
      shell()

      expect(setLighting).toHaveBeenCalledWith('dark')
    })

    it('reads a light browser as light', () => {
      const setLighting = vi.spyOn(settingsActions, 'setBrowserLightingMode')
      setMatchMedia(false)
      shell()

      expect(setLighting).toHaveBeenCalledWith('light')
    })

    it('follows the browser when the user changes it mid-session', () => {
      const setLighting = vi.spyOn(settingsActions, 'setBrowserLightingMode')
      setMatchMedia(false)
      shell()
      setLighting.mockClear()

      fireMatchMediaChange(true)

      expect(setLighting).toHaveBeenCalledWith('dark')
    })

    it('stops following once the shell is gone', () => {
      const setLighting = vi.spyOn(settingsActions, 'setBrowserLightingMode')
      setMatchMedia(false)
      const { unmount } = shell()
      unmount()
      setLighting.mockClear()

      fireMatchMediaChange(true)

      expect(setLighting).not.toHaveBeenCalled()
    })
  })

  describe('right to left languages', () => {
    it('turns the layout around for hebrew', async () => {
      shell()

      await act(async () => {
        await i18n.changeLanguage('he')
      })

      expect(useSettingsStore.getState().rtl).toBe(true)
    })

    it('leaves it alone for every other language', async () => {
      shell()

      await act(async () => {
        await i18n.changeLanguage('de')
      })

      expect(useSettingsStore.getState().rtl).toBe(false)
    })
  })

  describe('picking the starting language', () => {
    async function settle() {
      await vi.waitFor(() => expect(i18n.language).not.toBe('cimode'), { timeout: 5000 })
    }

    it('prefers the language the user last chose', async () => {
      // Persisted in localStorage so the very first render is already in the
      // right locale, before the server settings arrive
      window.localStorage.setItem('uix.lang', 'de')
      setBrowserLanguage('fr')
      shell()
      await settle()

      expect(i18n.language).toBe('de')
    })

    it('falls back to the browser language when nothing was chosen', async () => {
      setBrowserLanguage('fr-FR')
      shell()
      await settle()

      expect(i18n.language).toBe('fr')
    })

    it('treats an explicit auto choice as no choice', async () => {
      window.localStorage.setItem('uix.lang', 'auto')
      setBrowserLanguage('fr')
      shell()
      await settle()

      expect(i18n.language).toBe('fr')
    })

    it('ignores a stored language the app does not ship', async () => {
      // A locale removed in an update would otherwise leave the UI untranslated
      window.localStorage.setItem('uix.lang', 'kl')
      setBrowserLanguage('fr')
      shell()
      await settle()

      expect(i18n.language).toBe('fr')
    })

    it('does not override the language the server settings chose', async () => {
      useSettingsStore.setState({ settingsLoaded: true })
      setBrowserLanguage('fr')
      shell()
      await act(async () => {})

      expect(i18n.language).toBe('cimode')
    })

    it('always has english to fall back on', () => {
      setBrowserLanguage('kl')
      shell()

      expect(i18n.options.fallbackLng).toEqual(['en'])
    })
  })

  /**
   * ⚠️ The one thing the shell can render itself. Until the settings arrive no
   * route can activate, so if the first load is failing the shell has to say so
   * - otherwise the user is looking at an empty page with no clue that anything
   * is happening.
   */
  describe('waiting for the server', () => {
    it('says it is waiting when the first settings load has not landed', () => {
      useSettingsStore.setState({ serverUnreachable: true })
      shell()

      expect(document.querySelector('.hb-unreachable')).toBeTruthy()
    })

    it('shows nothing extra once the settings are in', () => {
      shell()

      expect(document.querySelector('.hb-unreachable')).toBeNull()
    })
  })
})
