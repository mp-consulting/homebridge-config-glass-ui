import type { ChildBridgeIconSource } from '@/core/components/child-bridge-status-icons/ChildBridgeStatusIcons'

import { render as rtlRender } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChildBridgeStatusIcons } from '@/core/components/child-bridge-status-icons/ChildBridgeStatusIcons'
import { HomebridgeStatus } from '@/core/interfaces/server.interfaces'
import { useSettingsStore } from '@/core/settings'
import { makeEnv } from '@/testing'

import '@/testing/i18n'

/**
 * The HAP and Matter icons for one child bridge, extracted from the bridges
 * widget so Update All's post-run restart list shows a bridge the same way.
 *
 * The colours are the whole point: the same icon means "off", "externals
 * only", "not running" or "running" depending on config whose spelling
 * changed between Homebridge versions, and on feature flags. Getting it wrong
 * tells the user a working bridge is broken.
 */
describe('childBridgeStatusIcons', () => {
  const allFlags = { matterSupport: true, hapBridgeDisable: true, protocolExternalsOnly: true }

  /**
   * Render the icons for one bridge.
   * @param bridge - the bridge state to render
   * @param featureFlags - the feature flags to enable
   * @param serverRestarting - whether the whole server is restarting
   */
  function render(bridge: ChildBridgeIconSource, featureFlags: Record<string, boolean> = allFlags, serverRestarting = false) {
    useSettingsStore.setState({ env: makeEnv({ featureFlags }) })
    return rtlRender(<ChildBridgeStatusIcons bridge={bridge} serverRestarting={serverRestarting} />).container
  }

  /**
   * The classes on one of the two icons.
   * @param host - the rendered container
   * @param which - hap or matter
   */
  function classesOf(host: HTMLElement, which: 'hap' | 'matter'): string[] {
    const el = host.querySelector(`.fa-${which}`)
    return el ? [...el.classList] : []
  }

  it('shows a running bridge in green on both protocols', () => {
    const host = render({ status: HomebridgeStatus.OK, matterConfig: { enabled: true } })
    expect(classesOf(host, 'hap')).toContain('green-text')
    expect(classesOf(host, 'matter')).toContain('green-text')
  })

  it('shows a restarting bridge in amber, not green or red', () => {
    const host = render({ status: HomebridgeStatus.OK, restarting: true, matterConfig: { enabled: true } })
    expect(classesOf(host, 'hap')).toContain('text-warning')
    expect(classesOf(host, 'hap')).not.toContain('green-text')
    expect(classesOf(host, 'hap')).not.toContain('red-text')
  })

  it('shows a pending bridge in amber', () => {
    const host = render({ status: HomebridgeStatus.PENDING })
    expect(classesOf(host, 'hap')).toContain('text-warning')
  })

  it('treats a whole-server restart as a transition for every bridge', () => {
    const host = render({ status: HomebridgeStatus.DOWN }, allFlags, true)
    expect(classesOf(host, 'hap')).toContain('text-warning')
    expect(classesOf(host, 'hap')).not.toContain('red-text')
  })

  it('shows a down bridge in red', () => {
    const host = render({ status: HomebridgeStatus.DOWN, matterConfig: { enabled: true } })
    expect(classesOf(host, 'hap')).toContain('red-text')
    expect(classesOf(host, 'matter')).toContain('red-text')
  })

  it('mutes HAP when disabled, in both the legacy boolean and object spellings', () => {
    for (const hap of [false as const, { enabled: false }]) {
      const host = render({ status: HomebridgeStatus.OK, hap })
      expect(classesOf(host, 'hap')).toContain('grey-text')
      expect(classesOf(host, 'hap')).toContain('opacity-muted')
      expect(classesOf(host, 'hap')).not.toContain('green-text')
    }
  })

  it('ignores a disabled HAP flag when the runtime does not support disabling', () => {
    const host = render({ status: HomebridgeStatus.OK, hap: { enabled: false } }, { matterSupport: true })
    expect(classesOf(host, 'hap')).toContain('green-text')
    expect(classesOf(host, 'hap')).not.toContain('opacity-muted')
  })

  it('marks externals-only with the info colour rather than green', () => {
    const host = render({ status: HomebridgeStatus.OK, hap: { externalsOnly: true }, matterConfig: { enabled: true, externalsOnly: true } })
    expect(classesOf(host, 'hap')).toContain('text-info')
    expect(classesOf(host, 'hap')).not.toContain('green-text')
    expect(classesOf(host, 'matter')).toContain('text-info')
  })

  it('mutes Matter when there is no matterConfig at all', () => {
    const host = render({ status: HomebridgeStatus.OK })
    expect(classesOf(host, 'matter')).toContain('grey-text')
    expect(classesOf(host, 'matter')).toContain('opacity-muted')
  })

  it('omits the Matter icon entirely when the runtime does not support Matter', () => {
    const host = render({ status: HomebridgeStatus.OK, matterConfig: { enabled: true } }, { hapBridgeDisable: true })
    expect(host.querySelector('.fa-matter')).toBeNull()
    expect(host.querySelector('.fa-hap')).not.toBeNull()
  })

  it('keeps the icons out of the accessibility tree', () => {
    const host = render({ status: HomebridgeStatus.OK, matterConfig: { enabled: true } })
    expect(host.querySelector('.fa-hap')?.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('.fa-matter')?.getAttribute('aria-hidden')).toBe('true')
  })
})
