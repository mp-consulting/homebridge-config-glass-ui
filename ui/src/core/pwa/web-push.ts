import { api } from '@/core/api'

/** `GET /notifications/web-push`. */
export interface WebPushState {
  publicKey: string
  subscriptions: Array<{ id: string, label: string, username?: string, createdAt: string, service: string }>
}

/**
 * Why this browser cannot receive push notifications, or null when it can:
 * `insecure` (not https), `unsupported` (no service worker or Push API, or a
 * development build without the service worker), `ios-not-installed` (Safari
 * on iOS only delivers push to the app added to the Home Screen).
 */
export function pushUnavailableReason(env: { window: Window & typeof globalThis, production: boolean } = { window, production: import.meta.env.PROD }): 'insecure' | 'unsupported' | 'ios-not-installed' | null {
  const w = env.window
  if (!w.isSecureContext) {
    return 'insecure'
  }
  const ios = /iPad|iPhone|iPod/.test(w.navigator.userAgent)
  const standalone = w.matchMedia?.('(display-mode: standalone)').matches || (w.navigator as Navigator & { standalone?: boolean }).standalone === true
  if (ios && !standalone && !('PushManager' in w)) {
    return 'ios-not-installed'
  }
  if (!env.production || !('serviceWorker' in w.navigator) || !('PushManager' in w) || !('Notification' in w)) {
    return 'unsupported'
  }
  return null
}

/** The applicationServerKey a browser wants: the base64url key as bytes. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i)
  }
  return bytes
}

/** A name for this device in the list: browser and platform from the user agent. */
export function deviceLabel(userAgent = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent) ? 'Safari' : 'Browser'
  const platform = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : ''
  return platform ? `${browser} on ${platform}` : browser
}

/** The id the server gives the subscription with this endpoint (the start of its SHA-256). */
export async function subscriptionId(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

export const webPush = {
  getState(): Promise<WebPushState> {
    return api.get<WebPushState>('/notifications/web-push')
  },

  /** This browser's push subscription, if it has one. */
  async currentSubscription(): Promise<PushSubscription | null> {
    const registration = await navigator.serviceWorker.ready
    return registration.pushManager.getSubscription()
  },

  /**
   * Ask for permission, subscribe this browser with the server's key and
   * register it. Resolves false when permission is refused.
   */
  async subscribeThisDevice(publicKey: string): Promise<boolean> {
    if (await Notification.requestPermission() !== 'granted') {
      return false
    }
    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()
    // A subscription made with other keys (the server's were regenerated) is refused by the push service
    const key = subscription?.options.applicationServerKey
    if (subscription && key && btoa(String.fromCharCode(...new Uint8Array(key))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) {
      await subscription.unsubscribe()
      subscription = null
    }
    subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) })
    await api.post('/notifications/web-push/subscriptions', { ...subscription.toJSON(), label: deviceLabel() })
    return true
  },

  async unsubscribeThisDevice(): Promise<void> {
    const subscription = await webPush.currentSubscription()
    if (subscription) {
      await api.post('/notifications/web-push/unsubscribe', { endpoint: subscription.endpoint })
      await subscription.unsubscribe()
    }
  },

  removeDevice(id: string): Promise<unknown> {
    return api.delete(`/notifications/web-push/subscriptions/${encodeURIComponent(id)}`)
  },

  sendTest(endpoint?: string): Promise<{ channel: 'browser', ok: boolean, error?: string }> {
    return api.post('/notifications/web-push/test', endpoint ? { endpoint } : {})
  },
}
