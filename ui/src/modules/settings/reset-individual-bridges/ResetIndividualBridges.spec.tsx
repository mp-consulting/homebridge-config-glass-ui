import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi, FakeToast } from '@/testing'

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { accessoryOverviewCache } from '@/core/caching'
import { resetSettingsStore, useSettingsStore } from '@/core/settings'
import * as toastModule from '@/core/ui/toast'
import { ResetIndividualBridges } from '@/modules/settings/reset-individual-bridges/ResetIndividualBridges'
import { splitPairings } from '@/modules/settings/reset-individual-bridges/split-pairings'
import { activeModalStub, fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const toast = (toastModule as unknown as { toast: FakeToast }).toast

/**
 * "Unpair a bridge" — the modal that deletes pairing information.
 *
 * ⚠️ **This is destructive and cannot be undone.** Deleting a pairing makes every
 * accessory on that bridge disappear from the Home app, along with the rooms and
 * automations they were in. So the list the user ticks has to be exactly what
 * gets sent, and nothing else.
 *
 * ⚠️ **The bridges are sorted into three lists** — child bridges that are running,
 * bridges that look stale, and everything else. A stale bridge shown as active
 * invites the user to unpair a bridge they still use.
 */
describe('the reset individual bridges modal', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>
  let invalidate: ReturnType<typeof vi.spyOn>

  function pairing(overrides: Record<string, any> = {}) {
    return {
      _id: 'ABC123',
      _username: '0E:11:22:33:44:55',
      name: 'Kitchen Bridge',
      _main: false,
      _category: 'bridge',
      _couldBeStale: false,
      ...overrides,
    }
  }

  async function open(options: { pairings?: any[], matter?: boolean } = {}) {
    useSettingsStore.setState(makeSettingsState({ env: { featureFlags: { matterSupport: options.matter ?? false } } }))
    vi.spyOn(accessoryOverviewCache, 'get').mockResolvedValue({ pairings: options.pairings ?? [pairing()], hapAccessories: [], matterAccessories: [] })
    const result = renderWithProviders(<ResetIndividualBridges activeModal={activeModal as unknown as ActiveModal} />, {
      route: '/settings',
      routes: [{ path: '/restart', element: <div data-testid="restart" /> }],
    })
    await waitFor(() => expect(accessoryOverviewCache.get).toHaveBeenCalled())
    await Promise.resolve()
    return result
  }

  const unpair = (name: string) => screen.getByText(name).closest('li')!.querySelector('button')!
  const resetButton = () => document.querySelector<HTMLButtonElement>('.modal-footer .btn-danger')!

  async function removeBridges() {
    fireEvent.click(resetButton())
    await waitFor(() => expect(activeModal.close.mock.calls.length + toast.at('error').length).toBeGreaterThan(0))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    toast.shown.length = 0
    resetSettingsStore()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api = fakeApi()
    activeModal = activeModalStub()
    invalidate = vi.spyOn(accessoryOverviewCache, 'invalidate').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('the bridges it lists', () => {
    it('lists a running child bridge as active', () => {
      const lists = splitPairings([pairing({ name: 'Kitchen Bridge' })])

      expect(lists.pairingsChildActive.map(p => p.name)).toEqual(['Kitchen Bridge'])
      expect(lists.pairingsChildStale).toEqual([])
    })

    it('lists a bridge that may be stale separately', () => {
      // Its plugin has gone, so unpairing it is usually what the user wants
      const lists = splitPairings([pairing({ _couldBeStale: true })])

      expect(lists.pairingsChildStale).toHaveLength(1)
      expect(lists.pairingsChildActive).toEqual([])
    })

    it('lists anything that is not a child bridge on its own', () => {
      const lists = splitPairings([pairing({ _category: 'external', name: 'A Camera' })])

      expect(lists.pairingsNonChild.map(p => p.name)).toEqual(['A Camera'])
      expect(lists.pairingsChildActive).toEqual([])
    })

    it('never offers the main bridge', () => {
      // Unpairing that is what the other modal does, and it takes everything with it
      const lists = splitPairings([pairing({ _main: true, name: 'Homebridge' }), pairing()])

      const listed = [...lists.pairingsChildActive, ...lists.pairingsNonChild, ...lists.pairingsChildStale]
      expect(listed.map(p => p.name)).toEqual(['Kitchen Bridge'])
    })

    it('sorts them by name', () => {
      const lists = splitPairings([pairing({ name: 'Zebra Bridge' }), pairing({ name: 'Apple Bridge' })])

      expect(lists.pairingsChildActive.map(p => p.name)).toEqual(['Apple Bridge', 'Zebra Bridge'])
    })

    it('shows the three lists under their own headings', async () => {
      await open({
        pairings: [pairing({ _id: 'A', name: 'Active' }), pairing({ _id: 'S', name: 'Stale', _couldBeStale: true }), pairing({ _id: 'C', name: 'Doorbell', _category: 'camera' })],
      })

      expect(screen.getByText('reset.bridge_ind.head_non_child')).toBeInTheDocument()
      expect(screen.getByText('reset.bridge_ind.head_child_active')).toBeInTheDocument()
      expect(screen.getByText('reset.bridge_ind.head_child_stale')).toBeInTheDocument()
      // The category title-cased, as the titlecase pipe did
      expect(screen.getByText('Doorbell').closest('li')!.textContent).toContain('Camera')
      expect(unpair('Stale').querySelector('i')).toHaveClass('fa-trash')
      expect(unpair('Active').querySelector('i')).toHaveClass('fa-refresh')
    })

    it('says there is nothing to unpair when there is nothing', async () => {
      await open({ pairings: [] })

      expect(screen.getByText('reset.bridges.empty')).toBeInTheDocument()
      expect(resetButton()).toBeNull()
    })

    it('closes itself when the list cannot be read', async () => {
      // An empty modal would look like "no bridges to unpair"
      vi.spyOn(accessoryOverviewCache, 'get').mockRejectedValue(new Error('server unavailable'))
      renderWithProviders(<ResetIndividualBridges activeModal={activeModal as unknown as ActiveModal} />)

      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
      expect(toast.at('error')).toHaveLength(1)
    })

    it('shows the matter icon only with matter support', async () => {
      const { container, unmount } = await open({ matter: true, pairings: [pairing({ _matter: false })] })
      expect(container.querySelector('.fa-matter.opacity-muted')).not.toBeNull()
      unmount()

      const second = await open({ matter: false })
      expect(second.container.querySelector('.fa-matter')).toBeNull()
    })
  })

  describe('choosing what to unpair', () => {
    it('adds a bridge to the list when ticked, and takes it off again', async () => {
      await open()

      fireEvent.click(unpair('Kitchen Bridge'))
      expect(unpair('Kitchen Bridge')).toHaveClass('btn-elegant')
      expect(resetButton().textContent).toBe('form.button_reset (1)')

      fireEvent.click(unpair('Kitchen Bridge'))
      expect(unpair('Kitchen Bridge')).toHaveClass('btn-danger')
      expect(resetButton()).toBeDisabled()
    })

    it('says nothing is ticked to begin with', async () => {
      await open()

      expect(resetButton()).toBeDisabled()
      expect(resetButton().textContent).toBe('form.button_reset')
    })
  })

  describe('unpairing them', () => {
    it('sends exactly what the user ticked', async () => {
      // ⚠️ The one assertion that matters most: an extra id here unpairs a bridge
      // the user did not choose
      await open({ pairings: [pairing(), pairing({ _id: 'DEF456', name: 'Hall Bridge' })] })
      fireEvent.click(unpair('Kitchen Bridge'))

      await removeBridges()

      expect(api.lastCall('delete', '/server/pairings')?.options).toEqual({ body: [{ id: 'ABC123', resetPairingInfo: true }] })
    })

    it('resets the pairing information of a stale bridge too, rather than rebuilding it', async () => {
      await open({ pairings: [pairing({ _couldBeStale: true })] })
      fireEvent.click(unpair('Kitchen Bridge'))

      await removeBridges()

      expect(api.lastCall('delete', '/server/pairings')?.options?.body).toEqual([{ id: 'ABC123', resetPairingInfo: false }])
    })

    it('forgets the cached accessory overview and sends the user to restart', async () => {
      const { router } = await open()
      fireEvent.click(unpair('Kitchen Bridge'))

      await removeBridges()

      expect(invalidate).toHaveBeenCalled()
      expect(activeModal.close).toHaveBeenCalled()
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/restart?restarting=true')
      expect(toast.at('success')).toHaveLength(1)
    })

    it('re-enables the button when it fails, and keeps the cache', async () => {
      // ⚠️ Otherwise the user is left on a modal they cannot retry from
      api.fail('delete', '/server/pairings', new Error('server unavailable'))
      await open()
      fireEvent.click(unpair('Kitchen Bridge'))

      await removeBridges()

      expect(resetButton()).toBeEnabled()
      expect(activeModal.close).not.toHaveBeenCalled()
      expect(toast.at('error')).toHaveLength(1)
      expect(invalidate).not.toHaveBeenCalled()
    })
  })

  it('closes without unpairing anything when dismissed', async () => {
    await open()
    fireEvent.click(unpair('Kitchen Bridge'))

    fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[1])

    expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    expect(api.callsTo('delete')).toEqual([])
  })
})
