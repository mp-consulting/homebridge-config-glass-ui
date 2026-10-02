import type { WidgetProps } from '@/modules/status/widgets/widget.types'

import dayjs from 'dayjs'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { convertTemp, formatDecimal } from '@/core/pipes'
import { useSettingsStore } from '@/core/settings'
import { useNamespace, useNamespaceConnected } from '@/core/ws'
import { environment } from '@/environments/environment'

import { getWeatherIconClass } from './weather-icon'

/** Weather widget data from OpenWeatherMap API */
export interface OpenWeatherMapResponse {
  name: string
  weather: Array<{
    description: string
    icon: string
  }>
  main: {
    temp: number
  }
  timestamp?: string
}

// Cache OpenWeatherMap responses for 20 minutes to prevent repeat requests (API rate limits)
const WEATHER_CACHE_MINUTES = 20

/**
 * Return the cached weather for a location if it exists and is less than 20 minutes old, else null.
 * @param locationId - the OpenWeatherMap city id
 */
function readFreshCache(locationId: string | number): OpenWeatherMapResponse | null {
  try {
    const raw = localStorage.getItem(`weather-${locationId}`)
    if (raw) {
      const cached = JSON.parse(raw) as OpenWeatherMapResponse
      if (cached.timestamp && dayjs().diff(dayjs(cached.timestamp), 'minute') < WEATHER_CACHE_MINUTES) {
        return cached
      }
    }
  } catch {}
  return null
}

/** Angular's `titlecase` pipe. */
function titleCase(value: string | undefined): string {
  return (value ?? '').replace(/\S+/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase())
}

export function WeatherWidget({ widget, configureEvent }: WidgetProps) {
  const { t, i18n } = useTranslation()
  const temperatureUnits = useSettingsStore(state => state.env.temperatureUnits)
  const io = useNamespace('status')
  const locationId = widget.location?.id
  const lang = i18n.language || 'en'

  // Last known-good weather, seeded from the cache and updated after each successful fetch.
  // Used as the displayed value while there is no request (fresh cache) or one is loading.
  const [cachedWeather, setCachedWeather] = useState<OpenWeatherMapResponse | null>(() => (locationId ? readFreshCache(locationId) : null))
  // The live fetch result
  const [weather, setWeather] = useState<OpenWeatherMapResponse | null>(null)

  // Bumped to re-check the cache (and fetch if it is stale) on reconnect / reconfigure / timer
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  // A refresh while a request is out would only abort it and ask the same again
  // (the connect replay on mount lands right after the first request)
  const inFlightRef = useRef(false)
  const refresh = useCallback(() => {
    if (!inFlightRef.current) {
      setRefreshTrigger(n => n + 1)
    }
  }, [])

  // GET from OpenWeatherMap. Re-runs when the location, language, or refreshTrigger
  // changes; asks for nothing when there is no location or the cache is still fresh.
  useEffect(() => {
    // The previous result belongs to the previous request
    // eslint-disable-next-line react/set-state-in-effect
    setWeather(null)
    if (!locationId) {
      return undefined
    }
    const fresh = readFreshCache(locationId)
    if (fresh) {
      // The cache is the source of truth while it is fresh (it may be another tab's reading)
      // eslint-disable-next-line react/set-state-in-effect
      setCachedWeather(fresh)
      return undefined
    }
    const controller = new AbortController()
    inFlightRef.current = true
    const params = new URLSearchParams({
      id: String(locationId),
      appid: environment.owm.appid,
      units: 'metric',
      lang,
    })
    fetch(`https://api.openweathermap.org/data/2.5/weather?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`OpenWeatherMap answered ${response.status}`)
        }
        return response.json() as Promise<OpenWeatherMapResponse>
      })
      .then((data) => {
        // Persist each successful fetch to the cache and the displayed value
        const stamped: OpenWeatherMapResponse = { ...data, timestamp: new Date().toISOString() }
        setWeather(data)
        setCachedWeather(stamped)
        try {
          localStorage.setItem(`weather-${locationId}`, JSON.stringify(stamped))
        } catch {}
      })
      .catch(() => {
        // Keep showing the last good reading
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          inFlightRef.current = false
        }
      })
    return () => {
      controller.abort()
      inFlightRef.current = false
    }
  }, [locationId, lang, refreshTrigger])

  // Refresh on server reconnect, on reconfigure, and periodically. Each still
  // respects the 20-minute cache before hitting the network.
  useNamespaceConnected(io, refresh)
  useEffect(() => configureEvent.subscribe(refresh), [configureEvent, refresh])
  useEffect(() => {
    const timer = setInterval(refresh, 1300000)
    return () => clearInterval(timer)
  }, [refresh])

  const currentWeather = weather ?? cachedWeather

  return (
    <div className="flex-column d-flex align-items-stretch h-100 w-100 pb-1">
      <div className={`drag-handler p-2${widget.draggable ? ' widget-cursor' : ''}`}>
        {`${currentWeather?.name ?? ''} ${t('status.widget.weather.title_weather')}`.trim()}
      </div>
      {!locationId
        ? (
            <div className="d-flex flex-row flex-grow-1 align-items-center w-100 gridster-item-content text-center">
              <div className="d-flex flex-column w-100 pb-2">
                <h1><i className="fas fa-cloud-sun"></i></h1>
                <p className="grey-text">{t('status.widget.weather.label_config_required_help')}</p>
              </div>
            </div>
          )
        : currentWeather
          ? (
              <div className="d-flex flex-row flex-grow-1 align-items-center w-100 gridster-item-content p-2">
                <div className="d-flex flex-column w-100">
                  <div className="weather-now d-flex flex-column align-items-center text-center">
                    <h1>
                      <i className={`primary-text ${getWeatherIconClass(currentWeather.weather[0]?.icon)}`}></i>
                    </h1>
                    <h3>{titleCase(currentWeather.weather[0]?.description)}</h3>
                    <h2>
                      {formatDecimal(convertTemp(currentWeather.main.temp, temperatureUnits), '1.0-0')}
                      &deg;
                      {temperatureUnits.toUpperCase()}
                    </h2>
                  </div>
                </div>
              </div>
            )
          : (
              <div className="d-flex flex-row flex-grow-1 align-items-center w-100 gridster-item-content text-center">
                <div className="d-flex flex-column w-100 pb-2">
                  <h1><i className="fas fa-circle-notch fa-spin"></i></h1>
                </div>
              </div>
            )}
    </div>
  )
}
