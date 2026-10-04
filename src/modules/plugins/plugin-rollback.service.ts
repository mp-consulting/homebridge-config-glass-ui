import type { PluginRollbackSuggestedEvent } from '../../core/events/app-events.service.js'
import type { ChildBridgeHealth } from '../child-bridges/child-bridge-health.service.js'

import { resolve } from 'node:path'

import { Inject, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { ConfigService } from '../../core/config/config.service.js'
import { AppEventsService } from '../../core/events/app-events.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { ChildBridgeHealthService } from '../child-bridges/child-bridge-health.service.js'
import { PluginMetadataService } from './plugin-metadata.service.js'

/** How long a plugin can be rolled back to the version it had before its last update. */
export const ROLLBACK_DAYS = 14
/** A crash loop this soon after an update points at the update. */
export const ROLLBACK_SUSPECT_WINDOW_MS = 48 * 60 * 60_000
/** Homebridge itself going down this many times inside the window is a crash loop. */
export const HOMEBRIDGE_CRASH_LOOP_DOWNS = 3
export const HOMEBRIDGE_CRASH_LOOP_WINDOW_MS = 10 * 60_000

/** Packages the rollback does not cover: the UI and Homebridge update through their own paths. */
const NOT_ROLLED_BACK = new Set(['homebridge', '@mp-consulting/homebridge-config-glass-ui', 'homebridge-config-ui-x'])

export type RollbackSuspectReason = 'childBridgeCrashLoop' | 'homebridgeCrashLoop'

export interface PluginRollbackEntry {
  name: string
  /** The version before the update: what a rollback installs. */
  fromVersion: string
  /** The version the update installed. */
  toVersion: string
  /** When the update finished (ISO). */
  updatedAt: string
  /** Until when the rollback is offered (ISO). */
  expiresAt: string
  /** Set when the plugin's bridge crash looped soon after the update. */
  suspect: { reason: RollbackSuspectReason, at: string, bridge?: string } | null
}

interface StoredFile {
  entries: Array<Omit<PluginRollbackEntry, 'expiresAt'>>
}

/** What `pluginRollbackSuggested` carries. */
export type RollbackSuggestion = PluginRollbackSuggestedEvent

/**
 * Single-plugin update rollback. Every plugin install that changes the
 * version of an installed plugin (a single update, a version change, Update
 * All, a job over REST) records the version it replaced, in
 * `.uix-plugin-rollback.json`, for ROLLBACK_DAYS. Installing that version
 * again (the rollback) clears the record.
 *
 * When the plugin's child bridge enters a crash loop (ChildBridgeHealthService),
 * or Homebridge itself goes down HOMEBRIDGE_CRASH_LOOP_DOWNS times within
 * HOMEBRIDGE_CRASH_LOOP_WINDOW_MS for a plugin on the main bridge, within
 * ROLLBACK_SUSPECT_WINDOW_MS of its update, the record is marked as suspect
 * (the UI then offers the rollback prominently) and `pluginRollbackSuggested`
 * is reported on the app event bus for the notifications.
 */
@Injectable()
export class PluginRollbackService implements OnModuleInit, OnModuleDestroy {
  public readonly filePath: string
  private homebridgeDowns: number[] = []
  private homebridgeWasUp = false

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JsonFileStoreService) private readonly store: JsonFileStoreService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(HomebridgeIpcService) private readonly ipc: HomebridgeIpcService,
    @Inject(ChildBridgeHealthService) private readonly childBridgeHealth: ChildBridgeHealthService,
    @Inject(PluginMetadataService) private readonly metadata: PluginMetadataService,
    @Inject(AppEventsService) private readonly events: AppEventsService,
  ) {
    this.filePath = resolve(this.configService.storagePath, '.uix-plugin-rollback.json')
  }

  onModuleInit() {
    if (typeof this.ipc.getMaxListeners === 'function') {
      this.ipc.setMaxListeners(this.ipc.getMaxListeners() + 1)
    }
    this.ipc.on('serverStatusUpdate', this.onServerStatus)
    this.childBridgeHealth.on('crashLoop', this.onChildBridgeCrashLoop)
  }

  onModuleDestroy() {
    this.ipc.off('serverStatusUpdate', this.onServerStatus)
    this.childBridgeHealth.off('crashLoop', this.onChildBridgeCrashLoop)
  }

  private async load(now = Date.now()): Promise<StoredFile> {
    try {
      const stored = await this.store.read<StoredFile>(this.filePath)
      const entries = Array.isArray(stored?.entries) ? stored.entries : []
      return { entries: entries.filter(entry => entry && typeof entry.name === 'string' && !this.expired(entry.updatedAt, now)) }
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read the plugin rollback records as ${e.message}.`)
      }
      return { entries: [] }
    }
  }

  private expired(updatedAt: string, now: number): boolean {
    const at = Date.parse(updatedAt)
    return !Number.isFinite(at) || now - at > ROLLBACK_DAYS * 86_400_000
  }

  private async mutate(fn: (file: StoredFile) => boolean | void, now = Date.now()): Promise<void> {
    await this.store.mutate<StoredFile>(this.filePath, (current) => {
      const file: StoredFile = { entries: (Array.isArray(current?.entries) ? current.entries : []).filter(entry => !this.expired(entry?.updatedAt, now)) }
      return fn(file) === false ? null : file
    }, { spaces: 2 })
  }

  private present(entry: StoredFile['entries'][number]): PluginRollbackEntry {
    return {
      ...entry,
      suspect: entry.suspect ?? null,
      expiresAt: new Date(Date.parse(entry.updatedAt) + ROLLBACK_DAYS * 86_400_000).toISOString(),
    }
  }

  /** Every plugin that can be rolled back now, the most recent update first. */
  public async list(now = Date.now()): Promise<PluginRollbackEntry[]> {
    const { entries } = await this.load(now)
    return entries.map(entry => this.present(entry)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** The rollback of one plugin, or null when there is none (or it expired). */
  public async get(name: string, now = Date.now()): Promise<PluginRollbackEntry | null> {
    const entry = (await this.load(now)).entries.find(item => item.name === name)
    return entry ? this.present(entry) : null
  }

  /** The rollback of one plugin, or 404. */
  public async require(name: string): Promise<PluginRollbackEntry> {
    const entry = await this.get(name)
    if (!entry) {
      throw new NotFoundException(`${name} has no update to roll back (only the last update of the past ${ROLLBACK_DAYS} days can be).`)
    }
    return entry
  }

  /**
   * A plugin install finished. Records the replaced version when it changed
   * an installed plugin's version, and clears the record when it installed
   * the recorded previous version again (a rollback).
   * @param name - the package
   * @param previous - the version installed before, if any
   * @param installed - the version now installed
   */
  public async recordInstall(name: string, previous: string | undefined, installed: string | undefined, now = Date.now()): Promise<void> {
    if (!previous || !installed || previous === installed || NOT_ROLLED_BACK.has(name)) {
      return
    }
    try {
      await this.mutate((file) => {
        const index = file.entries.findIndex(entry => entry.name === name)
        if (index !== -1 && file.entries[index].fromVersion === installed) {
          this.logger.log(`Rolled back ${name} from ${previous} to ${installed}.`)
          file.entries.splice(index, 1)
          return
        }
        const entry = { name, fromVersion: previous, toVersion: installed, updatedAt: new Date(now).toISOString(), suspect: null }
        if (index === -1) {
          file.entries.push(entry)
        } else {
          file.entries[index] = entry
        }
      }, now)
    } catch (e) {
      this.logger.warn(`Failed to record the previous version of ${name} as ${e.message}.`)
    }
  }

  /** A plugin was uninstalled: nothing left to roll back. */
  public async forget(name: string): Promise<void> {
    try {
      await this.mutate((file) => {
        const before = file.entries.length
        file.entries = file.entries.filter(entry => entry.name !== name)
        return file.entries.length !== before
      })
    } catch (e) {
      this.logger.warn(`Failed to forget the rollback of ${name} as ${e.message}.`)
    }
  }

  /**
   * A short line on the rollback a crash loop of this plugin's bridge points
   * to, for the notification, or null when it was not updated recently.
   */
  public async describeSuggestion(pluginName: string, now = Date.now()): Promise<string | null> {
    const entry = await this.get(pluginName, now)
    if (!entry || now - Date.parse(entry.updatedAt) > ROLLBACK_SUSPECT_WINDOW_MS) {
      return null
    }
    return `${entry.name} was updated from ${entry.fromVersion} to ${entry.toVersion} ${formatAgo(now - Date.parse(entry.updatedAt))}. Roll back to ${entry.fromVersion} from the Plugins page.`
  }

  /** Mark the given plugins' records as suspect and report it. */
  private async suspect(names: string[], reason: RollbackSuspectReason, bridge?: string, now = Date.now()): Promise<RollbackSuggestion | null> {
    const plugins: RollbackSuggestion['plugins'] = []
    await this.mutate((file) => {
      for (const entry of file.entries) {
        if (names.includes(entry.name) && !entry.suspect && now - Date.parse(entry.updatedAt) <= ROLLBACK_SUSPECT_WINDOW_MS) {
          entry.suspect = { reason, at: new Date(now).toISOString(), ...(bridge ? { bridge } : {}) }
          plugins.push({ name: entry.name, fromVersion: entry.fromVersion, toVersion: entry.toVersion, updatedAt: entry.updatedAt })
        }
      }
      return plugins.length > 0
    }, now)
    if (!plugins.length) {
      return null
    }
    const suggestion: RollbackSuggestion = { reason, ...(bridge ? { bridge } : {}), plugins }
    this.logger.warn(`${bridge ?? 'Homebridge'} is crash looping after an update of ${plugins.map(p => `${p.name} (${p.fromVersion} → ${p.toVersion})`).join(', ')}: a rollback is offered.`)
    this.events.emit('pluginRollbackSuggested', suggestion)
    return suggestion
  }

  private onChildBridgeCrashLoop = (bridge: ChildBridgeHealth) => {
    if (bridge?.plugin) {
      void this.suspect([bridge.plugin], 'childBridgeCrashLoop', bridge.name).catch(e => this.logger.warn(`Failed to check the rollback of ${bridge.plugin} as ${e.message}.`))
    }
  }

  private onServerStatus = (data: { status?: string }) => {
    if (data?.status === 'ok') {
      this.homebridgeWasUp = true
    } else if (data?.status === 'down' && this.homebridgeWasUp) {
      this.homebridgeWasUp = false
      void this.onHomebridgeDown().catch(e => this.logger.warn(`Failed to check for a Homebridge crash loop as ${e.message}.`))
    }
  }

  /**
   * Homebridge went down after being up. HOMEBRIDGE_CRASH_LOOP_DOWNS of them
   * inside the window, with plugins on the main bridge updated recently,
   * suggests rolling those back.
   */
  public async onHomebridgeDown(now = Date.now()): Promise<RollbackSuggestion | null> {
    this.homebridgeDowns = [...this.homebridgeDowns.filter(at => now - at <= HOMEBRIDGE_CRASH_LOOP_WINDOW_MS), now]
    if (this.homebridgeDowns.length < HOMEBRIDGE_CRASH_LOOP_DOWNS) {
      return null
    }
    this.homebridgeDowns = []
    const recent = (await this.load(now)).entries.filter(entry => !entry.suspect && now - Date.parse(entry.updatedAt) <= ROLLBACK_SUSPECT_WINDOW_MS)
    const onMainBridge: string[] = []
    for (const entry of recent) {
      const childBridges = await this.metadata.getPluginChildBridgeUsernames(entry.name).catch(() => [])
      if (!childBridges.length) {
        onMainBridge.push(entry.name)
      }
    }
    return onMainBridge.length ? this.suspect(onMainBridge, 'homebridgeCrashLoop', undefined, now) : null
  }
}

function formatAgo(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 90) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`
}
