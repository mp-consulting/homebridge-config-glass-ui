import { api } from '@/core/api'

export type ChannelName = 'webhook' | 'ntfy' | 'pushover' | 'telegram'
export type NotificationEvent = 'homebridgeDown' | 'homebridgeUp' | 'childBridgeCrashLoop' | 'rollbackSuggested' | 'updatesAvailable' | 'backupFailed' | 'dailyDigest'

export const NOTIFICATION_EVENTS: NotificationEvent[] = ['homebridgeDown', 'homebridgeUp', 'childBridgeCrashLoop', 'rollbackSuggested', 'updatesAvailable', 'backupFailed', 'dailyDigest']

/** A time of day as the server takes it: HH:mm, 24 hours. */
export const RE_TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/** `GET /notifications/settings`: stored secrets read as `********`. */
export interface NotificationSettings {
  channels: {
    webhook: { enabled: boolean, url: string }
    ntfy: { enabled: boolean, server: string, topic: string, token: string }
    pushover: { enabled: boolean, userKey: string, appToken: string }
    telegram: { enabled: boolean, botToken: string, chatId: string }
  }
  events: Record<NotificationEvent, boolean>
  /** When the daily digest is sent, HH:mm in the server's local time. */
  dailyDigestTime: string
  /** Add the Assistant's reading of the bridge's log to a crash loop notification (when the Assistant is on). */
  explainCrashLoops: boolean
}

export interface ChannelResult {
  channel: ChannelName
  ok: boolean
  error?: string
}

interface ChannelField {
  name: string
  label: string
  secret?: boolean
  placeholder?: string
}

/** The inputs of each channel, in order. */
export const CHANNEL_FIELDS: Array<{ channel: ChannelName, fields: ChannelField[] }> = [
  { channel: 'webhook', fields: [{ name: 'url', label: 'settings.notifications.webhook_url', secret: true, placeholder: 'https://' }] },
  {
    channel: 'ntfy',
    fields: [
      { name: 'server', label: 'settings.notifications.ntfy_server', placeholder: 'https://ntfy.sh' },
      { name: 'topic', label: 'settings.notifications.ntfy_topic' },
      { name: 'token', label: 'settings.notifications.ntfy_token', secret: true },
    ],
  },
  {
    channel: 'pushover',
    fields: [
      { name: 'userKey', label: 'settings.notifications.pushover_user', secret: true },
      { name: 'appToken', label: 'settings.notifications.pushover_token', secret: true },
    ],
  },
  {
    channel: 'telegram',
    fields: [
      { name: 'botToken', label: 'settings.notifications.telegram_token', secret: true },
      { name: 'chatId', label: 'settings.notifications.telegram_chat' },
    ],
  },
]

export function loadNotificationSettings(): Promise<NotificationSettings> {
  return api.get<NotificationSettings>('/notifications/settings')
}

export function saveNotificationSettings(settings: NotificationSettings): Promise<NotificationSettings> {
  return api.put<NotificationSettings>('/notifications/settings', settings)
}

export function sendTestNotification(channel?: ChannelName): Promise<ChannelResult[]> {
  return api.post<ChannelResult[]>('/notifications/test', channel ? { channel } : {})
}
