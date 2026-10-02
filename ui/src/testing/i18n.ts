import { i18n } from '@/core/ui/i18n'

/**
 * i18n for the test run.
 *
 * The Angular specs ran with a translate service that had no translations
 * loaded, so every `translate` pipe rendered its key (`form.button_close`) and
 * the specs assert on keys. `cimode` gives the same: `t(key)` returns the key,
 * untranslated and uninterpolated, so those assertions port unchanged.
 *
 * A spec that wants real English text can call `showEnglish()` (and should put
 * `showKeys()` back in an `afterEach`).
 */
export function showKeys(): Promise<unknown> {
  return i18n.changeLanguage('cimode')
}

/** Render real English text instead of keys. */
export function showEnglish(): Promise<unknown> {
  return i18n.changeLanguage('en')
}

void showKeys()
