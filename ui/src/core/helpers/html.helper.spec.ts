import { describe, expect, it } from 'vitest'

import { escapeHtml, toHttpsUrl } from '@/core/helpers/html.helper'

describe('html helpers', () => {
  describe('escapeHtml', () => {
    it('escapes every character that can open markup or break out of an attribute', () => {
      expect(escapeHtml('<img src=x onerror="a">&\'')).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;')
    })

    it('leaves plain text alone', () => {
      expect(escapeHtml('Homebridge Hue')).toBe('Homebridge Hue')
    })

    it('turns a missing value into an empty string rather than "undefined"', () => {
      expect(escapeHtml(undefined)).toBe('')
      expect(escapeHtml(null)).toBe('')
    })
  })

  describe('toHttpsUrl', () => {
    it('accepts an https url', () => {
      expect(toHttpsUrl('https://github.com/sponsors/someone')).toBe('https://github.com/sponsors/someone')
    })

    it.each([
      'http://example.com',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'not a url',
      '',
    ])('rejects %s', (value) => {
      expect(toHttpsUrl(value)).toBeNull()
    })

    it('rejects anything that is not a string', () => {
      expect(toHttpsUrl({ url: 'https://example.com' })).toBeNull()
      expect(toHttpsUrl(undefined)).toBeNull()
    })
  })
})
