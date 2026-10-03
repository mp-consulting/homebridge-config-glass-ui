import type { NestFastifyApplication } from '@nestjs/platform-fastify'

import { exec, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import process from 'node:process'

import { FastifyAdapter } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { copy } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigService } from '../../src/core/config/config.service.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { ServerModule } from '../../src/modules/server/server.module.js'
import { ServerService } from '../../src/modules/server/server.service.js'
import { testStoragePath } from '../storage-path.js'

import '../../src/global-defaults.js'

// Wrap spawn/exec so the restart paths can be observed without running anything
vi.mock('node:child_process', async (importOriginal) => {
  const cp = await importOriginal<typeof import('node:child_process')>()
  return {
    ...cp,
    spawn: vi.fn((...args: Parameters<typeof cp.spawn>) => cp.spawn(...args)),
    exec: vi.fn((...args: Parameters<typeof cp.exec>) => (cp.exec as any)(...args)),
  }
})

describe('ServerService.restartServer', () => {
  let app: NestFastifyApplication
  let serverService: ServerService
  let configService: ConfigService
  let ipcService: HomebridgeIpcService
  let kill: ReturnType<typeof vi.spyOn>
  let originalRestart: string | undefined
  let originalDocker: boolean

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)
    await copy(resolve(__dirname, '../mocks', 'auth.json'), resolve(testStoragePath, 'auth.json'))

    const moduleFixture = await Test.createTestingModule({ imports: [ServerModule] }).compile()
    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await app.init()

    serverService = app.get(ServerService)
    configService = app.get(ConfigService)
    ipcService = app.get(HomebridgeIpcService)
    originalRestart = configService.ui.restart
    originalDocker = configService.runningInDocker
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(spawn).mockClear()
    vi.mocked(exec).mockClear()
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    configService.runningInDocker = false
    vi.spyOn(configService, 'uiRestartRequired').mockResolvedValue(true)
    vi.spyOn(serverService as any, 'nodeVersionChanged').mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    configService.ui.restart = originalRestart
    configService.runningInDocker = originalDocker
  })

  afterAll(async () => {
    await app.close()
  })

  it('spawns an allowlisted restart command as argv without a shell', async () => {
    const child = new EventEmitter()
    vi.mocked(spawn).mockReturnValueOnce(child as any)
    configService.ui.restart = 'sudo -n systemctl restart homebridge'

    const res = await serverService.restartServer()
    expect(res).toEqual({ ok: true, command: 'sudo -n systemctl restart homebridge', restartingUI: true })
    expect(spawn).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)

    expect(spawn).toHaveBeenCalledWith('sudo', ['-n', 'systemctl', 'restart', 'homebridge'], { stdio: 'ignore', shell: false })
    expect(exec).not.toHaveBeenCalled()
    expect(kill).not.toHaveBeenCalled()
  })

  it('falls back to SIGTERM for a command off the allowlist', async () => {
    configService.ui.restart = 'foo; rm -rf /'
    const error = vi.spyOn((serverService as any).logger, 'error')

    await serverService.restartServer()
    await vi.advanceTimersByTimeAsync(500)

    expect(spawn).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not on the allowlist'))
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
  })

  it('sends SIGTERM when no restart command is set', async () => {
    configService.ui.restart = undefined

    await serverService.restartServer()
    await vi.advanceTimersByTimeAsync(500)

    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('only restarts Homebridge when the UI does not need a restart', async () => {
    vi.mocked(configService.uiRestartRequired).mockResolvedValue(false)
    const restartHomebridge = vi.spyOn(ipcService, 'restartHomebridge').mockImplementation(() => undefined)
    configService.ui.restart = 'sudo systemctl restart homebridge'

    const res = await serverService.restartServer()
    await vi.advanceTimersByTimeAsync(1000)

    expect(res).toEqual({ ok: true, command: 'SIGTERM', restartingUI: false })
    expect(restartHomebridge).toHaveBeenCalledTimes(1)
    expect(kill).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
  })
})
