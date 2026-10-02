import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi, FakeToast } from '@/testing'
import type { ReactElement } from 'react'

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { accessoryOverviewCache, ttlCache } from '@/core/caching'
import { resetSettingsStore, useSettingsStore } from '@/core/settings'
import * as toastModule from '@/core/ui/toast'
import { RemoveAllAccessories } from '@/modules/settings/remove-all-accessories/RemoveAllAccessories'
import { RemoveBridgeAccessories } from '@/modules/settings/remove-bridge-accessories/RemoveBridgeAccessories'
import { RemoveIndividualAccessories } from '@/modules/settings/remove-individual-accessories/RemoveIndividualAccessories'
import { ResetAllBridges } from '@/modules/settings/reset-all-bridges/ResetAllBridges'
import { ResetIndividualBridges } from '@/modules/settings/reset-individual-bridges/ResetIndividualBridges'
import { activeModalStub, fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const toast = (toastModule as unknown as { toast: FakeToast }).toast

/**
 * The five modals that throw away pairings or cached accessories. None of it
 * can be undone from the UI - the user re-pairs everything in the Home app -
 * so what matters is that each button reaches exactly the endpoint it claims,
 * with exactly the payload the server expects.
 *
 * These specs are deliberately literal about urls and bodies.
 */
describe('destructive accessory and bridge modals', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>
  let invalidate: ReturnType<typeof vi.spyOn>
  let invalidateAll: ReturnType<typeof vi.spyOn>
  let getOverview: ReturnType<typeof vi.spyOn>

  const pairings = [
    { _id: 'main-bridge', _username: '0E:AA:AA:AA:AA:AA', _main: true, _category: 'bridge', name: 'Homebridge' },
    { _id: 'hue-bridge', _username: '0E:BB:BB:BB:BB:BB', _main: false, _category: 'bridge', name: 'Hue', _matter: true },
    { _id: 'ring-bridge', _username: '0E:CC:CC:CC:CC:CC', _main: false, _category: 'bridge', name: 'Ring', _couldBeStale: true },
    { _id: 'camera', _username: '0E:DD:DD:DD:DD:DD', _main: false, _category: 'camera', name: 'Doorbell' },
  ]

  const hapAccessories = [
    { UUID: 'uuid-1', displayName: 'Lamp', $cacheFile: 'cachedAccessories.hue-bridge', services: [] },
  ]

  const matterAccessories = [
    { uuid: 'uuid-2', displayName: 'Plug', $deviceId: 'device-2', services: [] },
  ]

  function configure(matterSupport = true) {
    useSettingsStore.setState(makeSettingsState({ env: { featureFlags: { matterSupport } } }))
  }

  /**
   * Render a modal on /settings, with /restart beside it to navigate to.
   * @param modal - the modal element
   */
  function open(modal: ReactElement) {
    return renderWithProviders(modal, {
      route: '/settings',
      routes: [{ path: '/restart', element: <div data-testid="restart" /> }],
    })
  }

  const location = (router: ReturnType<typeof open>['router']) => `${router.state.location.pathname}${router.state.location.search}`
  const asActiveModal = () => activeModal as unknown as ActiveModal

  beforeEach(() => {
    vi.clearAllMocks()
    toast.shown.length = 0
    resetSettingsStore()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api = fakeApi()
    activeModal = activeModalStub()
    getOverview = vi.spyOn(accessoryOverviewCache, 'get').mockResolvedValue({ hapAccessories, matterAccessories, pairings } as any)
    invalidate = vi.spyOn(accessoryOverviewCache, 'invalidate').mockImplementation(() => {})
    invalidateAll = vi.spyOn(ttlCache, 'invalidateAll').mockImplementation(() => {})
    configure()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('removing every cached accessory', () => {
    async function openModal() {
      const result = open(<RemoveAllAccessories activeModal={asActiveModal()} />)
      await screen.findByRole('button', { name: 'form.button_remove' })
      return result
    }

    it('asks the server to reset the whole cache', async () => {
      await openModal()

      fireEvent.click(screen.getByRole('button', { name: 'form.button_remove' }))
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(api.lastCall('put', '/server/reset-cached-accessories')?.body).toEqual({})
    })

    it('clears the cached view and sends the user to restart', async () => {
      const { router } = await openModal()

      fireEvent.click(screen.getByRole('button', { name: 'form.button_remove' }))
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(invalidate).toHaveBeenCalled()
      expect(location(router)).toBe('/restart?restarting=true')
    })

    it('lets the user try again when it fails', async () => {
      api.fail('put', '/server/reset-cached-accessories', new Error('offline'))
      const { router } = await openModal()

      fireEvent.click(screen.getByRole('button', { name: 'form.button_remove' }))
      await waitFor(() => expect(toast.at('error')).toHaveLength(1))

      expect(screen.getByRole('button', { name: 'form.button_remove' })).toBeEnabled()
      expect(location(router)).toBe('/settings')
    })

    it('says there is nothing to remove when the cache is empty', async () => {
      getOverview.mockResolvedValue({ hapAccessories: [], matterAccessories: [], pairings })
      open(<RemoveAllAccessories activeModal={asActiveModal()} />)

      expect(await screen.findByText('reset.no_accessories')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'form.button_remove' })).toBeNull()
    })

    it('shows the irreversible warning as an error alert', async () => {
      const { container } = await openModal()

      expect(container.querySelector('.alert.alert-error[role="alert"]')).not.toBeNull()
    })

    it('closes itself when the cache cannot be read', async () => {
      getOverview.mockRejectedValue(new Error('offline'))
      open(<RemoveAllAccessories activeModal={asActiveModal()} />)

      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
      expect(toast.at('error')).toHaveLength(1)
    })
  })

  describe('removing the accessories of chosen bridges', () => {
    async function openModal() {
      const result = open(<RemoveBridgeAccessories activeModal={asActiveModal()} />)
      await screen.findAllByText('Hue')
      return result
    }

    /** The broom button of one row: hue's hap row is first, its matter row second. */
    const rowButton = (index: number) => screen.getAllByRole('button', { name: 'form.button_delete' })[index]
    const removeButton = () => document.querySelector<HTMLButtonElement>('.modal-footer .btn-danger')!

    it('sends the chosen bridges as the request body', async () => {
      await openModal()
      fireEvent.click(rowButton(0))

      fireEvent.click(removeButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      // A delete with a body is unusual enough that a refactor could drop it
      expect(api.lastCall('delete', '/server/pairings/accessories')?.options).toEqual({
        body: [{ id: 'hue-bridge', protocol: 'hap' }],
      })
    })

    it('forgets the cached overview and sends the user to restart', async () => {
      const { router } = await openModal()
      fireEvent.click(rowButton(0))

      fireEvent.click(removeButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(invalidate).toHaveBeenCalled()
      expect(location(router)).toBe('/restart?restarting=true')
    })

    it('lets the user try again when the removal fails', async () => {
      api.fail('delete', '/server/pairings/accessories', new Error('server unavailable'))
      await openModal()
      fireEvent.click(rowButton(0))

      fireEvent.click(removeButton())
      await waitFor(() => expect(toast.at('error')).toHaveLength(1))

      // ⚠️ Re-enabled, or the modal is stuck with a button that does nothing
      expect(removeButton()).toBeEnabled()
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('closes itself when the bridge list cannot be read', async () => {
      getOverview.mockRejectedValue(new Error('server unavailable'))
      open(<RemoveBridgeAccessories activeModal={asActiveModal()} />)

      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
      expect(toast.at('error')).toHaveLength(1)
    })

    it('offers a matter row only for a bridge that has matter', async () => {
      const { container } = await openModal()

      const rows = [...container.querySelectorAll('.list-group-box li')].map(row => `${row.querySelector('.flex-grow-1')!.firstChild!.textContent}:${row.querySelector('.fa-matter') ? 'matter' : 'hap'}`)
      expect(rows).toEqual(['Hue:hap', 'Hue:matter', 'Ring:hap'])
    })

    it('offers no matter rows at all while matter is off', async () => {
      configure(false)
      const { container } = await openModal()

      expect(container.querySelectorAll('.list-group-box .fa-matter')).toHaveLength(0)
    })

    it('treats the two protocols on one bridge separately', async () => {
      await openModal()

      fireEvent.click(rowButton(0))
      fireEvent.click(rowButton(1))
      fireEvent.click(rowButton(0))

      // Un-ticking the hap row must not take the matter row with it
      expect(removeButton().textContent).toBe('form.button_remove (1)')
      fireEvent.click(removeButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
      expect(api.lastCall('delete', '/server/pairings/accessories')?.options?.body).toEqual([{ id: 'hue-bridge', protocol: 'matter' }])
    })

    it('keeps the remove button off until something is ticked', async () => {
      await openModal()

      expect(removeButton()).toBeDisabled()
      fireEvent.click(rowButton(0))
      expect(removeButton()).toBeEnabled()
      expect(rowButton(0)).toHaveClass('btn-elegant')
    })
  })

  describe('removing individual accessories', () => {
    async function openModal(selectedBridge = 'hue-bridge') {
      const result = open(<RemoveIndividualAccessories activeModal={asActiveModal()} selectedBridge={selectedBridge} />)
      await screen.findByText('Lamp')
      return result
    }

    const removeButton = () => document.querySelector<HTMLButtonElement>('.modal-footer .btn-danger')!

    it('sends hap accessories with their cache file', async () => {
      await openModal()
      fireEvent.click(screen.getByRole('button', { name: 'form.button_delete' }))

      fireEvent.click(removeButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(api.lastCall('delete', '/server/cached-accessories')?.options).toEqual({
        body: [{ uuid: 'uuid-1', cacheFile: 'cachedAccessories.hue-bridge' }],
      })
    })

    it('sends matter accessories with their device id instead', async () => {
      // The two protocols use different endpoints and different payload shapes
      open(<RemoveIndividualAccessories activeModal={asActiveModal()} selectedBridge="device-2" />)
      await screen.findByText('Plug')
      fireEvent.click(screen.getByRole('button', { name: 'form.button_delete' }))

      fireEvent.click(removeButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(api.lastCall('delete', '/server/matter-accessories')?.options).toEqual({
        body: [{ uuid: 'uuid-2', deviceId: 'device-2' }],
      })
      expect(api.callsTo('delete', '/server/cached-accessories')).toHaveLength(0)
    })

    it('sends both when the selection mixes protocols', async () => {
      open(<RemoveIndividualAccessories activeModal={asActiveModal()} selectedBridge="" />)
      await screen.findByText('Lamp')
      // Picked one from each bridge: the choice is kept while switching
      fireEvent.click(screen.getByRole('button', { name: 'form.button_delete' }))
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'device-2' } })
      fireEvent.click(await screen.findByRole('button', { name: 'form.button_delete' }))

      fireEvent.click(removeButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(api.callsTo('delete', '/server/cached-accessories')).toHaveLength(1)
      expect(api.callsTo('delete', '/server/matter-accessories')).toHaveLength(1)
    })

    it('does nothing at all when nothing is selected', async () => {
      const { router } = await openModal()

      // The button is off, and even pressed it sends nothing
      expect(removeButton()).toBeDisabled()
      removeButton().disabled = false
      fireEvent.click(removeButton())

      expect(api.callsTo('delete')).toHaveLength(0)
      expect(location(router)).toBe('/settings')
    })

    it('sends the user to restart afterwards', async () => {
      const { router } = await openModal()
      fireEvent.click(screen.getByRole('button', { name: 'form.button_delete' }))

      fireEvent.click(removeButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(invalidate).toHaveBeenCalled()
      expect(location(router)).toBe('/restart?restarting=true')
    })
  })

  describe('resetting individual bridges', () => {
    async function openModal() {
      const result = open(<ResetIndividualBridges activeModal={asActiveModal()} />)
      await screen.findByText('Hue')
      return result
    }

    /** The unpair button in the row naming `name`. */
    const unpair = (name: string) => screen.getByText(name).closest('li')!.querySelector('button')!
    const resetButton = () => document.querySelector<HTMLButtonElement>('.modal-footer .btn-danger')!

    it('sends the chosen bridges as the request body', async () => {
      await openModal()
      fireEvent.click(unpair('Hue'))

      fireEvent.click(resetButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(api.lastCall('delete', '/server/pairings')?.options).toEqual({
        body: [{ id: 'hue-bridge', resetPairingInfo: true }],
      })
    })

    it('remembers whether each bridge should have its pairing info rebuilt', async () => {
      // Active child bridges are rebuilt; stale ones and external accessories
      // are only removed, and the server decides based on this flag
      await openModal()
      fireEvent.click(unpair('Hue'))
      fireEvent.click(unpair('Doorbell'))

      fireEvent.click(resetButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(api.lastCall('delete', '/server/pairings')?.options?.body).toEqual([
        { id: 'hue-bridge', resetPairingInfo: true },
        { id: 'camera', resetPairingInfo: false },
      ])
    })

    it('sends the user to restart afterwards', async () => {
      const { router } = await openModal()
      fireEvent.click(unpair('Hue'))

      fireEvent.click(resetButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(invalidate).toHaveBeenCalled()
      expect(location(router)).toBe('/restart?restarting=true')
    })
  })

  describe('resetting every bridge', () => {
    function openModal() {
      return open(<ResetAllBridges activeModal={asActiveModal()} />)
    }

    const toConfirm = () => fireEvent.click(screen.getByRole('button', { name: 'form.button_continue' }))
    const reset = () => fireEvent.click(screen.getByRole('button', { name: 'form.button_reset' }))

    it('hides the reset button until the warning has been read', () => {
      // This one unpairs everything, so it is the only modal with a second step
      openModal()

      expect(screen.queryByRole('button', { name: 'form.button_reset' })).toBeNull()
      toConfirm()
      expect(screen.getByRole('button', { name: 'form.button_reset' })).toBeInTheDocument()
      expect(screen.getByText('reset.action_is_irreversible')).toBeInTheDocument()
    })

    it('goes back from the confirm step', () => {
      openModal()
      toConfirm()

      fireEvent.click(document.querySelector('.fa-undo')!.closest('button')!)

      expect(screen.queryByRole('button', { name: 'form.button_reset' })).toBeNull()
    })

    it('asks the server to reset the homebridge identity', async () => {
      openModal()
      toConfirm()

      reset()
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(api.lastCall('put', '/server/reset-homebridge-accessory')?.body).toEqual({})
    })

    it('clears every cache, not just the accessory one', async () => {
      openModal()
      toConfirm()

      reset()
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(invalidateAll).toHaveBeenCalled()
    })

    it('sends the user to restart without the restarting flag', async () => {
      // Unlike its siblings this one has not started the restart itself
      const { router } = openModal()
      toConfirm()

      reset()
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(location(router)).toBe('/restart')
    })

    it('lets the user try again when it fails', async () => {
      api.fail('put', '/server/reset-homebridge-accessory', new Error('offline'))
      const { router } = openModal()
      toConfirm()

      reset()
      await waitFor(() => expect(toast.at('error')).toHaveLength(1))

      expect(screen.getByRole('button', { name: 'form.button_reset' })).toBeEnabled()
      expect(location(router)).toBe('/settings')
    })
  })
})
