import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Spinner } from '@/core/components/spinner/Spinner'

describe('spinner', () => {
  it('renders the spinner with an accessible loading label', () => {
    const { container } = render(<Spinner />)

    const spinner = container.querySelector('.app-spinner-container')
    expect(spinner).not.toBeNull()
    expect(spinner!.getAttribute('role')).toBe('status')
    expect(container.querySelectorAll('circle')).toHaveLength(2)
    expect(container.querySelector('.visually-hidden')?.textContent).toBe('common.a11y.loading')
  })
})
