import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'
import type { Mock } from 'vitest'

import { resolve } from 'node:path'
import process from 'node:process'

import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy, readFile, remove } from 'fs-extra'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthModule } from '../../src/core/auth/auth.module.js'
import { ConfigService } from '../../src/core/config/config.service.js'
import { DockerModule } from '../../src/modules/platform-tools/docker/docker.module.js'
import { DockerService } from '../../src/modules/platform-tools/docker/docker.service.js'
import { testStoragePath } from '../storage-path.js'

describe('PlatformToolsDocker (e2e)', () => {
  let app: NestFastifyApplication

  let authFilePath: string
  let secretsFilePath: string
  let startupFilePath: string
  let authorization: string
  let restartDockerContainerFn: Mock
  let dockerService: DockerService
  let configService: ConfigService

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')

    authFilePath = resolve(process.env.UIX_STORAGE_PATH, 'auth.json')
    secretsFilePath = resolve(process.env.UIX_STORAGE_PATH, '.uix-secrets')
    startupFilePath = resolve(process.env.UIX_STORAGE_PATH, 'startup.sh')

    // Setup test config
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    // Setup test auth file
    await copy(resolve(__dirname, '../mocks', 'auth.json'), authFilePath)
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), secretsFilePath)

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DockerModule, AuthModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())

    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      skipMissingProperties: true,
    }))

    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    dockerService = app.get(DockerService)
    configService = app.get(ConfigService)
  })

  beforeEach(async () => {
    // Setup mock functions
    restartDockerContainerFn = vi.fn()
    dockerService.restartDockerContainer = restartDockerContainerFn as any

    // The startup script is offered in the Docker image with the terminal on
    configService.runningInDocker = true
    configService.enableTerminalAccess = true

    // Restore startup.sh
    await copy(resolve(__dirname, '../mocks', 'startup.sh'), startupFilePath)
    // Log in once per file - every login runs a 210,000-iteration PBKDF2 hash
    authorization ??= `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: {
        username: 'admin',
        password: 'admin',
      },
    })).json().access_token}`
  })

  it('GET /platform-tools/docker/startup-script', async () => {
    const startupScript = await readFile(startupFilePath, 'utf8')

    const res = await app.inject({
      method: 'GET',
      path: '/platform-tools/docker/startup-script',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().script).toEqual(startupScript)
  })

  it('PUT /platform-tools/docker/startup-script', async () => {
    const startupScript = 'Hello World!'

    const res = await app.inject({
      method: 'PUT',
      path: '/platform-tools/docker/startup-script',
      headers: {
        authorization,
      },
      payload: {
        script: startupScript,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(await readFile(startupFilePath, 'utf8')).toEqual(startupScript)
  })

  it('GET /platform-tools/docker/restart-container', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/platform-tools/docker/restart-container',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(restartDockerContainerFn).toHaveBeenCalled()
  })

  it('GET /platform-tools/docker/startup-script (file missing)', async () => {
    // Remove the startup script
    await remove(startupFilePath)

    const res = await app.inject({
      method: 'GET',
      path: '/platform-tools/docker/startup-script',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(500)
  })

  it('PUT /platform-tools/docker/startup-script (empty script)', async () => {
    const res = await app.inject({
      method: 'PUT',
      path: '/platform-tools/docker/startup-script',
      headers: {
        authorization,
      },
      payload: {
        script: '',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(await readFile(startupFilePath, 'utf8')).toEqual('')
  })

  it('PUT /platform-tools/docker/restart-container (return shape)', async () => {
    // Don't mock restartDockerContainer for this test - test the real return value
    dockerService.restartDockerContainer = vi.fn().mockResolvedValue({ ok: true, command: 'sudo kill 1' })

    const res = await app.inject({
      method: 'PUT',
      path: '/platform-tools/docker/restart-container',
      headers: {
        authorization,
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, command: 'sudo kill 1' })
  })

  describe('startup script access', () => {
    const getScript = () => app.inject({
      method: 'GET',
      path: '/platform-tools/docker/startup-script',
      headers: { authorization },
    })
    const putScript = (payload: unknown) => app.inject({
      method: 'PUT',
      path: '/platform-tools/docker/startup-script',
      headers: { authorization },
      payload: payload as any,
    })

    it('refuses to read or write the script when terminal access is disabled', async () => {
      configService.enableTerminalAccess = false
      const before = await readFile(startupFilePath, 'utf8')

      expect((await getScript()).statusCode).toBe(403)
      expect((await putScript({ script: '#!/bin/sh\nid\n' })).statusCode).toBe(403)
      expect(await readFile(startupFilePath, 'utf8')).toBe(before)
    })

    it('refuses to read or write the script outside the Docker image', async () => {
      configService.runningInDocker = false
      const before = await readFile(startupFilePath, 'utf8')

      expect((await getScript()).statusCode).toBe(403)
      expect((await putScript({ script: '#!/bin/sh\nid\n' })).statusCode).toBe(403)
      expect(await readFile(startupFilePath, 'utf8')).toBe(before)
    })

    it.each([
      { script: 42 },
      { script: { a: 1 } },
      { script: ['x'] },
      {},
    ])('refuses a script that is not a string (%j)', async (payload) => {
      const before = await readFile(startupFilePath, 'utf8')

      const res = await putScript(payload)

      expect(res.statusCode).toBe(400)
      expect(await readFile(startupFilePath, 'utf8')).toBe(before)
    })
  })

  afterAll(async () => {
    await app.close()
  })
})
