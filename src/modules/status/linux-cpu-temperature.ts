import type { Systeminformation } from 'systeminformation'

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const THERMAL_ROOT = '/sys/class/thermal'
const HWMON_ROOT = '/sys/class/hwmon'

/** millidegrees -> degrees with one decimal, as systeminformation rounds them */
function toCelsius(value: string): number {
  return Math.round(Number.parseInt(value, 10) / 100) / 10
}

async function readTrimmed(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return null
  }
}

async function list(dir: string, prefix: string): Promise<string[]> {
  try {
    // Shell globs expand in lexical order, which is what systeminformation sees
    return (await readdir(dir)).filter(name => name.startsWith(prefix)).sort()
  } catch {
    return []
  }
}

/**
 * The part of systeminformation's Linux `cpuTemperature()` that reads sysfs,
 * done with async fs instead of its `execSync('cat /sys/class/thermal/...')`
 * (which blocks the event loop) and its `for mon in /sys/class/hwmon/...` shell
 * loop. It follows the same order and parsing: hwmon `temp*_label` sensors
 * (Tctl / Tdie / Core n / Package / Physical / Tccd1), then the first thermal
 * zone whose type mentions "cpu", plus the acpi (socket) and pch (chipset)
 * zones, then `thermal_zone0`.
 *
 * Returns null when none of those yield a reading, so the caller can fall back
 * to systeminformation for the remaining sources (`sensors`, `vcgencmd`).
 */
export async function readLinuxCpuTemperature(
  thermalRoot = THERMAL_ROOT,
  hwmonRoot = HWMON_ROOT,
): Promise<Systeminformation.CpuTemperatureData | null> {
  const result: Systeminformation.CpuTemperatureData = {
    main: null,
    cores: [],
    max: null,
    socket: [],
    chipset: null,
  }

  // Thermal zones: socket (acpi*), chipset (pch*) and a cpu zone fallback
  let cpuThermal: number | null = null
  const zones = await list(thermalRoot, 'thermal_zone')
  const zoneData = await Promise.all(zones.map(async zone => ({
    type: await readTrimmed(join(thermalRoot, zone, 'type')),
    temp: await readTrimmed(join(thermalRoot, zone, 'temp')),
  })))
  for (const { type, temp } of zoneData) {
    if (type === null || !temp) {
      continue
    }
    if (type.startsWith('acpi')) {
      result.socket.push(toCelsius(temp))
    }
    if (type.startsWith('pch')) {
      result.chipset = toCelsius(temp)
    }
    if (cpuThermal === null && type.includes('cpu')) {
      cpuThermal = toCelsius(temp)
    }
  }

  // hwmon labelled sensors
  const sensors: Array<{ label: string, value: string }> = []
  for (const mon of await list(hwmonRoot, 'hwmon')) {
    const labels = (await list(join(hwmonRoot, mon), 'temp')).filter(name => name.endsWith('_label'))
    for (const labelFile of labels) {
      const label = await readTrimmed(join(hwmonRoot, mon, labelFile))
      if (label === null) {
        continue
      }
      const value = await readTrimmed(join(hwmonRoot, mon, labelFile.replace(/_label$/, '_input')))
      sensors.push({ label, value: value || '0' })
    }
  }
  // systeminformation drops every sensor listed before the first Tdie
  const tdieIndex = sensors.findIndex(({ label }) => label.toLowerCase().includes('tdie'))
  let tctl = 0
  for (const { label, value } of tdieIndex === -1 ? sensors : sensors.slice(tdieIndex)) {
    const lower = label.toLowerCase()
    if (lower === 'tctl') {
      tctl = result.main = toCelsius(value)
    }
    if (lower.startsWith('core')) {
      result.cores.push(toCelsius(value))
    } else if (result.main === null && (lower.includes('package') || lower.includes('physical') || lower === 'tccd1')) {
      result.main = toCelsius(value)
    }
  }
  if (tctl && result.main === null) {
    result.main = tctl
  }
  if (result.cores.length > 0) {
    if (result.main === null) {
      result.main = Math.round(result.cores.reduce((a, b) => a + b, 0) / result.cores.length)
    }
    const maxTemp = Math.max(...result.cores)
    result.max = maxTemp > result.main ? maxTemp : result.main
  }
  if (result.main !== null) {
    result.max ??= result.main
    return result
  }

  if (cpuThermal !== null) {
    result.main = cpuThermal
    result.max = cpuThermal
    return result
  }

  // systeminformation tries `sensors` here, which reads the same hwmon data as
  // above, so it has nothing to add; thermal_zone0 is its next source
  const zone0 = await readTrimmed(join(thermalRoot, 'thermal_zone0', 'temp'))
  if (zone0) {
    result.main = Number.parseFloat(zone0) / 1000
    result.max = result.main
    return result
  }

  return null
}
