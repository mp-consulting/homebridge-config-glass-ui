import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

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
import { AppEventsService } from '../../src/core/events/app-events.service.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { ChildBridgeHealthService } from '../../src/modules/child-bridges/child-bridge-health.service.js'
import { NotificationsModule } from '../../src/modules/notifications/notifications.module.js'
import { DOWN_GRACE_MS, MAX_PER_HOUR, NotificationsService } from '../../src/modules/notifications/notifications.service.js'
import { PluginsService } from '../../src/modules/plugins/plugins.service.js'
import { testStoragePath } from '../storage-path.js'

const BOT_TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ_abc'

describe('Notifications (e2e)', () => {
  let app: NestFastifyApplication
  let service: NotificationsService
  let ipc: HomebridgeIpcService
  let authorization: string
  let fetchMock: ReturnType<typeof vi.fn>

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

    service = app.get(NotificationsService)
    ipc = app.get(HomebridgeIpcService)
  })

  beforeEach(async () => {
    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await remove(service.settingsPath)
    ;(service as any).cached = null
    ;(service as any).lastSent.clear()
    ;(service as any).sentLog = []
    ;(service as any).testLog = []
    authorization ??= `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })).json().access_token}`
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  const put = (payload: unknown) => app.inject({ method: 'PUT', path: '/notifications/settings', headers: { authorization }, payload: payload as any })

  const enableTelegramAndNtfy = () => put({
    channels: {
      telegram: { enabled: true, botToken: BOT_TOKEN, chatId: '-100123' },
      ntfy: { enabled: true, server: 'https://ntfy.example.com/', topic: 'hb-alerts', token: 'tk_secret' },
    },
  })

  it('starts with every channel off and every event on', async () => {
    const res = await app.inject({ method: 'GET', path: '/notifications/settings', headers: { authorization } })

    expect(res.statusCode).toBe(200)
    expect(res.json().channels.webhook).toEqual({ enabled: false, url: '' })
    expect(res.json().events).toEqual({ homebridgeDown: true, homebridgeUp: true, childBridgeCrashLoop: true, updatesAvailable: true, backupFailed: true })
  })

  it('stores secrets owner-only and never returns them in clear', async () => {
    const res = await enableTelegramAndNtfy()

    expect(res.statusCode).toBe(200)
    const body = JSON.stringify(res.json())
    expect(body).not.toContain(BOT_TOKEN)
    expect(body).not.toContain('tk_secret')
    expect(res.json().channels.telegram).toEqual({ enabled: true, botToken: '********', chatId: '-100123' })

    const again = await app.inject({ method: 'GET', path: '/notifications/settings', headers: { authorization } })
    expect(JSON.stringify(again.json())).not.toContain(BOT_TOKEN)

    const file = await readJson(service.settingsPath)
    expect(file.channels.telegram.botToken).toBe(BOT_TOKEN)
    const mode = (await stat(service.settingsPath)).mode & 0o777
    // Windows has no owner-only mode bits
    expect(process.platform === 'win32' || mode === 0o600).toBe(true)
  })

  it('keeps a secret sent back as the placeholder, and clears it with an empty string', async () => {
    await enableTelegramAndNtfy()

    await put({ channels: { telegram: { enabled: true, botToken: '********', chatId: '-100999' } } })
    expect((await readJson(service.settingsPath)).channels.telegram).toMatchObject({ botToken: BOT_TOKEN, chatId: '-100999' })

    await put({ channels: { ntfy: { enabled: false, token: '' } } })
    expect((await readJson(service.settingsPath)).channels.ntfy.token).toBe('')
  })

  it('refuses invalid settings', async () => {
    expect((await put({ channels: { webhook: { enabled: true, url: 'ftp://nope' } } })).statusCode).toBe(400)
    expect((await put({ channels: { webhook: { enabled: true, url: '' } } })).statusCode).toBe(400)
    expect((await put({ channels: { ntfy: { topic: '../etc' } } })).statusCode).toBe(400)
    expect((await put({ channels: { telegram: { botToken: 'nope' } } })).statusCode).toBe(400)
    expect((await put({ events: { homebridgeDown: 'yes' } })).statusCode).toBe(400)
  })

  it('is for administrators only', async () => {
    const res = await app.inject({ method: 'GET', path: '/notifications/settings' })
    expect(res.statusCode).toBe(401)
  })

  it('sends a test to every enabled channel and reports each', async () => {
    await enableTelegramAndNtfy()

    const res = await app.inject({ method: 'POST', path: '/notifications/test', headers: { authorization }, payload: {} })

    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual(expect.arrayContaining([{ channel: 'ntfy', ok: true }, { channel: 'telegram', ok: true }]))
    const urls = fetchMock.mock.calls.map(([url]) => url)
    expect(urls).toContain('https://ntfy.example.com/hb-alerts')
    expect(urls).toContain(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)
    const ntfyCall = fetchMock.mock.calls.find(([url]) => String(url).includes('ntfy'))!
    expect(ntfyCall[1].headers.Authorization).toBe('Bearer tk_secret')
  })

  it('reports a failing channel without leaking its secret', async () => {
    await enableTelegramAndNtfy()
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('telegram')) {
        throw new Error(`connect failed for ${url}`)
      }
      return new Response('', { status: 200 })
    })

    const res = await app.inject({ method: 'POST', path: '/notifications/test', headers: { authorization }, payload: { channel: 'telegram' } })

    expect(res.json()).toEqual([{ channel: 'telegram', ok: false, error: expect.any(String) }])
    expect(res.body).not.toContain(BOT_TOKEN)
  })

  it('sends Pushover and webhook messages in their formats', async () => {
    await put({
      channels: {
        pushover: { enabled: true, userKey: 'uQiRzpo4DXghDmr9QzzfQu27cmVRsG', appToken: 'azGDORePK8gMaC0QOYAMyEEuzJnyUi' },
        webhook: { enabled: true, url: 'https://hooks.example.com/abc' },
      },
    })

    await service.sendTest()

    const pushover = fetchMock.mock.calls.find(([url]) => String(url).includes('pushover'))!
    expect(new URLSearchParams(pushover[1].body).get('user')).toBe('uQiRzpo4DXghDmr9QzzfQu27cmVRsG')
    const webhook = fetchMock.mock.calls.find(([url]) => String(url).includes('hooks.example.com'))!
    expect(JSON.parse(webhook[1].body)).toMatchObject({ event: 'test', title: expect.stringContaining('Test notification') })
  })

  it('rate limits test messages', async () => {
    await enableTelegramAndNtfy()
    for (let i = 0; i < 5; i++) {
      await service.sendTest('ntfy')
    }

    const res = await app.inject({ method: 'POST', path: '/notifications/test', headers: { authorization }, payload: { channel: 'ntfy' } })
    expect(res.statusCode).toBe(400)
  })

  it('refuses a test with nothing to send to', async () => {
    const res = await app.inject({ method: 'POST', path: '/notifications/test', headers: { authorization }, payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it('does not send the same event twice within the cooldown, or more than the hourly cap', async () => {
    await enableTelegramAndNtfy()
    const msg = { event: 'backupFailed' as const, title: 'x', message: 'y' }

    expect(await service.notify(msg)).not.toBeNull()
    expect(await service.notify(msg)).toBeNull()

    for (let i = 1; i < MAX_PER_HOUR; i++) {
      expect(await service.notify(msg, `subject-${i}`)).not.toBeNull()
    }
    expect(await service.notify(msg, 'one-too-many')).toBeNull()
  })

  it('sends nothing for an event that is switched off', async () => {
    await enableTelegramAndNtfy()
    await put({ events: { backupFailed: false } })

    expect(await service.notify({ event: 'backupFailed', title: 'x', message: 'y' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports Homebridge down only once it stays down, then back up', async () => {
    await enableTelegramAndNtfy()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    // A restart: back before the grace period
    ipc.emit('serverStatusUpdate', { status: 'down' })
    ipc.emit('serverStatusUpdate', { status: 'ok' })
    await vi.advanceTimersByTimeAsync(DOWN_GRACE_MS + 1)
    expect(fetchMock).not.toHaveBeenCalled()

    ipc.emit('serverStatusUpdate', { status: 'down' })
    await vi.advanceTimersByTimeAsync(DOWN_GRACE_MS + 1)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('not been running')

    ipc.emit('serverStatusUpdate', { status: 'ok' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
  })

  it('reports a child bridge crash loop', async () => {
    await enableTelegramAndNtfy()

    app.get(ChildBridgeHealthService).emit('crashLoop', { name: 'Kitchen', plugin: 'homebridge-kitchen', username: 'AA', recentCrashes: 3 } as any)

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('Kitchen')
  })

  it('reports a failed scheduled backup', async () => {
    await enableTelegramAndNtfy()

    app.get(AppEventsService).emit('backupFailed', { message: 'disk full' })

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('disk full')
  })

  it('reports each new set of available updates once', async () => {
    await enableTelegramAndNtfy()
    const plugins = app.get(PluginsService)
    vi.spyOn(plugins, 'getOutOfDatePlugins').mockResolvedValue([{ name: 'homebridge-a', displayName: 'A', latestVersion: '2.0.0' } as any])
    vi.spyOn(plugins, 'getHomebridgePackage').mockResolvedValue({ name: 'homebridge', updateAvailable: false } as any)

    await service.checkForUpdates()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][1].body)).toContain('A 2.0.0')

    await service.checkForUpdates()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((await readJson(service.settingsPath)).lastUpdatesSignature).toBe('A 2.0.0')
  })
})
