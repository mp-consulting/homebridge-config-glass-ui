import { describe, expect, it } from 'vitest'

import { formatMegabytes } from '@/core/pipes/bytes'

describe('formatMegabytes', () => {
  it('shows megabytes with one decimal', () => {
    expect(formatMegabytes(1572864)).toBe('1.5MB')
    expect(formatMegabytes(0)).toBe('0.0MB')
  })
})
