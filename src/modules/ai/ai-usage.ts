import type { TokenUsage } from './ai-kit.js'

/**
 * The Assistant's token usage, kept per day (server local time) in total and
 * per user, persisted to `<storage>/.uix-ai-usage.json` so it survives
 * restarts, and the optional daily / monthly budgets checked before each
 * request. Free of Nest: the service gives it a reader and a writer.
 */

export interface UsageTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  /** USD of the calls whose model has a known price. */
  costUsd: number
  /** Calls whose model has no known price (not in costUsd). */
  unpricedCalls: number
}

/** Each limit is optional; null or missing means none. */
export interface AiBudget {
  dailyTokens: number | null
  monthlyTokens: number | null
  dailyUsd: number | null
  monthlyUsd: number | null
}

interface DayUsage {
  total: UsageTotals
  byUser: Record<string, UsageTotals>
}

export interface UsageFile {
  version: 1
  /** By local date, YYYY-MM-DD. */
  days: Record<string, DayUsage>
  budget: AiBudget
}

/** Days kept: enough for this month and the last. */
export const USAGE_DAYS_KEPT = 62

export const EMPTY_BUDGET: AiBudget = Object.freeze({ dailyTokens: null, monthlyTokens: null, dailyUsd: null, monthlyUsd: null })

export function emptyTotals(): UsageTotals {
  return { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpricedCalls: 0 }
}

function addTotals(into: UsageTotals, from: UsageTotals): UsageTotals {
  into.calls += from.calls
  into.inputTokens += from.inputTokens
  into.outputTokens += from.outputTokens
  into.costUsd += from.costUsd
  into.unpricedCalls += from.unpricedCalls
  return into
}

function isTotals(value: unknown): value is UsageTotals {
  const v = value as UsageTotals
  return Boolean(v) && ['calls', 'inputTokens', 'outputTokens', 'costUsd', 'unpricedCalls'].every(key => Number.isFinite(v[key as keyof UsageTotals]))
}

/** A local date as YYYY-MM-DD. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function positiveOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** A stored file, or a fresh one; anything malformed is dropped. */
export function normalizeUsageFile(raw: unknown): UsageFile {
  const input = (raw ?? {}) as Partial<UsageFile>
  const days: Record<string, DayUsage> = {}
  for (const [day, value] of Object.entries(input.days ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isTotals(value?.total)) {
      continue
    }
    const byUser: Record<string, UsageTotals> = {}
    for (const [user, totals] of Object.entries(value.byUser ?? {})) {
      if (isTotals(totals)) {
        byUser[user] = totals
      }
    }
    days[day] = { total: value.total, byUser }
  }
  const budget = input.budget ?? EMPTY_BUDGET
  return {
    version: 1,
    days,
    budget: {
      dailyTokens: positiveOrNull(budget.dailyTokens),
      monthlyTokens: positiveOrNull(budget.monthlyTokens),
      dailyUsd: positiveOrNull(budget.dailyUsd),
      monthlyUsd: positiveOrNull(budget.monthlyUsd),
    },
  }
}

export class AiUsageLedger {
  private data: UsageFile = normalizeUsageFile(null)

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Replace the state with a stored file. */
  load(raw: unknown): void {
    this.data = normalizeUsageFile(raw)
  }

  /** What to store. */
  toJSON(): UsageFile {
    return this.data
  }

  get budget(): AiBudget {
    return { ...this.data.budget }
  }

  /** Change the limits given (null clears one); the others stay. */
  setBudget(update: Partial<AiBudget>): AiBudget {
    const next = { ...this.data.budget }
    for (const key of Object.keys(EMPTY_BUDGET) as Array<keyof AiBudget>) {
      if (key in update) {
        next[key] = positiveOrNull(update[key])
      }
    }
    this.data.budget = next
    return { ...next }
  }

  /** Count one provider call. `costUsd` is null when the model's price is unknown. */
  add(username: string, usage: TokenUsage, costUsd: number | null): void {
    const day = localDay(this.now())
    const entry: UsageTotals = {
      calls: 1,
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      costUsd: costUsd ?? 0,
      unpricedCalls: costUsd === null ? 1 : 0,
    }
    const today = this.data.days[day] ??= { total: emptyTotals(), byUser: {} }
    addTotals(today.total, entry)
    addTotals(today.byUser[username] ??= emptyTotals(), entry)
    this.prune()
  }

  private prune(): void {
    const days = Object.keys(this.data.days).sort()
    for (const day of days.slice(0, Math.max(0, days.length - USAGE_DAYS_KEPT))) {
      delete this.data.days[day]
    }
  }

  /** Today's and this month's totals, overall and (optionally) per user. */
  summary(): { day: string, month: string, today: UsageTotals, thisMonth: UsageTotals, todayByUser: Record<string, UsageTotals>, monthByUser: Record<string, UsageTotals> } {
    const day = localDay(this.now())
    const month = day.slice(0, 7)
    const thisMonth = emptyTotals()
    const monthByUser: Record<string, UsageTotals> = {}
    for (const [key, value] of Object.entries(this.data.days)) {
      if (!key.startsWith(`${month}-`)) {
        continue
      }
      addTotals(thisMonth, value.total)
      for (const [user, totals] of Object.entries(value.byUser)) {
        addTotals(monthByUser[user] ??= emptyTotals(), totals)
      }
    }
    const todayEntry = this.data.days[day]
    return {
      day,
      month,
      today: todayEntry ? { ...todayEntry.total } : emptyTotals(),
      thisMonth,
      todayByUser: structuredClone(todayEntry?.byUser ?? {}),
      monthByUser,
    }
  }

  /** Why a request must wait (a budget is used up), or null. */
  exceeded(): string | null {
    const { today, thisMonth } = this.summary()
    const { dailyTokens, monthlyTokens, dailyUsd, monthlyUsd } = this.data.budget
    const tokens = (totals: UsageTotals) => totals.inputTokens + totals.outputTokens
    const n = (value: number) => value.toLocaleString('en-US')
    if (dailyTokens !== null && tokens(today) >= dailyTokens) {
      return `The Assistant's daily token budget is used up (${n(tokens(today))} of ${n(dailyTokens)} tokens). It resets at midnight, or an administrator can raise it in Settings, Assistant.`
    }
    if (monthlyTokens !== null && tokens(thisMonth) >= monthlyTokens) {
      return `The Assistant's monthly token budget is used up (${n(tokens(thisMonth))} of ${n(monthlyTokens)} tokens). It resets on the 1st, or an administrator can raise it in Settings, Assistant.`
    }
    if (dailyUsd !== null && today.costUsd >= dailyUsd) {
      return `The Assistant's daily spending budget is used up (about $${today.costUsd.toFixed(2)} of $${dailyUsd.toFixed(2)}). It resets at midnight, or an administrator can raise it in Settings, Assistant.`
    }
    if (monthlyUsd !== null && thisMonth.costUsd >= monthlyUsd) {
      return `The Assistant's monthly spending budget is used up (about $${thisMonth.costUsd.toFixed(2)} of $${monthlyUsd.toFixed(2)}). It resets on the 1st, or an administrator can raise it in Settings, Assistant.`
    }
    return null
  }
}
