import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SupportBanner } from '@/core/components/support-banner/SupportBanner'
import { showEnglish, showKeys } from '@/testing/i18n'

describe('supportBanner', () => {
  // Real English: the links only exist once the params are interpolated
  beforeEach(showEnglish)
  afterEach(showKeys)

  it('renders the ngb-alert markup with both links, opened safely', () => {
    const { container } = render(<SupportBanner />)

    const alert = container.firstElementChild!
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.classList).toContain('alert-info')
    const links = [...alert.querySelectorAll('a')]
    expect(links.map(link => link.textContent)).toEqual(['GitHub', 'Discord'])
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })
})
