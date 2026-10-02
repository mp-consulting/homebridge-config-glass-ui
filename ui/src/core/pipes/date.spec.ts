import { describe, expect, it } from 'vitest'

import { formatDate } from './date'

/** Angular's `date` pipe for the named formats the templates use. */
describe('formatDate', () => {
  const value = '2026-08-16T14:05:00.000Z'

  it('formats like angular in english', () => {
    const date = new Date(value)
    expect(formatDate(value, 'mediumDate', 'en')).toBe('Aug 16, 2026')
    expect(formatDate(value, 'shortTime', 'en')).toBe(date.toLocaleTimeString('en', { timeStyle: 'short' }))
  })

  it('follows the locale', () => {
    expect(formatDate(value, 'mediumDate', 'de')).toBe('16.08.2026')
  })

  it('takes dates and timestamps too', () => {
    const date = new Date(value)
    expect(formatDate(date, 'mediumDate', 'en')).toBe('Aug 16, 2026')
    expect(formatDate(date.getTime(), 'mediumDate', 'en')).toBe('Aug 16, 2026')
  })

  it('renders nothing for nothing, or for a value that is not a date', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
    expect(formatDate('')).toBe('')
    expect(formatDate('not a date')).toBe('')
  })
})
