import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSettingsStore } from '@/core/settings'
import { makeSettingsState, renderWithProviders } from '@/testing'

import { InstanceSwitcher } from './InstanceSwitcher'

describe('the instance switcher', () => {
  const withInstances = (instances: any[] | undefined) => useSettingsStore.setState(makeSettingsState({ env: { instances, homebridgeInstanceName: 'Living Room' } }))

  beforeEach(() => {
    withInstances(undefined)
  })

  it('is not shown without other instances', () => {
    const { container } = renderWithProviders(<InstanceSwitcher />)

    expect(container).toBeEmptyDOMElement()
  })

  it('links to each other instance, so picking one navigates there', () => {
    withInstances([{ name: 'Garage Pi', url: 'https://garage.local:8581' }])
    renderWithProviders(<InstanceSwitcher />)

    fireEvent.click(screen.getByRole('button', { name: 'instances.switch' }))

    const link = screen.getByText('Garage Pi').closest('a')!
    expect(link).toHaveAttribute('href', 'https://garage.local:8581')
    expect(screen.getByText('Living Room')).toBeInTheDocument()
  })

  it('never renders a non-http link', () => {
    withInstances([{ name: 'Evil', url: 'javascript:alert(1)' }])
    const { container } = renderWithProviders(<InstanceSwitcher />)

    expect(container).toBeEmptyDOMElement()
  })
})
