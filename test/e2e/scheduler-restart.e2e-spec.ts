import type { TestingModule } from '@nestjs/testing'

import type { HomebridgeConfig } from '../../src/core/config/config.interfaces.js'

import { resolve } from 'node:path'
import process from 'node:process'

import { Test } from '@nestjs/testing'
import { copy } from 'fs-extra'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigService } from '../../src/core/config/config.service.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../src/core/logger/logger.service.js'
import { SchedulerModule } from '../../src/core/scheduler/scheduler.module.js'
import { SchedulerService } from '../../src/core/scheduler/scheduler.service.js'
import { testStoragePath } from '../storage-path.js'

describe('SchedulerService.refreshRestartSchedules (e2e)', () => {
  let moduleRef: TestingModule
  let scheduler: SchedulerService
  let configService: ConfigService
  let ipc: HomebridgeIpcService
  let logger: Logger

  const childUsername = '0E:AA:BB:CC:DD:EE'
  const childJob = 'restart-child-0EAABBCCDDEE'

  const configWithChild = (username = childUsername): HomebridgeConfig => ({
    bridge: configService.homebridgeConfig.bridge,
    platforms: [{ platform: 'ExamplePlugin', name: 'Example', _bridge: { username, port: 45678 } }],
    accessories: [],
  })

  const restartJobs = () => Object.keys(scheduler.scheduledJobs)
    .filter(name => name.startsWith('restart-'))
    .sort()

  beforeAll(async () => {
    process.env.UIX_BASE_PATH = resolve(__dirname, '../../')
    process.env.UIX_STORAGE_PATH = testStoragePath
    process.env.UIX_CONFIG_PATH = resolve(testStoragePath, 'config.json')
    await copy(resolve(__dirname, '../mocks', 'config.json'), process.env.UIX_CONFIG_PATH)

    moduleRef = await Test.createTestingModule({ imports: [SchedulerModule] }).compile()
    await moduleRef.init()

    scheduler = moduleRef.get(SchedulerService)
    configService = moduleRef.get(ConfigService)
    ipc = moduleRef.get(HomebridgeIpcService)
    logger = moduleRef.get(Logger)
  })

  beforeEach(() => {
    delete configService.ui.scheduledRestartCron
    delete configService.ui.bridges
    vi.spyOn(ipc, 'restartHomebridge').mockReturnValue(true)
    vi.spyOn(ipc, 'sendMessage').mockImplementation(() => undefined)
  })

  afterEach(() => {
    for (const name of restartJobs()) {
      scheduler.cancelJob(name)
    }
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await moduleRef.close()
  })

  it('schedules nothing when no cron is configured', async () => {
    await scheduler.refreshRestartSchedules(configWithChild())

    expect(restartJobs()).toEqual([])
  })

  it('ignores a whitespace-only cron', async () => {
    configService.ui.scheduledRestartCron = '   '
    configService.ui.bridges = [{ username: childUsername, scheduledRestartCron: '  ' }]

    await scheduler.refreshRestartSchedules(configWithChild())

    expect(restartJobs()).toEqual([])
  })

  it('an invalid cron does not throw and schedules nothing that will fire', async () => {
    configService.ui.scheduledRestartCron = 'not a cron'
    configService.ui.bridges = [{ username: childUsername, scheduledRestartCron: '99 99 99 99 99' }]

    await expect(scheduler.refreshRestartSchedules(configWithChild())).resolves.toBeUndefined()

    // node-schedule leaves the named job registered with no invocation
    for (const name of restartJobs()) {
      expect(scheduler.scheduledJobs[name].nextInvocation()).toBeNull()
    }
  })

  // node-schedule returns null for an invalid cron rather than throwing
  it('warns when a cron expression is invalid, and leaves no job behind', async () => {
    const warn = vi.spyOn(logger, 'warn')
    configService.ui.scheduledRestartCron = 'not a cron'

    await scheduler.refreshRestartSchedules(configWithChild())

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a cron'))
    expect(scheduler.scheduledJobs['restart-homebridge']).toBeUndefined()
  })

  it('cancels the previous jobs before rescheduling', async () => {
    configService.ui.scheduledRestartCron = '0 3 * * *'
    configService.ui.bridges = [{ username: childUsername, scheduledRestartCron: '0 4 * * *' }]
    await scheduler.refreshRestartSchedules(configWithChild())
    const firstMain = scheduler.scheduledJobs['restart-homebridge']
    const firstChild = scheduler.scheduledJobs[childJob]
    expect(firstMain).toBeDefined()
    expect(firstChild).toBeDefined()

    // The main cron removed, the child one changed
    delete configService.ui.scheduledRestartCron
    configService.ui.bridges = [{ username: childUsername, scheduledRestartCron: '30 5 * * *' }]
    await scheduler.refreshRestartSchedules(configWithChild())

    expect(restartJobs()).toEqual([childJob])
    expect(firstMain.nextInvocation()).toBeNull()
    expect(firstChild.nextInvocation()).toBeNull()
    const next = scheduler.scheduledJobs[childJob].nextInvocation()
    expect([next.getHours(), next.getMinutes()]).toEqual([5, 30])
  })

  it('leaves jobs that are not restart jobs alone', async () => {
    const other = scheduler.scheduleJob('instance-backup-test', '0 0 1 1 *', () => {})
    try {
      configService.ui.scheduledRestartCron = '0 3 * * *'
      await scheduler.refreshRestartSchedules(configWithChild())
      await scheduler.refreshRestartSchedules(configWithChild())

      expect(scheduler.scheduledJobs['instance-backup-test']).toBe(other)
    } finally {
      other.cancel()
    }
  })

  it('matches child bridges by username case-insensitively, in platforms and accessories', async () => {
    configService.ui.bridges = [
      { username: '0e:aa:bb:cc:dd:ee', scheduledRestartCron: '0 4 * * *' },
      { username: '0E:11:22:33:44:55', scheduledRestartCron: '0 5 * * *' },
      // a bridge with a cron that no config block uses
      { username: '0E:99:99:99:99:99', scheduledRestartCron: '0 6 * * *' },
    ]
    const config = configWithChild()
    config.accessories = [{ accessory: 'Example', name: 'Acc', _bridge: { username: '0e:11:22:33:44:55', port: 45679 } } as any]

    await scheduler.refreshRestartSchedules(config)

    expect(restartJobs()).toEqual(['restart-child-0E1122334455', childJob])
  })

  it('uses the current config when none is passed', async () => {
    configService.ui.bridges = [{ username: childUsername, scheduledRestartCron: '0 4 * * *' }]
    const original = configService.homebridgeConfig
    configService.homebridgeConfig = configWithChild()
    try {
      await scheduler.refreshRestartSchedules()
    } finally {
      configService.homebridgeConfig = original
    }

    expect(restartJobs()).toEqual([childJob])
  })

  it('restarts Homebridge when the main cron fires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 2, 59, 0))
    configService.ui.scheduledRestartCron = '0 3 * * *'

    await scheduler.refreshRestartSchedules(configWithChild())
    expect(ipc.restartHomebridge).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(61_000)

    expect(ipc.restartHomebridge).toHaveBeenCalledTimes(1)
    expect(ipc.sendMessage).not.toHaveBeenCalled()
  })

  it('restarts only the child bridge when its cron fires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 3, 59, 0))
    configService.ui.bridges = [{ username: childUsername, scheduledRestartCron: '0 4 * * *' }]

    await scheduler.refreshRestartSchedules(configWithChild())
    await vi.advanceTimersByTimeAsync(61_000)

    expect(ipc.sendMessage).toHaveBeenCalledWith('restartChildBridge', childUsername)
    expect(ipc.restartHomebridge).not.toHaveBeenCalled()
  })

  it('a cancelled job does not fire', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 2, 59, 0))
    configService.ui.scheduledRestartCron = '0 3 * * *'
    await scheduler.refreshRestartSchedules(configWithChild())

    delete configService.ui.scheduledRestartCron
    await scheduler.refreshRestartSchedules(configWithChild())
    await vi.advanceTimersByTimeAsync(61_000)

    expect(ipc.restartHomebridge).not.toHaveBeenCalled()
  })

  it('logs and survives a restart that throws', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 1, 2, 59, 0))
    vi.mocked(ipc.restartHomebridge).mockImplementation(() => {
      throw new Error('ipc down')
    })
    const warn = vi.spyOn(logger, 'warn')
    configService.ui.scheduledRestartCron = '0 3 * * *'

    await scheduler.refreshRestartSchedules(configWithChild())
    await vi.advanceTimersByTimeAsync(61_000)

    expect(warn).toHaveBeenCalledWith('Scheduled restart (main) failed: ipc down')
  })
})
