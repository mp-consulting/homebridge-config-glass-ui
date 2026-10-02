import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

export type HumidifierType = 'humidifier' | 'dehumidifier' | undefined

/** Whether it is humidifying or dehumidifying right now; a dedicated unit (`type`) counts whenever it is on. */
function humidifierStatus(service: ServiceTypeX, type: HumidifierType): 'humidifying' | 'dehumidifying' | 'active' | 'inactive' {
  const values = service.values
  const isActive = values?.Active || values?.On
  const isHumidifying = (values?.CurrentHumidifierDehumidifierState === 2 && values?.Active === 1)
    || (type === 'humidifier' && isActive)
  const isDehumidifying = (values?.CurrentHumidifierDehumidifierState === 3 && values?.Active === 1)
    || (type === 'dehumidifier' && isActive)

  if (isHumidifying) {
    return 'humidifying'
  }
  if (isDehumidifying) {
    return 'dehumidifying'
  }
  return isActive ? 'active' : 'inactive'
}

/** The tile's status window fill. */
export function humidifierStatusFill(service: ServiceTypeX, type: HumidifierType): string {
  return {
    humidifying: 'url(#humidifyingGradient)',
    dehumidifying: 'url(#dehumidifyingGradient)',
    active: '#42d672',
    inactive: '#7b7b7b',
  }[humidifierStatus(service, type)]
}

/** The modal's icon colour: humidifying borrows the cooling colour, dehumidifying the heating one. */
export function humidifierStatusClass(service: ServiceTypeX, type: HumidifierType): string {
  return {
    humidifying: 'status-color-cooling',
    dehumidifying: 'status-color-heating',
    active: 'status-color-active',
    inactive: 'status-color-inactive',
  }[humidifierStatus(service, type)]
}

/** The fan slider's colour: grey off, blue humidifying, orange dehumidifying, green auto. */
export function humidifierFanGradient(state: number, mode: number): string {
  if (!state) {
    // Off - grey
    return 'linear-gradient(to right, #c0c0c0, #7b7b7b)'
  }
  switch (mode) {
    case 1: // Humidify
      return 'linear-gradient(to right, #add8e6, #416bdf)'
    case 2: // Dehumidify
      return 'linear-gradient(to right, #ffb978, #e05a33)'
    case 0: // Auto
    default:
      return 'linear-gradient(to right, #90ee90, #2d8659)'
  }
}
