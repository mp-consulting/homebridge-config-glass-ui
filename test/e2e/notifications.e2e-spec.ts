import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { Buffer } from 'node:buffer'
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
import { Logger } from '../../src/core/logger/logger.service.js'
import { SchedulerService } from '../../src/core/scheduler/scheduler.service.js'
import { AiService } from '../../src/modules/ai/ai.service.js'
import { ChildBridgeHealthService } from '../../src/modules/child-bridges/child-bridge-health.service.js'
import { truncateText } from '../../src/modules/notifications/notification-channels.js'
import { NotificationsModule } from '../../src/modules/notifications/notifications.module.js'
import { CRASH_LOOP_EXPLAIN_TIMEOUT_MS, DAILY_DIGEST_JOB, DOWN_GRACE_MS, MAX_PER_HOUR, NotificationsService } from '../../src/modules/notifications/notifications.service.js'
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
    ;(service as any).lastDigestDay = null
    app.get(SchedulerService).cancelJob(DAILY_DIGEST_JOB)
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

  it('starts with every channel off and every event on but the daily digest', async () => {
    const res = await app.inject({ method: 'GET', path: '/notifications/settings', headers: { authorization } })

    expect(res.statusCode).toBe(200)
    expect(res.json().channels.webhook).toEqual({ enabled: false, url: '' })
    expect(res.json().events).toEqual({ homebridgeDown: true, homebridgeUp: true, childBridgeCrashLoop: true, updatesAvailable: true, backupFailed: true, dailyDigest: false })
    expect(res.json().dailyDigestTime).toBe('08:00')
    expect(res.json().explainCrashLoops).toBe(true)
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
    expect((await put({ dailyDigestTime: '24:00' })).statusCode).toBe(400)
    expect((await put({ dailyDigestTime: '8:00' })).statusCode).toBe(400)
    expect((await put({ explainCrashLoops: 'yes' })).statusCode).toBe(400)
  })

  it('validates the settings with DTOs and ignores unknown fields', async () => {
    expect((await put({ channels: { telegram: 'on' } })).statusCode).toBe(400)
    expect((await put({ channels: { telegram: { enabled: 'yes' } } })).statusCode).toBe(400)
    expect((await put({ channels: { webhook: { url: 'x'.repeat(2049) } } })).statusCode).toBe(400)
    const time = await put({ dailyDigestTime: '25:00' })
    expect(time.json().message).toContain('dailyDigestTime must be a time of day as HH:mm.')

    const res = await put({ channels: { ntfy: { topic: '  hb-alerts  ', bogus: 'x' } }, events: { unknown: true }, other: 1 })
    expect(res.statusCode).toBe(200)
    const stored = await readJson(service.settingsPath)
    expect(stored.channels.ntfy.topic).toBe('hb-alerts')
    expect(stored.channels.ntfy).not.toHaveProperty('bogus')
    expect(stored.events).not.toHaveProperty('unknown')
    expect(stored).not.toHaveProperty('other')
  })

  it('refuses a test to an unknown channel', async () => {
    const res = await app.inject({ method: 'POST', path: '/notifications/test', headers: { authorization }, payload: { channel: 'email' } })
    expect(res.statusCode).toBe(400)
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

  describe('crash loop explanations', () => {
    const kitchen = { name: 'Kitchen', plugin: 'homebridge-kitchen', identifier: 'KitchenPlatform', username: 'AA', recentCrashes: 3 } as any
    const sentText = () => String(fetchMock.mock.calls[0][1].body)

    it('add the Assistant\'s explanation when it is on', async () => {
      await enableTelegramAndNtfy()
      const ai = app.get(AiService)
      vi.spyOn(ai, 'isReady').mockResolvedValue(true)
      const explain = vi.spyOn(ai, 'explainCrashLoop').mockResolvedValue('Its cloud login keeps failing.')

      await service.notifyCrashLoop(kitchen)

      expect(explain).toHaveBeenCalledWith({ name: 'Kitchen', plugin: 'homebridge-kitchen', identifier: 'KitchenPlatform' }, expect.any(AbortSignal))
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(sentText()).toContain('crashed 3 times')
      expect(sentText()).toContain('Assistant: Its cloud login keeps failing.')
    })

    it('are left out while the Assistant is off or not set up', async () => {
      await enableTelegramAndNtfy()
      const explain = vi.spyOn(app.get(AiService), 'explainCrashLoop')

      await service.notifyCrashLoop(kitchen)

      expect(explain).not.toHaveBeenCalled()
      expect(sentText()).not.toContain('Assistant:')
    })

    it('are not asked for when switched off, or for a notification that would not go out', async () => {
      await enableTelegramAndNtfy()
      const ai = app.get(AiService)
      vi.spyOn(ai, 'isReady').mockResolvedValue(true)
      const explain = vi.spyOn(ai, 'explainCrashLoop').mockResolvedValue('x')

      await put({ explainCrashLoops: false })
      await service.notifyCrashLoop(kitchen)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // On again, but within the cooldown of the one just sent
      await put({ explainCrashLoops: true })
      expect(await service.notifyCrashLoop(kitchen)).toBeNull()
      expect(explain).not.toHaveBeenCalled()
    })

    it('do not hold the notification back when the Assistant fails', async () => {
      await enableTelegramAndNtfy()
      const ai = app.get(AiService)
      vi.spyOn(ai, 'isReady').mockResolvedValue(true)
      vi.spyOn(ai, 'explainCrashLoop').mockRejectedValue(new Error('provider down'))
      const warn = vi.spyOn(app.get(Logger), 'warn')

      await service.notifyCrashLoop(kitchen)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(sentText()).not.toContain('Assistant:')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('provider down'))
    })

    it('are given up on after the timeout, and the request cancelled', async () => {
      await enableTelegramAndNtfy()
      const ai = app.get(AiService)
      vi.spyOn(ai, 'isReady').mockResolvedValue(true)
      let signal: AbortSignal | undefined
      vi.spyOn(ai, 'explainCrashLoop').mockImplementation((_bridge, given) => {
        signal = given
        return new Promise(() => {})
      })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const done = service.notifyCrashLoop(kitchen)
      await vi.advanceTimersByTimeAsync(CRASH_LOOP_EXPLAIN_TIMEOUT_MS - 100)
      expect(fetchMock).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(100)
      expect(await done).not.toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(sentText()).not.toContain('Assistant:')
      expect(signal?.aborted).toBe(true)
    })
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

  describe('the daily digest', () => {
    const job = () => app.get(SchedulerService).scheduledJobs[DAILY_DIGEST_JOB]

    it('is scheduled at the chosen time of day only while it is switched on', async () => {
      await enableTelegramAndNtfy()
      expect(job()).toBeUndefined()

      await put({ events: { dailyDigest: true }, dailyDigestTime: '07:30' })
      const next = job()!.nextInvocation()
      expect([next.getHours(), next.getMinutes(), next.getSeconds()]).toEqual([7, 30, 0])
      expect((await readJson(service.settingsPath)).dailyDigestTime).toBe('07:30')

      await put({ dailyDigestTime: '21:05' })
      expect([job()!.nextInvocation().getHours(), job()!.nextInvocation().getMinutes()]).toEqual([21, 5])

      await put({ events: { dailyDigest: false } })
      expect(job()).toBeUndefined()
    })

    it('is scheduled from the stored settings on start', async () => {
      await enableTelegramAndNtfy()
      await put({ events: { dailyDigest: true }, dailyDigestTime: '06:45' })
      app.get(SchedulerService).cancelJob(DAILY_DIGEST_JOB)
      ;(service as any).cached = null

      await service.scheduleDailyDigest()

      expect(job()!.nextInvocation().getHours()).toBe(6)
    })

    it('skips quietly while the Assistant is off or not set up', async () => {
      await enableTelegramAndNtfy()
      await put({ events: { dailyDigest: true } })
      const ai = app.get(AiService)
      const digest = vi.spyOn(ai, 'digest')

      // The test config has no HomebridgeAiKit block
      expect(await ai.isReady()).toBe(false)
      expect(await service.sendDailyDigest()).toBeNull()
      expect(digest).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('skips while the event or every channel is off, without asking the Assistant', async () => {
      const ready = vi.spyOn(app.get(AiService), 'isReady').mockResolvedValue(true)
      await put({ events: { dailyDigest: true } })
      expect(await service.sendDailyDigest()).toBeNull()

      await enableTelegramAndNtfy()
      await put({ events: { dailyDigest: false } })
      expect(await service.sendDailyDigest()).toBeNull()
      expect(ready).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends the digest as the system user once a day, cut to each channel\'s limit', async () => {
      await put({
        events: { dailyDigest: true },
        channels: {
          telegram: { enabled: true, botToken: BOT_TOKEN, chatId: '-100123' },
          pushover: { enabled: true, userKey: 'uQiRzpo4DXghDmr9QzzfQu27cmVRsG', appToken: 'azGDORePK8gMaC0QOYAMyEEuzJnyUi' },
        },
      })
      const ai = app.get(AiService)
      vi.spyOn(ai, 'isReady').mockResolvedValue(true)
      const long = `All good. ${'x'.repeat(5000)}`
      const digest = vi.spyOn(ai, 'digest').mockResolvedValue({ text: long, generatedAt: new Date().toISOString(), cached: false })

      const results = await service.sendDailyDigest()

      expect(results).toEqual(expect.arrayContaining([{ channel: 'telegram', ok: true }, { channel: 'pushover', ok: true }]))
      expect(digest).toHaveBeenCalledWith(expect.objectContaining({ username: '(notifications)', admin: false }))
      const telegram = JSON.parse(fetchMock.mock.calls.find(([url]) => String(url).includes('telegram'))![1].body)
      expect(telegram.text).toContain('Daily digest\nAll good.')
      expect([...telegram.text]).toHaveLength(4096)
      expect(telegram.text.endsWith('…')).toBe(true)
      const pushover = new URLSearchParams(fetchMock.mock.calls.find(([url]) => String(url).includes('pushover'))![1].body)
      expect([...pushover.get('message')!]).toHaveLength(1024)

      // Not again the same day, even when the job runs again (a time change)
      expect(await service.sendDailyDigest()).toBeNull()
      expect(digest).toHaveBeenCalledTimes(1)
    })

    it('logs a digest that fails to generate, and sends nothing', async () => {
      await enableTelegramAndNtfy()
      await put({ events: { dailyDigest: true } })
      const ai = app.get(AiService)
      vi.spyOn(ai, 'isReady').mockResolvedValue(true)
      vi.spyOn(ai, 'digest').mockRejectedValue(new Error('quota exceeded'))
      const warn = vi.spyOn(app.get(Logger), 'warn')

      expect(await service.sendDailyDigest()).toBeNull()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'))
    })

    it('counts against the hourly cap', async () => {
      await enableTelegramAndNtfy()
      await put({ events: { dailyDigest: true } })
      const ai = app.get(AiService)
      vi.spyOn(ai, 'isReady').mockResolvedValue(true)
      vi.spyOn(ai, 'digest').mockResolvedValue({ text: 'Fine.', generatedAt: '', cached: true })
      ;(service as any).sentLog = Array.from({ length: MAX_PER_HOUR }, () => Date.now())

      expect(await service.sendDailyDigest()).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
      // Dropped, not sent: a later run the same day may still send it
      expect((service as any).lastDigestDay).toBeNull()
    })
  })

  it('cuts text by characters or UTF-8 bytes without splitting a character', () => {
    expect(truncateText('short', 10)).toBe('short')
    expect(truncateText('abcdefghij', 5)).toBe('abcd…')
    expect(truncateText('😀😀😀😀', 3)).toBe('😀😀…')
    const bytes = truncateText('é'.repeat(100), 11, 'bytes')
    expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(11)
    expect(bytes).toBe('éééé…')
  })
})
