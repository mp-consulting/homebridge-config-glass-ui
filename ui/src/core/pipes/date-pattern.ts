import { formatLocale } from './date'

// Pattern fields, or a quoted literal ('' is a literal quote), or anything else
const TOKENS = /'(?:[^']|'')*'|y{1,4}|M{1,4}|d{1,2}|E{1,4}|h{1,2}|H{1,2}|m{1,2}|s{1,2}|a{1,3}|[^yMdEhHmsa']+|'/g

function pad(value: number, digits: number): string {
  return String(value).padStart(digits, '0')
}

/** One part of `Intl` output, in the form a full date uses (genitive months in ru, pl, …). */
function part(date: Date, locale: string, type: Intl.DateTimeFormatPartTypes, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).formatToParts(date).find(p => p.type === type)?.value ?? ''
}

function field(token: string, date: Date, locale: string): string {
  const letter = token[0]
  const width = token.length
  switch (letter) {
    case 'y': {
      const year = date.getFullYear()
      if (width === 2) {
        return pad(year % 100, 2)
      }
      return width === 1 ? String(year) : pad(year, width)
    }
    case 'M': {
      if (width <= 2) {
        return pad(date.getMonth() + 1, width)
      }
      return part(date, locale, 'month', { day: 'numeric', month: width === 3 ? 'short' : 'long' })
    }
    case 'd':
      return pad(date.getDate(), width)
    case 'E':
      return part(date, locale, 'weekday', { weekday: width === 4 ? 'long' : 'short' })
    case 'h':
      return pad(date.getHours() % 12 || 12, width)
    case 'H':
      return pad(date.getHours(), width)
    case 'm':
      return pad(date.getMinutes(), width)
    case 's':
      return pad(date.getSeconds(), width)
    case 'a':
      return part(date, locale, 'dayPeriod', { hour: 'numeric', hour12: true }) || (date.getHours() < 12 ? 'AM' : 'PM')
    case '\'':
      if (token === '\'\'') {
        return '\''
      }
      return token === '\'' ? '' : token.slice(1, -1).replace(/''/g, '\'')
    default:
      return token
  }
}

/**
 * Angular's `DatePipe` with a custom pattern (`value | date: 'EEEE, MMMM d, y'`),
 * for the clock formats the dashboard offers. `formatDate` covers only the named
 * formats; this implements the pattern letters the clock formats use, with
 * Angular's meaning (`yyyy` is the year, `EEEE` the weekday, `a` the day period).
 * Names come from `Intl` in the form a full date uses, like Angular's locale data
 * (German `MMM` is `Jan.`, `Juli`; genitive months in ru, pl, ...).
 * @param value - a Date, a timestamp, or an ISO string
 * @param pattern - an Angular date pattern, e.g. `h:mm a`
 * @param locale - defaults to the app's date locale
 */
export function formatDatePattern(value: Date | number | string | null | undefined, pattern: string, locale = formatLocale()): string {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return (pattern.match(TOKENS) ?? []).map(token => field(token, date, locale)).join('')
}
