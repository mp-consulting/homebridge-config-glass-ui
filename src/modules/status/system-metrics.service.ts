import type { Systeminformation } from 'systeminformation'

import { readFile } from 'node:fs/promises'
import { cpus, loadavg, networkInterfaces as osNetworkInterfaces, platform } from 'node:os'

import { Inject, Injectable } from '@nestjs/common'
import NodeCache from 'node-cache'
import { cpuTemperature, mem, networkInterfaceDefault, networkStats } from 'systeminformation'

import { ConfigService } from '../../core/config/config.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { createCpuLoadMeter } from './cpu-load.js'
import { readLinuxCpuTemperature } from './linux-cpu-temperature.js'
import { MIN_SAMPLE_MS, SharedSampler } from './shared-sampler.js'

// CPU temperature and network stats are sampled on a shared timer while any
// widget polls for them (see SharedSampler); cpu load and memory are sampled
// in the background all the time, so their history is there when a dashboard
// opens. 10 s is the widgets' default refresh and the period whenever no
// widget polls faster; the on-demand samplers stop once no widget has asked
// for longer than the slowest widget refresh (60 s).
const METRIC_SAMPLE_MS = 10_000
// A widget's refresh interval is 1-60 s
const MAX_REQUESTED_INTERVAL_MS = 60_000
const METRIC_IDLE_MS = 75_000
// Network samplers are per interface, and the interface comes from the client
const MAX_NETWORK_SAMPLERS = 8
// How long the interface list and the default interface are trusted
const INTERFACE_CACHE_SECONDS = 60

/**
 * One network reading. `point` is the combined throughput in MB/s (kept for
 * older clients); `received` / `sent` are bytes per second so the client can
 * show them in the unit the user picked (bits or bytes, auto-scaled).
 */
export interface NetworkUsage {
  net: Systeminformation.NetworkStatsData
  point: number
  received: number
  sent: number
}

/**
 * A widget's refresh interval (seconds, from the request payload) as a sampler
 * period: undefined - the sampler default - when absent or not a number, else
 * clamped to the 1-60 s a widget can be set to.
 */
export function requestedIntervalMs(interval: unknown): number | undefined {
  if (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0) {
    return undefined
  }
  return Math.min(MAX_REQUESTED_INTERVAL_MS, Math.max(MIN_SAMPLE_MS, Math.round(interval * 1000)))
}

/**
 * Host metrics for the dashboard widgets: cpu load and temperature, memory
 * usage and network throughput, each sampled on a shared timer so any number
 * of widgets and tabs cost one systeminformation call per interval.
 */
@Injectable()
export class SystemMetricsService {
  private cache = new NodeCache({ stdTTL: 3600 })

  private cpuLoadHistory: number[] = []
  // Load over the time since the previous sample, from os.cpus() tick deltas
  private readCpuLoad = createCpuLoadMeter()
  private memoryUsageHistory: number[] = []

  private memoryInfo: Systeminformation.MemData

  private cpuTempSampler = new SharedSampler(() => this.getCpuTemp(), {
    intervalMs: METRIC_SAMPLE_MS,
    idleMs: METRIC_IDLE_MS,
    onError: e => this.logger.debug(`Failed to sample cpu temperature as ${e.message}.`),
  })

  private networkSamplers = new Map<string, SharedSampler<NetworkUsage>>()

  // Background samplers for the cpu load / memory history; the value is unused
  private cpuLoadSampler = new SharedSampler(async () => {
    await this.getCpuLoadPoint()
    return true
  }, {
    intervalMs: METRIC_SAMPLE_MS,
    idleMs: Infinity,
    onError: e => this.logger.debug(`Failed to sample cpu load as ${e.message}.`),
  })

  private memorySampler = new SharedSampler(async () => {
    await this.getMemoryUsagePoint()
    return true
  }, {
    intervalMs: METRIC_SAMPLE_MS,
    idleMs: Infinity,
    onError: e => this.logger.debug(`Failed to sample memory usage as ${e.message}.`),
  })

  // Set once systeminformation has also found no temperature sensor, so the
  // Linux reader stops falling back to its blocking shell calls every sample
  private noLinuxTempSensor = false

  constructor(
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    // Systeminformation cpu data is not supported in FreeBSD Jail Shells
    if (platform() === 'freebsd') {
      this.getCpuLoadPoint = this.getCpuLoadPointAlt
      this.getCpuTemp = this.getCpuTempAlt
    }

    if (this.configService.ui.disableServerMetricsMonitoring !== true) {
      // Neither sample may reject unhandled: there is no global
      // unhandledRejection handler, so one failed systeminformation call
      // would take the whole UI process down. A missed sample is harmless
      // (the samplers log it through onError).
      this.cpuLoadSampler.start()
      this.memorySampler.start()
    } else {
      this.logger.debug('Server metrics monitoring disabled.')
    }
  }

  /**
   * Looks up the cpu current load % and stores the last 60 points
   */
  private async getCpuLoadPoint() {
    const load = this.readCpuLoad()
    this.cpuLoadHistory = this.cpuLoadHistory.slice(-60)
    this.cpuLoadHistory.push(load)
  }

  /**
   * Looks up the current memory usage and stores the last 60 points
   */
  private async getMemoryUsagePoint() {
    const memory = await mem()
    this.memoryInfo = memory

    const memoryFreePercent = ((memory.total - memory.available) / memory.total) * 100
    this.memoryUsageHistory = this.memoryUsageHistory.slice(-60)
    this.memoryUsageHistory.push(memoryFreePercent)
  }

  /**
   * Alternative method to get the CPU load on systems that do not support systeminformation.currentLoad
   * This is currently only used on FreeBSD
   */
  private async getCpuLoadPointAlt() {
    const load = (loadavg()[0] * 100 / cpus().length)
    this.cpuLoadHistory = this.cpuLoadHistory.slice(-60)
    this.cpuLoadHistory.push(load)
  }

  /**
   * Get the current CPU temperature using systeminformation.cpuTemperature
   */
  private async getCpuTemp() {
    // An explicitly configured temperature file always wins - auto-detection
    // can read the wrong sensor entirely on some platforms (e.g. Intel macOS
    // reporting ~40°C too high), and previously the override only engaged
    // when auto-detection failed outright, never when it was wrong (#2896)
    if (this.configService.ui.temp) {
      return this.getCpuTempLegacy()
    }

    if (platform() === 'linux') {
      return this.getCpuTempLinux()
    }

    return cpuTemperature()
  }

  /**
   * systeminformation's cpuTemperature() on Linux starts with an execSync that
   * blocks the event loop, so read the same sysfs files with async fs, and only
   * fall back to it for the sources the reader does not cover (vcgencmd).
   */
  private async getCpuTempLinux(): Promise<Systeminformation.CpuTemperatureData> {
    const reading = await readLinuxCpuTemperature()
    if (reading) {
      return reading
    }
    if (this.noLinuxTempSensor) {
      return { main: null, cores: [], max: null, socket: [], chipset: null }
    }
    const fallback = await cpuTemperature()
    if (fallback.main === null) {
      this.noLinuxTempSensor = true
    }
    return fallback
  }

  /**
   * The old way of getting the cpu temp
   */
  private async getCpuTempLegacy() {
    try {
      const tempData = await readFile(this.configService.ui.temp, 'utf-8')
      const tempValue = Number.parseFloat(tempData)

      if (!Number.isFinite(tempValue)) {
        throw new TypeError('the file does not contain a number')
      }

      // The configured file may hold either degrees or millidegrees, so pick the
      // unit by magnitude - no cpu runs at 1000°C, and a millidegrees reading is
      // never within 1°C of zero in practice. The comparison ignores the sign so
      // a sub-zero millidegrees reading is not mistaken for degrees (#2896)
      const cpuTemp = Math.abs(tempValue) >= 1000 ? tempValue / 1000 : tempValue
      return {
        main: cpuTemp,
        cores: [],
        max: cpuTemp,
      }
    } catch (e) {
      this.logger.error(`Failed to read temp from ${this.configService.ui.temp} as ${e.message}.`)
      return this.getCpuTempAlt()
    }
  }

  /**
   * Alternative method for CPU temp
   * This is currently only used on FreeBSD and will return null
   */
  private async getCpuTempAlt() {
    return {
      main: -1,
      cores: [],
      max: -1,
    }
  }

  /**
   * Returns the current network usage
   */
  public async getCurrentNetworkUsage(netInterfaces?: string[], interval?: number): Promise<NetworkUsage> {
    // Only the first interface's stats are returned, so only it is sampled.
    // The name comes from the client and is handed to systeminformation (which
    // builds commands and paths from it on some platforms), so only a name the
    // host actually has is used - anything else gets the default interface.
    const requested = Array.isArray(netInterfaces) ? netInterfaces.find(Boolean) : undefined
    const iface = typeof requested === 'string' && (await this.getInterfaceNames()).has(requested) ? requested : ''

    let sampler = this.networkSamplers.get(iface)
    if (!sampler) {
      if (this.networkSamplers.size >= MAX_NETWORK_SAMPLERS) {
        return this.sampleNetworkUsage(iface)
      }
      sampler = new SharedSampler(() => this.sampleNetworkUsage(iface), {
        intervalMs: METRIC_SAMPLE_MS,
        idleMs: METRIC_IDLE_MS,
        onError: e => this.logger.debug(`Failed to sample network usage as ${e.message}.`),
        onStop: () => this.networkSamplers.delete(iface),
      })
      this.networkSamplers.set(iface, sampler)
    }
    return sampler.get(requestedIntervalMs(interval))
  }

  /**
   * The host's network interface names, cached for a minute (an interface
   * that comes up later is picked up then). Read from os.networkInterfaces():
   * only the names are needed, and systeminformation's list runs a shell
   * command per interface on some platforms.
   */
  private async getInterfaceNames(): Promise<Set<string>> {
    const cached = this.cache.get<string[]>('interfaceNames')
    if (cached) {
      return new Set(cached)
    }
    try {
      const names = Object.keys(osNetworkInterfaces()).filter(Boolean)
      this.cache.set('interfaceNames', names, INTERFACE_CACHE_SECONDS)
      return new Set(names)
    } catch (e) {
      this.logger.debug(`Failed to list network interfaces as ${e.message}.`)
      return new Set()
    }
  }

  /**
   * The default interface's name, cached for a minute: finding it runs shell
   * commands (`ip route` / `netstat` / `route`), too much for every sample
   */
  public async getDefaultInterfaceName(): Promise<string> {
    const cached = this.cache.get<string>('defaultInterfaceName')
    if (cached !== undefined) {
      return cached
    }
    const name = await networkInterfaceDefault()
    this.cache.set('defaultInterfaceName', name, INTERFACE_CACHE_SECONDS)
    return name
  }

  private async sampleNetworkUsage(iface: string): Promise<NetworkUsage> {
    const net = await networkStats(iface || await this.getDefaultInterfaceName())

    // systeminformation reports null until it has two readings to compare
    const received = Math.max(0, net[0].rx_sec ?? 0)
    const sent = Math.max(0, net[0].tx_sec ?? 0)
    const txRxSec = (received + sent) / 1024 / 1024

    return { net: net[0], point: txRxSec, received, sent }
  }

  /**
   * Returns server CPU Load and temperature information
   */
  public async getServerCpuInfo(interval?: number) {
    // When metrics monitoring is disabled, return an empty result rather than
    // collecting on demand - the dashboard widgets poll this endpoint, which
    // previously kept the metrics alive even with the monitoring turned off (#2934)
    if (this.configService.ui.disableServerMetricsMonitoring === true) {
      return {
        cpuTemperature: { main: -1, cores: [], max: -1 },
        currentLoad: 0,
        cpuLoadHistory: [],
      }
    }

    const intervalMs = requestedIntervalMs(interval)
    await this.cpuLoadSampler.get(intervalMs)

    return {
      cpuTemperature: await this.cpuTempSampler.get(intervalMs),
      currentLoad: this.cpuLoadHistory.slice(-1)[0],
      cpuLoadHistory: this.cpuLoadHistory,
    }
  }

  /**
   * Returns server Memory usage information
   */
  public async getServerMemoryInfo(interval?: number) {
    // See getServerCpuInfo - no on-demand collection when monitoring is disabled (#2934)
    if (this.configService.ui.disableServerMetricsMonitoring === true) {
      return {
        mem: null,
        memoryUsageHistory: [],
      }
    }

    await this.memorySampler.get(requestedIntervalMs(interval))

    return {
      mem: this.memoryInfo,
      memoryUsageHistory: this.memoryUsageHistory,
    }
  }
}
