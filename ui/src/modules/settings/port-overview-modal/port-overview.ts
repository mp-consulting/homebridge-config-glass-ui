export interface NetworkOverviewEntry {
  service: string
  port: number
  protocol: string
  bridge: string
  status: string
  matterPort?: number
  commissioned?: boolean
  deviceCount?: number
}

/** Homebridge first, then the UI, then the bridges by name. */
export function sortEntries(entries: NetworkOverviewEntry[]): NetworkOverviewEntry[] {
  return entries.sort((a, b) => {
    if (a.service === 'Homebridge') {
      return -1
    }
    if (b.service === 'Homebridge') {
      return 1
    }
    if (a.service === 'Config UI') {
      return -1
    }
    if (b.service === 'Config UI') {
      return 1
    }
    return a.bridge.localeCompare(b.bridge)
  })
}

export function displayName(entry: NetworkOverviewEntry): string {
  if (entry.service === 'Config UI') {
    return 'Homebridge Glass UI'
  }
  return entry.bridge
}
