import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import type { TestingModule } from '@nestjs/testing'
import type { EventEmitter } from 'node:events'

import { resolve } from 'node:path'
import process from 'node:process'

import { HttpService } from '@nestjs/axios'
import { ValidationPipe } from '@nestjs/common'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiTokenService } from '../../src/core/auth/api-token.service.js'
import { AuthModule } from '../../src/core/auth/auth.module.js'
import { PluginInstallerService } from '../../src/modules/plugins/plugin-installer.service.js'
import { PLUGIN_JOB_OUTPUT_LIMIT, PLUGIN_JOB_TTL_MS, PluginJobsService, toPlainOutput } from '../../src/modules/plugins/plugin-jobs.service.js'
import { PluginsModule } from '../../src/modules/plugins/plugins.module.js'
import { UiUpdateService } from '../../src/modules/plugins/ui-update.service.js'
import { testStoragePath } from '../storage-path.js'

describe('Plugin jobs (e2e)', () => {
  let app: NestFastifyApplication
  let authorization: string
  let installer: PluginInstallerService
  let uiUpdate: UiUpdateService
  let jobs: PluginJobsService

  async function startJob(action: string, payload: Record<string, unknown>, auth = authorization) {
    return app.inject({ method: 'POST', path: `/plugins/${action}`, headers: { authorization: auth }, payload })
  }

  async function settledJob(jobId: string) {
    let job: any
    await vi.waitFor(async () => {
      job = (await app.inject({ method: 'GET', path: `/plugins/jobs/${jobId}`, headers: { authorization } })).json()
      expect(job.status).not.toBe('running')
    })
    return job
  }

  /** Stand in for npm: emit some coloured output, then resolve or reject */
  function fakeNpm(outcome: 'ok' | 'fail', output = '\x1B[32madded 1 package\x1B[0m\r\n') {
    return vi.spyOn(installer, 'managePlugin').mockImplementation(async (_action, _dto, client: EventEmitter) => {
      client.emit('stdout', output)
      if (outcome === 'fail') {
        throw new Error('Operation failed with code 1.')
      }
      return true
    })
  }

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(process.env.UIX_STORAGE_PATH, 'config.json')
    process.env.UIX_CUSTOM_PLUGIN_PATH = resolve(process.env.UIX_STORAGE_PATH, 'plugins/node_modules')

    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))
    await copy(resolve(__dirname, '../mocks', '.uix-secrets'), resolve(testStoragePath, '.uix-secrets'))

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PluginsModule, AuthModule],
    }).overrideProvider(HttpService).useValue(new HttpService()).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      skipMissingProperties: true,
    }))
    await app.init()
    await app.getHttpAdapter().getInstance().ready()

    installer = app.get(PluginInstallerService)
    uiUpdate = app.get(UiUpdateService)
    jobs = app.get(PluginJobsService)
  })

  beforeEach(async () => {
    authorization ??= `bearer ${(await app.inject({
      method: 'POST',
      path: '/auth/login',
      payload: { username: 'admin', password: 'admin' },
    })).json().access_token}`
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await app.close()
  })

  it('POST /plugins/install answers 202 with a job, then reports its output', async () => {
    const manage = fakeNpm('ok')

    const res = await startJob('install', { name: 'homebridge-mock-plugin', version: '1.2.3' })

    expect(res.statusCode).toBe(202)
    const { jobId } = res.json()
    expect(jobId).toEqual(expect.any(String))

    const job = await settledJob(jobId)
    expect(job).toMatchObject({
      id: jobId,
      action: 'install',
      name: 'homebridge-mock-plugin',
      version: '1.2.3',
      status: 'succeeded',
      startedAt: expect.any(String),
      finishedAt: expect.any(String),
    })
    // Colour codes stripped, line endings normalised
    expect(job.output).toBe('added 1 package\n')
    expect(manage).toHaveBeenCalledWith('install', { name: 'homebridge-mock-plugin', version: '1.2.3' }, expect.anything())
  })

  it('POST /plugins/update runs an install of the requested version', async () => {
    const manage = fakeNpm('ok')

    const { jobId } = (await startJob('update', { name: 'homebridge-mock-plugin' })).json()

    expect((await settledJob(jobId)).status).toBe('succeeded')
    expect(manage).toHaveBeenCalledWith('install', { name: 'homebridge-mock-plugin', version: undefined }, expect.anything())
  })

  it('POST /plugins/uninstall runs an uninstall', async () => {
    const manage = fakeNpm('ok')

    const { jobId } = (await startJob('uninstall', { name: 'homebridge-mock-plugin', version: '1.0.0' })).json()

    const job = await settledJob(jobId)
    expect(job).toMatchObject({ action: 'uninstall', status: 'succeeded' })
    expect(manage).toHaveBeenCalledWith('uninstall', { name: 'homebridge-mock-plugin', version: undefined }, expect.anything())
  })

  it('reports a failed job with its error and output', async () => {
    fakeNpm('fail', 'npm ERR! 404 Not Found\r\n')

    const { jobId } = (await startJob('install', { name: 'homebridge-mock-plugin' })).json()

    const job = await settledJob(jobId)
    expect(job.status).toBe('failed')
    expect(job.error).toBe('Operation failed with code 1.')
    expect(job.output).toContain('npm ERR! 404 Not Found\n')
    expect(job.output).toContain('Operation failed with code 1.')
  })

  it('restarts the UI after updating the UI itself', async () => {
    fakeNpm('ok')
    const restart = vi.spyOn(uiUpdate, 'scheduleUiRestart').mockImplementation(() => undefined)

    const { jobId } = (await startJob('update', { name: '@mp-consulting/homebridge-config-glass-ui' })).json()

    expect((await settledJob(jobId)).status).toBe('succeeded')
    expect(restart).toHaveBeenCalledOnce()
  })

  it('rejects an invalid name or version with 400 and starts nothing', async () => {
    const manage = fakeNpm('ok')

    expect((await startJob('install', { name: 'not-a-plugin' })).statusCode).toBe(400)
    expect((await startJob('install', { name: 'homebridge-mock-plugin', version: '--evil' })).statusCode).toBe(400)
    expect((await startJob('install', { name: 'homebridge-mock-plugin', version: 'https://x/y.tgz' })).statusCode).toBe(400)
    expect((await startJob('install', {})).statusCode).toBe(400)
    expect(manage).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown job', async () => {
    const res = await app.inject({ method: 'GET', path: '/plugins/jobs/unknown', headers: { authorization } })
    expect(res.statusCode).toBe(404)
  })

  it('is admin only', async () => {
    const manage = fakeNpm('ok')
    const { token } = await app.get(ApiTokenService).create({ name: 'Reader', scope: 'read' })

    expect((await startJob('install', { name: 'homebridge-mock-plugin' }, `Bearer ${token}`)).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', path: '/plugins/jobs/x', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403)
    expect((await startJob('install', { name: 'homebridge-mock-plugin' }, '')).statusCode).toBe(401)
    expect(manage).not.toHaveBeenCalled()
  })

  it('keeps only the most recent output', async () => {
    fakeNpm('ok', `${'a'.repeat(PLUGIN_JOB_OUTPUT_LIMIT)}tail`)

    const { jobId } = (await startJob('install', { name: 'homebridge-mock-plugin' })).json()

    const job = await settledJob(jobId)
    expect(job.output).toHaveLength(PLUGIN_JOB_OUTPUT_LIMIT)
    expect(job.output.endsWith('tail')).toBe(true)
  })

  it('forgets a finished job after its ttl', async () => {
    vi.useFakeTimers()
    fakeNpm('ok')

    const job = jobs.start('install', { name: 'homebridge-mock-plugin' })
    await vi.advanceTimersByTimeAsync(0)
    expect(jobs.get(job.id).status).toBe('succeeded')

    await vi.advanceTimersByTimeAsync(PLUGIN_JOB_TTL_MS)
    expect(() => jobs.get(job.id)).toThrow('Plugin job not found.')
  })

  it('strips terminal escapes from output', () => {
    expect(toPlainOutput('\x1B[33mwarn\x1B[0m\n\rnext\r\n')).toBe('warn\nnext\n')
    expect(toPlainOutput('\x1B]0;title\x07done')).toBe('done')
  })
})
