import { lazyModal } from '@/core/ui/lazy-modal'

/**
 * The Matter accessory manage modals, each loaded the first time it is
 * opened. The tiles import these rather than the modals themselves, so the
 * tile chunk (rooms page and dashboard widget) does not carry every modal
 * and nouislider.
 */
export const AirQualitySensorManage = lazyModal(async () => (await import('./air-quality-sensor/AirQualitySensorManage')).AirQualitySensorManage)
export const ColorTemperatureLightManage = lazyModal(async () => (await import('./color-temperature-light/ColorTemperatureLightManage')).ColorTemperatureLightManage)
export const DimmableLightManage = lazyModal(async () => (await import('./dimmable-light/DimmableLightManage')).DimmableLightManage)
export const DoorLockManage = lazyModal(async () => (await import('./door-lock/DoorLockManage')).DoorLockManage)
export const ExtendedColorLightManage = lazyModal(async () => (await import('./extended-color-light/ExtendedColorLightManage')).ExtendedColorLightManage)
export const MatterFanManage = lazyModal(async () => (await import('./fan/MatterFanManage')).MatterFanManage)
export const MatterThermostatManage = lazyModal(async () => (await import('./thermostat/MatterThermostatManage')).MatterThermostatManage)
export const RoboticVacuumCleanerManage = lazyModal(async () => (await import('./robotic-vacuum-cleaner/RoboticVacuumCleanerManage')).RoboticVacuumCleanerManage)
export const WindowCoveringManage = lazyModal(async () => (await import('./window-covering/WindowCoveringManage')).WindowCoveringManage)
