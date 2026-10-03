import type { Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { ActiveModal } from '@/core/ui/modal'
import type { Mock } from 'vitest'

import { act, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { serverPairingsCache } from '@/core/caching'
import { PluginExternals } from '@/core/plugins/plugin-externals/PluginExternals'
import { renderWithProviders, toastStub } from '@/testing'

import '@/testing/i18n'

const toast = vi.hoisted(() => ({ current: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

describe('the external accessories of a plugin', () => {
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toast.current = toastStub()
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
  })

  async function openModal(pairings: any[], failing = false) {
    const get = vi.spyOn(serverPairingsCache, 'get')
    if (failing) {
      get.mockRejectedValue(new Error('server unavailable'))
    } else {
      get.mockResolvedValue(pairings)
    }
    const view = renderWithProviders(
      <PluginExternals activeModal={activeModal} plugin={{ name: 'homebridge-example', displayName: 'Example' } as Plugin} />,
    )
    await act(async () => {})
    return view
  }

  const listed = (container: HTMLElement) => {
    const select = container.querySelector('#externalSelect')
    if (select) {
      return [...select.querySelectorAll('option')].map(option => option.textContent)
    }
    const single = container.querySelector('.list-group-box .font-monospace')
    return single ? [single.textContent?.trim()] : []
  }

  it('lists the external accessories of this plugin', async () => {
    const { container } = await openModal([
      { _id: '1', _plugin: 'homebridge-example', _isExternal: true, name: 'Camera' },
      { _id: '2', _plugin: 'homebridge-other', _isExternal: true, name: 'Not Mine' },
    ])

    expect(listed(container)).toEqual(['Camera'])
  })

  it('lists a matter-only accessory as external too', async () => {
    const { container, getByText } = await openModal([{ _id: '1', _plugin: 'homebridge-example', _matterOnly: true, name: 'Matter Light' }])

    expect(listed(container)).toEqual(['Matter Light'])
    expect(getByText('Matter')).toBeTruthy()
  })

  it('leaves a bridged accessory out', async () => {
    // Only externals need their own pairing code
    const { getByText } = await openModal([{ _id: '1', _plugin: 'homebridge-example', name: 'Bridged Switch' }])

    expect(getByText('external_accessories.no_accessories')).toBeTruthy()
  })

  it('sorts them by name', async () => {
    const { container } = await openModal([
      { _id: '1', _plugin: 'homebridge-example', _isExternal: true, name: 'Zebra' },
      { _id: '2', _plugin: 'homebridge-example', _isExternal: true, name: 'Apple' },
    ])

    expect(listed(container)).toEqual(['Apple', 'Zebra'])
  })

  it('shows the details of the accessory picked', async () => {
    const { container, getByText } = await openModal([
      { _id: '1', _plugin: 'homebridge-example', _isExternal: true, name: 'Apple', pincode: '111-11-111', _username: 'AA' },
      { _id: '2', _plugin: 'homebridge-example', _isExternal: true, name: 'Zebra', pincode: '222-22-222', _username: 'BB', _port: 51000 },
    ])
    expect(getByText('111-11-111')).toBeTruthy()

    fireEvent.change(container.querySelector('#externalSelect')!, { target: { value: '1' } })

    expect(getByText('222-22-222')).toBeTruthy()
    expect(getByText('51000')).toBeTruthy()
  })

  it('stops loading even when the pairings cannot be read', async () => {
    // Otherwise the modal spins for ever with no explanation
    const { container, getByText } = await openModal([], true)

    expect(container.querySelector('.fa-circle-notch')).toBeNull()
    expect(getByText('external_accessories.no_accessories')).toBeTruthy()
    expect(toast.current!.error).toHaveBeenCalledWith('external_accessories.toast_failed_to_load', 'toast.title_error')
  })

  it('falls back to the homebridge icon when a plugin icon will not load', async () => {
    const { container } = await openModal([])
    const image = container.querySelector('img')!

    fireEvent.error(image)

    expect(image.getAttribute('src')).toContain('assets/hb-icon.png')
  })

  it('dismisses on close', async () => {
    const { getByText } = await openModal([])

    fireEvent.click(getByText('form.button_close'))

    expect(activeModal.dismiss).toHaveBeenCalled()
  })
})
