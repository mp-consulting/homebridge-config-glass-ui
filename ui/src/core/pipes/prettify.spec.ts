import { describe, expect, it } from 'vitest'

import { prettify } from '@/core/pipes/prettify'

describe('prettify', () => {
  it.each([
    ['SMOKE_NOT_DETECTED', 'Smoke Not Detected'],
    ['colorTempPhysicalMaxMireds', 'Color Temp Physical Max Mireds'],
    ['onOff', 'On Off'],
    ['currentLevel', 'Current Level'],
    ['single', 'Single'],
  ])('turns %s into %s', (value, expected) => {
    expect(prettify(value)).toBe(expected)
  })

  it('destroys acronyms, which is the accepted cost of one shared rule', () => {
    // HAP sends SCREAMING_SNAKE and Matter sends camelCase, and one pass has to
    // handle both. Lower-casing everything first is what loses the acronym
    expect(prettify('CO2_DETECTED')).toBe('Co2 Detected')
    expect(prettify('rgbColour')).toBe('Rgb Colour')
  })

  it('passes non-strings straight through', () => {
    expect(prettify(null as any)).toBeNull()
    expect(prettify(42 as any)).toBe(42)
  })

  it('returns an empty string unchanged', () => {
    expect(prettify('')).toBe('')
  })
})
