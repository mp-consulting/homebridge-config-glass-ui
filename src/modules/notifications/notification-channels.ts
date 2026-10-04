/**
 * The notification channels and how each one is sent to. Every send is one
 * HTTPS request through the global fetch with a timeout; a channel that
 * fails throws, and the dispatcher reports it per channel.
 */

export type ChannelName = 'webhook' | 'ntfy' | 'pushover' | 'telegram'
export const CHANNEL_NAMES: ChannelName[] = ['webhook', 'ntfy', 'pushover', 'telegram']

export type NotificationEvent = 'homebridgeDown' | 'homebridgeUp' | 'childBridgeCrashLoop' | 'updatesAvailable' | 'backupFailed'
export const NOTIFICATION_EVENTS: NotificationEvent[] = ['homebridgeDown', 'homebridgeUp', 'childBridgeCrashLoop', 'updatesAvailable', 'backupFailed']

export interface NotificationChannels {
  webhook: { enabled: boolean, url: string }
  ntfy: { enabled: boolean, server: string, topic: string, token: string }
  pushover: { enabled: boolean, userKey: string, appToken: string }
  telegram: { enabled: boolean, botToken: string, chatId: string }
}

export interface NotificationSettings {
  channels: NotificationChannels
  events: Record<NotificationEvent, boolean>
}

/** The fields that are never sent back to the browser in clear. */
export const SECRET_FIELDS: { [C in ChannelName]: Array<keyof NotificationChannels[C]> } = {
  webhook: ['url'],
  ntfy: ['token'],
  pushover: ['userKey', 'appToken'],
  telegram: ['botToken'],
}

/** What a stored secret reads as in the API. Sent back unchanged, it keeps the stored value. */
export const SECRET_PLACEHOLDER = '********'

export function defaultNotificationSettings(): NotificationSettings {
  return {
    channels: {
      webhook: { enabled: false, url: '' },
      ntfy: { enabled: false, server: 'https://ntfy.sh', topic: '', token: '' },
      pushover: { enabled: false, userKey: '', appToken: '' },
      telegram: { enabled: false, botToken: '', chatId: '' },
    },
    events: {
      homebridgeDown: true,
      homebridgeUp: true,
      childBridgeCrashLoop: true,
      updatesAvailable: true,
      backupFailed: true,
    },
  }
}

export interface NotificationMessage {
  event: NotificationEvent | 'test'
  title: string
  message: string
  /** Higher for outages: ntfy / Pushover priority. */
  urgent?: boolean
}

const SEND_TIMEOUT_MS = 10_000

async function post(url: string, init: { headers: Record<string, string>, body: string }): Promise<void> {
  const response = await fetch(url, { ...init, method: 'POST', redirect: 'error', signal: AbortSignal.timeout(SEND_TIMEOUT_MS) })
  if (!response.ok) {
    // The body may echo the request (and with it a token); report the status only
    throw new Error(`HTTP ${response.status}`)
  }
}

/** Whether a channel has everything it needs to send. */
export function isChannelConfigured(name: ChannelName, channels: NotificationChannels): boolean {
  switch (name) {
    case 'webhook':
      return !!channels.webhook.url
    case 'ntfy':
      return !!channels.ntfy.server && !!channels.ntfy.topic
    case 'pushover':
      return !!channels.pushover.userKey && !!channels.pushover.appToken
    case 'telegram':
      return !!channels.telegram.botToken && !!channels.telegram.chatId
  }
}

/** Send one message on one channel. */
export async function sendToChannel(name: ChannelName, channels: NotificationChannels, msg: NotificationMessage, instance: string): Promise<void> {
  const title = `${instance}: ${msg.title}`
  switch (name) {
    case 'webhook':
      return post(channels.webhook.url, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: msg.event, title, message: msg.message, instance, timestamp: new Date().toISOString() }),
      })
    case 'ntfy': {
      const { server, topic, token } = channels.ntfy
      const headers: Record<string, string> = {
        // Header values must be latin1: strip anything else from the title
        Title: [...title].map(char => (char >= ' ' && char <= '~' ? char : '?')).join(''),
        Priority: msg.urgent ? 'high' : 'default',
        Tags: 'homebridge',
      }
      if (token) {
        headers.Authorization = `Bearer ${token}`
      }
      return post(`${server.replace(/\/+$/, '')}/${encodeURIComponent(topic)}`, { headers, body: msg.message })
    }
    case 'pushover':
      return post('https://api.pushover.net/1/messages.json', {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: channels.pushover.appToken,
          user: channels.pushover.userKey,
          title,
          message: msg.message,
          priority: msg.urgent ? '1' : '0',
        }).toString(),
      })
    case 'telegram':
      return post(`https://api.telegram.org/bot${channels.telegram.botToken}/sendMessage`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: channels.telegram.chatId, text: `${title}\n${msg.message}`, disable_web_page_preview: true }),
      })
  }
}
