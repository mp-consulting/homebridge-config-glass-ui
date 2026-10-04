import type { PluginRollbackSuggestedEvent } from '../../core/events/app-events.service.js'
import type { ChildBridgeHealth } from '../child-bridges/child-bridge-health.service.js'
import type { ChannelName, NotificationChannels, NotificationEvent, NotificationMessage, NotificationSettings } from './notification-channels.js'

import { resolve } from 'node:path'

import { BadRequestException, Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'

import { ConfigService } from '../../core/config/config.service.js'
import { AppEventsService } from '../../core/events/app-events.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { SchedulerService } from '../../core/scheduler/scheduler.service.js'
import { AI_SYSTEM_USER, AiService } from '../ai/ai.service.js'
import { ChildBridgeHealthService } from '../child-bridges/child-bridge-health.service.js'
import { PluginRollbackService } from '../plugins/plugin-rollback.service.js'
import { PluginsService } from '../plugins/plugins.service.js'
import {
  CHANNEL_NAMES,
  defaultNotificationSettings,
  isChannelConfigured,
  NOTIFICATION_EVENTS,
  RE_TIME_OF_DAY,
  SECRET_FIELDS,
  SECRET_PLACEHOLDER,
  sendToChannel,
} from './notification-channels.js'
import { WebPushService } from './web-push.service.js'

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
/** How long a crash loop notification waits for the Assistant's explanation before going without it. */
export const CRASH_LOOP_EXPLAIN_TIMEOUT_MS = 20_000
/** The scheduler job that sends the daily digest. */
export const DAILY_DIGEST_JOB = 'notifications-daily-digest'

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
 * crash loop (with the Assistant's reading of its log, when it is on),
 * updates available (checked every UPDATE_CHECK_MS), a failed
 * scheduled backup, and the Assistant's daily digest (at `dailyDigestTime`,
 * server local time, while the Assistant is on).
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
  /** The day (YYYY-MM-DD, local) the digest was last sent, so a reschedule never sends it twice. */
  private lastDigestDay: string | null = null

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JsonFileStoreService) private readonly store: JsonFileStoreService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(HomebridgeIpcService) private readonly ipc: HomebridgeIpcService,
    @Inject(ChildBridgeHealthService) private readonly childBridgeHealth: ChildBridgeHealthService,
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(AppEventsService) private readonly events: AppEventsService,
    @Inject(SchedulerService) private readonly scheduler: SchedulerService,
    @Inject(AiService) private readonly ai: AiService,
    @Inject(PluginRollbackService) private readonly rollback: PluginRollbackService,
    @Inject(WebPushService) private readonly webPush: WebPushService,
  ) {
    this.settingsPath = resolve(this.configService.storagePath, '.uix-notifications.json')
  }

  onModuleInit() {
    if (typeof this.ipc.getMaxListeners === 'function') {
      this.ipc.setMaxListeners(this.ipc.getMaxListeners() + 1)
    }
    this.ipc.on('serverStatusUpdate', this.onServerStatus)
    this.childBridgeHealth.on('crashLoop', this.onCrashLoop)
    this.events.on('backupFailed', this.onBackupFailed)
    this.events.on('pluginRollbackSuggested', this.onRollbackSuggested)

    const first = setTimeout(() => void this.checkForUpdates(), FIRST_UPDATE_CHECK_MS)
    const every = setInterval(() => void this.checkForUpdates(), UPDATE_CHECK_MS)
    first.unref?.()
    every.unref?.()
    this.updateTimers = [first, every]

    void this.scheduleDailyDigest()
  }

  onModuleDestroy() {
    this.ipc.off('serverStatusUpdate', this.onServerStatus)
    this.childBridgeHealth.off('crashLoop', this.onCrashLoop)
    this.events.off('backupFailed', this.onBackupFailed)
    this.events.off('pluginRollbackSuggested', this.onRollbackSuggested)
    for (const timer of this.updateTimers) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    if (this.downTimer) {
      clearTimeout(this.downTimer)
    }
    this.scheduler.cancelJob(DAILY_DIGEST_JOB)
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
      dailyDigestTime: typeof stored?.dailyDigestTime === 'string' && RE_TIME_OF_DAY.test(stored.dailyDigestTime) ? stored.dailyDigestTime : defaults.dailyDigestTime,
      explainCrashLoops: typeof stored?.explainCrashLoops === 'boolean' ? stored.explainCrashLoops : defaults.explainCrashLoops,
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
    const { channels, events, dailyDigestTime, explainCrashLoops } = await this.load()
    const redacted = structuredClone(channels)
    for (const name of CHANNEL_NAMES) {
      for (const field of SECRET_FIELDS[name] as string[]) {
        const channel = redacted[name] as unknown as Record<string, string>
        channel[field] = channel[field] ? SECRET_PLACEHOLDER : ''
      }
    }
    return { channels: redacted, events: { ...events }, dailyDigestTime, explainCrashLoops }
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
    const input = body as { channels?: Record<string, Record<string, unknown>>, events?: Record<string, unknown>, dailyDigestTime?: unknown, explainCrashLoops?: unknown }
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

    let { dailyDigestTime, explainCrashLoops } = current
    if (input.dailyDigestTime !== undefined) {
      if (typeof input.dailyDigestTime !== 'string' || !RE_TIME_OF_DAY.test(input.dailyDigestTime)) {
        throw new BadRequestException('dailyDigestTime must be a time of day as HH:mm.')
      }
      dailyDigestTime = input.dailyDigestTime
    }
    if (input.explainCrashLoops !== undefined) {
      if (typeof input.explainCrashLoops !== 'boolean') {
        throw new BadRequestException('explainCrashLoops must be a boolean.')
      }
      explainCrashLoops = input.explainCrashLoops
    }

    await this.save({ ...current, channels, events, dailyDigestTime, explainCrashLoops })
    await this.scheduleDailyDigest()
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
        await sendToChannel(channel, channels, msg, this.instanceName, { browser: (m, instance) => this.webPush.send(m, instance) })
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
    const now = Date.now()
    const key = `${msg.event}:${subject}`
    const held = this.holdBack(settings, msg.event, key, now)
    if (held) {
      if (held === 'cooldown') {
        this.logger.debug(`Notification ${key} skipped: sent less than ${EVENT_COOLDOWN_MS / 60_000} minutes ago.`)
      } else if (held === 'cap') {
        this.logger.warn(`Notification ${key} dropped: more than ${MAX_PER_HOUR} notifications in the last hour.`)
      }
      return null
    }
    this.lastSent.set(key, now)
    this.sentLog.push(now)
    return this.sendAll(msg)
  }

  /**
   * Why an event would not be sent now (switched off or no channel on, its
   * cooldown, the hourly cap), or null when it would. Records nothing.
   */
  private holdBack(settings: StoredFile, event: NotificationEvent, key: string, now: number): 'off' | 'cooldown' | 'cap' | null {
    if (!settings.events[event] || !CHANNEL_NAMES.some(name => settings.channels[name].enabled)) {
      return 'off'
    }
    if (now - (this.lastSent.get(key) ?? -Infinity) < EVENT_COOLDOWN_MS) {
      return 'cooldown'
    }
    this.sentLog = this.sentLog.filter(at => now - at < 60 * 60_000)
    return this.sentLog.length >= MAX_PER_HOUR ? 'cap' : null
  }

  /** Count a test message against MAX_TESTS_PER_MINUTE, or refuse it. */
  private takeTestSlot(now = Date.now()): void {
    this.testLog = this.testLog.filter(at => now - at < 60_000)
    if (this.testLog.length >= MAX_TESTS_PER_MINUTE) {
      throw new BadRequestException('Too many test notifications - try again in a minute.')
    }
  }

  /** "Send test": to the given channel, or every enabled one, whether or not any event is on. */
  public async sendTest(channel?: unknown): Promise<ChannelResult[]> {
    if (channel !== undefined && !CHANNEL_NAMES.includes(channel as ChannelName)) {
      throw new BadRequestException('Unknown channel.')
    }
    const now = Date.now()
    this.takeTestSlot(now)
    const { channels } = await this.load()
    const only = channel ? [channel as ChannelName] : CHANNEL_NAMES.filter(name => channels[name].enabled)
    if (!only.some(name => isChannelConfigured(name, channels))) {
      throw new BadRequestException('No channel is set up to send to.')
    }
    this.testLog.push(now)
    return this.sendAll({ event: 'test', title: 'Test notification', message: 'Notifications from Homebridge Glass UI are working.' }, only)
  }

  /**
   * A test notification to the browser with this endpoint (Settings, "Send
   * test" on this device), or to every subscribed device, whether or not
   * the browser channel is on.
   */
  public async sendBrowserTest(endpoint?: string): Promise<ChannelResult> {
    const now = Date.now()
    this.takeTestSlot(now)
    this.testLog.push(now)
    try {
      await this.webPush.send({ event: 'test', title: 'Test notification', message: 'Browser notifications from Homebridge Glass UI are working.', path: '/settings?section=notifications' }, this.instanceName, endpoint ? { endpoint } : undefined)
      return { channel: 'browser', ok: true }
    } catch (e) {
      const error = String(e?.message ?? e).slice(0, 300)
      this.logger.warn(`Failed to send the test notification to the browser as ${error}.`)
      return { channel: 'browser', ok: false, error }
    }
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
    void this.notifyCrashLoop(bridge)
  }

  /**
   * The crash loop notification. When it would be sent, `explainCrashLoops`
   * is on and so is the Assistant, it carries a few sentences from the
   * Assistant on the bridge's log lines; that wait is capped at
   * CRASH_LOOP_EXPLAIN_TIMEOUT_MS, and a failure or a timeout sends it without.
   */
  public async notifyCrashLoop(bridge: ChildBridgeHealth): Promise<ChannelResult[] | null> {
    let message = `${bridge.name} (${bridge.plugin}) crashed ${bridge.recentCrashes} times in a short time. Check the logs.`
    let assistant = ''
    try {
      const settings = await this.load()
      // Ask only for a notification that will go out
      if (settings.explainCrashLoops && !this.holdBack(settings, 'childBridgeCrashLoop', `childBridgeCrashLoop:${bridge.username}`, Date.now())) {
        const explanation = await this.explainCrashLoop(bridge)
        if (explanation) {
          assistant = `\n\nAssistant: ${explanation}`
        }
      }
    } catch (e) {
      this.logger.warn(`Failed to explain the ${bridge.name} crash loop as ${e?.message ?? e}.`)
    }
    let path: string | undefined
    try {
      // Updated recently: say which version it can go back to
      const rollback = bridge.plugin ? await this.rollback.describeSuggestion(bridge.plugin) : null
      if (rollback) {
        message += `\n\n${rollback}`
        path = '/plugins'
      }
    } catch (e) {
      this.logger.debug(`Failed to look up the rollback of ${bridge.plugin} as ${e?.message ?? e}.`)
    }
    message += assistant
    return this.notify({
      event: 'childBridgeCrashLoop',
      title: `Child bridge ${bridge.name} is crash looping`,
      message,
      urgent: true,
      path: path ?? '/child-bridges',
    }, bridge.username)
  }

  /** The Assistant's explanation, or null when it is off, has nothing to say, fails or takes too long. */
  private async explainCrashLoop(bridge: ChildBridgeHealth): Promise<string | null> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort()
        this.logger.warn(`The Assistant did not explain the ${bridge.name} crash loop within ${CRASH_LOOP_EXPLAIN_TIMEOUT_MS / 1000} seconds: notifying without it.`)
        resolve(null)
      }, CRASH_LOOP_EXPLAIN_TIMEOUT_MS)
      timer.unref?.()
    })
    const work = (async () => {
      if (!await this.ai.isReady()) {
        return null
      }
      return this.ai.explainCrashLoop({ name: bridge.name, plugin: bridge.plugin, identifier: bridge.identifier }, controller.signal)
    })().catch((e) => {
      if (!controller.signal.aborted) {
        this.logger.warn(`The Assistant could not explain the ${bridge.name} crash loop as ${e?.message ?? e}: notifying without it.`)
      }
      return null
    })
    try {
      return await Promise.race([work, timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Homebridge crash loops soon after plugins on the main bridge were updated.
   * (A child bridge's crash loop notification already says it.)
   */
  private onRollbackSuggested = (suggestion: PluginRollbackSuggestedEvent) => {
    if (suggestion?.reason !== 'homebridgeCrashLoop' || !suggestion.plugins?.length) {
      return
    }
    const lines = suggestion.plugins.map(p => `${p.name}: updated from ${p.fromVersion} to ${p.toVersion}. Roll back to ${p.fromVersion} from the Plugins page.`)
    void this.notify({
      event: 'rollbackSuggested',
      title: 'Homebridge is crash looping after a plugin update',
      message: `Homebridge went down several times in a few minutes, soon after these plugins were updated:\n${lines.join('\n')}`,
      urgent: true,
      path: '/plugins',
    }, suggestion.plugins.map(p => `${p.name}@${p.toVersion}`).join(','))
  }

  private onBackupFailed = ({ message }: { message: string }) => {
    void this.notify({ event: 'backupFailed', title: 'Scheduled backup failed', message: `The scheduled instance backup failed: ${message}`, urgent: true })
  }

  /**
   * (Re)schedule the daily digest at `dailyDigestTime`, server local time,
   * or cancel it while the event is off. Whether the Assistant is on is
   * checked when the job runs, so turning it on later needs no reschedule.
   */
  public async scheduleDailyDigest(): Promise<void> {
    this.scheduler.cancelJob(DAILY_DIGEST_JOB)
    try {
      const settings = await this.load()
      if (!settings.events.dailyDigest) {
        return
      }
      const [hour, minute] = settings.dailyDigestTime.split(':').map(Number)
      const rule = new this.scheduler.RecurrenceRule()
      rule.hour = hour
      rule.minute = minute
      rule.second = 0
      this.scheduler.scheduleJob(DAILY_DIGEST_JOB, rule, () => void this.sendDailyDigest())
      this.logger.debug(`Daily digest notification scheduled at ${settings.dailyDigestTime}.`)
    } catch (e) {
      this.logger.warn(`Failed to schedule the daily digest notification as ${e.message}.`)
    }
  }

  /**
   * Generate the Assistant's digest and send it, once a day. Skipped quietly
   * when the event or every channel is off, or the Assistant is off or not
   * set up; a digest that fails to generate is logged and not sent.
   * @returns the per-channel results, or null when nothing was sent
   */
  public async sendDailyDigest(): Promise<ChannelResult[] | null> {
    try {
      const settings = await this.load()
      if (!settings.events.dailyDigest || !CHANNEL_NAMES.some(name => settings.channels[name].enabled)) {
        return null
      }
      const now = new Date()
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      if (this.lastDigestDay === day) {
        return null
      }
      if (!await this.ai.isReady()) {
        this.logger.debug('Daily digest notification skipped: the Assistant is off or not set up.')
        return null
      }
      let text: string
      try {
        // The widget's digest of the day, when it already made one
        text = (await this.ai.digest(AI_SYSTEM_USER)).text.trim()
      } catch (e) {
        this.logger.warn(`Failed to generate the daily digest notification as ${e?.message ?? e}.`)
        return null
      }
      if (!text) {
        this.logger.warn('Daily digest notification skipped: the Assistant returned an empty digest.')
        return null
      }
      // Through the usual rate limits: a digest in an hour of outages is dropped
      const sent = await this.notify({ event: 'dailyDigest', title: 'Daily digest', message: text }, day)
      if (sent) {
        this.lastDigestDay = day
      }
      return sent
    } catch (e) {
      this.logger.warn(`Failed to send the daily digest notification as ${e?.message ?? e}.`)
      return null
    }
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
