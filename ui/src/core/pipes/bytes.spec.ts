import { describe, expect, it } from 'vitest'

import { formatMegabytes, scaleRate } from '@/core/pipes/bytes'

describe('formatMegabytes', () => {
  it('shows megabytes with one decimal', () => {
    expect(formatMegabytes(1572864)).toBe('1.5MB')
    expect(formatMegabytes(0)).toBe('0.0MB')
  })
})

describe('scaleRate', () => {
  it('shows bits by default, auto-scaled', () => {
    expect(scaleRate(1024 * 1024)).toEqual({ value: 8, suffix: 'Mb/s' })
    expect(scaleRate(100)).toEqual({ value: 800, suffix: 'b/s' })
    expect(scaleRate(128)).toEqual({ value: 1, suffix: 'Kb/s' })
  })

  it('shows bytes when asked', () => {
    expect(scaleRate(1536, 'bytes')).toEqual({ value: 1.5, suffix: 'KB/s' })
    expect(scaleRate(3 * 1024 ** 3, 'bytes')).toEqual({ value: 3, suffix: 'GB/s' })
    expect(scaleRate(10, 'bytes')).toEqual({ value: 10, suffix: 'B/s' })
  })

  it('treats a missing or negative rate as zero', () => {
    expect(scaleRate(Number.NaN)).toEqual({ value: 0, suffix: 'b/s' })
    expect(scaleRate(-5, 'bytes')).toEqual({ value: 0, suffix: 'B/s' })
  })
})
