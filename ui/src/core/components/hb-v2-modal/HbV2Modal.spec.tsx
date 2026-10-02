import type { FakeCache, FakeIoNamespace, FakeWs } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { pluginsCache as realPluginsCache } from '@/core/caching/plugins-cache'
import { assessHbV2Readiness, DEFAULT_ICON } from '@/core/components/hb-v2-modal/hb-v2-readiness'
import { HbV2Modal } from '@/core/components/hb-v2-modal/HbV2Modal'
import { useSettingsStore } from '@/core/settings'
import { toast } from '@/core/ui/toast'
import { ws as realWs } from '@/core/ws'
import { activeModalStub, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
vi.mock('@/core/caching/plugins-cache', async () => ({ pluginsCache: (await import('@/testing')).cacheStub<any[]>([]) }))

const ws = realWs as unknown as FakeWs
const pluginsCache = realPluginsCache as unknown as FakeCache<any[]>

/**
 * The "ready for Homebridge v2?" modal: it lists every installed plugin and says
 * whether that plugin has declared it works with v2.
 *
 * ⚠️ **Whether a plugin supports v2 is a semver question, not a string one.** A
 * plugin declares `engines.homebridge` as a range, and the ranges that cover v2
 * look nothing alike — `^2.0.0`, `2.x`, `>=2.0.0`, `^1.8.0 || ^2.0.0`.
 *
 * ⚠️ **The verdict decides whether the update goes ahead unattended.** With
 * `skipIfCompatible` the modal closes itself and lets the update run when every
 * plugin is ready, so a wrong "supported" here means updating into a broken setup.
 */
describe('hbV2Modal', () => {
  let io: FakeIoNamespace
  let activeModal: ReturnType<typeof activeModalStub>

  function installed(name: string, engines?: string) {
    return { name, displayName: name, engines: engines === undefined ? undefined : { homebridge: engines } }
  }

  async function open(options: {
    plugins?: any[]
    homebridgeVersion?: string
    nodeVersion?: string
    skipIfCompatible?: boolean
    isUpdating?: boolean
    connected?: boolean
  } = {}) {
    activeModal = activeModalStub()
    pluginsCache.setValue(options.plugins ?? [])
    useSettingsStore.setState(makeSettingsState({ env: { homebridgeVersion: options.homebridgeVersion ?? '1.8.0' } }))
    io = ws.namespace('status', { connected: options.connected ?? true })
    io.socket.respondTo('get-homebridge-server-info', { nodeVersion: options.nodeVersion ?? '22.0.0' })

    const view = renderWithProviders(
      <HbV2Modal activeModal={activeModal as any} isUpdating={options.isUpdating ?? false} skipIfCompatible={options.skipIfCompatible ?? false} />,
    )
    await settle()
    return view
  }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 15; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  beforeEach(() => {
    ws.namespaces.clear()
    pluginsCache.get.mockClear()
    pluginsCache.setValue([])
    vi.mocked(toast.error).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
  })

  describe('reading each plugin declared support', () => {
    const verdictFor = (engines?: string, homebridgeVersion = '1.8.0') =>
      assessHbV2Readiness([installed('homebridge-example', engines)], homebridgeVersion).installedPlugins[0].hb2Ready

    it.each([
      ['a caret range on v2', '^2.0.0'],
      ['an x range', '2.x'],
      ['a bare major', '2'],
      ['a minimum version', '>=2.0.0'],
      ['a range spanning both majors', '^1.8.0 || ^2.0.0'],
      ['a range starting mid-v1', '>=1.6.0'],
      ['anything at all', '*'],
    ])('counts %s as supported', (_label, engines) => {
      expect(verdictFor(engines)).toBe('supported')
    })

    it.each([
      ['a v1-only caret range', '^1.8.0'],
      ['a v1 x range', '1.x'],
      ['an upper bound below v2', '<2.0.0'],
    ])('cannot vouch for %s', (_label, engines) => {
      expect(verdictFor(engines)).toBe('unknown')
    })

    it('cannot vouch for a plugin that declares nothing', () => {
      expect(verdictFor(undefined)).toBe('unknown')
    })

    it('cannot vouch for a plugin whose range makes no sense', () => {
      expect(verdictFor('not-a-range')).toBe('unknown')
    })

    it('says nothing either way once v2 is already running', () => {
      expect(verdictFor('^1.8.0', '2.0.0')).toBe('hide')
    })

    it('never asks about the ui itself', () => {
      const { installedPlugins } = assessHbV2Readiness([installed('@mp-consulting/homebridge-config-glass-ui', '^1.8.0'), installed('homebridge-example', '^2.0.0')], '1.8.0')

      expect(installedPlugins.map(p => p.name)).toEqual(['homebridge-example'])
    })

    it('lists the plugins in name order', async () => {
      await open({ plugins: [installed('homebridge-zebra', '^2.0.0'), installed('homebridge-apple', '^2.0.0')] })

      const names = screen.getAllByRole('listitem').slice(1).map(li => li.textContent)
      expect(names).toEqual(['homebridge-apple', 'homebridge-zebra'])
    })
  })

  describe('the overall verdict', () => {
    it('says everything is ready when every plugin declares v2', async () => {
      await open({ plugins: [installed('homebridge-a', '^2.0.0'), installed('homebridge-b', '2.x')] })

      expect(screen.getByText('All your plugins are marked as compatible with Homebridge v2.')).toBeInTheDocument()
    })

    it('says it is not ready when one plugin does not', async () => {
      await open({ plugins: [installed('homebridge-a', '^2.0.0'), installed('homebridge-b', '^1.8.0')] })

      expect(screen.queryByText('All your plugins are marked as compatible with Homebridge v2.')).toBeNull()
      expect(screen.getByRole('link', { name: 'wiki page' })).toBeInTheDocument()
    })

    it('says a box with no plugins is ready', () => {
      expect(assessHbV2Readiness([], '1.8.0').allPluginsSupported).toBe(true)
    })

    it('tells an updating user how to go on anyway', async () => {
      await open({ plugins: [installed('homebridge-b', '^1.8.0')], isUpdating: true })

      expect(screen.getByText('To ignore this warning and continue with the update, click continue below.')).toBeInTheDocument()
    })
  })

  describe('getting on with the update by itself', () => {
    it('closes and asks for the update when everything is ready', async () => {
      await open({ plugins: [installed('homebridge-a', '^2.0.0')], skipIfCompatible: true })

      expect(activeModal.close).toHaveBeenCalledWith('update')
    })

    it('closes on a box with no plugins at all', async () => {
      await open({ plugins: [], skipIfCompatible: true })

      expect(activeModal.close).toHaveBeenCalledWith('update')
    })

    it('stays open when a plugin cannot be vouched for', async () => {
      await open({ plugins: [installed('homebridge-a', '^1.8.0')], skipIfCompatible: true })

      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('stays open when it was not asked to skip', async () => {
      await open({ plugins: [installed('homebridge-a', '^2.0.0')], skipIfCompatible: false })

      expect(activeModal.close).not.toHaveBeenCalled()
    })
  })

  describe('whether node is ready too', () => {
    it('is ready on node 22', async () => {
      await open({ nodeVersion: '22.14.0' })

      expect(screen.getByText('status.readiness.node_yes')).toBeInTheDocument()
    })

    it('is ready on anything newer', async () => {
      await open({ nodeVersion: '24.0.0' })

      expect(screen.getByText('status.readiness.node_yes')).toBeInTheDocument()
    })

    it('is not ready on node 20', async () => {
      await open({ nodeVersion: '20.11.0' })

      expect(screen.getByText('status.readiness.node_no')).toBeInTheDocument()
    })

    it('says nothing while the socket is down', async () => {
      await open({ connected: false, plugins: [installed('homebridge-a', '^2.0.0')] })

      expect(io.requests).toHaveLength(0)
      expect(screen.getByText('status.readiness.node_no')).toBeInTheDocument()
      expect(screen.getByText('homebridge-a')).toBeInTheDocument()
    })

    it('says so when the server cannot be asked', async () => {
      ws.namespace('status').socket.respondTo('get-homebridge-server-info', { error: 'socket error' })
      activeModal = activeModalStub()
      renderWithProviders(<HbV2Modal activeModal={activeModal as any} isUpdating={false} skipIfCompatible={false} />)
      await settle()

      expect(toast.error).toHaveBeenCalled()
      expect(console.error).toHaveBeenCalled()
    })
  })

  describe('while it is loading', () => {
    it('starts out loading, with continue switched off', () => {
      pluginsCache.get.mockImplementationOnce(() => new Promise(() => {}))
      ws.namespace('status', { connected: false })
      const { container } = renderWithProviders(<HbV2Modal activeModal={activeModalStub() as any} isUpdating skipIfCompatible={false} />)

      expect(container.querySelector('.fa-circle-notch')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'form.button_continue' })).toBeDisabled()
    })

    it('stops once the list is in', async () => {
      const { container } = await open({ plugins: [installed('homebridge-a', '^2.0.0')] })

      expect(container.querySelector('.fa-circle-notch')).toBeNull()
    })

    it('stops even when the list could not be read', async () => {
      pluginsCache.get.mockRejectedValueOnce(new Error('server unavailable'))
      ws.namespace('status', { connected: false })
      const { container } = renderWithProviders(<HbV2Modal activeModal={activeModalStub() as any} isUpdating={false} skipIfCompatible={false} />)
      await settle()

      expect(toast.error).toHaveBeenCalledWith('plugins.toast_failed_to_load_plugins', 'toast.title_error')
      expect(container.querySelector('.fa-circle-notch')).toBeNull()
      expect(screen.getAllByRole('listitem')).toHaveLength(1)
    })
  })

  describe('the rest of the modal', () => {
    it('falls back to the homebridge icon for a plugin with none', async () => {
      const { container } = await open({ plugins: [{ ...installed('homebridge-a', '^2.0.0'), icon: 'broken.png' }] })
      const img = container.querySelector('img.plugin-icon-small')!

      fireEvent.error(img)

      expect(img.getAttribute('src')).toBe(DEFAULT_ICON)
    })

    it('passes on the reason it was closed with', async () => {
      await open({ isUpdating: true })

      fireEvent.click(screen.getByRole('button', { name: 'form.button_continue' }))
      expect(activeModal.close).toHaveBeenCalledWith('update')

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[0])
      expect(activeModal.close).toHaveBeenCalledWith('Dismiss')
    })
  })
})
