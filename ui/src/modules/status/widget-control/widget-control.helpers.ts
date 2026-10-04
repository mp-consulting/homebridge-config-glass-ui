import type { Widget } from '../widgets/widget.types'

import { i18n } from '@/core/ui/i18n'
import { environment } from '@/environments/environment'

/** A city as the OpenWeatherMap `find` endpoint describes it, trimmed to what the widget stores. */
export interface WeatherLocation {
  id: number | string
  name: string
  country: string
  coord?: { lat: number, lon: number }
  [key: string]: unknown
}

export const timeFormats = [
  'h:mm a',
  'h:mm:ss a',
  'H:mm',
  'H:mm:ss',
]

export const dateFormats = [
  'yyyy-MM-dd',
  'dd/MM/yy',
  'dd/MM/yyyy',
  'M/d/yy',
  'M/dd/yyyy',
  'dd.MM.yyyy',
  'MMM d',
  'MMM d, y',
  'MMMM d, y',
  'd MMMM y',
  'EEEE, MMMM d, y',
  'EEEE, d MMMM y',
  'EEE, MMM d',
  'EEEE',
  'EEEE, MMM d',
]

/** Whether the working copy differs from the widget in any setting this modal edits. */
export function hasChanges(w: Partial<Widget>, o: Partial<Widget>): boolean {
  return w.showNpmVersion !== o.showNpmVersion
    || w.dockerExpanded !== o.dockerExpanded
    || w.location?.id !== o.location?.id
    || w.timeFormat !== o.timeFormat
    || w.dateFormat !== o.dateFormat
    || w.refreshInterval !== o.refreshInterval
    || w.historyItems !== o.historyItems
    || w.networkInterface !== o.networkInterface
    || w.networkUnit !== o.networkUnit
    || w.historyAccessory !== o.historyAccessory
    || w.historyType !== o.historyType
    || w.historyHours !== o.historyHours
    || w.showToolbar !== o.showToolbar
}

export const searchCountryCodeFormatter = (result: { name?: unknown, country?: unknown }) => `${result.name}, ${result.country}`

/**
 * Look a city up on OpenWeatherMap.
 * @param query - what the user typed
 * @param signal - aborts a search the user has typed past
 */
export async function findOpenWeatherMapCity(query: string, signal?: AbortSignal): Promise<WeatherLocation[]> {
  const params = new URLSearchParams({
    q: query,
    type: 'like',
    sort: 'population',
    cnt: '30',
    appid: environment.owm.appid,
    lang: i18n.language || 'en',
  })
  const response = await fetch(`https://api.openweathermap.org/data/2.5/find?${params}`, { signal })
  if (!response.ok) {
    throw new Error(`OpenWeatherMap responded ${response.status}`)
  }
  const body = await response.json() as { list: Array<{ id: number, name: string, sys: { country: string }, coord: { lat: number, lon: number } }> }
  return body.list.map(item => ({
    id: item.id,
    name: item.name,
    country: item.sys.country,
    coord: item.coord,
  }))
}
