import { formatLocale } from '@/core/pipes/date'

/**
 * Angular's `DecimalPipe`: `value | number: '1.0-1'`. The digits info is
 * `{minIntegerDigits}.{minFractionDigits}-{maxFractionDigits}`, each part
 * optional (Angular's defaults are 1, 0 and 3). Grouping separators are kept,
 * as Angular kept them. `null`, `undefined` and `''` give `''` (Angular gave
 * null, which rendered as nothing).
 * @param value - the number to format
 * @param digitsInfo - e.g. `'1.0-1'`
 * @param locale - defaults to the UI's formatting locale
 */
export function formatDecimal(value: number | string | null | undefined, digitsInfo?: string, locale = formatLocale()): string {
  if (value === null || value === undefined || value === '') {
    return ''
  }
  const num = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(num)) {
    return ''
  }

  let minimumIntegerDigits = 1
  let minimumFractionDigits = 0
  let maximumFractionDigits = 3
  if (digitsInfo) {
    const match = /^(\d+)?\.(\d+)?(?:-(\d+))?$/.exec(digitsInfo)
    if (!match) {
      throw new Error(`${digitsInfo} is not a valid digit info`)
    }
    if (match[1] !== undefined) {
      minimumIntegerDigits = Number(match[1])
    }
    if (match[2] !== undefined) {
      minimumFractionDigits = Number(match[2])
    }
    if (match[3] !== undefined) {
      maximumFractionDigits = Number(match[3])
    } else if (match[2] !== undefined && minimumFractionDigits > maximumFractionDigits) {
      maximumFractionDigits = minimumFractionDigits
    }
  }

  return new Intl.NumberFormat(locale, {
    // Intl takes 1-21; a `0.` digits info still shows the leading zero
    minimumIntegerDigits: Math.max(1, minimumIntegerDigits),
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(num)
}
