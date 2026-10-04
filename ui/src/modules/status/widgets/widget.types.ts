import type { ReactNode } from 'react'

import { createEmitter } from '@/core/utilities/emitter'

/**
 * The contract between the status dashboard (`StatusPage`) and its widgets.
 *
 * Angular built each widget with `createComponent()` and handed it
 * `widget` (an input), `resizeEvent` / `configureEvent` (Subjects set on the
 * instance) and, through `widget.$saveWidgetsEvent`, a way to persist the
 * layout. Here a widget is a React component taking `WidgetProps`.
 *
 * The `Widget` object is one entry of the saved dashboard layout — a frozen
 * contract shared with the Angular UI: the keys below are written to the
 * server as-is by `set-dashboard-layout` (only the `$`-prefixed Angular
 * Subjects were stripped, and React never puts them on the object).
 */

/** A tiny Subject: what `$resizeEvent` / `$configureEvent` were. */
// `next()` takes no argument for the plain "it happened" events. Method
// signatures, so a typed event still fits where a plain one is expected
/* eslint-disable ts/method-signature-style */
export interface WidgetEvent<T = unknown> {
  /** Returns an unsubscribe function (also a `ResizeSource` for `useTerminal` / `useLog`). */
  subscribe(cb: (value: T) => void): () => void
  next(value?: T): void
  /** Drops every subscriber (the host calls it when the widget unmounts). */
  complete(): void
}
/* eslint-enable ts/method-signature-style */

export function createWidgetEvent<T = unknown>(): WidgetEvent<T> {
  const events = createEmitter<T>()
  return {
    subscribe: events.subscribe,
    next: value => events.emit(value as T),
    complete: events.clear,
  }
}

/** One saved dashboard item (`Widget` in widgets.interfaces.ts, minus the Subjects). */
export interface Widget {
  /** The Angular class name, e.g. `CpuWidgetComponent` — the widget's key. */
  component: string
  x: number
  y: number
  cols: number
  rows: number
  mobileOrder: number
  hideOnDesktop: boolean
  hideOnMobile: boolean
  /** Written by the Angular UI (gridster's per-item flag); kept for round-tripping. */
  draggable?: boolean
  accessoryOrder?: string[] // accessory widget
  timeFormat?: string // clock widget
  dateFormat?: string // clock widget
  refreshInterval?: number // cpu widget, memory widget, disk widget, network widget
  historyItems?: number // cpu widget, memory widget, disk widget, network widget
  networkInterface?: string // network widget
  networkUnit?: 'bits' | 'bytes' // network widget (default bits)
  historyAccessory?: string // accessory history widget: the accessory uniqueId
  historyType?: string // accessory history widget: the characteristic type
  historyLabel?: string // accessory history widget: what the title shows
  historyHours?: number // accessory history widget: how far back
  location?: {
    id: string // weather widget
    [key: string]: unknown
  }
  showNpmVersion?: boolean // update info widget
  dockerExpanded?: boolean // update info widget
  showToolbar?: boolean // homebridge logs widget
  /** Anything else a layout carries (gridster extras, future settings) is kept untouched. */
  [key: string]: unknown
}

/** The props every widget component receives. */
export interface WidgetProps {
  /** The layout item. A new object whenever any of its fields change; never mutate it. */
  widget: Widget
  /**
   * Fires when the grid item was resized (gridster's `itemResizeCallback`)
   * and whenever the widget itself calls `next()` (as the Angular terminal /
   * logs widgets did). Pass it as `resize` to `useTerminal` / `useLog`.
   */
  resizeEvent: WidgetEvent
  /** Fires after the widget-control modal saved new settings for this widget. */
  configureEvent: WidgetEvent
  /**
   * Merge fields into this widget's layout item without saving — e.g. the
   * defaults Angular wrote onto `widget()` in `ngOnInit`
   * (`refreshInterval = 10`). They are persisted with the next save. Only call
   * it when a value actually changes (guard defaults with `=== undefined`),
   * since it re-renders the dashboard.
   */
  updateWidget: (patch: Partial<Widget>) => void
  /**
   * Merge fields (optional) and persist the whole layout — what
   * `widget().foo = …; widget().$saveWidgetsEvent.next()` did.
   */
  saveWidgets: (patch?: Partial<Widget>) => void
}

export type WidgetComponent = (props: WidgetProps) => ReactNode

// Widgets that have additional settings beyond visibility (shown in widget-control modal)
export const WIDGETS_WITH_SETTINGS = [
  'UpdateInfoWidgetComponent',
  'WeatherWidgetComponent',
  'ClockWidgetComponent',
  'CpuWidgetComponent',
  'MemoryWidgetComponent',
  'NetworkWidgetComponent',
  'HomebridgeLogsWidgetComponent',
  'AccessoryHistoryWidgetComponent',
] as const

// Available widget component names, for filtering the saved layout
export const AVAILABLE_WIDGETS: readonly string[] = [
  'HapQrcodeWidgetComponent',
  'HomebridgeLogsWidgetComponent',
  'TerminalWidgetComponent',
  'CpuWidgetComponent',
  'NetworkWidgetComponent',
  'MemoryWidgetComponent',
  'UptimeWidgetComponent',
  'UpdateInfoWidgetComponent',
  'SystemInfoWidgetComponent',
  'WeatherWidgetComponent',
  'AccessoriesWidgetComponent',
  'ClockWidgetComponent',
  'BridgesWidgetComponent',
  'MatterQrcodeWidgetComponent',
  'AssistantDigestWidgetComponent',
  'AccessoryHistoryWidgetComponent',
]
