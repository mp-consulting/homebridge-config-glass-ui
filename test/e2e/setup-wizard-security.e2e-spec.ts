import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'

import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import process from 'node:process'

import { Controller, Get, Post, Put, UseGuards, ValidationPipe } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, remove, writeFile, writeJson } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { AuthService } from '../../src/core/auth/auth.service.js'
import { AdminGuard } from '../../src/core/auth/guards/admin.guard.js'
import { verifyWsClient } from '../../src/core/auth/guards/ws-auth.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

/**
 * Stand-ins for the admin routes the setup-wizard token may and may not reach,
 * guarded exactly like the real ones (BackupController, UsersController).
 */
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller()
class FakeAdminController {
  @Post('/backup/restore')
  restore() {
    return { ok: 'restore' }
  }

  @Put('/backup/restart')
  restart() {
    return { ok: 'restart' }
  }

  @Get('/users')
  users() {
    return { ok: 'users' }
  }

  @Post('/backup/restore/trigger')
  trigger() {
    return { ok: 'trigger' }
  }
}

describe('Setup wizard security (e2e)', () => {
  let app: NestFastifyApplication
  let authService: AuthService
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
      controllers: [FakeAdminController],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, skipMissingProperties: true }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    authService = app.get(AuthService)
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

  describe('auth.json that cannot be read', () => {
    it('keeps the setup wizard closed when auth.json is corrupt', async () => {
      const error = vi.spyOn((authService as any).logger, 'error')
      await writeFile(authFilePath, '[{"username": "admin", "admin": tru')
      await authService.checkAuthFile()
      expect(configService.setupWizardComplete).toBe(true)
      expect(error).toHaveBeenCalledWith(expect.stringContaining('could not be read'))

      // ...so the wizard's token cannot be minted either
      await expect(authService.generateSetupWizardToken()).rejects.toThrow()
    })

    it('keeps the setup wizard closed when auth.json is not a list of users', async () => {
      await writeJson(authFilePath, { admin: true })
      await authService.checkAuthFile()
      expect(configService.setupWizardComplete).toBe(true)
    })

    it('opens the setup wizard only when auth.json does not exist', async () => {
      await remove(authFilePath)
      await authService.checkAuthFile()
      expect(configService.setupWizardComplete).toBe(false)
    })
  })

  describe('setup-wizard token', () => {
    async function wizardToken() {
      configService.setupWizardComplete = false
      return (await authService.generateSetupWizardToken()).access_token
    }

    afterEach(() => {
      configService.setupWizardComplete = true
    })

    it('is accepted on the routes the wizard restore step calls', async () => {
      const authorization = `bearer ${await wizardToken()}`
      expect((await app.inject({ method: 'POST', path: '/backup/restore', headers: { authorization } })).statusCode).toBe(201)
      expect((await app.inject({ method: 'PUT', path: '/backup/restart', headers: { authorization } })).statusCode).toBe(200)
    })

    it('is rejected on every other admin route, and once the wizard is complete', async () => {
      const authorization = `bearer ${await wizardToken()}`
      expect((await app.inject({ method: 'GET', path: '/users', headers: { authorization } })).statusCode).toBe(401)
      expect((await app.inject({ method: 'POST', path: '/backup/restore/trigger', headers: { authorization } })).statusCode).toBe(401)
      expect((await app.inject({ method: 'GET', path: '/auth/check', headers: { authorization } })).statusCode).toBe(401)

      configService.setupWizardComplete = true
      expect((await app.inject({ method: 'POST', path: '/backup/restore', headers: { authorization } })).statusCode).toBe(401)
    })

    it('is accepted on the backup socket namespace only', async () => {
      const token = await wizardToken()
      const socket = (nsp: string) => Object.assign(new EventEmitter(), { handshake: { auth: { token } }, nsp: { name: nsp }, data: {} }) as any

      await expect(verifyWsClient(socket('/backup'), configService, authService)).resolves.toMatchObject({ username: 'setup-wizard' })
      await expect(verifyWsClient(socket('/status'), configService, authService)).rejects.toThrow()
      await expect(verifyWsClient(socket('/platform-tools/terminal'), configService, authService)).rejects.toThrow()
    })
  })
})
