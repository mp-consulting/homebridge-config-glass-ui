import { describe, expect, it } from 'vitest'

import { AiUsageLedger, localDay, normalizeUsageFile, USAGE_DAYS_KEPT } from '../../src/modules/ai/ai-usage.js'

describe('Assistant usage ledger', () => {
  it('adds up per day and per user, and the month across days', () => {
    let now = new Date(2026, 9, 30, 23, 0)
    const ledger = new AiUsageLedger(() => now)
    ledger.add('admin', { inputTokens: 100, outputTokens: 50 }, 0.01)
    ledger.add('user', { inputTokens: 10, outputTokens: 5 }, null)
    now = new Date(2026, 9, 31, 1, 0)
    ledger.add('admin', { inputTokens: 1, outputTokens: 1 }, 0.5)

    const summary = ledger.summary()
    expect(summary.day).toBe('2026-10-31')
    expect(summary.month).toBe('2026-10')
    expect(summary.today).toEqual({ calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0.5, unpricedCalls: 0 })
    expect(summary.thisMonth).toMatchObject({ calls: 3, inputTokens: 111, outputTokens: 56, unpricedCalls: 1 })
    expect(summary.thisMonth.costUsd).toBeCloseTo(0.51)
    expect(summary.monthByUser.user).toMatchObject({ calls: 1, unpricedCalls: 1 })
    expect(Object.keys(summary.todayByUser)).toEqual(['admin'])

    // A new month starts from zero
    now = new Date(2026, 10, 1, 0, 1)
    expect(ledger.summary().thisMonth.calls).toBe(0)
    expect(ledger.summary().today.calls).toBe(0)
  })

  it('round-trips through its file, dropping what is malformed', () => {
    const now = () => new Date(2026, 0, 15)
    const ledger = new AiUsageLedger(now)
    ledger.add('admin', { inputTokens: 3, outputTokens: 4 }, null)
    ledger.setBudget({ dailyTokens: 100 })
    const restored = new AiUsageLedger(now)
    restored.load(JSON.parse(JSON.stringify(ledger.toJSON())))
    expect(restored.summary().today.calls).toBe(1)
    expect(restored.budget.dailyTokens).toBe(100)

    const file = normalizeUsageFile({ days: { 'nope': {}, '2026-01-01': { total: { calls: 'x' } }, '2026-01-02': { total: { calls: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, unpricedCalls: 0 }, byUser: { a: null } } }, budget: { dailyTokens: -5, monthlyUsd: 3 } })
    expect(Object.keys(file.days)).toEqual(['2026-01-02'])
    expect(file.days['2026-01-02'].byUser).toEqual({})
    expect(file.budget).toEqual({ dailyTokens: null, monthlyTokens: null, dailyUsd: null, monthlyUsd: 3 })
    expect(normalizeUsageFile(undefined).days).toEqual({})
  })

  it('keeps a bounded number of days', () => {
    let day = 0
    const ledger = new AiUsageLedger(() => new Date(2025, 0, 1 + day))
    for (day = 0; day < USAGE_DAYS_KEPT + 10; day++) {
      ledger.add('admin', { inputTokens: 1, outputTokens: 0 }, null)
    }
    const days = Object.keys(ledger.toJSON().days).sort()
    expect(days).toHaveLength(USAGE_DAYS_KEPT)
    expect(days.at(-1)).toBe(localDay(new Date(2025, 0, USAGE_DAYS_KEPT + 10)))
  })

  it('says which budget is used up', () => {
    const ledger = new AiUsageLedger(() => new Date(2026, 4, 10))
    expect(ledger.exceeded()).toBeNull()
    ledger.add('admin', { inputTokens: 600, outputTokens: 400 }, 2)

    ledger.setBudget({ dailyTokens: 1000 })
    expect(ledger.exceeded()).toMatch(/daily token budget is used up \(1,000 of 1,000 tokens\)/)
    ledger.setBudget({ dailyTokens: null, monthlyTokens: 500 })
    expect(ledger.exceeded()).toMatch(/monthly token budget/)
    ledger.setBudget({ monthlyTokens: 0, dailyUsd: 1.5 })
    expect(ledger.budget.monthlyTokens).toBeNull()
    expect(ledger.exceeded()).toMatch(/daily spending budget is used up \(about \$2.00 of \$1.50\)/)
    ledger.setBudget({ dailyUsd: null, monthlyUsd: 2 })
    expect(ledger.exceeded()).toMatch(/monthly spending budget/)
    ledger.setBudget({ monthlyUsd: 100 })
    expect(ledger.exceeded()).toBeNull()
  })
})
