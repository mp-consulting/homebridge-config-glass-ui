/**
 * Scenes v2: what runs a scene (triggers) and what must hold for an automatic
 * run to go ahead (conditions). Types, validation of request bodies, the
 * migration of v1 scenes (`schedules`), and the comparisons.
 */

import type { Coordinates, SunEvent } from './solar.js'

import { sunTimes } from './solar.js'

export type SceneValue = number | boolean | string

export type ComparisonOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
export const COMPARISON_OPERATORS: ComparisonOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']

export interface CronTrigger {
  type: 'cron'
  cron: string
  enabled: boolean
}

export interface SunTrigger {
  type: 'sun'
  event: SunEvent
  /** Minutes after (positive) or before (negative) the event, -720 to 720. */
  offsetMinutes: number
  enabled: boolean
}

export interface CharacteristicTrigger {
  type: 'characteristic'
  uniqueId: string
  characteristicType: string
  /** `changes`: any change; otherwise when the new value starts to match `value`. */
  operator: 'changes' | ComparisonOperator
  value?: SceneValue
  enabled: boolean
}

export type SceneTrigger = CronTrigger | SunTrigger | CharacteristicTrigger

/** A time of day: HH:mm, or the day's sunrise / sunset. */
export type TimeOfDay = string

export interface TimeCondition {
  type: 'time'
  /** From (inclusive); a window that ends before it starts spans midnight. */
  after: TimeOfDay
  /** Until (exclusive). */
  before: TimeOfDay
}

export interface CharacteristicCondition {
  type: 'characteristic'
  uniqueId: string
  characteristicType: string
  operator: ComparisonOperator
  value: SceneValue
}

export type SceneCondition = TimeCondition | CharacteristicCondition

export const MAX_TRIGGERS = 10
export const MAX_CONDITIONS = 10
const RE_UNIQUE_ID = /^[\w:.-]{1,128}$/
const RE_CHARACTERISTIC = /^\w{1,64}$/
const RE_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export class SceneValidationError extends Error {}

function fail(message: string): never {
  throw new SceneValidationError(message)
}

export function isSceneValue(value: unknown): value is SceneValue {
  return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 256)
}

function accessoryRef(input: Record<string, unknown>, label: string): { uniqueId: string, characteristicType: string } {
  if (typeof input.uniqueId !== 'string' || !RE_UNIQUE_ID.test(input.uniqueId)) {
    fail(`${label}: invalid accessory.`)
  }
  if (typeof input.characteristicType !== 'string' || !RE_CHARACTERISTIC.test(input.characteristicType)) {
    fail(`${label}: invalid characteristic.`)
  }
  return { uniqueId: input.uniqueId as string, characteristicType: input.characteristicType as string }
}

/**
 * Validate the triggers of a request body.
 * @param raw - the `triggers` array
 * @param isValidCron - whether the scheduler can run a cron expression
 */
export function parseTriggers(raw: unknown, isValidCron: (cron: string) => boolean): SceneTrigger[] {
  if (!Array.isArray(raw) || raw.length > MAX_TRIGGERS) {
    fail(`At most ${MAX_TRIGGERS} triggers.`)
  }
  return (raw as unknown[]).map((item, index): SceneTrigger => {
    const input = (item ?? {}) as Record<string, unknown>
    const label = `Trigger ${index + 1}`
    const enabled = input.enabled !== false
    switch (input.type) {
      case 'cron': {
        const cron = typeof input.cron === 'string' ? input.cron.trim() : ''
        if (!cron || cron.length > 100 || !isValidCron(cron)) {
          fail(`${label}: invalid cron expression.`)
        }
        return { type: 'cron', cron, enabled }
      }
      case 'sun': {
        if (input.event !== 'sunrise' && input.event !== 'sunset') {
          fail(`${label}: the event must be sunrise or sunset.`)
        }
        const offsetMinutes = input.offsetMinutes === undefined ? 0 : input.offsetMinutes
        if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes as number) > 720) {
          fail(`${label}: the offset must be a whole number of minutes from -720 to 720.`)
        }
        return { type: 'sun', event: input.event as SunEvent, offsetMinutes: offsetMinutes as number, enabled }
      }
      case 'characteristic': {
        const ref = accessoryRef(input, label)
        const operator = input.operator ?? 'changes'
        if (operator !== 'changes' && !COMPARISON_OPERATORS.includes(operator as ComparisonOperator)) {
          fail(`${label}: invalid operator.`)
        }
        if (operator !== 'changes' && !isSceneValue(input.value)) {
          fail(`${label}: the value must be a boolean, a number or a short text.`)
        }
        return { type: 'characteristic', ...ref, operator: operator as CharacteristicTrigger['operator'], ...(operator !== 'changes' ? { value: input.value as SceneValue } : {}), enabled }
      }
      default:
        return fail(`${label}: the type must be cron, sun or characteristic.`)
    }
  })
}

function parseTimeOfDay(value: unknown, label: string): TimeOfDay {
  if (value === 'sunrise' || value === 'sunset' || (typeof value === 'string' && RE_TIME.test(value))) {
    return value
  }
  return fail(`${label}: a time must be HH:mm, sunrise or sunset.`)
}

/** Validate the conditions of a request body. */
export function parseConditions(raw: unknown): SceneCondition[] {
  if (!Array.isArray(raw) || raw.length > MAX_CONDITIONS) {
    fail(`At most ${MAX_CONDITIONS} conditions.`)
  }
  return (raw as unknown[]).map((item, index): SceneCondition => {
    const input = (item ?? {}) as Record<string, unknown>
    const label = `Condition ${index + 1}`
    if (input.type === 'time') {
      const after = parseTimeOfDay(input.after, label)
      const before = parseTimeOfDay(input.before, label)
      if (after === before) {
        fail(`${label}: the window is empty.`)
      }
      return { type: 'time', after, before }
    }
    if (input.type === 'characteristic') {
      const ref = accessoryRef(input, label)
      if (!COMPARISON_OPERATORS.includes(input.operator as ComparisonOperator)) {
        fail(`${label}: invalid operator.`)
      }
      if (!isSceneValue(input.value)) {
        fail(`${label}: the value must be a boolean, a number or a short text.`)
      }
      return { type: 'characteristic', ...ref, operator: input.operator as ComparisonOperator, value: input.value as SceneValue }
    }
    return fail(`${label}: the type must be time or characteristic.`)
  })
}

/**
 * The triggers of a stored scene, v1 or v2: a v1 scene has only `schedules`
 * (cron), which become cron triggers.
 */
export function migrateTriggers(stored: { triggers?: unknown, schedules?: unknown }): SceneTrigger[] {
  if (Array.isArray(stored.triggers)) {
    return stored.triggers.filter(t => t && typeof t === 'object' && ['cron', 'sun', 'characteristic'].includes((t as SceneTrigger).type)) as SceneTrigger[]
  }
  if (Array.isArray(stored.schedules)) {
    return stored.schedules
      .filter(s => s && typeof (s as CronTrigger).cron === 'string')
      .map(s => ({ type: 'cron', cron: (s as CronTrigger).cron, enabled: (s as CronTrigger).enabled !== false }))
  }
  return []
}

/** A characteristic value as something comparable (HAP sends booleans as 0/1 too). */
function asNumber(value: unknown): number | null {
  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

/** Compare an accessory's value with a scene's expected one. */
export function compareValue(actual: unknown, operator: ComparisonOperator, expected: SceneValue): boolean {
  const a = asNumber(actual)
  const b = asNumber(expected)
  if (a !== null && b !== null) {
    switch (operator) {
      case 'eq': return a === b
      case 'neq': return a !== b
      case 'gt': return a > b
      case 'gte': return a >= b
      case 'lt': return a < b
      case 'lte': return a <= b
    }
  }
  const sa = String(actual ?? '')
  const sb = String(expected)
  switch (operator) {
    case 'eq': return sa === sb
    case 'neq': return sa !== sb
    default: return false
  }
}

/**
 * Whether a characteristic trigger fires for a change from `previous` to
 * `next`: `changes` on any change, otherwise when the value starts matching
 * (so a value that keeps matching does not fire again).
 */
export function triggerFires(trigger: CharacteristicTrigger, previous: unknown, next: unknown): boolean {
  if (previous === next || (asNumber(previous) !== null && asNumber(previous) === asNumber(next))) {
    return false
  }
  if (trigger.operator === 'changes') {
    return previous !== undefined
  }
  return compareValue(next, trigger.operator, trigger.value!) && (previous === undefined || !compareValue(previous, trigger.operator, trigger.value!))
}

/** Minutes since local midnight of a time of day, or null for a sun event that does not happen today. */
export function minutesOfDay(time: TimeOfDay, now: Date, where: Coordinates | null): number | null {
  if (time === 'sunrise' || time === 'sunset') {
    if (!where) {
      return null
    }
    // The event on the server's local date (the UTC dates around it can hold it)
    for (const days of [0, -1, 1]) {
      const at = sunTimes(new Date(now.getTime() + days * 86_400_000), where)[time]
      if (at && at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()) {
        return at.getHours() * 60 + at.getMinutes()
      }
    }
    return null
  }
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * Whether `now` (server local time) is inside a time window; null when it
 * cannot be told (a sun event without a location).
 */
export function inTimeWindow(condition: TimeCondition, now: Date, where: Coordinates | null): boolean | null {
  const from = minutesOfDay(condition.after, now, where)
  const to = minutesOfDay(condition.before, now, where)
  if (from === null || to === null) {
    return null
  }
  const current = now.getHours() * 60 + now.getMinutes()
  return from <= to ? current >= from && current < to : current >= from || current < to
}
