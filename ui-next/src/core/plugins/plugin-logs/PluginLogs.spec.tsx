import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi, FakeOpenModal } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Confirm } from '@/core/components/confirm/Confirm'
import { patchXtermLiveRegion } from '@/core/plugins/plugin-logs/plugin-logs.helpers'
import { PluginLogs } from '@/core/plugins/plugin-logs/PluginLogs'
import { settingsActions } from '@/core/settings'
import * as modalModule from '@/core/ui/modal'
import { fileSaver } from '@/core/utilities/file-saver'
import { fakeApi, makeChildBridge, makePlugin, renderWithProviders, toastStub } from '@/testing'

import '@/testing/i18n'

const log = vi.hoisted(() => ({ startTerminal: vi.fn(), destroyTerminal: vi.fn() }))
vi.mock('@/core/utilities/terminal', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/utilities/terminal')>()),
  createLogService: () => log,
}))
vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))

const toast = vi.hoisted(() => ({ current: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return toast.current
  },
}))

const modal = modalModule as unknown as FakeOpenModal

describe('viewing a plugin log', () => {
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }
  let api: FakeApi
  let saveAs: Mock

  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    toast.current = toastStub()
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    log.startTerminal.mockClear()
    log.destroyTerminal.mockClear()
    modal.opened.length = 0
    modal.openModal.mockClear()
    saveAs = vi.fn()
    vi.spyOn(fileSaver, 'saveAs').mockImplementation(saveAs)
  })

  async function openLogs(data: Record<string, any> = {}, arrange?: () => void) {
    api = fakeApi()
    api.respond('get', '/config-editor/plugin/homebridge-test', [{ platform: 'TestPlatform', name: 'Kitchen' }])
    arrange?.()
    const view = renderWithProviders(<PluginLogs activeModal={activeModal} plugin={makePlugin()} {...data} />)
    await act(async () => {})
    return view
  }

  const downloadButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.btn-primary')!
  const restartButton = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.btn-danger')!

  /** Click download and answer the secrets warning. */
  async function download(container: HTMLElement, answer: 'close' | 'dismiss' = 'close') {
    fireEvent.click(downloadButton(container))
    const ref = modal.lastOpened()!.ref
    await act(async () => {
      if (answer === 'close') {
        ref.close()
      } else {
        ref.dismiss('Dismiss')
      }
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  it('filters the log by the name from the config, not the plugin name', async () => {
    await openLogs()

    // Homebridge tags each line with the configured `name`, which is what the
    // user typed and may be nothing like the plugin's own name
    expect(log.startTerminal).toHaveBeenCalledWith(expect.any(HTMLElement), expect.anything(), expect.anything(), 'Kitchen')
  })

  it('falls back to the plugin name when the config has none', async () => {
    await openLogs({}, () => api.respond('get', '/config-editor/plugin/homebridge-test', [{ platform: 'TestPlatform' }]))

    expect(log.startTerminal.mock.calls[0][3]).toBe('homebridge-test')
  })

  it('uses the fixed tag for the ui itself', async () => {
    await openLogs({ plugin: makePlugin({ name: '@mp-consulting/homebridge-config-glass-ui' }) }, () =>
      api.respond('get', '/config-editor/plugin/%40mp-consulting%2Fhomebridge-config-glass-ui', [{ platform: 'config' }]))

    // The UI logs under a display name that never appears in its config
    expect(log.startTerminal.mock.calls[0][3]).toBe('Homebridge Glass UI')
  })

  it('opens a read-only terminal', async () => {
    const options = vi.spyOn(settingsActions, 'getTerminalOptions')
    await openLogs()

    expect(options).toHaveBeenCalledWith({ disableStdin: true })
    expect(log.startTerminal.mock.calls[0][1]).toMatchObject({ disableStdin: true })
  })

  it('reuses the config the editor already loaded', async () => {
    await openLogs({ editorContext: { config: [{ platform: 'TestPlatform', name: 'Hallway' }] } })

    expect(api.callsTo('get', '/config-editor/plugin/homebridge-test')).toHaveLength(0)
    expect(log.startTerminal.mock.calls[0][3]).toBe('Hallway')
  })

  it('closes itself when the config cannot be read', async () => {
    await openLogs({}, () => api.fail('get', '/config-editor/plugin/homebridge-test', new Error('offline')))

    expect(activeModal.dismiss).toHaveBeenCalled()
    expect(log.startTerminal).not.toHaveBeenCalled()
    expect(toast.current!.error).toHaveBeenCalledWith('offline', 'toast.title_error')
  })

  it('restarts each child bridge in turn', async () => {
    const { container } = await openLogs({
      childBridges: [makeChildBridge({ username: '0E:11:11:11:11:11' }), makeChildBridge({ username: '0E:22:22:22:22:22' })],
    })
    expect(restartButton(container).getAttribute('aria-label')).toBe('child_bridge.restart_plural')

    fireEvent.click(restartButton(container))

    await waitFor(() => expect(toast.current!.success).toHaveBeenCalled())
    expect(api.callsTo('put').map(call => call.url)).toEqual([
      '/server/restart/0E:11:11:11:11:11',
      '/server/restart/0E:22:22:22:22:22',
    ])
    expect(restartButton(container).disabled).toBe(false)
  })

  it('re-enables the buttons when a restart fails', async () => {
    const { container } = await openLogs(
      { childBridges: [makeChildBridge()] },
      () => api.fail('put', /\/server\/restart\//, new Error('not running')),
    )
    expect(restartButton(container).getAttribute('aria-label')).toBe('child_bridge.restart')

    fireEvent.click(restartButton(container))

    await waitFor(() => expect(toast.current!.error).toHaveBeenCalledWith('plugins.manage.child_bridge_restart_failed', 'toast.title_error'))
    expect(restartButton(container).disabled).toBe(false)
  })

  it('reports a download the server refused', async () => {
    const { container } = await openLogs({}, () => api.fail('get', /\/log\/download/, new Error('log unreadable')))

    await download(container)

    expect(toast.current!.error).toHaveBeenCalled()
    expect(saveAs).not.toHaveBeenCalled()
    // ⚠️ Re-enabled, or the download button is dead for the rest of the modal
    expect(downloadButton(container).disabled).toBe(false)
  })

  it('tells the terminal to re-measure when the window is resized', async () => {
    // The modal is sized off the window, so a resize leaves the terminal drawn
    // at the old width with the text wrapping in the wrong place
    await openLogs()
    const resizeSource = log.startTerminal.mock.calls[0][2]
    const resized = vi.fn()
    resizeSource.subscribe(resized)

    window.dispatchEvent(new Event('resize'))

    expect(resized).toHaveBeenCalled()
  })

  /**
   * What a screen reader hears.
   *
   * ⚠️ **xterm writes its own live region and asks for it to be assertive**,
   * which interrupts the reader on every line a busy plugin logs. The page turns
   * it down to polite so the log can be read at the user's own pace.
   */
  describe('the log for a screen reader', () => {
    it('quietens the live region xterm sets up', async () => {
      const { container } = await openLogs()
      const host = container.querySelector<HTMLElement>('.plugin-log-output')!
      const live = document.createElement('div')
      live.setAttribute('aria-live', 'assertive')
      host.append(live)

      patchXtermLiveRegion(host)

      expect(live.getAttribute('aria-live')).toBe('polite')
      expect(live.getAttribute('role')).toBe('status')
      expect(live.getAttribute('aria-atomic')).toBe('true')
    })

    it('copes with xterm not having built its live region yet', async () => {
      // The patch is queued on a frame callback that can beat xterm to it
      const { container } = await openLogs()

      expect(() => patchXtermLiveRegion(container.querySelector<HTMLElement>('.plugin-log-output'))).not.toThrow()
      expect(() => patchXtermLiveRegion(null)).not.toThrow()
    })
  })

  it('asks before downloading, because a log can contain secrets', async () => {
    const { container } = await openLogs()

    fireEvent.click(downloadButton(container))

    // Logs routinely carry tokens and passwords, so this warning is the only
    // thing standing between the user and pasting one into a public issue
    expect(modal.lastOpened()?.component).toBe(Confirm)
    expect(modal.propsFor()?.message).toBe('logs.download_warning')
    expect(downloadButton(container).disabled).toBe(true)
    await act(async () => modal.lastOpened()!.ref.dismiss('Dismiss'))
  })

  it('downloads nothing when the warning is dismissed', async () => {
    const { container } = await openLogs()

    await download(container, 'dismiss')

    expect(saveAs).not.toHaveBeenCalled()
    expect(downloadButton(container).disabled).toBe(false)
  })

  it('keeps only the lines belonging to this plugin', async () => {
    const { container } = await openLogs()
    api.respond('get', /\/log\/download/, {
      body: [
        '\u001B[37m[16/08/2026, 10:00:00]\u001B[39m \u001B[36m[Kitchen]\u001B[39m Kitchen line one',
        '  continuation of the kitchen line',
        '\u001B[37m[16/08/2026, 10:00:01]\u001B[39m \u001B[36m[Other Plugin]\u001B[39m not ours',
        '',
      ].join('\n'),
    })

    await download(container)

    const written = await (saveAs.mock.calls[0][0] as Blob).text()
    // A wrapped line has no tag of its own, so it is taken along until the
    // next tagged line appears
    expect(written).toContain('Kitchen line one')
    expect(written).toContain('continuation of the kitchen line')
    expect(written).not.toContain('not ours')
  })

  it('strips the colour codes out of the saved file', async () => {
    const { container } = await openLogs()
    api.respond('get', /\/log\/download/, {
      body: '\u001B[37m[16/08/2026, 10:00:00]\u001B[39m \u001B[36m[Kitchen]\u001B[39m plain please',
    })

    await download(container)

    const written = await (saveAs.mock.calls[0][0] as Blob).text()
    expect(written).not.toContain('\u001B[')
    expect(saveAs.mock.calls[0][1]).toBe('homebridge-test.log.txt')
  })

  it('asks for the log in colour so the tags can be matched', async () => {
    const { container } = await openLogs()
    api.respond('get', /\/log\/download/, { body: '' })

    await download(container)

    // The plugin tag is only identifiable by its colour code, so the colour
    // has to be requested and then stripped rather than never asked for
    const call = api.lastCall('get', /\/log\/download/)
    expect(call?.url).toContain('colour=yes')
    expect(call?.options).toEqual({ observe: 'response', responseType: 'text' })
  })

  it('re-enables the buttons when the download fails', async () => {
    const { container } = await openLogs({}, () => api.fail('get', /\/log\/download/, new Error('no log file')))

    await download(container)

    expect(downloadButton(container).disabled).toBe(false)
    expect(toast.current!.error).toHaveBeenCalledWith('logs.download.error', 'toast.title_error')
  })

  it('tears the terminal down on close', async () => {
    const { unmount } = await openLogs()

    unmount()

    // The terminal holds a socket and a buffer; the log modal is opened and
    // closed repeatedly from the plugin cards
    expect(log.destroyTerminal).toHaveBeenCalled()
  })
})
