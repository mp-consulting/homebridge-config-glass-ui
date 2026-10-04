/**
 * Small bounded in-memory structures for the Assistant: a TTL + max-size
 * cache and a per-key sliding-window rate limiter that forgets idle keys.
 * Kept free of Nest so they can be swapped for the shared ai-core helpers.
 */

export interface TtlCacheOptions {
  /** How long an entry is served after it was set. */
  ttlMs: number
  /** The most entries kept; the least recently used goes first. */
  maxSize: number
  now?: () => number
}

/** A Map with an expiry per entry and a size cap (least recently used evicted). */
export class TtlCache<V> {
  private readonly entries = new Map<string, { at: number, value: V }>()
  private readonly ttlMs: number
  private readonly maxSize: number
  private readonly now: () => number

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs
    this.maxSize = Math.max(1, options.maxSize)
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.entries.size
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      return undefined
    }
    if (this.now() - entry.at >= this.ttlMs) {
      this.entries.delete(key)
      return undefined
    }
    // Most recently used last
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, { at: this.now(), value })
    this.prune()
  }

  delete(key: string): boolean {
    return this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  /** Drop expired entries, then the oldest ones over the size cap. */
  prune(): void {
    const now = this.now()
    for (const [key, entry] of this.entries) {
      if (now - entry.at >= this.ttlMs) {
        this.entries.delete(key)
      }
    }
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
    }
  }
}

export interface SlidingWindowOptions {
  /** Hits allowed per key within the window. */
  limit: number
  windowMs: number
  now?: () => number
}

/**
 * Per-key sliding-window rate limit. A key with no hit inside the window is
 * forgotten (checked at most once per window), so the map only holds the
 * keys active recently, however many there have been.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: () => number
  private lastSweep = 0

  constructor(options: SlidingWindowOptions) {
    this.limit = options.limit
    this.windowMs = options.windowMs
    this.now = options.now ?? Date.now
  }

  /** How many keys are tracked. */
  get size(): number {
    return this.hits.size
  }

  /** Count one hit for the key: false (and nothing counted) when it is over the limit. */
  consume(key: string): boolean {
    const now = this.now()
    this.sweep(now)
    const recent = (this.hits.get(key) ?? []).filter(at => now - at < this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }

  /** Hits counted for the key within the current window. */
  count(key: string): number {
    const now = this.now()
    return (this.hits.get(key) ?? []).filter(at => now - at < this.windowMs).length
  }

  clear(): void {
    this.hits.clear()
  }

  /** Forget every key whose last hit is older than the window. */
  sweep(now = this.now()): void {
    if (now - this.lastSweep < this.windowMs) {
      return
    }
    this.lastSweep = now
    for (const [key, times] of this.hits) {
      if (!times.length || now - times[times.length - 1] >= this.windowMs) {
        this.hits.delete(key)
      }
    }
  }
}
