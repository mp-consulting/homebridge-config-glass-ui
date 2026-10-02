import { describe, expect, it } from 'vitest'

import { duration } from '@/core/pipes/duration'

describe('duration', () => {
  it('formats minutes and seconds', () => {
    expect(duration(90)).toBe('1m 30s')
  })

  it('omits the minutes part below one minute', () => {
    expect(duration(45)).toBe('45s')
  })

  it('omits the seconds part on a whole minute', () => {
    expect(duration(120)).toBe('2m')
  })

  it('returns an empty string for invalid input', () => {
    expect(duration(Number.NaN)).toBe('')
  })
})
