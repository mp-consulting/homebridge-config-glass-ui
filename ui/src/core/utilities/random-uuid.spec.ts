import { afterEach, describe, expect, it, vi } from 'vitest'

import { randomUuid } from '@/core/utilities/random-uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('randomUuid', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses crypto.randomUUID where there is one', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000')
    expect(randomUuid()).toBe('00000000-0000-4000-8000-000000000000')
    expect(spy).toHaveBeenCalled()
  })

  it('builds a version 4 uuid from random bytes outside a secure context', () => {
    const original = globalThis.crypto.randomUUID
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    try {
      const first = randomUuid()
      expect(first).toMatch(V4)
      expect(randomUuid()).not.toBe(first)
    } finally {
      Object.defineProperty(globalThis.crypto, 'randomUUID', { value: original, configurable: true })
    }
  })
})
