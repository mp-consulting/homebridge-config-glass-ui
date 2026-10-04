import type { BridgeStatus, ChildBridgeMetadata } from './child-bridges.interfaces.js'

import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { platform } from 'node:os'

import { Inject, Injectable } from '@nestjs/common'

import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'

/** A bridge that crashes this many times inside the window is in a crash loop. */
export const CRASH_LOOP_CRASHES = 3
export const CRASH_LOOP_WINDOW_MS = 10 * 60_000
// Restarts Homebridge (or the user) caused are expected for this long after
const EXPECTED_RESTART_GRACE_MS = 2 * 60_000

export interface ChildBridgeHealth {
  username: string
  name: string
  plugin: string
  identifier: string
  status: BridgeStatus
  manuallyStopped: boolean
  pid?: number
  /** When the bridge last came up (ISO), while it is up. */
  upSince: string | null
  /** Seconds since it last came up, while it is up. */
  uptime: number | null
  /** Times the bridge came back up since the UI started watching. */
  restartCount: number
  /** Times it went down without being asked to, since the UI started watching. */
  crashCount: number
  /** Crashes in the crash-loop window. */
  recentCrashes: number
  crashLoop: boolean
  lastCrashAt: string | null
  /** Resident memory of the bridge process in bytes (Linux only; absent elsewhere). */
  memoryRss?: number
}

export interface ChildBridgeHealthReport {
  crashLoop: { crashes: number, windowMinutes: number }
  bridges: ChildBridgeHealth[]
}

interface Tracked {
  status: BridgeStatus
  pid?: number
  upSince: number | null
  everUp: boolean
  restartCount: number
  crashes: number[]
  crashCount: number
  inCrashLoop: boolean
  expectRestartUntil: number
  lastMeta?: Partial<ChildBridgeMetadata>
}

/**
 * Follows the `childBridgeStatusUpdate` events Homebridge sends over IPC and
 * keeps per-bridge health: uptime, restart and crash counts, and whether a
 * bridge is crash looping (CRASH_LOOP_CRASHES crashes within
 * CRASH_LOOP_WINDOW_MS). A crash is a bridge leaving `ok` for `down` that
 * nobody asked for: stops and restarts from the UI, and Homebridge itself
 * going down, are expected and not counted.
 *
 * Emits `crashLoop` (ChildBridgeHealth) once when a bridge enters a crash loop.
 */
@Injectable()
export class ChildBridgeHealthService extends EventEmitter {
  private tracked = new Map<string, Tracked>()

  constructor(
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
  ) {
    super()
    // Room for these two permanent listeners on top of the per-socket ones
    if (typeof this.homebridgeIpcService.getMaxListeners === 'function') {
      this.homebridgeIpcService.setMaxListeners(this.homebridgeIpcService.getMaxListeners() + 2)
    }
    this.homebridgeIpcService.on('childBridgeStatusUpdate', data => this.onStatusUpdate(data))
    this.homebridgeIpcService.on('serverStatusUpdate', (data) => {
      if (data?.status === 'down') {
        this.expectRestartOfAll()
      }
    })
  }

  /** The user asked to stop, start or restart this bridge: its next down is not a crash. */
  public expectRestart(username: string): void {
    const entry = this.entry(username)
    entry.expectRestartUntil = Date.now() + EXPECTED_RESTART_GRACE_MS
  }

  /** Homebridge itself is going down, taking every child bridge with it. */
  public expectRestartOfAll(): void {
    for (const username of this.tracked.keys()) {
      this.expectRestart(username)
    }
  }

  /** One status update from Homebridge (a single bridge, or a list of them). */
  public onStatusUpdate(data: unknown): void {
    const updates = Array.isArray(data) ? data : [data]
    for (const update of updates) {
      if (update && typeof update === 'object' && typeof (update as ChildBridgeMetadata).username === 'string') {
        this.apply(update as ChildBridgeMetadata)
      }
    }
  }

  private entry(username: string): Tracked {
    let entry = this.tracked.get(username)
    if (!entry) {
      entry = { status: 'pending', upSince: null, everUp: false, restartCount: 0, crashes: [], crashCount: 0, inCrashLoop: false, expectRestartUntil: 0 }
      this.tracked.set(username, entry)
    }
    return entry
  }

  private apply(meta: ChildBridgeMetadata, now = Date.now()): void {
    const entry = this.entry(meta.username)
    const previous = entry.status
    entry.lastMeta = { ...entry.lastMeta, name: meta.name, plugin: meta.plugin, identifier: meta.identifier, manuallyStopped: meta.manuallyStopped }

    if (meta.status === 'ok') {
      const pidChanged = !!meta.pid && !!entry.pid && meta.pid !== entry.pid
      if (previous !== 'ok' || pidChanged) {
        // Back up after being down (or as a new process): a restart, unless
        // this is the first time the bridge comes up since the UI started
        if (entry.everUp) {
          entry.restartCount++
        }
        entry.upSince = now
      }
      entry.everUp = true
      entry.upSince ??= now
    } else {
      if (previous === 'ok' && meta.status === 'down' && !meta.manuallyStopped && now > entry.expectRestartUntil) {
        entry.crashCount++
        entry.crashes.push(now)
      }
      entry.upSince = null
    }
    entry.status = meta.status
    entry.pid = meta.pid

    const recent = this.recentCrashes(entry, now)
    if (recent >= CRASH_LOOP_CRASHES) {
      if (!entry.inCrashLoop) {
        entry.inCrashLoop = true
        this.emit('crashLoop', this.describe(meta.username, entry, meta, now))
      }
    } else {
      entry.inCrashLoop = false
    }
  }

  private recentCrashes(entry: Tracked, now: number): number {
    entry.crashes = entry.crashes.filter(at => now - at <= CRASH_LOOP_WINDOW_MS)
    return entry.crashes.length
  }

  private describe(username: string, entry: Tracked, meta: Partial<ChildBridgeMetadata>, now: number): ChildBridgeHealth {
    const recentCrashes = this.recentCrashes(entry, now)
    const upSince = meta.status === 'ok' || (meta.status === undefined && entry.status === 'ok') ? entry.upSince : null
    return {
      username,
      name: meta.name ?? entry.lastMeta?.name ?? username,
      plugin: meta.plugin ?? entry.lastMeta?.plugin ?? '',
      identifier: meta.identifier ?? entry.lastMeta?.identifier ?? '',
      status: meta.status ?? entry.status,
      manuallyStopped: meta.manuallyStopped ?? entry.lastMeta?.manuallyStopped ?? false,
      pid: meta.pid ?? entry.pid,
      upSince: upSince ? new Date(upSince).toISOString() : null,
      uptime: upSince ? Math.max(0, Math.round((now - upSince) / 1000)) : null,
      restartCount: entry.restartCount,
      crashCount: entry.crashCount,
      recentCrashes,
      crashLoop: recentCrashes >= CRASH_LOOP_CRASHES,
      lastCrashAt: entry.crashes.length ? new Date(entry.crashes.at(-1)!).toISOString() : null,
    }
  }

  /**
   * The health of every bridge Homebridge reports now (the given metadata),
   * plus any it reported earlier and no longer does.
   * @param bridges - the current child bridge metadata
   */
  public async getHealth(bridges: ChildBridgeMetadata[]): Promise<ChildBridgeHealthReport> {
    const now = Date.now()
    const seen = new Set<string>()
    const result: ChildBridgeHealth[] = []
    for (const bridge of Array.isArray(bridges) ? bridges : []) {
      if (!bridge?.username) {
        continue
      }
      seen.add(bridge.username)
      // Metadata answers count as a status update (a bridge that has not changed since the UI started)
      if (!this.tracked.has(bridge.username) || this.tracked.get(bridge.username)!.status !== bridge.status) {
        this.apply(bridge, now)
      }
      result.push(this.describe(bridge.username, this.tracked.get(bridge.username)!, bridge, now))
    }
    for (const [username, entry] of this.tracked) {
      if (!seen.has(username)) {
        result.push(this.describe(username, entry, {}, now))
      }
    }
    await Promise.all(result.map(async (health) => {
      const rss = health.status === 'ok' ? await readProcessRss(health.pid) : undefined
      if (rss !== undefined) {
        health.memoryRss = rss
      }
    }))
    return {
      crashLoop: { crashes: CRASH_LOOP_CRASHES, windowMinutes: CRASH_LOOP_WINDOW_MS / 60_000 },
      bridges: result.sort((a, b) => a.name.localeCompare(b.name)),
    }
  }
}

/**
 * A process's resident memory from /proc (Linux); undefined anywhere else, or
 * when the process is gone.
 */
export async function readProcessRss(pid: number | undefined): Promise<number | undefined> {
  if (!pid || !Number.isInteger(pid) || pid <= 0 || platform() !== 'linux') {
    return undefined
  }
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8')
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB/m)
    return match ? Number(match[1]) * 1024 : undefined
  } catch {
    return undefined
  }
}
