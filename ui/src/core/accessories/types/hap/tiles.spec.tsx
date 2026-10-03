import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { CharSpec } from '@/core/accessories/types/hap/hap.spec-helpers'
import type { FakeOpenModal } from '@/testing'
import type { ComponentType } from 'react'

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AccessCodeTile } from '@/core/accessories/types/hap/access-code/AccessCodeTile'
import { airPurifierIsOn, airPurifierIsPurifying } from '@/core/accessories/types/hap/air-purifier/air-purifier.utils'
import { AirPurifierTile } from '@/core/accessories/types/hap/air-purifier/AirPurifierTile'
import { DoorTile } from '@/core/accessories/types/hap/door/DoorTile'
import { DoorbellManage } from '@/core/accessories/types/hap/doorbell/DoorbellManage'
import { DoorbellTile } from '@/core/accessories/types/hap/doorbell/DoorbellTile'
import { FanTile } from '@/core/accessories/types/hap/fan/FanTile'
import { FilterMaintenanceTile } from '@/core/accessories/types/hap/filter-maintenance/FilterMaintenanceTile'
import { GarageDoorOpenerTile } from '@/core/accessories/types/hap/garage-door-opener/GarageDoorOpenerTile'
import { longPress, renderTile, serviceWith, writesTo } from '@/core/accessories/types/hap/hap.spec-helpers'
import { HeaterCoolerTile } from '@/core/accessories/types/hap/heater-cooler/HeaterCoolerTile'
import { HumidifierDehumidifierTile } from '@/core/accessories/types/hap/humidifier-dehumidifier/HumidifierDehumidifierTile'
import { IrrigationSystemTile } from '@/core/accessories/types/hap/irrigation-system/IrrigationSystemTile'
import { getBrightnessLabel, getBulbFill } from '@/core/accessories/types/hap/lightbulb/lightbulb.utils'
import { LightbulbTile } from '@/core/accessories/types/hap/lightbulb/LightbulbTile'
import { LockMechanismTile } from '@/core/accessories/types/hap/lock-mechanism/LockMechanismTile'
import { MicrophoneManage } from '@/core/accessories/types/hap/microphone/MicrophoneManage'
import { MicrophoneTile } from '@/core/accessories/types/hap/microphone/MicrophoneTile'
import { OutletTile } from '@/core/accessories/types/hap/outlet/OutletTile'
import { RobotVacuumTile } from '@/core/accessories/types/hap/robot-vacuum/RobotVacuumTile'
import { SecuritySystemTile } from '@/core/accessories/types/hap/security-system/SecuritySystemTile'
import { SpeakerManage } from '@/core/accessories/types/hap/speaker/SpeakerManage'
import { SpeakerTile } from '@/core/accessories/types/hap/speaker/SpeakerTile'
import { StatelessProgrammableSwitchTile } from '@/core/accessories/types/hap/stateless-programmable-switch/StatelessProgrammableSwitchTile'
import { switchIsOn } from '@/core/accessories/types/hap/switch/switch.utils'
import { SwitchTile } from '@/core/accessories/types/hap/switch/SwitchTile'
import { TelevisionTile } from '@/core/accessories/types/hap/television/TelevisionTile'
import { ThermostatTile } from '@/core/accessories/types/hap/thermostat/ThermostatTile'
import { UnknownTile } from '@/core/accessories/types/hap/unknown/UnknownTile'
import { ValveTile } from '@/core/accessories/types/hap/valve/ValveTile'
import { WashingMachineTile } from '@/core/accessories/types/hap/washing-machine/WashingMachineTile'
import { WindowCoveringTile } from '@/core/accessories/types/hap/window-covering/WindowCoveringTile'
import { WindowTile } from '@/core/accessories/types/hap/window/WindowTile'
import * as modalModule from '@/core/ui/modal'
import { characteristic, hapService } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

const modal = modalModule as unknown as FakeOpenModal

type Tile = ComponentType<{ service: ServiceTypeX, readyForControl?: boolean }>

/**
 * The HAP accessory tiles — the thing you actually tap on the accessories page.
 *
 * ⚠️ **A tap must do nothing until the bridge is ready for control.** Before that
 * point the socket has no route to the accessory, so the write is dropped — but
 * the tile has already flipped itself to look as though it worked, and the user
 * is left staring at a light that says on and isn't. The first block asserts that
 * guard on **every** tile, along with which characteristic each one reaches for,
 * so a new tile added without the guard fails immediately.
 */
describe('the HAP accessory tiles', () => {
  beforeEach(() => {
    modal.opened.length = 0
    modal.openModal.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  interface TileCase {
    name: string
    type: Tile
    chars: CharSpec[]
    /** The characteristic and value a tap should write, once ready. */
    write: [string, any]
  }

  interface ModalTileCase {
    name: string
    type: Tile
    chars: CharSpec[]
  }

  // Every interactive tile, with the characteristic a plain tap reaches for.
  const TILES: TileCase[] = [
    { name: 'switch', type: SwitchTile, chars: [['On', false]], write: ['On', true] },
    { name: 'outlet', type: OutletTile, chars: [['On', false]], write: ['On', true] },
    { name: 'lightbulb', type: LightbulbTile, chars: [['On', false]], write: ['On', true] },
    { name: 'fan', type: FanTile, chars: [['On', false]], write: ['On', true] },
    { name: 'air purifier', type: AirPurifierTile, chars: [['On', false]], write: ['On', true] },
    { name: 'heater cooler', type: HeaterCoolerTile, chars: [['On', false]], write: ['On', true] },
    { name: 'humidifier', type: HumidifierDehumidifierTile, chars: [['On', false]], write: ['On', true] },
    { name: 'valve', type: ValveTile, chars: [['On', false]], write: ['On', true] },
    { name: 'robot vacuum', type: RobotVacuumTile, chars: [['On', false]], write: ['On', true] },
    { name: 'washing machine', type: WashingMachineTile, chars: [['On', false]], write: ['On', true] },
    { name: 'garage door opener', type: GarageDoorOpenerTile, chars: [['On', false]], write: ['On', true] },
    { name: 'television', type: TelevisionTile, chars: [['On', false]], write: ['On', true] },
    { name: 'speaker', type: SpeakerTile, chars: [['On', false]], write: ['On', true] },
    { name: 'microphone', type: MicrophoneTile, chars: [['On', false]], write: ['On', true] },
    { name: 'doorbell', type: DoorbellTile, chars: [['On', false]], write: ['On', true] },
    { name: 'lock mechanism', type: LockMechanismTile, chars: [['On', false]], write: ['On', true] },
    { name: 'door', type: DoorTile, chars: [['TargetPosition', 0]], write: ['TargetPosition', 100] },
    { name: 'window', type: WindowTile, chars: [['TargetPosition', 0]], write: ['TargetPosition', 100] },
    { name: 'window covering', type: WindowCoveringTile, chars: [['TargetPosition', 0]], write: ['TargetPosition', 100] },
  ]

  // Three tiles have nothing to toggle, so a tap opens their manage modal
  const MODAL_TILES: ModalTileCase[] = [
    { name: 'thermostat', type: ThermostatTile, chars: [['TargetTemperature', 21], ['CurrentTemperature', 20]] },
    { name: 'security system', type: SecuritySystemTile, chars: [['SecuritySystemTargetState', 3]] },
    { name: 'filter maintenance', type: FilterMaintenanceTile, chars: [['FilterChangeIndication', 0]] },
  ]

  describe.each(TILES.map(tile => [tile.name, tile] as const))('the %s tile', (_name, tile) => {
    it('writes nothing until the bridge is ready for control', () => {
      const service = serviceWith(tile.chars)
      const view = renderTile(tile.type, service, false)

      view.tap()

      expect(writesTo(service)).toEqual([])
    })

    it('writes on a tap once the bridge is ready', () => {
      const service = serviceWith(tile.chars)
      const view = renderTile(tile.type, service, true)

      view.tap()

      expect(writesTo(service)).toEqual([{ type: tile.write[0], value: tile.write[1] }])
    })

    it.each([['Enter', 'Enter'], ['Space', ' ']])('writes exactly once on %s', (_keyName, key) => {
      // ⚠️ The tile and the long-press hook both used to answer Enter, so the
      // switch toggled on and straight back off
      const service = serviceWith(tile.chars)
      const view = renderTile(tile.type, service, true)

      view.press(key)

      expect(writesTo(service)).toEqual([{ type: tile.write[0], value: tile.write[1] }])
    })

    it('tells a screen reader what it is and what state it is in', () => {
      // A focusable div with no role or name reads as an empty "group"
      const service = serviceWith(tile.chars)
      service.customName = 'Hallway'
      const box = renderTile(tile.type, service, true).box()

      expect(['switch', 'button']).toContain(box.getAttribute('role'))
      expect(box.getAttribute('aria-label')).toMatch(/^Hallway, /)
      if (box.getAttribute('role') === 'switch') {
        expect(box).toHaveAttribute('aria-checked', 'false')
      }
    })

    it('writes nothing on the keyboard long press', () => {
      const service = serviceWith(tile.chars)
      const view = renderTile(tile.type, service, true)

      view.press('Enter', { shiftKey: true })

      expect(writesTo(service)).toEqual([])
    })
  })

  describe('opening the manage modal from the keyboard', () => {
    it.each([
      ['Shift+Enter', 'Enter', { shiftKey: true }],
      ['Shift+F10', 'F10', { shiftKey: true }],
      ['the context menu key', 'ContextMenu', {}],
    ])('opens it on %s, without toggling the accessory', (_name, key, init) => {
      const service = serviceWith([['TargetPosition', 0], ['CurrentPosition', 0], ['PositionState', 2]])
      const view = renderTile(DoorTile, service, true)

      view.press(key, init)

      expect(modal.opened).toHaveLength(1)
      expect(writesTo(service)).toEqual([])
    })

    it('opens nothing until the bridge is ready for control', () => {
      const view = renderTile(DoorTile, serviceWith([['TargetPosition', 0]]), false)

      view.press('Enter', { shiftKey: true })

      expect(modal.opened).toEqual([])
    })
  })

  describe.each(MODAL_TILES.map(tile => [tile.name, tile] as const))('the %s tile', (_name, tile) => {
    it('opens nothing until the bridge is ready for control', () => {
      const view = renderTile(tile.type, serviceWith(tile.chars), false)

      view.tap()

      expect(modal.opened).toEqual([])
    })

    it('is announced as a button with its name', () => {
      const service = serviceWith(tile.chars)
      service.customName = 'Hallway'
      const box = renderTile(tile.type, service, true).box()

      expect(box).toHaveAttribute('role', 'button')
      expect(box.getAttribute('aria-label')).toMatch(/^Hallway, /)
    })

    it('opens its manage modal on a tap once the bridge is ready', () => {
      const service = serviceWith(tile.chars)
      const view = renderTile(tile.type, service, true)

      view.tap()

      expect(modal.opened).toHaveLength(1)
      expect(writesTo(service)).toEqual([])
    })
  })

  // switch and outlet are copies of one another, and carry the longest
  // precedence chain in the app: one tile stands in for any accessory a plugin
  // exposed as a generic switch, whatever it actually is underneath
  describe.each([
    ['switch', SwitchTile as Tile],
    ['outlet', OutletTile as Tile],
  ])('the %s tile on an accessory of any kind', (_name, type) => {
    describe('reading whether it is on', () => {
      it.each([
        ['On true', [['On', true]], true],
        ['On false', [['On', false]], false],
        ['Active 1', [['Active', 1]], true],
        ['Active 0', [['Active', 0]], false],
        ['a playing media state', [['CurrentMediaState', 0]], true],
        ['a paused media state', [['CurrentMediaState', 1]], true],
        ['a stopped media state', [['CurrentMediaState', 2]], false],
        ['unmuted with volume', [['Mute', false], ['Volume', 50]], true],
        ['unmuted at zero volume', [['Mute', false], ['Volume', 0]], false],
        ['muted', [['Mute', true], ['Volume', 50]], false],
        ['an unlocked lock', [['LockTargetState', 0]], true],
        ['a locked lock', [['LockTargetState', 1]], false],
        ['an open door', [['CurrentDoorState', 0]], true],
        ['a closing door', [['CurrentDoorState', 2]], true],
        ['a closed door', [['CurrentDoorState', 1]], false],
      ])('reads %s', (_label, chars, expected) => {
        const service = serviceWith(chars as CharSpec[])
        const view = renderTile(type, service)

        expect(switchIsOn(service)).toBe(expected)
        expect(view.box().classList.contains('accessory-on')).toBe(expected)
      })

      it('reads an accessory it cannot interpret as off', () => {
        const view = renderTile(type, serviceWith([['ProgramMode', 0]]))

        expect(view.box()).not.toHaveClass('accessory-on')
      })

      it('prefers On over everything else when the accessory has both', () => {
        // The chain is a precedence order, not a set of alternatives
        const view = renderTile(type, serviceWith([['On', true], ['Active', 0]]))

        expect(view.box()).toHaveClass('accessory-on')
      })
    })

    describe('what a tap writes', () => {
      it.each([
        ['On', [['On', false]], ['On', true]],
        ['On, switching off', [['On', true]], ['On', false]],
        ['Active as a number', [['Active', 0]], ['Active', 1]],
        ['Active back to zero', [['Active', 1]], ['Active', 0]],
        ['a media state', [['TargetMediaState', 0]], ['TargetMediaState', 1]],
        ['Mute', [['Mute', false]], ['Mute', true]],
        ['a lock', [['LockTargetState', 0]], ['LockTargetState', 1]],
        ['a door', [['TargetDoorState', 0]], ['TargetDoorState', 1]],
      ])('writes %s', (_label, chars, expected) => {
        const service = serviceWith(chars as CharSpec[])
        const view = renderTile(type, service)

        view.tap()

        expect(writesTo(service)).toEqual([{ type: expected[0], value: expected[1] }])
      })

      it('writes nothing at all for an accessory it cannot interpret', () => {
        // Rather than throwing on a null characteristic
        const service = serviceWith([['ProgramMode', 0]])
        const view = renderTile(type, service)

        expect(() => view.tap()).not.toThrow()
        expect(writesTo(service)).toEqual([])
      })
    })

    describe('power consumption', () => {
      it('shows the reading when the accessory reports one', () => {
        const view = renderTile(type, serviceWith([['On', true], ['Consumption', 42]]))

        expect(view.container.querySelector('.accessory-label.grey-text')?.textContent).toContain('42W')
      })

      it('shows nothing when it does not', () => {
        const view = renderTile(type, serviceWith([['On', true]]))

        expect(view.container.querySelector('.accessory-label.grey-text')?.textContent).not.toContain('W')
      })
    })
  })

  describe('the switch tile for a screen reader', () => {
    it('announces the name, the type and the state', () => {
      const view = renderTile(SwitchTile, serviceWith([['On', true]]))

      expect(view.box()).toHaveAttribute('role', 'switch')
      expect(view.box()).toHaveAttribute('aria-checked', 'true')
      expect(view.box()).toHaveAttribute('aria-label', 'Test Accessory, accessories.core.switch, accessories.control.on')
    })
  })

  describe('the lightbulb tile', () => {
    const noAdaptive = { has: false, enabled: false }

    it('paints nothing when the bulb is off', () => {
      expect(getBulbFill(serviceWith([['On', false], ['Hue', 120], ['Saturation', 100]]))).toBe('none')
    })

    it('paints a colour bulb in its own hue', () => {
      const view = renderTile(LightbulbTile, serviceWith([['On', true], ['Hue', 120], ['Saturation', 100]]))

      expect(view.container.querySelector('path')).toHaveAttribute('fill', 'hsl(120, 100%, 50%)')
    })

    it('paints a colour temperature bulb by converting its mireds', () => {
      const fill = getBulbFill(serviceWith([['On', true], ['ColorTemperature', 250]]))

      // 250 mireds is 4000K, a neutral white
      expect(fill).toMatch(/^hsl\(/)
      expect(fill).not.toBe('none')
    })

    it('paints a plain white bulb the default warm colour', () => {
      expect(getBulbFill(serviceWith([['On', true]]))).toBe('#ffcf55')
    })

    it('shows the brightness as a percentage while on', () => {
      const view = renderTile(LightbulbTile, serviceWith([['On', true], ['Brightness', 60]]))

      expect(view.container.querySelector('.accessory-label.grey-text')?.textContent).toBe('60%')
    })

    it('shows no brightness label while off', () => {
      expect(getBrightnessLabel(serviceWith([['On', false], ['Brightness', 60]]), noAdaptive)).toBe('')
    })

    it('adds the power reading to the brightness label', () => {
      const label = getBrightnessLabel(serviceWith([['On', true], ['Brightness', 60], ['Consumption', 9]]), noAdaptive)

      expect(label).toContain('60%')
      expect(label).toContain('9W')
    })

    it('offers adaptive lighting only to a bulb that supports it', () => {
      const withIt = renderTile(LightbulbTile, serviceWith([['On', true], ['Brightness', 60], ['CharacteristicValueActiveTransitionCount', 1]]))
      expect(withIt.container.querySelector('.fa-sun')).toHaveClass('on-text')
      withIt.unmount()

      const without = renderTile(LightbulbTile, serviceWith([['On', true], ['Brightness', 60]]))
      expect(without.container.querySelector('.fa-sun')).toBeNull()
    })

    it('reads adaptive lighting as off when the transition count is zero', () => {
      // The characteristic is present but the feature is not in use
      const view = renderTile(LightbulbTile, serviceWith([['On', true], ['CharacteristicValueActiveTransitionCount', 0]]))

      expect(view.container.querySelector('.fa-sun')).toHaveClass('grey-text')
    })

    it('marks the adaptive lighting icon as active in the label', () => {
      const service = serviceWith([['On', true], ['Brightness', 60], ['CharacteristicValueActiveTransitionCount', 1]])

      expect(getBrightnessLabel(service, { has: true, enabled: true })).toContain('on-text')
    })

    it('greys the adaptive lighting icon when it is switched off', () => {
      const service = serviceWith([['On', true], ['Brightness', 60], ['CharacteristicValueActiveTransitionCount', 0]])

      expect(getBrightnessLabel(service, { has: true, enabled: false })).toContain('grey-text')
    })

    it('picks up adaptive lighting switching on at the next poll', () => {
      vi.useFakeTimers()
      const service = serviceWith([['On', true], ['Brightness', 60], ['CharacteristicValueActiveTransitionCount', 0]])
      const view = renderTile(LightbulbTile, service)

      service.values.CharacteristicValueActiveTransitionCount = 1
      act(() => {
        vi.advanceTimersByTime(30000)
      })

      expect(view.container.querySelector('.fa-sun')).toHaveClass('on-text')
    })

    it('moves the slider to full when switching on a bulb sitting at zero', () => {
      // So the long-press modal opens showing a usable brightness
      const service = serviceWith([['On', false], ['Brightness', 0, { maxValue: 100 }]])
      const view = renderTile(LightbulbTile, service)

      view.tap()

      expect(service.values.Brightness).toBe(100)
    })

    describe('a long press', () => {
      beforeEach(() => {
        vi.useFakeTimers()
      })

      it('opens the manage modal for a dimmable bulb', async () => {
        const view = renderTile(LightbulbTile, serviceWith([['On', true], ['Brightness', 60]]))

        await longPress(view.container)

        expect(modal.opened).toHaveLength(1)
        expect(modal.lastOpened()!.options?.backdrop).toBe('static')
        expect(modal.lastOpened()!.props?.adaptiveLighting).toBeUndefined()
      })

      it('hands the modal the live adaptive lighting state of a bulb that has it', async () => {
        const view = renderTile(LightbulbTile, serviceWith([['On', true], ['Brightness', 60], ['CharacteristicValueActiveTransitionCount', 1]]))

        await longPress(view.container)

        expect(modal.lastOpened()!.props?.adaptiveLighting.get()).toBe(true)
      })

      it('opens nothing for a bulb with only on and off', async () => {
        // There would be no controls to show
        const view = renderTile(LightbulbTile, serviceWith([['On', true]]))

        await longPress(view.container)

        expect(modal.opened).toEqual([])
      })

      it('opens nothing until the bridge is ready for control', async () => {
        const view = renderTile(LightbulbTile, serviceWith([['On', true], ['Brightness', 60]]), false)

        await longPress(view.container)

        expect(modal.opened).toEqual([])
      })
    })
  })
  describe('the tiles with state of their own', () => {
    describe('the fan', () => {
      const label = (view: { container: HTMLElement }) => view.container.querySelector('.accessory-label.grey-text')?.textContent

      it('shows a percentage unit when the accessory reports one', () => {
        const service = serviceWith([['On', true], ['RotationSpeed', 50, { unit: 'percentage' }]])

        expect(label(renderTile(FanTile, service))).toBe('50%')
      })

      it('shows no unit when the accessory does not say', () => {
        const service = serviceWith([['On', true], ['RotationSpeed', 3]])

        expect(label(renderTile(FanTile, service))).toBe('3')
      })

      it('knows whether the fan can reverse', () => {
        const forwards = renderTile(FanTile, serviceWith([['On', true], ['RotationDirection', 0]]))
        expect(forwards.container.querySelector('.accessory-svg')).toHaveClass('spin')
        forwards.unmount()

        const reversed = renderTile(FanTile, serviceWith([['On', true], ['RotationDirection', 1]]))
        expect(reversed.container.querySelector('.accessory-svg')).toHaveClass('spin-counter')
        reversed.unmount()

        const without = renderTile(FanTile, serviceWith([['On', true]]))
        expect(without.container.querySelector('.accessory-svg')).toHaveClass('spin')
        expect(without.container.querySelector('.accessory-svg')).not.toHaveClass('spin-counter')
      })

      it('winds a fan left at zero up to full when it is switched on', () => {
        // ⚠️ Otherwise the fan reports itself on and does not move, because the
        // speed it was left at is 0
        const service = serviceWith([['On', false], ['RotationSpeed', 0, { maxValue: 100 }]])

        renderTile(FanTile, service).tap()

        expect(service.values.RotationSpeed).toBe(100)
      })

      it('leaves a speed the fan already had alone', () => {
        const service = serviceWith([['On', false], ['RotationSpeed', 40, { maxValue: 100 }]])

        renderTile(FanTile, service).tap()

        expect(service.values.RotationSpeed).toBe(40)
      })

      it('leaves the speed alone when switching a running fan off', () => {
        const service = serviceWith([['On', true], ['RotationSpeed', 0, { maxValue: 100 }]])

        renderTile(FanTile, service).tap()

        expect(service.values.RotationSpeed).toBe(0)
      })

      it('writes the active flag on a fan that has one instead', () => {
        const service = serviceWith([['Active', 1]])

        renderTile(FanTile, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'Active', value: 0 }])
      })

      it.each([
        ['a speed control', [['On', true], ['RotationSpeed', 50]]],
        ['a direction control', [['On', true], ['RotationDirection', 0]]],
      ])('opens its modal on a long press for a fan with %s', async (_label, chars) => {
        vi.useFakeTimers()
        await renderTile(FanTile, serviceWith(chars as CharSpec[])).longPress()

        expect(modal.opened).toHaveLength(1)
      })

      it('opens nothing for a plain on/off fan', async () => {
        vi.useFakeTimers()
        await renderTile(FanTile, serviceWith([['On', true]])).longPress()

        expect(modal.opened).toEqual([])
      })
    })

    describe('the air purifier', () => {
      /**
       * What the tile makes of a set of characteristics.
       * @param chars - the characteristics the accessory reports
       */
      function states(chars: CharSpec[]) {
        const service = serviceWith(chars)
        const view = renderTile(AirPurifierTile, service)
        const result = { on: airPurifierIsOn(service), purifying: airPurifierIsPurifying(service) }
        expect(view.box().classList.contains('accessory-on')).toBe(result.on)
        expect(view.box().classList.contains('purifying')).toBe(result.purifying)
        return result
      }

      it('is on and purifying when active with nothing more to say', () => {
        expect(states([['Active', 1]])).toEqual({ on: true, purifying: true })
      })

      it('is off when not active', () => {
        expect(states([['Active', 0]])).toEqual({ on: false, purifying: false })
      })

      it('is on but idle while active and only circulating', () => {
        // ⚠️ 1 is idle, 2 is purifying. A tile that reads idle as purifying tells
        // the user the air is being cleaned when the fan is merely on
        expect(states([['Active', 1], ['CurrentAirPurifierState', 1]])).toEqual({ on: true, purifying: false })
      })

      it('says it is idle then', () => {
        const view = renderTile(AirPurifierTile, serviceWith([['Active', 1], ['CurrentAirPurifierState', 1]]))

        expect(view.box()).toHaveAttribute('aria-label', 'Test Accessory, accessories.core.air_purifier, accessories.control.idle')
      })

      it('is on and purifying while active and purifying', () => {
        expect(states([['Active', 1], ['CurrentAirPurifierState', 2]])).toEqual({ on: true, purifying: true })
      })

      it('is off while active but inactive underneath', () => {
        expect(states([['Active', 1], ['CurrentAirPurifierState', 0]])).toEqual({ on: false, purifying: false })
      })

      it('reads a purifier published as a plain switch', () => {
        expect(states([['On', true]])).toEqual({ on: true, purifying: true })
      })

      it('opens its modal when there are modes to choose from', async () => {
        vi.useFakeTimers()
        const service = serviceWith([['Active', 1], ['TargetAirPurifierState', 1, { validValues: [0, 1] }]])

        await renderTile(AirPurifierTile, service).longPress()

        expect(modal.opened).toHaveLength(1)
      })

      it('opens its modal when there is a speed to set', async () => {
        vi.useFakeTimers()
        await renderTile(AirPurifierTile, serviceWith([['Active', 1], ['RotationSpeed', 50]])).longPress()

        expect(modal.opened).toHaveLength(1)
      })

      it('opens nothing when the purifier offers no choices', async () => {
        vi.useFakeTimers()
        const service = serviceWith([['Active', 1], ['TargetAirPurifierState', 1, { validValues: [] }]])

        await renderTile(AirPurifierTile, service).longPress()

        expect(modal.opened).toEqual([])
      })
    })

    describe('the consumption reading these share', () => {
      const SHARED: Array<[string, Tile]> = [
        ['fan', FanTile],
        ['television', TelevisionTile],
        ['lock', LockMechanismTile],
        ['air purifier', AirPurifierTile],
      ]

      it.each(SHARED)('reports what a %s measures', (_name, tile) => {
        // (A lock shows it while unlocked)
        const view = renderTile(tile, serviceWith([['On', true], ['LockCurrentState', 0], ['Consumption', 7.5]]))

        expect(view.container.textContent).toContain('7.5W')
      })

      it.each(SHARED)('reports nothing for a %s that does not measure it', (_name, tile) => {
        const view = renderTile(tile, serviceWith([['On', true], ['LockCurrentState', 0]]))

        expect(view.container.querySelectorAll('.accessory-label')[1].textContent).not.toContain('W')
      })
    })
  })

  /**
   * The long press and the power reading on the last four tiles.
   *
   * Each of these opens a manage modal only when the accessory actually has
   * something to manage — a heater with no mode to set, or a bulb that is only
   * on/off, would open an empty panel.
   */
  describe('the remaining long presses', () => {
    interface LongPressCase {
      name: string
      type: Tile
      /** Characteristics that should open the modal. */
      opens: CharSpec[]
      /** Characteristics that should not. */
      opensNothing: CharSpec[]
    }

    const CASES: LongPressCase[] = [
      {
        name: 'heater cooler',
        type: HeaterCoolerTile,
        opens: [['Active', 1], ['TargetHeaterCoolerState', 0]],
        opensNothing: [['Active', 1]],
      },
      {
        name: 'humidifier',
        type: HumidifierDehumidifierTile,
        opens: [['Active', 1], ['TargetHumidifierDehumidifierState', 1]],
        opensNothing: [['Active', 1]],
      },
      {
        name: 'garage door opener',
        type: GarageDoorOpenerTile,
        opens: [['TargetDoorState', 1], ['CurrentDoorState', 1]],
        opensNothing: [['On', false]],
      },
      {
        name: 'lightbulb',
        type: LightbulbTile,
        opens: [['On', true], ['Brightness', 50]],
        opensNothing: [['On', true]],
      },
    ]

    describe.each(CASES.map(c => [c.name, c] as const))('the %s', (_name, testCase) => {
      beforeEach(() => {
        vi.useFakeTimers()
      })

      it('opens its manage modal when there is something to manage', async () => {
        await renderTile(testCase.type, serviceWith(testCase.opens)).longPress()

        expect(modal.opened).toHaveLength(1)
        expect(modal.lastOpened()!.options).toMatchObject({ backdrop: 'static' })
      })

      it('opens nothing when there is not', async () => {
        await renderTile(testCase.type, serviceWith(testCase.opensNothing)).longPress()

        expect(modal.opened).toEqual([])
      })

      it('opens nothing before the bridge is ready for control', async () => {
        // ⚠️ The same guard as a tap: the modal would write to an accessory the
        // socket has no route to
        await renderTile(testCase.type, serviceWith(testCase.opens), false).longPress()

        expect(modal.opened).toEqual([])
      })

      it('passes the service into the modal', async () => {
        const service = serviceWith(testCase.opens)

        await renderTile(testCase.type, service).longPress()

        expect(modal.propsFor()?.service).toBe(service)
      })

      it.skipIf(testCase.name === 'garage door opener')('reports the power it measures', () => {
        // (The garage door only shows it when published as a switch, see below)
        const view = renderTile(testCase.type, serviceWith([...testCase.opens, ['Consumption', 42]]))

        expect(view.container.textContent).toContain('42W')
      })

      it('reports nothing when it measures no power', () => {
        const view = renderTile(testCase.type, serviceWith(testCase.opens))

        expect(view.container.textContent).not.toContain('W')
      })
    })

    describe('the on/off fallbacks these use', () => {
      it('switches a heater by its active flag', () => {
        const service = serviceWith([['Active', 1]])

        renderTile(HeaterCoolerTile, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'Active', value: 0 }])
      })

      it('switches a humidifier published as a plain switch', () => {
        const service = serviceWith([['On', false]])

        renderTile(HumidifierDehumidifierTile, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'On', value: true }])
      })

      it('switches a garage door published with an active flag', () => {
        // No door state at all: some plugins publish an opener as a switch
        const service = serviceWith([['Active', 0]])

        renderTile(GarageDoorOpenerTile, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'Active', value: true }])
      })

      it('switches a bulb by its active flag when it has no on', () => {
        const service = serviceWith([['Active', 1]])

        renderTile(LightbulbTile, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'Active', value: 0 }])
      })

      it('winds a bulb left at zero brightness up to full', () => {
        // ⚠️ Same trap as the fan: the bulb reports itself on and stays dark
        const service = serviceWith([['On', false], ['Brightness', 0, { maxValue: 100 }]])

        renderTile(LightbulbTile, service).tap()

        expect(service.values.Brightness).toBe(100)
      })
    })
  })

  /**
   * The two climate tiles that colour themselves by what the unit is doing
   * right now, rather than merely whether it is on.
   *
   * ⚠️ The order the two are tested in matters: the tile checks its first
   * direction before the second, so a unit reporting both would show the
   * first. `first` below is whichever the component tests first, which is NOT
   * the lower state value in both tiles.
   */
  describe('what colour a climate tile shows', () => {
    const CLIMATE_TILES = [
      [
        'humidifier dehumidifier',
        HumidifierDehumidifierTile,
        'CurrentHumidifierDehumidifierState',
        { state: 2, type: 'humidifier', fill: 'url(#humidifyingGradient)' },
        { state: 3, type: 'dehumidifier', fill: 'url(#dehumidifyingGradient)' },
      ],
      [
        'heater cooler',
        HeaterCoolerTile,
        'CurrentHeaterCoolerState',
        { state: 3, type: 'cooler', fill: 'url(#coolingGradient)' },
        { state: 2, type: 'heater', fill: 'url(#heatingGradient)' },
      ],
    ] as const

    const ON = '#42d672'
    const OFF = '#7b7b7b'

    /**
     * The status window fill of a climate tile, optionally a dedicated one-direction unit.
     * @param tile - the tile component
     * @param service - the accessory service it renders
     * @param unitType - the `type` prop, for a dedicated humidifier/heater/etc
     */
    function statusFill(tile: Tile, service: ServiceTypeX, unitType?: string) {
      const view = renderTile(tile, service, true, unitType ? { type: unitType } : {})
      return view.container.querySelector('rect[fill-opacity="0.5"]')!.getAttribute('fill')
    }

    describe.each(CLIMATE_TILES)('the %s tile', (_name, tile, stateChar, first, second) => {
      it(`shows the ${first.type} colour while it is working in that direction`, () => {
        expect(statusFill(tile, serviceWith([['Active', 1], [stateChar, first.state]]))).toBe(first.fill)
      })

      it(`shows the ${second.type} colour while it is working in that direction`, () => {
        expect(statusFill(tile, serviceWith([['Active', 1], [stateChar, second.state]]))).toBe(second.fill)
      })

      it('shows plain on when it is active but idle', () => {
        // Reporting a direction is not the same as running in it
        expect(statusFill(tile, serviceWith([['Active', 1], [stateChar, 0]]))).toBe(ON)
      })

      it('shows off when it is not active, whatever state it reports', () => {
        // A unit that never clears its state characteristic would otherwise
        // keep glowing after being switched off
        expect(statusFill(tile, serviceWith([['Active', 0], [stateChar, first.state]]))).toBe(OFF)
      })

      it(`colours a dedicated ${first.type} from its own tile type`, () => {
        // Published as a plain switch with no state characteristic: the tile
        // knows the direction only from the prop the accessory list gave it
        expect(statusFill(tile, serviceWith([['On', true]]), first.type)).toBe(first.fill)
      })

      it(`colours a dedicated ${second.type} from its own tile type`, () => {
        expect(statusFill(tile, serviceWith([['On', true]]), second.type)).toBe(second.fill)
      })

      it('leaves a dedicated unit that is off uncoloured', () => {
        expect(statusFill(tile, serviceWith([['On', false]]), first.type)).toBe(OFF)
      })

      it('switches it on and off again by its active flag', () => {
        // ⚠️ `Active` is numeric: writing a boolean here is silently ignored
        // by some accessories, which is why both directions are asserted
        const off = serviceWith([['Active', 0]])
        const on = serviceWith([['Active', 1]])

        renderTile(tile, off).tap()
        renderTile(tile, on).tap()

        expect(writesTo(off)).toEqual([{ type: 'Active', value: 1 }])
        expect(writesTo(on)).toEqual([{ type: 'Active', value: 0 }])
      })
    })

    it('shows the setpoints a heater cooler in auto is holding', () => {
      const view = renderTile(HeaterCoolerTile, serviceWith([
        ['Active', 1],
        ['TargetHeaterCoolerState', 0],
        ['HeatingThresholdTemperature', 18],
        ['CoolingThresholdTemperature', 24],
      ]))

      expect(view.container.querySelector('.accessory-label.grey-text')?.textContent).toBe(' 18°C - 24°C')
    })

    it('shows the thresholds a humidifier in auto is holding', () => {
      const view = renderTile(HumidifierDehumidifierTile, serviceWith([
        ['Active', 1],
        ['TargetHumidifierDehumidifierState', 0],
        ['RelativeHumidityHumidifierThreshold', 40],
        ['RelativeHumidityDehumidifierThreshold', 60],
      ]))

      expect(view.container.querySelector('.accessory-label.grey-text')?.textContent).toBe(' 40% - 60%')
    })
  })
  describe('the door and window tiles', () => {
    describe.each([
      ['door', DoorTile as Tile],
      ['window', WindowTile as Tile],
      ['window covering', WindowCoveringTile as Tile],
    ])('the %s tile', (_name, type) => {
      it('closes one that is open at all', () => {
        const service = serviceWith([['TargetPosition', 40]])

        renderTile(type, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'TargetPosition', value: 0 }])
      })

      it('opens one that is fully closed', () => {
        const service = serviceWith([['TargetPosition', 0]])

        renderTile(type, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'TargetPosition', value: 100 }])
      })

      it.each([
        [{ CurrentPosition: 0, PositionState: 2 }, 'accessories.control.closed'],
        [{ CurrentPosition: 40, PositionState: 2 }, 'accessories.control.open 40%'],
        [{ CurrentPosition: 100, PositionState: 2 }, 'accessories.control.open'],
        [{ CurrentPosition: 40, PositionState: 1 }, 'accessories.control.opening...'],
        [{ CurrentPosition: 40, PositionState: 0 }, 'accessories.control.closing...'],
      ])('shows %o as %s', (values, label) => {
        const view = renderTile(type, serviceWith(Object.entries(values)))

        expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe(label)
      })

      it('hands the position to the icon animation', () => {
        const view = renderTile(type, serviceWith([['CurrentPosition', 40]]))

        expect(view.box().style.getPropertyValue('--position')).toBe('0.4')
        expect(view.box()).toHaveClass('accessory-on')
      })

      it('opens its manage modal on a long press', async () => {
        vi.useFakeTimers()
        await renderTile(type, serviceWith([['TargetPosition', 0]])).longPress()

        expect(modal.opened).toHaveLength(1)
      })
    })

    it('announces a door for a screen reader', () => {
      const view = renderTile(DoorTile, serviceWith([['CurrentPosition', 0], ['PositionState', 2]]))

      expect(view.box()).toHaveAttribute('aria-label', 'Test Accessory, accessories.core.door, accessories.control.closed')
    })
  })
  describe('the garage door opener tile', () => {
    // HAP CurrentDoorState: 0 open, 1 closed, 2 opening, 3 closing, 4 stopped.
    // TargetDoorState: 0 open, 1 closed. A tap always means "do the opposite of
    // what you are doing", which is not the same as "toggle the target"
    function garage(current: number) {
      return serviceWith([['CurrentDoorState', current], ['TargetDoorState', 1]])
    }

    it.each([
      ['a closed door opens', 1, 0],
      ['a closing door reopens', 3, 0],
      ['an open door closes', 0, 1],
      ['an opening door closes', 2, 1],
    ])('%s', (_label, currentState, expected) => {
      const service = garage(currentState)

      renderTile(GarageDoorOpenerTile, service).tap()

      expect(writesTo(service)).toEqual([{ type: 'TargetDoorState', value: expected }])
    })

    it('reverses a door that was stopped part way while closing', () => {
      // A stopped door reports neither direction, so the tile has to remember
      // which way it was last going - reversing is what the user expects
      const view = renderTile(GarageDoorOpenerTile, garage(3))

      // It was closing, then the user stopped it
      const stopped = garage(4)
      view.setService(stopped)
      view.tap()

      expect(writesTo(stopped)).toEqual([{ type: 'TargetDoorState', value: 0 }])
    })

    it('reverses a door that was stopped part way while opening', () => {
      const view = renderTile(GarageDoorOpenerTile, garage(2))

      const stopped = garage(4)
      view.setService(stopped)
      view.tap()

      expect(writesTo(stopped)).toEqual([{ type: 'TargetDoorState', value: 1 }])
    })

    it('closes a door stopped before it ever moved', () => {
      // Nothing to reverse, so it falls through to the default
      const service = garage(4)

      renderTile(GarageDoorOpenerTile, service).tap()

      expect(writesTo(service)).toEqual([{ type: 'TargetDoorState', value: 1 }])
    })

    it('flags a door that resumed moving after being stopped', () => {
      // The tile shows a different animation for a resumed door
      const view = renderTile(GarageDoorOpenerTile, garage(4))
      expect(view.box()).not.toHaveClass('from-stopped')

      view.setService(garage(3))

      expect(view.box()).toHaveClass('from-stopped')
      expect(view.box()).toHaveClass('closing')
    })

    it('does not flag a door that started moving from rest', () => {
      const view = renderTile(GarageDoorOpenerTile, garage(1))

      view.setService(garage(2))

      expect(view.box()).not.toHaveClass('from-stopped')
    })

    it('falls back to On for an opener with no door state at all', () => {
      const service = serviceWith([['On', false]])

      renderTile(GarageDoorOpenerTile, service).tap()

      expect(writesTo(service)).toEqual([{ type: 'On', value: true }])
    })

    it('says when the door is obstructed', () => {
      const view = renderTile(GarageDoorOpenerTile, serviceWith([['CurrentDoorState', 1], ['ObstructionDetected', true]]))

      expect(view.box()).toHaveClass('obstructed')
      expect(view.box()).toHaveAttribute('aria-label', 'Test Accessory, accessories.core.garage_door_opener, accessories.control.closed (accessories.control.obstructed)')
      expect(view.container.querySelectorAll('.accessory-label')[1]).toHaveClass('red-text')
    })

    it('shows the power of an opener published as a switch', () => {
      const view = renderTile(GarageDoorOpenerTile, serviceWith([['On', true], ['Consumption', 42]]))

      expect(view.container.textContent).toContain('42W')
    })
  })
  describe('the lock', () => {
    it('locks a lock that is unlocked', () => {
      // ⚠️ 0 is secured and 1 is unsecured, the opposite way round from on/off
      const service = serviceWith([['LockTargetState', 1]])

      renderTile(LockMechanismTile, service).tap()

      expect(writesTo(service)).toEqual([{ type: 'LockTargetState', value: 0 }])
    })

    it('unlocks a lock that is locked', () => {
      const service = serviceWith([['LockTargetState', 0]])

      renderTile(LockMechanismTile, service).tap()

      expect(writesTo(service)).toEqual([{ type: 'LockTargetState', value: 1 }])
    })

    it('falls back to on for a lock published as a switch', () => {
      const service = serviceWith([['On', false]])

      renderTile(LockMechanismTile, service).tap()

      expect(writesTo(service)).toEqual([{ type: 'On', value: true }])
    })

    it('opens its management modal for a real lock', async () => {
      vi.useFakeTimers()
      await renderTile(LockMechanismTile, serviceWith([['LockTargetState', 0]])).longPress()

      expect(modal.opened).toHaveLength(1)
    })

    it('opens nothing for one published as a switch', async () => {
      vi.useFakeTimers()
      await renderTile(LockMechanismTile, serviceWith([['On', false]])).longPress()

      expect(modal.opened).toEqual([])
    })

    it.each([
      [0, 'unlocked', 'accessories.control.unlocked'],
      [1, undefined, 'accessories.control.locked'],
      [2, 'jammed', 'accessories.control.jammed'],
      [3, 'error', 'accessories.control.unknown'],
    ])('shows LockCurrentState %s', (state, cls, label) => {
      const view = renderTile(LockMechanismTile, serviceWith([['LockCurrentState', state]]))

      if (cls) {
        expect(view.box()).toHaveClass(cls)
      }
      expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe(label)
    })
  })

  describe('the security system tile', () => {
    function alarm(current: number, target: number) {
      return serviceWith([['SecuritySystemCurrentState', current], ['SecuritySystemTargetState', target]])
    }

    it.each([
      [0, 'home', 'accessories.control.home'],
      [1, 'away', 'accessories.control.away'],
      [2, 'night', 'accessories.control.night'],
      [4, 'triggered', 'accessories.control.triggered'],
    ])('shows a system settled in state %s', (state, cls, label) => {
      const view = renderTile(SecuritySystemTile, alarm(state, state === 4 ? 1 : state))

      expect(view.box()).toHaveClass(cls)
      expect(view.box()).toHaveClass('accessory-on')
      expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe(label)
    })

    it('shows a disarmed system as off', () => {
      const view = renderTile(SecuritySystemTile, alarm(3, 3))

      expect(view.box()).not.toHaveClass('accessory-on')
      expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe('accessories.control.off')
    })

    it('shows it arming, without the mode colour yet', () => {
      const view = renderTile(SecuritySystemTile, alarm(0, 1))

      expect(view.box()).not.toHaveClass('home')
      expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe('accessories.control.arming...')
    })

    it('shows it disarming', () => {
      const view = renderTile(SecuritySystemTile, alarm(1, 3))

      expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe('accessories.control.disarming...')
    })
  })

  it('shows an access code as what it is, with nothing to tap', () => {
    const service = serviceWith([['AccessCodeControlPoint', '']])
    const view = renderTile(AccessCodeTile, service)

    view.tap()

    expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe('accessories.core.access_code')
    expect(writesTo(service)).toEqual([])
  })
  /**
   * The media tiles: speaker, microphone and doorbell.
   *
   * ⚠️ **These have no single characteristic to toggle.** A speaker can
   * report `On`, `Active`, a media state, or only a mute flag, depending on the
   * plugin — so each one walks a fallback chain, and a tile that picks the wrong
   * rung either writes to a characteristic the accessory does not have (nothing
   * happens) or reads the wrong one and shows the opposite of the truth.
   */
  describe('the media tiles and their fallbacks', () => {
    /**
     * ⚠️ Speaker, microphone and doorbell were the **same component three times
     * over** in Angular; here they share one, and the table still runs over all
     * three so the wrappers cannot quietly drift apart.
     */
    const MEDIA_TILES: Array<[string, Tile, unknown]> = [
      ['speaker', SpeakerTile, SpeakerManage],
      ['microphone', MicrophoneTile, MicrophoneManage],
      ['doorbell', DoorbellTile, DoorbellManage],
    ]

    describe.each(MEDIA_TILES)('whether a %s reads as on', (_name, tile) => {
      /**
       * What the tile makes of a set of characteristics.
       * @param chars - the characteristics the accessory reports
       */
      function isOn(chars: CharSpec[]): boolean {
        const view = renderTile(tile, serviceWith(chars))
        const on = view.box().classList.contains('accessory-on')
        view.unmount()
        return on
      }

      it('follows On when it has one', () => {
        expect(isOn([['On', true]])).toBe(true)
        expect(isOn([['On', false]])).toBe(false)
      })

      it('prefers On over everything else', () => {
        // A speaker with both should not be read by its mute flag
        expect(isOn([['On', false], ['Mute', false], ['Volume', 50]])).toBe(false)
      })

      it('falls back to Active', () => {
        expect(isOn([['Active', 1]])).toBe(true)
        expect(isOn([['Active', 0]])).toBe(false)
      })

      it.each([
        ['playing', 0, true],
        ['paused', 1, true],
        ['stopped', 2, false],
        ['unknown', 3, false],
      ])('reads a %s media state as on: %s', (_label, state, expected) => {
        // Paused still counts as on: the speaker is in use
        expect(isOn([['CurrentMediaState', state]])).toBe(expected)
      })

      it('reads an unmuted speaker with volume as on', () => {
        expect(isOn([['Mute', false], ['Volume', 30]])).toBe(true)
      })

      it('reads an unmuted speaker turned all the way down as off', () => {
        // Nothing is coming out of it
        expect(isOn([['Mute', false], ['Volume', 0]])).toBe(false)
      })

      it('reads a muted speaker as off', () => {
        expect(isOn([['Mute', true], ['Volume', 50]])).toBe(false)
      })

      it('reads a mute-only speaker by its mute flag', () => {
        expect(isOn([['Mute', false]])).toBe(true)
        expect(isOn([['Mute', true]])).toBe(false)
      })

      it('reads a speaker that reports nothing useful as off', () => {
        expect(isOn([['Name', 'Speaker']])).toBe(false)
      })

      it.each([
        [[['CurrentMediaState', 0], ['Volume', 40]], 'accessories.control.playing · 40%'],
        [[['CurrentMediaState', 1], ['Mute', true], ['Volume', 40]], 'accessories.control.paused · accessories.control.mute'],
        [[['Active', 0]], 'accessories.control.off'],
        [[['Mute', true]], 'accessories.control.mute'],
        [[['Volume', 25]], '25%'],
      ])('labels %j as %s', (chars, label) => {
        const view = renderTile(tile, serviceWith(chars as CharSpec[]))

        expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe(label)
      })
    })

    describe.each(MEDIA_TILES)('what a tap on a %s writes', (_name, tile) => {
      it.each([
        ['On', [['On', true]], { type: 'On', value: false }],
        ['Active', [['Active', 0]], { type: 'Active', value: 1 }],
        ['the target media state', [['TargetMediaState', 0]], { type: 'TargetMediaState', value: 1 }],
        ['the mute flag', [['Mute', false]], { type: 'Mute', value: true }],
      ])('writes %s', (_label, chars, expected) => {
        const service = serviceWith(chars as CharSpec[])

        renderTile(tile, service).tap()

        expect(writesTo(service)).toEqual([expected])
      })

      it('turns a playing one off through the media state', () => {
        const service = serviceWith([['TargetMediaState', 0]])

        renderTile(tile, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'TargetMediaState', value: 1 }])
      })

      it('writes nothing at all when it has no control', () => {
        const service = serviceWith([['CurrentMediaState', 0]])

        renderTile(tile, service).tap()

        expect(writesTo(service)).toEqual([])
      })
    })

    describe.each(MEDIA_TILES)('the %s manage modal', (_name, tile, manageModal) => {
      beforeEach(() => {
        vi.useFakeTimers()
      })

      it.each([
        ['a volume control', [['Mute', false], ['Volume', 40]]],
        ['an active flag', [['Active', 1]]],
        ['a media state to set', [['TargetMediaState', 0]]],
        ['nothing but a mute flag', [['Mute', false]]],
      ])('opens on a long press for one with %s', async (_label, chars) => {
        await renderTile(tile, serviceWith(chars as CharSpec[])).longPress()

        expect(modal.opened).toHaveLength(1)
        expect(modal.lastOpened()!.options).toMatchObject({ size: 'md', backdrop: 'static' })
      })

      it('opens its own manage modal, not another tile one', async () => {
        // The only thing that differs between these three
        await renderTile(tile, serviceWith([['Active', 1]])).longPress()

        expect(modal.lastOpened()!.component).toBe(manageModal)
      })

      it('opens nothing for a plain on/off accessory', async () => {
        // There is nothing in the modal to show
        await renderTile(tile, serviceWith([['On', true]])).longPress()

        expect(modal.opened).toEqual([])
      })

      it('opens nothing before the bridge is ready', async () => {
        await renderTile(tile, serviceWith([['Active', 1]]), false).longPress()

        expect(modal.opened).toEqual([])
      })
    })

    it('marks only a speaker as muted', () => {
      expect(renderTile(SpeakerTile, serviceWith([['Mute', true]])).box()).toHaveClass('muted')
      expect(renderTile(MicrophoneTile, serviceWith([['Mute', true]])).box()).not.toHaveClass('muted')
    })

    it('says on for a speaker with nothing more specific, and its own name for the others', () => {
      expect(renderTile(SpeakerTile, hapService({ type: 'Speaker', characteristics: [characteristic('Name', 'x')] })).container.textContent).toContain('accessories.control.on')
      expect(renderTile(MicrophoneTile, serviceWith([['Name', 'x']])).container.textContent).toContain('accessories.control.microphone')
      expect(renderTile(DoorbellTile, serviceWith([['Name', 'x']])).container.textContent).toContain('accessories.core.doorbell')
    })
  })

  describe('the television', () => {
    /**
     * A television with input sources linked to it.
     * @param inputs - the inputs, as identifier and name
     */
    function television(inputs: Array<[number, string | undefined]>, activeIdentifier = 1) {
      const linkedServices = Object.fromEntries(inputs.map(([identifier, name], index) => [
        `input-${index}`,
        hapService({
          type: 'InputSource',
          characteristics: [
            characteristic('Identifier', identifier),
            ...(name === undefined ? [] : [characteristic('ConfiguredName', name)]),
          ],
        }),
      ]))
      return hapService({
        type: 'Television',
        characteristics: [characteristic('Active', 1), characteristic('ActiveIdentifier', activeIdentifier)],
        overrides: { linkedServices } as any,
      })
    }

    const label = (view: { container: HTMLElement }) => view.container.querySelectorAll('.accessory-label')[1].textContent

    it('lists the inputs by the name they were given', () => {
      expect(label(renderTile(TelevisionTile, television([[1, 'HDMI 1'], [2, 'Apple TV']], 2)))).toBe('Apple TV')
    })

    it('names an unnamed input after its number', () => {
      // Better than a blank entry in the input list
      expect(label(renderTile(TelevisionTile, television([[3, undefined]], 3)))).toBe('Input 3')
    })

    it('ignores linked services that are not inputs', () => {
      const service = television([[1, 'HDMI 1']], 7)
      ;(service as any).linkedServices.speaker = hapService({ type: 'Speaker', characteristics: [characteristic('Identifier', 7)] })

      expect(label(renderTile(TelevisionTile, service))).toBe('accessories.control.on')
    })

    it('has no input list when nothing is linked', () => {
      expect(label(renderTile(TelevisionTile, serviceWith([['Active', 1], ['ActiveIdentifier', 1]])))).toBe('accessories.control.on')
    })

    it('prefers the active flag over on', () => {
      const service = serviceWith([['Active', 1], ['On', true]])

      renderTile(TelevisionTile, service).tap()

      expect(writesTo(service)).toEqual([{ type: 'Active', value: 0 }])
    })

    it('opens its modal for a television with inputs', async () => {
      vi.useFakeTimers()
      await renderTile(TelevisionTile, television([[1, 'HDMI 1']])).longPress()

      expect(modal.opened).toHaveLength(1)
    })

    it('opens nothing for a television with only an on switch', async () => {
      vi.useFakeTimers()
      await renderTile(TelevisionTile, serviceWith([['On', true]])).longPress()

      expect(modal.opened).toEqual([])
    })
  })
  describe('the valve', () => {
    /** A valve that runs on a timer. */
    function timedValve(active: number, remaining: number) {
      return serviceWith([['Active', active], ['SetDuration', 600], ['RemainingDuration', remaining]])
    }

    const label = (view: { container: HTMLElement }) => view.container.querySelectorAll('.accessory-label')[1].textContent

    async function tick(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
    }

    describe('the countdown', () => {
      beforeEach(() => {
        vi.useFakeTimers()
      })

      it('counts down while the valve is running', async () => {
        const view = renderTile(ValveTile, timedValve(1, 125))

        await tick(5000)

        // 125 seconds less the 5 that have passed
        expect(label(view)).toBe('02:00')
      })

      it('shows hours when there are hours left', async () => {
        const view = renderTile(ValveTile, timedValve(1, 7200))

        await tick(1000)

        expect(label(view)).toBe('01:59:59')
      })

      it('counts nothing while the valve is off', async () => {
        const view = renderTile(ValveTile, timedValve(0, 600))

        await tick(5000)

        expect(label(view)).toBe('accessories.control.off')
      })

      it('clears the countdown once the time is up', async () => {
        const view = renderTile(ValveTile, timedValve(1, 2))

        await tick(3000)

        expect(label(view)).toBe('accessories.control.running')
      })

      it('starts again from the top after the valve was switched off', async () => {
        const service = timedValve(1, 125)
        const view = renderTile(ValveTile, service)
        await tick(5000)

        service.values.Active = 0
        await tick(1000)
        service.values.Active = 1
        await tick(1000)

        expect(label(view)).toBe('02:04')
      })

      it('starts no countdown for a valve with no duration setting', async () => {
        // A plain on/off valve; there is nothing to count
        const view = renderTile(ValveTile, serviceWith([['Active', 1], ['RemainingDuration', 100]]))

        await tick(5000)

        expect(label(view)).toBe('accessories.control.running')
      })
    })

    describe('what a valve tile shows and writes', () => {
      it('writes the active flag when it has one', () => {
        const service = serviceWith([['Active', 0]])

        renderTile(ValveTile, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'Active', value: 1 }])
      })

      it('turns a running valve off', () => {
        const service = serviceWith([['Active', 1]])

        renderTile(ValveTile, service).tap()

        expect(writesTo(service)).toEqual([{ type: 'Active', value: 0 }])
      })

      it('reports the consumption of a valve that measures it', () => {
        expect(label(renderTile(ValveTile, serviceWith([['Active', 1], ['Consumption', 12.5]])))).toBe('accessories.control.running · 12.5W')
      })

      it('reports nothing for a valve that does not measure it', () => {
        expect(label(renderTile(ValveTile, serviceWith([['Active', 1]])))).toBe('accessories.control.running')
      })

      it('opens its manage modal on a long press when it has a duration', async () => {
        vi.useFakeTimers()
        await renderTile(ValveTile, serviceWith([['Active', 1], ['SetDuration', 600]])).longPress()

        expect(modal.opened).toHaveLength(1)
      })

      it('opens nothing on a valve with no duration', async () => {
        vi.useFakeTimers()
        await renderTile(ValveTile, serviceWith([['Active', 1]])).longPress()

        expect(modal.opened).toEqual([])
      })

      it.each([
        [0, 'accessories.core.generic_valve'],
        [1, 'accessories.core.irrigation_valve'],
        [2, 'accessories.core.shower_head_valve'],
        [3, 'accessories.core.faucet_valve'],
      ])('draws valve type %s as a %s', (type, key) => {
        const view = renderTile(ValveTile, serviceWith([['Active', 0], ['ValveType', type]]))

        expect(view.container.querySelector('.accessory-svg')).toHaveAttribute('aria-label', key)
      })
    })
  })

  describe('the filter maintenance tile', () => {
    it.each([
      [[['FilterChangeIndication', 1], ['FilterLifeLevel', 60]], 'replace'],
      [[['FilterChangeIndication', 0], ['FilterLifeLevel', 5]], 'replace'],
      [[['FilterChangeIndication', 0], ['FilterLifeLevel', 30]], 'dirty'],
    ])('marks %j as %s', (chars, cls) => {
      expect(renderTile(FilterMaintenanceTile, serviceWith(chars as CharSpec[])).box()).toHaveClass(cls)
    })

    it('shows the level, and asks for a replacement when the accessory says so', () => {
      const view = renderTile(FilterMaintenanceTile, serviceWith([['FilterChangeIndication', 1], ['FilterLifeLevel', 5]]))

      expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe('5% · accessories.control.replace')
    })
  })

  describe('the display-only tiles', () => {
    it('shows an irrigation system running', () => {
      const view = renderTile(IrrigationSystemTile, serviceWith([['InUse', 1]]))

      expect(view.box()).toHaveClass('accessory-on')
      expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe('accessories.control.running')
    })

    it.each([
      [0, 'press-single'],
      [1, 'press-double'],
      [2, 'press-long'],
    ])('lights up a stateless switch for event %s', (event, cls) => {
      expect(renderTile(StatelessProgrammableSwitchTile, serviceWith([['ProgrammableSwitchEvent', event]])).box()).toHaveClass(cls)
    })

    it('names an unknown service by its HAP type', () => {
      const view = renderTile(UnknownTile, hapService({ type: 'Mystery', characteristics: [characteristic('Name', 'x')] }))

      expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe('Mystery')
      expect(view.container.querySelector('.accessory-svg')).toHaveAttribute('aria-label', 'Mystery')
    })

    it.each([
      ['robot vacuum', RobotVacuumTile],
      ['washing machine', WashingMachineTile],
    ])('shows a running %s with its power', (_name, tile) => {
      const view = renderTile(tile, serviceWith([['Active', 1], ['Consumption', 3]]))

      expect(view.box()).toHaveClass('accessory-on')
      expect(view.container.querySelectorAll('.accessory-label')[1].textContent).toBe('accessories.control.on · 3W')
    })
  })
})
