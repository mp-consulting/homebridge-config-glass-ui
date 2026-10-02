import type { FakeIoNamespace, FakeWs } from '@/testing'

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ws as realWs } from '@/core/ws'
import { SystemInfoWidget } from '@/modules/status/widgets/system-info-widget/SystemInfoWidget'
import { createWidgetEvent } from '@/modules/status/widgets/widget.types'

vi.mock('@/core/ws/ws', async importOriginal => ({
  ...(await importOriginal<object>()),
  ws: (await import('@/testing')).fakeWs(),
}))

describe('the system info widget', () => {
  const ws = realWs as unknown as FakeWs
  let io: FakeIoNamespace

  async function open(options: { connected?: boolean, serverInfo?: any, nodejs?: any } = {}) {
    ws.namespaces.clear()
    io = ws.namespace('status', { connected: options.connected ?? true })
    io.socket.respondTo('get-homebridge-server-info', options.serverInfo ?? { os: {}, network: {}, time: {} })
    io.socket.respondTo('nodejs-version-check', options.nodejs ?? {})
    const result = render(
      <SystemInfoWidget
        widget={{ component: 'SystemInfoWidgetComponent', x: 0, y: 0, cols: 4, rows: 4, mobileOrder: 0, hideOnDesktop: false, hideOnMobile: false }}
        resizeEvent={createWidgetEvent()}
        configureEvent={createWidgetEvent()}
        updateWidget={vi.fn()}
        saveWidgets={vi.fn()}
      />,
    )
    await act(async () => {})
    return result
  }

  /** The table as `[label, value]` pairs. */
  const rows = (container: HTMLElement) => [...container.querySelectorAll('tr')].map(tr => [tr.querySelector('th')!.textContent, tr.querySelector('td')!.textContent])

  it('asks for the server and node details', async () => {
    const { container } = await open({
      serverInfo: {
        os: { distro: 'Raspbian GNU/Linux', codename: 'bookworm', release: '12', platform: 'linux', arch: 'arm64', hostname: 'pi' },
        network: { ip4: '10.0.0.2', iface: 'eth0' },
        time: { timezone: 'Europe/Paris' },
        homebridgeRunningInSynologyPackage: false,
        serviceUser: 'homebridge',
      },
      nodejs: { currentVersion: '22.0.0', installPath: '/usr/bin/node' },
    })

    expect(rows(container)).toEqual([
      ['status.widget.info.os', 'Raspbian GNU/Linux Bookworm (12)'],
      ['status.widget.info.arch', 'arm64 (64-bit)'],
      ['status.widget.info.ipv4 (eth0)', '10.0.0.2'],
      ['status.widget.info.hostname', 'pi'],
      ['status.widget.info.service_user', 'homebridge'],
      ['status.widget.info.nodejs_path', '/usr/bin/node'],
      ['status.widget.info.timezone', 'Europe/Paris'],
    ])
  })

  it('starts with an empty shape rather than nothing', async () => {
    // The template reads nested fields, so a null here would throw before the first response arrives
    const { container } = await open({ connected: false })

    expect(container.querySelectorAll('tr')).toHaveLength(0)
    expect(screen.getByText('status.widget.info')).toBeInTheDocument()
  })

  it('names the os differently on macOS and Windows', async () => {
    const mac = await open({ serverInfo: { os: { distro: 'macOS', codename: 'Sequoia', release: '15.1', platform: 'darwin', arch: 'x64' }, network: {}, time: {}, homebridgeRunningInSynologyPackage: false } })
    expect(rows(mac.container)[0][1]).toBe('macOS Sequoia (15.1)')
    mac.unmount()

    const win = await open({ serverInfo: { os: { distro: 'Windows 11', platform: 'win32', arch: 'ia32' }, network: {}, time: {}, homebridgeRunningInSynologyPackage: false } })
    expect(rows(win.container)).toEqual([
      ['status.widget.info.os', 'Windows 11'],
      ['status.widget.info.arch', 'ia32 (32-bit)'],
    ])
  })

  it('shows Synology DSM and the package flags', async () => {
    const { container } = await open({
      serverInfo: { os: { distro: 'Linux', arch: 'x64' }, network: {}, time: {}, homebridgeRunningInSynologyPackage: true, homebridgeRunningInDocker: true, homebridgePluginPath: '/plugins' },
    })

    expect(rows(container)).toEqual([
      ['status.widget.info.os', 'Synology DSM'],
      ['status.widget.info.arch', 'x64 (64-bit)'],
      ['status.widget.info.plugin_path', '/plugins'],
      ['status.widget.info.docker', 'status.widget.info.yes'],
      ['status.widget.info.synology_package', 'status.widget.info.yes'],
    ])
  })

  it('re-reads everything when the socket reconnects', async () => {
    await open()
    const before = io.requests.length

    await act(async () => {
      io.markConnected()
    })

    // The server may have been updated while it was away
    expect(io.requests.length).toBe(before + 2)
  })
})
