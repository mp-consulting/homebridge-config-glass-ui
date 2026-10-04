import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'

import * as widgetTypes from './widget.types'
import { AVAILABLE_WIDGETS, widgetRegistry, WIDGETS_WITH_SETTINGS } from './widgetRegistry'

// Every widget module is replaced by a stub that names itself, so this checks
// the registry's key -> module -> named export wiring without loading xterm,
// chart.js or the network.
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => ({
    [name]: (props: { widget: { component: string } }) => (
      <div data-testid="widget-stub" data-name={name} data-component={props.widget.component} />
    ),
  }),
}))

vi.mock('./hap-qrcode-widget/HapQrcodeWidget', () => stub('HapQrcodeWidget'))
vi.mock('./matter-qrcode-widget/MatterQrcodeWidget', () => stub('MatterQrcodeWidget'))
vi.mock('./homebridge-logs-widget/HomebridgeLogsWidget', () => stub('HomebridgeLogsWidget'))
vi.mock('./terminal-widget/TerminalWidget', () => stub('TerminalWidget'))
vi.mock('./cpu-widget/CpuWidget', () => stub('CpuWidget'))
vi.mock('./network-widget/NetworkWidget', () => stub('NetworkWidget'))
vi.mock('./memory-widget/MemoryWidget', () => stub('MemoryWidget'))
vi.mock('./uptime-widget/UptimeWidget', () => stub('UptimeWidget'))
vi.mock('./update-info-widget/UpdateInfoWidget', () => stub('UpdateInfoWidget'))
vi.mock('./system-info-widget/SystemInfoWidget', () => stub('SystemInfoWidget'))
vi.mock('./weather-widget/WeatherWidget', () => stub('WeatherWidget'))
vi.mock('./accessories-widget/AccessoriesWidget', () => stub('AccessoriesWidget'))
vi.mock('./clock-widget/ClockWidget', () => stub('ClockWidget'))
vi.mock('./bridges-widget/BridgesWidget', () => stub('BridgesWidget'))
vi.mock('./assistant-digest-widget/AssistantDigestWidget', () => stub('AssistantDigestWidget'))

describe('widgetRegistry', () => {
  it('has a widget for exactly the available widget keys', () => {
    expect(Object.keys(widgetRegistry).sort()).toEqual([...AVAILABLE_WIDGETS].sort())
  })

  it('only lists settings for registered widgets', () => {
    for (const key of WIDGETS_WITH_SETTINGS) {
      expect(widgetRegistry).toHaveProperty(key)
    }
  })

  it('re-exports the widget lists from widget.types', () => {
    expect(AVAILABLE_WIDGETS).toBe(widgetTypes.AVAILABLE_WIDGETS)
    expect(WIDGETS_WITH_SETTINGS).toBe(widgetTypes.WIDGETS_WITH_SETTINGS)
  })

  it.each(Object.keys(widgetRegistry))('%s lazily loads the matching named export', async (key) => {
    const Widget = widgetRegistry[key]
    const props = {
      widget: { component: key, x: 0, y: 0, cols: 1, rows: 1, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false },
      resizeEvent: widgetTypes.createWidgetEvent(),
      configureEvent: widgetTypes.createWidgetEvent(),
    } as any

    render(
      <Suspense fallback={<span>loading</span>}>
        <Widget {...props} />
      </Suspense>,
    )

    const element = await screen.findByTestId('widget-stub')
    // The Angular class name minus `Component` is the export name
    expect(element.dataset.name).toBe(key.replace(/Component$/, ''))
    expect(element.dataset.component).toBe(key)
  })
})
