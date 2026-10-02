import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerUnreachable } from '@/core/components/server-unreachable/ServerUnreachable'

/**
 * The one thing the app can draw before it knows anything about the server.
 *
 * It is only ever on screen while the first settings load is failing, so the
 * point of these specs is that it says something useful for as long as that
 * lasts - and that it cleans up after itself when the settings finally arrive.
 */
describe('serverUnreachable', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says it is waiting as soon as it appears', () => {
    const { container } = render(<ServerUnreachable />)

    expect(container.querySelector('.hb-unreachable')).toBeTruthy()
    expect(container.querySelector('.hb-unreachable-help')).toBeNull()
  })

  // Everything else on this page is still by the time the logo has drawn, and a
  // still page reads as a crashed one
  it('keeps something moving while it waits', () => {
    const { container } = render(<ServerUnreachable />)

    expect(container.querySelector('.hb-unreachable h2 .fa-circle-notch.fa-spin')).toBeTruthy()
  })

  it('offers help once the wait is no longer normal', () => {
    const { container } = render(<ServerUnreachable />)

    act(() => {
      vi.advanceTimersByTime(30000)
    })

    expect(container.querySelector('.hb-unreachable-help')).toBeTruthy()
  })

  // The wiki is the only place that can help here, since every page of the UI
  // that could have explained this is on the server that is not answering
  it('links to the wiki section for a UI that will not load', () => {
    const { container } = render(<ServerUnreachable />)

    act(() => {
      vi.advanceTimersByTime(30000)
    })

    const link = container.querySelector('.hb-unreachable-link')!
    expect(link.getAttribute('href')).toBe('https://github.com/mp-consulting/homebridge-config-glass-ui/wiki/Troubleshooting#the-homebridge-ui-will-not-load')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('drops its timer when the server comes back and it is torn down', () => {
    const { unmount } = render(<ServerUnreachable />)
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
