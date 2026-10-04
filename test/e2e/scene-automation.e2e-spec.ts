import { describe, expect, it } from 'vitest'

import { compareValue, inTimeWindow, migrateTriggers, triggerFires } from '../../src/modules/scenes/scene-automation.js'
import { nextSunEvent, sunTimes } from '../../src/modules/scenes/solar.js'

/** How far a computed time is from a published one, in minutes (Infinity for none). */
function minutesOff(actual: Date | null, iso: string): number {
  return actual ? Math.abs(actual.getTime() - Date.parse(iso)) / 60_000 : Infinity
}

describe('Scene automation', () => {
  describe('sunrise and sunset', () => {
    it('match published times (London, Sydney, San Francisco)', () => {
      const london = sunTimes(new Date('2024-06-20T12:00:00Z'), { lat: 51.5074, lon: -0.1278 })
      expect(minutesOff(london.sunrise, '2024-06-20T03:43:00Z')).toBeLessThan(3)
      expect(minutesOff(london.sunset, '2024-06-20T20:21:00Z')).toBeLessThan(3)

      const sydney = sunTimes(new Date('2024-12-21T00:00:00Z'), { lat: -33.8688, lon: 151.2093 })
      expect(minutesOff(sydney.sunrise, '2024-12-20T18:41:00Z')).toBeLessThan(3)

      const sanFrancisco = sunTimes(new Date('2024-03-20T12:00:00Z'), { lat: 37.7749, lon: -122.4194 })
      expect(minutesOff(sanFrancisco.sunrise, '2024-03-20T14:12:00Z')).toBeLessThan(3)
      expect(minutesOff(sanFrancisco.sunset, '2024-03-21T02:22:00Z')).toBeLessThan(3)
    })

    it('has none in the polar summer', () => {
      expect(sunTimes(new Date('2024-06-21T12:00:00Z'), { lat: 78.22, lon: 15.65 })).toEqual({ sunrise: null, sunset: null })
      expect(nextSunEvent('sunset', 0, { lat: 78.22, lon: 15.65 }, new Date('2024-06-21T12:00:00Z'))).toBeNull()
    })

    it('finds the next event with its offset, after now', () => {
      const now = new Date('2024-06-20T21:00:00Z')
      // London's sunset was 20:21: the next is tomorrow's, 30 minutes early
      expect(minutesOff(nextSunEvent('sunset', -30, { lat: 51.5074, lon: -0.1278 }, now), '2024-06-21T19:51:00Z')).toBeLessThan(3)
    })
  })

  describe('triggers and conditions', () => {
    const motion = { type: 'characteristic', uniqueId: 'x', characteristicType: 'MotionDetected', enabled: true } as const

    it('fire on an edge, not while the value keeps matching', () => {
      const trigger = { ...motion, operator: 'eq' as const, value: true }
      expect(triggerFires(trigger, false, true)).toBe(true)
      expect(triggerFires(trigger, 0, 1)).toBe(true)
      expect(triggerFires(trigger, true, true)).toBe(false)
      expect(triggerFires(trigger, true, false)).toBe(false)
      expect(triggerFires({ ...motion, operator: 'gt', value: 25 }, 24, 26)).toBe(true)
      expect(triggerFires({ ...motion, operator: 'gt', value: 25 }, 26, 27)).toBe(false)
    })

    it('fire on any change for `changes`, but not on the first value seen', () => {
      const trigger = { ...motion, operator: 'changes' as const }
      expect(triggerFires(trigger, undefined, 1)).toBe(false)
      expect(triggerFires(trigger, 1, 2)).toBe(true)
      expect(triggerFires(trigger, 2, 2)).toBe(false)
    })

    it('compare numbers, booleans and text', () => {
      expect(compareValue(1, 'eq', true)).toBe(true)
      expect(compareValue('21.5', 'gte', 21)).toBe(true)
      expect(compareValue('Home', 'eq', 'Home')).toBe(true)
      expect(compareValue('Home', 'gt', 'Away')).toBe(false)
    })

    it('read a time window, across midnight', () => {
      const at = (h: number) => new Date(2026, 0, 1, h)
      expect(inTimeWindow({ type: 'time', after: '08:00', before: '18:00' }, at(12), null)).toBe(true)
      expect(inTimeWindow({ type: 'time', after: '08:00', before: '18:00' }, at(18), null)).toBe(false)
      expect(inTimeWindow({ type: 'time', after: '22:00', before: '06:00' }, at(2), null)).toBe(true)
      expect(inTimeWindow({ type: 'time', after: 'sunset', before: '23:00' }, at(2), null)).toBeNull()
    })

    it('migrate v1 schedules to cron triggers', () => {
      expect(migrateTriggers({ schedules: [{ cron: '0 7 * * *' }, { cron: '0 8 * * *', enabled: false }] })).toEqual([
        { type: 'cron', cron: '0 7 * * *', enabled: true },
        { type: 'cron', cron: '0 8 * * *', enabled: false },
      ])
      expect(migrateTriggers({ triggers: [{ type: 'sun', event: 'sunset', offsetMinutes: 0, enabled: true }, { type: 'bogus' }] })).toHaveLength(1)
      expect(migrateTriggers({})).toEqual([])
    })
  })
})
