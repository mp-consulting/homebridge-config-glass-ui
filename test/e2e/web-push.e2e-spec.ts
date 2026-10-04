import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { Buffer } from 'node:buffer'
import { createECDH, createPublicKey, verify } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { HttpService } from '@nestjs/axios'
import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, readJson, remove } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { NotificationsModule } from '../../src/modules/notifications/notifications.module.js'
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js'
import { encryptPayload, generateVapidKeys, vapidAuthorization } from '../../src/modules/notifications/web-push.js'
import { WebPushService } from '../../src/modules/notifications/web-push.service.js'
import { testStoragePath } from '../storage-path.js'

/** A browser's subscription keys. */
function browserKeys() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') }
}

describe('Web Push', () => {
  describe('the protocol', () => {
    it('encrypts as RFC 8291 says (its worked example)', () => {
      const body = encryptPayload(Buffer.from('When I grow up, I want to be a watermelon'), {
        p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      }, {
        salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
        serverPrivateKey: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'),
      })

      expect(body.toString('base64url')).toBe('DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN')
    })

    it('refuses a payload larger than one record, and bad keys', () => {
      expect(() => encryptPayload(Buffer.alloc(5000), browserKeys())).toThrow('too large')
      expect(() => encryptPayload(Buffer.from('x'), { p256dh: 'AAAA', auth: 'AAAA' })).toThrow('Invalid push subscription keys')
    })

    it('signs a VAPID token for the endpoint\'s origin with the stored key', () => {
      const keys = generateVapidKeys()
      const header = vapidAuthorization('https://push.example.com/abc/def', keys, 'mailto:me@example.com', Date.parse('2026-10-04T00:00:00Z'))

      const [, jwt, k] = header.match(/^vapid t=(\S+), k=(\S+)$/)!
      expect(k).toBe(keys.publicKey)
      const [h, c, sig] = jwt.split('.')
      expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ aud: 'https://push.example.com', exp: Date.parse('2026-10-04T12:00:00Z') / 1000, sub: 'mailto:me@example.com' })
      const pub = Buffer.from(keys.publicKey, 'base64url')
      const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } })
      expect(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'))).toBe(true)
    })
  })

  describe('the browser channel (e2e)', () => {
    let app: NestFastifyApplication
    let webPush: WebPushService
    let notifications: NotificationsService
    let authorization: string
    let fetchMock: ReturnType<typeof vi.fn>
    const ENDPOINT = 'https://push.example.com/send/device-1'

    beforeAll(async () => {
      process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
      process.env.UIX_STORAGE_PATH = testStoragePath
      process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
      await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
      await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
      await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [NotificationsModule, AuthModule],
      }).overrideProvider(HttpService).useValue(new HttpService()).compile()

      app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
      await app.init()
      await app.getHttpAdapter().getInstance().ready()
      webPush = app.get(WebPushService)
      notifications = app.get(NotificationsService)
    })

    beforeEach(async () => {
      fetchMock = vi.fn(async () => new Response('', { status: 201 }))
      vi.stubGlobal('fetch', fetchMock)
      await remove(webPush.filePath)
      await remove(notifications.settingsPath)
      ;(notifications as any).cached = null
      ;(notifications as any).lastSent.clear()
      ;(notifications as any).sentLog = []
      ;(notifications as any).testLog = []
      authorization ??= `bearer ${(await app.inject({
        method: 'POST',
        path: '/auth/login',
        payload: { username: 'admin', password: 'admin' },
      })).json().access_token}`
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    afterAll(async () => {
      await app.close()
    })

    const subscribe = (payload: unknown) => app.inject({ method: 'POST', path: '/notifications/web-push/subscriptions', headers: { authorization }, payload: payload as any })

    it('generates the VAPID keys once and stores them owner-only', async () => {
      const first = (await app.inject({ method: 'GET', path: '/notifications/web-push', headers: { authorization } })).json()
      const second = (await app.inject({ method: 'GET', path: '/notifications/web-push', headers: { authorization } })).json()

      expect(first.publicKey).toMatch(/^B[\w-]{86}$/)
      expect(second).toEqual({ publicKey: first.publicKey, subscriptions: [] })
      const mode = (await stat(webPush.filePath)).mode & 0o777
      expect(process.platform === 'win32' || mode === 0o600).toBe(true)
    })

    it('subscribes, lists without the keys, and unsubscribes a device', async () => {
      const keys = browserKeys()
      const res = await subscribe({ endpoint: ENDPOINT, keys, label: 'Safari on iPhone' })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ label: 'Safari on iPhone', username: 'admin', service: 'push.example.com' })

      // Subscribing again replaces it
      await subscribe({ endpoint: ENDPOINT, keys })
      const state = (await app.inject({ method: 'GET', path: '/notifications/web-push', headers: { authorization } })).json()
      expect(state.subscriptions).toHaveLength(1)
      expect(JSON.stringify(state)).not.toContain(keys.auth)

      const off = await app.inject({ method: 'POST', path: '/notifications/web-push/unsubscribe', headers: { authorization }, payload: { endpoint: ENDPOINT } })
      expect(off.json()).toEqual({ removed: true })
      expect(await webPush.count()).toBe(0)
    })

    it('removes a device by id, and 404s an unknown one', async () => {
      const { id } = (await subscribe({ endpoint: ENDPOINT, keys: browserKeys() })).json()

      expect((await app.inject({ method: 'DELETE', path: `/notifications/web-push/subscriptions/${id}`, headers: { authorization } })).json()).toEqual({ removed: true })
      expect((await app.inject({ method: 'DELETE', path: `/notifications/web-push/subscriptions/${id}`, headers: { authorization } })).statusCode).toBe(404)
    })

    it('refuses a subscription that is not https or has bad keys', async () => {
      expect((await subscribe({ endpoint: 'http://push.example.com/x', keys: browserKeys() })).statusCode).toBe(400)
      expect((await subscribe({ endpoint: ENDPOINT, keys: { p256dh: 'abc', auth: 'def' } })).statusCode).toBe(400)
      expect((await subscribe({ endpoint: 'nope', keys: browserKeys() })).statusCode).toBe(400)
    })

    it('needs an administrator', async () => {
      expect((await app.inject({ method: 'GET', path: '/notifications/web-push' })).statusCode).toBe(401)
    })

    it('sends an event to every subscribed device when the channel is on', async () => {
      await subscribe({ endpoint: ENDPOINT, keys: browserKeys() })
      const put = await app.inject({ method: 'PUT', path: '/notifications/settings', headers: { authorization }, payload: { channels: { browser: { enabled: true } } } })
      expect(put.statusCode).toBe(200)
      expect(put.json().channels.browser).toEqual({ enabled: true })

      const results = await notifications.notify({ event: 'backupFailed', title: 'Scheduled backup failed', message: 'disk full', urgent: true })

      expect(results).toEqual([{ channel: 'browser', ok: true }])
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe(ENDPOINT)
      expect(init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', 'Urgency': 'high', 'TTL': '86400' })
      expect(init.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=B[\w-]+$/)
      // Encrypted: the message is not readable on the wire
      expect(Buffer.from(init.body as Uint8Array).toString('latin1')).not.toContain('disk full')
    })

    it('forgets a device the push service no longer knows', async () => {
      await subscribe({ endpoint: ENDPOINT, keys: browserKeys() })
      fetchMock.mockResolvedValue(new Response('', { status: 410 }))

      const res = await app.inject({ method: 'POST', path: '/notifications/web-push/test', headers: { authorization }, payload: {} })

      expect(res.json()).toMatchObject({ channel: 'browser', ok: false })
      expect((await readJson(webPush.filePath)).subscriptions).toEqual([])
    })

    it('sends a test to this device only', async () => {
      await subscribe({ endpoint: ENDPOINT, keys: browserKeys() })
      await subscribe({ endpoint: 'https://push.example.com/send/device-2', keys: browserKeys() })

      const res = await app.inject({ method: 'POST', path: '/notifications/web-push/test', headers: { authorization }, payload: { endpoint: ENDPOINT } })

      expect(res.json()).toEqual({ channel: 'browser', ok: true })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][0]).toBe(ENDPOINT)
    })

    it('reports a test with no device subscribed', async () => {
      const res = await app.inject({ method: 'POST', path: '/notifications/web-push/test', headers: { authorization }, payload: {} })
      expect(res.json()).toMatchObject({ channel: 'browser', ok: false, error: 'No device is subscribed.' })
    })
  })
})
