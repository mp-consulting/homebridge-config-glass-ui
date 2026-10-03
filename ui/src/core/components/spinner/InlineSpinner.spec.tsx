import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'

describe('inline spinner', () => {
  it('draws the same spinning icon, hidden from screen readers', () => {
    const { container } = render(<InlineSpinner className="icon-xl" />)

    const icon = container.querySelector('i')!
    expect(icon).toHaveClass('fas', 'fa-circle-notch', 'fa-spin', 'icon-xl')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('says it is loading, out of sight', () => {
    // The bare icon said nothing at all to a screen reader
    render(<InlineSpinner />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('common.a11y.loading')
    expect(status).toHaveClass('visually-hidden')
  })

  it('names what is loading when asked to', () => {
    render(<InlineSpinner label="Loading plugins" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading plugins')
  })
})
