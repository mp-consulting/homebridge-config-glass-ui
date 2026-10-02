import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { lightingModeFromBody, monacoThemeFor, useMonacoTheme } from './monaco-theme'

describe('monaco theme', () => {
  afterEach(() => {
    document.body.classList.remove('dark-mode')
  })

  it('maps the lighting mode to a built-in Monaco theme', () => {
    expect(monacoThemeFor('dark')).toBe('vs-dark')
    expect(monacoThemeFor('light')).toBe('vs')
  })

  it('reads the mode from the body dark-mode class', () => {
    expect(lightingModeFromBody()).toBe('light')
    document.body.classList.add('dark-mode')
    expect(lightingModeFromBody()).toBe('dark')
  })

  it('follows body class changes', async () => {
    const { result } = renderHook(() => useMonacoTheme())
    expect(result.current).toBe('vs')
    await act(async () => {
      document.body.classList.add('dark-mode')
      await Promise.resolve()
    })
    expect(result.current).toBe('vs-dark')
  })
})
