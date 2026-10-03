import { afterEach, describe, expect, it, vi } from 'vitest'

import { interpolateMd } from '@/core/pipes/interpolate-md'

describe('interpolateMd', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('substitutes the current hostname everywhere it appears', () => {
    // jsdom's location cannot be navigated, so swap the whole object
    vi.stubGlobal('location', { ...window.location, hostname: 'homebridge.local' })

    // eslint-disable-next-line no-template-curly-in-string -- this is the literal placeholder text, not a template literal
    const source = 'Open http://${{HOSTNAME}}:8581 or http://${{HOSTNAME}}:8080'

    expect(interpolateMd(source)).toBe('Open http://homebridge.local:8581 or http://homebridge.local:8080')
  })

  it('leaves text without the placeholder alone', () => {
    expect(interpolateMd('Nothing to replace here')).toBe('Nothing to replace here')
  })

  it('does not escape the markdown it is given', () => {
    // Deliberate: the output goes to the markdown renderer, which is where
    // sanitising happens
    expect(interpolateMd('**bold** <b>tag</b>')).toBe('**bold** <b>tag</b>')
  })
})
