import { describe, expect, it } from 'vitest'

import { fakeTerminals } from '@/testing'

import { deferredTerminalFactory, provideTerminalFactory } from './deferred-terminal-factory'

/**
 * The shared terminal services are built without xterm, so the pages that only
 * need the navigation guard do not download it. The factory arrives when a
 * terminal component loads `terminal.factory.ts`.
 */
describe('deferredTerminalFactory', () => {
  it('says what is missing when a terminal is started before xterm has loaded', () => {
    expect(() => deferredTerminalFactory.createTerminal({})).toThrow(/xterm is not loaded/)
  })

  it('builds with the factory it was given', () => {
    const terminals = fakeTerminals()
    provideTerminalFactory(terminals.factory)

    const term = deferredTerminalFactory.createTerminal({ fontSize: 10 })
    const fit = deferredTerminalFactory.createFitAddon()

    expect(term).toBe(terminals.term())
    expect(fit).toBe(terminals.fit())
  })

  it('is handed the real xterm factory by loading terminal.factory', async () => {
    const { xtermFactory } = await import('./terminal.factory')
    const term = deferredTerminalFactory.createTerminal({})

    expect(term.constructor).toBe(xtermFactory.createTerminal({}).constructor)
  })
})
