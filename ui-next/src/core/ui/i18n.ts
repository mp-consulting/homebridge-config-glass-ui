import type { BackendModule, ResourceKey } from 'i18next'

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from '@/i18n/en.json'

// English ships in the main bundle: it is the fallback for every other
// language, so it has to be there before anything renders. The others are
// fetched on first use.
const lazyBundles = import.meta.glob<{ default: ResourceKey }>(['@/i18n/*.json', '!@/i18n/en.json'])

const bundleLoaders: Record<string, () => Promise<{ default: ResourceKey }>> = Object.fromEntries(
  Object.entries(lazyBundles).map(([path, load]) => [path.replace(/^.*\/([^/]+)\.json$/, '$1'), load]),
)

/** Every language the UI ships a translation for. */
export const languages: string[] = ['en', ...Object.keys(bundleLoaders)].sort()

/** Which languages should use RTL. */
export const rtlLanguages = ['he']

/** Whether a language is written right to left. */
export function isRtl(lang: string | undefined): boolean {
  return !!lang && rtlLanguages.includes(lang)
}

const lazyBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(lang, _namespace, callback) {
    if (lang === 'en') {
      callback(null, en)
      return
    }
    const load = bundleLoaders[lang]
    if (!load) {
      // An unknown language is not an error: the fallback covers it, which is
      // what ngx-translate did with a language that had no translation set
      callback(null, {})
      return
    }
    load().then(
      module => callback(null, module.default),
      error => callback(error as Error, false),
    )
  },
}

void i18n
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    lng: 'en',
    fallbackLng: 'en',
    // Only the exact language and then English, like ngx-translate: `pt-BR`
    // must not quietly pull in `pt` as an intermediate fallback
    load: 'currentOnly',
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    // The translation files are flat: `form.button_close` is one key, not a path
    keySeparator: false,
    nsSeparator: false,
    // ngx-translate never escaped interpolated values. Callers that put
    // third-party values into a string rendered as HTML escape them first
    // (see `escapeHtml`), so escaping here would double-escape them
    interpolation: { escapeValue: false },
    returnNull: false,
    // English is bundled, so the first render never has to wait
    initAsync: false,
    react: { useSuspense: false },
  })

export { i18n }
