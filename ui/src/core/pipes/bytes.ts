/**
 * A byte count in megabytes, one decimal: `1572864` → `1.5MB` (the file sizes
 * the backup and upload toasts show).
 * @param bytes - the size in bytes
 */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** How a transfer rate is shown: bits (network convention) or bytes per second. */
export type RateUnit = 'bits' | 'bytes'

const BIT_SUFFIXES = ['b/s', 'Kb/s', 'Mb/s', 'Gb/s', 'Tb/s']
const BYTE_SUFFIXES = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s']

/**
 * A rate scaled to the largest unit that keeps it at or above one, 1024-based
 * (as the network widget always was): `{ value: 1.5, suffix: 'MB/s' }`.
 * @param bytesPerSecond - the rate in bytes per second
 * @param unit - show bits (`Mb/s`) or bytes (`MB/s`)
 */
export function scaleRate(bytesPerSecond: number, unit: RateUnit = 'bits'): { value: number, suffix: string } {
  const suffixes = unit === 'bytes' ? BYTE_SUFFIXES : BIT_SUFFIXES
  let value = Math.max(0, Number(bytesPerSecond) || 0) * (unit === 'bytes' ? 1 : 8)
  let index = 0
  while (value >= 1024 && index < suffixes.length - 1) {
    value /= 1024
    index++
  }
  return { value, suffix: suffixes[index] }
}
