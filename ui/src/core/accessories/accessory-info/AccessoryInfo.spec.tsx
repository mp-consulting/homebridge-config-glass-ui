import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { FakeOpenModal } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAccessoryInfo, getEnumLabel } from '@/core/accessories/accessory-info/accessory-info.helpers'
import { AccessoryInfo } from '@/core/accessories/accessory-info/AccessoryInfo'
import * as modalModule from '@/core/ui/modal'
import { RemoveIndividualAccessories } from '@/modules/settings/remove-individual-accessories/RemoveIndividualAccessories'
import { characteristic, hapService, matterService, renderWithProviders } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

const modal = modalModule as unknown as FakeOpenModal

/**
 * The accessory info modal — what a long press on any tile opens.
 *
 * It is the only place a user can rename an accessory, change which tile type it
 * renders as, hide it, or put it on the dashboard.
 *
 * ⚠️ The Angular modal edited the live service object in place (and put the four
 * fields back on dismiss). Here the fields are form state, so the service is
 * never touched: the "restore on dismiss" cases become "the service is left
 * alone".
 *
 * ⚠️ **the type dropdown is not a free choice.** Offering a type the accessory
 * cannot render as gives a tile with no controls, so the list comes from groups of
 * interchangeable types — and Speaker/SmartSpeaker share one tile, so only the
 * variant matching the real accessory may be offered.
 */
describe('accessoryInfo', () => {
  let activeModal: { close: Mock<(value?: any) => void>, dismiss: Mock<(reason?: unknown) => void>, update: Mock<() => void> }

  /** A pairing as the server reports it. */
  function pairing(overrides: Record<string, any> = {}) {
    return {
      _id: 'child-1',
      _username: '0E:12:34:56:78:9A',
      _main: true,
      name: 'Homebridge Test',
      ...overrides,
    }
  }

  /** A cached accessory, as `cachedAccessories` on disk holds it. */
  function cached(options: { name?: string, serial?: string, cacheFile?: string, uuid?: string } = {}) {
    return {
      UUID: options.uuid ?? 'cached-uuid',
      $cacheFile: options.cacheFile ?? 'cachedAccessories',
      plugin: 'homebridge-test',
      platform: 'TestPlatform',
      accessory: '',
      services: [{
        constructorName: 'AccessoryInformation',
        characteristics: [
          { displayName: 'Name', value: options.name ?? 'Test Accessory' },
          { displayName: 'Serial Number', value: options.serial ?? 'TEST-SERIAL' },
        ],
      }],
    }
  }

  /** What the modal works out on opening. */
  function model(service: ServiceTypeX, options: { accessoryCache?: any[], pairingCache?: any[] } = {}) {
    return buildAccessoryInfo(service, options.pairingCache ?? [pairing()], options.accessoryCache ?? [])
  }

  function open(service: ServiceTypeX, options: { accessoryCache?: any[], pairingCache?: any[] } = {}) {
    activeModal = { close: vi.fn<(value?: any) => void>(), dismiss: vi.fn<(reason?: unknown) => void>(), update: vi.fn<() => void>() }
    return renderWithProviders(
      <AccessoryInfo
        activeModal={activeModal}
        service={service}
        accessoryCache={options.accessoryCache ?? []}
        pairingCache={options.pairingCache ?? [pairing()]}
      />,
    )
  }

  const saveButton = () => screen.getByRole('button', { name: 'form.button_save' })
  const nameInput = () => document.querySelector('#form-name') as HTMLInputElement
  const typeSelect = () => document.querySelector('#custom-type') as HTMLSelectElement
  const hideBox = () => document.querySelector('#hide-accessory') as HTMLInputElement
  const dashboardBox = () => document.querySelector('#show-on-dashboard') as HTMLInputElement | null

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
    modal.opened.length = 0
    modal.openModal.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('opening on a HAP accessory', () => {
    it('lists what the accessory reports about itself', () => {
      expect(model(hapService()).accessoryInformation).toEqual([
        { key: 'Manufacturer', value: 'Test Manufacturer' },
        { key: 'Model', value: 'Test Model' },
        { key: 'Name', value: 'Test Accessory' },
        { key: 'Serial Number', value: 'TEST-SERIAL' },
        { key: 'Firmware Revision', value: '1.0.0' },
      ])
    })

    it('shows them in the accessory information list', () => {
      open(hapService())

      expect(screen.getByText('Test Manufacturer')).toBeInTheDocument()
      expect(screen.getByText('HAP')).toBeInTheDocument()
    })

    it('knows it is not a matter accessory', () => {
      expect(model(hapService()).isMatterAccessory).toBe(false)
    })

    it('starts the type dropdown on the type the accessory really is', () => {
      open(hapService({ type: 'Switch' }))

      expect(typeSelect().value).toBe('Switch')
    })

    it('leaves a type the user already chose alone', () => {
      open(hapService({ type: 'Switch', overrides: { customType: 'Outlet' } }))

      expect(typeSelect().value).toBe('Outlet')
    })

    it('shows the lock management settings of a lock', () => {
      // They arrive as a separate linked service, and the modal is the only place
      // they are reachable
      const management = hapService({ type: 'LockManagement' })
      const other = hapService({ type: 'Battery' })
      const lock = hapService({
        type: 'LockMechanism',
        overrides: { linkedServices: { a: management, b: other } } as any,
      })

      expect(model(lock).extraServices).toEqual([management])
    })

    it('shows no extra services for a lock with nothing linked', () => {
      expect(model(hapService({ type: 'LockMechanism' })).extraServices).toEqual([])
    })
  })

  describe('the types it offers to render as', () => {
    function typesFor(type: string, customType?: string) {
      return model(hapService({ type, overrides: customType ? { customType } : {} })).customTypeList
    }

    it('offers the switch-like types for a switch', () => {
      const types = typesFor('Switch')

      expect(types).toContain('Outlet')
      expect(types).toContain('LockMechanism')
      expect(types).toContain('GarageDoorOpener')
    })

    it('offers the coverings for a window covering', () => {
      expect(typesFor('WindowCovering').toSorted()).toEqual(['Door', 'Window', 'WindowCovering'])
    })

    it('offers nothing for a type with no alternatives', () => {
      // A sensor cannot render as anything else
      expect(typesFor('MotionSensor')).toEqual([])
    })

    it('has no dropdown when there is nothing to choose', () => {
      open(hapService({ type: 'MotionSensor' }))

      expect(typeSelect()).toBeNull()
    })

    it('never lists the same type twice', () => {
      // 'Switch' appears in four of the groups
      const types = typesFor('Switch')

      expect(new Set(types).size).toBe(types.length)
    })

    it('offers a speaker the plain variant only', () => {
      const types = typesFor('Speaker')

      expect(types).toContain('Speaker')
      expect(types).not.toContain('SmartSpeaker')
    })

    it('offers a smart speaker the smart variant only', () => {
      const types = typesFor('SmartSpeaker')

      expect(types).toContain('SmartSpeaker')
      expect(types).not.toContain('Speaker')
    })

    it('migrates a stale smart speaker choice on a plain speaker', () => {
      // Saved before the two were separated, and it would otherwise sit in the
      // dropdown as a value that is no longer offered
      expect(model(hapService({ type: 'Speaker', overrides: { customType: 'SmartSpeaker' } })).initialCustomType).toBe('Speaker')
    })

    it('leaves a smart speaker its own choice', () => {
      expect(model(hapService({ type: 'SmartSpeaker', overrides: { customType: 'SmartSpeaker' } })).initialCustomType).toBe('SmartSpeaker')
    })

    it('marks the accessory own type as the default', () => {
      open(hapService({ type: 'Switch' }))

      const labels = Array.from(typeSelect().options).map(option => option.textContent)
      expect(labels.filter(label => label?.includes('settings.display.menu_default'))).toHaveLength(1)
      expect(typeSelect().querySelector('option[value="Switch"]')!.textContent).toContain('settings.display.menu_default')
    })
  })

  describe('opening on a matter accessory', () => {
    it('knows it is a matter accessory', () => {
      expect(model(matterService()).isMatterAccessory).toBe(true)
    })

    it('puts the device type at the top of the information list', () => {
      expect(model(matterService({ deviceType: 'OnOffLight' })).accessoryInformation[0]).toEqual({ key: 'Device Type', value: 'OnOffLight' })
    })

    it('says the device type is unknown rather than leaving it blank', () => {
      const service = matterService()
      ;(service as any).deviceType = undefined

      expect(model(service).accessoryInformation[0]).toEqual({ key: 'Device Type', value: 'Unknown' })
    })

    it('lists every cluster the device reports', () => {
      const service = matterService({
        clusters: { onOff: { onOff: true }, levelControl: { currentLevel: 128 } },
      })

      expect(model(service).clusterInfo).toEqual([
        { name: 'onOff', attributes: { onOff: true } },
        { name: 'levelControl', attributes: { currentLevel: 128 } },
      ])
    })

    it('renders the cluster attributes', () => {
      open(matterService({ clusters: { levelControl: { currentLevel: 128 } } }))

      expect(screen.getByText('128')).toBeInTheDocument()
      expect(screen.getByText('Matter')).toBeInTheDocument()
    })

    it('copes with a device reporting no clusters at all', () => {
      const service = matterService()
      ;(service as any).clusters = undefined

      expect(model(service).clusterInfo).toEqual([])
    })

    it('offers the matter types that share a tile', () => {
      const types = model(matterService({ deviceType: 'OnOffLight' })).customTypeList

      expect(types).toContain('OnOffPlugInUnit')
      expect(types).toContain('RoboticVacuumCleaner')
    })

    it('offers nothing for a matter device with no alternatives', () => {
      expect(model(matterService({ deviceType: 'ContactSensor' })).customTypeList).toEqual([])
    })

    it('starts the dropdown on the device type', () => {
      open(matterService({ deviceType: 'Fan' }))

      expect(typeSelect().value).toBe('Fan')
      expect(typeSelect().querySelector('option[value="Fan"]')!.textContent).toContain('settings.display.menu_default')
    })

    it('never looks for a cached accessory', () => {
      // The cache files are a HAP thing; matter accessories are not in them
      expect(model(matterService(), { accessoryCache: [cached()] }).matchedCachedAccessory).toBeNull()
    })
  })

  describe('matching the accessory to the one cached on disk', () => {
    it('finds it by name and serial number', () => {
      expect(model(hapService(), { accessoryCache: [cached({ uuid: 'the-one' })] }).matchedCachedAccessory?.UUID).toBe('the-one')
    })

    it('says which bridge it belongs to', () => {
      expect(model(hapService(), { accessoryCache: [cached()] }).matchedCachedAccessory?.bridge).toBe('Homebridge Test')
    })

    it('reads a child bridge cache file rather than the main one', () => {
      // A child bridge keeps its accessories in cachedAccessories.<id>
      const info = model(hapService(), {
        pairingCache: [pairing({ _main: false, _id: 'abc123', name: 'Child Bridge' })],
        accessoryCache: [cached({ cacheFile: 'cachedAccessories.abc123', uuid: 'from-child' })],
      })

      expect(info.matchedCachedAccessory?.UUID).toBe('from-child')
    })

    it('ignores an accessory cached for a different bridge', () => {
      expect(model(hapService(), { accessoryCache: [cached({ cacheFile: 'cachedAccessories.someone-else' })] }).matchedCachedAccessory).toBeNull()
    })

    it('gives up when the serial number does not match', () => {
      expect(model(hapService(), { accessoryCache: [cached({ serial: 'A-DIFFERENT-SERIAL' })] }).matchedCachedAccessory).toBeNull()
    })

    it('gives up rather than guessing between two identical entries', () => {
      // Two cached accessories with the same name and serial: picking either
      // could delete the wrong one
      expect(model(hapService(), { accessoryCache: [cached({ uuid: 'one' }), cached({ uuid: 'two' })] }).matchedCachedAccessory).toBeNull()
    })

    it('gives up when the bridge has no pairing on record', () => {
      const info = model(hapService(), {
        pairingCache: [pairing({ _username: 'AA:BB:CC:DD:EE:FF' })],
        accessoryCache: [cached()],
      })

      expect(info.matchedCachedAccessory).toBeNull()
    })

    it('gives up when nothing is cached for the bridge', () => {
      expect(model(hapService()).matchedCachedAccessory).toBeNull()
    })

    it('shows the plugin and the remove button once matched', () => {
      open(hapService(), { accessoryCache: [cached()] })

      expect(screen.getByText('homebridge-test')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'accessories.button_remove' })).toBeInTheDocument()
    })
  })

  describe('leaving without saving', () => {
    function editable(service: ServiceTypeX) {
      return {
        customName: service.customName,
        customType: service.customType,
        hidden: service.hidden,
        onDashboard: service.onDashboard,
      }
    }

    it('leaves every field of the live service as it was', () => {
      // The tile behind the modal holds this same object
      const service = hapService({ type: 'Switch', overrides: { customName: 'Kitchen', hidden: false, onDashboard: true } })
      open(service)

      fireEvent.change(nameInput(), { target: { value: 'Changed' } })
      fireEvent.change(typeSelect(), { target: { value: 'Outlet' } })
      fireEvent.click(hideBox())
      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[0])

      expect(editable(service)).toEqual({ customName: 'Kitchen', customType: undefined, hidden: false, onDashboard: true })
    })

    it('dismisses the modal', () => {
      open(hapService())

      fireEvent.click(screen.getAllByRole('button', { name: 'form.button_close' })[1])

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
      expect(activeModal.close).not.toHaveBeenCalled()
    })
  })

  describe('saving', () => {
    it('hands back only the four fields the page has to persist', () => {
      open(hapService({ type: 'Switch' }))

      fireEvent.change(nameInput(), { target: { value: 'Kitchen Light' } })
      fireEvent.change(typeSelect(), { target: { value: 'Outlet' } })
      fireEvent.click(dashboardBox()!)
      fireEvent.click(saveButton())

      expect(activeModal.close).toHaveBeenCalledWith({
        customName: 'Kitchen Light',
        customType: 'Outlet',
        hidden: undefined,
        onDashboard: true,
      })
    })

    it('saves the accessory own type when nothing else was chosen', () => {
      // As Angular did, which defaulted the field on the service
      open(hapService({ type: 'Switch' }))

      fireEvent.change(nameInput(), { target: { value: 'Kitchen Light' } })
      fireEvent.click(saveButton())

      expect(activeModal.close.mock.calls[0][0].customType).toBe('Switch')
    })
  })

  describe('whether there is anything to save', () => {
    it('says nothing changed on a freshly opened modal', () => {
      open(hapService())

      expect(saveButton()).toBeDisabled()
    })

    it.each([
      ['customName', () => fireEvent.change(nameInput(), { target: { value: 'Kitchen' } })],
      ['customType', () => fireEvent.change(typeSelect(), { target: { value: 'Outlet' } })],
      ['hidden', () => fireEvent.click(hideBox())],
      ['onDashboard', () => fireEvent.click(dashboardBox()!)],
    ])('notices a change to %s', (_field, change) => {
      open(hapService({ type: 'Switch' }))

      change()

      expect(saveButton()).toBeEnabled()
    })

    it('shows the service name while the custom name is empty', () => {
      open(hapService())

      fireEvent.change(nameInput(), { target: { value: 'Kitchen' } })
      fireEvent.change(nameInput(), { target: { value: '' } })

      expect(nameInput().value).toBe('Test Accessory')
    })
  })

  describe('hiding an accessory', () => {
    it('takes it off the dashboard at the same time', () => {
      // A hidden accessory left on the dashboard would be a tile the user cannot
      // find anywhere else to remove
      open(hapService({ overrides: { onDashboard: true } }))

      fireEvent.click(hideBox())
      fireEvent.click(saveButton())

      expect(dashboardBox()).toBeNull()
      expect(activeModal.close).toHaveBeenCalledWith(expect.objectContaining({ hidden: true, onDashboard: false }))
    })

    it('leaves the dashboard choice alone when unhiding', () => {
      open(hapService({ overrides: { onDashboard: true, hidden: true } }))

      fireEvent.click(hideBox())

      expect(dashboardBox()!.checked).toBe(true)
    })
  })

  describe('the extra detail on a characteristic', () => {
    function toggle(name: string) {
      return screen.getByRole('button', { name })
    }

    it('opens the detail of one with a range', () => {
      open(hapService({ characteristics: [characteristic('Brightness', 50, { minValue: 0, maxValue: 100, description: 'Brightness' } as any)] }))

      fireEvent.click(toggle('Brightness'))

      expect(toggle('Brightness')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Max: 100')).toBeInTheDocument()
    })

    it('closes it again', () => {
      open(hapService({ characteristics: [characteristic('Brightness', 50, { minStep: 1, description: 'Brightness' } as any)] }))

      fireEvent.click(toggle('Brightness'))
      fireEvent.click(toggle('Brightness'))

      expect(toggle('Brightness')).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens the detail of one with a list of valid values', () => {
      open(hapService({ characteristics: [characteristic('TargetHeatingCoolingState', 0, { validValues: [0, 1, 2], description: 'Mode' } as any)] }))

      fireEvent.keyDown(toggle('Mode'), { key: 'Enter' })

      expect(screen.getByText('Valid: 0 · 1 · 2')).toBeInTheDocument()
    })

    it('has no toggle for one with no detail to show', () => {
      // Otherwise the row grows a toggle that opens an empty panel
      open(hapService({ characteristics: [characteristic('On', false, { description: 'Power' } as any)] }))

      expect(screen.queryByRole('button', { name: 'Power' })).toBeNull()
    })

    it('formats a boolean value', () => {
      open(hapService({ characteristics: [characteristic('On', false, { description: 'Power' } as any)] }))

      expect(screen.getAllByText('false (status.widget.info.no)')).toHaveLength(2)
    })
  })

  describe('naming a characteristic value', () => {
    it('turns a numeric state into the name HAP gives it', () => {
      expect(getEnumLabel('CurrentDoorState', 0)).toBeDefined()
    })

    it('says nothing for a characteristic with no named values', () => {
      expect(getEnumLabel('NotACharacteristic', 3)).toBeUndefined()
    })
  })

  describe('copying an identifier', () => {
    let clipboard: { writeText: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      clipboard = { writeText: vi.fn(async () => undefined) }
      Object.defineProperty(window.navigator, 'clipboard', { value: clipboard, configurable: true })
    })

    const copyButtons = () => screen.getAllByRole('button', { name: 'common.a11y.copy_to_clipboard' })

    async function copy(index = 0) {
      await act(async () => {
        fireEvent.click(copyButtons()[index])
        await Promise.resolve()
      })
    }

    const copied = () => screen.queryAllByText('common.a11y.copied').length > 0

    it('copies the unique id', async () => {
      open(hapService({ uniqueId: 'the-unique-id' }))

      await copy()

      expect(clipboard.writeText).toHaveBeenCalledWith('the-unique-id')
    })

    it('shows that it copied, then stops saying so', async () => {
      vi.useFakeTimers()
      open(hapService({ uniqueId: 'the-unique-id' }))

      await copy()
      expect(copied()).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(copied()).toBe(false)
    })

    it('starts the three seconds again on a second copy', async () => {
      // Otherwise the tick disappears halfway through the second copy
      vi.useFakeTimers()
      open(hapService({ uniqueId: 'the-unique-id' }))

      await copy()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      await copy()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })

      expect(copied()).toBe(true)
    })

    it('copies the cached accessory uuid', async () => {
      open(hapService(), { accessoryCache: [cached({ uuid: 'cached-uuid-here' })] })

      await copy(1)

      expect(clipboard.writeText).toHaveBeenCalledWith('cached-uuid-here')
    })

    it('offers no uuid to copy when there is no cached accessory', () => {
      open(hapService())

      expect(copyButtons()).toHaveLength(1)
    })

    it('still copies when the clipboard api is refused', async () => {
      // iOS Safari rejects outside a user gesture, so there is a textarea
      // fallback - and the tick has to appear either way
      clipboard.writeText.mockRejectedValue(new Error('not allowed'))
      const execCommand = vi.fn(() => true)
      ;(document as any).execCommand = execCommand
      open(hapService({ uniqueId: 'the-unique-id' }))

      await copy()
      await act(async () => {
        await Promise.resolve()
      })

      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(copied()).toBe(true)
      // It appends one off-screen to select the text out of; leaving it
      // attached would litter the page with one per copy
      expect(document.querySelectorAll('textarea')).toHaveLength(0)
    })

    it('forgets its timers when the modal closes', async () => {
      vi.useFakeTimers()
      const { unmount } = open(hapService({ uniqueId: 'the-unique-id' }))

      await copy()
      unmount()

      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('removing the accessory from the cache', () => {
    function remove() {
      fireEvent.click(screen.getByRole('button', { name: 'accessories.button_remove' }))
    }

    it('closes itself first, so the two modals do not stack', () => {
      open(hapService(), { accessoryCache: [cached()] })

      remove()

      expect(activeModal.close).toHaveBeenCalled()
      expect(modal.opened).toHaveLength(1)
      expect(modal.lastOpened()!.component).toBe(RemoveIndividualAccessories)
    })

    it('points the remove modal at this accessory bridge and highlights the matched entry', () => {
      // The username without its colons is the id the remove page uses
      open(hapService(), { accessoryCache: [cached({ uuid: 'the-one', cacheFile: 'cachedAccessories' })] })

      remove()

      expect(modal.propsFor()).toEqual({
        selectedBridge: '0E123456789A',
        highlightUuid: 'the-one',
        highlightCacheFile: 'cachedAccessories',
      })
    })

    it('opens it as a large modal that cannot be clicked away', () => {
      // Deleting a pairing is destructive
      open(hapService(), { accessoryCache: [cached()] })

      remove()

      expect(modal.lastOpened()!.options).toMatchObject({ size: 'lg', backdrop: 'static' })
    })
  })

  describe('opened without the data it needs', () => {
    it.each([
      ['no service', { service: undefined }],
      ['no accessory cache', { accessoryCache: undefined }],
      ['no pairing cache', { pairingCache: undefined }],
    ])('closes itself when handed %s', (_label, missing) => {
      // A half-built modal would throw on the first expression, leaving a
      // blank grey box the user cannot get out of
      activeModal = { close: vi.fn<(value?: any) => void>(), dismiss: vi.fn<(reason?: unknown) => void>(), update: vi.fn<() => void>() }
      const props = { service: hapService(), accessoryCache: [], pairingCache: [pairing()], ...missing } as any
      renderWithProviders(<AccessoryInfo activeModal={activeModal} {...props} />)

      expect(activeModal.dismiss).toHaveBeenCalledWith('Missing required data')
      expect(console.error).toHaveBeenCalled()
    })
  })
})
