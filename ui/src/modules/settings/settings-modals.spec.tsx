import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi, FakeToast } from '@/testing'

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { accessoryOverviewCache } from '@/core/caching'
import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import * as toastModule from '@/core/ui/toast'
import { AccessoryControlLists } from '@/modules/settings/accessory-control-lists/AccessoryControlLists'
import { displayName } from '@/modules/settings/port-overview-modal/port-overview'
import { PortOverviewModal } from '@/modules/settings/port-overview-modal/PortOverviewModal'
import { SelectNetworkInterfaces } from '@/modules/settings/select-network-interfaces/SelectNetworkInterfaces'
import { Wallpaper } from '@/modules/settings/wallpaper/Wallpaper'
import { activeModalStub, fakeApi, makeSettingsState, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

const toast = (toastModule as unknown as { toast: FakeToast }).toast

/**
 * The four smaller modals reached from the settings page.
 *
 * Each one has a rule that is easy to get subtly wrong: a list whose ticked state
 * is the inverse of what it stores, a table whose row order is hand-written rather
 * than sorted, a "changed?" check spread over two arrays, and an upload that
 * validates a file size before spending memory encoding it.
 */
describe('settings modals', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>

  const asActiveModal = () => activeModal as unknown as ActiveModal

  beforeEach(() => {
    vi.clearAllMocks()
    toast.shown.length = 0
    resetSettingsStore()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    api = fakeApi()
    activeModal = activeModalStub()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('accessory control lists', () => {
    const pairings = [
      { _id: 'main', _username: '0E:AA:AA:AA:AA:AA', _main: true, name: 'Homebridge' },
      { _id: 'ring', _username: '0E:CC:CC:CC:CC:CC', name: 'Ring', _category: 'bridge' },
      { _id: 'hue', _username: '0E:BB:BB:BB:BB:BB', name: 'Hue', _category: 'bridge' },
    ]

    async function open(existingBlacklist: string[] = []) {
      useSettingsStore.setState(makeSettingsState({ env: { featureFlags: { matterSupport: true } } }))
      vi.spyOn(accessoryOverviewCache, 'get').mockResolvedValue({ pairings, hapAccessories: [], matterAccessories: [] })
      const result = renderWithProviders(<AccessoryControlLists activeModal={asActiveModal()} existingBlacklist={existingBlacklist} />)
      await screen.findByText('Hue')
      return result
    }

    const switchFor = (username: string) => (username === '0E:AA:AA:AA:AA:AA'
      ? document.querySelector<HTMLInputElement>('#controlMainBridge')!
      : document.querySelector<HTMLInputElement>(`#hidePluginUpdates_${CSS.escape(username)}`)!)
    const saveButton = () => screen.getByRole('button', { name: 'form.button_save' })

    it('splits the main bridge out from the rest', async () => {
      const { container } = await open()

      // The main bridge gets its own row above the list, so it must not also
      // appear among the child bridges
      const rows = [...container.querySelectorAll('.list-group-box > li')]
      expect(rows[0].textContent).toContain('Homebridge')
      expect(rows.slice(1).map(row => row.querySelector('div > div')!.firstChild!.textContent)).toEqual(['Hue', 'Ring'])
    })

    it('tidies up the stored list before comparing it', async () => {
      // The list arrives from the config file, so it may be lower case, padded
      // or in any order. Normalised after the snapshot, the modal would open
      // already claiming unsaved changes
      await open(['  0e:bb:bb:bb:bb:bb  ', '0E:CC:CC:CC:CC:CC'])

      expect(saveButton()).toBeDisabled()
      expect(switchFor('0E:BB:BB:BB:BB:BB').checked).toBe(false)
    })

    it('adds and removes a bridge from the list', async () => {
      await open()

      fireEvent.click(switchFor('0E:BB:BB:BB:BB:BB'))
      expect(switchFor('0E:BB:BB:BB:BB:BB').checked).toBe(false)
      expect(saveButton()).toBeEnabled()

      fireEvent.click(switchFor('0E:BB:BB:BB:BB:BB'))
      expect(switchFor('0E:BB:BB:BB:BB:BB').checked).toBe(true)
      expect(saveButton()).toBeDisabled()
    })

    it('ignores the order the user ticked things in', async () => {
      await open(['0E:BB:BB:BB:BB:BB', '0E:CC:CC:CC:CC:CC'])

      fireEvent.click(switchFor('0E:BB:BB:BB:BB:BB'))
      fireEvent.click(switchFor('0E:BB:BB:BB:BB:BB'))

      // Both lists are sorted before being joined, so ticking a box off and
      // back on again is not an unsaved change
      expect(saveButton()).toBeDisabled()
    })

    it('saves the list and remembers it locally', async () => {
      await open()
      fireEvent.click(switchFor('0E:BB:BB:BB:BB:BB'))

      fireEvent.click(saveButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      // The nesting looks like a mistake but is not: the controller signature
      // is `setAccessoryControlInstanceBlacklist(@Body() { body })`
      expect(api.lastCall('put', '/config-editor/ui/accessory-control/instance-blacklist')?.body).toEqual({
        body: ['0E:BB:BB:BB:BB:BB'],
      })
      expect(useSettingsStore.getState().env.accessoryControl?.instanceBlacklist).toEqual(['0E:BB:BB:BB:BB:BB'])
    })

    it('lets the user try again when saving fails', async () => {
      api.fail('put', '/config-editor/ui/accessory-control/instance-blacklist', new Error('offline'))
      await open()
      fireEvent.click(switchFor('0E:BB:BB:BB:BB:BB'))

      fireEvent.click(saveButton())
      await waitFor(() => expect(toast.at('error')).toHaveLength(1))

      expect(saveButton()).toBeEnabled()
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('closes itself when the bridge list cannot be read', async () => {
      // There is nothing to choose from; staying open would only offer a save
      // button that wipes the list
      vi.spyOn(accessoryOverviewCache, 'get').mockRejectedValue(new Error('offline'))
      renderWithProviders(<AccessoryControlLists activeModal={asActiveModal()} existingBlacklist={[]} />)

      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
      expect(toast.at('error')).toHaveLength(1)
    })

    it('title-cases the category and greys out a protocol the bridge lacks', async () => {
      const { container } = await open()

      expect(container.textContent).toContain('Bridge')
      expect(container.querySelectorAll('.fa-matter.opacity-muted')).toHaveLength(3)
    })
  })

  describe('network interface selection', () => {
    const available = [
      { iface: 'eth0', ip4: '192.168.1.10' },
      { iface: 'wlan0', ip4: '192.168.1.11' },
      { iface: 'lo', ip4: '127.0.0.1' },
    ] as any[]

    function open(selectedIfaces: string[]) {
      return renderWithProviders(
        <SelectNetworkInterfaces
          activeModal={asActiveModal()}
          adaptersAvailable={available.map(a => ({ ...a }))}
          adaptersSelected={selectedIfaces.map(iface => ({ iface, selected: true, missing: false }))}
        />,
      )
    }

    const box = (iface: string) => document.querySelector<HTMLInputElement>(`#adapter${iface}`)!
    const saveButton = () => screen.getByRole('button', { name: 'form.button_save' })

    it('ticks the adapters that are already in use', () => {
      open(['eth0'])

      expect(['eth0', 'wlan0', 'lo'].map(iface => box(iface).checked)).toEqual([true, false, false])
      expect(saveButton()).toBeDisabled()
    })

    it('notices an adapter being added', () => {
      open(['eth0'])

      fireEvent.click(box('wlan0'))

      expect(saveButton()).toBeEnabled()
    })

    it('notices a swap that keeps the count the same', () => {
      open(['eth0'])

      fireEvent.click(box('eth0'))
      fireEvent.click(box('wlan0'))

      // A length check alone would call this unchanged
      expect(saveButton()).toBeEnabled()
    })

    it('returns to unchanged when the original set is restored', () => {
      open(['eth0'])

      fireEvent.click(box('wlan0'))
      fireEvent.click(box('wlan0'))

      expect(saveButton()).toBeDisabled()
    })

    it('closes with just the interface names', () => {
      open(['eth0'])
      fireEvent.click(box('wlan0'))

      fireEvent.click(saveButton())

      // The caller writes this straight into the config, so it must be names
      expect(activeModal.close).toHaveBeenCalledWith(['eth0', 'wlan0'])
    })

    it('closes with an empty list when nothing is ticked', () => {
      open(['eth0'])
      fireEvent.click(box('eth0'))

      fireEvent.click(saveButton())

      expect(activeModal.close).toHaveBeenCalledWith([])
    })

    it('dismisses without a result when cancelled', () => {
      open(['eth0'])
      fireEvent.click(box('wlan0'))

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[1])

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
      expect(activeModal.close).not.toHaveBeenCalled()
    })
  })

  describe('port overview', () => {
    beforeEach(() => {
      api.respond('get', '/server/network/overview', { entries: [], conflicts: [] })
    })

    it('lists homebridge first, then the ui, then bridges by name', async () => {
      api.respond('get', '/server/network/overview', {
        entries: [
          { service: 'Child Bridge', port: 52001, protocol: 'hap', bridge: 'Ring', status: 'ok' },
          { service: 'Config UI', port: 8581, protocol: 'http', bridge: 'Homebridge Glass UI', status: 'ok' },
          { service: 'Child Bridge', port: 52000, protocol: 'hap', bridge: 'Hue', status: 'ok', matterPort: 5541, commissioned: true },
          { service: 'Homebridge', port: 51826, protocol: 'hap', bridge: 'Homebridge', status: 'down' },
        ],
        conflicts: [],
      })
      const { container } = renderWithProviders(<PortOverviewModal activeModal={asActiveModal()} />)

      await screen.findByText('Ring')
      expect([...container.querySelectorAll('h6')].map(h => h.textContent)).toEqual(['Homebridge', 'Homebridge Glass UI', 'Hue', 'Ring'])
      expect(container.querySelector('.fa-spinner')).toBeNull()
      const lists = container.querySelectorAll('ul.list-group')
      expect(lists[0]).toHaveClass('mb-3')
      expect(lists[3]).toHaveClass('mb-0')
      expect(lists[0].querySelector('.fa-times-circle')).not.toBeNull()
    })

    it('reports the ui under its product name', () => {
      // The server calls it 'Config UI'; nothing else in the app does
      expect(displayName({ service: 'Config UI', bridge: 'anything' } as any)).toBe('Homebridge Glass UI')
      expect(displayName({ service: 'Child Bridge', bridge: 'Hue' } as any)).toBe('Hue')
    })

    it('warns about conflicting ports', async () => {
      api.respond('get', '/server/network/overview', { entries: [], conflicts: ['51826', '8581'] })
      const { container } = renderWithProviders(<PortOverviewModal activeModal={asActiveModal()} />)

      await screen.findByText('settings.ports.conflict_warning')
      expect(container.querySelector('.alert-warning')).not.toBeNull()
    })

    it('stops loading even when the read fails', async () => {
      // Without the finally block the modal would sit on a spinner for ever
      api.fail('get', '/server/network/overview', new Error('offline'))
      const { container } = renderWithProviders(<PortOverviewModal activeModal={asActiveModal()} />)

      await waitFor(() => expect(container.querySelector('.fa-spinner')).toBeNull())
      expect(toast.at('error')).toHaveLength(1)
    })
  })

  describe('wallpaper', () => {
    function makeFile(name: string, size: number): File {
      // `size` is a getter on Blob.prototype, so an own property shadows it
      const file = new File(['x'], name)
      Object.defineProperty(file, 'size', { value: size })
      return file
    }

    function open(customWallpaperHash = '') {
      useSettingsStore.setState(makeSettingsState({ env: { customWallpaperHash } }))
      return renderWithProviders(<Wallpaper activeModal={asActiveModal()} />)
    }

    const preview = () => document.querySelector<HTMLImageElement>('.wallpaper-preview')
    const input = () => document.querySelector<HTMLInputElement>('#wallpaper')!
    const choose = (files: File[]) => fireEvent.change(input(), { target: { files } })
    const saveButton = () => screen.getByRole('button', { name: 'form.button_save' })

    beforeEach(() => {
      // A synchronous stand-in keeps the preview deterministic
      vi.stubGlobal('FileReader', class {
        onload: ((event: { target: { result: string } }) => void) | null = null
        readAsDataURL(file: File) {
          this.onload?.({ target: { result: `data:image/png;base64,preview-of-${file.name}` } })
        }
      })
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('shows the wallpaper already saved on the server', () => {
      open('abc123')

      expect(preview()!.src).toContain('/auth/wallpaper/abc123')
      expect(saveButton()).toBeDisabled()
    })

    it('starts with nothing when no wallpaper is set', () => {
      const { container } = open()

      expect(preview()).toBeNull()
      expect(container.querySelector('.wallpaper-placeholder')).not.toBeNull()
    })

    it('refuses a file bigger than the upload limit', () => {
      // Checked before the bytes are base64-encoded for the preview
      open('abc123')

      choose([makeFile('huge.png', globalThis.backup.maxBackupSize + 1)])

      expect(preview()!.src).toContain('/auth/wallpaper/abc123')
      expect(toast.at('error')).toHaveLength(1)
      expect(saveButton()).toBeDisabled()
    })

    it('accepts a file within the limit', () => {
      open()

      choose([makeFile('nice.png', 1024)])

      expect(preview()!.getAttribute('src')).toBe('data:image/png;base64,preview-of-nice.png')
      expect(toast.at('error')).toHaveLength(0)
      expect(saveButton()).toBeEnabled()
    })

    it('goes back to the saved wallpaper when the picker is cleared', () => {
      open('abc123')

      choose([makeFile('nice.png', 1024)])
      choose([])

      expect(preview()!.src).toContain('/auth/wallpaper/abc123')
    })

    it('uploads the chosen file as form data', async () => {
      open()
      choose([makeFile('nice.png', 1024)])

      fireEvent.click(saveButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      const call = api.lastCall('post', '/server/wallpaper')
      expect(call?.body).toBeInstanceOf(FormData)
      expect((call?.body as FormData).get('wallpaper')).toBeInstanceOf(File)
      expect(toast.at('success')).toHaveLength(1)
    })

    it('records the saved wallpaper under its own extension', async () => {
      const setItem = vi.spyOn(settingsActions, 'setItem')
      open()
      choose([makeFile('holiday.photo.jpeg', 1024)])

      fireEvent.click(saveButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      // Only the last dotted part is the extension
      expect(setItem).toHaveBeenCalledWith('wallpaper', 'ui-wallpaper.jpeg')
    })

    it('deletes the wallpaper when saving with nothing chosen', async () => {
      open('abc123')
      fireEvent.click(screen.getByRole('button', { name: 'form.button_delete' }))

      fireEvent.click(saveButton())
      await waitFor(() => expect(activeModal.close).toHaveBeenCalled())

      expect(api.callsTo('delete', '/server/wallpaper')).toHaveLength(1)
      expect(api.callsTo('post', '/server/wallpaper')).toHaveLength(0)
    })

    it('lets the user try again when the upload fails', async () => {
      api.fail('post', '/server/wallpaper', new Error('too big'))
      open()
      choose([makeFile('nice.png', 1024)])

      fireEvent.click(saveButton())
      await waitFor(() => expect(toast.at('error')).toHaveLength(1))

      expect(saveButton()).toBeEnabled()
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('drops a newly chosen file back to the saved one', () => {
      open('abc123')
      choose([makeFile('nice.png', 1024)])

      fireEvent.click(screen.getByRole('button', { name: 'form.button_delete' }))

      expect(preview()!.src).toContain('/auth/wallpaper/abc123')
      expect(input().value).toBe('')
    })

    it('clears the saved wallpaper on a second press', () => {
      // Clearing while the saved wallpaper shows is how the user asks for it to
      // be removed, which is what makes save send a DELETE
      open('abc123')

      fireEvent.click(screen.getByRole('button', { name: 'form.button_delete' }))

      expect(preview()).toBeNull()
      expect(saveButton()).toBeEnabled()
    })
  })
})
