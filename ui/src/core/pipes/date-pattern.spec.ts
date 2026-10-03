import { describe, expect, it } from 'vitest'

import { formatDatePattern } from './date-pattern'

/** Angular's `date` pipe with the custom patterns the clock widget offers. */
describe('formatDatePattern', () => {
  // A Tuesday afternoon, local time
  const date = new Date(2024, 0, 9, 15, 4, 5)

  it.each([
    ['h:mm a', '3:04 PM'],
    ['h:mm:ss a', '3:04:05 PM'],
    ['H:mm', '15:04'],
    ['H:mm:ss', '15:04:05'],
    ['yyyy-MM-dd', '2024-01-09'],
    ['dd/MM/yy', '09/01/24'],
    ['dd/MM/yyyy', '09/01/2024'],
    ['M/d/yy', '1/9/24'],
    ['M/dd/yyyy', '1/09/2024'],
    ['dd.MM.yyyy', '09.01.2024'],
    ['MMM d', 'Jan 9'],
    ['MMM d, y', 'Jan 9, 2024'],
    ['MMMM d, y', 'January 9, 2024'],
    ['d MMMM y', '9 January 2024'],
    ['EEEE, MMMM d, y', 'Tuesday, January 9, 2024'],
    ['EEE, MMM d', 'Tue, Jan 9'],
    ['EEEE', 'Tuesday'],
  ])('formats %s', (pattern, expected) => {
    expect(formatDatePattern(date, pattern, 'en-US')).toBe(expected)
  })

  it('writes midnight and noon on the 12-hour clock as 12', () => {
    expect(formatDatePattern(new Date(2024, 0, 9, 0, 5), 'h:mm a', 'en-US')).toBe('12:05 AM')
    expect(formatDatePattern(new Date(2024, 0, 9, 12, 5), 'h:mm a', 'en-US')).toBe('12:05 PM')
  })

  it('keeps quoted text literal', () => {
    expect(formatDatePattern(date, `H 'h' mm`, 'en-US')).toBe('15 h 04')
  })

  it('uses the locale for names', () => {
    expect(formatDatePattern(date, 'EEEE d MMMM', 'fr-FR')).toBe('mardi 9 janvier')
  })

  it('gives nothing for no date or a bad one', () => {
    expect(formatDatePattern(null, 'H:mm')).toBe('')
    expect(formatDatePattern('not a date', 'H:mm')).toBe('')
  })
})
