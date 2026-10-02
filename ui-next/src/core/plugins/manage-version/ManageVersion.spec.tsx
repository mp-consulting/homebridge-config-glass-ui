import type { FakeApi, FakeCache } from '@/testing'

import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pluginsCache as realPluginsCache } from '@/core/caching/plugins-cache'
import { ManageVersion } from '@/core/plugins/manage-version/ManageVersion'
import { useSettingsStore } from '@/core/settings'
import { toast } from '@/core/ui/toast'
import { activeModalStub, fakeApi, makePlugin, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
vi.mock('@/core/caching/plugins-cache', async () => ({ pluginsCache: (await import('@/testing')).cacheStub<any[]>([]) }))

const pluginsCache = realPluginsCache as unknown as FakeCache<any[]>

/**
 * The version picker. It installs nothing itself: it closes with the chosen
 * version, and the caller opens the manage modal. It also owns the per-plugin
 * update notification preference.
 */
describe('manageVersion', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>
  let onRefreshPluginList: ReturnType<typeof vi.fn<() => void>>
  let onSettingsChange: ReturnType<typeof vi.fn<() => void>>

  const versionsResponse = {
    versions: {
      '1.0.0': { engines: { homebridge: '>=1.8.0' } },
      '2.0.0': { engines: { homebridge: '>=2.0.0' } },
      '2.1.0-beta.1': { engines: { homebridge: '>=2.0.0' } },
    },
    tags: { latest: '2.0.0', beta: '2.1.0-beta.1', next: '2.1.0-beta.1' },
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  async function open(plugin = makePlugin(), arrange?: () => void, env: Record<string, any> = {}) {
    api.respond('get', /\/plugins\/lookup\/.*\/versions$/, versionsResponse)
    useSettingsStore.setState(makeSettingsState({ env }))
    arrange?.()
    const view = renderWithProviders(
      <ManageVersion activeModal={activeModal as any} plugin={plugin} onRefreshPluginList={onRefreshPluginList} onSettingsChange={onSettingsChange} />,
    )
    await settle()
    return view
  }

  const options = () => Array.from(screen.getByRole('combobox').querySelectorAll('option')).map(o => o.value)
  const tagRows = () => screen.getAllByRole('listitem')
    .filter(li => li.querySelector('small.font-monospace'))
    .map(li => li.querySelector('span')!.firstChild!.textContent!.trim())

  beforeEach(() => {
    api = fakeApi()
    activeModal = activeModalStub()
    onRefreshPluginList = vi.fn<() => void>()
    onSettingsChange = vi.fn<() => void>()
    pluginsCache.invalidate.mockClear()
    vi.mocked(toast.error).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('choosing a version to install', () => {
    it('lists the versions newest first', async () => {
      await open()

      expect(options()).toEqual(['2.1.0-beta.1', '2.0.0', '1.0.0'])
    })

    it('orders the tag shortcuts by usefulness, one per tag a version carries', async () => {
      await open()

      expect(tagRows()).toEqual(['latest', 'next', 'beta'])
    })

    it('puts a tag it does not recognise after the ones it does', async () => {
      await open(makePlugin(), () => {
        api.respond('get', /\/plugins\/lookup\/.*\/versions$/, {
          versions: versionsResponse.versions,
          tags: { legacy: '1.0.0', latest: '2.0.0', beta: '2.1.0-beta.1' },
        })
      })

      expect(tagRows()).toEqual(['latest', 'beta', 'legacy'])
    })

    it('records no engine requirement for a version npm no longer describes', async () => {
      await open(makePlugin({ installedVersion: '0.9.0', engines: undefined }))

      fireEvent.click(screen.getByRole('button', { name: 'plugins.manage.reinstall v0.9.0' }))

      expect(activeModal.close.mock.calls[0][0].engines).toBeNull()
    })

    it('starts on the installed version', async () => {
      await open(makePlugin({ installedVersion: '1.0.0' }))

      expect(screen.getByRole('combobox')).toHaveValue('1.0.0')
    })

    it('keeps a version npm no longer lists', async () => {
      await open(makePlugin({ installedVersion: '0.9.0' }))

      expect(options()).toContain('0.9.0')
      expect(screen.getByRole('combobox')).toHaveValue('0.9.0')
    })

    it('falls back to the latest tag when the chosen version is gone', async () => {
      await open(makePlugin({ installedVersion: undefined as any, latestVersion: '9.9.9' }))

      expect(screen.getByRole('combobox')).toHaveValue('2.0.0')
    })

    it('closes with an alternate install for a plugin already installed', async () => {
      await open(makePlugin({ installedVersion: '1.0.0' }))

      fireEvent.click(screen.getByRole('button', { name: 'plugins.manage.install v2.0.0' }))

      expect(activeModal.close).toHaveBeenCalledWith({
        name: 'homebridge-test',
        version: '2.0.0',
        engines: { homebridge: '>=2.0.0' },
        action: 'alternate',
      })
    })

    it('installs whatever the dropdown has selected', async () => {
      await open(makePlugin({ installedVersion: '1.0.0' }))

      fireEvent.change(screen.getByRole('combobox'), { target: { value: '2.1.0-beta.1' } })
      const row = screen.getByRole('combobox').closest('li')!
      fireEvent.click(within(row).getByRole('button'))

      expect(activeModal.close.mock.calls[0][0].version).toBe('2.1.0-beta.1')
    })

    it('closes with a plain install for a plugin not yet installed', async () => {
      await open(makePlugin({ installedVersion: undefined as any }))

      fireEvent.click(screen.getAllByRole('button', { name: 'plugins.manage.install v2.0.0' })[0])

      expect(activeModal.close.mock.calls[0][0].action).toBe('install')
    })

    it('closes itself when the versions cannot be looked up', async () => {
      const { container } = await open(makePlugin(), () => api.fail('get', /\/plugins\/lookup\//, new Error('npm unreachable')))

      expect(activeModal.dismiss).toHaveBeenCalled()
      expect(container.querySelector('.fa-circle-notch')).not.toBeNull()
      expect(toast.error).toHaveBeenCalledWith('npm unreachable', 'toast.title_error')
    })

    it('escapes a scoped plugin name in the lookup url', async () => {
      await open(makePlugin({ name: '@homebridge-plugins/homebridge-test' }))

      expect(api.lastCall('get')?.url).toBe('/plugins/lookup/%40homebridge-plugins%2Fhomebridge-test/versions')
    })
  })

  describe('changing what updates a plugin offers', () => {
    const smallVersions = { versions: { '1.0.0': {} }, tags: { latest: '1.0.0' } }

    async function choose(plugin: ReturnType<typeof makePlugin>, preference: string, env: Record<string, any> = {}) {
      await open(plugin, () => api.respond('get', /\/plugins\/lookup\//, smallVersions), env)
      api.clearCalls()
      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('radio', { name: `plugins.manage.notifications_${preference}` }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })
    }

    const checked = () => (screen.getAllByRole('radio') as HTMLInputElement[]).find(r => r.checked)?.value

    it('reads a regular plugin as hidden when it is on the hide list', async () => {
      await open(makePlugin(), undefined, { plugins: { hideUpdatesFor: ['homebridge-test'] } })

      expect(checked()).toBe('none')
    })

    it('reads a regular plugin as beta when it is on the betas list', async () => {
      await open(makePlugin(), undefined, { plugins: { showBetasFor: ['homebridge-test'] } })

      expect(checked()).toBe('beta')
    })

    it('reads homebridge from its own policy key, and offers it a major-only option', async () => {
      await open(makePlugin({ name: 'homebridge' }), undefined, { homebridgeUpdatePolicy: 'major' })

      expect(checked()).toBe('major')
    })

    it('offers no major-only option to a regular plugin', async () => {
      await open(makePlugin())

      expect(screen.getAllByRole('radio').map(r => (r as HTMLInputElement).value)).toEqual(['all', 'beta', 'none'])
    })

    it('adds a regular plugin to the hide list', async () => {
      await choose(makePlugin(), 'none', { plugins: { hideUpdatesFor: ['homebridge-aaa'] } })

      expect(api.lastCall('put', '/config-editor/ui/plugins/hide-updates-for')?.body).toEqual({
        body: ['homebridge-aaa', 'homebridge-test'],
      })
      expect(useSettingsStore.getState().env.plugins?.hideUpdatesFor).toEqual(['homebridge-aaa', 'homebridge-test'])
    })

    it('takes a plugin off the hide list when updates are wanted again', async () => {
      await choose(makePlugin(), 'all', { plugins: { hideUpdatesFor: ['homebridge-test'] } })

      expect(api.lastCall('put', '/config-editor/ui/plugins/hide-updates-for')?.body).toEqual({ body: [] })
    })

    it('moves a plugin between the two lists rather than adding to both', async () => {
      await choose(makePlugin(), 'beta', { plugins: { hideUpdatesFor: ['homebridge-test'] } })

      expect(api.lastCall('put', '/config-editor/ui/plugins/hide-updates-for')?.body).toEqual({ body: [] })
      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({
        'plugins.showBetasFor': ['homebridge-test'],
      })
    })

    it('writes the homebridge policy to its own key', async () => {
      await choose(makePlugin({ name: 'homebridge' }), 'major')

      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({ homebridgeUpdatePolicy: 'major' })
      expect(api.callsTo('put', '/config-editor/ui/plugins/hide-updates-for')).toHaveLength(0)
      expect(useSettingsStore.getState().env.homebridgeUpdatePolicy).toBe('major')
    })

    it('writes the ui policy to its own key', async () => {
      await choose(makePlugin({ name: '@mp-consulting/homebridge-config-glass-ui' }), 'none')

      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({ homebridgeUiUpdatePolicy: 'none' })
    })

    it('clears both caches so the next check re-reads npm', async () => {
      await choose(makePlugin(), 'beta')

      expect(api.callsTo('post', '/plugins/clear-cache')).toHaveLength(1)
      expect(pluginsCache.invalidate).toHaveBeenCalled()
    })

    it('tells the pages that show update badges to refresh', async () => {
      await choose(makePlugin(), 'beta')

      expect(onRefreshPluginList).toHaveBeenCalled()
      expect(onSettingsChange).toHaveBeenCalled()
    })

    it('saves only the last of several quick changes', async () => {
      await open(makePlugin(), () => api.respond('get', /\/plugins\/lookup\//, smallVersions))
      api.clearCalls()
      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('radio', { name: 'plugins.manage.notifications_none' }))
      fireEvent.click(screen.getByRole('radio', { name: 'plugins.manage.notifications_beta' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(api.callsTo('put', '/config-editor/ui/plugins/hide-updates-for')).toHaveLength(1)
      expect(api.lastCall('patch', '/config-editor/ui')?.body).toEqual({ 'plugins.showBetasFor': ['homebridge-test'] })
    })

    it('reverts the radio and says so when the save is refused', async () => {
      await open(makePlugin(), () => {
        api.respond('get', /\/plugins\/lookup\//, smallVersions)
        api.fail('put', '/config-editor/ui/plugins/hide-updates-for', new Error('read only'))
      })
      vi.useFakeTimers()
      fireEvent.click(screen.getByRole('radio', { name: 'plugins.manage.notifications_none' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      // Otherwise the radio claims a setting the config never received
      expect(checked()).toBe('all')
      expect(toast.error).toHaveBeenCalledTimes(1)
      expect(onRefreshPluginList).not.toHaveBeenCalled()
    })
  })
})
