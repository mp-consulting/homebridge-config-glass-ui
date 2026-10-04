/** CPU widget data from server */
export interface CpuWidgetData {
  cpuTemperature: {
    main?: number
    cores?: number[]
    max?: number
  }
  currentLoad: number
  cpuLoadHistory: number[]
}

/** Memory widget data from server */
export interface MemoryWidgetData {
  mem: {
    total: number
    available: number
  }
  memoryUsageHistory: number[]
}

/** Network widget data from server */
export interface NetworkWidgetData {
  net: {
    iface: string
    rx_sec: number
    tx_sec: number
  }
  /** Combined MB/s (older servers only send this). */
  point: number
  /** Bytes per second received (absent on older servers). */
  received?: number
  /** Bytes per second sent (absent on older servers). */
  sent?: number
}
