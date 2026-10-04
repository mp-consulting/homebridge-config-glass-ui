import { api } from '@/core/api'

export interface ChildBridgeHealth {
  username: string
  name: string
  plugin: string
  identifier: string
  status: 'pending' | 'ok' | 'down'
  manuallyStopped: boolean
  pid?: number
  upSince: string | null
  uptime: number | null
  restartCount: number
  crashCount: number
  recentCrashes: number
  crashLoop: boolean
  lastCrashAt: string | null
  /** Bytes; only reported on Linux. */
  memoryRss?: number
}

export interface ChildBridgeHealthReport {
  crashLoop: { crashes: number, windowMinutes: number }
  bridges: ChildBridgeHealth[]
}

export const HEALTH_POLL_MS = 10_000

export function fetchChildBridgeHealth(): Promise<ChildBridgeHealthReport> {
  return api.get<ChildBridgeHealthReport>('/status/homebridge/child-bridges/health')
}

/** `3d 4h`, `2h 5m`, `4m 10s`: the two largest units of an uptime in seconds. */
export function formatUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return '—'
  }
  const units: Array<[string, number]> = [['d', 86_400], ['h', 3_600], ['m', 60], ['s', 1]]
  const parts: string[] = []
  let rest = Math.floor(seconds)
  for (const [suffix, size] of units) {
    const amount = Math.floor(rest / size)
    rest -= amount * size
    if (amount > 0 || (parts.length > 0)) {
      parts.push(`${amount}${suffix}`)
    }
    if (parts.length === 2) {
      break
    }
  }
  return parts.length ? parts.join(' ') : '0s'
}
