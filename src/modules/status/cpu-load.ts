import type { CpuInfo } from 'node:os'

import { cpus } from 'node:os'

interface CpuTotals { busy: number, total: number }

function sumCpuTimes(list: CpuInfo[]): CpuTotals {
  let busy = 0
  let total = 0
  for (const { times } of list) {
    const used = times.user + times.nice + times.sys + times.irq
    busy += used
    total += used + times.idle
  }
  return { busy, total }
}

/**
 * Build a reader for the host's cpu load, in percent (0-100), over the time
 * since its previous call - since boot on the first. The same figure as
 * systeminformation's `currentLoad().currentLoad`, without the
 * `execSync('cat /proc/stat')` it runs on Linux on every call, which blocks
 * the event loop for each background sample.
 */
export function createCpuLoadMeter(readCpus: () => CpuInfo[] = cpus): () => number {
  let previous: CpuTotals = { busy: 0, total: 0 }
  let last = 0

  return () => {
    const current = sumCpuTimes(readCpus())
    const total = current.total - previous.total
    const busy = current.busy - previous.busy
    // No tick elapsed (two calls within one clock tick), or the counters went
    // backwards (a cpu went offline): keep the previous reading
    if (total > 0 && busy >= 0) {
      last = Math.min(100, Math.max(0, (busy / total) * 100))
    }
    previous = current
    return last
  }
}
