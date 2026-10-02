import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

/**
 * Whether a speaker, microphone or doorbell reads as on. These have no single
 * characteristic to toggle: a plugin may publish On, Active, a media state or
 * only a mute flag, so this walks a fallback chain. Paused still counts as on.
 * @param service - the accessory service
 */
export function mediaIsOn(service: ServiceTypeX): boolean {
  const values = service.values
  if ('On' in values) {
    return !!values?.On
  }
  if ('Active' in values) {
    return !!values?.Active
  }
  if ('CurrentMediaState' in values) {
    return [0, 1].includes(values?.CurrentMediaState)
  }
  if ('Mute' in values && 'Volume' in values) {
    return !values?.Mute && values?.Volume > 0
  }
  return 'Mute' in values && !values?.Mute
}

/** What a tap writes, down the same chain. */
export function mediaToggle(service: ServiceTypeX) {
  const values = service.values
  if ('On' in values) {
    void service.getCharacteristic!('On').setValue!(!values.On)
  } else if ('Active' in values) {
    void service.getCharacteristic!('Active').setValue!(values.Active === 0 ? 1 : 0)
  } else if ('TargetMediaState' in values) {
    void service.getCharacteristic!('TargetMediaState').setValue!(values.TargetMediaState === 0 ? 1 : 0)
  } else if ('Mute' in values) {
    void service.getCharacteristic!('Mute').setValue!(!values.Mute)
  }
}

/** Whether there is anything for the manage modal to show. */
export function mediaHasControls(service: ServiceTypeX): boolean {
  const values = service.values
  return 'Active' in values || 'TargetMediaState' in values || 'Volume' in values || 'Mute' in values
}
