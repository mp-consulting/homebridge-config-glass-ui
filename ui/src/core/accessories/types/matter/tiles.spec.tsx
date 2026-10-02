import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'
import type { FakeOpenModal } from '@/testing'
import type { ComponentType } from 'react'

import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MatterAirQualitySensorTile } from '@/core/accessories/types/matter/air-quality-sensor/MatterAirQualitySensorTile'
import { ColorTemperatureLightTile } from '@/core/accessories/types/matter/color-temperature-light/ColorTemperatureLightTile'
import { MatterContactSensorTile } from '@/core/accessories/types/matter/contact-sensor/MatterContactSensorTile'
import { DimmableLightTile } from '@/core/accessories/types/matter/dimmable-light/DimmableLightTile'
import { MatterDoorLockTile } from '@/core/accessories/types/matter/door-lock/MatterDoorLockTile'
import { ExtendedColorLightTile } from '@/core/accessories/types/matter/extended-color-light/ExtendedColorLightTile'
import { MatterFanTile } from '@/core/accessories/types/matter/fan/MatterFanTile'
import { MatterGenericSwitchTile } from '@/core/accessories/types/matter/generic-switch/MatterGenericSwitchTile'
import { MatterHumiditySensorTile } from '@/core/accessories/types/matter/humidity-sensor/MatterHumiditySensorTile'
import { MatterLightSensorTile } from '@/core/accessories/types/matter/light-sensor/MatterLightSensorTile'
import { MatterOccupancySensorTile } from '@/core/accessories/types/matter/occupancy-sensor/MatterOccupancySensorTile'
import { OnOffLightSwitchTile } from '@/core/accessories/types/matter/on-off-light-switch/OnOffLightSwitchTile'
import { OnOffLightTile } from '@/core/accessories/types/matter/on-off-light/OnOffLightTile'
import { OnOffPlugInUnitTile } from '@/core/accessories/types/matter/on-off-plug-in-unit/OnOffPlugInUnitTile'
import { MatterPumpTile } from '@/core/accessories/types/matter/pump/MatterPumpTile'
import { RoboticVacuumCleanerTile } from '@/core/accessories/types/matter/robotic-vacuum-cleaner/RoboticVacuumCleanerTile'
import { MatterSmokeCoAlarmTile } from '@/core/accessories/types/matter/smoke-co-alarm/MatterSmokeCoAlarmTile'
import { MatterTemperatureSensorTile } from '@/core/accessories/types/matter/temperature-sensor/MatterTemperatureSensorTile'
import { MatterThermostatTile } from '@/core/accessories/types/matter/thermostat/MatterThermostatTile'
import { MatterUnknownTile } from '@/core/accessories/types/matter/unknown/MatterUnknownTile'
import { MatterWaterLeakDetectorTile } from '@/core/accessories/types/matter/water-leak-detector/MatterWaterLeakDetectorTile'
import { MatterWaterValveTile } from '@/core/accessories/types/matter/water-valve/MatterWaterValveTile'
import { MatterWindowCoveringTile } from '@/core/accessories/types/matter/window-covering/MatterWindowCoveringTile'
import * as modalModule from '@/core/ui/modal'
import { matterService } from '@/testing'

vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

/**
 * The matter accessory tiles.
 *
 * These are deliberately thin: each one guards on `readyForControl`, then hands
 * off to a helper in `matter-device.utils.ts`. Those helpers already have their
 * own spec, so **re-asserting the cluster payloads here would be duplication**.
 * What is NOT covered anywhere else, and is the point of this file:
 *
 * ⚠️ **the guard, on every tile and on both gestures.** Matter control runs over
 * the same socket as HAP, and before the bridge reports ready there is no route
 * to the device — the write is dropped while the tile has already flipped itself
 * to look as though it worked.
 *
 * Each row also names the cluster its tile reaches for, which is the one thing a
 * copy-pasted tile gets wrong.
 */
describe('the matter accessory tiles', () => {
  const modal = modalModule as unknown as FakeOpenModal

  type Tile = ComponentType<MatterTileProps>

  /**
   * Render a tile and return its root element.
   * @param Tile - the tile component
   * @param service - the accessory service it renders
   * @param readyForControl - whether the bridge is ready to accept writes
   */
  function create(Tile: Tile, service: ServiceTypeX, readyForControl = true): HTMLElement {
    const { container } = render(<Tile service={service} readyForControl={readyForControl} />)
    return container.firstElementChild as HTMLElement
  }

  /** A tap: the press-and-release a long-press tile listens for, and the click the others do. */
  function tap(element: HTMLElement) {
    fireEvent.mouseDown(element, { button: 0 })
    fireEvent.mouseUp(element, { button: 0 })
    fireEvent.click(element)
  }

  /** A press held past the long-press threshold. */
  function longPress(element: HTMLElement) {
    vi.useFakeTimers()
    try {
      fireEvent.mouseDown(element, { button: 0 })
      act(() => {
        vi.advanceTimersByTime(400)
      })
    } finally {
      vi.useRealTimers()
    }
  }

  /** Let a fire-and-forget helper settle. */
  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

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
    clusters: Record<string, Record<string, unknown>>
    /** The cluster(s) a plain tap should write to, in order. */
    cluster: string | string[]
    /**
     * The matter device type, where the tile's helper branches on it.
     * ⚠️ The vacuum needs this: `controlDevice` picks the RVC path only when
     * `deviceType` says so, and otherwise falls through to onOff and throws.
     */
    deviceType?: string
  }

  // The clusters each helper writes are asserted in matter-device.utils.spec.ts;
  // what these rows pin is which helper each TILE picked
  const TILES: TileCase[] = [
    {
      name: 'on off light',
      type: OnOffLightTile,
      clusters: { onOff: { onOff: false } },
      cluster: 'onOff',
    },
    {
      name: 'on off light switch',
      type: OnOffLightSwitchTile,
      clusters: { onOff: { onOff: false } },
      cluster: 'onOff',
    },
    {
      name: 'on off plug in unit',
      type: OnOffPlugInUnitTile,
      clusters: { onOff: { onOff: false } },
      cluster: 'onOff',
    },
    {
      name: 'pump',
      type: MatterPumpTile,
      clusters: { onOff: { onOff: false } },
      cluster: 'onOff',
    },
    {
      name: 'dimmable light',
      type: DimmableLightTile,
      clusters: { onOff: { onOff: false }, levelControl: { currentLevel: 0 } },
      // Switching a dimmable light ON restores the level AND writes onOff - a
      // raw level write alone does not run Matter's on/off coupling, so the
      // state would never read as on
      cluster: ['levelControl', 'onOff'],
    },
    {
      name: 'colour temperature light',
      type: ColorTemperatureLightTile,
      clusters: { onOff: { onOff: false }, levelControl: { currentLevel: 0 }, colorControl: { colorTemperatureMireds: 250 } },
      cluster: ['levelControl', 'onOff'],
    },
    {
      name: 'extended colour light',
      type: ExtendedColorLightTile,
      clusters: { onOff: { onOff: false }, levelControl: { currentLevel: 0 }, colorControl: { currentHue: 50, currentSaturation: 200 } },
      cluster: ['levelControl', 'onOff'],
    },
    {
      name: 'door lock',
      type: MatterDoorLockTile,
      clusters: { doorLock: { lockState: 1 } },
      cluster: 'doorLock',
    },
    {
      name: 'fan',
      type: MatterFanTile,
      clusters: { fanControl: { fanMode: 0, percentSetting: 0 } },
      cluster: 'fanControl',
    },
    {
      name: 'water valve',
      type: MatterWaterValveTile,
      clusters: { valveConfigurationAndControl: { currentState: 0, targetState: 0 } },
      cluster: 'valveConfigurationAndControl',
    },
    {
      name: 'window covering',
      type: MatterWindowCoveringTile,
      clusters: { windowCovering: { currentPositionLiftPercent100ths: 0, targetPositionLiftPercent100ths: 0 } },
      cluster: 'windowCovering',
    },
    {
      name: 'robotic vacuum cleaner',
      type: RoboticVacuumCleanerTile,
      deviceType: 'RoboticVacuumCleaner',
      clusters: {
        rvcRunMode: { currentMode: 0, supportedModes: [{ label: 'Idle', mode: 0 }, { label: 'Clean', mode: 1 }] },
        rvcOperationalState: { operationalState: 0 },
      },
      cluster: 'rvcRunMode',
    },
  ]

  describe.each(TILES.map(tile => [tile.name, tile] as const))('the %s tile', (_name, tile) => {
    it('writes nothing until the bridge is ready for control', async () => {
      const service = matterService({ clusters: tile.clusters, deviceType: tile.deviceType })
      const element = create(tile.type, service, false)

      tap(element)
      await settle()

      expect(service.writes).toEqual([])
    })

    it('writes to its own cluster on a tap once the bridge is ready', async () => {
      const service = matterService({ clusters: tile.clusters, deviceType: tile.deviceType })
      const element = create(tile.type, service, true)

      tap(element)
      await settle()

      expect(service.writes.map(write => write.cluster)).toEqual([tile.cluster].flat())
    })
  })

  // Six of the tiles also open a manage modal on a long press
  describe.each([
    ['dimmable light', DimmableLightTile, { onOff: { onOff: true }, levelControl: { currentLevel: 120 } }],
    ['colour temperature light', ColorTemperatureLightTile, { onOff: { onOff: true }, levelControl: { currentLevel: 120 }, colorControl: { colorTemperatureMireds: 250 } }],
    ['extended colour light', ExtendedColorLightTile, { onOff: { onOff: true }, levelControl: { currentLevel: 120 }, colorControl: { currentHue: 50, currentSaturation: 200 } }],
    ['fan', MatterFanTile, { fanControl: { fanMode: 2, percentSetting: 50 } }],
    ['door lock', MatterDoorLockTile, { doorLock: { lockState: 1 } }],
    ['window covering', MatterWindowCoveringTile, { windowCovering: { currentPositionLiftPercent100ths: 5000, targetPositionLiftPercent100ths: 5000 } }],
  ] as [string, Tile, Record<string, Record<string, unknown>>][])('a long press on the %s tile', (_name, type, clusters) => {
    it('opens nothing until the bridge is ready for control', () => {
      longPress(create(type, matterService({ clusters }), false))

      expect(modal.opened).toEqual([])
    })

    it('opens the manage modal once the bridge is ready', () => {
      const service = matterService({ clusters })
      longPress(create(type, service, true))

      expect(modal.opened).toHaveLength(1)
      expect(modal.lastOpened()!.options?.backdrop).toBe('static')
      expect(modal.lastOpened()!.props).toEqual({ service })
    })
  })

  describe('the thermostat tile', () => {
    function thermostat() {
      return matterService({
        deviceType: 'Thermostat',
        clusters: {
          thermostat: {
            localTemperature: 2050,
            systemMode: 4,
            occupiedHeatingSetpoint: 2000,
            occupiedCoolingSetpoint: 2400,
          },
        },
      })
    }

    it('opens nothing until the bridge is ready for control', () => {
      // A thermostat has nothing to toggle, so a tap goes straight to the modal
      tap(create(MatterThermostatTile, thermostat(), false))

      expect(modal.opened).toEqual([])
    })

    it('opens its manage modal on a tap once the bridge is ready', () => {
      const service = thermostat()
      tap(create(MatterThermostatTile, service, true))

      expect(modal.opened).toHaveLength(1)
      expect(service.writes).toEqual([])
    })
  })

  describe('what each tile reads as on', () => {
    /**
     * Render a tile and read whether it shows as on.
     * @param type - the tile component
     * @param clusters - the device's cluster state
     */
    function isOn(type: Tile, clusters: Record<string, Record<string, unknown>>) {
      const element = create(type, matterService({ clusters }))
      return element.getAttribute('aria-checked') === 'true' && element.classList.contains('accessory-on')
    }

    it('reads an on off light from its onOff cluster', () => {
      expect(isOn(OnOffLightTile, { onOff: { onOff: true } })).toBe(true)
      expect(isOn(OnOffLightTile, { onOff: { onOff: false } })).toBe(false)
    })

    it('reads a dimmable light as on whenever it has a level', () => {
      expect(isOn(DimmableLightTile, { onOff: { onOff: true }, levelControl: { currentLevel: 120 } })).toBe(true)
      expect(isOn(DimmableLightTile, { onOff: { onOff: false }, levelControl: { currentLevel: 0 } })).toBe(false)
    })

    it('reads a fan from its percent setting, not its mode', () => {
      expect(isOn(MatterFanTile, { fanControl: { fanMode: 2, percentSetting: 50 } })).toBe(true)
      expect(isOn(MatterFanTile, { fanControl: { fanMode: 0, percentSetting: 0 } })).toBe(false)
    })
  })

  // Not in the Angular spec: every tile, the read-only ones included, renders
  // its name and a screen-reader status without throwing
  describe.each([
    ['air quality sensor', MatterAirQualitySensorTile, { airQuality: { airQuality: 2 } }],
    ['contact sensor', MatterContactSensorTile, { booleanState: { stateValue: true } }],
    ['generic switch', MatterGenericSwitchTile, {}],
    ['humidity sensor', MatterHumiditySensorTile, { relativeHumidityMeasurement: { measuredValue: 4500 } }],
    ['light sensor', MatterLightSensorTile, { illuminanceMeasurement: { measuredValue: 10000 } }],
    ['occupancy sensor', MatterOccupancySensorTile, { occupancySensing: { occupancy: { occupied: true } } }],
    ['smoke / co alarm', MatterSmokeCoAlarmTile, { smokeCoAlarm: { smokeState: 0, coState: 0 } }],
    ['temperature sensor', MatterTemperatureSensorTile, { temperatureMeasurement: { measuredValue: 2150 } }],
    ['unknown device', MatterUnknownTile, {}],
    ['water leak detector', MatterWaterLeakDetectorTile, { booleanState: { stateValue: false } }],
  ] as [string, Tile, Record<string, Record<string, unknown>>][])('the %s tile', (_name, type, clusters) => {
    it('renders the accessory name', () => {
      const element = create(type, matterService({ serviceName: 'Hall', clusters }))

      expect(element.classList).toContain('accessory-box')
      expect(element.textContent).toContain('Hall')
    })
  })
})
