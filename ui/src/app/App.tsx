import type { createBrowserRouter } from 'react-router'

import { useEffect, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider } from 'react-router'

import { getAppRouter } from '@/app/routes'
import { authActions } from '@/core/auth'
import { RestartChildBridges } from '@/core/components/restart-child-bridges/RestartChildBridges'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { RestartToast } from '@/core/components/restart-toast/RestartToast'
import { ServerUnreachable } from '@/core/components/server-unreachable/ServerUnreachable'
import { chooseStartupLanguage } from '@/core/locales'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n, isRtl } from '@/core/ui/i18n'
import { childBridges } from '@/core/utilities/child-bridges'

import './app.scss'

// The components core code opens without importing them (it would be a cycle)
settingsActions.setRestartToastComponent(RestartToast)
childBridges.registerRestartModals({ childBridges: RestartChildBridges, homebridge: RestartHomebridge })

/** The browser language as ngx-translate's `getBrowserLang()` gave it (`pt` for `pt-BR`). */
function browserLang(): string | undefined {
  return navigator.language?.split('-')[0]?.split('_')[0]
}

/** The full browser language (`getBrowserCultureLang()`), e.g. `pt-BR`. */
function browserCultureLang(): string | undefined {
  return navigator.languages?.[0] ?? navigator.language
}

export interface AppProps {
  /** The router to render; the app's own one unless a spec passes another. */
  router?: ReturnType<typeof createBrowserRouter>
}

/** The app shell (AppComponent). */
export function App({ router }: AppProps) {
  const serverUnreachable = useSettingsStore(s => s.serverUnreachable)
  const [appRouter] = useState(() => router ?? getAppRouter())

  // Restore the session (and start the settings load). Idempotent.
  useEffect(() => {
    void authActions.init()
  }, [])

  // Follow the browser's dark mode preference
  useEffect(() => {
    const colorSchemeQueryList = window.matchMedia('(prefers-color-scheme: dark)')
    const setLightingMode = (event: MediaQueryList | MediaQueryListEvent) => {
      settingsActions.setBrowserLightingMode(event.matches ? 'dark' : 'light')
    }
    setLightingMode(colorSchemeQueryList)
    colorSchemeQueryList.addEventListener('change', setLightingMode)
    return () => {
      colorSchemeQueryList.removeEventListener('change', setLightingMode)
    }
  }, [])

  // Which languages use RTL; the page's language follows the UI language, so
  // screen readers pronounce it in the right voice. The direction stays ltr,
  // as in the Angular UI: the stylesheets are not built for rtl yet
  useEffect(() => {
    const onLanguageChanged = (lang: string) => {
      const rtl = isRtl(lang)
      settingsActions.setItem('rtl', rtl)
      if (lang && lang !== 'cimode') {
        document.documentElement.lang = lang
      }
    }
    if (i18n.language) {
      onLanguageChanged(i18n.language)
    }
    i18n.on('languageChanged', onLanguageChanged)
    return () => {
      i18n.off('languageChanged', onLanguageChanged)
    }
  }, [])

  // Prefer the last user-selected language (persisted in localStorage) so
  // bootstrap renders in the chosen locale before the server settings arrive;
  // fall back to the browser-detected language. The same decision decides which
  // locale dates and numbers are formatted with, so it is made in one place -
  // see chooseStartupLanguage. Don't override a language the settings store
  // already set from the server.
  useEffect(() => {
    const lang = chooseStartupLanguage(browserLang(), browserCultureLang())
    if (lang && !useSettingsStore.getState().settingsLoaded) {
      void i18n.changeLanguage(lang)
    }
  }, [])

  return (
    <I18nextProvider i18n={i18n}>
      {serverUnreachable && <ServerUnreachable />}
      <RouterProvider router={appRouter} />
    </I18nextProvider>
  )
}
