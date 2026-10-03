import type { Mock } from 'vitest'

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatDatePattern as formatClock } from '@/core/pipes/date-pattern'
import { ClockWidget } from '@/modules/status/widgets/clock-widget/ClockWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'

describe('the clock widget', () => {
  let updateWidget: Mock<(...args: any[]) => any>

  function open(widget: Record<string, any> = {}) {
    updateWidget = vi.fn()
    return render(
      <ClockWidget
        widget={{ component: 'ClockWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false, ...widget }}
        resizeEvent={createWidgetEvent()}
        configureEvent={createWidgetEvent()}
        updateWidget={updateWidget}
        saveWidgets={vi.fn()}
      />,
    )
  }

  const time = (container: HTMLElement) => container.querySelector('.widget-value')!.textContent
  const date = (container: HTMLElement) => container.querySelector('.widget-value-label')!.textContent

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 5, 14, 7, 9))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fills in the formats when the widget has none', () => {
    const { container } = open()

    expect(updateWidget).toHaveBeenCalledWith({ timeFormat: 'H:mm', dateFormat: 'yyyy-MM-dd' })
    expect(time(container)).toBe('14:07')
    expect(date(container)).toBe('2026-01-05')
  })

  it('keeps the formats the user chose', () => {
    const { container } = open({ timeFormat: 'h:mm a', dateFormat: 'EEEE' })

    expect(updateWidget).not.toHaveBeenCalled()
    expect(time(container)).toBe('2:07 PM')
    expect(date(container)).toBe('Monday')
  })

  it('ticks once a second', async () => {
    const { container } = open({ timeFormat: 'H:mm:ss' })
    expect(time(container)).toBe('14:07:09')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(time(container)).toBe('14:07:10')
  })

  it('stops ticking once it is gone', () => {
    const { unmount } = open()

    unmount()

    // A widget removed from the dashboard must not keep waking the page up
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('formatDatePattern (the clock formats)', () => {
  const at = new Date(2026, 2, 7, 9, 5, 3)

  it.each([
    ['h:mm a', '9:05 AM'],
    ['h:mm:ss a', '9:05:03 AM'],
    ['H:mm', '9:05'],
    ['H:mm:ss', '9:05:03'],
    ['yyyy-MM-dd', '2026-03-07'],
    ['dd/MM/yy', '07/03/26'],
    ['dd/MM/yyyy', '07/03/2026'],
    ['M/d/yy', '3/7/26'],
    ['M/dd/yyyy', '3/07/2026'],
    ['dd.MM.yyyy', '07.03.2026'],
    ['MMM d', 'Mar 7'],
    ['MMM d, y', 'Mar 7, 2026'],
    ['MMMM d, y', 'March 7, 2026'],
    ['d MMMM y', '7 March 2026'],
    ['EEEE, MMMM d, y', 'Saturday, March 7, 2026'],
    ['EEEE, d MMMM y', 'Saturday, 7 March 2026'],
    ['EEE, MMM d', 'Sat, Mar 7'],
    ['EEEE', 'Saturday'],
    ['EEEE, MMM d', 'Saturday, Mar 7'],
  ])('formats %s like Angular\'s date pipe (en-US)', (pattern, expected) => {
    // Every pattern the widget settings offer
    expect(formatClock(at, pattern, 'en-US')).toBe(expected)
  })

  it('shows midnight and noon as 12 on a 12-hour clock', () => {
    expect(formatClock(new Date(2026, 0, 1, 0, 0), 'h:mm a', 'en-US')).toBe('12:00 AM')
    expect(formatClock(new Date(2026, 0, 1, 12, 0), 'h:mm a', 'en-US')).toBe('12:00 PM')
  })

  it('keeps quoted text as it is', () => {
    expect(formatClock(at, '\'week\' d \'\'', 'en-US')).toBe('week 7 \'')
  })

  it('uses the locale\'s names', () => {
    expect(formatClock(at, 'EEEE d MMMM', 'fr-FR')).toBe('samedi 7 mars')
  })
})
