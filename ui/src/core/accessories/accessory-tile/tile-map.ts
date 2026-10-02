import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { ComponentType } from 'react'

import { AccessCodeTile } from '@/core/accessories/types/hap/access-code/AccessCodeTile'
import { AirPurifierTile } from '@/core/accessories/types/hap/air-purifier/AirPurifierTile'
import { AirQualitySensorTile } from '@/core/accessories/types/hap/air-quality-sensor/AirQualitySensorTile'
import { BatteryTile } from '@/core/accessories/types/hap/battery/BatteryTile'
import { CarbonDioxideSensorTile } from '@/core/accessories/types/hap/carbon-dioxide-sensor/CarbonDioxideSensorTile'
import { CarbonMonoxideSensorTile } from '@/core/accessories/types/hap/carbon-monoxide-sensor/CarbonMonoxideSensorTile'
import { ContactSensorTile } from '@/core/accessories/types/hap/contact-sensor/ContactSensorTile'
import { DoorTile } from '@/core/accessories/types/hap/door/DoorTile'
import { DoorbellTile } from '@/core/accessories/types/hap/doorbell/DoorbellTile'
import { FanTile } from '@/core/accessories/types/hap/fan/FanTile'
import { FilterMaintenanceTile } from '@/core/accessories/types/hap/filter-maintenance/FilterMaintenanceTile'
import { GarageDoorOpenerTile } from '@/core/accessories/types/hap/garage-door-opener/GarageDoorOpenerTile'
import { HeaterCoolerTile } from '@/core/accessories/types/hap/heater-cooler/HeaterCoolerTile'
import { HumidifierDehumidifierTile } from '@/core/accessories/types/hap/humidifier-dehumidifier/HumidifierDehumidifierTile'
import { HumiditySensorTile } from '@/core/accessories/types/hap/humidity-sensor/HumiditySensorTile'
import { IrrigationSystemTile } from '@/core/accessories/types/hap/irrigation-system/IrrigationSystemTile'
import { LeakSensorTile } from '@/core/accessories/types/hap/leak-sensor/LeakSensorTile'
import { LightSensorTile } from '@/core/accessories/types/hap/light-sensor/LightSensorTile'
import { LightbulbTile } from '@/core/accessories/types/hap/lightbulb/LightbulbTile'
import { LockMechanismTile } from '@/core/accessories/types/hap/lock-mechanism/LockMechanismTile'
import { MicrophoneTile } from '@/core/accessories/types/hap/microphone/MicrophoneTile'
import { MotionSensorTile } from '@/core/accessories/types/hap/motion-sensor/MotionSensorTile'
import { OccupancySensorTile } from '@/core/accessories/types/hap/occupancy-sensor/OccupancySensorTile'
import { OutletTile } from '@/core/accessories/types/hap/outlet/OutletTile'
import { RobotVacuumTile } from '@/core/accessories/types/hap/robot-vacuum/RobotVacuumTile'
import { SecuritySystemTile } from '@/core/accessories/types/hap/security-system/SecuritySystemTile'
import { SmokeSensorTile } from '@/core/accessories/types/hap/smoke-sensor/SmokeSensorTile'
import { SpeakerTile } from '@/core/accessories/types/hap/speaker/SpeakerTile'
import { StatelessProgrammableSwitchTile } from '@/core/accessories/types/hap/stateless-programmable-switch/StatelessProgrammableSwitchTile'
import { SwitchTile } from '@/core/accessories/types/hap/switch/SwitchTile'
import { TelevisionTile } from '@/core/accessories/types/hap/television/TelevisionTile'
import { TemperatureSensorTile } from '@/core/accessories/types/hap/temperature-sensor/TemperatureSensorTile'
import { ThermostatTile } from '@/core/accessories/types/hap/thermostat/ThermostatTile'
import { UnknownTile } from '@/core/accessories/types/hap/unknown/UnknownTile'
import { ValveTile } from '@/core/accessories/types/hap/valve/ValveTile'
import { WashingMachineTile } from '@/core/accessories/types/hap/washing-machine/WashingMachineTile'
import { WindowCoveringTile } from '@/core/accessories/types/hap/window-covering/WindowCoveringTile'
import { WindowTile } from '@/core/accessories/types/hap/window/WindowTile'
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

/** What every tile takes; a few take a  too (the shared heater / humidifier tiles). */
export interface TileComponentProps {
  service: ServiceTypeX
  readyForControl?: boolean
  type?: string
}

export interface TileEntry {
  component: ComponentType<any>
  /** Whether the tile controls the accessory, and so is handed `readyForControl`. */
  control?: boolean
  /** Classes Angular put on the tile's host element (`<app-fan class="w-100">`); rendered on a wrapper div */
  hostClass?: string
  /** Fixed props, e.g. which face the shared heater-cooler tile shows. */
  props?: Record<string, unknown>
}

/** Matter device types (or a user's custom type) → tile. */
export const MATTER_TILES: Record<string, TileEntry> = {
  OnOffLight: { component: OnOffLightTile, control: true },
  DimmableLight: { component: DimmableLightTile, control: true },
  ColorTemperatureLight: { component: ColorTemperatureLightTile, control: true },
  ExtendedColorLight: { component: ExtendedColorLightTile, control: true },
  OnOffPlugInUnit: { component: OnOffPlugInUnitTile, control: true },
  OnOffLightSwitch: { component: OnOffLightSwitchTile, control: true },
  RoboticVacuumCleaner: { component: RoboticVacuumCleanerTile, control: true },
  ContactSensor: { component: MatterContactSensorTile },
  OccupancySensor: { component: MatterOccupancySensorTile },
  LightSensor: { component: MatterLightSensorTile },
  TemperatureSensor: { component: MatterTemperatureSensorTile },
  HumiditySensor: { component: MatterHumiditySensorTile },
  SmokeCoAlarm: { component: MatterSmokeCoAlarmTile },
  WaterLeakDetector: { component: MatterWaterLeakDetectorTile },
  AirQualitySensor: { component: MatterAirQualitySensorTile },
  DoorLock: { component: MatterDoorLockTile, control: true },
  WindowCovering: { component: MatterWindowCoveringTile, control: true },
  Door: { component: MatterWindowCoveringTile, control: true },
  Window: { component: MatterWindowCoveringTile, control: true },
  Fan: { component: MatterFanTile, control: true },
  Thermostat: { component: MatterThermostatTile, control: true },
  RoomAirConditioner: { component: MatterThermostatTile, control: true },
  GenericSwitch: { component: MatterGenericSwitchTile },
  WaterValve: { component: MatterWaterValveTile, control: true },
  Pump: { component: MatterPumpTile, control: true },
}

export const MATTER_UNKNOWN_TILE: TileEntry = { component: MatterUnknownTile }

/** HAP service types (or a user's custom type) → tile. */
export const HAP_TILES: Record<string, TileEntry> = {
  Switch: { component: SwitchTile, control: true },
  Thermostat: { component: ThermostatTile, control: true },
  Outlet: { component: OutletTile, control: true },
  Fan: { component: FanTile, control: true, hostClass: 'w-100' },
  Fanv2: { component: FanTile, control: true, hostClass: 'w-100' },
  AirPurifier: { component: AirPurifierTile, control: true, hostClass: 'w-100' },
  AccessCode: { component: AccessCodeTile, control: true, hostClass: 'w-100' },
  Lightbulb: { component: LightbulbTile, control: true },
  LightSensor: { component: LightSensorTile },
  LockMechanism: { component: LockMechanismTile, control: true },
  TemperatureSensor: { component: TemperatureSensorTile },
  GarageDoorOpener: { component: GarageDoorOpenerTile, control: true },
  MotionSensor: { component: MotionSensorTile },
  OccupancySensor: { component: OccupancySensorTile },
  ContactSensor: { component: ContactSensorTile },
  HumiditySensor: { component: HumiditySensorTile },
  AirQualitySensor: { component: AirQualitySensorTile },
  WindowCovering: { component: WindowCoveringTile, control: true },
  Window: { component: WindowTile, control: true },
  Door: { component: DoorTile, control: true },
  Television: { component: TelevisionTile, control: true },
  Battery: { component: BatteryTile },
  BatteryService: { component: BatteryTile },
  Speaker: { component: SpeakerTile, control: true },
  SmartSpeaker: { component: SpeakerTile, control: true },
  Doorbell: { component: DoorbellTile, control: true },
  Microphone: { component: MicrophoneTile, control: true },
  SecuritySystem: { component: SecuritySystemTile, control: true },
  LeakSensor: { component: LeakSensorTile },
  SmokeSensor: { component: SmokeSensorTile },
  CarbonMonoxideSensor: { component: CarbonMonoxideSensorTile },
  CarbonDioxideSensor: { component: CarbonDioxideSensorTile },
  Valve: { component: ValveTile, control: true },
  IrrigationSystem: { component: IrrigationSystemTile },
  HeaterCooler: { component: HeaterCoolerTile, control: true },
  Heater: { component: HeaterCoolerTile, control: true, props: { type: 'heater' } },
  Cooler: { component: HeaterCoolerTile, control: true, props: { type: 'cooler' } },
  HumidifierDehumidifier: { component: HumidifierDehumidifierTile, control: true },
  Humidifier: { component: HumidifierDehumidifierTile, control: true, props: { type: 'humidifier' } },
  Dehumidifier: { component: HumidifierDehumidifierTile, control: true, props: { type: 'dehumidifier' } },
  StatelessProgrammableSwitch: { component: StatelessProgrammableSwitchTile },
  FilterMaintenance: { component: FilterMaintenanceTile, control: true },
  RobotVacuum: { component: RobotVacuumTile, control: true },
  WashingMachine: { component: WashingMachineTile, control: true },
}

export const HAP_UNKNOWN_TILE: TileEntry = { component: UnknownTile }

/**
 * The tile for a service: a user-chosen type wins over the real one, the
 * branch is picked by protocol (both have a 'ContactSensor'), and anything
 * not handled falls back to the unknown tile.
 * @param service - the accessory service
 */
export function tileFor(service: ServiceTypeX): TileEntry {
  if (service.protocol === 'matter') {
    const key = service.customType || service.deviceType
    return (key && Object.hasOwn(MATTER_TILES, key) ? MATTER_TILES[key] : undefined) ?? MATTER_UNKNOWN_TILE
  }
  const key = service.customType || service.type || service.deviceType
  return (key && Object.hasOwn(HAP_TILES, key) ? HAP_TILES[key] : undefined) ?? HAP_UNKNOWN_TILE
}
