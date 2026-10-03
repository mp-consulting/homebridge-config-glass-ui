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

  it('names an icon-only button after the tooltip', () => {
    // The tooltip is only ever shown, so the button would read as just "button"
    render(
      <HoverTooltip text="Delete">
        <button type="button"><i className="fas fa-trash-can" aria-hidden="true"></i></button>
      </HoverTooltip>,
    )

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('leaves a button that already has a name alone', () => {
    render(
      <HoverTooltip text="The hint">
        <button type="button" aria-label="Edit Kitchen">
          <i className="fas fa-pen" aria-hidden="true"></i>
        </button>
      </HoverTooltip>,
    )

    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Edit Kitchen')
  })

  it('leaves a button with text alone', () => {
    render(
      <HoverTooltip text="The hint">
        <button type="button">Target</button>
      </HoverTooltip>,
    )

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-label')
  })
})
