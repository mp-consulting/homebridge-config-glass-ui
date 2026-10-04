import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, readJson, remove, writeJson } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiTokenService } from '../../src/core/auth/api-token.service.js'
import { AuthModule } from '../../src/core/auth/auth.module.js'
import { AuthService } from '../../src/core/auth/auth.service.js'
import { verifyWsClient } from '../../src/core/auth/guards/ws-auth.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { ChildBridgesService } from '../../src/modules/child-bridges/child-bridges.service.js'
import { ServerModule } from '../../src/modules/server/server.module.js'
import { StatusModule } from '../../src/modules/status/status.module.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

describe('API tokens (e2e)', () => {
  let app: NestFastifyApplication
  let authorization: string
  let apiTokens: ApiTokenService
  let authService: AuthService
  let configService: ConfigService
  let childBridgesService: ChildBridgesService
  let tokensPath: string

  async function createToken(body: Record<string, unknown>) {
    return app.inject({ method: 'POST', path: '/auth/tokens', headers: { authorization }, payload: body })
  }

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, ServerModule, StatusModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      skipMissingProperties: true,
    }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    apiTokens = app.get(ApiTokenService)
    authService = app.get(AuthService)
    configService = app.get(ConfigService)
    childBridgesService = app.get(ChildBridgesService)
    tokensPath = apiTokens.tokensPath
  })

  beforeEach(async () => {
    authorization ??= `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })).json().access_token}`
    await remove(tokensPath)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('management', () => {
    it('creates a token, shows it once and stores only its hash', async () => {
      const res = await createToken({ name: 'Assistant', scope: 'read', expiresInDays: 30 })

      expect(res.statusCode).toBe(201)
      const body = res.json()
      expect(body).toEqual({
        id: expect.any(String),
        name: 'Assistant',
        scope: 'read',
        token: expect.stringMatching(/^hbg_[\w-]{43}$/),
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      })
      const lifetime = Date.parse(body.expiresAt) - Date.parse(body.createdAt)
      expect(lifetime).toBe(30 * 24 * 60 * 60 * 1000)

      const stored = await readJson(tokensPath)
      expect(stored).toHaveLength(1)
      expect(JSON.stringify(stored)).not.toContain(body.token)
      expect(stored[0].hash).toMatch(/^[0-9a-f]{64}$/)
      expect(stored[0].createdBy).toBe('admin')
    })

    it('creates a token that never expires', async () => {
      const res = await createToken({ name: 'Forever', scope: 'admin', expiresInDays: null })
      expect(res.statusCode).toBe(201)
      expect(res.json().expiresAt).toBeNull()
    })

    it('lists tokens without their values or hashes', async () => {
      await createToken({ name: 'One', scope: 'read' })
      await createToken({ name: 'Two', scope: 'admin' })

      const res = await app.inject({ method: 'GET', path: '/auth/tokens', headers: { authorization } })

      expect(res.statusCode).toBe(200)
      const list = res.json()
      expect(list.map((x: any) => x.name).sort()).toEqual(['One', 'Two'])
      for (const item of list) {
        expect(item).not.toHaveProperty('token')
        expect(item).not.toHaveProperty('hash')
        expect(item.lastUsedAt).toBeNull()
      }
    })

    it('rejects an invalid scope, a missing name and a bad expiry', async () => {
      expect((await createToken({ name: 'x', scope: 'root' })).statusCode).toBe(400)
      expect((await createToken({ scope: 'read' })).statusCode).toBe(400)
      expect((await createToken({ name: 'x', scope: 'read', expiresInDays: 0 })).statusCode).toBe(400)
      expect((await createToken({ name: 'x', scope: 'read', expiresInDays: 1.5 })).statusCode).toBe(400)
    })

    it('revokes a token, which then stops working', async () => {
      const { id, token } = (await createToken({ name: 'Temp', scope: 'admin' })).json()
      expect((await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)

      const res = await app.inject({ method: 'DELETE', path: `/auth/tokens/${id}`, headers: { authorization } })
      expect(res.statusCode).toBe(204)

      expect((await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
      expect((await app.inject({ method: 'GET', path: '/auth/tokens', headers: { authorization } })).json()).toEqual([])
    })

    it('answers 404 for an unknown token id', async () => {
      const res = await app.inject({ method: 'DELETE', path: '/auth/tokens/nope', headers: { authorization } })
      expect(res.statusCode).toBe(404)
    })

    it('is admin only', async () => {
      const { token } = (await createToken({ name: 'Reader', scope: 'read' })).json()
      const res = await app.inject({ method: 'GET', path: '/auth/tokens', headers: { authorization: `Bearer ${token}` } })
      expect(res.statusCode).toBe(403)
    })
  })

  describe('authentication', () => {
    it('authenticates an admin token as an administrator for any method', async () => {
      const { token } = (await createToken({ name: 'Admin', scope: 'admin' })).json()
      vi.spyOn(childBridgesService, 'restartChildBridge').mockReturnValue({ ok: true } as any)

      const res = await app.inject({ method: 'PUT', path: '/server/restart/0EAABBCCDDEE', headers: { authorization: `Bearer ${token}` } })

      expect(res.statusCode).toBe(200)
      expect(childBridgesService.restartChildBridge).toHaveBeenCalledWith('0EAABBCCDDEE')
    })

    it('lets a read token GET and HEAD, as a non-admin', async () => {
      const { token } = (await createToken({ name: 'Reader', scope: 'read' })).json()
      vi.spyOn(childBridgesService, 'getChildBridges').mockResolvedValue([{
        status: 'ok',
        username: '0E:AA:BB:CC:DD:EE',
        name: 'Bridge',
        pin: '123-45-678',
        setupUri: 'X-HM://0024SETUP',
      }] as any)

      const res = await app.inject({ method: 'GET', path: '/status/homebridge/child-bridges', headers: { authorization: `Bearer ${token}` } })
      expect(res.statusCode).toBe(200)
      // Pairing codes are for administrators only
      expect(res.json()[0]).not.toHaveProperty('pin')

      expect((await app.inject({ method: 'HEAD', path: '/auth/check', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
      // Admin-only reads stay admin-only
      expect((await app.inject({ method: 'GET', path: '/server/pairing', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403)
    })

    it('refuses anything but GET/HEAD from a read token with 403', async () => {
      const { token } = (await createToken({ name: 'Reader', scope: 'read' })).json()
      const restart = vi.spyOn(childBridgesService, 'restartChildBridge')

      const attempts = [
        { method: 'PUT', path: '/server/restart/0EAABBCCDDEE' },
        { method: 'POST', path: '/auth/tokens', payload: { name: 'x', scope: 'admin' } },
        { method: 'DELETE', path: '/auth/tokens/anything' },
        { method: 'POST', path: '/auth/logout' },
      ] as const
      for (const attempt of attempts) {
        const res = await app.inject({ ...attempt, headers: { authorization: `Bearer ${token}` } })
        expect(res.statusCode, `${attempt.method} ${attempt.path}`).toBe(attempt.path === '/auth/logout' ? 201 : 403)
      }
      expect(restart).not.toHaveBeenCalled()
    })

    it('rejects an expired token', async () => {
      const { token } = (await createToken({ name: 'Short', scope: 'admin', expiresInDays: 1 })).json()
      expect((await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)

      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 2 * 24 * 60 * 60 * 1000)

      expect((await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
    })

    it('rejects an unknown token', async () => {
      const res = await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: 'Bearer hbg_not-a-real-token' } })
      expect(res.statusCode).toBe(401)
    })

    it('cannot be exchanged for a session', async () => {
      const { token } = (await createToken({ name: 'Admin', scope: 'admin' })).json()
      const res = await app.inject({ method: 'POST', path: '/auth/refresh', headers: { authorization: `Bearer ${token}` } })
      expect(res.statusCode).toBe(401)
    })

    it('records lastUsedAt, at most once a minute', async () => {
      const { id, token } = (await createToken({ name: 'Admin', scope: 'admin' })).json()
      const lastUsed = async () => (await readJson(tokensPath)).find((x: any) => x.id === id).lastUsedAt

      await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: `Bearer ${token}` } })
      await vi.waitFor(async () => expect(await lastUsed()).not.toBeNull())
      const first = await lastUsed()

      await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: `Bearer ${token}` } })
      await new Promise(r => setTimeout(r, 50))
      expect(await lastUsed()).toBe(first)
    })

    it('ignores a corrupt tokens file rather than accepting anything', async () => {
      await writeJson(tokensPath, { not: 'a list' })
      const res = await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: 'Bearer hbg_anything' } })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('websockets', () => {
    const socket = (token: string) => ({ handshake: { auth: { token } }, nsp: { name: '/status' }, data: {} }) as any

    it('accepts an API token in the handshake', async () => {
      const { token } = (await createToken({ name: 'Admin', scope: 'admin' })).json()
      const user = await verifyWsClient(socket(token), configService, authService)
      expect(user).toMatchObject({ admin: true, apiTokenScope: 'admin' })
    })

    it('treats a read token as a non-admin socket user', async () => {
      const { token } = (await createToken({ name: 'Reader', scope: 'read' })).json()
      const user = await verifyWsClient(socket(token), configService, authService)
      expect(user).toMatchObject({ admin: false, apiTokenScope: 'read' })
    })

    it('rejects a revoked token', async () => {
      const { id, token } = (await createToken({ name: 'Admin', scope: 'admin' })).json()
      await apiTokens.revoke(id)
      await expect(verifyWsClient(socket(token), configService, authService)).rejects.toThrow('Invalid API token')
    })
  })

  describe('mintShortLivedToken', () => {
    it('signs a normal session JWT that expires after five minutes by default', async () => {
      const user = await authService.findByUsername('admin')
      const token = authService.mintShortLivedToken(user)
      const payload = app.get(JwtService).verify(token)

      expect(payload.exp - payload.iat).toBe(300)
      expect(payload).toMatchObject({ username: 'admin', admin: true, instanceId: configService.instanceId })

      const res = await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: `Bearer ${token}` } })
      expect(res.statusCode).toBe(200)
    })

    it('honours a custom lifetime', () => {
      const token = authService.mintShortLivedToken({ username: 'admin', name: 'Administrator', admin: true }, 60)
      const payload = app.get(JwtService).verify(token)
      expect(payload.exp - payload.iat).toBe(60)
    })

    it('is rejected once it expires', async () => {
      const user = await authService.findByUsername('admin')
      const token = authService.mintShortLivedToken(user, 1)

      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 5000)

      const res = await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization: `Bearer ${token}` } })
      expect(res.statusCode).toBe(401)
    })

    it('refuses service and API-token users, and a bad lifetime', () => {
      expect(() => authService.mintShortLivedToken({ username: 'x', service: 'plugin' })).toThrow()
      expect(() => authService.mintShortLivedToken({ username: 'api-token:1', apiTokenId: '1' })).toThrow()
      expect(() => authService.mintShortLivedToken({ username: 'admin' }, 0)).toThrow(RangeError)
    })
  })
})
