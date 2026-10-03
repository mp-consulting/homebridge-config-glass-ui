import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalData } from '@/core/accessories/types/use-manage-accessory'
import type { ModalComponentProps } from '@/core/ui/modal'

import { convertTemp } from '@/core/pipes/convert-temp'
import { formatDecimal } from '@/core/pipes/decimal'
import { useSettingsStore } from '@/core/settings/settings.store'

/** What every HAP tile takes (the Angular `service` / `readyForControl` inputs). */
export interface HapTileProps {
  service: ServiceTypeX
  /** False until the bridge can route writes to the accessory: a tap must do nothing before then. */
  readyForControl?: boolean
}

/** Whether the accessory reports a power reading. */
export function hasCurrentConsumption(service: ServiceTypeX): boolean {
  return 'Consumption' in service.values
}

/** The power reading, if the accessory reports one. */
export function currentConsumption(service: ServiceTypeX): number | undefined {
  if (!hasCurrentConsumption(service)) {
    return undefined
  }
  return service.values.Consumption
}

/**
 * What every HAP manage modal takes: the modal data plus `activeModal`.
 * (`AccessoryManageModalProps` narrows `activeModal` to close/dismiss, which
 * `openModal` does not accept as a component type.)
 */
export type HapManageProps = AccessoryManageModalData & ModalComponentProps

/**
 * `value | convertTemp | number: '1.0-1'`: a celsius reading in the user's unit, to one decimal.
 * @param value - the reading in celsius
 * @param unit - the unit to show
 */
export function formatTemp(value: number | undefined, unit: 'c' | 'f'): string {
  if (value === undefined || value === null) {
    return ''
  }
  return formatDecimal(convertTemp(value, unit), '1.0-1')
}

/** The temperature unit from the UI settings (`$settings.env.temperatureUnits`), upper-cased by callers. */
export function useTemperatureUnits(): 'c' | 'f' {
  // 'c' until the settings have loaded, rather than crashing on undefined
  return useSettingsStore(state => state.env?.temperatureUnits) || 'c'
}

/**
 * The accessible name of a tile: `{name}, {type}, {state}`, leaving the type
 * out when the name already says it (a "Kitchen Light" is not read as
 * "Kitchen Light, Lightbulb"). Tiles put it in `aria-label` next to a `role`
 * (`switch` + `aria-checked` for an on/off tile, `button` otherwise), since
 * the icon and the two label lines say nothing useful to a screen reader.
 * @param name - the name the tile shows
 * @param srType - the translated accessory type
 * @param stateText - the state as plain text (empty to leave it out)
 */
export function tileLabel(name: string | undefined, srType: string, stateText: string): string {
  const baseName = (name || '').trim()
  const includeType = !baseName.toLowerCase().includes(srType.toLowerCase())
  return [baseName, includeType ? srType : '', stateText].filter(Boolean).join(', ')
}

/**
 * ` · 12W` after an on state, when the accessory reports its power use.
 * @param service - the accessory service
 */
export function consumptionSuffix(service: ServiceTypeX): string {
  return hasCurrentConsumption(service) ? ` · ${currentConsumption(service)}W` : ''
}
