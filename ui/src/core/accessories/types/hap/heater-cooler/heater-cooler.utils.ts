import type { ServiceTypeX, SliderControlConfig } from '@/core/accessories/accessories.interfaces'

export type HeaterCoolerType = 'heater' | 'cooler' | undefined

/**
 * Whether a heater cooler is heating or cooling right now. A dedicated heater
 * or cooler (the tile's `type`) counts as working whenever it is on.
 */
function heaterCoolerStatus(service: ServiceTypeX, type: HeaterCoolerType): 'cooling' | 'heating' | 'active' | 'inactive' {
  const values = service.values
  const isActive = values?.Active || values?.On
  const isCooling = (values?.CurrentHeaterCoolerState === 3 && values?.Active === 1)
    || (type === 'cooler' && isActive)
  const isHeating = (values?.CurrentHeaterCoolerState === 2 && values?.Active === 1)
    || (type === 'heater' && isActive)

  if (isCooling) {
    return 'cooling'
  }
  if (isHeating) {
    return 'heating'
  }
  return isActive ? 'active' : 'inactive'
}

/** The tile's status window fill. */
export function heaterCoolerStatusFill(service: ServiceTypeX, type: HeaterCoolerType): string {
  return {
    cooling: 'url(#coolingGradient)',
    heating: 'url(#heatingGradient)',
    active: '#42d672',
    inactive: '#7b7b7b',
  }[heaterCoolerStatus(service, type)]
}

/** The modal's thermometer colour class. */
export function heaterCoolerStatusClass(service: ServiceTypeX, type: HeaterCoolerType): string {
  return `status-color-${heaterCoolerStatus(service, type)}`
}

/** A tap on a heater cooler or humidifier: Active first, else On. */
export function toggleActiveOrOn(service: ServiceTypeX) {
  if ('Active' in service.values) {
    void service.getCharacteristic!('Active').setValue!(service.values.Active ? 0 : 1)
  } else if ('On' in service.values) {
    void service.getCharacteristic!('On').setValue!(!service.values.On)
  }
}

/**
 * A linked Fan / Fanv2 service of the same physical device, which the
 * accessories service folds in so the modal can show its speed.
 * @param service - the service the modal manages
 */
export function linkedFan(service: ServiceTypeX): ServiceTypeX | undefined {
  if (!service.linkedServices) {
    return undefined
  }
  return Object.values(service.linkedServices).find((s: any) => s.type === 'Fan' || s.type === 'Fanv2') as ServiceTypeX | undefined
}

/**
 * The rotation speed slider of a linked fan, if it has one.
 * @param fan - the linked fan service
 */
export function loadRotationSpeed(fan: ServiceTypeX | undefined): SliderControlConfig | undefined {
  const RotationSpeed = fan?.getCharacteristic!('RotationSpeed')
  if (!RotationSpeed) {
    return undefined
  }
  return {
    value: RotationSpeed.value as number,
    min: RotationSpeed.minValue,
    max: RotationSpeed.maxValue,
    step: RotationSpeed.minStep,
    unit: RotationSpeed.unit as SliderControlConfig['unit'],
  }
}

/** The fan slider's colour follows the unit's state: grey off, blue cool, orange heat, green auto. */
export function heaterCoolerFanGradient(state: number, mode: number): string {
  if (!state) {
    // Off - grey
    return 'linear-gradient(to right, #c0c0c0, #7b7b7b)'
  }
  switch (mode) {
    case 2: // Cool
      return 'linear-gradient(to right, #add8e6, #416bdf)'
    case 1: // Heat
      return 'linear-gradient(to right, #ffb978, #e05a33)'
    case 0: // Auto
    default:
      return 'linear-gradient(to right, #90ee90, #2d8659)'
  }
}
