import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, readJson, remove, writeJson } from 'fs-extra'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuditModule } from '../../src/core/audit/audit.module.js'
import { auditActor, AuditService, redactDetails } from '../../src/core/audit/audit.service.js'
import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ChildBridgesService } from '../../src/modules/child-bridges/child-bridges.service.js'
import { ServerModule } from '../../src/modules/server/server.module.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

describe('Audit log (e2e)', () => {
  let app: NestFastifyApplication
  let audit: AuditService
  let adminAuth: string
  let userAuth: string

  const login = async (username: string) => `bearer ${(await app.inject({ method: 'POST', path: '/auth/login', payload: { username, password: 'admin' } })).json().access_token}`

  /** Wait for the queued writes, then read the log. */
  const entries = async (query: Record<string, string> = {}) => {
    const res = await app.inject({ method: 'GET', path: '/audit', headers: { authorization: adminAuth }, query })
    expect(res.statusCode).toBe(200)
    return res.json()
  }

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')

    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    const [admin] = await readJson(resolve(__dirname, '../mocks', 'auth.json'))
    await writeJson(resolve(testStoragePath, 'auth.json'), [admin, { ...admin, id: 2, username: 'user', name: 'User', admin: false }])
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuditModule, AuthModule, ServerModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
    audit = app.get(AuditService)
  })

  beforeEach(async () => {
    adminAuth ??= await login('admin')
    userAuth ??= await login('user')
    await audit.record({ action: 'noop', actor: { username: 'x', via: 'system' }, ok: true })
    await remove(audit.dir)
    audit.maxBytes = 2 * 1024 * 1024
  })

  afterAll(async () => {
    await app.close()
  })

  describe('auditService', () => {
    it('appends JSON lines, owner-only, and lists them newest first with pages', async () => {
      for (let i = 0; i < 5; i++) {
        await audit.record({ action: i % 2 ? 'plugin.install' : 'config.save', actor: { username: 'admin', via: 'session' }, ok: true, target: `t${i}` })
      }
      const text = await readFile(audit.file, 'utf8')
      expect(text.trim().split('\n')).toHaveLength(5)
      const mode = (await stat(audit.file)).mode & 0o777
      // Windows has no owner-only mode bits
      expect(process.platform === 'win32' || mode === 0o600).toBe(true)

      const first = await audit.list({ page: 1, limit: 2 })
      expect(first.total).toBe(5)
      expect(first.entries.map(e => e.target)).toEqual(['t4', 't3'])
      expect((await audit.list({ page: 3, limit: 2 })).entries.map(e => e.target)).toEqual(['t0'])
      expect((await audit.list({ action: 'plugin' })).total).toBe(2)
      expect((await audit.list({ action: 'plug' })).total).toBe(0)
      expect((await audit.list({ username: 'ADMIN' })).total).toBe(5)
      expect((await audit.list({ username: 'nobody' })).total).toBe(0)
    })

    it('redacts secrets in details and errors', async () => {
      await audit.record({
        action: 'x',
        actor: { username: 'admin', via: 'session' },
        ok: false,
        details: { password: 'hunter2', nested: { apiKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' }, keep: 'visible' },
        error: 'failed with token=abcdef0123456789abcdef',
      })
      const text = await readFile(audit.file, 'utf8')
      expect(text).not.toContain('hunter2')
      expect(text).not.toContain('sk-ant-api03')
      expect(text).toContain('visible')
      expect(redactDetails({})).toBeUndefined()
      expect(redactDetails({ big: 'x'.repeat(10_000) })).toMatchObject({ truncated: true })
    })

    it('rotates by size and keeps a bounded number of files', async () => {
      audit.maxBytes = 400
      for (let i = 0; i < 40; i++) {
        await audit.record({ action: 'config.save', actor: { username: 'admin', via: 'session' }, ok: true, target: `n${i}` })
      }
      const files = (await readdir(audit.dir)).sort()
      expect(files).toEqual(['audit.1.jsonl', 'audit.2.jsonl', 'audit.3.jsonl', 'audit.4.jsonl', 'audit.jsonl'])
      for (const file of files) {
        expect((await stat(resolve(audit.dir, file))).size).toBeLessThanOrEqual(400)
      }
      const { entries: all, total } = await audit.list({ limit: 500 })
      expect(total).toBeLessThan(40)
      expect(all[0].target).toBe('n39')
      // Still newest first across files
      const numbers = all.map(e => Number(e.target!.slice(1)))
      expect(numbers).toEqual([...numbers].sort((a, b) => b - a))
    })

    it('skips a torn line', async () => {
      await audit.record({ action: 'a', actor: { username: 'admin', via: 'session' }, ok: true })
      await writeFile(audit.file, `${await readFile(audit.file, 'utf8')}{"action":"tor`)
      expect((await audit.list()).total).toBe(1)
    })

    it('names how the actor signed in', () => {
      expect(auditActor(undefined)).toEqual({ username: '(anonymous)', via: 'system' })
      expect(auditActor({ username: 'admin', admin: true })).toEqual({ username: 'admin', via: 'session', admin: true })
      expect(auditActor({ username: 'admin', admin: true, apiTokenId: 'abc' })).toMatchObject({ via: 'api-token', tokenId: 'abc' })
      expect(auditActor({ username: 'x', service: 'homebridge-ai-kit' })).toMatchObject({ username: 'service:homebridge-ai-kit', via: 'service' })
    })
  })

  describe('http', () => {
    it('is for administrators only, and validates the query', async () => {
      expect((await app.inject({ method: 'GET', path: '/audit' })).statusCode).toBe(401)
      expect((await app.inject({ method: 'GET', path: '/audit', headers: { authorization: userAuth } })).statusCode).toBe(403)
      expect((await app.inject({ method: 'GET', path: '/audit', headers: { authorization: adminAuth }, query: { limit: '0' } })).statusCode).toBe(400)
      expect((await app.inject({ method: 'GET', path: '/audit', headers: { authorization: adminAuth }, query: { action: '../x' } })).statusCode).toBe(400)
    })

    it('records API token creation and revocation, never the token', async () => {
      const created = await app.inject({ method: 'POST', path: '/auth/tokens', headers: { authorization: adminAuth }, payload: { name: 'Script', scope: 'admin' } })
      expect(created.statusCode).toBe(201)
      const { id, token } = created.json()
      expect((await app.inject({ method: 'DELETE', path: `/auth/tokens/${id}`, headers: { authorization: adminAuth } })).statusCode).toBe(204)

      const { entries: list } = await entries({ action: 'api-token' })
      expect(list.map((e: { action: string }) => e.action)).toEqual(['api-token.revoke', 'api-token.create'])
      expect(list[1]).toMatchObject({ actor: { username: 'admin', via: 'session' }, ok: true, target: id, details: { name: 'Script', scope: 'admin', method: 'POST' } })
      expect(list[0]).toMatchObject({ target: id, ok: true })
      expect(JSON.stringify(list)).not.toContain(token)
    })

    it('records the writes made with an API token, and the actions they run', async () => {
      const { token, id } = (await app.inject({ method: 'POST', path: '/auth/tokens', headers: { authorization: adminAuth }, payload: { name: 'Script', scope: 'admin' } })).json()
      const restart = vi.spyOn(app.get(ChildBridgesService), 'restartChildBridge').mockReturnValue(undefined as never)

      // An audited action: the entry names the token
      expect((await app.inject({ method: 'PUT', path: '/server/restart/0E:AA:BB:CC:DD:EE', headers: { authorization: `bearer ${token}` } })).statusCode).toBe(200)
      expect(restart).toHaveBeenCalled()
      // A write with no action of its own
      await app.inject({ method: 'POST', path: '/auth/refresh', headers: { authorization: `bearer ${token}` }, payload: {} })
      // Reads are not recorded
      await app.inject({ method: 'GET', path: '/auth/tokens', headers: { authorization: `bearer ${token}` } })

      const { entries: list } = await entries()
      const restartEntry = list.find((e: { action: string }) => e.action === 'child-bridge.restart')
      expect(restartEntry).toMatchObject({ target: '0E:AA:BB:CC:DD:EE', ok: true, actor: { via: 'api-token', tokenId: id } })
      const request = list.find((e: { action: string }) => e.action === 'api-token.request')
      expect(request).toMatchObject({ target: 'POST /auth/refresh', actor: { via: 'api-token', tokenId: id } })
      expect(list.filter((e: { action: string }) => e.action === 'api-token.request')).toHaveLength(1)
    })

    it('records a failed action with its status', async () => {
      vi.spyOn(app.get(ChildBridgesService), 'restartChildBridge').mockImplementation(() => {
        throw new Error('no such bridge')
      })
      expect((await app.inject({ method: 'PUT', path: '/server/restart/0E:00:00:00:00:00', headers: { authorization: adminAuth } })).statusCode).toBe(500)
      const { entries: list } = await entries({ action: 'child-bridge' })
      expect(list[0]).toMatchObject({ action: 'child-bridge.restart', ok: false, error: 'no such bridge' })
    })
  })
})
