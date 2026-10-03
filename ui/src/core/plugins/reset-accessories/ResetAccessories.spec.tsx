import type { ActiveModal } from '@/core/ui/modal'
import type { Mock } from 'vitest'

import { act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessoryOverviewCache } from '@/core/caching'
import { ResetAccessories } from '@/core/plugins/reset-accessories/ResetAccessories'
import { useSettingsStore } from '@/core/settings'
import { apiError, fakeApi, makeEnv, renderWithProviders, toastStub } from '@/testing'

import '@/testing/i18n'

const toast = vi.hoisted(() => ({ current: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

/**
 * Resetting individual accessory pairings. Carries a fix with no other
 * regression test: the button used to stay disabled for ever when the reset
 * failed, so the only way to retry was to reopen the modal.
 */
describe('resetting individual accessory pairings', () => {
  const childBridges = [
    { username: '0E:11:11:11:11:11', plugin: 'homebridge-example', name: 'Bridge One' },
    { username: '0E:22:22:22:22:22', plugin: 'homebridge-example', name: 'Bridge Two' },
  ] as any[]
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }

  function bridgePairing(username: string, name: string, extra: Record<string, any> = {}) {
    return { _id: username, _category: 'bridge', _main: false, _username: username, name, ...extra }
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toast.current = toastStub()
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    useSettingsStore.setState({ env: makeEnv({ featureFlags: {} }) })
  })

  async function openModal(pairings: any[] | Error, options: { featureFlags?: Record<string, boolean> } = {}) {
    useSettingsStore.setState({ env: makeEnv({ featureFlags: options.featureFlags ?? {} }) })
    const get = vi.spyOn(accessoryOverviewCache, 'get')
    if (pairings instanceof Error) {
      get.mockRejectedValue(pairings)
    } else {
      get.mockResolvedValue({ pairings } as any)
    }
    vi.spyOn(accessoryOverviewCache, 'invalidate').mockImplementation(() => {})
    const view = renderWithProviders(<ResetAccessories activeModal={activeModal} childBridges={childBridges} />)
    await act(async () => {})
    return view
  }

  const rowNames = (container: HTMLElement) =>
    [...container.querySelectorAll('.list-group-item .flex-grow-1')].map(el => el.firstChild?.textContent?.trim())

  it('lists only the child bridges belonging to this plugin', async () => {
    const { container } = await openModal([
      bridgePairing('0E:11:11:11:11:11', 'Bridge One'),
      bridgePairing('0E:99:99:99:99:99', 'Someone Else'),
    ])

    expect(rowNames(container)).toEqual(['Bridge One'])
  })

  it('leaves the main bridge out of the list', async () => {
    // Resetting the main bridge is a different, far more destructive action
    const { container } = await openModal([
      { _category: 'bridge', _main: true, _username: '0E:11:11:11:11:11', name: 'Homebridge' },
      bridgePairing('0E:22:22:22:22:22', 'Bridge Two'),
    ])

    expect(rowNames(container)).toEqual(['Bridge Two'])
  })

  it('sorts the list by name', async () => {
    const { container } = await openModal([
      bridgePairing('0E:22:22:22:22:22', 'Zebra'),
      bridgePairing('0E:11:11:11:11:11', 'Apple'),
    ])

    expect(rowNames(container)).toEqual(['Apple', 'Zebra'])
  })

  it('lists a bridge once per protocol when it has both', async () => {
    // HAP and Matter are reset separately, so each needs its own row
    const { container } = await openModal(
      [bridgePairing('0E:11:11:11:11:11', 'Bridge One', { _matter: true })],
      { featureFlags: { matterSupport: true } },
    )

    const rows = [...container.querySelectorAll('.list-group-item')]
    expect(rows).toHaveLength(2)
    // The muted icon is the protocol a row is not about
    expect(rows[0].querySelector('.fa-matter')?.classList).toContain('opacity-muted')
    expect(rows[1].querySelector('.fa-hap')?.classList).toContain('opacity-muted')
  })

  it('lists only the hap row when matter is not supported', async () => {
    const { container } = await openModal([bridgePairing('0E:11:11:11:11:11', 'Bridge One', { _matter: true })])

    expect(container.querySelectorAll('.list-group-item')).toHaveLength(1)
    expect(container.querySelector('.fa-matter')).toBeNull()
  })

  it('includes a matter-only external accessory of this plugin', async () => {
    const { container } = await openModal(
      [{ _id: 'x', _matterOnly: true, _plugin: 'homebridge-example', name: 'External Light' }],
      { featureFlags: { matterSupport: true } },
    )

    expect(rowNames(container)).toEqual(['External Light'])
    expect(container.querySelector('.fa-hap')?.classList).toContain('opacity-muted')
  })

  it('leaves the matter-only accessory of another plugin alone', async () => {
    const { getByText } = await openModal(
      [{ _matterOnly: true, _plugin: 'homebridge-other', name: 'Not Mine' }],
      { featureFlags: { matterSupport: true } },
    )

    expect(getByText('reset.bridge_accessories.empty')).toBeTruthy()
  })

  it('closes and complains when the pairings cannot be read', async () => {
    const { getByText } = await openModal(apiError('server unavailable'))

    expect(getByText('reset.bridge_accessories.empty')).toBeTruthy()
    expect(toast.current!.error).toHaveBeenCalledWith('server unavailable', 'toast.title_error')
    expect(activeModal.close).toHaveBeenCalled()
  })

  describe('choosing what to reset', () => {
    const twoBridges = () => [
      bridgePairing('0E:11:11:11:11:11', 'Bridge One', { _matter: true }),
      bridgePairing('0E:22:22:22:22:22', 'Bridge Two'),
    ]
    const toggles = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>('.list-group-item button')]
    const resetButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.modal-footer .btn-danger')!

    it('keeps the two protocols of one bridge separate', async () => {
      // Selecting Matter must not also select HAP on the same bridge
      const { container } = await openModal(twoBridges(), { featureFlags: { matterSupport: true } })

      fireEvent.click(toggles(container)[1])

      expect(toggles(container).map(button => button.classList.contains('btn-elegant'))).toEqual([false, true, false])
      expect(resetButton(container).textContent).toBe('form.button_reset (1)')
    })

    it('takes an entry back out when it is chosen again', async () => {
      const { container } = await openModal(twoBridges())

      fireEvent.click(toggles(container)[0])
      fireEvent.click(toggles(container)[0])

      expect(resetButton(container).disabled).toBe(true)
      expect(resetButton(container).textContent).toBe('form.button_reset')
    })

    it('keeps several bridges at once', async () => {
      const api = fakeApi()
      const { container } = await openModal(twoBridges())

      fireEvent.click(toggles(container)[0])
      fireEvent.click(toggles(container)[1])
      fireEvent.click(resetButton(container))

      await waitFor(() => expect(api.lastCall('delete')).toBeTruthy())
      expect(api.lastCall('delete')?.options?.body).toEqual([
        { id: '0E:11:11:11:11:11', protocol: 'hap' },
        { id: '0E:22:22:22:22:22', protocol: 'hap' },
      ])
    })
  })

  describe('carrying out the reset', () => {
    const one = () => [bridgePairing('0E:11:11:11:11:11', 'Bridge One')]

    async function chooseAndReset(view: Awaited<ReturnType<typeof openModal>>) {
      fireEvent.click(view.container.querySelector('.list-group-item button')!)
      fireEvent.click(view.container.querySelector('.modal-footer .btn-danger')!)
    }

    it('sends the chosen entries as the request body', async () => {
      // ⚠️ The controller reads them from a body on a DELETE, which is easy to
      // lose in a refactor
      const api = fakeApi()
      const view = await openModal(one())

      await chooseAndReset(view)

      await waitFor(() => expect(api.lastCall('delete')).toBeTruthy())
      const call = api.lastCall('delete')
      expect(call?.url).toBe('/server/pairings/accessories')
      expect(call?.options?.body).toEqual([{ id: '0E:11:11:11:11:11', protocol: 'hap' }])
    })

    it('sends the user to the restart page afterwards', async () => {
      fakeApi()
      const view = await openModal(one())

      await chooseAndReset(view)

      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
      expect(toast.current!.success).toHaveBeenCalled()
      expect(accessoryOverviewCache.invalidate).toHaveBeenCalled()
      await waitFor(() => expect(view.router.state.location.pathname).toBe('/restart'))
      expect(view.router.state.location.search).toBe('?restarting=true')
    })

    it('re-enables the button when the reset fails', async () => {
      // It used to stay disabled, so the only way to retry was to close the
      // modal and open it again
      fakeApi().fail('delete', '/server/pairings/accessories', apiError('permission denied'))
      const view = await openModal(one())

      await chooseAndReset(view)

      await waitFor(() => expect(toast.current!.error).toHaveBeenCalledWith('permission denied', 'toast.title_error'))
      expect(view.container.querySelector<HTMLButtonElement>('.modal-footer .btn-danger')!.disabled).toBe(false)
      expect(activeModal.close).not.toHaveBeenCalled()
      expect(view.router.state.location.pathname).toBe('/')
    })

    it('disables the button while the reset is running', async () => {
      const api = fakeApi()
      let finish: (value?: unknown) => void = () => {}
      api.delete.mockImplementation(() => new Promise((resolve) => {
        finish = resolve
      }))
      const view = await openModal(one())

      await chooseAndReset(view)

      const button = view.container.querySelector<HTMLButtonElement>('.modal-footer .btn-danger')!
      expect(button.disabled).toBe(true)
      expect(button.querySelector('.fa-spin')).toBeTruthy()
      expect(view.container.querySelector<HTMLButtonElement>('.btn-close')!.disabled).toBe(true)
      await act(async () => finish())
    })
  })
})
