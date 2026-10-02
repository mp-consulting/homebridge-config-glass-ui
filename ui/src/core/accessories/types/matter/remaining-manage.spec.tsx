import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'
import type { FakeToast, MatterServiceFixture } from '@/testing'
import type { ComponentType } from 'react'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AirQualitySensorManage } from '@/core/accessories/types/matter/air-quality-sensor/AirQualitySensorManage'
import { DoorLockManage } from '@/core/accessories/types/matter/door-lock/DoorLockManage'
import { MatterFanManage } from '@/core/accessories/types/matter/fan/MatterFanManage'
import { advance, changedElsewhere, isSelected, renderManage, settle, slider } from '@/core/accessories/types/matter/matter.testing'
import { RoboticVacuumCleanerManage } from '@/core/accessories/types/matter/robotic-vacuum-cleaner/RoboticVacuumCleanerManage'
import { MatterThermostatManage } from '@/core/accessories/types/matter/thermostat/MatterThermostatManage'
import { useSettingsStore } from '@/core/settings/settings.store'
import { toast } from '@/core/ui/toast'
import { matterService } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

/**
 * The five matter manage modals not covered elsewhere.
 *
 * Their cluster writes go through the helpers in `matter-device.utils.ts`, which
 * have their own spec, so what these assert is the layer above: how each modal
 * derives its state from the clusters, which controls it offers at all, and what
 * it puts back when a write is refused.
 *
 * ⚠️ Matter reports temperatures in hundredths of a degree. Every setpoint here
 * is therefore `2000` for 20°C — getting that factor wrong is a silent 100×
 * error, which is why the conversions are asserted explicitly.
 */
describe('the remaining matter manage modals', () => {
  const toastr = toast as unknown as FakeToast
  let container: HTMLElement

  function setUnits(temperatureUnits: 'c' | 'f') {
    useSettingsStore.setState(state => ({ env: { ...state.env, temperatureUnits } }))
  }

  /**
   * Render a modal.
   * @param type - the modal component
   * @param service - the accessory it is opened for
   * @param temperatureUnits - the unit the user chose
   */
  function create(type: ComponentType<AccessoryManageModalProps>, service: ServiceTypeX, temperatureUnits: 'c' | 'f' = 'c') {
    setUnits(temperatureUnits)
    container = renderManage(type, service).container
  }

  function headingText(prefix: string) {
    return Array.from(container.querySelectorAll('h6')).find(h6 => h6.textContent!.startsWith(prefix))?.textContent
  }

  async function click(name: string | RegExp) {
    fireEvent.click(screen.getByRole('button', { name }))
    await settle()
  }

  /** Move the (only) slider, then wait out the 500ms debounce. */
  async function slide(value: number | number[]) {
    act(() => {
      (slider(container) as unknown as { set: (v: number | number[]) => void }).set(value)
    })
    await advance(500)
  }

  function sliderValues(): number[] {
    const value = slider(container).get() as unknown as string | string[]
    return [value].flat().map(Number)
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
    toastr.error.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    setUnits('c')
  })

  describe('thermostat', () => {
    function thermostat(overrides: Record<string, unknown> = {}): MatterServiceFixture {
      return matterService({
        deviceType: 'Thermostat',
        clusters: {
          thermostat: {
            localTemperature: 2050,
            systemMode: 1,
            occupiedHeatingSetpoint: 2000,
            occupiedCoolingSetpoint: 2400,
            ...overrides,
          },
        },
      })
    }

    const AUTO = 'accessories.control.threshold_auto'
    const TARGET = 'accessories.control.target'

    it('reads the setpoints out of hundredths of a degree', () => {
      create(MatterThermostatManage, thermostat())

      expect(headingText(AUTO)).toBe(`${AUTO}: 20°C - 24°C`)
      expect(sliderValues()).toEqual([20, 24])
      expect(container.querySelector('h6.fs-4')!.textContent).toBe('20.5°C')
    })

    it('writes a heating setpoint back in hundredths', async () => {
      const service = thermostat({ systemMode: 4 })
      create(MatterThermostatManage, service)

      await slide(22)

      expect(service.writes).toEqual([
        { cluster: 'thermostat', attributes: { occupiedHeatingSetpoint: 2200 } },
      ])
    })

    it('writes a cooling setpoint back in hundredths', async () => {
      const service = thermostat({ systemMode: 3 })
      create(MatterThermostatManage, service)

      await slide(26)

      expect(service.writes).toEqual([
        { cluster: 'thermostat', attributes: { occupiedCoolingSetpoint: 2600 } },
      ])
    })

    it('writes both setpoints in auto mode, heating first', async () => {
      const service = thermostat({ systemMode: 1 })
      create(MatterThermostatManage, service)

      await slide([19, 27])

      expect(service.writes).toEqual([
        { cluster: 'thermostat', attributes: { occupiedHeatingSetpoint: 1900 } },
        { cluster: 'thermostat', attributes: { occupiedCoolingSetpoint: 2700 } },
      ])
    })

    it('keeps the pair in step when the auto range moves', async () => {
      create(MatterThermostatManage, thermostat())

      act(() => {
        (slider(container) as unknown as { set: (v: number[]) => void }).set([18, 28])
      })
      expect(headingText(AUTO)).toBe(`${AUTO}: 18°C - 28°C`)

      // The single setpoints follow: switching to heat shows the new heating one
      await click('accessories.control.heat')
      expect(headingText(TARGET)).toBe(`${TARGET}: 18°C`)
    })

    it('puts the setpoint back when the write is refused', async () => {
      const service = thermostat({ systemMode: 4 })
      service.failWrites('thermostat', new Error('device offline'))
      create(MatterThermostatManage, service)

      await slide(22)

      expect(headingText(TARGET)).toBe(`${TARGET}: 20°C`)
      expect(sliderValues()).toEqual([20])
      expect(toastr.error).toHaveBeenCalled()
    })

    it('puts both setpoints back when an auto write is refused', async () => {
      // ⚠️ Auto mode has its own revert, and it has to put the paired range back
      // as well as the two numbers - the slider reads the pair, so leaving it
      // stale shows a range the thermostat never accepted
      const service = thermostat({ systemMode: 1 })
      service.failWrites('thermostat', new Error('device offline'))
      create(MatterThermostatManage, service)

      await slide([15, 30])

      expect(headingText(AUTO)).toBe(`${AUTO}: 20°C - 24°C`)
      expect(sliderValues()).toEqual([20, 24])
      expect(toastr.error).toHaveBeenCalled()
    })

    it('reads the setpoint limits off the cluster', () => {
      const limits = {
        minHeatSetpointLimit: 500,
        maxHeatSetpointLimit: 2800,
        minCoolSetpointLimit: 1600,
        maxCoolSetpointLimit: 3200,
      }
      create(MatterThermostatManage, thermostat({ ...limits, systemMode: 4 }))
      expect(slider(container).options.range).toEqual({ min: 5, max: 28 })

      create(MatterThermostatManage, thermostat({ ...limits, systemMode: 3 }))
      expect(slider(container).options.range).toEqual({ min: 16, max: 32 })
    })

    it('keeps a limit of zero degrees rather than treating it as missing', () => {
      // A truthiness check here replaced a legitimate 0°C limit with the 7°C
      // default, and no cold-climate thermostat could be set below it
      create(MatterThermostatManage, thermostat({ minHeatSetpointLimit: 0, systemMode: 4 }))

      expect(slider(container).options.range.min).toBe(0)
    })

    it('falls back to sensible limits when the device declares none', () => {
      create(MatterThermostatManage, thermostat({ systemMode: 4 }))
      expect(slider(container).options.range).toEqual({ min: 7, max: 30 })

      create(MatterThermostatManage, thermostat({ systemMode: 3 }))
      expect(slider(container).options.range).toEqual({ min: 10, max: 35 })
    })

    it('offers only the modes the device actually has', () => {
      // Showing an Auto button on a thermostat without the AutoMode feature
      // means a write the device rejects
      create(MatterThermostatManage, matterService({
        deviceType: 'Thermostat',
        clusters: {
          thermostat: {
            localTemperature: 2050,
            systemMode: 4,
            occupiedHeatingSetpoint: 2000,
            featureMap: { heating: true, cooling: false, autoMode: false },
          },
        },
      }))

      expect(screen.queryByRole('button', { name: 'accessories.control.heat' })).not.toBeNull()
      expect(screen.queryByRole('button', { name: 'accessories.control.cool' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'accessories.control.auto' })).toBeNull()
    })

    it('writes a mode change to the thermostat cluster', async () => {
      const service = thermostat()
      create(MatterThermostatManage, service)

      await click('accessories.control.cool')

      expect(service.writes).toEqual([
        { cluster: 'thermostat', attributes: { systemMode: 3 } },
      ])
      expect(isSelected(screen.getByRole('button', { name: 'accessories.control.cool' }))).toBe(true)
    })

    it('puts the mode back when the write is refused', async () => {
      const service = thermostat({ systemMode: 4 })
      service.failWrites('thermostat', new Error('device offline'))
      create(MatterThermostatManage, service)

      await click('accessories.control.cool')

      expect(isSelected(screen.getByRole('button', { name: 'accessories.control.heat' }))).toBe(true)
      expect(toastr.error).toHaveBeenCalled()
    })

    it.each([
      ['status-color-cooling', 3],
      ['status-color-heating', 4],
      ['status-color-active', 1],
      ['status-color-inactive', 0],
    ])('shows %s for the matching system mode', (expected, systemMode) => {
      create(MatterThermostatManage, thermostat({ systemMode }))

      expect(container.querySelector('h6.fs-4 i')!.className).toBe(`fas fa-temperature-full ${expected}`)
    })

    it('takes the temperature unit from the user settings', () => {
      create(MatterThermostatManage, thermostat(), 'f')

      expect(container.querySelector('h6.fs-4')!.textContent).toBe('68.9°F')
      expect(headingText(AUTO)).toBe(`${AUTO}: 68°F - 75.2°F`)
    })

    it('follows a change made elsewhere', () => {
      create(MatterThermostatManage, thermostat())

      changedElsewhere(thermostat({ systemMode: 3, occupiedHeatingSetpoint: 1500, occupiedCoolingSetpoint: 3000 }))

      expect(isSelected(screen.getByRole('button', { name: 'accessories.control.cool' }))).toBe(true)
      expect(headingText(TARGET)).toBe(`${TARGET}: 30°C`)
    })
  })

  describe('fan', () => {
    function fan(percentSetting = 50, fanMode = 2): MatterServiceFixture {
      return matterService({
        deviceType: 'Fan',
        clusters: { fanControl: { fanMode, percentSetting, percentCurrent: percentSetting } },
      })
    }

    const SPEED = 'accessories.control.rotation_speed'
    const fanIsOn = () => isSelected(screen.getByRole('button', { name: 'accessories.control.on' }))

    it('reads the speed as a percentage', () => {
      create(MatterFanManage, fan(75))

      expect(headingText(SPEED)).toBe(`${SPEED}: 75%`)
      expect(sliderValues()).toEqual([75])
      expect(fanIsOn()).toBe(true)
    })

    it('reads a fan at zero as off', () => {
      create(MatterFanManage, fan(0, 0))

      expect(fanIsOn()).toBe(false)
    })

    it('writes a speed change to fanControl', async () => {
      const service = fan()
      create(MatterFanManage, service)

      await slide(25)

      expect(service.writes.map(write => write.cluster)).toEqual(['fanControl'])
    })

    it('turns a fan sitting at zero on at full speed', async () => {
      const service = fan(0, 0)
      create(MatterFanManage, service)

      await click('accessories.control.on')

      expect(service.writes.at(-1)?.attributes).toMatchObject({ percentSetting: 100 })
    })

    it('keeps the speed it had when switching a stopped fan back on', async () => {
      const service = fan(40, 0)
      create(MatterFanManage, service)

      await click('accessories.control.on')

      expect(service.writes.at(-1)?.attributes).toMatchObject({ percentSetting: 40 })
    })

    it('writes zero when switched off', async () => {
      const service = fan(50)
      create(MatterFanManage, service)

      await click('accessories.control.off')

      expect(service.writes.at(-1)?.attributes).toMatchObject({ percentSetting: 0 })
      expect(fanIsOn()).toBe(false)
    })

    it('puts the slider back when the write is refused', async () => {
      const service = fan(50)
      service.failWrites('fanControl', new Error('device offline'))
      create(MatterFanManage, service)

      await slide(90)

      expect(sliderValues()).toEqual([50])
      expect(headingText(SPEED)).toBe(`${SPEED}: 50%`)
      expect(toastr.error).toHaveBeenCalled()
    })
  })

  describe('door lock', () => {
    function lock(lockState = 1): MatterServiceFixture {
      return matterService({ deviceType: 'DoorLock', clusters: { doorLock: { lockState } } })
    }

    const locked = () => isSelected(screen.getByRole('button', { name: 'accessories.control.lock' }))
    const unlocked = () => isSelected(screen.getByRole('button', { name: 'accessories.control.unlock' }))

    it('reads the lock state', () => {
      create(DoorLockManage, lock(1))
      expect(locked()).toBe(true)
      expect(unlocked()).toBe(false)

      create(DoorLockManage, lock(2))
      expect(isSelected(screen.getAllByRole('button', { name: 'accessories.control.unlock' }).at(-1)!)).toBe(true)
    })

    it('writes to the doorLock cluster when locking', async () => {
      const service = lock(2)
      create(DoorLockManage, service)

      await click('accessories.control.lock')

      expect(service.writes.map(write => write.cluster)).toEqual(['doorLock'])
      expect(locked()).toBe(true)
    })

    it('writes to the doorLock cluster when unlocking', async () => {
      const service = lock(1)
      create(DoorLockManage, service)

      await click('accessories.control.unlock')

      expect(service.writes.map(write => write.cluster)).toEqual(['doorLock'])
      expect(unlocked()).toBe(true)
    })

    it('puts the lock back when the write is refused', async () => {
      // Otherwise the modal claims a door is locked when it is not
      const service = lock(2)
      service.failWrites('doorLock', new Error('jammed'))
      create(DoorLockManage, service)

      await click('accessories.control.lock')

      expect(unlocked()).toBe(true)
      expect(toastr.error).toHaveBeenCalled()
    })
  })

  describe('robotic vacuum cleaner', () => {
    function vacuum(options: {
      operationalState?: number
      runMode?: number
      cleanMode?: boolean
      areas?: boolean
    } = {}): MatterServiceFixture {
      const clusters: Record<string, Record<string, unknown>> = {
        rvcRunMode: {
          currentMode: options.runMode ?? 0,
          supportedModes: [{ label: 'Idle', mode: 0 }, { label: 'Clean', mode: 1 }],
        },
        rvcOperationalState: { operationalState: options.operationalState ?? 0 },
      }
      if (options.cleanMode) {
        clusters.rvcCleanMode = {
          currentMode: 1,
          supportedModes: [{ label: 'Vacuum', mode: 1 }, { label: 'Mop', mode: 2 }],
        }
      }
      if (options.areas) {
        clusters.serviceArea = {
          supportedAreas: [
            { areaId: 1, areaInfo: { locationInfo: { locationName: 'Kitchen' } } },
            { areaId: 2, areaInfo: { locationInfo: { locationName: 'Hallway' } } },
          ],
          selectedAreas: [1],
          currentArea: 1,
          progress: [],
        }
      }
      return matterService({ deviceType: 'RoboticVacuumCleaner', clusters })
    }

    const status = () => container.querySelector('.btn-read')!.textContent
    const pauseDisabled = () => screen.getByRole('button', { name: 'accessories.control.pause' }).classList.contains('btn-pause-disabled')

    it('reads a running vacuum as cleaning', () => {
      // The UI mode comes from the operational state, not the run mode
      create(RoboticVacuumCleanerManage, vacuum({ operationalState: 1 }))

      expect(status()).toBe('accessories.control.cleaning')
    })

    it('reads a paused vacuum as paused', () => {
      create(RoboticVacuumCleanerManage, vacuum({ operationalState: 2 }))

      expect(status()).toBe('accessories.control.paused')
    })

    it.each([
      ['stopped', 0],
      ['in error', 3],
      ['seeking its charger', 64],
      ['docked', 66],
    ])('reads a vacuum that is %s as idle', (_label, operationalState) => {
      create(RoboticVacuumCleanerManage, vacuum({ operationalState }))

      expect(status()).toBe('accessories.control.stopped')
    })

    it('starts a clean through the run mode cluster', async () => {
      const service = vacuum({ operationalState: 0 })
      create(RoboticVacuumCleanerManage, service)

      await click('accessories.control.clean')

      expect(service.writes).toEqual([
        { cluster: 'rvcRunMode', attributes: { currentMode: 1 } },
      ])
    })

    it('stops a clean through the run mode cluster', async () => {
      const service = vacuum({ operationalState: 1 })
      create(RoboticVacuumCleanerManage, service)

      await click('accessories.control.stop')

      expect(service.writes).toEqual([
        { cluster: 'rvcRunMode', attributes: { currentMode: 0 } },
      ])
    })

    it('pauses through the operational state cluster instead', async () => {
      // Pause is not a run mode, so it goes somewhere else entirely
      const service = vacuum({ operationalState: 1 })
      create(RoboticVacuumCleanerManage, service)

      await click('accessories.control.pause')

      expect(service.writes).toEqual([
        { cluster: 'rvcOperationalState', attributes: { operationalState: 2 } },
      ])
    })

    it('refuses to pause a vacuum that is not running', async () => {
      const service = vacuum({ operationalState: 0 })
      create(RoboticVacuumCleanerManage, service)

      await click('accessories.control.pause')

      expect(service.writes).toEqual([])
      expect(pauseDisabled()).toBe(true)
    })

    it('complains rather than writing nowhere when the clean mode cluster is missing', async () => {
      // The clean mode buttons only show with the cluster, so it goes missing
      // between the modal opening and the click
      const service = vacuum({ cleanMode: true })
      create(RoboticVacuumCleanerManage, service)
      vi.mocked(service.getCluster!).mockReturnValue(null)

      await click('Mop')

      expect(toastr.error).toHaveBeenCalled()
    })

    it('follows a change made elsewhere', () => {
      // The dashboard polls, so a clean started from the vacuum's own app has to
      // show up here
      create(RoboticVacuumCleanerManage, vacuum({ operationalState: 0 }))

      changedElsewhere(vacuum({ operationalState: 1, runMode: 1 }))

      expect(pauseDisabled()).toBe(false)
    })

    it('allows pausing while it is cleaning', () => {
      create(RoboticVacuumCleanerManage, vacuum({ operationalState: 1 }))

      expect(pauseDisabled()).toBe(false)
    })

    it('puts the mode back when the write is refused', async () => {
      const service = vacuum({ operationalState: 0 })
      service.failWrites('rvcRunMode', new Error('device offline'))
      create(RoboticVacuumCleanerManage, service)

      await click('accessories.control.clean')

      expect(status()).toBe('accessories.control.stopped')
      expect(toastr.error).toHaveBeenCalled()
    })

    it('offers the clean modes only to a vacuum that has them', () => {
      create(RoboticVacuumCleanerManage, vacuum({ cleanMode: true }))
      expect(screen.getByRole('group', { name: 'accessories.control.clean_mode' }).textContent).toBe('VacuumMop')

      create(RoboticVacuumCleanerManage, vacuum())
      expect(screen.getAllByRole('group', { name: 'accessories.control.clean_mode' })).toHaveLength(1)
    })

    it('writes a clean mode change to its own cluster', async () => {
      const service = vacuum({ cleanMode: true })
      create(RoboticVacuumCleanerManage, service)

      await click('Mop')

      expect(service.writes).toEqual([
        { cluster: 'rvcCleanMode', attributes: { currentMode: 2 } },
      ])
      expect(isSelected(screen.getByRole('button', { name: 'Mop' }))).toBe(true)
    })

    it('puts the clean mode back when the write is refused', async () => {
      const service = vacuum({ cleanMode: true })
      service.failWrites('rvcCleanMode', new Error('device offline'))
      create(RoboticVacuumCleanerManage, service)

      await click('Mop')

      expect(isSelected(screen.getByRole('button', { name: 'Vacuum' }))).toBe(true)
      expect(isSelected(screen.getByRole('button', { name: 'Mop' }))).toBe(false)
    })

    it('offers the room list only to a vacuum that maps rooms', () => {
      create(RoboticVacuumCleanerManage, vacuum({ areas: true }))
      const rooms = screen.getByRole('group', { name: 'accessories.control.service_areas' })
      expect(Array.from(rooms.querySelectorAll('button')).map(button => button.textContent)).toEqual(['Area 1accessories.control.cleaning', 'Area 2'])
      expect(isSelected(screen.getByRole('button', { name: /Area 1/ }))).toBe(true)
      expect(isSelected(screen.getByRole('button', { name: /Area 2/ }))).toBe(false)

      create(RoboticVacuumCleanerManage, vacuum())
      expect(screen.getAllByRole('group', { name: 'accessories.control.service_areas' })).toHaveLength(1)
    })

    it('adds a room to the selection and sends the whole list', async () => {
      // The cluster takes the complete selection, not a delta
      const service = vacuum({ areas: true })
      create(RoboticVacuumCleanerManage, service)

      await click(/Area 2/)

      expect(isSelected(screen.getByRole('button', { name: /Area 2/ }))).toBe(true)
      expect(service.writes).toEqual([
        { cluster: 'serviceArea', attributes: { selectedAreas: [1, 2] } },
      ])
    })

    it('takes a room back out of the selection', async () => {
      const service = vacuum({ areas: true })
      create(RoboticVacuumCleanerManage, service)

      await click(/Area 1/)

      expect(isSelected(screen.getByRole('button', { name: /Area 1/ }))).toBe(false)
      expect(service.writes).toEqual([
        { cluster: 'serviceArea', attributes: { selectedAreas: [] } },
      ])
    })

    it('puts the selection back when the write is refused', async () => {
      const service = vacuum({ areas: true })
      service.failWrites('serviceArea', new Error('device offline'))
      create(RoboticVacuumCleanerManage, service)

      await click(/Area 2/)

      expect(isSelected(screen.getByRole('button', { name: /Area 1/ }))).toBe(true)
      expect(isSelected(screen.getByRole('button', { name: /Area 2/ }))).toBe(false)
      expect(toastr.error).toHaveBeenCalled()
    })
  })

  describe('air quality sensor', () => {
    function sensor(clusters: Record<string, Record<string, unknown>>): MatterServiceFixture {
      return matterService({ deviceType: 'AirQualitySensor', clusters })
    }

    function rows() {
      return Array.from(container.querySelectorAll('li')).map(li => li.textContent)
    }

    it('reads the overall air quality', () => {
      create(AirQualitySensorManage, sensor({ airQuality: { airQuality: 3 } }))

      const badge = container.querySelector('.badge')!
      expect(badge.textContent).toBe('accessories.control.air_quality_moderate')
      expect(badge.classList).toContain('bg-warning')
    })

    it('reads each concentration the sensor reports', () => {
      create(AirQualitySensorManage, sensor({
        airQuality: { airQuality: 2 },
        pm25ConcentrationMeasurement: { measuredValue: 12 },
        pm10ConcentrationMeasurement: { measuredValue: 20 },
        carbonMonoxideConcentrationMeasurement: { measuredValue: 3 },
      }))

      expect(rows()).toEqual([
        'accessories.control.pm2512 µg/m³',
        'accessories.control.pm1020 µg/m³',
        'accessories.control.carbon_monoxide3 ppm',
      ])
    })

    it('leaves a concentration the sensor does not report as unknown', () => {
      // Rather than showing zero, which reads as a good measurement
      create(AirQualitySensorManage, sensor({
        airQuality: { airQuality: 2 },
        carbonMonoxideConcentrationMeasurement: { measuredValue: 3 },
      }))

      expect(rows()).toEqual(['accessories.control.carbon_monoxide3 ppm'])
    })

    it('shows the concentration panel only when there is something in it', () => {
      create(AirQualitySensorManage, sensor({
        airQuality: { airQuality: 2 },
        pm25ConcentrationMeasurement: { measuredValue: 12 },
      }))
      expect(container.querySelector('.list-group')).not.toBeNull()

      create(AirQualitySensorManage, sensor({ airQuality: { airQuality: 2 } }))
      expect(container.querySelector('.list-group')).toBeNull()
    })
  })
})
