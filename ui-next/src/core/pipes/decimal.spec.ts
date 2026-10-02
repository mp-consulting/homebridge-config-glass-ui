import { describe, expect, it } from 'vitest'

import { formatDecimal } from '@/core/pipes/decimal'

describe('formatDecimal', () => {
  it('rounds to the maximum fraction digits', () => {
    expect(formatDecimal(21.46, '1.0-1', 'en')).toBe('21.5')
    expect(formatDecimal(21, '1.0-1', 'en')).toBe('21')
    expect(formatDecimal(21.6, '1.0-0', 'en')).toBe('22')
  })

  it('pads to the minimum fraction digits', () => {
    expect(formatDecimal(3, '0.1-1', 'en')).toBe('3.0')
    expect(formatDecimal(0.25, '0.1-1', 'en')).toBe('0.3')
  })

  it('uses Angular\'s defaults without digits info, with grouping', () => {
    expect(formatDecimal(1234.56789, undefined, 'en')).toBe('1,234.568')
  })

  it('formats for the locale', () => {
    expect(formatDecimal(21.5, '1.0-1', 'de')).toBe('21,5')
  })

  it('gives an empty string for no value', () => {
    expect(formatDecimal(null, '1.0-1', 'en')).toBe('')
    expect(formatDecimal(undefined, '1.0-1', 'en')).toBe('')
    expect(formatDecimal('', '1.0-1', 'en')).toBe('')
  })
})
