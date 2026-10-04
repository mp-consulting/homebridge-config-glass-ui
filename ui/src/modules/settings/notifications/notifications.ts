import { api } from '@/core/api'

export type ChannelName = 'webhook' | 'ntfy' | 'pushover' | 'telegram'
export type NotificationEvent = 'homebridgeDown' | 'homebridgeUp' | 'childBridgeCrashLoop' | 'updatesAvailable' | 'backupFailed'

export const NOTIFICATION_EVENTS: NotificationEvent[] = ['homebridgeDown', 'homebridgeUp', 'childBridgeCrashLoop', 'updatesAvailable', 'backupFailed']

/** `GET /notifications/settings`: stored secrets read as `********`. */
export interface NotificationSettings {
  channels: {
    webhook: { enabled: boolean, url: string }
    ntfy: { enabled: boolean, server: string, topic: string, token: string }
    pushover: { enabled: boolean, userKey: string, appToken: string }
    telegram: { enabled: boolean, botToken: string, chatId: string }
  }
  events: Record<NotificationEvent, boolean>
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
