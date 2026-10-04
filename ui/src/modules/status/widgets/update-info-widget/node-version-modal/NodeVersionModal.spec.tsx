import type { Mock } from 'vitest'

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/core/api'
import { pluginsCache } from '@/core/caching'
import { useSettingsStore } from '@/core/settings'
import { toast } from '@/core/ui/toast'
import { NodeVersionModal } from '@/modules/status/widgets/update-info-widget/node-version-modal/NodeVersionModal'
import { makeSettingsState } from '@/testing'

/**
 * The Node.js modal: which installed plugins will run on the version on offer,
 * and the update-notification policy for node itself.
 */
describe('the node version modal', () => {
  let activeModal: { close: Mock<(...args: any[]) => any>, dismiss: Mock<(...args: any[]) => any>, update: Mock<(...args: any[]) => any> }
  let statusIo: { request: Mock<(...args: any[]) => any> }
  let onUpdate: Mock<(...args: any[]) => any>
  let patch: ReturnType<typeof vi.spyOn>

  async function open(overrides: Record<string, any> = {}) {
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    statusIo = { request: vi.fn(async () => ({})) }
    onUpdate = vi.fn(async () => undefined)
    const result = render(
      <NodeVersionModal
        activeModal={activeModal}
        nodeVersion="22.0.0"
        latestVersion="24.1.0"
        showNodeUnsupportedWarning={false}
        homebridgeRunningInSynologyPackage={false}
        homebridgeRunningInDocker={false}
        homebridgePkg={{ engines: { node: '^22 || ^24' } }}
        architecture="arm64"
        supportsNodeJs24
        statusIo={statusIo}
        onUpdate={onUpdate}
        {...overrides}
      />,
    )
    await act(async () => {})
    return result
  }

  const rows = (container: HTMLElement) => [...container.querySelectorAll('.list-group-item .plugin-icon-small')]
    .map(img => img.closest('li')!.querySelector('.text-start')!.firstChild!.textContent)

  beforeEach(() => {
    useSettingsStore.setState(makeSettingsState({ env: { nodeUpdatePolicy: 'all' } }))
    vi.spyOn(pluginsCache, 'get').mockResolvedValue([
      { name: 'homebridge-zulu', displayName: 'Zulu', engines: { node: '^22' } },
      { name: '@mp-consulting/homebridge-config-glass-ui', displayName: 'Glass UI', engines: { node: '^22 || ^24' } },
      { name: 'homebridge-alpha', displayName: 'Alpha' },
    ] as any)
    patch = vi.spyOn(api, 'patch').mockResolvedValue({})
    vi.spyOn(toast, 'success').mockImplementation(() => undefined as any)
    vi.spyOn(toast, 'error').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the version change', async () => {
    const { container } = await open()

    expect(container.querySelector('.modal-body h5')).toHaveTextContent('22.0.0 → 24.1.0')
  })

  it('lists homebridge first, then the ui, then the rest by name', async () => {
    const { container } = await open()

    expect(rows(container)).toEqual(['Homebridge', 'Glass UI', 'Alpha', 'Zulu'])
  })

  it('checks each plugin against the version on offer', async () => {
    const { container } = await open()
    const iconOf = (name: string) => [...container.querySelectorAll('li')].find(li => li.textContent?.startsWith(name))!.querySelector('.ms-3 i')!.className

    expect(iconOf('Glass UI')).toContain('fa-check-circle')
    expect(iconOf('Zulu')).toContain('fa-xmark-circle')
    // No engines field: nobody knows
    expect(iconOf('Alpha')).toContain('fa-question-circle')
    expect(screen.getByText('status.widget.update_node_unknown')).toBeInTheDocument()
  })

  it('warns up front how many plugins would not accept the new Node.js', async () => {
    await open()

    // Zulu only (Alpha does not say, and is not counted)
    expect(screen.getByRole('alert')).toHaveTextContent('status.widget.info.node_incompatible_summary')
  })

  it('has no warning when every plugin accepts the new Node.js', async () => {
    await open({ latestVersion: '22.5.0' })

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says whether this machine can run Node.js 24 at all', async () => {
    await open({ supportsNodeJs24: false })

    expect(screen.getByText('status.widget.info.node_next_no')).toBeInTheDocument()
  })

  it('leaves the Node.js 24 check out once on 24', async () => {
    await open({ nodeVersion: '24.0.0' })

    expect(screen.queryByText('status.widget.info.node_major')).toBeNull()
  })

  it('saves a new policy, clears the server cache and refreshes the widget', async () => {
    vi.useFakeTimers()
    await open()

    fireEvent.click(screen.getByLabelText('plugins.manage.notifications_none'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(patch).toHaveBeenCalledWith('/config-editor/ui', { nodeUpdatePolicy: 'none' })
    expect(useSettingsStore.getState().env.nodeUpdatePolicy).toBe('none')
    // ⚠️ Without this the server keeps serving the version the OLD policy chose
    expect(statusIo.request).toHaveBeenCalledWith('clear-nodejs-version-cache')
    expect(onUpdate).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalled()
  })

  it('waits for the user to settle on a choice', async () => {
    vi.useFakeTimers()
    await open()

    fireEvent.click(screen.getByLabelText('plugins.manage.notifications_none'))
    fireEvent.click(screen.getByLabelText('plugins.manage.notifications_major'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith('/config-editor/ui', { nodeUpdatePolicy: 'major' })
  })

  it('puts the choice back when it could not be saved', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    patch.mockRejectedValue(new Error('offline'))
    await open()

    fireEvent.click(screen.getByLabelText('plugins.manage.notifications_none'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(toast.error).toHaveBeenCalledWith('config.toast_failed_to_save_config', 'toast.title_error')
    expect(screen.getByLabelText('plugins.manage.notifications_all')).toBeChecked()
  })

  it('dismisses from either close button', async () => {
    await open()

    fireEvent.click(screen.getAllByLabelText('form.button_close')[1])

    expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
  })
})
