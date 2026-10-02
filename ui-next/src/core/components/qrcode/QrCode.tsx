import { toString } from 'qrcode'
import { useEffect, useRef } from 'react'

import './qrcode.scss'

/**
 * A QR code drawn as an svg (not an image: the pairing code has to stay crisp
 * at any size), in white on a dark theme and black on a light one. The path
 * carries `qr-code-theme-color` so the theme can recolour it.
 */
export function QrCode({ data }: { data: string }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!data) {
      return
    }
    let cancelled = false
    void toString(data, {
      type: 'svg',
      margin: 0,
      color: {
        light: '#ffffff00',
        dark: document.body.classList.contains('dark-mode') ? '#FFF' : '#000',
      },
    }).then((svg) => {
      const el = containerRef.current
      // A newer code (or an unmount) has overtaken this one
      if (cancelled || !el) {
        return
      }
      el.innerHTML = svg
      el.querySelector('svg path')?.classList.add('qr-code-theme-color')
    })
    return () => {
      cancelled = true
    }
  }, [data])

  return <div ref={containerRef} className="qrcode-container" />
}
