import type { ComponentType, LazyExoticComponent } from 'react'

import type { WidgetProps } from './widget.types'

import { lazy } from 'react'

/**
 * Saved layout key (the Angular class name) → React widget, lazily loaded so
 * heavy widgets (xterm, chart.js) stay out of the dashboard's first chunk.
 * Each lives at `widgets/<dir>/<Pascal>.tsx` and exports `<Pascal>` (the
 * Angular class name without `Component`).
 */
function load<K extends string>(importer: () => Promise<Record<K, ComponentType<WidgetProps>>>, name: K) {
  return lazy(async () => ({ default: (await importer())[name] }))
}

export const widgetRegistry: Record<string, LazyExoticComponent<ComponentType<WidgetProps>>> = {
  HapQrcodeWidgetComponent: load(() => import('./hap-qrcode-widget/HapQrcodeWidget'), 'HapQrcodeWidget'),
  MatterQrcodeWidgetComponent: load(() => import('./matter-qrcode-widget/MatterQrcodeWidget'), 'MatterQrcodeWidget'),
  HomebridgeLogsWidgetComponent: load(() => import('./homebridge-logs-widget/HomebridgeLogsWidget'), 'HomebridgeLogsWidget'),
  TerminalWidgetComponent: load(() => import('./terminal-widget/TerminalWidget'), 'TerminalWidget'),
  CpuWidgetComponent: load(() => import('./cpu-widget/CpuWidget'), 'CpuWidget'),
  NetworkWidgetComponent: load(() => import('./network-widget/NetworkWidget'), 'NetworkWidget'),
  MemoryWidgetComponent: load(() => import('./memory-widget/MemoryWidget'), 'MemoryWidget'),
  UptimeWidgetComponent: load(() => import('./uptime-widget/UptimeWidget'), 'UptimeWidget'),
  UpdateInfoWidgetComponent: load(() => import('./update-info-widget/UpdateInfoWidget'), 'UpdateInfoWidget'),
  SystemInfoWidgetComponent: load(() => import('./system-info-widget/SystemInfoWidget'), 'SystemInfoWidget'),
  WeatherWidgetComponent: load(() => import('./weather-widget/WeatherWidget'), 'WeatherWidget'),
  AccessoriesWidgetComponent: load(() => import('./accessories-widget/AccessoriesWidget'), 'AccessoriesWidget'),
  ClockWidgetComponent: load(() => import('./clock-widget/ClockWidget'), 'ClockWidget'),
  BridgesWidgetComponent: load(() => import('./bridges-widget/BridgesWidget'), 'BridgesWidget'),
  AssistantDigestWidgetComponent: load(() => import('./assistant-digest-widget/AssistantDigestWidget'), 'AssistantDigestWidget'),
}

export { AVAILABLE_WIDGETS, WIDGETS_WITH_SETTINGS } from './widget.types'
