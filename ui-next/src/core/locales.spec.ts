/// <reference types="vite/client" />

import { afterEach, describe, expect, it, vi } from 'vitest'

import { chooseStartupLanguage, localeIdFor, storedLanguage, supportedLocales } from '@/core/locales'

/**
 * The language table, and the lists around the app that have to agree with it.
 *
 * - a language shipped but missing from `supportedLocales` falls back to the
 *   `en` locale, so the UI is translated but its dates and number separators
 *   are wrong for the reader;
 * - a language in `supportedLocales` with no translation file loads untranslated.
 *
 * The checks against the settings picker and the config editor's guided schema
 * move here once those modules are ported (Phase 4).
 */
describe('the supported locales', () => {
  /**
   * The translation files the app actually ships.
   *
   * ⚠️ Root-absolute glob pattern: a relative one resolves to nothing under
   * `--coverage`.
   */
  const shippedLanguages = Object.keys(import.meta.glob('/src/i18n/*.json'))
    .map(path => path.split('/').pop()!.replace('.json', ''))
    .sort()

  it('found the translation files to compare against', () => {
    expect(shippedLanguages.length).toBeGreaterThan(20)
  })

  it('ships a translation for every language it lists', () => {
    expect(Object.keys(supportedLocales).sort()).toEqual(shippedLanguages)
  })

  it('lists every translation it ships', () => {
    expect(shippedLanguages.every(lang => lang in supportedLocales)).toBe(true)
  })

  describe('the locale each language maps to', () => {
    it.each(Object.entries(supportedLocales))('is a locale Intl knows for %s', (_lang, locale) => {
      expect(Intl.DateTimeFormat.supportedLocalesOf([locale])).toEqual([locale])
    })

    it('maps the two chinese variants onto their scripts', () => {
      expect(supportedLocales['zh-CN']).toBe('zh-Hans')
      expect(supportedLocales['zh-TW']).toBe('zh-Hant')
    })

    it('maps norwegian onto bokmal', () => {
      // 'no' is a macrolanguage with no data of its own
      expect(supportedLocales.no).toBe('nb')
    })

    it('formats brazilian portuguese with the portuguese locale', () => {
      expect(supportedLocales['pt-BR']).toBe('pt')
    })

    it('has hebrew as its only right-to-left language', () => {
      // The i18n setup keeps its own list of right-to-left languages; this fails
      // if arabic, farsi or urdu is added without adding it there too
      const rightToLeft = Object.entries(supportedLocales)
        .filter(([, locale]) => {
          const intlLocale = new Intl.Locale(locale) as Intl.Locale & { getTextInfo?: () => { direction: string }, textInfo?: { direction: string } }
          return (intlLocale.getTextInfo?.() ?? intlLocale.textInfo)?.direction === 'rtl'
        })
        .map(([lang]) => lang)

      expect(rightToLeft).toEqual(['he'])
    })
  })

  /**
   * What every date and number in the UI is formatted with: decided from the
   * stored language, synchronously at bootstrap.
   */
  describe('the locale dates and numbers are formatted with', () => {
    function localeFor(options: { stored?: string, browser?: string } = {}): string {
      window.localStorage.clear()
      if (options.stored !== undefined) {
        window.localStorage.setItem('uix.lang', options.stored)
      }
      return localeIdFor(chooseStartupLanguage(options.browser, options.browser))
    }

    afterEach(() => {
      vi.restoreAllMocks()
      window.localStorage.clear()
    })

    it('formats for the language the user chose', () => {
      expect(localeFor({ stored: 'de' })).toBe('de')
    })

    it('maps the chosen language through the table', () => {
      expect(localeFor({ stored: 'zh-CN' })).toBe('zh-Hans')
      expect(localeFor({ stored: 'no' })).toBe('nb')
      expect(localeFor({ stored: 'pt-BR' })).toBe('pt')
    })

    it('agrees with the table for every language the app ships', () => {
      const resolved = Object.fromEntries(
        Object.keys(supportedLocales).map(lang => [lang, localeFor({ stored: lang })]),
      )

      expect(resolved).toEqual(supportedLocales)
    })

    it('follows the browser when nothing was chosen', () => {
      expect(localeFor({ browser: 'fr' })).toBe('fr')
    })

    it('follows the browser when the choice is explicitly auto', () => {
      expect(localeFor({ stored: 'auto', browser: 'fr' })).toBe('fr')
    })

    it('ignores a stored language the app no longer ships', () => {
      expect(localeFor({ stored: 'kl', browser: 'fr' })).toBe('fr')
    })

    it('falls back to english when neither says anything useful', () => {
      expect(localeFor()).toBe('en')
      expect(localeFor({ browser: 'kl' })).toBe('en')
    })

    it('prefers the stored language over the browser', () => {
      expect(localeFor({ stored: 'de', browser: 'fr' })).toBe('de')
    })
  })

  describe('choosing the language to start in', () => {
    it('reads nothing from storage when storage is unavailable', () => {
      // Private browsing can make even reading throw, and this runs during
      // bootstrap - throwing here takes the whole app down
      const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
        throw new Error('access denied')
      })
      try {
        expect(storedLanguage()).toBeUndefined()
        expect(chooseStartupLanguage('fr', 'fr-FR')).toBe('fr')
      } finally {
        getItem.mockRestore()
      }
    })

    it('matches the fuller browser language when the short one does not', () => {
      window.localStorage.clear()

      expect(chooseStartupLanguage('pt-BR', 'pt-BR')).toBe('pt-BR')
    })

    it('settles on nothing when the browser language is not shipped', () => {
      window.localStorage.clear()

      expect(chooseStartupLanguage('kl', 'kl-GL')).toBeUndefined()
      expect(localeIdFor(undefined)).toBe('en')
    })
  })
})
