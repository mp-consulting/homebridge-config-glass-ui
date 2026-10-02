import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

/** The fill of the tile's status window: animated while heating or cooling, green while idle in auto. */
export function thermostatStatusFill(service: ServiceTypeX): string {
  const state = service.values?.CurrentHeatingCoolingState
  const target = service.values?.TargetHeatingCoolingState
  if (state === 2) {
    return 'url(#coolingGradient)'
  }
  if (state === 1) {
    return 'url(#heatingGradient)'
  }
  if (target === 3) {
    return '#42d672'
  }
  return '#7b7b7b'
}

/** The colour class of the modal's thermometer icon, by the same rules. */
export function thermostatStatusClass(service: ServiceTypeX): string {
  const state = service.values?.CurrentHeatingCoolingState
  const target = service.values?.TargetHeatingCoolingState
  if (state === 2) {
    return 'status-color-cooling'
  }
  if (state === 1) {
    return 'status-color-heating'
  }
  if (target === 3) {
    return 'status-color-active'
  }
  return 'status-color-inactive'
}
