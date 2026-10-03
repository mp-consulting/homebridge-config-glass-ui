/// <reference types="vite/client" />

import { afterEach, describe, expect, it, vi } from 'vitest'

import { chooseStartupLanguage, localeIdFor, storedLanguage, supportedLocales } from '@/core/locales'

/**
 * The language table, and the lists around the app that have to agree with it.
 *
 * - a language shipped but missing from `supportedLocales` falls back to the
 *   `en` locale, so the UI is translated but its dates and number separators
 *   are wrong for the reader;
 * - a language in `supportedLocales` with no translation file loads untranslated;
 * - a language missing from the settings picker or the config editor's guided
 *   schema is shipped, translated, and unreachable.
 *
 * ⚠️ The last two lists are read out of the source files rather than imported,
 * because both are literals inside a module that does not export them. Each
 * lookup asserts it matched something first — a moved block has to fail loudly
 * here rather than quietly check an empty list.
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

  /** The sources of the two modules carrying a hand-written language list. */
  const sources = import.meta.glob<string>(
    ['/src/modules/settings/sections/DisplaySection.tsx', '/src/modules/config-editor/config-schema.ts'],
    { query: '?raw', import: 'default', eager: true },
  )

  /**
   * One of the two source files, by the part of its path that identifies it.
   * @param name - a fragment of the file name
   */
  function source(name: string): string {
    const match = Object.entries(sources).find(([path]) => path.includes(name))
    expect(match, `source not found: ${name}`).toBeDefined()
    return match![1]
  }

  /** The settings picker's list: the `LANGUAGES` table the select renders after "auto". */
  function settingsPickerList(): string {
    const tsx = source('DisplaySection.tsx')
    const start = tsx.indexOf('const LANGUAGES')
    expect(start, 'the language list of the settings picker could not be found').toBeGreaterThan(-1)
    const end = tsx.indexOf('\n]', start)
    expect(end, 'the end of the settings language list could not be found').toBeGreaterThan(start)
    return tsx.slice(start, end)
  }

  /** The guided schema's list: the `lang` property's `oneOf`. */
  function configSchemaList(): string {
    // Sliced by hand rather than matched with one regex: the pair of lazy
    // wildcards that needs is the shape the linter rejects for backtracking
    const ts = source('config-schema.ts')
    const start = ts.indexOf('description: \'The language used for the UI.\'')
    expect(start, 'the language schema could not be found').toBeGreaterThan(-1)
    // Each entry ends `] },` so the first `],` is the end of the list itself
    const end = ts.indexOf('],', start)
    expect(end, 'the end of the language schema could not be found').toBeGreaterThan(start)
    return ts.slice(start, end)
  }

  it('found the translation files to compare against', () => {
    // Guards the rest of the block: an empty list would make several of these
    // assertions vacuous rather than wrong
    expect(shippedLanguages.length).toBeGreaterThan(20)
    expect(Object.keys(sources)).toHaveLength(2)
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

  describe('the lists the user picks from', () => {
    const settingsPicked = () => [...settingsPickerList().matchAll(/\['([\w-]+)',/g)].map(match => match[1])
    const schemaPicked = () => [...configSchemaList().matchAll(/enum: \['([\w-]+)'\]/g)]
      .map(match => match[1])
      .filter(value => value !== 'auto')

    it('offers every shipped language in the settings picker', () => {
      expect(settingsPicked().sort()).toEqual(shippedLanguages)
    })

    it('offers every shipped language in the config editor schema', () => {
      // The guided form the json editor shows for the UI's own config block. A
      // language missing here cannot be set by anyone editing the config that way
      expect(schemaPicked().sort()).toEqual(shippedLanguages)
    })

    it('names each language once in each list', () => {
      for (const [name, values] of [['settings picker', settingsPicked()], ['config schema', schemaPicked()]] as const) {
        expect(new Set(values).size, `the ${name} lists a language twice`).toBe(values.length)
      }
    })
  })
})
