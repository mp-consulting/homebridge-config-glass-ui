import type { ActiveModal } from '@/core/ui/modal'
import type { Mock } from 'vitest'

import { fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RestartChildBridges } from '@/core/components/restart-child-bridges/RestartChildBridges'
import { useSettingsStore } from '@/core/settings'
import { fakeApi, makeEnv, renderWithProviders, toastStub } from '@/testing'

import '@/testing/i18n'

const toast = vi.hoisted(() => ({ current: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

describe('restartChildBridges', () => {
  const bridges = [
    { name: 'Hue', username: '0E:00:00:00:00:01', matterSerialNumber: 'abc' },
    { name: 'Ring', username: '0E:00:00:00:00:02' },
  ]
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }

  beforeEach(() => {
    toast.current = toastStub()
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    useSettingsStore.setState({ env: makeEnv({ featureFlags: { matterSupport: true } }) })
  })

  it('lists the bridges it will restart', () => {
    const { container } = renderWithProviders(<RestartChildBridges activeModal={activeModal} bridges={bridges} />)

    const items = [...container.querySelectorAll('.list-group-item')]
    expect(items.map(item => item.querySelector('small')?.textContent)).toEqual(['0E:00:00:00:00:01', '0E:00:00:00:00:02'])
    // A bridge with no Matter serial gets a muted Matter icon
    expect(items[0].querySelector('.fa-matter')?.classList).not.toContain('opacity-muted')
    expect(items[1].querySelector('.fa-matter')?.classList).toContain('opacity-muted')
  })

  it('shows only the HAP icon when the runtime has no Matter', () => {
    useSettingsStore.setState({ env: makeEnv({ featureFlags: {} }) })
    const { container } = renderWithProviders(<RestartChildBridges activeModal={activeModal} bridges={bridges} />)

    expect(container.querySelector('.fa-matter')).toBeNull()
    expect(container.querySelector('.fa-hap')?.className).toBe('fas fa-hap')
  })

  it('restarts every bridge, reports success and closes', async () => {
    const api = fakeApi().respond('put', /\/server\/restart\//, {})
    const { getByText } = renderWithProviders(<RestartChildBridges activeModal={activeModal} bridges={bridges} />)

    fireEvent.click(getByText('menu.tooltip_restart'))

    await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
    expect(api.callsTo('put').map(call => call.url)).toEqual(['/server/restart/0E:00:00:00:00:01', '/server/restart/0E:00:00:00:00:02'])
    expect(toast.current!.success).toHaveBeenCalledWith('plugins.manage.child_bridge_restart', 'toast.title_success')
  })

  it('keeps going past a bridge that fails, then reports the failure', async () => {
    // Stopping at the first failure used to leave the rest on old config
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = fakeApi()
      .fail('put', '/server/restart/0E:00:00:00:00:01', { status: 500 })
      .respond('put', '/server/restart/0E:00:00:00:00:02', {})
    const { getByText } = renderWithProviders(<RestartChildBridges activeModal={activeModal} bridges={bridges} />)

    fireEvent.click(getByText('menu.tooltip_restart'))

    await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
    expect(api.callsTo('put')).toHaveLength(2)
    expect(toast.current!.error).toHaveBeenCalledWith('plugins.manage.child_bridge_restart_failed', 'toast.title_error')
    expect(toast.current!.success).not.toHaveBeenCalled()
  })

  it('restarts nothing when the user backs out', () => {
    const api = fakeApi()
    const { container } = renderWithProviders(<RestartChildBridges activeModal={activeModal} bridges={bridges} />)

    fireEvent.click(container.querySelector('.btn-close')!)

    expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    expect(api.calls).toHaveLength(0)
  })
})
