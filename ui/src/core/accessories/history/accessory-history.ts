import { api } from '@/core/api'

export interface HistorySeries {
  type: string
  description?: string
  unit?: string
  /** [epoch ms, value], oldest first. */
  points: Array<[number, number]>
}

/** `GET /accessories/:uniqueId/history` */
export interface AccessoryHistory {
  uniqueId: string
  from: number
  to: number
  series: HistorySeries[]
}

/** The characteristic types the server records (power and energy are matched by description). */
export const RECORDED_TYPES = [
  'CurrentTemperature',
  'CurrentRelativeHumidity',
  'CurrentAmbientLightLevel',
  'BatteryLevel',
  'CarbonDioxideLevel',
  'PM2_5Density',
  'PM10Density',
  'VOCDensity',
]
const POWER_DESCRIPTION = /watt|power|energy|consumption|kwh|volt|ampere/i
const NUMERIC_FORMATS = ['int', 'float', 'uint8', 'uint16', 'uint32', 'uint64']

/** Mirrors the server's isRecordedCharacteristic. */
export function isRecordedCharacteristic(characteristic: { type: string, description?: string, format?: string }): boolean {
  return NUMERIC_FORMATS.includes(characteristic.format ?? '')
    && (RECORDED_TYPES.includes(characteristic.type) || POWER_DESCRIPTION.test(characteristic.description ?? ''))
}

export function fetchAccessoryHistory(uniqueId: string, options: { hours?: number, type?: string, maxPoints?: number } = {}): Promise<AccessoryHistory> {
  const params = new URLSearchParams()
  params.set('hours', String(options.hours ?? 24))
  if (options.type) {
    params.set('type', options.type)
  }
  if (options.maxPoints) {
    params.set('maxPoints', String(options.maxPoints))
  }
  return api.get<AccessoryHistory>(`/accessories/${encodeURIComponent(uniqueId)}/history?${params}`)
}

/** Latest, lowest and highest value of a series. */
export function summarise(points: Array<[number, number]>): { latest: number, min: number, max: number } | null {
  if (!points.length) {
    return null
  }
  const values = points.map(([, value]) => value)
  return { latest: values.at(-1)!, min: Math.min(...values), max: Math.max(...values) }
}
