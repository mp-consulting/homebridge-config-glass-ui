import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

/** On: active, unless it reports a purifier state of inactive (0). Or a plain On. */
export function airPurifierIsOn(service: ServiceTypeX): boolean {
  const values = service.values
  return !!(
    (values?.Active && !('CurrentAirPurifierState' in values))
    || (values?.Active && 'CurrentAirPurifierState' in values && values?.CurrentAirPurifierState !== 0)
    || values?.On
  )
}

/** Purifying: active with no state to say otherwise, or reporting state 2 (purifying air). */
export function airPurifierIsPurifying(service: ServiceTypeX): boolean {
  const values = service.values
  return !!(
    (values?.Active && !('CurrentAirPurifierState' in values))
    || (values?.Active && 'CurrentAirPurifierState' in values && values?.CurrentAirPurifierState === 2)
    || values?.On
  )
}
