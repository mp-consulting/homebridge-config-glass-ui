/**
 * Web Push without a dependency: VAPID (RFC 8292) signed with ES256, and the
 * payload encrypted as `aes128gcm` (RFC 8188 / RFC 8291), all on node:crypto.
 */

import { Buffer } from 'node:buffer'
import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto'

export interface VapidKeys {
  /** The uncompressed P-256 public key (65 bytes), base64url: the browser's `applicationServerKey`. */
  publicKey: string
  /** The private scalar (32 bytes), base64url. */
  privateKey: string
}

export interface PushSubscriptionKeys {
  /** The browser's P-256 public key, base64url. */
  p256dh: string
  /** The 16-byte auth secret, base64url. */
  auth: string
}

export interface PushSubscriptionLike {
  endpoint: string
  keys: PushSubscriptionKeys
}

const RECORD_SIZE = 4096
/** The most plaintext one record holds (record size, less the delimiter and the GCM tag). */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 17 - 86

const b64url = (data: Buffer) => data.toString('base64url')
const fromB64url = (text: string) => Buffer.from(text, 'base64url')

/** A new VAPID key pair. */
export function generateVapidKeys(): VapidKeys {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ format: 'jwk' })
  const priv = privateKey.export({ format: 'jwk' })
  return {
    publicKey: b64url(Buffer.concat([Buffer.from([4]), fromB64url(pub.x!), fromB64url(pub.y!)])),
    privateKey: priv.d!,
  }
}

/** Whether stored keys look like a usable VAPID pair. */
export function isValidVapidKeys(keys: unknown): keys is VapidKeys {
  const k = keys as VapidKeys
  return !!k && typeof k.publicKey === 'string' && typeof k.privateKey === 'string'
    && fromB64url(k.publicKey).length === 65 && fromB64url(k.privateKey).length === 32
}

/**
 * The `Authorization` header for a push service: a VAPID JWT for the
 * endpoint's origin, valid for 12 hours.
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })))
  const pub = fromB64url(keys.publicKey)
  const key = createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
  })
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`
}

/**
 * Encrypt a payload for one subscription (RFC 8291, one aes128gcm record).
 * `salt` and `serverPrivateKey` are for tests: by default both are random.
 */
export function encryptPayload(payload: Buffer, keys: PushSubscriptionKeys, options: { salt?: Buffer, serverPrivateKey?: Buffer } = {}): Buffer {
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Push payload too large (${payload.length} bytes).`)
  }
  const uaPublic = fromB64url(keys.p256dh)
  const authSecret = fromB64url(keys.auth)
  if (uaPublic.length !== 65 || authSecret.length !== 16) {
    throw new Error('Invalid push subscription keys.')
  }
  const salt = options.salt ?? randomBytes(16)
  const ecdh = createECDH('prime256v1')
  if (options.serverPrivateKey) {
    ecdh.setPrivateKey(options.serverPrivateKey)
  } else {
    ecdh.generateKeys()
  }
  const asPublic = ecdh.getPublicKey()
  const shared = ecdh.computeSecret(uaPublic)

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // The last (and only) record ends with the 0x02 delimiter
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])

  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(asPublic.length, 20)
  return Buffer.concat([header, asPublic, body])
}

/** A push service answered that the subscription no longer exists (404/410): forget it. */
export class PushSubscriptionGoneError extends Error {}

/** Send one push message. Throws on failure; PushSubscriptionGoneError when the subscription is gone. */
export async function sendWebPush(subscription: PushSubscriptionLike, payload: unknown, vapid: VapidKeys, subject: string, options: { ttl?: number, urgency?: 'normal' | 'high', timeoutMs?: number } = {}): Promise<void> {
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), subscription.keys)
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    headers: {
      'Authorization': vapidAuthorization(subscription.endpoint, vapid, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': String(options.ttl ?? 24 * 3600),
      'Urgency': options.urgency ?? 'normal',
    },
    body: new Uint8Array(body),
  })
  if (response.status === 404 || response.status === 410) {
    throw new PushSubscriptionGoneError(`HTTP ${response.status}`)
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
}
