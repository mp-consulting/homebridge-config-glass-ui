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
