/** How long the server or Homebridge has been up, in the largest unit that fits. */
export function humaniseDuration(seconds: number): string {
  if (seconds < 50) {
    return '< 1m'
  }
  if (seconds < 3600) {
    return `${Math.round((seconds / 60))}m`
  }
  if (seconds < 86400) {
    return `${Math.round((seconds / 60 / 60))}h`
  }
  return `${Math.floor((seconds / 60 / 60 / 24))}d`
}
