import { api } from '@/core/api'

export type SceneValue = number | boolean | string

export interface SceneAction {
  uniqueId: string
  characteristicType: string
  value: SceneValue
}

export interface SceneSchedule {
  cron: string
  enabled: boolean
}

export type ComparisonOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'
export const COMPARISON_OPERATORS: ComparisonOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte']
/** How each operator reads in the editor. */
export const OPERATOR_SYMBOLS: Record<ComparisonOperator, string> = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' }

export type SceneTrigger
  = | { type: 'cron', cron: string, enabled: boolean }
    | { type: 'sun', event: 'sunrise' | 'sunset', offsetMinutes: number, enabled: boolean }
    | { type: 'characteristic', uniqueId: string, characteristicType: string, operator: 'changes' | ComparisonOperator, value?: SceneValue, enabled: boolean }

export type SceneCondition
  = | { type: 'time', after: string, before: string }
    | { type: 'characteristic', uniqueId: string, characteristicType: string, operator: ComparisonOperator, value: SceneValue }

export type SceneRunTrigger = 'manual' | 'schedule' | 'sun' | 'characteristic'

export interface Scene {
  id: string
  name: string
  actions: SceneAction[]
  /** Cron, sunrise/sunset, characteristic change (v2; older servers send only `schedules`). */
  triggers?: SceneTrigger[]
  conditions?: SceneCondition[]
  /** The cron triggers, as v1 had them. */
  schedules: SceneSchedule[]
  lastRun?: { at: string, ok: boolean, trigger: SceneRunTrigger }
  lastSkipped?: { at: string, trigger: SceneRunTrigger, reason: string }
}

export interface SceneInput {
  name: string
  actions: SceneAction[]
  triggers: SceneTrigger[]
  conditions: SceneCondition[]
}

/** `GET /scenes/automation` */
export interface SceneAutomationInfo {
  location: { lat: number, lon: number, name?: string } | null
  nextSunrise: string | null
  nextSunset: string | null
  characteristicTriggers: boolean
}

/** A trigger in a few words for the scene list. */
export function describeTrigger(trigger: SceneTrigger, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (trigger.type) {
    case 'cron':
      return trigger.cron
    case 'sun': {
      const event = trigger.event === 'sunrise' ? t('scenes.sunrise') : t('scenes.sunset')
      return trigger.offsetMinutes ? `${event} ${trigger.offsetMinutes > 0 ? '+' : '−'}${Math.abs(trigger.offsetMinutes)} min` : event
    }
    case 'characteristic':
      return trigger.operator === 'changes'
        ? t('scenes.summary_changes', { characteristic: trigger.characteristicType })
        : `${trigger.characteristicType} ${OPERATOR_SYMBOLS[trigger.operator]} ${String(trigger.value)}`
  }
}

/** A scene's triggers, from a v1 server's `schedules` when it has none. */
export function triggersOf(scene: Pick<Scene, 'triggers' | 'schedules'>): SceneTrigger[] {
  return scene.triggers ?? scene.schedules.map(({ cron, enabled }) => ({ type: 'cron', cron, enabled }))
}

export interface SceneRunResult {
  sceneId: string
  ok: boolean
  results: Array<SceneAction & { ok: boolean, error?: string }>
}

/** A writable characteristic of an accessory, as the scene editor offers it. */
export interface ControllableCharacteristic {
  type: string
  description: string
  format: string
  minValue?: number
  maxValue?: number
  minStep?: number
  validValues?: number[]
}

export interface ControllableAccessory {
  uniqueId: string
  name: string
  characteristics: ControllableCharacteristic[]
}

export const scenesApi = {
  list: () => api.get<Scene[]>('/scenes'),
  create: (scene: SceneInput) => api.post<Scene>('/scenes', scene),
  update: (id: string, scene: SceneInput) => api.put<Scene>(`/scenes/${id}`, scene),
  remove: (id: string) => api.delete(`/scenes/${id}`),
  run: (id: string) => api.post<SceneRunResult>(`/scenes/${id}/run`, {}),
  automation: () => api.get<SceneAutomationInfo>('/scenes/automation'),
}

const NUMERIC = ['int', 'float', 'uint8', 'uint16', 'uint32', 'uint64']

interface AccessoryService { uniqueId?: string, serviceName: string, customName?: string, serviceCharacteristics?: Array<ControllableCharacteristic & { canWrite?: boolean, canRead?: boolean }> }

function toAccessories(services: AccessoryService[], keep: (c: ControllableCharacteristic & { canWrite?: boolean, canRead?: boolean }) => boolean | undefined): ControllableAccessory[] {
  return (Array.isArray(services) ? services : [])
    .filter(service => service.uniqueId && service.serviceCharacteristics?.some(c => keep(c)))
    .map(service => ({
      uniqueId: service.uniqueId!,
      name: service.customName || service.serviceName,
      characteristics: service.serviceCharacteristics!
        .filter(c => keep(c) && (c.format === 'bool' || NUMERIC.includes(c.format) || c.format === 'string'))
        .map(({ type, description, format, minValue, maxValue, minStep, validValues }) => ({ type, description, format, minValue, maxValue, minStep, validValues })),
    }))
    .filter(accessory => accessory.characteristics.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The accessories a scene can use: those with a writable characteristic (its
 * values), and those with a readable one (its triggers and conditions).
 */
export async function loadSceneAccessories(): Promise<{ writable: ControllableAccessory[], readable: ControllableAccessory[] }> {
  const services = await api.get<AccessoryService[]>('/accessories')
  return {
    writable: toAccessories(services, c => c.canWrite),
    readable: toAccessories(services, c => c.canRead !== false),
  }
}

/** Every accessory with at least one writable characteristic, by name. */
export async function loadControllableAccessories(): Promise<ControllableAccessory[]> {
  return (await loadSceneAccessories()).writable
}

/** A typed value from the editor's text, for the characteristic's format. */
export function parseSceneValue(text: string, format: string): SceneValue {
  if (format === 'bool') {
    return text === 'true'
  }
  if (NUMERIC.includes(format)) {
    const value = Number(text)
    return Number.isFinite(value) ? value : 0
  }
  return text
}

const RE_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/** Whether a trigger is complete enough to save. */
export function isTriggerValid(trigger: SceneTrigger): boolean {
  switch (trigger.type) {
    case 'cron': return trigger.cron.trim().length > 0
    case 'sun': return Number.isInteger(trigger.offsetMinutes) && Math.abs(trigger.offsetMinutes) <= 720
    case 'characteristic': return !!trigger.uniqueId && !!trigger.characteristicType && (trigger.operator === 'changes' || trigger.value !== undefined)
  }
}

const isTime = (value: string) => value === 'sunrise' || value === 'sunset' || RE_TIME.test(value)

/** Whether a condition is complete enough to save. */
export function isConditionValid(condition: SceneCondition): boolean {
  return condition.type === 'time'
    ? isTime(condition.after) && isTime(condition.before) && condition.after !== condition.before
    : !!condition.uniqueId && !!condition.characteristicType
}
