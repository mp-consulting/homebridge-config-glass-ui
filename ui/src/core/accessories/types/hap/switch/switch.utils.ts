import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

/**
 * Whether a generic switch tile shows as on. The switch (and the outlet, its
 * copy) stands in for any accessory a plugin exposed as a generic switch,
 * whatever it is underneath, so this is a precedence chain, not a set of
 * alternatives.
 * @param service - the accessory service
 */
export function switchIsOn(service: ServiceTypeX): boolean {
  const values = service.values
  if (!values) {
    return false
  }

  if ('On' in values) {
    return !!values.On
  }
  if ('Active' in values) {
    return !!values.Active
  }
  if ('CurrentMediaState' in values) {
    return [0, 1].includes(values.CurrentMediaState)
  }
  if ('Mute' in values && 'Volume' in values) {
    return !values.Mute && values.Volume > 0
  }
  if ('Mute' in values) {
    return !values.Mute
  }
  if ('LockTargetState' in values) {
    return !values.LockTargetState
  }
  if ('CurrentDoorState' in values) {
    return [0, 2].includes(values.CurrentDoorState)
  }
  return false
}

/**
 * What a tap on a generic switch tile writes, in the same precedence order.
 * @param service - the accessory service
 */
export function switchToggle(service: ServiceTypeX) {
  const values = service.values
  if ('On' in values) {
    void service.getCharacteristic!('On').setValue!(!values.On)
  } else if ('Active' in values) {
    void service.getCharacteristic!('Active').setValue!(values.Active ? 0 : 1)
  } else if ('TargetMediaState' in values) {
    void service.getCharacteristic!('TargetMediaState').setValue!(values.TargetMediaState === 0 ? 1 : 0)
  } else if ('Mute' in values) {
    void service.getCharacteristic!('Mute').setValue!(!values.Mute)
  } else if ('LockTargetState' in values) {
    void service.getCharacteristic!('LockTargetState').setValue!(values.LockTargetState ? 0 : 1)
  } else if ('TargetDoorState' in values) {
    void service.getCharacteristic!('TargetDoorState').setValue!(values.TargetDoorState ? 0 : 1)
  }
}
