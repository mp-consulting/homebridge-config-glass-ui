import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi, FakeToast } from '@/testing'

import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { accessoryOverviewCache } from '@/core/caching'
import { resetSettingsStore, useSettingsStore } from '@/core/settings'
import * as toastModule from '@/core/ui/toast'
import { groupAccessories, splitDeletions } from '@/modules/settings/remove-individual-accessories/group-accessories'
import { RemoveIndividualAccessories } from '@/modules/settings/remove-individual-accessories/RemoveIndividualAccessories'
import { activeModalStub, fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const toast = (toastModule as unknown as { toast: FakeToast }).toast

/**
 * "Remove single cached accessories" — the modal that deletes accessories from
 * the cache on disk.
 *
 * ⚠️ **Deleting the wrong entry cannot be undone.** So the identity of each entry
 * has to be exact: HAP accessories are identified by uuid **and** cache file,
 * because the same uuid can appear under several bridges, and matter accessories
 * by uuid and device id instead.
 *
 * ⚠️ **HAP and matter go to different endpoints.** Sending a matter accessory to
 * the HAP endpoint deletes nothing and reports success.
 */
describe('the remove individual accessories modal', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>
  let invalidate: ReturnType<typeof vi.spyOn>

  function hap(name: string, cacheFile = 'cachedAccessories', uuid = `uuid-${name}`) {
    return { displayName: name, UUID: uuid, $cacheFile: cacheFile }
  }

  function matter(name: string, deviceId = 'matter-device-1', uuid = `uuid-${name}`) {
    return { displayName: name, UUID: uuid, $deviceId: deviceId }
  }

  function pairing(overrides: Record<string, any> = {}) {
    return { _id: 'ABC123', _username: '0E:11:22:33:44:55', name: 'Kitchen Bridge', _main: false, ...overrides }
  }

  interface Options {
    hapAccessories?: any[]
    matterAccessories?: any[]
    pairings?: any[]
    selectedBridge?: string
    highlightUuid?: string
    highlightCacheFile?: string
    matterSupported?: boolean
  }

  function overviewOf(options: Options) {
    return {
      hapAccessories: options.hapAccessories ?? [hap('Kitchen Light', 'cachedAccessories', 'uuid-1')],
      matterAccessories: options.matterAccessories ?? [matter('Matter Lamp', 'matter-device-1', 'uuid-2')],
      pairings: options.pairings ?? [pairing({ _main: true, _id: 'MAIN00', name: 'Homebridge' })],
    }
  }

  /** What the modal lists for a set-up, without rendering it. */
  function grouped(options: Options) {
    return groupAccessories(overviewOf(options) as any, options.selectedBridge ?? '', options.matterSupported ?? true)
  }

  async function open(options: Options = {}) {
    useSettingsStore.setState(makeSettingsState({ env: { featureFlags: { matterSupport: options.matterSupported ?? true } } }))
    vi.spyOn(accessoryOverviewCache, 'get').mockResolvedValue(overviewOf(options) as any)
    const result = renderWithProviders(
      <RemoveIndividualAccessories
        activeModal={activeModal as unknown as ActiveModal}
        selectedBridge={options.selectedBridge ?? ''}
        highlightUuid={options.highlightUuid}
        highlightCacheFile={options.highlightCacheFile}
      />,
      { route: '/settings', routes: [{ path: '/restart', element: <div data-testid="restart" /> }] },
    )
    await act(async () => {
      for (let tick = 0; tick < 5; tick += 1) {
        await Promise.resolve()
      }
    })
    return result
  }

  /** The delete toggle in the row showing `name`. */
  const toggle = (name: string) => screen.getByText(name).closest('li')!.querySelector('button')!
  const removeButton = () => document.querySelector<HTMLButtonElement>('.modal-footer .btn-danger')!

  async function remove() {
    fireEvent.click(removeButton())
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
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('the accessories it lists', () => {
    it('groups them under the bridge they belong to', () => {
      const pairings = grouped({
        hapAccessories: [hap('Kitchen Light', 'cachedAccessories.ABC123')],
        matterAccessories: [],
        pairings: [pairing({ _id: 'ABC123', name: 'Kitchen Bridge' })],
      })

      expect(pairings.map(p => p.name)).toEqual(['Kitchen Bridge'])
      expect(pairings[0].accessories.map(a => a.displayName)).toEqual(['Kitchen Light'])
    })

    it('puts an accessory with no bridge in the file name under the main bridge', () => {
      // `cachedAccessories` with no suffix is the main bridge's own file
      const pairings = grouped({
        hapAccessories: [hap('Kitchen Light', 'cachedAccessories')],
        matterAccessories: [],
        pairings: [pairing({ _id: 'MAIN00', name: 'Homebridge', _main: true })],
      })

      expect(pairings[0].name).toBe('Homebridge')
    })

    it('invents a bridge entry for a cache file with no pairing left', () => {
      // The pairing was deleted but its cache file is still on disk
      const pairings = grouped({
        hapAccessories: [hap('Orphan', 'cachedAccessories.0E1122334455')],
        matterAccessories: [],
        pairings: [pairing({ _id: 'MAIN00', _main: true })],
      })

      const orphan = pairings.find(p => p._id === '0E1122334455')
      expect(orphan?.name).toBe('reset.accessory_ind.unknown')
      expect(orphan?._username).toBe('0E:11:22:33:44:55')
    })

    it('lists the accessories of each bridge in name order', () => {
      const pairings = grouped({
        hapAccessories: [hap('Zebra', 'cachedAccessories'), hap('Apple', 'cachedAccessories')],
        matterAccessories: [],
        pairings: [pairing({ _id: 'MAIN00', _main: true })],
      })

      expect(pairings[0].accessories.map(a => a.displayName)).toEqual(['Apple', 'Zebra'])
    })

    it('puts the main bridge first, then the rest by name', () => {
      const pairings = grouped({
        hapAccessories: [hap('One', 'cachedAccessories'), hap('Two', 'cachedAccessories.ZZZ'), hap('Three', 'cachedAccessories.AAA')],
        matterAccessories: [],
        pairings: [
          pairing({ _id: 'MAIN00', name: 'Homebridge', _main: true }),
          pairing({ _id: 'ZZZ', name: 'Zebra Bridge' }),
          pairing({ _id: 'AAA', name: 'Apple Bridge' }),
        ],
      })

      expect(pairings.map(p => p.name)).toEqual(['Homebridge', 'Apple Bridge', 'Zebra Bridge'])
    })

    it('leaves out a bridge with nothing cached', () => {
      const pairings = grouped({
        hapAccessories: [hap('Kitchen Light', 'cachedAccessories')],
        matterAccessories: [],
        pairings: [pairing({ _id: 'MAIN00', name: 'Homebridge', _main: true }), pairing({ _id: 'EMPTY', name: 'Empty Bridge' })],
      })

      expect(pairings.map(p => p.name)).toEqual(['Homebridge'])
    })

    it('lists matter accessories under their device', () => {
      const pairings = grouped({
        hapAccessories: [],
        matterAccessories: [matter('Matter Lamp', 'matter-device-1')],
      })

      const device = pairings.find(p => p._id === 'matter-device-1')
      expect(device?.accessories.map(a => a.displayName)).toEqual(['Matter Lamp'])
      expect(device?.accessories[0].$protocol).toBe('matter')
    })

    it('ignores matter accessories entirely when matter is off', () => {
      expect(grouped({ hapAccessories: [], matterAccessories: [matter('Matter Lamp')], matterSupported: false })).toEqual([])
    })

    it('leaves the cached overview itself alone', () => {
      // Angular wrote $protocol onto the cached objects; a copy keeps the
      // shared cache free of one modal's bookkeeping
      const overview = overviewOf({ hapAccessories: [hap('Kitchen Light')], matterAccessories: [matter('Lamp')] })

      groupAccessories(overview as any, '', true)

      expect(overview.hapAccessories[0]).not.toHaveProperty('$protocol')
      expect(overview.matterAccessories[0]).not.toHaveProperty('$cacheFile')
    })

    it('shows only the bridge it was opened for', async () => {
      // Reached from one accessory's own info modal
      const { container } = await open({
        hapAccessories: [hap('Kitchen Light', 'cachedAccessories.ABC123'), hap('Hall Light', 'cachedAccessories.DEF456')],
        matterAccessories: [],
        pairings: [pairing({ _id: 'ABC123' }), pairing({ _id: 'DEF456', name: 'Hall Bridge' })],
        selectedBridge: 'ABC123',
      })

      expect(container.querySelector('#bridgeSelect')).toBeNull()
      expect(screen.getByText('Kitchen Bridge - 0E:11:22:33:44:55')).toBeInTheDocument()
      expect(screen.queryByText('Hall Light')).toBeNull()
    })

    it('selects the first bridge when none was asked for', async () => {
      await open({ hapAccessories: [hap('Kitchen Light', 'cachedAccessories')], matterAccessories: [], pairings: [pairing({ _id: 'MAIN00', name: 'Homebridge', _main: true })] })

      expect(screen.getByText('Kitchen Light')).toBeInTheDocument()
      expect(screen.getByText('Homebridge - 0E:11:22:33:44:55')).toBeInTheDocument()
    })

    it('says there is nothing cached when there is nothing', async () => {
      await open({ hapAccessories: [], matterAccessories: [] })

      expect(screen.getByText('reset.no_accessories')).toBeInTheDocument()
      expect(removeButton()).toBeNull()
    })

    it('closes itself when the cache cannot be read', async () => {
      vi.spyOn(accessoryOverviewCache, 'get').mockRejectedValue(new Error('server unavailable'))
      renderWithProviders(<RemoveIndividualAccessories activeModal={activeModal as unknown as ActiveModal} selectedBridge="" />)

      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
      expect(toast.at('error')).toHaveLength(1)
    })
  })

  describe('switching between bridges', () => {
    const twoBridges: Options = {
      hapAccessories: [hap('Kitchen Light', 'cachedAccessories.ABC123'), hap('Hall Light', 'cachedAccessories.DEF456')],
      matterAccessories: [],
      pairings: [pairing({ _id: 'ABC123' }), pairing({ _id: 'DEF456', name: 'Hall Bridge', _username: '0E:66:77:88:99:00' })],
    }

    it('offers each bridge with its username', async () => {
      await open(twoBridges)

      const options = [...screen.getByRole('combobox').querySelectorAll('option')].map(option => option.textContent)
      expect(options).toEqual(['Hall Bridge (0E:66:77:88:99:00)', 'Kitchen Bridge (0E:11:22:33:44:55)'])
    })

    it('shows the accessories of the bridge just picked', async () => {
      await open(twoBridges)

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ABC123' } })

      expect(screen.getByText('Kitchen Light')).toBeInTheDocument()
      expect(screen.queryByText('Hall Light')).toBeNull()
    })

    it('shows nothing for a bridge it does not know', async () => {
      const { container } = await open(twoBridges)

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'NOPE' } })

      expect(container.querySelectorAll('.list-group-box .fa-trash')).toHaveLength(0)
    })
  })

  describe('choosing what to remove', () => {
    it('ticks and unticks an accessory', async () => {
      await open()

      fireEvent.click(toggle('Kitchen Light'))
      expect(toggle('Kitchen Light')).toHaveClass('btn-elegant')
      expect(removeButton().textContent).toBe('form.button_remove (1)')

      fireEvent.click(toggle('Kitchen Light'))
      expect(toggle('Kitchen Light')).toHaveClass('btn-danger')
      expect(removeButton()).toBeDisabled()
    })

    it('treats the same uuid in two cache files as two accessories', async () => {
      // ⚠️ The identity is the pair, not the uuid
      await open({
        hapAccessories: [hap('Kitchen Light', 'cachedAccessories.ABC', 'uuid-1'), hap('Hall Light', 'cachedAccessories.DEF', 'uuid-1')],
        matterAccessories: [],
        pairings: [pairing({ _id: 'ABC' }), pairing({ _id: 'DEF', name: 'Hall Bridge' })],
        selectedBridge: '',
      })
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ABC' } })
      fireEvent.click(toggle('Kitchen Light'))

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'DEF' } })

      expect(toggle('Hall Light')).toHaveClass('btn-danger')
    })

    it('treats a hap and a matter entry with one uuid as two accessories', () => {
      const { hapAccessories, matterAccessories } = splitDeletions([
        { uuid: 'uuid-1', cacheFile: 'cachedAccessories', protocol: 'hap' },
        { uuid: 'uuid-1', cacheFile: 'matter-device-1', protocol: 'matter', deviceId: 'matter-device-1' },
      ])

      expect(hapAccessories).toEqual([{ uuid: 'uuid-1', cacheFile: 'cachedAccessories' }])
      expect(matterAccessories).toEqual([{ uuid: 'uuid-1', deviceId: 'matter-device-1' }])
    })
  })

  describe('highlighting the accessory the user came from', () => {
    const two: Options = {
      hapAccessories: [hap('One', 'cachedAccessories', 'uuid-1'), hap('Two', 'cachedAccessories', 'uuid-2')],
      matterAccessories: [],
      pairings: [pairing({ _id: 'MAIN00', _main: true })],
    }

    const highlighted = () => [...document.querySelectorAll('.list-group-item-highlight')].map(row => row.querySelector('.flex-grow-1')!.firstChild!.textContent)

    it('highlights it when there is more than one to choose between', async () => {
      await open({ ...two, highlightUuid: 'uuid-1', highlightCacheFile: 'cachedAccessories' })

      expect(highlighted()).toEqual(['One'])
    })

    it('highlights nothing when there is only one accessory anyway', async () => {
      // Highlighting the only row on the page is noise
      await open({ ...two, hapAccessories: [hap('One', 'cachedAccessories', 'uuid-1')], highlightUuid: 'uuid-1', highlightCacheFile: 'cachedAccessories' })

      expect(highlighted()).toEqual([])
    })

    it('highlights nothing when the caller asked for nothing', async () => {
      await open(two)

      expect(highlighted()).toEqual([])
    })

    it('does not highlight the same uuid in a different cache file', async () => {
      await open({ ...two, highlightUuid: 'uuid-1', highlightCacheFile: 'cachedAccessories.OTHER' })

      expect(highlighted()).toEqual([])
    })

    it('scrolls the highlighted row into view once the modal has faded in', async () => {
      vi.useFakeTimers()
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})

      await open({ ...two, highlightUuid: 'uuid-1', highlightCacheFile: 'cachedAccessories' })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250)
      })

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    })

    it('does not scroll once the modal has gone', async () => {
      // ⚠️ The timeout used to outlive the component, and scrolled whichever
      // highlighted row existed 250ms later
      vi.useFakeTimers()
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})

      const { unmount } = await open({ ...two, highlightUuid: 'uuid-1', highlightCacheFile: 'cachedAccessories' })
      unmount()
      await vi.advanceTimersByTimeAsync(250)

      expect(scrollIntoView).not.toHaveBeenCalled()
    })
  })

  describe('removing them', () => {
    const both: Options = {
      hapAccessories: [hap('Kitchen Light', 'cachedAccessories', 'uuid-1')],
      matterAccessories: [matter('Matter Lamp', 'MAIN00', 'uuid-2')],
    }

    it('sends the hap accessories to the hap endpoint', async () => {
      await open(both)
      fireEvent.click(toggle('Kitchen Light'))

      await remove()

      expect(api.lastCall('delete', '/server/cached-accessories')?.options?.body).toEqual([{ uuid: 'uuid-1', cacheFile: 'cachedAccessories' }])
    })

    it('sends the matter accessories to the matter endpoint', async () => {
      // ⚠️ Sent to the HAP endpoint they would be deleted nowhere, reported as success
      await open(both)
      fireEvent.click(toggle('Matter Lamp'))

      await remove()

      expect(api.lastCall('delete', '/server/matter-accessories')?.options?.body).toEqual([{ uuid: 'uuid-2', deviceId: 'MAIN00' }])
      expect(api.callsTo('delete', '/server/cached-accessories')).toEqual([])
    })

    it('sends both when the user picked both', async () => {
      await open(both)
      fireEvent.click(toggle('Kitchen Light'))
      fireEvent.click(toggle('Matter Lamp'))

      await remove()

      expect(api.callsTo('delete', '/server/cached-accessories')).toHaveLength(1)
      expect(api.callsTo('delete', '/server/matter-accessories')).toHaveLength(1)
    })

    it('forgets the cached overview and sends the user to restart', async () => {
      const { router } = await open(both)
      fireEvent.click(toggle('Kitchen Light'))

      await remove()

      expect(invalidate).toHaveBeenCalled()
      expect(activeModal.close).toHaveBeenCalled()
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe('/restart?restarting=true')
    })

    it('re-enables the button when the delete fails', async () => {
      api.fail('delete', '/server/cached-accessories', new Error('server unavailable'))
      await open(both)
      fireEvent.click(toggle('Kitchen Light'))

      await remove()

      expect(removeButton()).toBeEnabled()
      expect(activeModal.close).not.toHaveBeenCalled()
      expect(toast.at('error')).toHaveLength(1)
      expect(invalidate).not.toHaveBeenCalled()
    })

    it('fails as a whole when only the matter half fails', async () => {
      // Half a deletion is worse than none: the user has to be told
      api.fail('delete', '/server/matter-accessories', new Error('server unavailable'))
      await open(both)
      fireEvent.click(toggle('Kitchen Light'))
      fireEvent.click(toggle('Matter Lamp'))

      await remove()

      expect(toast.at('error')).toHaveLength(1)
      expect(activeModal.close).not.toHaveBeenCalled()
    })
  })

  it('closes without deleting anything when dismissed', async () => {
    await open()
    fireEvent.click(toggle('Kitchen Light'))

    fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[1])

    expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    expect(api.callsTo('delete')).toEqual([])
  })
})
