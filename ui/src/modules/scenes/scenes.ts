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

export interface Scene {
  id: string
  name: string
  actions: SceneAction[]
  schedules: SceneSchedule[]
  lastRun?: { at: string, ok: boolean, trigger: 'manual' | 'schedule' }
}

export type SceneInput = Omit<Scene, 'id' | 'lastRun'>

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
}

const NUMERIC = ['int', 'float', 'uint8', 'uint16', 'uint32', 'uint64']

/** Every accessory with at least one writable characteristic, by name. */
export async function loadControllableAccessories(): Promise<ControllableAccessory[]> {
  const services = await api.get<Array<{ uniqueId?: string, serviceName: string, customName?: string, serviceCharacteristics?: Array<ControllableCharacteristic & { canWrite?: boolean }> }>>('/accessories')
  return (Array.isArray(services) ? services : [])
    .filter(service => service.uniqueId && service.serviceCharacteristics?.some(c => c.canWrite))
    .map(service => ({
      uniqueId: service.uniqueId!,
      name: service.customName || service.serviceName,
      characteristics: service.serviceCharacteristics!
        .filter(c => c.canWrite && (c.format === 'bool' || NUMERIC.includes(c.format) || c.format === 'string'))
        .map(({ type, description, format, minValue, maxValue, minStep, validValues }) => ({ type, description, format, minValue, maxValue, minStep, validValues })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
