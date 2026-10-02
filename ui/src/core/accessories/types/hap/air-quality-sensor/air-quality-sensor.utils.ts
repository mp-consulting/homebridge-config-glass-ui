import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

/** The label for each HAP AirQuality value, 0 (unknown) to 5 (poor). */
export const AIR_QUALITY_LABELS = [
  'accessories.control.air_quality_unknown',
  'accessories.control.air_quality_excellent',
  'accessories.control.air_quality_good',
  'accessories.control.air_quality_fair',
  'accessories.control.air_quality_inferior',
  'accessories.control.air_quality_poor',
]

/** Whether the sensor reports any concentration, which is all the modal shows. A reading of zero counts. */
export function airQualityHasReadings(service: ServiceTypeX): boolean {
  const values = service.values
  return values?.PM2_5Density !== undefined
    || values?.PM10Density !== undefined
    || values?.OzoneDensity !== undefined
    || values?.NitrogenDioxideDensity !== undefined
    || values?.SulphurDioxideDensity !== undefined
    || values?.VOCDensity !== undefined
}

/** Each concentration the modal lists, in order: the value key and its label. */
const READINGS: Array<[string, string]> = [
  ['PM2_5Density', 'accessories.control.pm25'],
  ['PM10Density', 'accessories.control.pm10'],
  ['OzoneDensity', 'accessories.control.ozone'],
  ['NitrogenDioxideDensity', 'accessories.control.nitrogen_dioxide'],
  ['SulphurDioxideDensity', 'accessories.control.sulphur_dioxide'],
  ['VOCDensity', 'accessories.control.voc'],
]

/** The readings the sensor reports; one it does not is null (unknown), not zero. */
export function airQualityReadings(service: ServiceTypeX): { airQuality: number, readings: Array<{ key: string, label: string, value: number }> } {
  return {
    airQuality: service.values?.AirQuality ?? 0,
    readings: READINGS
      .map(([key, label]) => ({ key, label, value: service.values?.[key] ?? null }))
      .filter(reading => reading.value !== null),
  }
}
