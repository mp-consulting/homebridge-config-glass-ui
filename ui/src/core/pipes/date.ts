import { chooseStartupLanguage, localeIdFor } from '@/core/locales'

/**
 * Angular's `DatePipe` for the named formats the templates use. The locale is
 * decided once, the way Angular's LOCALE_ID was: from the stored language (or
 * the browser's), so a language change reformats after the next page load.
 */
export type DateFormat = 'short' | 'medium' | 'shortDate' | 'mediumDate' | 'longDate' | 'shortTime' | 'mediumTime'

// Angular's named formats are CLDR's date / time styles, which Intl exposes directly
const FORMATS: Record<DateFormat, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short', timeStyle: 'short' },
  medium: { dateStyle: 'medium', timeStyle: 'medium' },
  shortDate: { dateStyle: 'short' },
  mediumDate: { dateStyle: 'medium' },
  longDate: { dateStyle: 'long' },
  shortTime: { timeStyle: 'short' },
  mediumTime: { timeStyle: 'medium' },
}

let cachedLocale: string | undefined

/** The locale dates are formatted with (Angular's LOCALE_ID). */
export function formatLocale(): string {
  if (!cachedLocale) {
    const browser = typeof navigator === 'undefined' ? undefined : navigator.language
    cachedLocale = localeIdFor(chooseStartupLanguage(browser?.split('-')[0], browser))
  }
  return cachedLocale
}

/**
 * Format a date like `value | date: format`. Empty or invalid input gives `''`
 * (Angular gave null, which rendered as nothing).
 * @param value - a Date, a timestamp, or an ISO string
 * @param format - one of Angular's named formats
 * @param locale - defaults to {@link formatLocale}
 */
export function formatDate(value: Date | number | string | null | undefined, format: DateFormat = 'mediumDate', locale = formatLocale()): string {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return new Intl.DateTimeFormat(locale, FORMATS[format]).format(date)
}
