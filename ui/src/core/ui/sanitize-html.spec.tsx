import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SafeHtml } from '@/core/ui/SafeHtml'
import { sanitizeHtml } from '@/core/ui/sanitize-html'
import { safeHtml as schemaFormHtml } from '@/schema-form/widgets/html'

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

  it('removes form controls, <style> and inline styles that could overlay a fake form', () => {
    const clean = sanitizeHtml(
      '<form action="https://evil.example"><input name="password"><textarea>t</textarea>'
      + '<select><option>o</option></select><button formaction="https://evil.example">Sign in</button></form>'
      + '<style>body{display:none}</style><p style="position:fixed;inset:0">overlay</p>',
    )

    for (const tag of ['<form', '<input', '<textarea', '<select', '<option', '<button', '<style', 'style=', 'formaction', 'display:none']) {
      expect(clean).not.toContain(tag)
    }
    expect(clean).toContain('<p>overlay</p>')
    expect(clean).toContain('Sign in')
  })

  it('forces rel="noopener noreferrer" on any link with a target', () => {
    expect(sanitizeHtml('<a href="https://example.com" target="_blank">x</a>'))
      .toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>')
    expect(sanitizeHtml('<a href="https://example.com" target="_blank" rel="opener">x</a>'))
      .toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>')
    expect(sanitizeHtml('<a href="https://example.com">x</a>')).toBe('<a href="https://example.com">x</a>')
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

describe('schema-form html', () => {
  it('uses the same hardened profile for plugin schema help text', () => {
    const { __html } = schemaFormHtml('<b>Note</b> <span style="color:red">x</span><form><input></form><a href="https://e.x" target="_blank">doc</a>')

    expect(__html).toBe('<b>Note</b> <span>x</span><a href="https://e.x" target="_blank" rel="noopener noreferrer">doc</a>')
  })
})
