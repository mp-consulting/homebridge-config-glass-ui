import type { WidgetEvent } from '@/modules/status/widgets/widget.types'

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * The sizing and copy button the HAP and Matter pairing cards share: the code
 * is sized to the square that fits above the pin, and re-measured on every
 * grid resize.
 * @param resizeEvent - the widget's resize stream
 * @param pin - the setup code the copy button copies
 */
export function usePairingCard(resizeEvent: WidgetEvent, pin: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const pinCodeRef = useRef<HTMLDivElement>(null)
  const [qrCodeHeight, setQrCodeHeight] = useState(0)
  const [qrCodeWidth, setQrCodeWidth] = useState(0)
  const [pinCopied, setPinCopied] = useState(false)

  const resizeRetriesRef = useRef(0)
  // The pending resize frame, cancelled on destroy: while the card has no height
  // the resize keeps re-scheduling itself, which must not outlive the widget
  const resizeFrameRef = useRef<number | null>(null)
  const destroyedRef = useRef(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Only refs and state setters inside, so the pair is made once
  const { resizeQrCode, scheduleResize } = useMemo(() => {
    // Declared up front: the two call each other
    let resize: () => void
    const schedule = (): void => {
      if (destroyedRef.current) {
        return
      }
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null
        resize()
      })
    }

    resize = (): void => {
      const container = containerRef.current
      if (!container) {
        return
      }
      const containerHeight = container.offsetHeight

      // The card can be measured before it has been laid out (for example right after
      // the dashboard is rebuilt for layout editing), which would size the code to
      // nothing; try again on the next few frames instead
      if (!containerHeight && resizeRetriesRef.current < 10) {
        resizeRetriesRef.current += 1
        schedule()
        return
      }
      resizeRetriesRef.current = 0
      const containerWidth = container.offsetWidth
      const pinCodeHeight = pinCodeRef.current?.offsetHeight ?? 0

      const newHeight = containerHeight - pinCodeHeight
      const newWidth = containerWidth > newHeight ? newHeight : containerWidth

      setQrCodeHeight(newHeight)
      setQrCodeWidth(newWidth)
    }

    return { resizeQrCode: resize, scheduleResize: schedule }
  }, [])

  // Subscribe to grid resize events
  useEffect(() => resizeEvent.subscribe(() => resizeQrCode()), [resizeEvent, resizeQrCode])

  useEffect(() => {
    destroyedRef.current = false
    return () => {
      destroyedRef.current = true
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current)
        resizeFrameRef.current = null
      }
      clearTimeout(copiedTimerRef.current)
    }
  }, [])

  /**
   * Copy the setup code, for pairing by typing it in instead of scanning.
   * The button shows a tick for a moment as confirmation.
   */
  const copyPin = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(pin)
      setPinCopied(true)
      clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(setPinCopied, 1500, false)
    } catch (error) {
      // Clipboard access needs a secure context (https or localhost); nothing to recover
      console.error('Could not copy the setup code', error)
    }
  }

  return { containerRef, pinCodeRef, qrCodeHeight, qrCodeWidth, pinCopied, copyPin, scheduleResize }
}
