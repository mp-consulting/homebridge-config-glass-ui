import { describe, expect, it } from 'vitest'

import { base64UrlToBytes, deviceLabel, pushUnavailableReason, subscriptionId } from './web-push'

describe('web push helpers', () => {
  const env = (overrides: { secure?: boolean, ua?: string, push?: boolean, sw?: boolean, production?: boolean } = {}) => {
    const w: any = {
      isSecureContext: overrides.secure ?? true,
      navigator: { userAgent: overrides.ua ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130 Safari/537.36', ...(overrides.sw === false ? {} : { serviceWorker: {} }) },
      matchMedia: () => ({ matches: false }),
      Notification: {},
    }
    if (overrides.push !== false) {
      w.PushManager = {}
    }
    return { window: w, production: overrides.production ?? true }
  }

  it('says why push is not available', () => {
    expect(pushUnavailableReason(env())).toBeNull()
    expect(pushUnavailableReason(env({ secure: false }))).toBe('insecure')
    expect(pushUnavailableReason(env({ production: false }))).toBe('unsupported')
    expect(pushUnavailableReason(env({ sw: false }))).toBe('unsupported')
    expect(pushUnavailableReason(env({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', push: false }))).toBe('ios-not-installed')
  })

  it('decodes the server key', () => {
    expect([...base64UrlToBytes('AP8-_w')]).toEqual([0, 255, 62, 255])
  })

  it('names the device from its user agent', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit Version/18.0 Mobile Safari/604.1')).toBe('Safari on iPhone')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge on Windows')
  })

  it('computes the server\'s id of a subscription', async () => {
    // sha256('https://push.example.com/send/device-1'), first 16 hex digits
    expect(await subscriptionId('https://push.example.com/send/device-1')).toMatch(/^[0-9a-f]{16}$/)
  })
})
