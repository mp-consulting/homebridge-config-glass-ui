import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { HttpService } from '@nestjs/axios'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfigService } from '../../src/core/config/config.service.js'
import { HomebridgeIpcService } from '../../src/core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../src/core/logger/logger.service.js'
import { PluginsService } from '../../src/modules/plugins/plugins.service.js'
import { ServerService } from '../../src/modules/server/server.service.js'
import { readLinuxCpuTemperature } from '../../src/modules/status/linux-cpu-temperature.js'
import { SharedSampler } from '../../src/modules/status/shared-sampler.js'
import { requestedIntervalMs, StatusService } from '../../src/modules/status/status.service.js'
import { testStoragePath } from '../storage-path.js'

const { networkStatsMock, networkInterfaceDefaultMock, currentLoadMock } = vi.hoisted(() => ({
  networkStatsMock: vi.fn(),
  networkInterfaceDefaultMock: vi.fn(),
  currentLoadMock: vi.fn(),
}))

vi.mock('systeminformation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('systeminformation')>()
  return {
    ...actual,
    networkStats: networkStatsMock,
    networkInterfaceDefault: networkInterfaceDefaultMock,
    currentLoad: currentLoadMock,
  }
})

describe('readLinuxCpuTemperature', () => {
  const root = resolve(testStoragePath, 'linux-temp')
  let n = 0
  let thermal: string
  let hwmon: string

  const zone = async (name: string, type: string, temp: string) => {
    await mkdir(join(thermal, name), { recursive: true })
    await writeFile(join(thermal, name, 'type'), `${type}\n`)
    await writeFile(join(thermal, name, 'temp'), `${temp}\n`)
  }
  const sensor = async (mon: string, index: number, label: string, input: string) => {
    await mkdir(join(hwmon, mon), { recursive: true })
    await writeFile(join(hwmon, mon, `temp${index}_label`), `${label}\n`)
    await writeFile(join(hwmon, mon, `temp${index}_input`), `${input}\n`)
  }

  beforeEach(async () => {
    n += 1
    thermal = join(root, `${n}`, 'thermal')
    hwmon = join(root, `${n}`, 'hwmon')
    await mkdir(thermal, { recursive: true })
    await mkdir(hwmon, { recursive: true })
  })

  afterAll(async () => {
    await rm(root, { force: true, recursive: true })
  })

  it('reads package and core sensors from hwmon, plus socket and chipset zones', async () => {
    await sensor('hwmon1', 1, 'Package id 0', '52000')
    await sensor('hwmon1', 2, 'Core 0', '50000')
    await sensor('hwmon1', 3, 'Core 1', '55500')
    await zone('thermal_zone0', 'acpitz', '27800')
    await zone('thermal_zone1', 'pch_cannonlake', '41000')

    expect(await readLinuxCpuTemperature(thermal, hwmon)).toEqual({
      main: 52,
      cores: [50, 55.5],
      max: 55.5,
      socket: [27.8],
      chipset: 41,
    })
  })

  it('prefers Tctl on AMD', async () => {
    await sensor('hwmon0', 1, 'Tctl', '61250')
    await sensor('hwmon0', 2, 'Tccd1', '58000')

    expect(await readLinuxCpuTemperature(thermal, hwmon)).toMatchObject({ main: 61.3, max: 61.3, cores: [] })
  })

  it('falls back to the cpu thermal zone (Raspberry Pi)', async () => {
    await zone('thermal_zone0', 'cpu-thermal', '48312')

    expect(await readLinuxCpuTemperature(thermal, hwmon)).toEqual({
      main: 48.3,
      cores: [],
      max: 48.3,
      socket: [],
      chipset: null,
    })
  })

  it('falls back to thermal_zone0 when no zone is a cpu one', async () => {
    await zone('thermal_zone0', 'soc_dts0', '45678')

    expect(await readLinuxCpuTemperature(thermal, hwmon)).toMatchObject({ main: 45.678, max: 45.678 })
  })

  it('returns null without any sensor', async () => {
    expect(await readLinuxCpuTemperature(thermal, hwmon)).toBeNull()
    expect(await readLinuxCpuTemperature(join(root, 'missing'), join(root, 'missing'))).toBeNull()
  })
})

describe('SharedSampler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shares one reading between callers and refreshes it on the interval', async () => {
    let value = 0
    const sample = vi.fn(async () => ++value)
    const sampler = new SharedSampler(sample, { intervalMs: 10_000, idleMs: 30_000 })

    expect(await Promise.all([sampler.get(), sampler.get()])).toEqual([1, 1])
    expect(await sampler.get()).toBe(1)
    expect(sample).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(sample).toHaveBeenCalledTimes(2)
    expect(await sampler.get()).toBe(2)
    sampler.stop()
  })

  it('stops sampling once nobody asks, and starts fresh on the next request', async () => {
    let value = 0
    const sample = vi.fn(async () => ++value)
    const onStop = vi.fn()
    const sampler = new SharedSampler(sample, { intervalMs: 10_000, idleMs: 25_000, onStop })

    await sampler.get()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sampler.running).toBe(false)
    expect(onStop).toHaveBeenCalledOnce()
    const calls = sample.mock.calls.length

    await vi.advanceTimersByTimeAsync(60_000)
    expect(sample).toHaveBeenCalledTimes(calls)

    expect(await sampler.get()).toBe(calls + 1)
    expect(sampler.running).toBe(true)
    sampler.stop()
  })

  it('keeps the last reading when a refresh fails', async () => {
    const sample = vi.fn().mockResolvedValueOnce('first').mockRejectedValueOnce(new Error('boom'))
    const onError = vi.fn()
    const sampler = new SharedSampler(sample, { intervalMs: 10_000, idleMs: 60_000, onError })

    expect(await sampler.get()).toBe('first')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }))
    expect(await sampler.get()).toBe('first')
    sampler.stop()
  })
})

describe('SharedSampler - client-driven period', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Poll like a widget: one request every `everyMs` for `forMs`
  const poll = async (sampler: SharedSampler<unknown>, everyMs: number | undefined, forMs: number) => {
    for (let t = 0; t < forMs; t += everyMs ?? 10_000) {
      await sampler.get(everyMs)
      await vi.advanceTimersByTimeAsync(everyMs ?? 10_000)
    }
  }

  it('ticks at the fastest interval a client polls at, once for all clients', async () => {
    const sample = vi.fn(async () => Date.now())
    const sampler = new SharedSampler(sample, { intervalMs: 10_000, idleMs: 75_000 })

    // a default (10 s) client and a 1 s client polling side by side
    await sampler.get()
    await sampler.get(1_000)
    expect(sampler.periodMs).toBe(1_000)
    sample.mockClear()
    for (let i = 0; i < 5; i++) {
      await sampler.get(1_000)
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(sample).toHaveBeenCalledTimes(5)
    // every poll sees a new reading
    const readings = new Set<unknown>()
    for (let i = 0; i < 3; i++) {
      readings.add(await sampler.get(1_000))
      await vi.advanceTimersByTimeAsync(1_000)
    }
    expect(readings.size).toBe(3)
    sampler.stop()
  })

  it('brings the next tick forward when a faster client arrives', async () => {
    const sample = vi.fn(async () => 1)
    const sampler = new SharedSampler(sample, { intervalMs: 10_000, idleMs: 75_000 })

    await sampler.get()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sample).toHaveBeenCalledTimes(1)
    await sampler.get(2_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sample).toHaveBeenCalledTimes(2)
    sampler.stop()
  })

  it('floors the period at 1 s', async () => {
    const sample = vi.fn(async () => 1)
    const sampler = new SharedSampler(sample, { intervalMs: 10_000, idleMs: 75_000 })

    await sampler.get(100)
    expect(sampler.periodMs).toBe(1_000)
    sample.mockClear()
    await vi.advanceTimersByTimeAsync(999)
    expect(sample).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(sample).toHaveBeenCalledTimes(1)
    sampler.stop()
  })

  it('slows back down once the fast client stops polling', async () => {
    const sample = vi.fn(async () => 1)
    const sampler = new SharedSampler(sample, { intervalMs: 10_000, idleMs: 75_000 })

    await poll(sampler, 1_000, 5_000)
    expect(sampler.periodMs).toBe(1_000)

    // only a 5 s client is left
    await poll(sampler, 5_000, 20_000)
    expect(sampler.periodMs).toBe(5_000)
    sample.mockClear()
    await poll(sampler, 5_000, 20_000)
    expect(sample).toHaveBeenCalledTimes(4)

    // and only a default one after that
    await poll(sampler, undefined, 30_000)
    expect(sampler.periodMs).toBe(10_000)
    sampler.stop()
  })

  it('treats a missing or bogus interval as the default', async () => {
    const sampler = new SharedSampler(async () => 1, { intervalMs: 10_000, idleMs: 75_000 })

    for (const interval of [undefined, 0, -5, Number.NaN]) {
      await sampler.get(interval)
      expect(sampler.periodMs).toBe(10_000)
    }
    sampler.stop()
  })

  it('keeps a start()ed background sampler running at the default period with no clients', async () => {
    const sample = vi.fn(async () => 1)
    const sampler = new SharedSampler(sample, { intervalMs: 10_000, idleMs: Infinity })

    sampler.start()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sample).toHaveBeenCalledTimes(30)
    expect(sampler.running).toBe(true)
    sampler.stop()
  })
})

describe('requestedIntervalMs', () => {
  it.each([
    [undefined, undefined],
    ['5', undefined],
    [0, undefined],
    [-1, undefined],
    [Number.NaN, undefined],
    [0.2, 1_000],
    [1, 1_000],
    [2.5, 2_500],
    [60, 60_000],
    [3600, 60_000],
  ])('maps %j to %j', (input, expected) => {
    expect(requestedIntervalMs(input)).toBe(expected)
  })
})

describe('StatusService - shared metric sampling', () => {
  let statusService: StatusService

  const netStats = (iface: string, rxSec: number) => [{ iface, rx_sec: rxSec, tx_sec: 0 }]

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    currentLoadMock.mockResolvedValue({ currentLoad: 12 })
    networkInterfaceDefaultMock.mockResolvedValue('eth0')

    statusService = new StatusService(
      new HttpService(),
      { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger,
      { ui: {} } as unknown as ConfigService,
      {} as PluginsService,
      {} as ServerService,
      { on: vi.fn() } as unknown as HomebridgeIpcService,
    )
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('answers every client from one cpu temperature sample per interval', async () => {
    const getCpuTemp = vi.spyOn(statusService as any, 'getCpuTemp')
      .mockResolvedValue({ main: 50, cores: [], max: 50 })

    const [a, b] = await Promise.all([statusService.getServerCpuInfo(), statusService.getServerCpuInfo()])
    await statusService.getServerCpuInfo()

    expect(getCpuTemp).toHaveBeenCalledTimes(1)
    expect(a).toMatchObject({ cpuTemperature: { main: 50, cores: [], max: 50 }, currentLoad: 12 })
    expect(b.cpuTemperature).toEqual(a.cpuTemperature)

    getCpuTemp.mockResolvedValue({ main: 51, cores: [], max: 51 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getCpuTemp).toHaveBeenCalledTimes(2)
    expect((await statusService.getServerCpuInfo()).cpuTemperature.main).toBe(51)
  })

  it('samples network stats once per interface for all clients', async () => {
    networkStatsMock.mockImplementation(async (iface: string) => netStats(iface, 2 * 1024 * 1024))

    // Two tabs polling the same interface, plus one on the default interface
    const [tab1, tab2] = await Promise.all([
      statusService.getCurrentNetworkUsage(['eth0']),
      statusService.getCurrentNetworkUsage(['eth0']),
    ])
    await statusService.getCurrentNetworkUsage(['eth0'])

    expect(networkStatsMock).toHaveBeenCalledTimes(1)
    expect(networkStatsMock).toHaveBeenCalledWith('eth0')
    expect(tab1).toEqual({ net: { iface: 'eth0', rx_sec: 2 * 1024 * 1024, tx_sec: 0 }, point: 2 })
    expect(tab2).toBe(tab1)

    const wlan = await statusService.getCurrentNetworkUsage(['wlan0'])
    expect(wlan.net.iface).toBe('wlan0')
    const byDefault = await statusService.getCurrentNetworkUsage([])
    expect(byDefault.net.iface).toBe('eth0')
    expect(networkStatsMock).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(networkStatsMock).toHaveBeenCalledTimes(6)
  })

  it('samples cpu load, temperature and network at a widget\'s 1 s refresh, and slows down after it leaves', async () => {
    const getCpuTemp = vi.spyOn(statusService as any, 'getCpuTemp')
      .mockResolvedValue({ main: 50, cores: [], max: 50 })
    networkStatsMock.mockImplementation(async (iface: string) => netStats(iface, 0))
    let load = 0
    currentLoadMock.mockImplementation(async () => ({ currentLoad: ++load }))

    const loads: number[] = []
    for (let i = 0; i < 5; i++) {
      loads.push((await statusService.getServerCpuInfo(1)).currentLoad)
      await statusService.getCurrentNetworkUsage(['eth0'], 1)
      await vi.advanceTimersByTimeAsync(1_000)
    }
    // a fresh cpu load on every poll, not the same 10 s reading five times
    expect(new Set(loads).size).toBe(5)
    // the first reading, then one per 1 s tick
    expect(getCpuTemp).toHaveBeenCalledTimes(6)
    expect(networkStatsMock).toHaveBeenCalledTimes(6)

    // the 1 s widget is gone; nobody polls faster than the 10 s default
    await vi.advanceTimersByTimeAsync(5_000)
    currentLoadMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(currentLoadMock).toHaveBeenCalledTimes(3)
  })

  it('samples memory at the requested interval, and every 10 s for old payloads', async () => {
    const memSpy = vi.spyOn(statusService as any, 'getMemoryUsagePoint').mockResolvedValue(undefined)

    await statusService.getServerMemoryInfo()
    expect(memSpy).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(memSpy).toHaveBeenCalledTimes(2)

    await statusService.getServerMemoryInfo(2)
    memSpy.mockClear()
    await statusService.getServerMemoryInfo(2)
    await vi.advanceTimersByTimeAsync(2_000)
    await statusService.getServerMemoryInfo(2)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(memSpy).toHaveBeenCalledTimes(2)
  })

  it('stops sampling network stats when no client polls any more', async () => {
    networkStatsMock.mockImplementation(async (iface: string) => netStats(iface, 0))

    await statusService.getCurrentNetworkUsage(['eth0'])
    await vi.advanceTimersByTimeAsync(120_000)
    const calls = networkStatsMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(120_000)

    expect(networkStatsMock).toHaveBeenCalledTimes(calls)
    expect((statusService as any).networkSamplers.size).toBe(0)
  })
})
