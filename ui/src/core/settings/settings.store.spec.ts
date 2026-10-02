import type { FakeApi } from '@/core/api/api.fake'

import { Subject } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeApi } from '@/core/api/api.fake'
import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings/settings.store'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'

vi.mock('@/core/ui/toast', async () => {
  const { Subject: RxSubject } = await import('rxjs')
  const raise = () => ({ onHidden: new RxSubject<void>(), onTap: new RxSubject<void>() })
  return {
    toast: { success: vi.fn(raise), error: vi.fn(raise), info: vi.fn(raise), warning: vi.fn(raise) },
  }
})

/** What the mocked toast call handed back. */
function raised(method: 'info' | 'warning', index = 0) {
  return vi.mocked(toast[method]).mock.results[index].value as unknown as { onHidden: Subject<void>, onTap: Subject<void> }
}

vi.mock('@/core/ui/i18n', () => ({
  i18n: { t: vi.fn((key: string) => key), changeLanguage: vi.fn(async () => {}) },
}))

/**
 * The settings store is read by almost everything, so these specs pin the parts
 * other code reads constantly: the theme and lighting rules that paint the page,
 * the two setters that write into `env`, and the terminal option derivation
 * every terminal view depends on.
 */
describe('settings store', () => {
  let api: FakeApi
  const state = () => useSettingsStore.getState()

  function appSettings(overrides: Record<string, any> = {}) {
    return {
      formAuth: true,
      sessionTimeout: 28800,
      sessionTimeoutInactivityBased: false,
      theme: 'teal',
      lightingMode: 'light',
      menuMode: 'default',
      keepOrphans: false,
      wallpaper: '',
      serverTimestamp: new Date().toISOString(),
      env: {
        homebridgeInstanceName: 'Homebridge Test',
        packageVersion: '5.28.1',
        lang: 'en',
        featureFlags: {},
        ...overrides.env,
      },
      ...overrides,
    }
  }

  function create(settings: Record<string, any> = {}) {
    resetSettingsStore()
    api = fakeApi().respond('get', '/auth/settings', appSettings(settings))
  }

  /**
   * A server that refuses the first `failures` requests before answering.
   * @param failures - how many requests to reject before succeeding
   */
  function createFlaky(failures: number) {
    resetSettingsStore()
    let attempts = 0
    api = fakeApi().respond('get', '/auth/settings', () => {
      attempts += 1
      if (attempts <= failures) {
        throw new Error('connection refused')
      }
      return appSettings()
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  }

  beforeEach(() => {
    vi.mocked(toast.info).mockClear()
    vi.mocked(toast.warning).mockClear()
    document.body.className = ''
    create()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    resetSettingsStore()
  })

  describe('loading', () => {
    it('reads the settings and announces that it has finished', async () => {
      create({ env: { homebridgeInstanceName: 'Front Room' } })
      const loaded = vi.fn()
      void settingsActions.whenLoaded().then(loaded)

      await settingsActions.getAppSettings()
      await Promise.resolve()

      expect(state().settingsLoaded).toBe(true)
      expect(state().env.homebridgeInstanceName).toBe('Front Room')
      expect(document.title).toBe('Front Room')
      expect(loaded).toHaveBeenCalledTimes(1)
    })

    it('loads the reduced pre-login settings, then the full set once signed in', async () => {
      // What GET /auth/settings answers before anyone has signed in
      resetSettingsStore()
      api = fakeApi().respond('get', '/auth/settings', {
        ...appSettings(),
        env: { homebridgeInstanceName: 'Front Room', instanceId: 'abc', lang: 'en', setupWizardComplete: true },
      })

      await settingsActions.getAppSettings()

      expect(state().settingsLoaded).toBe(true)
      expect(state().env.instanceId).toBe('abc')
      expect(state().env).not.toHaveProperty('packageVersion')
      expect(state().uiVersion).toBeUndefined()

      // The authorised fetch after sign-in fills in the rest
      api.respond('get', '/auth/settings', appSettings({ env: { packageVersion: '5.28.1', port: 8581 } }))
      await settingsActions.getAppSettings()

      expect(state().uiVersion).toBe('5.28.1')
      expect(state().env.port).toBe(8581)
    })

    it('applies the language the server has', async () => {
      create({ env: { lang: 'de' } })

      await settingsActions.getAppSettings()

      expect(i18n.changeLanguage).toHaveBeenCalledWith('de')
    })

    /**
     * ⚠️ The failure this pins is a blank page, not a missing setting. Every
     * route guard waits on the first load, which only ever settles on success.
     */
    it('retries the first load until the server answers, instead of giving up', async () => {
      vi.useFakeTimers()
      createFlaky(2)
      const loaded = vi.fn()
      void settingsActions.whenLoaded().then(loaded)
      settingsActions.start()

      // The first attempt has already been made and refused
      await vi.advanceTimersByTimeAsync(0)
      expect(state().settingsLoaded).toBe(false)
      expect(state().serverUnreachable).toBe(true)

      // Backs off 1s then 2s before the third attempt succeeds
      await vi.advanceTimersByTimeAsync(3000)

      expect(state().settingsLoaded).toBe(true)
      expect(state().serverUnreachable).toBe(false)
      expect(loaded).toHaveBeenCalledTimes(1)
      expect(api.callsTo('get', '/auth/settings')).toHaveLength(3)
    })

    it('starts only once', async () => {
      settingsActions.start()
      settingsActions.start()
      await settingsActions.whenLoaded()

      expect(api.callsTo('get', '/auth/settings')).toHaveLength(1)
    })

    it('stops retrying once it is stopped, so a torn-down app leaves nothing running', async () => {
      vi.useFakeTimers()
      createFlaky(Number.POSITIVE_INFINITY)
      settingsActions.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(api.callsTo('get', '/auth/settings')).toHaveLength(1)

      settingsActions.stop()
      await vi.advanceTimersByTimeAsync(30000)

      expect(api.callsTo('get', '/auth/settings')).toHaveLength(1)
    })
  })

  describe('the server clock', () => {
    it('warns when the server clock is far off', async () => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null)
      create({ serverTimestamp: new Date(Date.now() + 10.5 * 3600 * 1000).toISOString() })

      await settingsActions.getAppSettings()

      expect(toast.warning).toHaveBeenCalledWith('settings.datetime.incorrect', 'toast.title_warning', expect.objectContaining({ timeOut: 20000, tapToDismiss: false }))
      expect(state().serverTimeOffset).toBe(10 * 3600)

      // Tapping it opens the help page
      raised('warning').onTap.next()
      expect(open).toHaveBeenCalledWith('https://homebridge.io/w/JqTFs', '_blank')
    })

    it('says nothing when the clocks agree', async () => {
      await settingsActions.getAppSettings()

      expect(toast.warning).not.toHaveBeenCalled()
      expect(state().serverTimeOffset).toBe(0)
    })
  })

  describe('lighting mode', () => {
    it.each([
      ['light', 'dark', 'light'],
      ['dark', 'light', 'dark'],
      ['auto', 'dark', 'dark'],
      ['auto', 'light', 'light'],
    ] as const)('resolves %s with a %s browser to %s', (chosen, browser, expected) => {
      useSettingsStore.setState({ browserLightingMode: browser })
      settingsActions.setLightingMode(chosen, 'user')

      expect(state().actualLightingMode).toBe(expected)
    })

    it('remembers the user choice but not the browser one', () => {
      settingsActions.setLightingMode('dark', 'user')
      expect(state().lightingMode).toBe('dark')

      settingsActions.setLightingMode('light', 'browser')
      // A browser change must not overwrite what the user picked, or the
      // preference is lost the moment the OS switches to night mode
      expect(state().lightingMode).toBe('dark')
      expect(state().currentLightingMode).toBe('light')
    })

    it('follows the browser only while set to auto', () => {
      settingsActions.setLightingMode('auto', 'user')
      settingsActions.setBrowserLightingMode('dark')
      expect(state().actualLightingMode).toBe('dark')

      settingsActions.setLightingMode('light', 'user')
      settingsActions.setBrowserLightingMode('dark')
      expect(state().actualLightingMode).toBe('light')
    })
  })

  describe('theme', () => {
    it('applies the theme class to the body', () => {
      settingsActions.setLightingMode('light', 'user')
      settingsActions.setTheme('teal')

      expect(document.body.classList.contains('glass-ui-teal')).toBe(true)
      expect(document.body.classList.contains('dark-mode')).toBe(false)
    })

    it('uses the dark variant and the dark-mode class in dark mode', () => {
      settingsActions.setLightingMode('dark', 'user')
      settingsActions.setTheme('teal')

      expect(document.body.classList.contains('glass-ui-dark-mode-teal')).toBe(true)
      expect(document.body.classList.contains('dark-mode')).toBe(true)
      expect(document.body.classList.contains('terminal-dark')).toBe(true)
    })

    it('removes the previous theme class when switching', () => {
      settingsActions.setLightingMode('light', 'user')
      settingsActions.setTheme('teal')
      settingsActions.setTheme('indigo')

      expect(document.body.classList.contains('glass-ui-teal')).toBe(false)
      expect(document.body.classList.contains('glass-ui-indigo')).toBe(true)
    })

    it.each([
      ['an unknown theme', 'not-a-theme'],
      ['an empty theme', ''],
    ])('falls back to deep purple and saves it for %s', (_case, theme) => {
      api.clearCalls()
      settingsActions.setTheme(theme)

      expect(state().theme).toBe('deep-purple')
      // Writing the fallback back to the config stops the same repair running
      // on every page load
      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({ theme: 'deep-purple' })
    })

    it('keeps working when saving the fallback fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      api.fail('patch', '/config-editor/ui', new Error('offline'))

      expect(() => settingsActions.setTheme('nope')).not.toThrow()
      expect(state().theme).toBe('deep-purple')
      await Promise.resolve()
    })

    it('toggles the glass-mode body class', () => {
      settingsActions.setGlassMode(true)
      expect(document.body.classList.contains('glass-mode')).toBe(true)

      settingsActions.setGlassMode(false)
      expect(document.body.classList.contains('glass-mode')).toBe(false)
      expect(state().glassMode).toBe(false)
    })

    it('tells the terminals when glass mode changes', () => {
      const listener = vi.fn()
      const off = settingsActions.onTerminalSettingsChanged(listener)

      settingsActions.setGlassMode(false)
      off()
      settingsActions.setGlassMode(true)

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({ lightingMode: 'dark' })
    })

    /**
     * ⚠️ Custom plugin UIs live in an iframe, and the theme has to reach into
     * them. Without it a plugin's settings page stays light while the rest of
     * the UI goes dark, which looks like the plugin is broken.
     */
    describe('the theme inside a plugin iframe', () => {
      let iframe: HTMLIFrameElement

      function addIframe(options: { crossOrigin?: boolean } = {}) {
        iframe = document.createElement('iframe')
        document.body.appendChild(iframe)
        if (options.crossOrigin) {
          Object.defineProperty(iframe, 'contentDocument', {
            get() {
              throw new Error('Blocked a frame with origin from accessing a cross-origin frame')
            },
          })
        }
        return iframe
      }

      afterEach(() => {
        iframe?.remove()
      })

      function iframeClasses(): string[] {
        return [...iframe.contentDocument!.body.classList]
      }

      it('gives the iframe the light theme class', () => {
        addIframe()
        settingsActions.setLightingMode('light', 'user')

        settingsActions.setTheme('teal')

        expect(iframeClasses()).toContain('glass-ui-teal')
        expect(iframeClasses()).not.toContain('dark-mode')
      })

      it('gives the iframe the dark variant in dark mode', () => {
        addIframe()
        settingsActions.setLightingMode('dark', 'user')

        settingsActions.setTheme('teal')

        expect(iframeClasses()).toContain('glass-ui-dark-mode-teal')
        expect(iframeClasses()).toContain('dark-mode')
      })

      it('swaps the light class out when the mode changes', () => {
        addIframe()
        settingsActions.setLightingMode('light', 'user')
        settingsActions.setTheme('teal')

        settingsActions.setLightingMode('dark', 'user')

        expect(iframeClasses()).not.toContain('glass-ui-teal')
        expect(iframeClasses()).toContain('glass-ui-dark-mode-teal')
      })

      it('swaps the dark class out again', () => {
        addIframe()
        settingsActions.setLightingMode('dark', 'user')
        settingsActions.setTheme('teal')

        settingsActions.setLightingMode('light', 'user')

        expect(iframeClasses()).not.toContain('glass-ui-dark-mode-teal')
        expect(iframeClasses()).not.toContain('dark-mode')
        expect(iframeClasses()).toContain('glass-ui-teal')
      })

      it('adds nothing twice when the theme is set again', () => {
        addIframe()
        settingsActions.setLightingMode('light', 'user')

        settingsActions.setTheme('teal')
        settingsActions.setTheme('teal')

        expect(iframeClasses().filter(name => name === 'glass-ui-teal')).toHaveLength(1)
      })

      it('mirrors glass mode into the iframe', () => {
        addIframe()

        settingsActions.setGlassMode(true)

        expect(iframeClasses()).toContain('glass-mode')
      })

      it('carries on when an iframe cannot be reached', () => {
        // A plugin UI served from somewhere else. Throwing here would leave the
        // page half-themed
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        addIframe({ crossOrigin: true })
        settingsActions.setLightingMode('light', 'user')

        expect(() => settingsActions.setTheme('teal')).not.toThrow()
        expect(document.body.classList.contains('glass-ui-teal')).toBe(true)
        expect(warn).toHaveBeenCalled()
      })
    })
  })

  describe('setItem', () => {
    it('sets a top level property', () => {
      settingsActions.setItem('host', '192.168.1.10')

      expect(state().host).toBe('192.168.1.10')
    })

    it.each(['__proto__', 'constructor', 'prototype'])('refuses to set %s', (key) => {
      settingsActions.setItem(key, { polluted: true })

      expect(({} as Record<string, any>).polluted).toBeUndefined()
    })
  })

  describe('setEnvItem', () => {
    it('sets a plain key', () => {
      settingsActions.setEnvItem('homebridgeInstanceName', 'Studio')

      expect(state().env.homebridgeInstanceName).toBe('Studio')
    })

    it('creates the intermediate objects for a dotted key', () => {
      useSettingsStore.setState({ env: {} as any })
      settingsActions.setEnvItem('terminal.fontSize', 16)

      expect(state().env.terminal).toEqual({ fontSize: 16 })
    })

    it('keeps the neighbouring values in a nested object', () => {
      useSettingsStore.setState({ env: { terminal: { fontSize: 16, fontWeight: '700' } } as any })
      settingsActions.setEnvItem('terminal.fontSize', 12)

      expect(state().env.terminal).toEqual({ fontSize: 12, fontWeight: '700' })
    })

    it('hands subscribers a new env object', () => {
      // Zustand selectors compare by reference; an in-place write would not re-render
      const before = state().env
      settingsActions.setEnvItem('terminal.fontSize', 12)

      expect(state().env).not.toBe(before)
    })

    it.each([
      ['the last segment', 'ssl.__proto__'],
      ['an intermediate segment', '__proto__.polluted'],
      ['a constructor segment', 'constructor.prototype.polluted'],
    ])('refuses to write through %s', (_case, key) => {
      settingsActions.setEnvItem(key, { polluted: true })

      expect(({} as Record<string, any>).polluted).toBeUndefined()
    })
  })

  describe('feature flags', () => {
    it.each([
      ['an enabled flag', { matterSupport: true }, true],
      ['a disabled flag', { matterSupport: false }, false],
      ['a missing flag', {}, false],
    ])('reports %s', (_case, flags, expected) => {
      useSettingsStore.setState({ env: { featureFlags: flags } as any })

      expect(settingsActions.isFeatureEnabled('matterSupport')).toBe(expected)
    })

    it('reports false when the server sent no flags at all', () => {
      useSettingsStore.setState({ env: {} as any })

      expect(settingsActions.isFeatureEnabled('matterSupport')).toBe(false)
    })
  })

  describe('page title', () => {
    it('joins the instance name and the page name', () => {
      useSettingsStore.setState({ env: { homebridgeInstanceName: 'Front Room' } as any })
      settingsActions.setPageTitle('Plugins')

      expect(document.title).toBe('Front Room — Plugins')
    })

    it('shows the instance name alone when there is no page name', () => {
      useSettingsStore.setState({ env: { homebridgeInstanceName: 'Front Room' } as any })
      settingsActions.setPageTitle()

      expect(document.title).toBe('Front Room')
    })

    it('falls back to Homebridge when the instance has no name', () => {
      useSettingsStore.setState({ env: {} as any })
      settingsActions.setPageTitle('Plugins')

      expect(document.title).toBe('Homebridge — Plugins')
    })
  })

  describe('terminal lighting', () => {
    it('forces a dark terminal whenever the ui is dark', () => {
      useSettingsStore.setState({ actualLightingMode: 'dark', env: { terminal: { lightingMode: 'light' } } as any })

      // Deliberate hard override: a light terminal inside a dark page is unreadable
      expect(settingsActions.getEffectiveTerminalLightingMode()).toBe('dark')
    })

    it('honours the terminal setting while the ui is light', () => {
      useSettingsStore.setState({ actualLightingMode: 'light', env: { terminal: { lightingMode: 'light' } } as any })

      expect(settingsActions.getEffectiveTerminalLightingMode()).toBe('light')
    })

    it('defaults to a dark terminal when nothing is configured', () => {
      useSettingsStore.setState({ actualLightingMode: 'light', env: {} as any })

      expect(settingsActions.getEffectiveTerminalLightingMode()).toBe('dark')
    })
  })

  describe('terminal options', () => {
    beforeEach(() => {
      useSettingsStore.setState({ actualLightingMode: 'dark', env: {} as any })
    })

    it('uses a see-through background on glass so the card shows behind the text', () => {
      useSettingsStore.setState({ glassMode: true })

      const options = settingsActions.getTerminalOptions()

      expect(options.theme).toEqual({ background: '#00000000', selectionBackground: '#ffffff40' })
      expect(options.allowTransparency).toBe(true)
    })

    it('uses a solid black background on a full page terminal', () => {
      useSettingsStore.setState({ glassMode: false })
      const options = settingsActions.getTerminalOptions()

      expect(options.theme).toEqual({ background: '#000000' })
      expect(options.allowTransparency).toBe(false)
    })

    it('uses the widget grey background inside a widget', () => {
      useSettingsStore.setState({ glassMode: false })
      const options = settingsActions.getTerminalOptions(undefined, true)

      expect(options.theme).toEqual({ background: '#2b2b2b' })
    })

    it('uses a transparent background in a light terminal', () => {
      useSettingsStore.setState({ actualLightingMode: 'light', env: { terminal: { lightingMode: 'light' } } as any })

      const options = settingsActions.getTerminalOptions()

      expect(options.theme).toMatchObject({ background: '#00000000', foreground: '#2b2b2b' })
      expect(options.allowTransparency).toBe(true)
    })

    it('uses ANSI red and yellow that pass WCAG AA (4.5:1) in a light terminal', () => {
      useSettingsStore.setState({ actualLightingMode: 'light', env: { terminal: { lightingMode: 'light' } } as any })
      const luminance = (hex: string) => {
        const [r, g, b] = [1, 3, 5].map((i) => {
          const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const contrast = (a: string, b: string) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
        return (hi + 0.05) / (lo + 0.05)
      }
      // xterm's own red fails on the light pane, which is what this guards against
      expect(contrast('#cd3131', '#e0e0e0')).toBeLessThan(4.6)

      const { theme } = settingsActions.getTerminalOptions()

      for (const key of ['red', 'brightRed', 'yellow', 'brightYellow'] as const) {
        expect(theme?.[key]).toMatch(/^#[0-9a-f]{6}$/)
        // the light terminal sits on white (.terminal-light-bg), or a light grey glass pane
        expect(contrast(theme![key]!, '#ffffff')).toBeGreaterThanOrEqual(4.5)
        expect(contrast(theme![key]!, '#e0e0e0')).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('keeps xterm\'s own palette in a dark terminal', () => {
      useSettingsStore.setState({ glassMode: false })

      expect(settingsActions.getTerminalOptions().theme).not.toHaveProperty('red')
    })

    it('applies the default font settings', () => {
      expect(settingsActions.getTerminalOptions()).toMatchObject({ fontSize: 13, fontWeight: '400', lineHeight: 1.2, screenReaderMode: true })
    })

    it('prefers the configured font settings', () => {
      useSettingsStore.setState({ env: { terminal: { fontSize: 18, fontWeight: '700' } } as any })

      expect(settingsActions.getTerminalOptions()).toMatchObject({ fontSize: 18, fontWeight: '700' })
    })

    it('lets a caller override anything', () => {
      const options = settingsActions.getTerminalOptions({ disableStdin: true, fontSize: 20 })

      expect(options.disableStdin).toBe(true)
      expect(options.fontSize).toBe(20)
    })
  })

  describe('language', () => {
    it('remembers the chosen language', () => {
      settingsActions.setLang('de')

      expect(window.localStorage.getItem('uix.lang')).toBe('de')
      expect(state().env.lang).toBe('de')
      expect(i18n.changeLanguage).toHaveBeenCalledWith('de')
    })

    it('forgets the choice when the language is cleared', () => {
      settingsActions.setLang('de')
      settingsActions.setLang('')

      expect(window.localStorage.getItem('uix.lang')).toBeNull()
      expect(state().env.lang).toBe('auto')
    })

    it('survives a browser that blocks local storage', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      expect(() => settingsActions.setLang('de')).not.toThrow()
      expect(state().env.lang).toBe('de')
    })
  })

  describe('restart toast', () => {
    it('shows only one toast at a time', () => {
      settingsActions.showRestartToast()
      settingsActions.showRestartToast()

      // Every saved setting asks for this toast, so without the guard a
      // settings page visit stacks a column of identical toasts
      expect(toast.info).toHaveBeenCalledTimes(1)
    })

    it('can be shown again once the first one has gone', () => {
      settingsActions.showRestartToast()
      raised('info').onHidden.next()
      settingsActions.showRestartToast()

      expect(toast.info).toHaveBeenCalledTimes(2)
    })

    it('stays on screen until it is acted on', () => {
      settingsActions.showRestartToast()

      expect(vi.mocked(toast.info).mock.calls[0]).toEqual([
        'settings.changes.saved',
        'menu.hbrestart.title',
        expect.objectContaining({ timeOut: 0, disableTimeOut: true, tapToDismiss: false, toastClass: 'ngx-toastr hb-restart-toast' }),
      ])
    })
  })
})
