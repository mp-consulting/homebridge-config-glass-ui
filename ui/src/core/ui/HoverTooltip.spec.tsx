import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HoverTooltip } from '@/core/ui/HoverTooltip'

/** The app's tooltip: it opens for the keyboard as well as the mouse. */
describe('hover tooltip', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens when its target takes focus', async () => {
    vi.useFakeTimers()
    render(
      <HoverTooltip text="The hint">
        <button type="button">Target</button>
      </HoverTooltip>,
    )

    fireEvent.focus(screen.getByRole('button', { name: 'Target' }))
    await act(() => vi.advanceTimersByTimeAsync(200))

    expect(screen.getByRole('tooltip')).toHaveTextContent('The hint')
  })
})
