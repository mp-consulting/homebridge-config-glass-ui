import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { resolve } from 'node:path'
import process from 'node:process'

import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy } from 'fs-extra'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { ConfigService } from '../../src/core/config/config.service.js'
import { LogModule } from '../../src/modules/log/log.module.js'
import { LogService } from '../../src/modules/log/log.service.js'
import { testStoragePath } from '../storage-path.js'

// Pretend to be Windows for the log service only while building the command
const fake = vi.hoisted(() => ({ platform: undefined as string | undefined }))
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>()
  return { ...os, platform: () => fake.platform ?? os.platform() }
})

describe('LogService Windows log path', () => {
  let app: NestFastifyApplication
  let configService: ConfigService
  let logService: LogService

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    const moduleFixture = await Test.createTestingModule({ imports: [LogModule] }).compile()
    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()

    configService = app.get(ConfigService)
    logService = app.get(LogService)
  })

  afterAll(async () => {
    fake.platform = undefined
    await app.close()
  })

  it('passes the log path to PowerShell out of band, so quotes in it cannot inject code', () => {
    const path = 'C:\\logs\\x\'; Start-Process calc; \'.log'
    fake.platform = 'win32'
    configService.ui.log = { method: 'file', path }
    logService.setLogMethod()
    fake.platform = undefined

    const command: string[] = (logService as any).command
    expect(command).toEqual(['powershell.exe', '-NoProfile', '-Command', 'Get-Content -LiteralPath $env:UIX_LOG_PATH -Wait -Tail 200'])
    expect(command.join(' ')).not.toContain('calc')
    expect((logService as any).commandEnv).toEqual({ UIX_LOG_PATH: path })
  })
})
