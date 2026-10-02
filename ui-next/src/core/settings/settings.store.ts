import type { AppSettingsInterface, EnvInterface } from '@/core/interfaces/settings.interfaces'
import type { ActiveToast, ToastOverrides } from '@/core/ui/toast'
import type { ITerminalOptions } from '@xterm/xterm'

import dayjs from 'dayjs'
import { create } from 'zustand'

import { api } from '@/core/api'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'

/**
 * The UI settings from GET /auth/settings, plus the theme / lighting state the
 * store paints onto `<body>`. Replaces SettingsService: read with
 * `useSettingsStore(s => s.env)` in a component, `useSettingsStore.getState()`
 * elsewhere, and change through `settingsActions`.
 */
export interface SettingsState {
  env: EnvInterface
  host: string
  proxyHost: string
  formAuth: boolean
  sessionTimeout: number
  sessionTimeoutInactivityBased: boolean
  uiVersion: string
  theme: string
  lightingMode: 'auto' | 'light' | 'dark'
  currentLightingMode: 'auto' | 'light' | 'dark'
  actualLightingMode: 'light' | 'dark'
  browserLightingMode: 'light' | 'dark'
  glassMode: boolean
  menuMode: 'default' | 'freeze'
  keepOrphans: boolean
  wallpaper: string
  serverTimeOffset: number
  /** True when the current translation is right to left (set by the shell). */
  rtl: boolean
  /** The browser language, e.g. `pt-BR`. */
  browserLang: string
  settingsLoaded: boolean
  /**
   * Set while the very first settings load is failing and being retried, so the
   * app can show that it is waiting rather than nothing at all. Only the initial
   * load touches this - once the settings are in, it is never set again.
   */
  serverUnreachable: boolean
}

export const themeList = [
  'orange',
  'red',
  'pink',
  'purple',
  'deep-purple',
  'indigo',
  'blue',
  'blue-grey',
  'cyan',
  'green',
  'teal',
  'grey',
  'brown',
] as const

const DEFAULT_THEME = 'deep-purple'
const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype']

// Back off to a steady five seconds: a server that is restarting is usually
// back within a few seconds, and one that is not should not be hammered.
const RETRY_DELAYS_MS = [1000, 2000, 5000]

/** A fresh copy of the state before anything has loaded. Also used by specs to reset the store. */
export function initialSettingsState(): SettingsState {
  return {
    env: {} as EnvInterface,
    host: undefined as unknown as string,
    proxyHost: undefined as unknown as string,
    formAuth: true,
    sessionTimeout: 28800,
    sessionTimeoutInactivityBased: false,
    uiVersion: undefined as unknown as string,
    theme: undefined as unknown as string,
    lightingMode: undefined as unknown as 'auto',
    currentLightingMode: undefined as unknown as 'auto',
    actualLightingMode: undefined as unknown as 'light',
    browserLightingMode: undefined as unknown as 'light',
    glassMode: true,
    menuMode: undefined as unknown as 'default',
    keepOrphans: undefined as unknown as boolean,
    wallpaper: undefined as unknown as string,
    serverTimeOffset: 0,
    rtl: false,
    browserLang: undefined as unknown as string,
    settingsLoaded: false,
    serverUnreachable: false,
  }
}

export const useSettingsStore = create<SettingsState>()(() => initialSettingsState())

const get = () => useSettingsStore.getState()
const set = (partial: Partial<SettingsState>) => useSettingsStore.setState(partial)

export interface TerminalSettingsChange {
  fontSize?: number
  fontWeight?: string
  lightingMode?: 'light' | 'dark'
}

type Listener<T> = (value: T) => void

const terminalListeners = new Set<Listener<TerminalSettingsChange>>()

let loadedResolve: () => void = () => {}
let loadedPromise = new Promise<void>((resolve) => {
  loadedResolve = resolve
})
let loadStarted = false
let destroyed = false
let restartToastRef: ActiveToast | null = null
let restartToastComponent: ToastOverrides['toastComponent']
let serverTimeToastTap: { unsubscribe: () => void } | null = null

// Terminal configuration constants
const TERMINAL_DEFAULTS = {
  FONT_SIZE: 13,
  FONT_WEIGHT: '400' as const,
  LINE_HEIGHT: 1.2,
} as const

const TERMINAL_COLORS = {
  DARK: {
    FULL_PAGE: '#000000',
    WIDGET: '#2b2b2b',
  },
  GLASS: {
    BACKGROUND: '#00000000',
    SELECTION: '#ffffff40',
  },
  LIGHT: {
    BACKGROUND: '#00000000',
    FOREGROUND: '#2b2b2b',
    CURSOR: '#d2d2d2',
    SELECTION: '#d2d2d2',
  },
} as const

function browserCultureLang(): string | undefined {
  if (typeof navigator === 'undefined') {
    return undefined
  }
  return navigator.languages?.[0] ?? navigator.language
}

/**
 * Check to make sure the server time is roughly the same as the client time.
 * A warning is shown if the time difference is >= 8 hours.
 * @param timestamp - the server's clock
 */
function checkServerTime(timestamp: string) {
  const serverTime = dayjs(timestamp)
  const diff = serverTime.diff(dayjs(), 'hour')
  set({ serverTimeOffset: diff * 60 * 60 })
  if (diff >= 8 || diff <= -8) {
    // Clean up the previous warning's tap handler if there is one
    serverTimeToastTap?.unsubscribe()

    const warning = toast.warning(
      i18n.t('settings.datetime.incorrect'),
      i18n.t('toast.title_warning'),
      {
        timeOut: 20000,
        tapToDismiss: false,
      },
    )

    serverTimeToastTap = warning.onTap.subscribe(() => {
      window.open('https://homebridge.io/w/JqTFs', '_blank')
    })
  }
}

function setTitle(title: string) {
  document.title = title || 'Homebridge'
}

export const settingsActions = {
  /**
   * Start the first settings load (what SettingsService's constructor did).
   * Idempotent: the second call does nothing.
   */
  start(): void {
    if (loadStarted) {
      return
    }
    loadStarted = true
    destroyed = false
    void settingsActions.loadAppSettingsWithRetry()
  },

  /** Stop retrying (SettingsService.ngOnDestroy). */
  stop(): void {
    destroyed = true
  },

  /** Resolves once the settings have loaded the first time (`onSettingsLoaded`). */
  whenLoaded(): Promise<void> {
    return get().settingsLoaded ? Promise.resolve() : loadedPromise
  },

  /**
   * The first settings load, retried until it lands.
   *
   * Nothing in the app can render until it does: every route guard, the layout
   * and the login page all wait on it, and it only ever settles on success. A
   * single failed request therefore used to leave the app on a blank page for
   * ever - no error, no retry, and no route activated to render one.
   *
   * That is not an unlikely case. Refreshing the page while the UI restarts
   * after updating itself hits it every time.
   */
  async loadAppSettingsWithRetry(): Promise<void> {
    // `destroyed` is flipped by stop(), between the awaits
    // eslint-disable-next-line no-unmodified-loop-condition
    for (let attempt = 0; !destroyed; attempt++) {
      try {
        await settingsActions.getAppSettings()
        set({ serverUnreachable: false })
        return
      } catch (error) {
        // Only the first one: this retries for as long as the server is away,
        // and a line every five seconds would bury whatever else is in there.
        if (attempt === 0) {
          console.error('Could not load the app settings, retrying until the server answers...', error)
        }
        set({ serverUnreachable: true })
        const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  },

  async getAppSettings(): Promise<void> {
    const data = await api.get<AppSettingsInterface>('/auth/settings')
    set({
      formAuth: data.formAuth,
      sessionTimeout: data.sessionTimeout,
      sessionTimeoutInactivityBased: data.sessionTimeoutInactivityBased,
      env: data.env,
      host: data.host!,
      proxyHost: data.proxyHost!,
      lightingMode: data.lightingMode,
      wallpaper: data.wallpaper,
    })
    settingsActions.setLightingMode(data.lightingMode, 'user')
    settingsActions.setTheme(data.theme)
    settingsActions.setGlassMode(data.glassMode !== false)
    settingsActions.setMenuMode(data.menuMode)
    settingsActions.setKeepOrphans(data.keepOrphans)
    setTitle(data.env.homebridgeInstanceName)
    checkServerTime(data.serverTimestamp)
    settingsActions.setUiVersion(data.env.packageVersion)
    settingsActions.setLang(data.env.lang!)
    set({ settingsLoaded: true, browserLang: browserCultureLang()! })
    loadedResolve()
  },

  setBrowserLightingMode(lighting: 'light' | 'dark'): void {
    set({ browserLightingMode: lighting })
    if (get().lightingMode === 'auto') {
      settingsActions.setLightingMode(lighting, 'browser')
    }
  },

  setLightingMode(lightingMode: 'auto' | 'light' | 'dark', source: 'user' | 'browser'): void {
    if (source === 'user') {
      set({ lightingMode })
    }
    set({
      currentLightingMode: lightingMode,
      actualLightingMode: lightingMode === 'auto' ? get().browserLightingMode : lightingMode,
    })
    if (get().theme) {
      settingsActions.setTheme(get().theme)
    }
  },

  setTheme(theme: string): void {
    // Default theme is deep-purple
    if (!theme || !(themeList as readonly string[]).includes(theme)) {
      theme = DEFAULT_THEME

      // Save the new property to the config file
      api.patch('/config-editor/ui', { theme })
        .catch(error => console.error('Error saving setTheme:', error))
    }

    const body = window.document.body
    const previous = get().theme

    // Remove all existing theme classes
    body.classList.remove(`glass-ui-${previous}`)
    body.classList.remove(`glass-ui-dark-mode-${previous}`)

    // Set the new theme
    set({ theme })
    const dark = get().actualLightingMode === 'dark'
    if (dark) {
      body.classList.add(`glass-ui-dark-mode-${theme}`)
      body.classList.add('dark-mode')
    } else {
      body.classList.add(`glass-ui-${theme}`)
      body.classList.remove('dark-mode')
    }

    settingsActions.updateTerminalBodyClass()

    // Custom plugin UIs live in same-origin iframes and the theme has to reach
    // into them, or a plugin's settings page stays light in a dark UI
    window.document.querySelectorAll('iframe').forEach((iframe, index) => {
      try {
        const iframeBody = iframe.contentDocument?.body
        if (iframeBody) {
          iframeBody.classList.toggle(`glass-ui-${theme}`, !dark)
          iframeBody.classList.toggle(`glass-ui-dark-mode-${theme}`, dark)
          iframeBody.classList.toggle('dark-mode', dark)
        }
      } catch (e) {
        console.warn(`Iframe ${index}: Access denied (cross-origin?)`, { error: e, src: iframe.src })
      }
    })
  },

  /**
   * Toggle the liquid glass surfaces. The look is pure CSS scoped under the
   * glass-mode body class, so switching it needs no reload - only the terminals
   * are told, because their background colour is set in code rather than CSS.
   */
  setGlassMode(enabled: boolean): void {
    set({ glassMode: enabled })
    window.document.body.classList.toggle('glass-mode', enabled)
    window.document.querySelectorAll('iframe').forEach((iframe) => {
      try {
        iframe.contentDocument?.body.classList.toggle('glass-mode', enabled)
      } catch {
        // Cross-origin iframe, nothing to do
      }
    })
    settingsActions.emitTerminalSettingsChanged({ lightingMode: settingsActions.getEffectiveTerminalLightingMode() })
  },

  /**
   * Mark the body when terminals and log viewers use the dark theme. On light
   * glass a dark terminal would otherwise print white text on a pale pane, so the
   * glass styles give those panes a dark tint while this class is set.
   */
  updateTerminalBodyClass(): void {
    window.document.body.classList.toggle('terminal-dark', settingsActions.getEffectiveTerminalLightingMode() === 'dark')
  },

  setMenuMode(value: 'default' | 'freeze'): void {
    set({ menuMode: value })
  },

  setKeepOrphans(value: boolean): void {
    set({ keepOrphans: value })
  },

  setUiVersion(version: string): void {
    if (!get().uiVersion) {
      set({ uiVersion: version })
    }
  },

  setLang(lang: string): void {
    if (lang) {
      void i18n.changeLanguage(lang)
      try {
        window.localStorage.setItem('uix.lang', lang)
      } catch {
        // Some private-browsing modes block localStorage writes; ignore.
      }
    } else {
      lang = 'auto'
      try {
        window.localStorage.removeItem('uix.lang')
      } catch {
        // ignored
      }
    }
    set({ env: { ...get().env, lang } })
  },

  /** Set a top-level state field by name. */
  setItem(key: string, value: any): void {
    if (FORBIDDEN_KEYS.includes(key)) {
      return
    }
    useSettingsStore.setState({ [key]: value } as Partial<SettingsState>)
  },

  /**
   * Set a field of `env`; a dotted key (`terminal.fontSize`) writes a nested
   * one, creating the objects on the way. The objects along the path are
   * copied so subscribers see a new `env`.
   */
  setEnvItem(key: string, value: any): void {
    const keys = key.split('.')
    if (keys.some(part => FORBIDDEN_KEYS.includes(part))) {
      return
    }
    const env: Record<string, any> = { ...get().env }
    let current = env
    for (let i = 0; i < keys.length - 1; i += 1) {
      const next = current[keys[i]]
      current[keys[i]] = next && typeof next === 'object' ? { ...next } : {}
      current = current[keys[i]]
    }
    current[keys.at(-1)!] = value
    set({ env: env as EnvInterface })
  },

  setPageTitle(pageTitle?: string): void {
    const baseName = get().env.homebridgeInstanceName || 'Homebridge'
    document.title = pageTitle ? `${baseName} — ${pageTitle}` : baseName
  },

  /**
   * Check if a specific feature is enabled based on feature flags
   * @param featureKey - The feature flag key to check
   */
  isFeatureEnabled(featureKey: string): boolean {
    return get().env.featureFlags?.[featureKey] ?? false
  },

  /**
   * Show the "changes saved — restart required" toast: an announced message
   * plus a focusable Restart button and Close button (clicking elsewhere on the
   * toast does nothing). Shared by the settings and backup pages. The toast is a
   * singleton — repeat calls while one is already showing are no-ops.
   */
  showRestartToast(): void {
    if (restartToastRef) {
      return
    }

    restartToastRef = toast.info(
      i18n.t('settings.changes.saved'),
      i18n.t('menu.hbrestart.title'),
      {
        ...(restartToastComponent ? { toastComponent: restartToastComponent } : {}),
        // Extra class so the cursor override (only the buttons are clickable,
        // not the whole toast) can be scoped to this toast — see toastr.scss.
        toastClass: 'ngx-toastr hb-restart-toast',
        timeOut: 0,
        tapToDismiss: false,
        disableTimeOut: true,
        positionClass: 'toast-bottom-right',
      },
    )

    restartToastRef.onHidden?.subscribe(() => {
      restartToastRef = null
    })
  },

  /**
   * The component the restart toast renders (RestartToastComponent: the
   * Restart and Close buttons). Registered by the app shell so this store does
   * not import a component.
   * @param component - the toast component
   */
  setRestartToastComponent(component: ToastOverrides['toastComponent']): void {
    restartToastComponent = component
  },

  /** Listen for terminal look changes (font, lighting). Returns the unsubscribe. */
  onTerminalSettingsChanged(listener: Listener<TerminalSettingsChange>): () => void {
    terminalListeners.add(listener)
    return () => {
      terminalListeners.delete(listener)
    }
  },

  emitTerminalSettingsChanged(change: TerminalSettingsChange): void {
    // A snapshot, so a listener may unsubscribe itself while being called
    for (const listener of Array.from(terminalListeners)) {
      listener(change)
    }
  },

  /**
   * The effective terminal theme. The terminal MUST be dark when the main
   * lighting mode is dark, regardless of the config: a light terminal inside a
   * dark page is unreadable.
   */
  getEffectiveTerminalLightingMode(): 'dark' | 'light' {
    if (get().actualLightingMode === 'dark') {
      return 'dark'
    }
    return get().env.terminal?.lightingMode || 'dark'
  },

  /**
   * Theme options for terminals.
   * @param isWidget - uses the #2b2b2b widget background in dark mode
   */
  getTerminalThemeOptions(isWidget = false): { theme: any, allowTransparency: boolean } {
    const theme = settingsActions.getEffectiveTerminalLightingMode()

    // On glass the terminal is see-through so the frosted card shows behind the text
    if (get().glassMode && theme === 'dark') {
      return {
        theme: {
          background: TERMINAL_COLORS.GLASS.BACKGROUND,
          selectionBackground: TERMINAL_COLORS.GLASS.SELECTION,
        },
        allowTransparency: true,
      }
    }

    if (theme === 'light') {
      return {
        theme: {
          background: TERMINAL_COLORS.LIGHT.BACKGROUND,
          foreground: TERMINAL_COLORS.LIGHT.FOREGROUND,
          cursor: TERMINAL_COLORS.LIGHT.CURSOR,
          selectionBackground: TERMINAL_COLORS.LIGHT.SELECTION,
        },
        allowTransparency: true,
      }
    }

    return {
      theme: {
        background: isWidget ? TERMINAL_COLORS.DARK.WIDGET : TERMINAL_COLORS.DARK.FULL_PAGE,
      },
      allowTransparency: false,
    }
  },

  /**
   * Terminal options with the global font settings applied.
   * @param overrides - options that win over everything
   * @param isWidget - uses the #2b2b2b widget background in dark mode
   */
  getTerminalOptions(overrides?: Partial<ITerminalOptions>, isWidget = false): ITerminalOptions {
    const themeOptions = settingsActions.getTerminalThemeOptions(isWidget)
    const terminal = get().env.terminal
    return {
      fontSize: terminal?.fontSize || TERMINAL_DEFAULTS.FONT_SIZE,
      fontWeight: terminal?.fontWeight || TERMINAL_DEFAULTS.FONT_WEIGHT,
      lineHeight: TERMINAL_DEFAULTS.LINE_HEIGHT,
      allowProposedApi: true,
      theme: themeOptions.theme,
      allowTransparency: themeOptions.allowTransparency,
      screenReaderMode: true,
      ...overrides,
    } as ITerminalOptions
  },
}

/** Put the store back to its first-load state. For specs. */
export function resetSettingsStore(): void {
  destroyed = true
  loadStarted = false
  restartToastRef = null
  serverTimeToastTap?.unsubscribe()
  serverTimeToastTap = null
  terminalListeners.clear()
  loadedPromise = new Promise<void>((resolve) => {
    loadedResolve = resolve
  })
  useSettingsStore.setState(initialSettingsState(), true)
}
