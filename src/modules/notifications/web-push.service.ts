import type { NotificationMessage } from './notification-channels.js'
import type { PushSubscriptionLike, VapidKeys } from './web-push.js'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import process from 'node:process'

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import { ConfigService } from '../../core/config/config.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { truncateText } from './notification-channels.js'
import { generateVapidKeys, isValidVapidKeys, PushSubscriptionGoneError, sendWebPush } from './web-push.js'

/** The most devices that can subscribe. */
export const MAX_PUSH_SUBSCRIPTIONS = 20
/** The longest notification body sent (the payload has to fit one 4 KB record). */
const PUSH_BODY_MAX = 1000
/**
 * The VAPID `sub` claim push services may use to reach the sender. Set
 * UIX_WEB_PUSH_SUBJECT (`mailto:` or `https:`) to use your own.
 */
const DEFAULT_SUBJECT = 'mailto:homebridge-glass-ui@users.noreply.github.com'
const RE_B64URL = /^[\w-]+=*$/

export interface StoredPushSubscription extends PushSubscriptionLike {
  id: string
  /** A name for the device, from its browser (shown in the settings). */
  label: string
  username?: string
  createdAt: string
}

interface StoredFile {
  vapid?: VapidKeys
  subscriptions?: StoredPushSubscription[]
}

/** A subscription as the API shows it: without its keys. */
export interface PushSubscriptionInfo {
  id: string
  label: string
  username?: string
  createdAt: string
  /** The push service's host (fcm.googleapis.com, web.push.apple.com…). */
  service: string
}

/**
 * The "Browser" notification channel: Web Push to the devices that turned it
 * on. The VAPID key pair (generated on first use) and the subscriptions are
 * stored in `.uix-web-push.json` in the storage directory, owner-only. A
 * subscription the push service reports as gone (404/410) is removed.
 */
@Injectable()
export class WebPushService {
  public readonly filePath: string

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(JsonFileStoreService) private readonly store: JsonFileStoreService,
    @Inject(Logger) private readonly logger: Logger,
  ) {
    this.filePath = resolve(this.configService.storagePath, '.uix-web-push.json')
  }

  private get subject(): string {
    const value = process.env.UIX_WEB_PUSH_SUBJECT
    return value && /^(?:mailto:|https:\/\/)\S+$/.test(value) ? value : DEFAULT_SUBJECT
  }

  private async read(): Promise<StoredFile> {
    try {
      return (await this.store.read<StoredFile>(this.filePath)) ?? {}
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        this.logger.warn(`Failed to read the web push settings as ${e.message}.`)
      }
      return {}
    }
  }

  private subscriptionsOf(file: StoredFile | null): StoredPushSubscription[] {
    return Array.isArray(file?.subscriptions) ? file.subscriptions.filter(sub => sub && typeof sub.endpoint === 'string') : []
  }

  /** The VAPID public key browsers subscribe with, generated (and stored) the first time. */
  public async getPublicKey(): Promise<string> {
    const file = await this.read()
    if (isValidVapidKeys(file.vapid)) {
      return file.vapid.publicKey
    }
    const next = await this.store.mutate<StoredFile>(this.filePath, (current) => {
      if (isValidVapidKeys(current?.vapid)) {
        return current
      }
      this.logger.log('Generated the VAPID keys for browser notifications.')
      // New keys invalidate every subscription made with the old ones
      return { vapid: generateVapidKeys(), subscriptions: [] }
    }, { spaces: 2 })
    return next!.vapid!.publicKey
  }

  private present(sub: StoredPushSubscription): PushSubscriptionInfo {
    let service = ''
    try {
      service = new URL(sub.endpoint).host
    } catch {}
    return { id: sub.id, label: sub.label, username: sub.username, createdAt: sub.createdAt, service }
  }

  public async listSubscriptions(): Promise<PushSubscriptionInfo[]> {
    return this.subscriptionsOf(await this.read()).map(sub => this.present(sub))
  }

  public async count(): Promise<number> {
    return this.subscriptionsOf(await this.read()).length
  }

  /** Validate a subscription as the browser's `PushSubscription.toJSON()` gives it. */
  private parseSubscription(body: unknown): PushSubscriptionLike & { label: string } {
    const input = body as { endpoint?: unknown, keys?: { p256dh?: unknown, auth?: unknown }, label?: unknown }
    if (!input || typeof input !== 'object') {
      throw new BadRequestException('Expected a push subscription.')
    }
    const { endpoint, keys, label } = input
    let url: URL
    try {
      url = new URL(String(endpoint))
    } catch {
      throw new BadRequestException('Invalid push endpoint.')
    }
    if (typeof endpoint !== 'string' || endpoint.length > 2048 || url.protocol !== 'https:' || url.username || url.password) {
      throw new BadRequestException('The push endpoint must be an https URL.')
    }
    const p256dh = keys?.p256dh
    const auth = keys?.auth
    if (typeof p256dh !== 'string' || typeof auth !== 'string' || !RE_B64URL.test(p256dh) || !RE_B64URL.test(auth)
      || Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(auth, 'base64url').length !== 16) {
      throw new BadRequestException('Invalid push subscription keys.')
    }
    if (label !== undefined && (typeof label !== 'string' || label.length > 100)) {
      throw new BadRequestException('Invalid label.')
    }
    return { endpoint, keys: { p256dh, auth }, label: (label as string | undefined)?.trim() || url.host }
  }

  /** Add (or refresh) this device's subscription. */
  public async subscribe(body: unknown, username?: string): Promise<PushSubscriptionInfo> {
    const parsed = this.parseSubscription(body)
    await this.getPublicKey()
    const id = createHash('sha256').update(parsed.endpoint).digest('hex').slice(0, 16)
    let saved: StoredPushSubscription | undefined
    await this.store.mutate<StoredFile>(this.filePath, (current) => {
      const subscriptions = this.subscriptionsOf(current).filter(sub => sub.endpoint !== parsed.endpoint)
      if (subscriptions.length >= MAX_PUSH_SUBSCRIPTIONS) {
        throw new BadRequestException(`At most ${MAX_PUSH_SUBSCRIPTIONS} devices can receive browser notifications.`)
      }
      saved = { id, endpoint: parsed.endpoint, keys: parsed.keys, label: parsed.label, ...(username ? { username } : {}), createdAt: new Date().toISOString() }
      return { ...current, subscriptions: [...subscriptions, saved] }
    }, { spaces: 2 })
    return this.present(saved!)
  }

  /** Remove a subscription by its endpoint (this device) or id (any device). */
  public async unsubscribe(match: { endpoint?: unknown, id?: unknown }): Promise<{ removed: boolean }> {
    if (typeof match.endpoint !== 'string' && typeof match.id !== 'string') {
      throw new BadRequestException('Give the endpoint or the id of the subscription.')
    }
    let removed = false
    await this.store.mutate<StoredFile>(this.filePath, (current) => {
      const subscriptions = this.subscriptionsOf(current)
      const kept = subscriptions.filter(sub => sub.endpoint !== match.endpoint && sub.id !== match.id)
      removed = kept.length !== subscriptions.length
      return removed ? { ...current, subscriptions: kept } : null
    }, { spaces: 2 })
    if (!removed && typeof match.id === 'string') {
      throw new NotFoundException('Unknown subscription.')
    }
    return { removed }
  }

  /**
   * Send a notification to every subscribed device (or the one with this
   * endpoint). Throws when there is no device, or every send failed.
   * @returns how many devices it reached
   */
  public async send(msg: NotificationMessage, instance: string, only?: { endpoint?: string }): Promise<number> {
    const file = await this.read()
    const targets = this.subscriptionsOf(file).filter(sub => !only?.endpoint || sub.endpoint === only.endpoint)
    if (!isValidVapidKeys(file.vapid) || !targets.length) {
      throw new Error(only?.endpoint ? 'This device is not subscribed.' : 'No device is subscribed.')
    }
    const payload = {
      title: `${instance}: ${msg.title}`,
      body: truncateText(msg.message, PUSH_BODY_MAX),
      tag: `${msg.event}`,
      path: msg.path ?? '/',
      urgent: !!msg.urgent,
    }
    const gone: string[] = []
    const errors: string[] = []
    let sent = 0
    await Promise.all(targets.map(async (sub) => {
      try {
        await sendWebPush(sub, payload, file.vapid!, this.subject, { urgency: msg.urgent ? 'high' : 'normal' })
        sent++
      } catch (e) {
        if (e instanceof PushSubscriptionGoneError) {
          gone.push(sub.endpoint)
        } else {
          errors.push(`${sub.label}: ${e?.message ?? e}`)
        }
      }
    }))
    if (gone.length) {
      this.logger.log(`Removed ${gone.length} browser notification subscription(s) the push service no longer knows.`)
      await this.store.mutate<StoredFile>(this.filePath, current => ({ ...current, subscriptions: this.subscriptionsOf(current).filter(sub => !gone.includes(sub.endpoint)) }), { spaces: 2 })
    }
    if (!sent) {
      throw new Error(errors.length ? errors.join('; ') : 'Every subscribed device has unsubscribed.')
    }
    return sent
  }
}
