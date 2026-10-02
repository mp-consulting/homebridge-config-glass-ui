import { useCallback, useRef } from 'react'

import { RE_IPAD_IPHONE_IPOD, RE_NON_SAFARI, RE_SAFARI } from '@/core/regex.constants'

export interface LongPressOptions {
  /** How long a press has to be held to count as long, in ms. */
  duration?: number
  onLongClick?: (event: MouseEvent | TouchEvent) => void
  onShortClick?: (event: MouseEvent | KeyboardEvent | TouchEvent) => void
}

function isSafariMobile(): boolean {
  const userAgent = navigator.userAgent
  return RE_IPAD_IPHONE_IPOD.test(userAgent) && RE_SAFARI.test(userAgent) && !RE_NON_SAFARI.test(userAgent)
}

/**
 * Tell a tap from a long press (was the `shortClick`/`longClick` directive).
 * Every accessory tile uses it: a tap toggles the accessory, a long press
 * opens its manage modal.
 *
 * Returns a ref callback for the element:
 *
 *     const pressRef = useLongPress({ onShortClick: toggle, onLongClick: openManage })
 *     <button ref={pressRef}>…</button>
 *
 * The listeners are attached natively rather than as React props because the
 * touchstart one has to be able to `preventDefault()`, and React registers
 * touch listeners as passive.
 *
 * ⚠️ The rule that matters most is the **synthetic event guard**. A touch on
 * iOS fires `touchstart`/`touchend` and then, a moment later, a *second* pair
 * of `mousedown`/`mouseup` for the same finger. Without the guard every tap on
 * an iPhone toggles the accessory twice — on, then straight back off.
 * @param options - the duration and the two callbacks
 */
export function useLongPress<T extends HTMLElement = HTMLElement>(options: LongPressOptions): (element: T | null) => (() => void) | void {
  const optionsRef = useRef(options)
  // Read at event time, so the callbacks can change without re-attaching
  optionsRef.current = options

  return useCallback((element: T | null) => {
    if (!element) {
      return
    }

    let downTimeout: ReturnType<typeof setTimeout> | undefined
    let touchTimeout: ReturnType<typeof setTimeout> | undefined
    let done = false
    let touchInProgress = false
    let lastTouchTime = 0

    const duration = () => optionsRef.current.duration ?? 350
    const emitShort = (event: MouseEvent | KeyboardEvent | TouchEvent) => optionsRef.current.onShortClick?.(event)
    const emitLong = (event: MouseEvent | TouchEvent) => optionsRef.current.onLongClick?.(event)

    /**
     * True while a mouse event is close enough to a touch to be iOS replaying it.
     * Deliberately independent of `touchInProgress`, which is cleared 150ms after
     * touchend - narrower than the replay this is here to block. Browsers on iOS
     * that are not Safari have no other protection, since `preventDefault()` on
     * touchstart is only safe to call there.
     */
    const isSyntheticEvent = () => Date.now() - lastTouchTime < 300

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        emitShort(event)
      }
    }

    const onMouseUp = (event: MouseEvent) => {
      if (!touchInProgress && !isSyntheticEvent()) {
        clearTimeout(downTimeout)
        if (!done) {
          done = true
          emitShort(event)
        }
      }
    }

    const onTouchEnd = (event: TouchEvent) => {
      clearTimeout(downTimeout)

      if (!done) {
        done = true
        emitShort(event)
      }

      // The replay is timed from the finger lifting, not from it landing: a long
      // press outlasts the window on its own, so timing from touchstart would let
      // the replay through
      lastTouchTime = Date.now()

      clearTimeout(touchTimeout)
      touchTimeout = setTimeout(() => {
        touchInProgress = false
      }, 150)
    }

    const onMouseDown = (event: MouseEvent | TouchEvent) => {
      // Check for touch event by looking for touches property instead of instanceof
      if ('touches' in event) {
        touchInProgress = true
        done = false
        lastTouchTime = Date.now()

        if (event.cancelable && isSafariMobile()) {
          event.preventDefault()
        }

        downTimeout = setTimeout(() => {
          if (!done) {
            done = true
            emitLong(event)
          }
        }, duration())
        return
      }

      // If not a touch event, handle as mouse event
      if (!touchInProgress && !isSyntheticEvent()) {
        if (event.button === 0) {
          done = false
          downTimeout = setTimeout(() => {
            if (!done) {
              done = true
              emitLong(event)
            }
          }, duration())
        }
      }
    }

    const onMouseMove = () => {
      done = true
      clearTimeout(downTimeout)
    }

    element.addEventListener('keyup', onKeyUp)
    element.addEventListener('mouseup', onMouseUp)
    element.addEventListener('touchend', onTouchEnd)
    element.addEventListener('touchstart', onMouseDown, { passive: false })
    element.addEventListener('mousedown', onMouseDown)
    element.addEventListener('mousemove', onMouseMove)
    element.addEventListener('touchmove', onMouseMove)

    return () => {
      element.removeEventListener('keyup', onKeyUp)
      element.removeEventListener('mouseup', onMouseUp)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchstart', onMouseDown)
      element.removeEventListener('mousedown', onMouseDown)
      element.removeEventListener('mousemove', onMouseMove)
      element.removeEventListener('touchmove', onMouseMove)
      clearTimeout(downTimeout)
      clearTimeout(touchTimeout)
      touchInProgress = false
    }
  }, [])
}
