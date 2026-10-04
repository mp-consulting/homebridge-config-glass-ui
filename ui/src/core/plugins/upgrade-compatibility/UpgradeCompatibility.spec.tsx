import type { FakeApi } from '@/testing'

import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeApi, renderWithProviders } from '@/testing'

import { UpgradeCompatibility } from './UpgradeCompatibility'

describe('the upgrade compatibility list', () => {
  let api: FakeApi

  const entry = (name: string, engines: Record<string, string>, engineIssues: string[]) => ({
    name,
    displayName: name.replace('homebridge-', ''),
    installedVersion: '1.0.0',
    engines,
    engineIssues,
  })

  async function render(target: { node?: string, homebridge?: string }) {
    const view = renderWithProviders(<UpgradeCompatibility target={target} />)
    await act(async () => {})
    return view
  }

  beforeEach(() => {
    api = fakeApi()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('names each plugin that would not accept the new version, and what it needs', async () => {
    api.respond('get', /\/plugins\/compatibility/, {
      target: { node: '24.0.0' },
      incompatible: [entry('homebridge-old', { node: '^18 || ^20' }, ['node'])],
      unknown: [],
      checked: 2,
    })
    await render({ node: '24.0.0' })

    expect(api.callsTo('get', '/plugins/compatibility?node=24.0.0')).toHaveLength(1)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('old v1.0.0')
    expect(alert).toHaveTextContent('plugins.compat.upgrade_requires')
  })

  it('mentions the plugins that state no supported versions', async () => {
    api.respond('get', /\/plugins\/compatibility/, {
      target: { homebridge: '2.0.0' },
      incompatible: [],
      unknown: [entry('homebridge-silent', {}, ['homebridge'])],
      checked: 1,
    })
    const { container } = await render({ homebridge: '2.0.0' })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(container).toHaveTextContent('plugins.compat.upgrade_unknown')
  })

  it('shows nothing when every plugin is fine', async () => {
    api.respond('get', /\/plugins\/compatibility/, { target: { node: '24.0.0' }, incompatible: [], unknown: [], checked: 4 })
    const { container } = await render({ node: '24.0.0' })

    expect(container.querySelector('.hb-upgrade-compatibility')).toBeNull()
  })

  it('shows nothing when the check fails: it is advice, not a blocker', async () => {
    api.fail('get', /\/plugins\/compatibility/, { status: 500 })
    const { container } = await render({ node: '24.0.0' })

    expect(container.querySelector('.hb-upgrade-compatibility')).toBeNull()
  })
})
