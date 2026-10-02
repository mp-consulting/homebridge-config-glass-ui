import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

import { currentConsumption, hasCurrentConsumption } from '@/core/accessories/types/hap/hap-tile'
import { colour } from '@/core/utilities/colour'

export interface AdaptiveLightingState {
  has: boolean
  enabled: boolean
}

/** The colour the bulb icon is painted, from its hue, colour temperature or neither. */
export function getBulbFill(service: ServiceTypeX): string {
  const values = service.values
  if (!(values?.On || values?.Active)) {
    return 'none'
  }

  if ('Hue' in values) {
    return colour.hueSaturationToHsl(values?.Hue, values?.Saturation)
  }

  if ('ColorTemperature' in values) {
    return colour.kelvinToHsl(colour.miredToKelvin(values?.ColorTemperature))
  }
  return '#ffcf55'
}

function adaptiveAndPower(service: ServiceTypeX, adaptive: AdaptiveLightingState): string {
  let label = ''
  if (adaptive.has) {
    const cls = adaptive.enabled ? 'on-text' : 'grey-text'
    label += ` &middot; <i class='fas fa-sun ${cls}'></i>`
  }
  if (hasCurrentConsumption(service)) {
    label += ` &middot; ${currentConsumption(service)}W`
  }
  return label
}

/** The second line under a dimmable bulb, as HTML (it carries the adaptive lighting icon). */
export function getBrightnessLabel(service: ServiceTypeX, adaptive: AdaptiveLightingState): string {
  const values = service.values
  if (!values?.On) {
    return ''
  }
  return `${values?.Brightness}%${adaptiveAndPower(service, adaptive)}`
}

/** The suffix after "On" under a bulb with no brightness, as HTML. */
export function getOnOffLabel(service: ServiceTypeX, adaptive: AdaptiveLightingState): string {
  const values = service.values
  if (!(values?.On || values?.Active)) {
    return ''
  }
  return adaptiveAndPower(service, adaptive)
}
