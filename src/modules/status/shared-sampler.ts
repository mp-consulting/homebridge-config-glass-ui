/* global NodeJS */

/** No sampler ticks faster than this, whatever a client asks for */
export const MIN_SAMPLE_MS = 1_000

/**
 * One reading of an expensive metric (CPU load and temperature, memory,
 * network throughput), taken on a shared server-side timer rather than once
 * per client request.
 *
 * Dashboard widgets poll for these every 1-60 s, once per open tab. Sampling on
 * each request ran a shell per poll per tab, and for network stats it also
 * made the per-second rates meaningless with two tabs open: systeminformation
 * computes them from the delta since the previous call, whoever made it.
 *
 * The period follows the fastest refresh interval a client is still polling
 * at (floored at MIN_SAMPLE_MS), so a widget refreshing every second gets a
 * fresh reading every second, and the sampler slows back down once that
 * client stops asking. A request without an interval counts as the default
 * `intervalMs`. There is still one sample per tick for the whole server.
 *
 * The timer only runs while someone is asking: the first get() starts it
 * (and waits for the first reading), and it stops itself once nobody has asked
 * for `idleMs`, dropping the cached value so a later request starts fresh -
 * unless the sampler was start()ed as a background one (`idleMs: Infinity`).
 */
export class SharedSampler<T> {
  private value: T | undefined
  private pending: Promise<T> | undefined
  private timer: NodeJS.Timeout | undefined
  private lastDemand = 0
  private lastTick = 0
  private currentPeriod: number
  // requested period (ms) -> when it was last asked for
  private demands = new Map<number, number>()

  constructor(
    private readonly sample: () => Promise<T>,
    private readonly options: {
      /** Period with no (live) client interval, and for requests without one */
      intervalMs: number
      idleMs: number
      onError?: (error: Error) => void
      onStop?: () => void
    },
  ) {
    this.currentPeriod = options.intervalMs
  }

  /**
   * The latest reading, taking one first if none is cached
   * @param intervalMs - how often the caller polls; the sampler ticks at least this often while it does
   */
  public async get(intervalMs?: number): Promise<T> {
    const now = Date.now()
    this.lastDemand = now
    this.demands.set(this.normalise(intervalMs), now)
    if (!this.timer) {
      this.lastTick = now
      this.schedule()
    } else if (this.period(now) < this.currentPeriod) {
      // A faster client arrived: bring the next tick forward
      clearTimeout(this.timer)
      this.schedule()
    }
    if (this.value !== undefined) {
      return this.value
    }
    return this.refresh()
  }

  /** Start ticking at the default period without waiting for a request */
  public start(): void {
    if (!this.timer) {
      this.lastTick = Date.now()
      this.schedule()
    }
  }

  public get running(): boolean {
    return this.timer !== undefined
  }

  /** The period the sampler currently ticks at */
  public get periodMs(): number {
    return this.currentPeriod
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.value = undefined
    this.demands.clear()
    this.currentPeriod = this.options.intervalMs
    this.options.onStop?.()
  }

  private normalise(intervalMs?: number): number {
    if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return this.options.intervalMs
    }
    return Math.max(MIN_SAMPLE_MS, Math.round(intervalMs))
  }

  /**
   * The fastest period still asked for. A demand lapses once its client has
   * missed two polls (plus a second of slack for latency).
   */
  private period(now: number): number {
    let fastest = Infinity
    for (const [period, seen] of this.demands) {
      if (now - seen > period * 2 + MIN_SAMPLE_MS) {
        this.demands.delete(period)
      } else {
        fastest = Math.min(fastest, period)
      }
    }
    return Number.isFinite(fastest) ? fastest : this.options.intervalMs
  }

  private schedule(): void {
    const now = Date.now()
    this.currentPeriod = this.period(now)
    const delay = Math.max(0, this.lastTick + this.currentPeriod - now)
    this.timer = setTimeout(() => this.tick(), delay)
    this.timer.unref?.()
  }

  private tick(): void {
    const now = Date.now()
    if (now - this.lastDemand > this.options.idleMs) {
      this.stop()
      return
    }
    this.lastTick = now
    this.schedule()
    // A failed sample keeps serving the previous reading
    this.refresh().catch(e => this.options.onError?.(e))
  }

  private refresh(): Promise<T> {
    // Concurrent first requests share one reading
    this.pending ??= this.sample()
      .then((value) => {
        if (this.timer) {
          this.value = value
        }
        return value
      })
      .finally(() => {
        this.pending = undefined
      })
    return this.pending
  }
}
