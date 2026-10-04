import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/core/settings'
import { InstancesSection } from '@/modules/settings/sections/InstancesSection'
import { SettingsPageContext } from '@/modules/settings/settings-page.context'
import { createSettingsPage } from '@/modules/settings/settings-page.store'
import { fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

describe('the instances settings', () => {
  let api: FakeApi

  function render(instances: any[] = []) {
    useSettingsStore.setState(makeSettingsState({ env: { instances } }))
    const page = createSettingsPage({ navigate: () => {}, isPwa: false })
    renderWithProviders(
      <SettingsPageContext value={page}>
        <InstancesSection />
      </SettingsPageContext>,
    )
  }

  beforeEach(() => {
    api = fakeApi().respond('put', '/config-editor/ui/instances', (call: any) => call.body)
  })

  it('adds an instance and saves the list, which the switcher then shows', async () => {
    render()
    expect(screen.getByText('instances.none')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /instances.add/ }))
    fireEvent.change(screen.getByLabelText('instances.name'), { target: { value: ' Garage ' } })
    fireEvent.change(screen.getByLabelText('instances.url'), { target: { value: 'https://garage.local:8581' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    })

    expect(api.callsTo('put', '/config-editor/ui/instances')[0].body).toEqual([{ name: 'Garage', url: 'https://garage.local:8581' }])
    expect(useSettingsStore.getState().env.instances).toEqual([{ name: 'Garage', url: 'https://garage.local:8581' }])
  })

  it('will not save an address that is not http(s)', () => {
    render([{ name: 'Garage', url: 'https://garage.local' }])

    fireEvent.change(screen.getByLabelText('instances.url'), { target: { value: 'ftp://garage.local' } })

    expect(screen.getByRole('button', { name: 'form.button_save' })).toBeDisabled()
    expect(screen.getByLabelText('instances.url')).toHaveAttribute('aria-invalid', 'true')
  })

  it('removes an instance', async () => {
    render([{ name: 'A', url: 'https://a.local' }, { name: 'B', url: 'https://b.local' }])

    fireEvent.click(screen.getAllByRole('button', { name: 'form.button_delete' })[0])
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'form.button_save' }))
    })

    expect(api.callsTo('put', '/config-editor/ui/instances')[0].body).toEqual([{ name: 'B', url: 'https://b.local' }])
  })
})
