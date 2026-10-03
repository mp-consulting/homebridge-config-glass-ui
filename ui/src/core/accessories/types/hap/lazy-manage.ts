import { lazyModal } from '@/core/ui/lazy-modal'

/**
 * The HAP accessory manage modals, each loaded the first time it is
 * opened. The tiles import these rather than the modals themselves, so the
 * tile chunk (rooms page and dashboard widget) does not carry every modal
 * and nouislider.
 */
export const AirPurifierManage = lazyModal(async () => (await import('./air-purifier/AirPurifierManage')).AirPurifierManage)
export const AirQualitySensorManage = lazyModal(async () => (await import('./air-quality-sensor/AirQualitySensorManage')).AirQualitySensorManage)
export const DoorManage = lazyModal(async () => (await import('./door/DoorManage')).DoorManage)
export const DoorbellManage = lazyModal(async () => (await import('./doorbell/DoorbellManage')).DoorbellManage)
export const FanManage = lazyModal(async () => (await import('./fan/FanManage')).FanManage)
export const FilterMaintenanceManage = lazyModal(async () => (await import('./filter-maintenance/FilterMaintenanceManage')).FilterMaintenanceManage)
export const GarageDoorOpenerManage = lazyModal(async () => (await import('./garage-door-opener/GarageDoorOpenerManage')).GarageDoorOpenerManage)
export const HeaterCoolerManage = lazyModal(async () => (await import('./heater-cooler/HeaterCoolerManage')).HeaterCoolerManage)
export const HumidifierDehumidifierManage = lazyModal(async () => (await import('./humidifier-dehumidifier/HumidifierDehumidifierManage')).HumidifierDehumidifierManage)
export const LightbulbManage = lazyModal(async () => (await import('./lightbulb/LightbulbManage')).LightbulbManage)
export const LockMechanismManage = lazyModal(async () => (await import('./lock-mechanism/LockMechanismManage')).LockMechanismManage)
export const MicrophoneManage = lazyModal(async () => (await import('./microphone/MicrophoneManage')).MicrophoneManage)
export const SecuritySystemManage = lazyModal(async () => (await import('./security-system/SecuritySystemManage')).SecuritySystemManage)
export const SpeakerManage = lazyModal(async () => (await import('./speaker/SpeakerManage')).SpeakerManage)
export const TelevisionManage = lazyModal(async () => (await import('./television/TelevisionManage')).TelevisionManage)
export const ThermostatManage = lazyModal(async () => (await import('./thermostat/ThermostatManage')).ThermostatManage)
export const ValveManage = lazyModal(async () => (await import('./valve/ValveManage')).ValveManage)
export const WindowCoveringManage = lazyModal(async () => (await import('./window-covering/WindowCoveringManage')).WindowCoveringManage)
export const WindowManage = lazyModal(async () => (await import('./window/WindowManage')).WindowManage)
