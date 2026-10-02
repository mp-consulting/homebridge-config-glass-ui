import { useSettingsStore } from '@/core/settings/settings.store'

/**
 * Round a celsius reading to one decimal place, converting it to fahrenheit
 * first when that is the unit asked for.
 * @param value - the reading in celsius
 * @param unit - the unit to show; defaults to the one in the UI settings
 */
export function convertTemp(value: number, unit: 'c' | 'f' = useSettingsStore.getState().env.temperatureUnits): number {
  if (unit === 'f') {
    return Math.round((value * 1.8 + 32) * 10) / 10
  }
  return Math.round(value * 10) / 10
}
