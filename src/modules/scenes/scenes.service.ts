import type { ServiceType } from '@homebridge/hap-client'

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { ConfigService } from '../../core/config/config.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { SchedulerService } from '../../core/scheduler/scheduler.service.js'
import { AccessoriesService } from '../accessories/accessories.service.js'

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

export interface SceneActionResult extends SceneAction {
  ok: boolean
  error?: string
}

export interface SceneRunResult {
  sceneId: string
  ok: boolean
  results: SceneActionResult[]
}

interface ScenesFile {
  scenes: Scene[]
}

const MAX_SCENES = 100
const MAX_ACTIONS = 50
const MAX_SCHEDULES = 10
const JOB_PREFIX = 'scene-'
const RE_UNIQUE_ID = /^[\w:.-]{1,128}$/
const RE_CHARACTERISTIC = /^\w{1,64}$/
const RE_SCENE_ID = /^[a-f0-9]{16}$/

/**
 * Scenes: named lists of accessory characteristic values, set together on
 * demand or on cron schedules (node-schedule, as the scheduled restarts and
 * backups use). Stored in `scenes.json` in the storage directory. Every
 * value is set through AccessoriesService, so a bridge in the accessory
 * control blacklist cannot be controlled by a scene either.
 */
@Injectable()
export class ScenesService implements OnModuleInit, OnModuleDestroy {
  public readonly scenesPath: string
  private running = new Set<string>()

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
      this.scheduleAll(await this.list())
    } catch (e) {
      this.logger.warn(`Failed to schedule scenes as ${e.message}.`)
    }
  }

  onModuleDestroy() {
    this.cancelAll()
  }

  public async list(): Promise<Scene[]> {
    try {
      const file = await this.store.read<ScenesFile>(this.scenesPath)
      return Array.isArray(file?.scenes) ? file.scenes : []
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read scenes as ${e.message}.`)
      }
      return []
    }
  }

  public async get(id: string): Promise<Scene> {
    const scene = (await this.list()).find(item => item.id === id)
    if (!scene) {
      throw new NotFoundException('Scene not found.')
    }
    return scene
  }

  public async create(body: unknown): Promise<Scene> {
    const scene: Scene = { id: randomBytes(8).toString('hex'), ...this.validate(body) }
    await this.mutate((scenes) => {
      if (scenes.length >= MAX_SCENES) {
        throw new BadRequestException(`At most ${MAX_SCENES} scenes.`)
      }
      return [...scenes, scene]
    })
    return scene
  }

  public async update(id: string, body: unknown): Promise<Scene> {
    const fields = this.validate(body)
    let updated: Scene | undefined
    await this.mutate(scenes => scenes.map((scene) => {
      if (scene.id !== id) {
        return scene
      }
      updated = { ...scene, ...fields }
      return updated
    }))
    if (!updated) {
      throw new NotFoundException('Scene not found.')
    }
    return updated
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

  private async mutate(change: (scenes: Scene[]) => Scene[]): Promise<Scene[]> {
    let next: Scene[] = []
    await this.store.mutate<ScenesFile>(this.scenesPath, (current) => {
      next = change(Array.isArray(current?.scenes) ? current.scenes : [])
      return { scenes: next }
    }, { spaces: 2 })
    this.scheduleAll(next)
    return next
  }

  /** The fields of a scene from a request body, or a 400. */
  private validate(body: unknown): Omit<Scene, 'id'> {
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
    const rawSchedules = input.schedules ?? []
    if (!Array.isArray(rawSchedules) || rawSchedules.length > MAX_SCHEDULES) {
      fail(`At most ${MAX_SCHEDULES} schedules.`)
    }
    const schedules = (rawSchedules as unknown[]).map((raw, index): SceneSchedule => {
      const schedule = (raw ?? {}) as Record<string, unknown>
      const cron = typeof schedule.cron === 'string' ? schedule.cron.trim() : ''
      if (!cron || cron.length > 100 || !this.isValidCron(cron)) {
        fail(`Schedule ${index + 1}: invalid cron expression.`)
      }
      return { cron, enabled: schedule.enabled !== false }
    })
    return { name, actions, schedules }
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
    for (const name of Object.keys(this.scheduler.scheduledJobs)) {
      if (name.startsWith(JOB_PREFIX)) {
        this.scheduler.cancelJob(name)
      }
    }
  }

  /** Replace every scene job with the schedules of the given scenes. */
  private scheduleAll(scenes: Scene[]): void {
    this.cancelAll()
    for (const scene of scenes) {
      scene.schedules.forEach((schedule, index) => {
        if (!schedule.enabled || !RE_SCENE_ID.test(scene.id)) {
          return
        }
        const name = `${JOB_PREFIX}${scene.id}-${index}`
        const job = this.scheduler.scheduleJob(name, schedule.cron, () => {
          this.logger.log(`Running scheduled scene "${scene.name}".`)
          this.run(scene.id, 'schedule').catch(e => this.logger.warn(`Scheduled scene "${scene.name}" failed as ${e.message}.`))
        })
        if (!job) {
          this.logger.warn(`Could not schedule scene "${scene.name}" with cron "${schedule.cron}".`)
        }
      })
    }
  }

  /**
   * Set every value of a scene, in order. An action that fails (an accessory
   * gone, a value out of range, a blacklisted bridge) is reported and the
   * rest still run.
   */
  public async run(id: string, trigger: 'manual' | 'schedule' = 'manual'): Promise<SceneRunResult> {
    const scene = await this.get(id)
    if (this.running.has(id)) {
      throw new BadRequestException('This scene is already running.')
    }
    this.running.add(id)
    try {
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
      await this.store.mutate<ScenesFile>(this.scenesPath, current => ({
        scenes: (current?.scenes ?? []).map(item => (item.id === id ? { ...item, lastRun: { at: new Date().toISOString(), ok, trigger } } : item)),
      }), { spaces: 2 }).catch(e => this.logger.debug(`Failed to save the scene's last run as ${e.message}.`))
      return { sceneId: id, ok, results }
    } finally {
      this.running.delete(id)
    }
  }
}
