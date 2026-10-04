import type { CharacteristicType, ServiceType } from '@homebridge/hap-client'

import { appendFile, mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

import { BadRequestException, Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { ConfigService } from '../../core/config/config.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { AccessoriesService } from './accessories.service.js'

/** The characteristics whose values are recorded, by type. */
export const RECORDED_TYPES = new Set([
  'CurrentTemperature',
  'CurrentRelativeHumidity',
  'CurrentAmbientLightLevel',
  'BatteryLevel',
  'CarbonDioxideLevel',
  'PM2_5Density',
  'PM10Density',
  'VOCDensity',
])
// Power and energy have no standard HAP characteristic: plugins use Eve's
// custom ones (Watt, kWh, Volt, Ampere), recognised by their description
const POWER_DESCRIPTION = /watt|power|energy|consumption|kwh|volt|ampere/i
const NUMERIC_FORMATS = new Set(['int', 'float', 'uint8', 'uint16', 'uint32', 'uint64'])

/** One series gets at most one point this often; a faster change is recorded when the interval is up. */
export const MIN_SAMPLE_INTERVAL_MS = 60_000
export const DEFAULT_RETENTION_DAYS = 7
export const MAX_RETENTION_DAYS = 365
/** A day file stops growing past this size (a runaway plugin cannot fill the disk). */
export const MAX_DAY_FILE_BYTES = 32 * 1024 * 1024
const MAX_QUERY_HOURS = 24 * MAX_RETENTION_DAYS
const DEFAULT_MAX_POINTS = 500
const START_DELAY_MS = 15_000
const RE_UNIQUE_ID = /^[\w:.-]{1,128}$/
const RE_TYPE = /^[\w.-]{1,64}$/
const RE_DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

interface Sample {
  /** epoch ms */
  t: number
  /** accessory uniqueId */
  id: string
  /** characteristic type */
  c: string
  v: number
}

export interface HistorySeries {
  type: string
  description?: string
  unit?: string
  /** [epoch ms, value] pairs, oldest first, downsampled to at most `maxPoints`. */
  points: Array<[number, number]>
}

export interface AccessoryHistory {
  uniqueId: string
  from: number
  to: number
  series: HistorySeries[]
}

/** Whether a characteristic's value is one the recorder keeps. */
export function isRecordedCharacteristic(characteristic: Pick<CharacteristicType, 'type' | 'description' | 'format'>): boolean {
  if (!NUMERIC_FORMATS.has(characteristic.format)) {
    return false
  }
  return RECORDED_TYPES.has(characteristic.type) || POWER_DESCRIPTION.test(characteristic.description ?? '')
}

function dayOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * Average a series into at most `maxPoints` buckets of equal time, so a week
 * of minute samples draws as a few hundred points.
 */
export function downsample(points: Array<[number, number]>, maxPoints: number): Array<[number, number]> {
  if (points.length <= maxPoints) {
    return points
  }
  const from = points[0][0]
  const span = points.at(-1)![0] - from + 1
  const buckets = new Map<number, { t: number, sum: number, n: number }>()
  for (const [t, v] of points) {
    const index = Math.min(maxPoints - 1, Math.floor(((t - from) / span) * maxPoints))
    const bucket = buckets.get(index) ?? { t: 0, sum: 0, n: 0 }
    bucket.t += t
    bucket.sum += v
    bucket.n++
    buckets.set(index, bucket)
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, { t, sum, n }]) => [Math.round(t / n), Math.round((sum / n) * 1000) / 1000])
}

/**
 * Records the numeric sensor characteristics (temperature, humidity, light
 * level, battery, air quality, power and energy) of every HAP accessory as
 * they change, into one JSON-lines file per day under
 * `<storage>/accessory-history/`. Days older than the retention setting
 * (`accessoryHistory.retentionDays`, 7 by default) are deleted. Recording
 * needs Homebridge in insecure mode, like the Accessories page, and is on
 * unless `accessoryHistory.enabled` is false.
 */
@Injectable()
export class AccessoryHistoryService implements OnModuleInit, OnModuleDestroy {
  public readonly dir: string
  private last = new Map<string, { t: number, v: number }>()
  private pending = new Map<string, Sample>()
  private meta = new Map<string, { description?: string, unit?: string }>()
  private writeChain: Promise<unknown> = Promise.resolve()
  private timers: Array<ReturnType<typeof setTimeout>> = []
  private monitor: { on: (event: string, cb: (...args: any[]) => void) => void, off?: (event: string, cb: (...args: any[]) => void) => void } | null = null
  private fullDays = new Set<string>()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(AccessoriesService) private readonly accessoriesService: AccessoriesService,
  ) {
    this.dir = resolve(this.configService.storagePath, 'accessory-history')
  }

  public get enabled(): boolean {
    return this.configService.ui?.accessoryHistory?.enabled !== false
  }

  public get retentionDays(): number {
    const days = Number(this.configService.ui?.accessoryHistory?.retentionDays)
    return Number.isInteger(days) && days >= 1 ? Math.min(days, MAX_RETENTION_DAYS) : DEFAULT_RETENTION_DAYS
  }

  onModuleInit() {
    const start = setTimeout(() => void this.start(), START_DELAY_MS)
    const flush = setInterval(() => this.flushPending(), MIN_SAMPLE_INTERVAL_MS)
    const prune = setInterval(() => void this.prune(), 6 * 60 * 60_000)
    for (const timer of [start, flush, prune]) {
      timer.unref?.()
    }
    this.timers = [start, flush, prune]
  }

  onModuleDestroy() {
    for (const timer of this.timers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    this.monitor?.off?.('service-update', this.onServiceUpdate)
  }

  /** Attach to the shared HAP characteristic monitor and record the current values. */
  public async start(): Promise<void> {
    if (!this.enabled || !this.configService.homebridgeInsecureMode || this.monitor) {
      return
    }
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      await this.prune()
      this.record(await this.accessoriesService.loadAccessories())
      const monitor = await this.accessoriesService.getHapMonitor()
      monitor.on('service-update', this.onServiceUpdate)
      this.monitor = monitor as unknown as typeof this.monitor
    } catch (e) {
      this.logger.debug(`Accessory history recorder not started as ${e.message}.`)
    }
  }

  private onServiceUpdate = (services: ServiceType[]) => {
    if (this.enabled) {
      this.record(services)
    }
  }

  /** Record the recorded characteristics of the given services (a monitor update or a full load). */
  public record(services: ServiceType[], now = Date.now()): void {
    for (const service of Array.isArray(services) ? services : []) {
      if (!service?.uniqueId || !Array.isArray(service.serviceCharacteristics)) {
        continue
      }
      for (const characteristic of service.serviceCharacteristics) {
        if (!isRecordedCharacteristic(characteristic)) {
          continue
        }
        const value = Number(characteristic.value)
        if (characteristic.value === null || characteristic.value === '' || !Number.isFinite(value)) {
          continue
        }
        this.meta.set(`${service.uniqueId}|${characteristic.type}`, { description: characteristic.description, unit: characteristic.unit })
        this.sample({ t: now, id: service.uniqueId, c: characteristic.type, v: value })
      }
    }
  }

  private sample(sample: Sample): void {
    const key = `${sample.id}|${sample.c}`
    const last = this.last.get(key)
    if (last && last.v === sample.v) {
      this.pending.delete(key)
      return
    }
    if (last && sample.t - last.t < MIN_SAMPLE_INTERVAL_MS) {
      // Too soon: kept, and written once the interval is up (unless it changes back)
      this.pending.set(key, sample)
      return
    }
    this.pending.delete(key)
    this.append(sample)
  }

  /** Write the samples held back by the interval whose interval is now up. */
  public flushPending(now = Date.now()): void {
    for (const [key, sample] of this.pending) {
      const last = this.last.get(key)
      if (!last || now - last.t >= MIN_SAMPLE_INTERVAL_MS) {
        this.pending.delete(key)
        this.append({ ...sample, t: Math.max(sample.t, last ? last.t + MIN_SAMPLE_INTERVAL_MS : sample.t) })
      }
    }
  }

  private append(sample: Sample): void {
    this.last.set(`${sample.id}|${sample.c}`, { t: sample.t, v: sample.v })
    const day = dayOf(sample.t)
    const file = resolve(this.dir, `${day}.jsonl`)
    this.writeChain = this.writeChain.then(async () => {
      if (this.fullDays.has(day)) {
        return
      }
      try {
        const size = await stat(file).then(s => s.size, () => 0)
        if (size >= MAX_DAY_FILE_BYTES) {
          this.fullDays.add(day)
          this.logger.warn(`Accessory history for ${day} reached ${MAX_DAY_FILE_BYTES / 1024 / 1024} MB; no more samples are kept for that day.`)
          return
        }
        await mkdir(this.dir, { recursive: true, mode: 0o700 })
        await appendFile(file, `${JSON.stringify(sample)}\n`, { encoding: 'utf8', mode: 0o600 })
      } catch (e) {
        this.logger.debug(`Failed to record accessory history as ${e.message}.`)
      }
    })
  }

  /** Wait for the queued writes (specs, and before a query). */
  public async drain(): Promise<void> {
    await this.writeChain
  }

  /** Delete the day files older than the retention. */
  public async prune(now = Date.now()): Promise<void> {
    const oldestKept = dayOf(now - (this.retentionDays - 1) * 86_400_000)
    let files: string[] = []
    try {
      files = await readdir(this.dir)
    } catch {
      return
    }
    for (const name of files) {
      const match = name.match(RE_DAY_FILE)
      if (match && match[1] < oldestKept) {
        await unlink(resolve(this.dir, name)).catch(() => undefined)
        this.fullDays.delete(match[1])
      }
    }
  }

  /**
   * The recorded series of one accessory.
   * @param uniqueId - the accessory's uniqueId
   * @param options - the query
   * @param options.hours - how far back (1 h to the retention), 24 by default
   * @param options.type - only this characteristic type
   * @param options.maxPoints - downsample each series to at most this many points
   */
  public async query(uniqueId: string, options: { hours?: unknown, type?: unknown, maxPoints?: unknown } = {}): Promise<AccessoryHistory> {
    if (typeof uniqueId !== 'string' || !RE_UNIQUE_ID.test(uniqueId)) {
      throw new BadRequestException('Invalid uniqueId.')
    }
    const type = options.type === undefined || options.type === '' ? undefined : String(options.type)
    if (type !== undefined && !RE_TYPE.test(type)) {
      throw new BadRequestException('Invalid characteristic type.')
    }
    const hours = options.hours === undefined || options.hours === '' ? 24 : Number(options.hours)
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_QUERY_HOURS) {
      throw new BadRequestException(`hours must be between 1 and ${MAX_QUERY_HOURS}.`)
    }
    const maxPoints = options.maxPoints === undefined || options.maxPoints === '' ? DEFAULT_MAX_POINTS : Number(options.maxPoints)
    if (!Number.isInteger(maxPoints) || maxPoints < 2 || maxPoints > 5000) {
      throw new BadRequestException('maxPoints must be between 2 and 5000.')
    }

    await this.drain()
    const to = Date.now()
    const from = to - hours * 3_600_000
    const series = new Map<string, Array<[number, number]>>()
    for (let day = Date.parse(`${dayOf(from)}T00:00:00Z`); day <= to; day += 86_400_000) {
      let text: string
      try {
        text = await readFile(resolve(this.dir, `${dayOf(day)}.jsonl`), 'utf8')
      } catch {
        continue
      }
      for (const line of text.split('\n')) {
        // Cheap pre-filter before parsing every line of every accessory
        if (!line || !line.includes(uniqueId)) {
          continue
        }
        try {
          const sample = JSON.parse(line) as Sample
          if (sample.id === uniqueId && sample.t >= from && sample.t <= to && (!type || sample.c === type) && Number.isFinite(sample.v)) {
            const points = series.get(sample.c) ?? []
            points.push([sample.t, sample.v])
            series.set(sample.c, points)
          }
        } catch {
          // A torn last line (a crash mid-append) is skipped
        }
      }
    }

    return {
      uniqueId,
      from,
      to,
      series: [...series.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([c, points]) => ({
          type: c,
          ...this.meta.get(`${uniqueId}|${c}`),
          points: downsample(points.sort((a, b) => a[0] - b[0]), maxPoints),
        })),
    }
  }
}
