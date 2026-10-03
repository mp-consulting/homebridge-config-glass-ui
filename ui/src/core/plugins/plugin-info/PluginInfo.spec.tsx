import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PluginInfo } from '@/core/plugins/plugin-info/PluginInfo'
import { activeModalStub, renderWithProviders } from '@/testing'
import { showEnglish, showKeys } from '@/testing/i18n'

describe('pluginInfo', () => {
  beforeEach(async () => {
    await showEnglish()
  })

  afterEach(async () => {
    await showKeys()
  })

  it('gives the icon-only scoped and verified wiki links translated names', () => {
    const plugin = { name: 'homebridge-example', displayName: 'Example', links: {} } as Plugin
    const view = renderWithProviders(<PluginInfo activeModal={activeModalStub() as any} plugin={plugin} />)

    const scoped = view.getByRole('link', { name: 'About scoped plugins (opens in a new tab)' })
    const verified = view.getByRole('link', { name: 'About verified plugins (opens in a new tab)' })
    expect(scoped).toHaveAttribute('href', 'https://github.com/homebridge/plugins/wiki/Scoped-Plugins')
    expect(verified).toHaveAttribute('href', 'https://github.com/homebridge/plugins/wiki/Verified-Plugins')
    expect(scoped.querySelector('i')).toHaveAttribute('aria-hidden', 'true')
    expect(verified.querySelector('i')).toHaveAttribute('aria-hidden', 'true')
  })
})
