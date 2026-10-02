import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { notifications, useNotification } from '@/core/notifications'

describe('notifications', () => {
  afterEach(() => {
    notifications.reset()
  })

  it('starts with nothing to report', () => {
    expect(notifications.get('legacyOtpDetected')).toBe(false)
    expect(notifications.get('formAuthEnabled')).toBeNull()
    expect(notifications.get('raspberryPiThrottled')).toEqual({})
  })

  it('tells a subscriber about a change to its own value only', () => {
    const handler = vi.fn()
    const off = notifications.subscribe('legacyOtpDetected', handler)

    notifications.set('formAuthEnabled', true)
    notifications.set('legacyOtpDetected', true)
    off()
    notifications.set('legacyOtpDetected', false)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(true, false)
  })

  it('re-renders a component reading the value and calls its handler', () => {
    const handler = vi.fn()
    const { result, unmount } = renderHook(() => useNotification('legacyOtpDetected', handler))
    expect(result.current).toBe(false)

    act(() => notifications.set('legacyOtpDetected', true))

    expect(result.current).toBe(true)
    expect(handler).toHaveBeenCalledWith(true)

    // The listener goes with the component
    unmount()
    notifications.set('legacyOtpDetected', false)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
