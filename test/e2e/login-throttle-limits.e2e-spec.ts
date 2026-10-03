import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { resolve } from 'node:path'
import process from 'node:process'

import { HttpException, ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, remove } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { AuthService } from '../../src/core/auth/auth.service.js'
import { LoginThrottle } from '../../src/core/auth/login-throttle.js'
import { PasswordHasher } from '../../src/core/auth/password-hasher.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

/**
 * Login limits that do not depend on the username: a per-source failure
 * budget, and a cap on password hashes running at once.
 */
describe('Login throttling limits (e2e)', () => {
  let app: NestFastifyApplication
  let authService: AuthService
  let passwordHasher: PasswordHasher
  let loginThrottle: LoginThrottle
  let configService: ConfigService
  let authFilePath: string
  let configPath: string

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    authFilePath = resolve(process.env.UIX_STORAGE_PATH, 'auth.json')
    configPath = process.env.UIX_CONFIG_PATH

    await copy(resolve(__dirname, '../mocks', 'config.json'), configPath)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), authFilePath)
    await remove(resolve(process.env.UIX_STORAGE_PATH, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    authService = app.get(AuthService)
    passwordHasher = app.get(PasswordHasher)
    loginThrottle = app.get(LoginThrottle)
    configService = app.get(ConfigService)
  })

  beforeEach(async () => {
    await copy(resolve(__dirname, '../mocks', 'auth.json'), authFilePath)
    await copy(resolve(__dirname, '../mocks', 'config.json'), configPath)
    configService.setupWizardComplete = true
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  const login = (username: string, password: string, remoteAddress: string) => app.inject({
    method: 'POST',
    path: '/auth/login',
    payload: { username, password },
    remoteAddress,
  })

  describe('login throttling per source address', () => {
    it('refuses a source that rotates usernames once it has failed too often, before hashing', { timeout: 30_000 }, async () => {
      // Unknown usernames still run a full-strength hash (no enumeration by
      // timing); stubbed here so the test only counts the calls
      const hash = vi.spyOn(passwordHasher, 'hash').mockResolvedValue('00')

      for (let i = 0; i < 20; i++) {
        const res = await login(`made-up-${i}`, 'guess', '192.0.2.10')
        expect(res.statusCode).toBe(403)
      }
      expect(hash).toHaveBeenCalledTimes(20)

      // A fresh username from the same address no longer gets a hash
      const refused = await login('made-up-fresh', 'guess', '192.0.2.10')
      expect(refused.statusCode).toBe(429)
      expect(hash).toHaveBeenCalledTimes(20)

      // ...nor does the right password, from that address
      hash.mockRestore()
      expect((await login('admin', 'admin', '192.0.2.10')).statusCode).toBe(429)

      // Another address is unaffected, and signs in fine
      expect((await login('admin', 'admin', '192.0.2.11')).statusCode).toBe(201)
    })

    it('counts an IPv6 /64 as one source', { timeout: 30_000 }, async () => {
      vi.spyOn(passwordHasher, 'hash').mockResolvedValue('00')
      for (let i = 0; i < 20; i++) {
        await login(`v6-user-${i}`, 'guess', `2001:db8:aa:bb::${(i + 1).toString(16)}`)
      }
      expect((await login('v6-user-x', 'guess', '2001:db8:aa:bb:ffff::1')).statusCode).toBe(429)
      expect((await login('v6-user-x', 'guess', '2001:db8:aa:cc::1')).statusCode).toBe(403)
    })

    it('lets a source that signed in as a user before keep signing in as that user', { timeout: 30_000 }, async () => {
      expect((await login('admin', 'admin', '192.0.2.20')).statusCode).toBe(201)

      vi.spyOn(passwordHasher, 'hash').mockResolvedValue('00')
      for (let i = 0; i < 20; i++) {
        await login(`other-${i}`, 'guess', '192.0.2.20')
      }
      expect((await login('someone-else', 'guess', '192.0.2.20')).statusCode).toBe(429)
      vi.mocked(passwordHasher.hash).mockRestore()

      expect((await login('admin', 'admin', '192.0.2.20')).statusCode).toBe(201)
    })
  })

  describe('password hash concurrency', () => {
    it('refuses an attempt with 429 while two others are hashing, without counting it as a failure', async () => {
      const pending: Array<() => void> = []
      const held = () => new Promise<string>((res) => {
        pending.push(() => res('00'))
      })
      // The first two hashes are held until released; later ones finish at once
      const hash = vi.spyOn(passwordHasher, 'hash')
        .mockResolvedValue('00')
        .mockImplementationOnce(held)
        .mockImplementationOnce(held)

      const first = authService.authenticate('busy-1', 'x', undefined, '198.51.100.1').catch(e => e)
      const second = authService.authenticate('busy-2', 'x', undefined, '198.51.100.2').catch(e => e)
      const third = await authService.authenticate('busy-3', 'x', undefined, '198.51.100.3').catch(e => e)

      expect(third).toBeInstanceOf(HttpException)
      expect(third.getStatus()).toBe(429)
      expect((loginThrottle as any).sourceFailureCache.get('198.51.100.3')).toBeUndefined()

      // Let the two in flight finish (as failures, for unknown users)
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      pending.forEach(release => release())
      expect((await first).getStatus()).toBe(403)
      expect((await second).getStatus()).toBe(403)

      // The slots are free again
      const fourth = await authService.authenticate('busy-4', 'x', undefined, '198.51.100.4').catch(e => e)
      expect(fourth.getStatus()).toBe(403)
      expect(hash).toHaveBeenCalledTimes(3)
    })
  })
})
