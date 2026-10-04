import type { ChildBridgeHealth } from '../child-bridges/child-bridge-health.service.js'
import type { ChannelName, NotificationChannels, NotificationEvent, NotificationMessage, NotificationSettings } from './notification-channels.js'

import { resolve } from 'node:path'

import { BadRequestException, Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { ConfigService } from '../../core/config/config.service.js'
import { AppEventsService } from '../../core/events/app-events.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { ChildBridgeHealthService } from '../child-bridges/child-bridge-health.service.js'
import { PluginsService } from '../plugins/plugins.service.js'
import {
  CHANNEL_NAMES,
  defaultNotificationSettings,
  isChannelConfigured,
  NOTIFICATION_EVENTS,
  SECRET_FIELDS,
  SECRET_PLACEHOLDER,
  sendToChannel,
} from './notification-channels.js'

/** The same event (and subject) is not sent again within this time. */
export const EVENT_COOLDOWN_MS = 15 * 60_000
/** At most this many notifications in any rolling hour, whatever the events. */
export const MAX_PER_HOUR = 12
/** Test messages: at most this many a minute. */
export const MAX_TESTS_PER_MINUTE = 5
/** Homebridge must stay down this long before it is reported (restarts are quicker). */
export const DOWN_GRACE_MS = 60_000
/** How often installed packages are checked for updates. */
export const UPDATE_CHECK_MS = 6 * 60 * 60_000
const FIRST_UPDATE_CHECK_MS = 5 * 60_000

export interface ChannelResult {
  channel: ChannelName
  ok: boolean
  error?: string
}

interface StoredFile extends NotificationSettings {
  /** The updates last notified about, so the same ones are not sent again. */
  lastUpdatesSignature?: string
}

const HTTP_URL = /^https?:\/\/[^\s/?#]\S*$/i

/**
 * Notifications: the settings (stored in `.uix-notifications.json` in the
 * storage directory, owner-only, never sent back with their secrets), and the
 * dispatcher that sends an event to every enabled channel, rate limited.
 *
 * Events: Homebridge down (after DOWN_GRACE_MS) and back up, a child bridge
 * crash loop, updates available (checked every UPDATE_CHECK_MS) and a failed
 * scheduled backup.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  public readonly settingsPath: string
  private cached: StoredFile | null = null
  private lastSent = new Map<string, number>()
  private sentLog: number[] = []
  private testLog: number[] = []
  private downTimer: ReturnType<typeof setTimeout> | null = null
  private downNotified = false
  private updateTimers: Array<ReturnType<typeof setTimeout>> = []

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JsonFileStoreService) private readonly store: JsonFileStoreService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(HomebridgeIpcService) private readonly ipc: HomebridgeIpcService,
    @Inject(ChildBridgeHealthService) private readonly childBridgeHealth: ChildBridgeHealthService,
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(AppEventsService) private readonly events: AppEventsService,
  ) {
    this.settingsPath = resolve(this.configService.storagePath, '.uix-notifications.json')
  }

  onModuleInit() {
    this.ipc.setMaxListeners(this.ipc.getMaxListeners() + 1)
    this.ipc.on('serverStatusUpdate', this.onServerStatus)
    this.childBridgeHealth.on('crashLoop', this.onCrashLoop)
    this.events.on('backupFailed', this.onBackupFailed)

    const first = setTimeout(() => void this.checkForUpdates(), FIRST_UPDATE_CHECK_MS)
    const every = setInterval(() => void this.checkForUpdates(), UPDATE_CHECK_MS)
    first.unref?.()
    every.unref?.()
    this.updateTimers = [first, every]
  }

  onModuleDestroy() {
    this.ipc.off('serverStatusUpdate', this.onServerStatus)
    this.childBridgeHealth.off('crashLoop', this.onCrashLoop)
    this.events.off('backupFailed', this.onBackupFailed)
    for (const timer of this.updateTimers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    if (this.downTimer) {
      clearTimeout(this.downTimer)
    }
  }

  // Settings

  private async load(): Promise<StoredFile> {
    if (this.cached) {
      return this.cached
    }
    const defaults = defaultNotificationSettings()
    let stored: Partial<StoredFile> | null = null
    try {
      stored = await this.store.read<StoredFile>(this.settingsPath)
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read notification settings as ${e.message}.`)
      }
    }
    const channels = { ...defaults.channels } as NotificationChannels
    for (const name of CHANNEL_NAMES) {
      channels[name] = { ...defaults.channels[name], ...(stored?.channels?.[name] ?? {}) } as never
    }
    this.cached = {
      channels,
      events: { ...defaults.events, ...(stored?.events ?? {}) },
      lastUpdatesSignature: stored?.lastUpdatesSignature,
    }
    return this.cached
  }

  private async save(next: StoredFile): Promise<void> {
    await this.store.write(this.settingsPath, next, { spaces: 2 })
    this.cached = next
  }

  /** The settings as the browser may see them: each stored secret as SECRET_PLACEHOLDER. */
  public async getSettings(): Promise<NotificationSettings> {
    const { channels, events } = await this.load()
    const redacted = structuredClone(channels)
    for (const name of CHANNEL_NAMES) {
      for (const field of SECRET_FIELDS[name] as string[]) {
        const channel = redacted[name] as unknown as Record<string, string>
        channel[field] = channel[field] ? SECRET_PLACEHOLDER : ''
      }
    }
    return { channels: redacted, events: { ...events } }
  }

  /**
   * Replace the settings. A secret sent back as SECRET_PLACEHOLDER keeps the
   * stored value; an empty string clears it.
   */
  public async updateSettings(body: unknown): Promise<NotificationSettings> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Expected an object.')
    }
    const current = await this.load()
    const input = body as { channels?: Record<string, Record<string, unknown>>, events?: Record<string, unknown> }
    const channels = structuredClone(current.channels)

    for (const name of CHANNEL_NAMES) {
      const given = input.channels?.[name]
      if (given === undefined) {
        continue
      }
      if (!given || typeof given !== 'object') {
        throw new BadRequestException(`Invalid ${name} settings.`)
      }
      const target = channels[name] as unknown as Record<string, unknown>
      for (const field of Object.keys(target)) {
        if (!(field in given)) {
          continue
        }
        const value = given[field]
        if (field === 'enabled') {
          if (typeof value !== 'boolean') {
            throw new BadRequestException(`${name}.enabled must be a boolean.`)
          }
          target.enabled = value
          continue
        }
        if (typeof value !== 'string' || value.length > 2048) {
          throw new BadRequestException(`Invalid ${name}.${field}.`)
        }
        if ((SECRET_FIELDS[name] as string[]).includes(field) && value === SECRET_PLACEHOLDER) {
          continue
        }
        target[field] = value.trim()
      }
    }
    this.validateChannels(channels)

    const events = { ...current.events }
    for (const event of NOTIFICATION_EVENTS) {
      const value = input.events?.[event]
      if (value === undefined) {
        continue
      }
      if (typeof value !== 'boolean') {
        throw new BadRequestException(`events.${event} must be a boolean.`)
      }
      events[event] = value
    }

    await this.save({ ...current, channels, events })
    return this.getSettings()
  }

  private validateChannels(channels: NotificationChannels): void {
    const fail = (message: string) => {
      throw new BadRequestException(message)
    }
    const { webhook, ntfy, pushover, telegram } = channels
    if (webhook.url && !HTTP_URL.test(webhook.url)) {
      fail('The webhook URL must be an http(s) URL.')
    }
    if (ntfy.server && !HTTP_URL.test(ntfy.server)) {
      fail('The ntfy server must be an http(s) URL.')
    }
    if (ntfy.topic && !/^[\w-]{1,64}$/.test(ntfy.topic)) {
      fail('The ntfy topic may only use letters, numbers, - and _ (up to 64).')
    }
    if (ntfy.token && !/^[\w.-]{1,256}$/.test(ntfy.token)) {
      fail('Invalid ntfy access token.')
    }
    if (pushover.userKey && !/^\w{1,64}$/.test(pushover.userKey)) {
      fail('Invalid Pushover user key.')
    }
    if (pushover.appToken && !/^\w{1,64}$/.test(pushover.appToken)) {
      fail('Invalid Pushover application token.')
    }
    if (telegram.botToken && !/^\d{1,20}:[\w-]{20,100}$/.test(telegram.botToken)) {
      fail('Invalid Telegram bot token.')
    }
    if (telegram.chatId && !/^(?:-?\d{1,20}|@\w{4,64})$/.test(telegram.chatId)) {
      fail('Invalid Telegram chat id.')
    }
    for (const name of CHANNEL_NAMES) {
      if (channels[name].enabled && !isChannelConfigured(name, channels)) {
        fail(`The ${name} channel is enabled but not fully set up.`)
      }
    }
  }

  // Dispatch

  private get instanceName(): string {
    return this.configService.homebridgeConfig?.bridge?.name || 'Homebridge'
  }

  /** Error text without any of the channel's secrets (a fetch error could carry the URL). */
  private scrub(message: string, channels: NotificationChannels): string {
    let text = message
    for (const name of CHANNEL_NAMES) {
      for (const field of SECRET_FIELDS[name] as string[]) {
        const secret = (channels[name] as unknown as Record<string, string>)[field]
        if (secret) {
          text = text.split(secret).join(SECRET_PLACEHOLDER)
        }
      }
    }
    return text.slice(0, 300)
  }

  private async sendAll(msg: NotificationMessage, only?: ChannelName[]): Promise<ChannelResult[]> {
    const { channels } = await this.load()
    const targets = CHANNEL_NAMES.filter(name => (only ? only.includes(name) : channels[name].enabled) && isChannelConfigured(name, channels))
    return Promise.all(targets.map(async (channel) => {
      try {
        await sendToChannel(channel, channels, msg, this.instanceName)
        return { channel, ok: true }
      } catch (e) {
        const error = this.scrub(e?.message ?? String(e), channels)
        this.logger.warn(`Failed to send the ${msg.event} notification to ${channel} as ${error}.`)
        return { channel, ok: false, error }
      }
    }))
  }

  /**
   * Send an event to every enabled channel, if the event is switched on and
   * the rate limits allow: the same event and subject at most once per
   * EVENT_COOLDOWN_MS, and at most MAX_PER_HOUR notifications an hour.
   * @returns the per-channel results, or null when nothing was sent
   */
  public async notify(msg: NotificationMessage & { event: NotificationEvent }, subject = ''): Promise<ChannelResult[] | null> {
    const settings = await this.load()
    if (!settings.events[msg.event] || !CHANNEL_NAMES.some(name => settings.channels[name].enabled)) {
      return null
    }
    const now = Date.now()
    const key = `${msg.event}:${subject}`
    if (now - (this.lastSent.get(key) ?? -Infinity) < EVENT_COOLDOWN_MS) {
      this.logger.debug(`Notification ${key} skipped: sent less than ${EVENT_COOLDOWN_MS / 60_000} minutes ago.`)
      return null
    }
    this.sentLog = this.sentLog.filter(at => now - at < 60 * 60_000)
    if (this.sentLog.length >= MAX_PER_HOUR) {
      this.logger.warn(`Notification ${key} dropped: more than ${MAX_PER_HOUR} notifications in the last hour.`)
      return null
    }
    this.lastSent.set(key, now)
    this.sentLog.push(now)
    return this.sendAll(msg)
  }

  /** "Send test": to the given channel, or every enabled one, whether or not any event is on. */
  public async sendTest(channel?: unknown): Promise<ChannelResult[]> {
    if (channel !== undefined && !CHANNEL_NAMES.includes(channel as ChannelName)) {
      throw new BadRequestException('Unknown channel.')
    }
    const now = Date.now()
    this.testLog = this.testLog.filter(at => now - at < 60_000)
    if (this.testLog.length >= MAX_TESTS_PER_MINUTE) {
      throw new BadRequestException('Too many test notifications - try again in a minute.')
    }
    const { channels } = await this.load()
    const only = channel ? [channel as ChannelName] : CHANNEL_NAMES.filter(name => channels[name].enabled)
    if (!only.some(name => isChannelConfigured(name, channels))) {
      throw new BadRequestException('No channel is set up to send to.')
    }
    this.testLog.push(now)
    return this.sendAll({ event: 'test', title: 'Test notification', message: 'Notifications from Homebridge Glass UI are working.' }, only)
  }

  // Event sources

  private onServerStatus = (data: { status?: string }) => {
    if (data?.status === 'down') {
      if (!this.downTimer && !this.downNotified) {
        this.downTimer = setTimeout(() => {
          this.downTimer = null
          this.downNotified = true
          void this.notify({ event: 'homebridgeDown', title: 'Homebridge is down', message: `Homebridge has not been running for ${DOWN_GRACE_MS / 1000} seconds.`, urgent: true })
        }, DOWN_GRACE_MS)
        this.downTimer.unref?.()
      }
    } else if (data?.status === 'ok') {
      if (this.downTimer) {
        // Back before anyone needed to know: a restart
        clearTimeout(this.downTimer)
        this.downTimer = null
      }
      if (this.downNotified) {
        this.downNotified = false
        void this.notify({ event: 'homebridgeUp', title: 'Homebridge is back up', message: 'Homebridge is running again.' })
      }
    }
  }

  private onCrashLoop = (bridge: ChildBridgeHealth) => {
    void this.notify({
      event: 'childBridgeCrashLoop',
      title: `Child bridge ${bridge.name} is crash looping`,
      message: `${bridge.name} (${bridge.plugin}) crashed ${bridge.recentCrashes} times in a short time. Check the logs.`,
      urgent: true,
    }, bridge.username)
  }

  private onBackupFailed = ({ message }: { message: string }) => {
    void this.notify({ event: 'backupFailed', title: 'Scheduled backup failed', message: `The scheduled instance backup failed: ${message}`, urgent: true })
  }

  /** Look for updates; notify once per new set of available updates. */
  public async checkForUpdates(): Promise<void> {
    try {
      const settings = await this.load()
      if (!settings.events.updatesAvailable || !CHANNEL_NAMES.some(name => settings.channels[name].enabled)) {
        return
      }
      const [plugins, homebridge] = await Promise.all([
        this.pluginsService.getOutOfDatePlugins().catch(() => []),
        this.pluginsService.getHomebridgePackage().catch(() => null),
      ])
      const updates = [
        ...(homebridge?.updateAvailable ? [`${homebridge.displayName || homebridge.name} ${homebridge.latestVersion}`] : []),
        ...plugins.map(plugin => `${plugin.displayName || plugin.name} ${plugin.latestVersion}`),
      ].sort()
      const signature = updates.join('\n')
      if (!updates.length || signature === settings.lastUpdatesSignature) {
        return
      }
      const sent = await this.notify({
        event: 'updatesAvailable',
        title: `${updates.length} update${updates.length === 1 ? '' : 's'} available`,
        message: updates.slice(0, 20).join('\n') + (updates.length > 20 ? `\n… and ${updates.length - 20} more` : ''),
      }, signature)
      if (sent) {
        await this.save({ ...settings, lastUpdatesSignature: signature })
      }
    } catch (e) {
      this.logger.debug(`Update check for notifications failed as ${e.message}.`)
    }
  }
}
