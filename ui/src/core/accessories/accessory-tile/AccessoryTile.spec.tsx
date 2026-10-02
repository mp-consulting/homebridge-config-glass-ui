import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { accessories } from '@/core/accessories/accessories'
import { AccessoryTile } from '@/core/accessories/accessory-tile/AccessoryTile'
import { hapService, matterService, renderWithProviders } from '@/testing'

/**
 * Each type tile is swapped for a stub that renders its own name, so the
 * routing is fully observable without dragging every tile's dependencies (and
 * their own specs' concerns) into this one.
 */
const stubs = vi.hoisted(() => ({
  make: (name: string) => ({ service: _service, readyForControl, type }: { service: unknown, readyForControl?: boolean, type?: string }) => (
    <div data-tile={name} data-ready={readyForControl === undefined ? 'none' : String(readyForControl)} data-type={type} />
  ),
}))

vi.mock('@/core/accessories/types/hap/access-code/AccessCodeTile', () => ({ AccessCodeTile: stubs.make('AccessCodeTile') }))
vi.mock('@/core/accessories/types/hap/air-purifier/AirPurifierTile', () => ({ AirPurifierTile: stubs.make('AirPurifierTile') }))
vi.mock('@/core/accessories/types/hap/air-quality-sensor/AirQualitySensorTile', () => ({ AirQualitySensorTile: stubs.make('AirQualitySensorTile') }))
vi.mock('@/core/accessories/types/hap/battery/BatteryTile', () => ({ BatteryTile: stubs.make('BatteryTile') }))
vi.mock('@/core/accessories/types/hap/carbon-dioxide-sensor/CarbonDioxideSensorTile', () => ({ CarbonDioxideSensorTile: stubs.make('CarbonDioxideSensorTile') }))
vi.mock('@/core/accessories/types/hap/carbon-monoxide-sensor/CarbonMonoxideSensorTile', () => ({ CarbonMonoxideSensorTile: stubs.make('CarbonMonoxideSensorTile') }))
vi.mock('@/core/accessories/types/matter/color-temperature-light/ColorTemperatureLightTile', () => ({ ColorTemperatureLightTile: stubs.make('ColorTemperatureLightTile') }))
vi.mock('@/core/accessories/types/hap/contact-sensor/ContactSensorTile', () => ({ ContactSensorTile: stubs.make('ContactSensorTile') }))
vi.mock('@/core/accessories/types/matter/dimmable-light/DimmableLightTile', () => ({ DimmableLightTile: stubs.make('DimmableLightTile') }))
vi.mock('@/core/accessories/types/hap/door/DoorTile', () => ({ DoorTile: stubs.make('DoorTile') }))
vi.mock('@/core/accessories/types/hap/doorbell/DoorbellTile', () => ({ DoorbellTile: stubs.make('DoorbellTile') }))
vi.mock('@/core/accessories/types/matter/extended-color-light/ExtendedColorLightTile', () => ({ ExtendedColorLightTile: stubs.make('ExtendedColorLightTile') }))
vi.mock('@/core/accessories/types/hap/fan/FanTile', () => ({ FanTile: stubs.make('FanTile') }))
vi.mock('@/core/accessories/types/hap/filter-maintenance/FilterMaintenanceTile', () => ({ FilterMaintenanceTile: stubs.make('FilterMaintenanceTile') }))
vi.mock('@/core/accessories/types/hap/garage-door-opener/GarageDoorOpenerTile', () => ({ GarageDoorOpenerTile: stubs.make('GarageDoorOpenerTile') }))
vi.mock('@/core/accessories/types/hap/heater-cooler/HeaterCoolerTile', () => ({ HeaterCoolerTile: stubs.make('HeaterCoolerTile') }))
vi.mock('@/core/accessories/types/hap/humidifier-dehumidifier/HumidifierDehumidifierTile', () => ({ HumidifierDehumidifierTile: stubs.make('HumidifierDehumidifierTile') }))
vi.mock('@/core/accessories/types/hap/humidity-sensor/HumiditySensorTile', () => ({ HumiditySensorTile: stubs.make('HumiditySensorTile') }))
vi.mock('@/core/accessories/types/hap/irrigation-system/IrrigationSystemTile', () => ({ IrrigationSystemTile: stubs.make('IrrigationSystemTile') }))
vi.mock('@/core/accessories/types/hap/leak-sensor/LeakSensorTile', () => ({ LeakSensorTile: stubs.make('LeakSensorTile') }))
vi.mock('@/core/accessories/types/hap/light-sensor/LightSensorTile', () => ({ LightSensorTile: stubs.make('LightSensorTile') }))
vi.mock('@/core/accessories/types/hap/lightbulb/LightbulbTile', () => ({ LightbulbTile: stubs.make('LightbulbTile') }))
vi.mock('@/core/accessories/types/hap/lock-mechanism/LockMechanismTile', () => ({ LockMechanismTile: stubs.make('LockMechanismTile') }))
vi.mock('@/core/accessories/types/matter/air-quality-sensor/MatterAirQualitySensorTile', () => ({ MatterAirQualitySensorTile: stubs.make('MatterAirQualitySensorTile') }))
vi.mock('@/core/accessories/types/matter/contact-sensor/MatterContactSensorTile', () => ({ MatterContactSensorTile: stubs.make('MatterContactSensorTile') }))
vi.mock('@/core/accessories/types/matter/door-lock/MatterDoorLockTile', () => ({ MatterDoorLockTile: stubs.make('MatterDoorLockTile') }))
vi.mock('@/core/accessories/types/matter/fan/MatterFanTile', () => ({ MatterFanTile: stubs.make('MatterFanTile') }))
vi.mock('@/core/accessories/types/matter/generic-switch/MatterGenericSwitchTile', () => ({ MatterGenericSwitchTile: stubs.make('MatterGenericSwitchTile') }))
vi.mock('@/core/accessories/types/matter/humidity-sensor/MatterHumiditySensorTile', () => ({ MatterHumiditySensorTile: stubs.make('MatterHumiditySensorTile') }))
vi.mock('@/core/accessories/types/matter/light-sensor/MatterLightSensorTile', () => ({ MatterLightSensorTile: stubs.make('MatterLightSensorTile') }))
vi.mock('@/core/accessories/types/matter/occupancy-sensor/MatterOccupancySensorTile', () => ({ MatterOccupancySensorTile: stubs.make('MatterOccupancySensorTile') }))
vi.mock('@/core/accessories/types/matter/pump/MatterPumpTile', () => ({ MatterPumpTile: stubs.make('MatterPumpTile') }))
vi.mock('@/core/accessories/types/matter/smoke-co-alarm/MatterSmokeCoAlarmTile', () => ({ MatterSmokeCoAlarmTile: stubs.make('MatterSmokeCoAlarmTile') }))
vi.mock('@/core/accessories/types/matter/temperature-sensor/MatterTemperatureSensorTile', () => ({ MatterTemperatureSensorTile: stubs.make('MatterTemperatureSensorTile') }))
vi.mock('@/core/accessories/types/matter/thermostat/MatterThermostatTile', () => ({ MatterThermostatTile: stubs.make('MatterThermostatTile') }))
vi.mock('@/core/accessories/types/matter/unknown/MatterUnknownTile', () => ({ MatterUnknownTile: stubs.make('MatterUnknownTile') }))
vi.mock('@/core/accessories/types/matter/water-leak-detector/MatterWaterLeakDetectorTile', () => ({ MatterWaterLeakDetectorTile: stubs.make('MatterWaterLeakDetectorTile') }))
vi.mock('@/core/accessories/types/matter/water-valve/MatterWaterValveTile', () => ({ MatterWaterValveTile: stubs.make('MatterWaterValveTile') }))
vi.mock('@/core/accessories/types/matter/window-covering/MatterWindowCoveringTile', () => ({ MatterWindowCoveringTile: stubs.make('MatterWindowCoveringTile') }))
vi.mock('@/core/accessories/types/hap/microphone/MicrophoneTile', () => ({ MicrophoneTile: stubs.make('MicrophoneTile') }))
vi.mock('@/core/accessories/types/hap/motion-sensor/MotionSensorTile', () => ({ MotionSensorTile: stubs.make('MotionSensorTile') }))
vi.mock('@/core/accessories/types/hap/occupancy-sensor/OccupancySensorTile', () => ({ OccupancySensorTile: stubs.make('OccupancySensorTile') }))
vi.mock('@/core/accessories/types/matter/on-off-light-switch/OnOffLightSwitchTile', () => ({ OnOffLightSwitchTile: stubs.make('OnOffLightSwitchTile') }))
vi.mock('@/core/accessories/types/matter/on-off-light/OnOffLightTile', () => ({ OnOffLightTile: stubs.make('OnOffLightTile') }))
vi.mock('@/core/accessories/types/matter/on-off-plug-in-unit/OnOffPlugInUnitTile', () => ({ OnOffPlugInUnitTile: stubs.make('OnOffPlugInUnitTile') }))
vi.mock('@/core/accessories/types/hap/outlet/OutletTile', () => ({ OutletTile: stubs.make('OutletTile') }))
vi.mock('@/core/accessories/types/hap/robot-vacuum/RobotVacuumTile', () => ({ RobotVacuumTile: stubs.make('RobotVacuumTile') }))
vi.mock('@/core/accessories/types/matter/robotic-vacuum-cleaner/RoboticVacuumCleanerTile', () => ({ RoboticVacuumCleanerTile: stubs.make('RoboticVacuumCleanerTile') }))
vi.mock('@/core/accessories/types/hap/security-system/SecuritySystemTile', () => ({ SecuritySystemTile: stubs.make('SecuritySystemTile') }))
vi.mock('@/core/accessories/types/hap/smoke-sensor/SmokeSensorTile', () => ({ SmokeSensorTile: stubs.make('SmokeSensorTile') }))
vi.mock('@/core/accessories/types/hap/speaker/SpeakerTile', () => ({ SpeakerTile: stubs.make('SpeakerTile') }))
vi.mock('@/core/accessories/types/hap/stateless-programmable-switch/StatelessProgrammableSwitchTile', () => ({ StatelessProgrammableSwitchTile: stubs.make('StatelessProgrammableSwitchTile') }))
vi.mock('@/core/accessories/types/hap/switch/SwitchTile', () => ({ SwitchTile: stubs.make('SwitchTile') }))
vi.mock('@/core/accessories/types/hap/television/TelevisionTile', () => ({ TelevisionTile: stubs.make('TelevisionTile') }))
vi.mock('@/core/accessories/types/hap/temperature-sensor/TemperatureSensorTile', () => ({ TemperatureSensorTile: stubs.make('TemperatureSensorTile') }))
vi.mock('@/core/accessories/types/hap/thermostat/ThermostatTile', () => ({ ThermostatTile: stubs.make('ThermostatTile') }))
vi.mock('@/core/accessories/types/hap/unknown/UnknownTile', () => ({ UnknownTile: stubs.make('UnknownTile') }))
vi.mock('@/core/accessories/types/hap/valve/ValveTile', () => ({ ValveTile: stubs.make('ValveTile') }))
vi.mock('@/core/accessories/types/hap/washing-machine/WashingMachineTile', () => ({ WashingMachineTile: stubs.make('WashingMachineTile') }))
vi.mock('@/core/accessories/types/hap/window-covering/WindowCoveringTile', () => ({ WindowCoveringTile: stubs.make('WindowCoveringTile') }))
vi.mock('@/core/accessories/types/hap/window/WindowTile', () => ({ WindowTile: stubs.make('WindowTile') }))

/**
 * The tile decides which of the 70-odd type components renders for an
 * accessory. Getting that wrong shows the user the wrong controls entirely,
 * and the mapping is a wall of cases that nothing else checks.
 */
describe('accessoryTile', () => {
  beforeEach(() => {
    accessories.hapReadyForControl = true
    accessories.matterReadyForControl = true
    vi.spyOn(accessories, 'showAccessoryInformation').mockResolvedValue(false)
  })

  afterEach(() => {
    accessories.hapReadyForControl = false
    accessories.matterReadyForControl = false
    vi.restoreAllMocks()
  })

  function render(service: ServiceTypeX): HTMLElement {
    return renderWithProviders(<AccessoryTile service={service} />).container
  }

  /** Which type tile the tile chose. */
  function renderedType(element: HTMLElement): string | undefined {
    return element.querySelector('[data-tile]')?.getAttribute('data-tile') ?? undefined
  }

  describe('hap accessories', () => {
    it.each([
      ['Switch', 'SwitchTile'],
      ['Thermostat', 'ThermostatTile'],
      ['Outlet', 'OutletTile'],
      ['Fan', 'FanTile'],
      ['Fanv2', 'FanTile'],
      ['AirPurifier', 'AirPurifierTile'],
      ['AccessCode', 'AccessCodeTile'],
      ['Lightbulb', 'LightbulbTile'],
      ['LightSensor', 'LightSensorTile'],
      ['LockMechanism', 'LockMechanismTile'],
      ['TemperatureSensor', 'TemperatureSensorTile'],
      ['GarageDoorOpener', 'GarageDoorOpenerTile'],
      ['MotionSensor', 'MotionSensorTile'],
      ['OccupancySensor', 'OccupancySensorTile'],
      ['ContactSensor', 'ContactSensorTile'],
      ['HumiditySensor', 'HumiditySensorTile'],
      ['AirQualitySensor', 'AirQualitySensorTile'],
      ['WindowCovering', 'WindowCoveringTile'],
      ['Window', 'WindowTile'],
      ['Door', 'DoorTile'],
      ['Television', 'TelevisionTile'],
      ['Battery', 'BatteryTile'],
      ['BatteryService', 'BatteryTile'],
      ['Speaker', 'SpeakerTile'],
      ['SmartSpeaker', 'SpeakerTile'],
      ['Doorbell', 'DoorbellTile'],
      ['Microphone', 'MicrophoneTile'],
      ['SecuritySystem', 'SecuritySystemTile'],
      ['LeakSensor', 'LeakSensorTile'],
      ['SmokeSensor', 'SmokeSensorTile'],
      ['CarbonMonoxideSensor', 'CarbonMonoxideSensorTile'],
      ['CarbonDioxideSensor', 'CarbonDioxideSensorTile'],
      ['Valve', 'ValveTile'],
      ['IrrigationSystem', 'IrrigationSystemTile'],
      ['HeaterCooler', 'HeaterCoolerTile'],
      ['Heater', 'HeaterCoolerTile'],
      ['Cooler', 'HeaterCoolerTile'],
      ['HumidifierDehumidifier', 'HumidifierDehumidifierTile'],
      ['Humidifier', 'HumidifierDehumidifierTile'],
      ['Dehumidifier', 'HumidifierDehumidifierTile'],
      ['StatelessProgrammableSwitch', 'StatelessProgrammableSwitchTile'],
      ['FilterMaintenance', 'FilterMaintenanceTile'],
      ['RobotVacuum', 'RobotVacuumTile'],
      ['WashingMachine', 'WashingMachineTile'],
    ])('shows %s as %s', (type, tile) => {
      expect(renderedType(render(hapService({ type })))).toBe(tile)
    })

    it('falls back to the unknown tile for a type it does not handle', () => {
      expect(renderedType(render(hapService({ type: 'SomeNewService' })))).toBe('UnknownTile')
    })

    it('does not mistake an Object.prototype name for a type', () => {
      expect(renderedType(render(hapService({ type: 'constructor' })))).toBe('UnknownTile')
    })

    it.each([
      ['Heater', 'heater'],
      ['Cooler', 'cooler'],
    ])('tells the shared heater cooler tile that %s is a %s', (type, expected) => {
      // One component serves three service types, and only this prop tells it
      // which face to show
      expect(render(hapService({ type })).querySelector('[data-tile="HeaterCoolerTile"]')?.getAttribute('data-type')).toBe(expected)
    })

    it.each([
      ['Humidifier', 'humidifier'],
      ['Dehumidifier', 'dehumidifier'],
    ])('tells the shared humidifier tile that %s is a %s', (type, expected) => {
      expect(render(hapService({ type })).querySelector('[data-tile="HumidifierDehumidifierTile"]')?.getAttribute('data-type')).toBe(expected)
    })

    it('hands a controllable tile the hap readiness', () => {
      accessories.hapReadyForControl = false

      expect(render(hapService({ type: 'Switch' })).querySelector('[data-tile]')?.getAttribute('data-ready')).toBe('false')
    })

    it('hands a sensor tile no readiness at all', () => {
      expect(render(hapService({ type: 'MotionSensor' })).querySelector('[data-tile]')?.getAttribute('data-ready')).toBe('none')
    })
  })

  describe('matter accessories', () => {
    it.each([
      ['OnOffLight', 'OnOffLightTile'],
      ['DimmableLight', 'DimmableLightTile'],
      ['ColorTemperatureLight', 'ColorTemperatureLightTile'],
      ['ExtendedColorLight', 'ExtendedColorLightTile'],
      ['OnOffPlugInUnit', 'OnOffPlugInUnitTile'],
      ['OnOffLightSwitch', 'OnOffLightSwitchTile'],
      ['RoboticVacuumCleaner', 'RoboticVacuumCleanerTile'],
      ['ContactSensor', 'MatterContactSensorTile'],
      ['OccupancySensor', 'MatterOccupancySensorTile'],
      ['LightSensor', 'MatterLightSensorTile'],
      ['TemperatureSensor', 'MatterTemperatureSensorTile'],
      ['HumiditySensor', 'MatterHumiditySensorTile'],
      ['SmokeCoAlarm', 'MatterSmokeCoAlarmTile'],
      ['WaterLeakDetector', 'MatterWaterLeakDetectorTile'],
      ['AirQualitySensor', 'MatterAirQualitySensorTile'],
      ['DoorLock', 'MatterDoorLockTile'],
      ['WindowCovering', 'MatterWindowCoveringTile'],
      ['Door', 'MatterWindowCoveringTile'],
      ['Window', 'MatterWindowCoveringTile'],
      ['Fan', 'MatterFanTile'],
      ['Thermostat', 'MatterThermostatTile'],
      ['RoomAirConditioner', 'MatterThermostatTile'],
      ['GenericSwitch', 'MatterGenericSwitchTile'],
      ['WaterValve', 'MatterWaterValveTile'],
      ['Pump', 'MatterPumpTile'],
    ])('shows %s as %s', (deviceType, tile) => {
      expect(renderedType(render(matterService({ deviceType })))).toBe(tile)
    })

    it('falls back to the unknown tile for a device type it does not handle', () => {
      expect(renderedType(render(matterService({ deviceType: 'SomeNewDevice' })))).toBe('MatterUnknownTile')
    })

    it('uses the matter tiles even when the device type also exists in hap', () => {
      // Both protocols have a 'ContactSensor', so picking the branch by
      // protocol rather than by name is what keeps them apart
      expect(renderedType(render(matterService({ deviceType: 'ContactSensor' })))).toBe('MatterContactSensorTile')
    })
  })

  describe('a user chosen type', () => {
    it('overrides the hap service type', () => {
      // The accessory info modal lets a user re-label a switch as an outlet
      expect(renderedType(render(hapService({ type: 'Switch', overrides: { customType: 'Outlet' } })))).toBe('OutletTile')
    })

    it('overrides the matter device type', () => {
      const service = matterService({ deviceType: 'OnOffLight', overrides: { customType: 'OnOffPlugInUnit' } })

      expect(renderedType(render(service))).toBe('OnOffPlugInUnitTile')
    })

    it('still falls back when the chosen type is not handled', () => {
      expect(renderedType(render(hapService({ type: 'Switch', overrides: { customType: 'NotAThing' } })))).toBe('UnknownTile')
    })
  })

  describe('the header button', () => {
    it('offers the accessory menu once hap is ready', () => {
      const element = render(hapService())

      expect(element.querySelector('.manage-accessory-button')).not.toBeNull()
      expect(element.querySelector('.refreshing-accessory-button')).toBeNull()
    })

    it('shows a spinner while hap is still connecting', () => {
      accessories.hapReadyForControl = false

      expect(render(hapService()).querySelector('.refreshing-accessory-button')).not.toBeNull()
    })

    it('reads the matter readiness for a matter accessory', () => {
      // A matter accessory must not be gated on the hap connection, and the
      // two protocols come up independently
      accessories.hapReadyForControl = false
      accessories.matterReadyForControl = true

      expect(render(matterService()).querySelector('.manage-accessory-button')).not.toBeNull()
    })

    it('shows a spinner while matter is still connecting', () => {
      accessories.matterReadyForControl = false

      expect(render(matterService()).querySelector('.refreshing-accessory-button')).not.toBeNull()
    })

    it.each([
      ['ready', true, '.manage-accessory-button'],
      ['connecting', false, '.refreshing-accessory-button'],
    ])('opens the accessory details from the %s button', (_state, ready, selector) => {
      accessories.hapReadyForControl = ready
      const service = hapService()
      const element = render(service)

      fireEvent.click(element.querySelector<HTMLButtonElement>(selector)!)

      expect(accessories.showAccessoryInformation).toHaveBeenCalledWith(service)
    })

    it('labels the button with the accessory name', () => {
      const element = render(hapService({ overrides: { customName: 'Kettle' } }))

      expect(element.querySelector('.manage-accessory-button')?.getAttribute('aria-label')).toBe('form.button_edit Kettle')
    })

    it('marks a hidden accessory', () => {
      const element = render(hapService({ overrides: { hidden: true } }))

      expect(element.querySelector('.accessory-hidden-indicator')).not.toBeNull()
      expect(element.querySelector('.accessory-hidden-icon')).not.toBeNull()
    })
  })
})
