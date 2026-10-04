import type { ServiceType } from '@homebridge/hap-client'

import type { CharacteristicTrigger, SceneCondition, SceneTrigger, SceneValue } from './scene-automation.js'
import type { Coordinates } from './solar.js'

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { ConfigService } from '../../core/config/config.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { SchedulerService } from '../../core/scheduler/scheduler.service.js'
import { AccessoriesService } from '../accessories/accessories.service.js'
import {
  compareValue,
  inTimeWindow,
  migrateTriggers,
  parseConditions,
  parseTriggers,
  SceneValidationError,
  triggerFires,
} from './scene-automation.js'
import { isValidCoordinates, nextSunEvent } from './solar.js'

export type { SceneCondition, SceneTrigger, SceneValue } from './scene-automation.js'

export interface SceneAction {
  uniqueId: string
  characteristicType: string
  value: SceneValue
}

/** v1: a cron schedule. Still accepted and returned (the cron triggers). */
export interface SceneSchedule {
  cron: string
  enabled: boolean
}

export type SceneRunTrigger = 'manual' | 'schedule' | 'sun' | 'characteristic'

export interface Scene {
  id: string
  name: string
  actions: SceneAction[]
  /** What runs the scene: cron, sunrise/sunset with an offset, a characteristic change. */
  triggers: SceneTrigger[]
  /** What must hold for an automatic run to go ahead (a manual run ignores them). */
  conditions: SceneCondition[]
  /** v1 view of the cron triggers, for older clients (not stored). */
  schedules: SceneSchedule[]
  lastRun?: { at: string, ok: boolean, trigger: SceneRunTrigger }
  /** The last automatic run its conditions held back. */
  lastSkipped?: { at: string, trigger: SceneRunTrigger, reason: string }
}

/** A scene as `scenes.json` (version 2) keeps it. */
type StoredScene = Omit<Scene, 'schedules'>

export interface SceneActionResult extends SceneAction {
  ok: boolean
  error?: string
}

export interface SceneRunResult {
  sceneId: string
  ok: boolean
  results: SceneActionResult[]
  /** Why an automatic run did not go ahead (a condition). */
  skipped?: string
}

interface ScenesFile {
  version?: number
  scenes: StoredScene[]
}

/** Where the sun triggers are computed for, and what the editor needs to know. */
export interface SceneAutomationInfo {
  location: { lat: number, lon: number, name?: string } | null
  nextSunrise: string | null
  nextSunset: string | null
  /** Characteristic triggers and conditions read the accessories: Homebridge must be in insecure mode. */
  characteristicTriggers: boolean
}

const MAX_SCENES = 100
const MAX_ACTIONS = 50
const MAX_SCHEDULES = 10
const JOB_PREFIX = 'scene-'
/** Recomputes the sun triggers every night (the location may have changed). */
const SUN_REFRESH_JOB = 'scenes-sun-refresh'
/** A characteristic trigger does not run its scene again within this time. */
export const CHARACTERISTIC_TRIGGER_COOLDOWN_MS = 5_000
const LOCATION_CACHE_MS = 10 * 60_000
const RE_UNIQUE_ID = /^[\w:.-]{1,128}$/
const RE_CHARACTERISTIC = /^\w{1,64}$/
const RE_SCENE_ID = /^[a-f0-9]{16}$/

/**
 * Scenes: named lists of accessory characteristic values, set together on
 * demand or by triggers: cron schedules (node-schedule, as the scheduled
 * restarts and backups use), sunrise / sunset with an offset (computed for
 * the weather widget's location), or a characteristic change (the shared HAP
 * monitor, which needs insecure mode). Conditions (a time window, a
 * characteristic value) must hold for an automatic run to go ahead.
 *
 * Stored in `scenes.json` in the storage directory, as version 2 (`triggers`,
 * `conditions`); a version 1 scene's `schedules` are read as cron triggers,
 * and every scene is still returned with `schedules` (its cron triggers) for
 * older clients. Every value is set through AccessoriesService, so a bridge
 * in the accessory control blacklist cannot be controlled by a scene either.
 */
@Injectable()
export class ScenesService implements OnModuleInit, OnModuleDestroy {
  public readonly scenesPath: string
  private running = new Set<string>()
  private monitor: { on: (event: string, cb: (...args: any[]) => void) => void, off?: (event: string, cb: (...args: any[]) => void) => void } | null = null
  private monitorStarting: Promise<void> | null = null
  /** The last known value of each watched characteristic, by `uniqueId|type`. */
  private lastValues = new Map<string, unknown>()
  /** The characteristic triggers to evaluate, as scheduled last. */
  private watched: Array<{ scene: StoredScene, trigger: CharacteristicTrigger, key: string }> = []
  private lastFired = new Map<string, number>()
  private locationCache: { at: number, value: (Coordinates & { name?: string }) | null } | null = null
  /** The timers that schedule a sun trigger's next day, cleared with the jobs. */
  private sunTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JsonFileStoreService) private readonly store: JsonFileStoreService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(AccessoriesService) private readonly accessories: AccessoriesService,
  ) {
    this.scenesPath = resolve(this.configService.storagePath, 'scenes.json')
  }

  async onModuleInit() {
    try {
      await this.scheduleAll(await this.listStored())
    } catch (e) {
      this.logger.warn(`Failed to schedule scenes as ${e.message}.`)
    }
    this.scheduler.cancelJob(SUN_REFRESH_JOB)
    const rule = new this.scheduler.RecurrenceRule()
    rule.hour = 0
    rule.minute = 5
    rule.second = 0
    this.scheduler.scheduleJob(SUN_REFRESH_JOB, rule, () => {
      this.locationCache = null
      void this.listStored().then(scenes => this.scheduleAll(scenes)).catch(e => this.logger.warn(`Failed to reschedule scenes as ${e.message}.`))
    })
  }

  onModuleDestroy() {
    this.cancelAll()
    this.scheduler.cancelJob(SUN_REFRESH_JOB)
    this.detachMonitor()
  }

  /** A stored scene of any version, as version 2. */
  private migrate(raw: Record<string, unknown>): StoredScene {
    const rest = { ...raw } as unknown as StoredScene & { schedules?: unknown }
    delete rest.schedules
    return {
      ...rest,
      actions: Array.isArray(rest.actions) ? rest.actions : [],
      triggers: migrateTriggers(raw),
      conditions: Array.isArray(raw.conditions) ? raw.conditions as SceneCondition[] : [],
    }
  }

  /** A scene as the API returns it: with the v1 `schedules` view. */
  private present(scene: StoredScene): Scene {
    return {
      ...scene,
      schedules: scene.triggers.filter((t): t is Extract<SceneTrigger, { type: 'cron' }> => t.type === 'cron').map(({ cron, enabled }) => ({ cron, enabled })),
    }
  }

  private async listStored(): Promise<StoredScene[]> {
    try {
      const file = await this.store.read<ScenesFile>(this.scenesPath)
      return Array.isArray(file?.scenes) ? file.scenes.filter(scene => scene && typeof scene === 'object').map(scene => this.migrate(scene as unknown as Record<string, unknown>)) : []
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read scenes as ${e.message}.`)
      }
      return []
    }
  }

  public async list(): Promise<Scene[]> {
    return (await this.listStored()).map(scene => this.present(scene))
  }

  public async get(id: string): Promise<Scene> {
    const scene = (await this.listStored()).find(item => item.id === id)
    if (!scene) {
      throw new NotFoundException('Scene not found.')
    }
    return this.present(scene)
  }

  public async create(body: unknown): Promise<Scene> {
    const scene: StoredScene = { id: randomBytes(8).toString('hex'), ...this.validate(body) }
    await this.mutate((scenes) => {
      if (scenes.length >= MAX_SCENES) {
        throw new BadRequestException(`At most ${MAX_SCENES} scenes.`)
      }
      return [...scenes, scene]
    })
    return this.present(scene)
  }

  public async update(id: string, body: unknown): Promise<Scene> {
    let updated: StoredScene | undefined
    await this.mutate(scenes => scenes.map((scene) => {
      if (scene.id !== id) {
        return scene
      }
      updated = { ...scene, ...this.validate(body, scene) }
      return updated
    }))
    if (!updated) {
      throw new NotFoundException('Scene not found.')
    }
    return this.present(updated)
  }

  public async remove(id: string): Promise<{ ok: true }> {
    let found = false
    await this.mutate(scenes => scenes.filter((scene) => {
      found ||= scene.id === id
      return scene.id !== id
    }))
    if (!found) {
      throw new NotFoundException('Scene not found.')
    }
    return { ok: true }
  }

  private async mutate(change: (scenes: StoredScene[]) => StoredScene[]): Promise<StoredScene[]> {
    let next: StoredScene[] = []
    await this.store.mutate<ScenesFile>(this.scenesPath, (current) => {
      const scenes = (Array.isArray(current?.scenes) ? current.scenes : []).map(scene => this.migrate(scene as unknown as Record<string, unknown>))
      next = change(scenes)
      return { version: 2, scenes: next }
    }, { spaces: 2 })
    await this.scheduleAll(next)
    return next
  }

  /**
   * The fields of a scene from a request body, or a 400. `triggers` replace
   * every trigger; a body with only v1 `schedules` replaces the cron
   * triggers and keeps the others; with neither, an edited scene keeps its own.
   */
  private validate(body: unknown, existing?: StoredScene): Pick<StoredScene, 'name' | 'actions' | 'triggers' | 'conditions'> {
    const fail = (message: string): never => {
      throw new BadRequestException(message)
    }
    if (!body || typeof body !== 'object') {
      fail('Expected a scene.')
    }
    const input = body as Record<string, unknown>
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 64) {
      fail('The name must be 1 to 64 characters.')
    }
    if (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > MAX_ACTIONS) {
      fail(`A scene needs 1 to ${MAX_ACTIONS} actions.`)
    }
    const actions = (input.actions as unknown[]).map((raw, index): SceneAction => {
      const action = (raw ?? {}) as Record<string, unknown>
      if (typeof action.uniqueId !== 'string' || !RE_UNIQUE_ID.test(action.uniqueId)) {
        fail(`Action ${index + 1}: invalid accessory.`)
      }
      if (typeof action.characteristicType !== 'string' || !RE_CHARACTERISTIC.test(action.characteristicType)) {
        fail(`Action ${index + 1}: invalid characteristic.`)
      }
      const value = action.value
      const valid = typeof value === 'boolean'
        || (typeof value === 'number' && Number.isFinite(value))
        || (typeof value === 'string' && value.length <= 256)
      if (!valid) {
        fail(`Action ${index + 1}: the value must be a boolean, a number or a short text.`)
      }
      return { uniqueId: action.uniqueId as string, characteristicType: action.characteristicType as string, value: value as SceneValue }
    })

    try {
      let triggers: SceneTrigger[]
      if (input.triggers !== undefined) {
        triggers = parseTriggers(input.triggers, cron => this.isValidCron(cron))
      } else if (input.schedules !== undefined) {
        if (!Array.isArray(input.schedules) || input.schedules.length > MAX_SCHEDULES) {
          fail(`At most ${MAX_SCHEDULES} schedules.`)
        }
        const crons = parseTriggers((input.schedules as unknown[]).map(item => ({ ...(item as object), type: 'cron' })), cron => this.isValidCron(cron))
        triggers = [...crons, ...(existing?.triggers.filter(t => t.type !== 'cron') ?? [])]
      } else {
        triggers = existing?.triggers ?? []
      }
      const conditions = input.conditions !== undefined ? parseConditions(input.conditions) : existing?.conditions ?? []
      return { name, actions, triggers, conditions }
    } catch (e) {
      if (e instanceof SceneValidationError) {
        // v1 wording for a bad schedule
        throw new BadRequestException(input.triggers === undefined ? e.message.replace(/^Trigger/, 'Schedule') : e.message)
      }
      throw e
    }
  }

  /** node-schedule returns null for a cron it cannot parse: try one and cancel it. */
  private isValidCron(cron: string): boolean {
    // Six fields at most (seconds optional), as node-schedule reads them
    if (cron.split(/\s+/).length > 6) {
      return false
    }
    const name = `${JOB_PREFIX}validate-${randomBytes(4).toString('hex')}`
    const job = this.scheduler.scheduleJob(name, cron, () => undefined)
    if (job) {
      this.scheduler.cancelJob(name)
      return true
    }
    if (this.scheduler.scheduledJobs[name]) {
      this.scheduler.cancelJob(name)
    }
    return false
  }

  private cancelAll(): void {
    for (const timer of this.sunTimers) {
      clearTimeout(timer)
    }
    this.sunTimers.clear()
    for (const name of Object.keys(this.scheduler.scheduledJobs)) {
      if (name.startsWith(JOB_PREFIX)) {
        this.scheduler.cancelJob(name)
      }
    }
  }

  // Location (sunrise / sunset)

  /**
   * The location sun triggers are computed for: the first weather widget's
   * city on the dashboard (its coordinates), or null.
   */
  public async getLocation(): Promise<(Coordinates & { name?: string }) | null> {
    if (this.locationCache && Date.now() - this.locationCache.at < LOCATION_CACHE_MS) {
      return this.locationCache.value
    }
    let value: (Coordinates & { name?: string }) | null = null
    try {
      value = findCoordinates(await this.store.read<unknown>(resolve(this.configService.storagePath, '.uix-dashboard.json')))
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        this.logger.debug(`Failed to read the dashboard for the scene location as ${e.message}.`)
      }
    }
    this.locationCache = { at: Date.now(), value }
    return value
  }

  /** What the scene editor shows: the location and the next sunrise and sunset. */
  public async getAutomationInfo(now = new Date()): Promise<SceneAutomationInfo> {
    this.locationCache = null
    const location = await this.getLocation()
    return {
      location,
      nextSunrise: location ? nextSunEvent('sunrise', 0, location, now)?.toISOString() ?? null : null,
      nextSunset: location ? nextSunEvent('sunset', 0, location, now)?.toISOString() ?? null : null,
      characteristicTriggers: !!this.configService.homebridgeInsecureMode,
    }
  }

  // Scheduling

  /** Replace every scene job with the triggers of the given scenes. */
  private async scheduleAll(scenes: StoredScene[]): Promise<void> {
    this.cancelAll()
    const location = scenes.some(scene => scene.triggers.some(t => t.type === 'sun' && t.enabled)) ? await this.getLocation() : null
    const watched: typeof this.watched = []
    for (const scene of scenes) {
      if (!RE_SCENE_ID.test(scene.id)) {
        continue
      }
      scene.triggers.forEach((trigger, index) => {
        if (!trigger.enabled) {
          return
        }
        const name = `${JOB_PREFIX}${scene.id}-${index}`
        if (trigger.type === 'cron') {
          const job = this.scheduler.scheduleJob(name, trigger.cron, () => {
            this.logger.log(`Running scheduled scene "${scene.name}".`)
            this.runAutomatically(scene.id, 'schedule')
          })
          if (!job) {
            this.logger.warn(`Could not schedule scene "${scene.name}" with cron "${trigger.cron}".`)
          }
        } else if (trigger.type === 'sun') {
          this.scheduleSun(scene, index, trigger, location)
        } else {
          watched.push({ scene, trigger, key: `${trigger.uniqueId}|${trigger.characteristicType}` })
        }
      })
    }
    this.watched = watched
    if (watched.length) {
      await this.attachMonitor()
    } else {
      this.detachMonitor()
    }
  }

  /** Schedule the next occurrence of a sun trigger; it schedules the one after when it runs. */
  private scheduleSun(scene: StoredScene, index: number, trigger: Extract<SceneTrigger, { type: 'sun' }>, location: Coordinates | null): void {
    const name = `${JOB_PREFIX}${scene.id}-${index}`
    if (!location) {
      this.logger.warn(`Scene "${scene.name}" runs at ${trigger.event}, but no location is known: add a weather widget to the dashboard.`)
      return
    }
    const at = nextSunEvent(trigger.event, trigger.offsetMinutes, location)
    if (!at) {
      this.logger.debug(`Scene "${scene.name}": no ${trigger.event} in the next days at this location.`)
      return
    }
    this.scheduler.cancelJob(name)
    this.scheduler.scheduleJob(name, at, () => {
      this.logger.log(`Running scene "${scene.name}" at ${trigger.event}.`)
      this.runAutomatically(scene.id, 'sun')
      // The next day's (a minute on, so the same event is not found again)
      const timer = setTimeout(() => {
        this.sunTimers.delete(timer)
        this.scheduleSun(scene, index, trigger, location)
      }, 60_000)
      timer.unref?.()
      this.sunTimers.add(timer)
    })
  }

  private runAutomatically(id: string, trigger: SceneRunTrigger): void {
    this.run(id, trigger).catch(e => this.logger.warn(`Scene ${id} (${trigger}) failed as ${e.message}.`))
  }

  // Characteristic triggers

  private async attachMonitor(): Promise<void> {
    if (this.monitor || this.monitorStarting || !this.configService.homebridgeInsecureMode) {
      return this.monitorStarting ?? undefined
    }
    this.monitorStarting = (async () => {
      try {
        // Seed the current values, so the first change has something to compare with
        this.onServiceUpdate(await this.accessories.loadAccessories(), false)
        const monitor = await this.accessories.getHapMonitor()
        monitor.on('service-update', this.onMonitorUpdate)
        this.monitor = monitor as unknown as typeof this.monitor
      } catch (e) {
        this.logger.warn(`Scene characteristic triggers are not watched as ${e.message}.`)
      } finally {
        this.monitorStarting = null
      }
    })()
    return this.monitorStarting
  }

  private detachMonitor(): void {
    this.monitor?.off?.('service-update', this.onMonitorUpdate)
    this.monitor = null
  }

  private onMonitorUpdate = (services: ServiceType[]) => {
    this.onServiceUpdate(services, true)
  }

  /**
   * New characteristic values (a monitor update, or the seed): run the
   * scenes whose triggers fire, each at most once per
   * CHARACTERISTIC_TRIGGER_COOLDOWN_MS.
   */
  public onServiceUpdate(services: ServiceType[], fire = true, now = Date.now()): void {
    if (!this.watched.length) {
      return
    }
    const keys = new Set(this.watched.map(w => w.key))
    for (const service of Array.isArray(services) ? services : []) {
      if (!service?.uniqueId || !Array.isArray(service.serviceCharacteristics)) {
        continue
      }
      for (const characteristic of service.serviceCharacteristics) {
        const key = `${service.uniqueId}|${characteristic.type}`
        if (!keys.has(key)) {
          continue
        }
        const previous = this.lastValues.get(key)
        const next = characteristic.value
        this.lastValues.set(key, next)
        if (!fire) {
          continue
        }
        for (const { scene, trigger, key: watchedKey } of this.watched) {
          if (watchedKey !== key || !triggerFires(trigger, previous, next)) {
            continue
          }
          const cooldownKey = `${scene.id}|${key}`
          if (now - (this.lastFired.get(cooldownKey) ?? -Infinity) < CHARACTERISTIC_TRIGGER_COOLDOWN_MS) {
            continue
          }
          this.lastFired.set(cooldownKey, now)
          this.logger.log(`Running scene "${scene.name}": ${characteristic.type} of ${service.serviceName ?? service.uniqueId} changed to ${String(next)}.`)
          this.runAutomatically(scene.id, 'characteristic')
        }
      }
    }
  }

  // Conditions

  /** Why the conditions do not hold now, or null when they all do. */
  public async checkConditions(conditions: SceneCondition[], now = new Date()): Promise<string | null> {
    let services: ServiceType[] | null = null
    for (const condition of conditions) {
      if (condition.type === 'time') {
        const inside = inTimeWindow(condition, now, await this.getLocation())
        if (inside === null) {
          return `the time window uses ${condition.after === 'sunrise' || condition.after === 'sunset' ? condition.after : condition.before}, but no location is known`
        }
        if (!inside) {
          return `outside ${condition.after}–${condition.before}`
        }
      } else {
        services ??= await this.accessories.loadAccessories()
        const value = services.find(s => s.uniqueId === condition.uniqueId)?.serviceCharacteristics?.find(c => c.type === condition.characteristicType)?.value
        if (value === undefined) {
          return `${condition.characteristicType} of the accessory could not be read`
        }
        if (!compareValue(value, condition.operator, condition.value)) {
          return `${condition.characteristicType} is ${String(value)}, not ${condition.operator} ${String(condition.value)}`
        }
      }
    }
    return null
  }

  /**
   * Set every value of a scene, in order. An action that fails (an accessory
   * gone, a value out of range, a blacklisted bridge) is reported and the
   * rest still run. An automatic run first checks the scene's conditions.
   */
  public async run(id: string, trigger: SceneRunTrigger = 'manual'): Promise<SceneRunResult> {
    const scene = await this.get(id)
    if (this.running.has(id)) {
      throw new BadRequestException('This scene is already running.')
    }
    this.running.add(id)
    try {
      if (trigger !== 'manual' && scene.conditions.length) {
        let reason: string | null
        try {
          reason = await this.checkConditions(scene.conditions)
        } catch (e) {
          reason = `the conditions could not be checked (${e?.message ?? e})`
        }
        if (reason) {
          this.logger.log(`Scene "${scene.name}" not run (${trigger}): ${reason}.`)
          await this.recordOnScene(id, { lastSkipped: { at: new Date().toISOString(), trigger, reason } })
          return { sceneId: id, ok: true, results: [], skipped: reason }
        }
      }
      const blacklist = (this.configService.ui.accessoryControl?.instanceBlacklist ?? []).map(username => username.toUpperCase())
      let services: ServiceType[] | null = null
      const results: SceneActionResult[] = []
      for (const action of scene.actions) {
        try {
          if (blacklist.length) {
            services ??= await this.accessories.loadAccessories()
            const service = services.find(item => item.uniqueId === action.uniqueId)
            if (service && blacklist.includes(String(service.instance?.username).toUpperCase())) {
              throw new Error('accessory control is disabled for this bridge')
            }
          }
          await this.accessories.setAccessoryCharacteristic(action.uniqueId, action.characteristicType, action.value)
          results.push({ ...action, ok: true })
        } catch (e) {
          results.push({ ...action, ok: false, error: e?.response?.message ?? e?.message ?? String(e) })
        }
      }
      const ok = results.every(result => result.ok)
      await this.recordOnScene(id, { lastRun: { at: new Date().toISOString(), ok, trigger } })
      return { sceneId: id, ok, results }
    } finally {
      this.running.delete(id)
    }
  }

  private async recordOnScene(id: string, patch: Partial<StoredScene>): Promise<void> {
    await this.store.mutate<ScenesFile>(this.scenesPath, current => ({
      version: 2,
      scenes: (current?.scenes ?? []).map(item => this.migrate(item as unknown as Record<string, unknown>)).map(item => (item.id === id ? { ...item, ...patch } : item)),
    }), { spaces: 2 }).catch(e => this.logger.debug(`Failed to save the scene's last run as ${e.message}.`))
  }
}

/** The first `location.coord` (a weather widget's city) anywhere in the dashboard layout. */
export function findCoordinates(value: unknown, depth = 0): (Coordinates & { name?: string }) | null {
  if (!value || typeof value !== 'object' || depth > 6) {
    return null
  }
  const location = (value as { location?: { coord?: unknown, name?: unknown } }).location
  if (location && isValidCoordinates(location.coord)) {
    return { ...(location.coord as Coordinates), ...(typeof location.name === 'string' ? { name: location.name } : {}) }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findCoordinates(child, depth + 1)
    if (found) {
      return found
    }
  }
  return null
}
