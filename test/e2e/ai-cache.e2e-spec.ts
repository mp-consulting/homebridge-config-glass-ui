import { describe, expect, it } from 'vitest'

import { SlidingWindowLimiter, TtlCache } from '../../src/modules/ai/ai-cache.js'

describe('Assistant caches', () => {
  describe('ttlCache', () => {
    it('expires entries after the TTL', () => {
      let now = 1000
      const cache = new TtlCache<number>({ ttlMs: 100, maxSize: 10, now: () => now })
      cache.set('a', 1)
      expect(cache.get('a')).toBe(1)
      now += 99
      expect(cache.get('a')).toBe(1)
      now += 1
      expect(cache.get('a')).toBeUndefined()
      expect(cache.size).toBe(0)
    })

    it('evicts the least recently used entry over the size cap', () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxSize: 2 })
      cache.set('a', 'A')
      cache.set('b', 'B')
      // Touch a: b is now the oldest
      expect(cache.get('a')).toBe('A')
      cache.set('c', 'C')
      expect(cache.size).toBe(2)
      expect(cache.get('b')).toBeUndefined()
      expect(cache.get('a')).toBe('A')
      expect(cache.get('c')).toBe('C')
    })

    it('drops expired entries when a new one is set, and clears', () => {
      let now = 0
      const cache = new TtlCache<number>({ ttlMs: 10, maxSize: 100, now: () => now })
      for (let i = 0; i < 50; i++) {
        cache.set(`k${i}`, i)
      }
      now = 20
      cache.set('fresh', 1)
      expect(cache.size).toBe(1)
      expect(cache.delete('fresh')).toBe(true)
      cache.set('x', 1)
      cache.clear()
      expect(cache.size).toBe(0)
    })
  })

  describe('slidingWindowLimiter', () => {
    it('allows the limit per key within the window', () => {
      let now = 0
      const limiter = new SlidingWindowLimiter({ limit: 2, windowMs: 1000, now: () => now })
      expect(limiter.consume('a')).toBe(true)
      expect(limiter.consume('a')).toBe(true)
      expect(limiter.consume('a')).toBe(false)
      expect(limiter.consume('b')).toBe(true)
      expect(limiter.count('a')).toBe(2)
      expect(limiter.count('nobody')).toBe(0)
      now = 1000
      expect(limiter.consume('a')).toBe(true)
    })

    it('forgets keys that have been idle for a window', () => {
      let now = 0
      const limiter = new SlidingWindowLimiter({ limit: 5, windowMs: 1000, now: () => now })
      for (let i = 0; i < 500; i++) {
        limiter.consume(`user-${i}`)
      }
      expect(limiter.size).toBe(500)
      now = 2000
      limiter.consume('active')
      expect(limiter.size).toBe(1)
      limiter.clear()
      expect(limiter.size).toBe(0)
    })

    it('keeps a key that was active within the window', () => {
      let now = 0
      const limiter = new SlidingWindowLimiter({ limit: 5, windowMs: 1000, now: () => now })
      limiter.consume('old')
      now = 900
      limiter.consume('recent')
      now = 1600
      limiter.consume('other')
      expect(limiter.size).toBe(2)
      expect(limiter.consume('recent')).toBe(true)
    })
  })
})
