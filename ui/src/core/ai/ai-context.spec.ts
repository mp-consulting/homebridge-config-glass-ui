import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { buildAssistantContext, currentAssistantPlugin, useAssistantPluginContext } from './ai-context'

describe('assistant page context', () => {
  it.each([
    ['/', 'dashboard'],
    ['/logs', 'logs'],
    ['/accessories', 'accessories'],
    ['/plugins', 'plugins'],
    ['/config', 'config-editor'],
    ['/platform-tools/terminal', 'platform-tools'],
    ['/child-bridges', 'child-bridges'],
    ['/quick', 'quick-controls'],
    ['/configuration', 'other'],
  ])('names %s as %s', (route, page) => {
    expect(buildAssistantContext(route, undefined)).toEqual({ route, page })
  })

  it('drops the query and fragment', () => {
    expect(buildAssistantContext('/logs?x=1#y', undefined)).toEqual({ route: '/logs', page: 'logs' })
  })

  it('names the plugin whose settings dialog is open, innermost first', () => {
    expect(currentAssistantPlugin()).toBeUndefined()
    const outer = renderHook(() => useAssistantPluginContext('homebridge-hue'))
    expect(buildAssistantContext('/plugins')).toEqual({ route: '/plugins', page: 'plugin-settings', plugin: 'homebridge-hue' })

    const inner = renderHook(() => useAssistantPluginContext('@scope/homebridge-ring'))
    expect(currentAssistantPlugin()).toBe('@scope/homebridge-ring')
    inner.unmount()
    expect(currentAssistantPlugin()).toBe('homebridge-hue')
    outer.unmount()
    expect(currentAssistantPlugin()).toBeUndefined()
  })
})
