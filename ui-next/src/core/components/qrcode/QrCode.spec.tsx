import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { QrCode } from '@/core/components/qrcode/QrCode'

describe('the QR code', () => {
  afterEach(() => {
    document.body.classList.remove('dark-mode')
  })

  async function draw(data: string, darkMode = false) {
    document.body.classList.toggle('dark-mode', darkMode)
    const { container } = render(<QrCode data={data} />)
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())
    return container
  }

  it('draws the pairing code as an svg', async () => {
    // Not an image: the pairing code has to stay crisp at any size
    const host = await draw('X-HM://0024MDTOP1234')

    expect(host.querySelector('.qrcode-container > svg')).not.toBeNull()
  })

  it('marks the code so the theme can colour it', async () => {
    const host = await draw('X-HM://0024MDTOP1234')

    expect(host.querySelector('svg path')?.classList.contains('qr-code-theme-color')).toBe(true)
  })

  it('draws in white on a dark theme', async () => {
    const host = await draw('X-HM://0024MDTOP1234', true)

    expect(host.querySelector('svg')?.innerHTML).toContain('#FFF')
  })

  it('draws in black on a light theme', async () => {
    const host = await draw('X-HM://0024MDTOP1234', false)

    expect(host.querySelector('svg')?.innerHTML).toContain('#000')
  })

  it('draws nothing at all when there is no code yet', async () => {
    // The pairing widget renders this before the bridge has reported its code
    const { container } = render(<QrCode data="" />)
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve()
    }

    expect(container.querySelector('svg')).toBeNull()
  })

  it('redraws when the code changes', async () => {
    const { container, rerender } = render(<QrCode data="X-HM://AAAA" />)
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull())
    const first = container.querySelector('svg')!.innerHTML

    rerender(<QrCode data="X-HM://BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" />)

    await waitFor(() => expect(container.querySelector('svg')!.innerHTML).not.toBe(first))
  })
})
