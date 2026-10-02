import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SafeHtml } from '@/core/ui/SafeHtml'
import { sanitizeHtml } from '@/core/ui/sanitize-html'

/**
 * The stand-in for Angular's `[innerHTML]` sanitising. Translation strings
 * with markup (and plugin-provided values inside them) go through it.
 */
describe('sanitizeHtml', () => {
  it('keeps ordinary markup and safe links', () => {
    expect(sanitizeHtml('<b>bold</b> <a href="https://homebridge.io" target="_blank" rel="noopener noreferrer">x</a>'))
      .toBe('<b>bold</b> <a href="https://homebridge.io" target="_blank" rel="noopener noreferrer">x</a>')
  })

  it('strips scripts, event handlers and iframes', () => {
    const clean = sanitizeHtml('<script>alert(1)</script><img src="x" onerror="alert(1)"><iframe src="https://example.com"></iframe>')

    expect(clean).not.toContain('script')
    expect(clean).not.toContain('onerror')
    expect(clean).not.toContain('iframe')
  })

  it('prefixes a javascript: url with unsafe:, as Angular did', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a href="unsafe:javascript:alert(1)">x</a>')
  })

  it('leaves relative and other scheme urls alone', () => {
    expect(sanitizeHtml('<a href="/plugins">x</a>')).toBe('<a href="/plugins">x</a>')
    expect(sanitizeHtml('<a href="mailto:a@b.c">x</a>')).toBe('<a href="mailto:a@b.c">x</a>')
  })

  it('turns nothing into an empty string', () => {
    expect(sanitizeHtml(undefined)).toBe('')
    expect(sanitizeHtml(null)).toBe('')
  })
})

describe('safeHtml', () => {
  it('renders the element asked for with the sanitised markup', () => {
    const { container } = render(<SafeHtml as="p" className="mb-0" html={'<b>hi</b><img src=x onerror="alert(1)">'} />)

    const p = container.firstElementChild!
    expect(p.tagName).toBe('P')
    expect(p.className).toBe('mb-0')
    expect(p.querySelector('b')?.textContent).toBe('hi')
    expect(p.innerHTML).not.toContain('onerror')
  })
})
