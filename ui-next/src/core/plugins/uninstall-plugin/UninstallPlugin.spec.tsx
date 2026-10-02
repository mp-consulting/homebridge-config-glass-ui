import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi, FakeOpenModal } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ManagePlugin } from '@/core/plugins/manage-plugin/ManagePlugin'
import { UninstallPlugin } from '@/core/plugins/uninstall-plugin/UninstallPlugin'
import * as modalModule from '@/core/ui/modal'
import { fakeApi, makeChildBridge, makePlugin, renderWithProviders, toastStub } from '@/testing'

import '@/testing/i18n'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
vi.mock('@/core/plugins/manage-plugin/ManagePlugin', () => ({ ManagePlugin: () => null }))

const toast = vi.hoisted(() => ({ current: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

const modal = modalModule as unknown as FakeOpenModal

/**
 * The uninstall modal installs nothing itself: it gathers a decision, does the
 * clean-up, then opens ManagePlugin - the single place that runs npm.
 */
describe('uninstalling a plugin', () => {
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }
  let api: FakeApi
  let onRefreshPluginList: Mock

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toast.current = toastStub()
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    onRefreshPluginList = vi.fn()
    modal.opened.length = 0
    modal.openModal.mockClear()
  })

  async function openUninstall(data: Record<string, any> = {}, arrange?: () => void) {
    api = fakeApi()
    api.respond('get', /\/plugins\/alias\//, { pluginType: 'platform', pluginAlias: 'TestPlatform' })
    arrange?.()
    const view = renderWithProviders(
      <UninstallPlugin activeModal={activeModal} plugin={makePlugin()} onRefreshPluginList={onRefreshPluginList} {...data} />,
    )
    await act(async () => {})
    return view
  }

  const removeConfigBox = (container: HTMLElement) => container.querySelector<HTMLInputElement>('#remove-plugin-config')!
  const settingLine = (container: HTMLElement) => container.querySelector('ul.mt-2 > li')?.textContent

  async function doUninstall(view: Awaited<ReturnType<typeof openUninstall>>) {
    fireEvent.click(view.getByText('plugins.manage.uninstall'))
    await waitFor(() => expect(activeModal.dismiss).toHaveBeenCalled())
  }

  it('offers to remove the config by default', async () => {
    const { container } = await openUninstall()

    expect(removeConfigBox(container).checked).toBe(true)
    // A dynamic platform gets the keepAccessories explanation
    expect(settingLine(container)).toBe('plugins.manage.confirm_disable_setting')
  })

  it('keeps the config by default when orphans are being kept', async () => {
    const { container, getByText } = await openUninstall({ keepOrphans: true })

    // With keepAccessories on, leaving the config in place is what preserves
    // the accessories in the Home app, so that becomes the safer default
    expect(removeConfigBox(container).checked).toBe(false)
    expect(getByText('plugins.manage.confirm_disable_platform_1')).toBeTruthy()
  })

  it('warns that the setting will be overridden if the config goes anyway', async () => {
    const { container, getByText } = await openUninstall({ keepOrphans: true })

    fireEvent.click(removeConfigBox(container))

    // Removing the config makes keepAccessories moot, and the user needs to
    // be told rather than discover their rooms are empty
    expect(settingLine(container)).toBe('plugins.manage.confirm_disable_setting_override')
    expect(getByText('plugins.manage.confirm_disable_accessory_1')).toBeTruthy()
  })

  it('hides the cleanup warning only when nothing is being removed', async () => {
    const { container, queryByText } = await openUninstall({ keepOrphans: true })
    expect(queryByText('plugins.uninstall_cleanup_main_bridge')).toBeNull()

    fireEvent.click(removeConfigBox(container))
    expect(queryByText('plugins.uninstall_cleanup_main_bridge')).toBeTruthy()
  })

  it('ties the child bridge choice to the config choice', async () => {
    const view = await openUninstall({ childBridges: [makeChildBridge()] })
    expect(view.getByText('plugins.uninstall_cleanup_child_bridge')).toBeTruthy()

    fireEvent.click(removeConfigBox(view.container))
    await doUninstall(view)

    // A child bridge with no config behind it is an orphan the user cannot
    // reach from anywhere in the UI
    expect(api.callsTo('delete')).toHaveLength(0)
  })

  it('empties the config and re-enables the plugin before it goes', async () => {
    const view = await openUninstall()

    await doUninstall(view)

    expect(api.lastCall('post', '/config-editor/plugin/homebridge-test')?.body).toEqual([])
    // Leaving a removed plugin on the disabled list would block a later
    // reinstall from starting
    expect(api.callsTo('put', '/config-editor/plugin/homebridge-test/enable')).toHaveLength(1)
  })

  it('leaves the config alone when the user unticks it', async () => {
    const view = await openUninstall()
    fireEvent.click(removeConfigBox(view.container))

    await doUninstall(view)

    expect(api.callsTo('post', '/config-editor/plugin/homebridge-test')).toHaveLength(0)
  })

  it('removes each child bridge pairing with the colons stripped', async () => {
    const view = await openUninstall({
      childBridges: [makeChildBridge({ username: '0E:12:34:56:78:9A' }), makeChildBridge({ username: '0E:AA:BB:CC:DD:EE' })],
    })

    await doUninstall(view)

    // The pairings endpoint keys on the id without separators
    expect(api.callsTo('delete').map(call => call.url)).toEqual([
      '/server/pairings/0E123456789A',
      '/server/pairings/0EAABBCCDDEE',
    ])
  })

  it('carries on uninstalling when a pairing cannot be removed', async () => {
    // ⚠️ The plugin still has to go. Stopping here would leave it installed with
    // its config already emptied, which is the worst of both
    const view = await openUninstall(
      { childBridges: [makeChildBridge()] },
      () => api.fail('delete', /\/server\/pairings\//, new Error('pairing not found')),
    )

    await doUninstall(view)

    expect(toast.current!.error).toHaveBeenCalledWith('pairing not found', 'toast.title_error')
    expect(modal.lastOpened()?.component).toBe(ManagePlugin)
  })

  it('hands over to the manage modal to do the actual uninstall', async () => {
    const view = await openUninstall()

    await doUninstall(view)

    expect(modal.lastOpened()?.component).toBe(ManagePlugin)
    expect(modal.propsFor()).toMatchObject({
      action: 'Uninstall',
      pluginName: 'homebridge-test',
      pluginDisplayName: 'Test Plugin',
      onRefreshPluginList,
    })
    expect(modal.lastOpened()?.options).toEqual({ size: 'lg', backdrop: 'static' })
  })

  it('still uninstalls when clearing the config fails', async () => {
    const view = await openUninstall({}, () =>
      api.fail('post', '/config-editor/plugin/homebridge-test', new Error('read only')))

    await doUninstall(view)

    // Stopping here would leave the plugin installed and the user stuck; the
    // leftover config block is harmless once the plugin is gone
    expect(modal.lastOpened()?.component).toBe(ManagePlugin)
    expect(toast.current!.error).toHaveBeenCalledTimes(1)
  })

  it('uses the alias the editor already knows rather than asking again', async () => {
    const { container } = await openUninstall({
      editorContext: { alias: { pluginType: 'accessory', pluginAlias: 'TestAccessory' } },
    })

    expect(api.callsTo('get', /\/plugins\/alias\//)).toHaveLength(0)
    // An accessory plugin is not a dynamic platform, so the keepAccessories
    // reasoning does not apply to it
    expect(removeConfigBox(container)).toBeTruthy()
    expect(settingLine(container)).toBeUndefined()
  })

  it('stops loading even when the alias lookup fails', async () => {
    const { container, getByText } = await openUninstall({}, () =>
      api.fail('get', /\/plugins\/alias\//, new Error('offline')))

    expect(container.querySelector('.fa-circle-notch')).toBeNull()
    expect(toast.current!.error).toHaveBeenCalledTimes(1)
    expect(getByText('plugins.uninstall_remove_config_required')).toBeTruthy()
  })
})
