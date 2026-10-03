import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loaderMock = vi.hoisted(() => ({
  config: vi.fn(),
  init: vi.fn(),
}))

vi.mock('@monaco-editor/react', () => ({ loader: loaderMock }))

const { configureMonacoLoader, getMonaco, loadMonaco, onMonacoReady, resetMonacoLoaderForTests, resolveMonacoVsPath } = await import('./monaco-loader')

describe('resolveMonacoVsPath', () => {
  it.each([
    ['http://hb.local:8581/', 'http://hb.local:8581/assets/monaco/min/vs'],
    ['http://hb.local:8581/plugins?x=1', 'http://hb.local:8581/assets/monaco/min/vs'],
    ['https://proxy.example/homebridge/', 'https://proxy.example/homebridge/assets/monaco/min/vs'],
    // A base without a trailing slash resolves against its parent directory,
    // exactly like the relative `./assets/...` script URL Angular used.
    ['https://proxy.example/homebridge/index.html', 'https://proxy.example/homebridge/assets/monaco/min/vs'],
    ['http://localhost:4200/', 'http://localhost:4200/assets/monaco/min/vs'],
  ])('resolves against %s', (base, expected) => {
    expect(resolveMonacoVsPath(base)).toBe(expected)
  })

  it('defaults to document.baseURI', () => {
    expect(resolveMonacoVsPath()).toBe(new URL('assets/monaco/min/vs', document.baseURI).href)
  })
})

describe('loader wiring', () => {
  beforeEach(() => {
    resetMonacoLoaderForTests()
    loaderMock.config.mockReset()
    loaderMock.init.mockReset()
    delete (window as { monaco?: unknown }).monaco
  })

  afterEach(() => {
    delete (window as { monaco?: unknown }).monaco
  })

  it('configures the AMD path once per base', () => {
    configureMonacoLoader('https://proxy.example/hb/')
    configureMonacoLoader('https://proxy.example/hb/')
    expect(loaderMock.config).toHaveBeenCalledTimes(1)
    expect(loaderMock.config).toHaveBeenCalledWith({ paths: { vs: 'https://proxy.example/hb/assets/monaco/min/vs' } })
  })

  it('loads once and notifies ready listeners (the Angular readyEvent)', async () => {
    const fakeMonaco = { editor: {} }
    loaderMock.init.mockResolvedValue(fakeMonaco)
    const listener = vi.fn()
    onMonacoReady(listener)

    const [a, b] = await Promise.all([loadMonaco(), loadMonaco()])
    expect(a).toBe(fakeMonaco)
    expect(b).toBe(fakeMonaco)
    expect(loaderMock.init).toHaveBeenCalledTimes(1)
    expect(loaderMock.config).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledExactlyOnceWith(fakeMonaco)
  })

  it('calls a late listener immediately once window.monaco exists', () => {
    const fakeMonaco = { editor: {} }
    ;(window as { monaco?: unknown }).monaco = fakeMonaco
    expect(getMonaco()).toBe(fakeMonaco)
    const listener = vi.fn()
    onMonacoReady(listener)
    expect(listener).toHaveBeenCalledWith(fakeMonaco)
  })

  it('allows a retry after a failed load', async () => {
    loaderMock.init.mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce({ editor: {} })
    await expect(loadMonaco()).rejects.toThrow('404')
    await expect(loadMonaco()).resolves.toEqual({ editor: {} })
  })
})
