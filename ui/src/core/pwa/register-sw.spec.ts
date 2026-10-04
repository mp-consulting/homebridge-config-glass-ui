import { describe, expect, it, vi } from 'vitest'

import { registerServiceWorker } from './register-sw'

describe('registerServiceWorker', () => {
  const navigatorWith = (register = vi.fn(async () => ({}))) => ({ serviceWorker: { register } }) as unknown as Navigator

  it('registers the worker relative to the page, so it works under a proxy sub path', async () => {
    const register = vi.fn(async () => ({}))

    expect(await registerServiceWorker({ production: true, secure: true, navigator: navigatorWith(register) })).toBe(true)
    expect(register).toHaveBeenCalledWith('./sw.js', { scope: './' })
  })

  it('stays out of development builds and insecure origins', async () => {
    const register = vi.fn()

    expect(await registerServiceWorker({ production: false, secure: true, navigator: navigatorWith(register) })).toBe(false)
    expect(await registerServiceWorker({ production: true, secure: false, navigator: navigatorWith(register) })).toBe(false)
    expect(await registerServiceWorker({ production: true, secure: true, navigator: {} as Navigator })).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('shrugs off a failed registration', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await registerServiceWorker({ production: true, secure: true, navigator: navigatorWith(vi.fn(async () => {
      throw new Error('blocked')
    })) })).toBe(false)
  })
})
