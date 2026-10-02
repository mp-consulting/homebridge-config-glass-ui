import type { ActiveModal } from '@/core/ui/modal'
import type { FakeTerminals, FakeWs } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SwitchToScoped } from '@/core/plugins/switch-to-scoped/SwitchToScoped'
import { useSettingsStore } from '@/core/settings'
import { fileSaver } from '@/core/utilities/file-saver'
import { xtermFactory } from '@/core/utilities/terminal'
import { ws as realWs } from '@/core/ws'
import { fakeApi, fakeTerminals, makeEnv, renderWithProviders, toastStub } from '@/testing'
import { showEnglish, showKeys } from '@/testing/i18n'

vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))

const toast = vi.hoisted(() => ({ current: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

const ws = realWs as unknown as FakeWs

describe('switching a plugin to its scoped name', () => {
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }
  let xterm: FakeTerminals
  let saveAs: Mock

  const plugin = {
    name: 'homebridge-example',
    newHbScope: { from: 'homebridge-example', to: '@homebridge-plugins/homebridge-example', switch: '2.0.0' },
  }

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toast.current = toastStub()
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    ws.namespaces.clear()
    xterm = fakeTerminals()
    vi.spyOn(xtermFactory, 'createTerminal').mockImplementation(xterm.factory.createTerminal)
    vi.spyOn(xtermFactory, 'createFitAddon').mockImplementation(xterm.factory.createFitAddon)
    vi.spyOn(xtermFactory, 'createWebLinksAddon').mockImplementation(xterm.factory.createWebLinksAddon)
    saveAs = vi.fn()
    vi.spyOn(fileSaver, 'saveAs').mockImplementation(saveAs)
  })

  async function open(options: { platform?: string, arrange?: (io: ReturnType<FakeWs['namespace']>) => void } = {}) {
    const api = fakeApi()
    useSettingsStore.setState({ env: makeEnv({ platform: (options.platform ?? 'linux') as any }) })
    const io = ws.namespace('plugins')
    io.socket.respondTo('install', {})
    io.socket.respondTo('uninstall', {})
    options.arrange?.(io)
    const view = renderWithProviders(<SwitchToScoped activeModal={activeModal} plugin={plugin} />)
    await act(async () => {})
    return { ...view, io, api }
  }

  async function doSwitch(view: Awaited<ReturnType<typeof open>>) {
    fireEvent.click(view.getByText('form.button_continue'))
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  it('gives the icon-only wiki link a translated name', async () => {
    await showEnglish()
    try {
      const view = await open()

      const link = view.getByRole('link', { name: 'About scoped plugins (opens in a new tab)' })
      expect(link).toHaveAttribute('href', 'https://github.com/homebridge/plugins/wiki/Scoped-Plugins')
      expect(link.querySelector('i')).toHaveAttribute('aria-hidden', 'true')
    } finally {
      await showKeys()
    }
  })

  it('installs the new name, then removes the old one, in that order', async () => {
    // The other way round would leave the user with no working plugin if the
    // install failed
    const view = await open()

    await doSwitch(view)

    expect(view.io.requests.map(request => request.resource)).toEqual(['install', 'uninstall'])
    expect(view.io.requests[0].payload).toMatchObject({ name: '@homebridge-plugins/homebridge-example', version: '2.0.0', termCols: 80, termRows: 24 })
    expect(view.io.requests[1].payload).toMatchObject({ name: 'homebridge-example' })
  })

  it('asks for a full service restart and sends the user to it', async () => {
    const view = await open()

    await doSwitch(view)

    await waitFor(() => expect(activeModal.close).toHaveBeenCalled())
    expect(view.api.lastCall('put')?.url).toBe('/platform-tools/hb-service/set-full-service-restart-flag')
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/restart'))
  })

  it('marks each step done as it finishes', async () => {
    const view = await open()
    // Hold the restart flag call so the finished steps stay on screen
    view.api.put.mockImplementation(() => new Promise(() => {}))

    await doSwitch(view)

    const icons = [...view.container.querySelectorAll('.switch-steps-list i')]
    expect(icons[0].className).toContain('fa-check-circle')
    expect(icons[1].className).toContain('fa-check-circle')
    expect(icons[2].className).toContain('fa-spin')
    expect(view.container.querySelector('.alert-error')).toBeNull()
  })

  it('stops before removing the old plugin when the install fails', async () => {
    // Removing it anyway would leave the user with nothing installed
    const view = await open({ arrange: io => io.socket.respondTo('install', { error: { message: 'not found on npm' } }) })

    await doSwitch(view)

    expect(view.io.requests.map(request => request.resource)).toEqual(['install'])
    const icons = [...view.container.querySelectorAll('.switch-steps-list i')]
    expect(icons[0].className).toContain('fa-times-circle')
    expect(icons[0].className).not.toContain('fa-spin')
    expect(view.container.querySelector('.alert-error')).toBeTruthy()
    expect(activeModal.close).not.toHaveBeenCalled()
    expect(view.router.state.location.pathname).toBe('/')
  })

  it('reports a failed removal without pretending it worked', async () => {
    const view = await open({ arrange: io => io.socket.respondTo('uninstall', { error: { message: 'permission denied' } }) })

    await doSwitch(view)

    const icons = [...view.container.querySelectorAll('.switch-steps-list i')]
    // Installed (the check is hidden once there is a failure), not uninstalled, no spinner left
    expect(icons[0].className).not.toContain('fa-times-circle')
    expect(icons[1].className).toContain('fa-times-circle')
    expect(view.container.querySelector('.switch-steps-list .fa-spin')).toBeNull()
    expect(toast.current!.error).toHaveBeenCalled()
  })

  it('shows the npm output in the terminal', async () => {
    const view = await open()

    act(() => view.io.socket.fire('stdout', 'added 1 package'))

    expect(xterm.terminals.at(-1)!.written.join('')).toContain('added 1 package')
  })

  it('keeps a plain-text copy of the output for the log download', async () => {
    // ⚠️ Stripped of the colour codes: the downloaded file is meant to be
    // readable in a text editor, and readable in a bug report
    const view = await open({ arrange: io => io.socket.respondTo('install', { error: { message: 'x' } }) })

    act(() => view.io.socket.fire('stdout', '\u001B[32madded 1 package\u001B[0m\n'))
    await doSwitch(view)
    fireEvent.click(view.getByText('form.button_download'))

    expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'homebridge-example-error.log')
    const saved = saveAs.mock.calls.at(-1)![0] as Blob
    expect(await saved.text()).toBe('added 1 package\r\n')
  })

  it('offers the online update everywhere but windows', async () => {
    // npm cannot replace a running package on Windows
    const linux = await open({ platform: 'linux' })
    expect(linux.queryByText('form.button_continue')).toBeTruthy()
    linux.unmount()

    const windows = await open({ platform: 'win32' })
    expect(windows.queryByText('form.button_continue')).toBeNull()
    expect(windows.container.querySelector('pre')?.textContent).toBe(
      'hb-service stop\nnpm install -g @homebridge-plugins/homebridge-example@2.0.0\nnpm uninstall -g homebridge-example\nhb-service start',
    )
    expect(windows.container.querySelector<HTMLElement>('#plugin-output')!.hidden).toBe(true)
  })

  it('closes the socket and the terminal when it goes away', async () => {
    const view = await open()

    view.unmount()

    expect(view.io.end).toHaveBeenCalled()
    expect(xterm.terminals.at(-1)!.dispose).toHaveBeenCalled()
    // The shared namespace must not keep feeding a disposed terminal
    view.io.socket.fire('stdout', 'late')
    expect(xterm.terminals.at(-1)!.written).toEqual([])
  })

  it('dismisses without switching anything', async () => {
    const view = await open()

    fireEvent.click(view.container.querySelector('.btn-close')!)

    expect(view.io.requests).toEqual([])
    expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
  })
})
