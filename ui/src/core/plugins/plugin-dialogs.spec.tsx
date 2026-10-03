import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { ActiveModal } from '@/core/ui/modal'
import type { Mock } from 'vitest'

import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DisablePlugin } from '@/core/plugins/disable-plugin/DisablePlugin'
import { Donate } from '@/core/plugins/donate/Donate'
import { PluginCompatibility } from '@/core/plugins/plugin-compatibility/PluginCompatibility'
import { PluginInfo } from '@/core/plugins/plugin-info/PluginInfo'
import { useSettingsStore } from '@/core/settings'
import { makeEnv, makePlugin, renderWithProviders } from '@/testing'
import { showEnglish, showKeys } from '@/testing/i18n'

/**
 * The plain plugin dialogs (the Angular `dialog-modals.spec.ts` cases for
 * them). Every caller branches on whether the dialog resolved or rejected:
 * `close()` means the user agreed, a dismissal means they backed out.
 */
describe('plugin dialog modals', () => {
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }

  beforeEach(() => {
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    useSettingsStore.setState({ env: makeEnv({ nodeVersion: 'v20.0.0', homebridgeVersion: '1.8.0' }) })
  })

  const plugin = makePlugin()

  describe.each([
    ['PluginInfo', () => <PluginInfo activeModal={activeModal} plugin={plugin} />],
    ['Donate', () => <Donate activeModal={activeModal} plugin={makePlugin({ funding: [{ type: 'github', url: 'https://github.com/sponsors/test' }] })} />],
  ])('%s', (_name, element) => {
    it('reports a dismissal when the user closes it', () => {
      const { container } = renderWithProviders(element())

      fireEvent.click(container.querySelector('.modal-footer .btn-elegant')!)

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
      expect(activeModal.close).not.toHaveBeenCalled()
    })
  })

  describe('pluginInfo', () => {
    it('lights the shield that applies and mutes the others', () => {
      const { container, getByText } = renderWithProviders(<PluginInfo activeModal={activeModal} plugin={plugin} />)

      const shields = [...container.querySelectorAll('.shield-icon')]
      expect(shields.map(shield => shield.classList.contains('opacity-muted'))).toEqual([true, false, true])
      expect(shields[1].classList).toContain('green-text')
      expect(getByText('plugins.manage.verified_subtitle')).toBeTruthy()
    })

    it('links to the homepage, or the npm page without one', () => {
      const { container } = renderWithProviders(<PluginInfo activeModal={activeModal} plugin={plugin} />)

      expect(container.querySelector('a.btn-primary')?.getAttribute('href')).toBe('https://www.npmjs.com/package/homebridge-test')
    })

    it('falls back to the homebridge icon when the plugin icon will not load', () => {
      const { container } = renderWithProviders(<PluginInfo activeModal={activeModal} plugin={makePlugin({ icon: 'https://example.com/x.png' })} />)
      const image = container.querySelector('img')!
      expect(image.getAttribute('src')).toBe('https://example.com/x.png')

      fireEvent.error(image)

      expect(image.getAttribute('src')).toBe('assets/hb-icon.png')
    })
  })

  describe('pluginCompatibility', () => {
    const compatPlugin = makePlugin({ updateEngines: { node: '>=22', homebridge: '>=2.0.0' } } as any)

    it('resolves with a yes when the user carries on anyway', () => {
      const { getByText } = renderWithProviders(<PluginCompatibility activeModal={activeModal} plugin={compatPlugin} action="update" />)

      fireEvent.click(getByText('form.button_continue'))

      // The caller reads this value to decide whether to proceed, so an empty
      // close would read as "do not continue"
      expect(activeModal.close).toHaveBeenCalledWith(true)
    })

    it('rejects when the user thinks better of it', () => {
      const { getByText } = renderWithProviders(<PluginCompatibility activeModal={activeModal} plugin={compatPlugin} action="update" />)

      fireEvent.click(getByText('form.button_close'))

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })

    it('names both versions that are too low', () => {
      const { container } = renderWithProviders(<PluginCompatibility activeModal={activeModal} plugin={compatPlugin} action="update" />)

      expect(container.querySelectorAll('.list-group-item')).toHaveLength(2)
      expect(container.querySelector('.fa-arrow-alt-circle-up')).toBeTruthy()
    })

    it('offers no way past it for homebridge itself, only a close', () => {
      const { container, queryByText } = renderWithProviders(
        <PluginCompatibility activeModal={activeModal} plugin={makePlugin({ name: 'homebridge', updateEngines: { node: '>=22' } } as any)} />,
      )

      expect(queryByText('form.button_continue')).toBeNull()
      expect(container.querySelector('.modal-footer .text-center .btn-elegant')).toBeTruthy()
      expect(container.querySelector('a[href="https://homebridge.io/w/JTKEF"]')).toBeTruthy()
    })

    it('dismisses itself without a plugin', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      renderWithProviders(<PluginCompatibility activeModal={activeModal} plugin={undefined as unknown as Plugin} />)

      expect(activeModal.dismiss).toHaveBeenCalledWith('Missing required data')
    })
  })

  describe('disablePlugin', () => {
    it('resolves when the user agrees to disable', () => {
      const { getByText } = renderWithProviders(<DisablePlugin activeModal={activeModal} pluginName="homebridge-test" />)

      fireEvent.click(getByText('plugins.manage.disable'))

      expect(activeModal.close).toHaveBeenCalled()
    })

    it('rejects when the user backs out', () => {
      const { getByText } = renderWithProviders(<DisablePlugin activeModal={activeModal} pluginName="homebridge-test" />)

      fireEvent.click(getByText('form.button_close'))

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })

    it('explains what keepAccessories does for a dynamic platform', () => {
      const { getByText } = renderWithProviders(
        <DisablePlugin activeModal={activeModal} pluginName="homebridge-test" isConfigured isConfiguredDynamicPlatform keepOrphans />,
      )

      expect(getByText('plugins.manage.confirm_disable_setting')).toBeTruthy()
      expect(getByText('plugins.manage.confirm_disable_platform_1')).toBeTruthy()
    })
  })

  describe('donate', () => {
    it.each([
      ['a list of links', ['https://paypal.me/test'], [['fas fa-link', 'https://paypal.me/test']]],
      ['a list of typed entries', [{ type: 'github', url: 'https://github.com/sponsors/test' }], [['fab fa-github', 'https://github.com/sponsors/test']]],
      ['a single link', 'https://paypal.me/test', [['fas fa-link', 'https://paypal.me/test']]],
      ['a single typed entry', { type: 'kofi', url: 'https://ko-fi.com/test' }, [['fab fa-ko-fi', 'https://ko-fi.com/test']]],
    ])('understands funding given as %s', (_case, funding, expected) => {
      // Plugin authors declare this four different ways in package.json
      const { container } = renderWithProviders(<Donate activeModal={activeModal} plugin={makePlugin({ funding } as any)} />)

      const rows = [...container.querySelectorAll('.list-group-item')]
      expect(rows.map(row => [
        row.querySelector('i')!.className.replace('me-3 my-4 primary-text fa-2xl ', ''),
        row.querySelector('a')!.getAttribute('href'),
      ])).toEqual(expected)
    })

    it('closes itself when there is nothing to show', () => {
      renderWithProviders(<Donate activeModal={activeModal} plugin={makePlugin({ funding: undefined } as any)} />)

      expect(activeModal.close).toHaveBeenCalled()
    })

    it('credits the original author of the ui itself', async () => {
      await showEnglish()
      const { container } = renderWithProviders(
        <Donate
          activeModal={activeModal}
          plugin={makePlugin({ name: '@mp-consulting/homebridge-config-glass-ui', author: 'mp-consulting', funding: 'https://paypal.me/mickaelpalma' } as any)}
        />,
      )

      expect(container.querySelector('.modal-title')?.textContent).toContain('@MP Consulting')
      await showKeys()
    })
  })
})
