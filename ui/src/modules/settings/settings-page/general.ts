import type { PageContext } from '@/modules/settings/settings-page/types'

import { api } from '@/core/api'
import { chooseStartupLanguage, localeIdFor } from '@/core/locales'
import { RE_HAP_NAME_PATTERN } from '@/core/regex.constants'
import { settingsActions } from '@/core/settings'

/** General and display: the instance name, language, theme, lighting, glass, menu and temperature units. */
export function createGeneralSlice(ctx: PageContext) {
  const { store, setSaving, setInvalid, reportError, queueUiSettingChange, finishSaving, bootLocale, browserLang } = ctx

  const slice = {
    async hbNameSave(value: string): Promise<void> {
      if (!value || !RE_HAP_NAME_PATTERN.test(value)) {
        setInvalid('hbName', true)
        return
      }

      try {
        setSaving('hbName', true)
        await api.put('/server/name', { name: value })
        settingsActions.setEnvItem('homebridgeInstanceName', value)
        setInvalid('hbName', false)
        finishSaving('hbName')
      } catch (error) {
        reportError(error)
        setSaving('hbName', false)
      }
    },

    async uiLangSave(value: string): Promise<void> {
      try {
        setSaving('uiLang', true)
        settingsActions.setLang(value)
        await queueUiSettingChange('lang', value)

        // Reload once the choice is safely saved, if the new language formats its
        // dates and numbers differently.
        //
        // Translated text switches straight away, but the formatting locale - which
        // every date, time and number formatter reads - is decided once when the
        // app loads. Without this the page would go on formatting for the previous
        // language until the user happened to reload.
        //
        // Only when the locale actually differs: switching between two languages
        // that share one (pt and pt-BR), or picking 'auto' when the browser is
        // already set to the same language, should not throw the page away.
        if (slice.localeAfterReload() !== bootLocale) {
          window.location.reload()
          return
        }

        finishSaving('uiLang')
      } catch (error) {
        reportError(error)
        setSaving('uiLang', false)
      }
    },

    /**
     * The locale the UI will format with after the next load.
     *
     * `setLang` has already stored the choice, so this asks the same question the
     * locale is decided by at the next load rather than repeating its rules -
     * 'auto' and a language the app no longer ships included.
     */
    localeAfterReload(): string {
      const { lang, culture } = browserLang()
      return localeIdFor(chooseStartupLanguage(lang, culture))
    },

    async uiThemeSave(value: string): Promise<void> {
      try {
        setSaving('uiTheme', true)

        // Start fade-out animation
        store.setState({ isThemeTransitioning: true })

        // Wait for fade-out to complete
        await new Promise(resolve => setTimeout(resolve, 250))

        // Change the theme (background will transition)
        settingsActions.setTheme(value)
        await queueUiSettingChange('theme', value)

        // Wait for background transition to start, then fade content back in
        await new Promise(resolve => setTimeout(resolve, 100))
        store.setState({ isThemeTransitioning: false })

        finishSaving('uiTheme')
      } catch (error) {
        reportError(error)
        setSaving('uiTheme', false)
        store.setState({ isThemeTransitioning: false })
      }
    },

    async uiLightSave(value: 'auto' | 'light' | 'dark'): Promise<void> {
      try {
        setSaving('uiLight', true)

        // Start fade-out animation
        store.setState({ isThemeTransitioning: true })

        // Wait for fade-out to complete
        await new Promise(resolve => setTimeout(resolve, 250))

        // Change the lighting mode (background will transition)
        settingsActions.setLightingMode(value, 'user')
        await queueUiSettingChange('lightingMode', value)

        // Wait for background transition to start, then fade content back in
        await new Promise(resolve => setTimeout(resolve, 100))
        store.setState({ isThemeTransitioning: false })

        finishSaving('uiLight')
      } catch (error) {
        reportError(error)
        setSaving('uiLight', false)
        store.setState({ isThemeTransitioning: false })
      }
    },

    async uiGlassSave(value: boolean): Promise<void> {
      try {
        setSaving('uiGlass', true)
        settingsActions.setGlassMode(value)
        await queueUiSettingChange('glassMode', value)
        finishSaving('uiGlass')
      } catch (error) {
        reportError(error)
        setSaving('uiGlass', false)
      }
    },

    async uiMenuSave(value: 'default' | 'freeze'): Promise<void> {
      try {
        setSaving('uiMenu', true)
        settingsActions.setMenuMode(value)
        await queueUiSettingChange('menuMode', value)
        window.location.reload()
      } catch (error) {
        reportError(error)
        setSaving('uiMenu', false)
      }
    },

    async uiTempSave(value: string): Promise<void> {
      try {
        setSaving('uiTemp', true)
        settingsActions.setEnvItem('temperatureUnits', value)
        await queueUiSettingChange('tempUnits', value)
        finishSaving('uiTemp')
      } catch (error) {
        reportError(error)
        setSaving('uiTemp', false)
      }
    },
  }

  return slice
}

export type GeneralSlice = ReturnType<typeof createGeneralSlice>
