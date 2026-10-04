/**
 * Sunrise and sunset without a dependency: the sunrise equation (as NOAA and
 * Wikipedia give it), accurate to a minute or two away from the poles.
 */

const RAD = Math.PI / 180
const DAY_MS = 86_400_000
const J1970 = 2440587.5
const J2000 = 2451545
/** The sun's centre is 0.833° below the horizon at sunrise (refraction and its radius). */
const SUN_ALTITUDE = -0.833

export type SunEvent = 'sunrise' | 'sunset'

export interface Coordinates {
  lat: number
  lon: number
}

const toJulian = (ms: number) => ms / DAY_MS + J1970
const fromJulian = (j: number) => Math.round((j - J1970) * DAY_MS)

/**
 * Sunrise and sunset of the solar day around the given instant's UTC date at
 * that longitude; null for either when the sun does not rise or set that day
 * (polar night, midnight sun).
 */
export function sunTimes(day: Date, { lat, lon }: Coordinates): { sunrise: Date | null, sunset: Date | null } {
  const utcMidnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())
  // Days from J2000 to that date's noon (UTC)
  const n = Math.round(toJulian(utcMidnight + DAY_MS / 2) - J2000)
  const meanNoon = n - lon / 360
  const anomaly = (357.5291 + 0.98560028 * meanNoon) % 360
  const m = anomaly * RAD
  const centre = 1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)
  const longitude = ((anomaly + centre + 180 + 102.9372) % 360) * RAD
  const transit = J2000 + meanNoon + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * longitude)
  const declination = Math.asin(Math.sin(longitude) * Math.sin(23.4397 * RAD))
  const cosHourAngle = (Math.sin(SUN_ALTITUDE * RAD) - Math.sin(lat * RAD) * Math.sin(declination)) / (Math.cos(lat * RAD) * Math.cos(declination))
  if (cosHourAngle < -1 || cosHourAngle > 1) {
    return { sunrise: null, sunset: null }
  }
  const hourAngle = Math.acos(cosHourAngle) / RAD
  return {
    sunrise: new Date(fromJulian(transit - hourAngle / 360)),
    sunset: new Date(fromJulian(transit + hourAngle / 360)),
  }
}

/**
 * The next time (after `now`) of a sun event plus an offset in minutes, or
 * null when it does not happen in the next few days (near the poles).
 */
export function nextSunEvent(event: SunEvent, offsetMinutes: number, where: Coordinates, now = new Date()): Date | null {
  let next: Date | null = null
  for (let days = -1; days <= 3; days++) {
    const times = sunTimes(new Date(now.getTime() + days * DAY_MS), where)
    const at = times[event]
    if (!at) {
      continue
    }
    const shifted = new Date(at.getTime() + offsetMinutes * 60_000)
    if (shifted.getTime() > now.getTime() && (!next || shifted < next)) {
      next = shifted
    }
  }
  return next
}

/** Whether coordinates are usable. */
export function isValidCoordinates(value: unknown): value is Coordinates {
  const c = value as Coordinates
  return !!c && typeof c.lat === 'number' && typeof c.lon === 'number'
    && Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180
}
