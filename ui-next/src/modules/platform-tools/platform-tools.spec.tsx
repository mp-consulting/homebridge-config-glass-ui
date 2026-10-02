import type { FakeApi, FakeIoNamespace, FakeWs } from '@/testing'
import type { ReactElement } from 'react'
import type { Mock } from 'vitest'

import { act, fireEvent, screen } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetSettingsStore, settingsActions, useSettingsStore } from '@/core/settings'
import { ContainerRestart } from '@/modules/platform-tools/docker/container-restart/ContainerRestart'
import { StartupScript } from '@/modules/platform-tools/docker/startup-script/StartupScript'
import { RestartLinux } from '@/modules/platform-tools/linux/restart-linux/RestartLinux'
import { ShutdownLinux } from '@/modules/platform-tools/linux/shutdown-linux/ShutdownLinux'
import { fakeApi, fakeWs, makeSettingsState, renderWithProviders, toastStub } from '@/testing'

const holder = vi.hoisted(() => ({
  ws: null as FakeWs | null,
  toast: null as ReturnType<typeof toastStub> | null,
  isMobile: false,
  md: null as null | { disableTouchMove: Mock<() => void>, enableTouchMove: Mock<() => void> },
  editor: null as any,
}))
vi.mock('@/core/ws', () => ({
  get ws() {
    return holder.ws
  },
}))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return holder.toast
  },
}))
vi.mock('@/core/utilities/mobile-detect', () => ({
  mobileDetect: {
    detect: { mobile: () => (holder.isMobile ? 'iPhone' : null) },
    disableTouchMove: () => holder.md!.disableTouchMove(),
    enableTouchMove: () => holder.md!.enableTouchMove(),
  },
}))
// The startup script page renders a Monaco editor; a stand-in hands the page a
// fake editor the way `onMount` would
vi.mock('@/core/monaco', () => ({
  MonacoEditor: ({ onMount, wrapperProps }: { onMount: (editor: unknown) => void, wrapperProps?: Record<string, unknown> }) => {
    // Once, like the real editor's onMount
    const onMountRef = useRef(onMount)
    useEffect(() => {
      onMountRef.current(holder.editor)
    }, [])
    return <div data-testid="monaco" {...wrapperProps} />
  },
}))

/**
 * The platform tools pages: restarting or shutting down the host, restarting the
 * Docker container, and editing the container's startup script.
 *
 * The two restart pages are the same shape as the Homebridge restart page and
 * carry the same hazard: the `status` websocket namespace is shared and cached,
 * and `io.end()` deliberately leaves listeners attached. A page that does not
 * detach its own handler keeps toasting "restarted" and yanking the user back to
 * the home page from wherever they have since navigated to.
 *
 * Their timings differ because the things they are waiting for do: a container
 * comes back in seconds, a whole machine takes a minute or more.
 */
describe('the platform tools pages', () => {
  let api: FakeApi
  let toast: ReturnType<typeof toastStub>
  let io: FakeIoNamespace
  let getAppSettings: ReturnType<typeof vi.spyOn>
  let editorValue: string

  /**
   * A stand-in for the Monaco editor.
   */
  function fakeEditor() {
    return {
      getModel: () => ({
        getValue: () => editorValue,
        setValue: (value: string) => {
          editorValue = value
        },
      }),
      getAction: () => ({ run: vi.fn(async () => undefined) }),
      // Called on teardown
      dispose: vi.fn(),
    }
  }

  beforeEach(() => {
    resetSettingsStore()
    useSettingsStore.setState(makeSettingsState() as any)
    holder.isMobile = false
    holder.md = { disableTouchMove: vi.fn(), enableTouchMove: vi.fn() }
    holder.editor = fakeEditor()
    holder.ws = fakeWs()
    io = holder.ws.namespace('status')
    toast = toastStub()
    holder.toast = toast
    api = fakeApi()
    getAppSettings = vi.spyOn(settingsActions, 'getAppSettings').mockResolvedValue(undefined)
    editorValue = ''
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  /**
   * Build one of the pages.
   * @param ui - the page
   * @param options - how to set it up
   * @param options.script - the startup script the route loader supplies
   * @param options.arrange - registers responses on the freshly built fakes
   */
  async function open(ui: ReactElement, options: { script?: string, arrange?: () => void } = {}) {
    options.arrange?.()
    const script = options.script ?? '#!/bin/sh\n\necho hello'
    const view = renderWithProviders(<div />, {
      route: '/unused',
      initialEntries: ['/page'],
      routes: [{ path: '/page', element: ui, loader: () => ({ script }) }],
    })
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
    return view
  }

  const path = (view: Awaited<ReturnType<typeof open>>) => view.router.state.location.pathname
  const fire = (status: string) => act(() => io.socket.fire('homebridge-status', { status }))
  const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
  const errorAlert = (view: Awaited<ReturnType<typeof open>>) => view.container.querySelector('.alert-error')?.textContent ?? false
  const timedOut = (view: Awaited<ReturnType<typeof open>>) => view.container.querySelector('.alert-warning') !== null

  describe('restarting the host machine', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('asks the server to restart the host', async () => {
      const view = await open(<RestartLinux />)

      expect(api.lastCall('put', '/platform-tools/linux/restart-host')?.body).toEqual({})
      expect(api.callsTo('put', '/platform-tools/linux/restart-host')).toHaveLength(1)
      expect(errorAlert(view)).toBe(false)
    })

    it('shows an error when the restart cannot be started', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const view = await open(<RestartLinux />, {
        arrange: () => api.fail('put', '/platform-tools/linux/restart-host', new Error('not permitted')),
      })

      expect(errorAlert(view)).toBe('platform.linux.server_restart_error')
      expect(toast.at('error')).toHaveLength(1)
    })

    it('ignores a status event from the machine that is still going down', async () => {
      const view = await open(<RestartLinux />)

      // Most of the way through the settling period, so shortening the wait does
      // not still look like a pass
      await advance(29000)
      fire('ok')

      // A whole machine takes tens of seconds to even begin rebooting
      expect(path(view)).toBe('/page')
    })

    it('believes a status event after thirty seconds', async () => {
      const view = await open(<RestartLinux />)

      await advance(30000)
      fire('ok')

      expect(toast.at('success')[0].message).toBe('platform.linux.server_restarted')
      expect(path(view)).toBe('/')
    })

    it('announces the restart only once', async () => {
      await open(<RestartLinux />)
      await advance(30000)

      act(() => {
        io.socket.fire('homebridge-status', { status: 'ok' })
        io.socket.fire('homebridge-status', { status: 'pending' })
      })

      expect(toast.at('success')).toHaveLength(1)
    })

    it('warns after two minutes', async () => {
      const view = await open(<RestartLinux />)

      await advance(120000)

      expect(timedOut(view)).toBe(true)
      expect(toast.at('warning')[0].message).toBe('platform.linux.server_taking_long_time')
    })

    it('does not warn before then', async () => {
      const view = await open(<RestartLinux />)

      await advance(119000)

      expect(timedOut(view)).toBe(false)
    })

    it('detaches its status listener when the user navigates away', async () => {
      const view = await open(<RestartLinux />)
      expect(io.socket.handlers('homebridge-status')).toHaveLength(1)

      view.unmount()

      // `io.end()` leaves listeners in place on purpose, because the namespace is
      // shared, so this page has to remove its own
      expect(io.socket.handlers('homebridge-status')).toHaveLength(0)
      expect(io.end).toHaveBeenCalled()
    })

    it('does not navigate from an unrelated page after teardown', async () => {
      const view = await open(<RestartLinux />)
      await advance(30000)

      view.unmount()
      io.socket.fire('homebridge-status', { status: 'ok' })

      expect(toast.at('success')).toHaveLength(0)
    })

    it('re-subscribes and reloads its settings when the socket returns', async () => {
      await open(<RestartLinux />)

      act(() => io.markConnected())

      expect(io.socket.payloadsFor('monitor-server-status').length).toBeGreaterThan(1)
      expect(getAppSettings).toHaveBeenCalled()
    })
  })

  describe('restarting the docker container', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    it('asks the server to restart the container', async () => {
      const view = await open(<ContainerRestart />)

      expect(api.lastCall('put', '/platform-tools/docker/restart-container')?.body).toEqual({})
      expect(errorAlert(view)).toBe(false)
    })

    it('waits a shorter time than a whole machine reboot', async () => {
      const view = await open(<ContainerRestart />)

      await advance(9000)
      fire('ok')
      expect(path(view)).toBe('/page')

      // A container is back in seconds, so waiting thirty would leave the user
      // staring at a spinner long after it was ready
      await advance(1000)
      fire('ok')
      expect(path(view)).toBe('/')
    })

    it('says the container restarted, not the server', async () => {
      await open(<ContainerRestart />)
      await advance(10000)

      fire('ok')

      expect(toast.at('success')[0].message).toBe('platform.docker.container_restarted')
    })

    it('warns after a minute', async () => {
      const view = await open(<ContainerRestart />)

      await advance(60000)

      expect(timedOut(view)).toBe(true)
      expect(toast.at('warning')[0].options).toEqual({ timeOut: 10000 })
      // The hint names the docker flag, as markup
      expect(view.container.querySelector('.alert-warning p.grey-text')?.textContent).toBe('platform.docker.run_with_restart')
    })

    it('shows an error when the restart cannot be started', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const view = await open(<ContainerRestart />, {
        arrange: () => api.fail('put', '/platform-tools/docker/restart-container', new Error('no docker socket')),
      })

      expect(errorAlert(view)).toBe('restart.toast_server_restart_error')
    })

    it('detaches its status listener too', async () => {
      const view = await open(<ContainerRestart />)

      view.unmount()

      expect(io.socket.handlers('homebridge-status')).toHaveLength(0)
    })
  })

  describe('shutting down the host machine', () => {
    it('asks the server to shut the host down', async () => {
      const view = await open(<ShutdownLinux />)

      expect(api.lastCall('put', '/platform-tools/linux/shutdown-host')?.body).toEqual({})
      expect(api.callsTo('put', '/platform-tools/linux/shutdown-host')).toHaveLength(1)
      expect(errorAlert(view)).toBe(false)
    })

    it('waits for nothing, because nothing is coming back', async () => {
      await open(<ShutdownLinux />)

      // Unlike its restart sibling there is no socket, no timer and no
      // navigation: the machine is going away
      expect(holder.ws!.connectToNamespace).not.toHaveBeenCalled()
    })

    it('uses its own message rather than the restart one', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const view = await open(<ShutdownLinux />, {
        arrange: () => api.fail('put', '/platform-tools/linux/shutdown-host', new Error('not permitted')),
      })

      // Telling a user their shutdown failed to restart would be confusing; this
      // page has its own translated key
      expect(errorAlert(view)).toBe('platform.linux.server_shutdown_error')
      expect(toast.at('error')[0].message).toBe('platform.linux.server_shutdown_error')
    })
  })

  describe('editing the container startup script', () => {
    const saveButton = () => document.querySelector<HTMLButtonElement>('.btn.btn-primary')!
    const save = async () => {
      fireEvent.click(saveButton())
      await act(async () => {
        for (let tick = 0; tick < 10; tick += 1) {
          await Promise.resolve()
        }
      })
    }

    it('loads the script the loader fetched', async () => {
      await open(<StartupScript />, { script: '#!/bin/sh\n\necho hello' })

      // Resolved by the route rather than fetched here, so the editor never
      // shows an empty box first
      expect(editorValue).toBe('#!/bin/sh\n\necho hello')
    })

    it('saves what the editor holds', async () => {
      await open(<StartupScript />, { script: '#!/bin/sh\n\necho hello' })
      editorValue = '#!/bin/bash\n\necho goodbye'

      await save()

      expect(api.lastCall('put', '/platform-tools/docker/startup-script')?.body)
        .toEqual({ script: '#!/bin/bash\n\necho goodbye' })
      expect(toast.at('success')).toHaveLength(1)
    })

    it.each(['#!/bin/sh', '#!/bin/bash'])('accepts %s', async (hashbang) => {
      await open(<StartupScript />, { script: `${hashbang}\necho hi` })
      editorValue = `${hashbang}\necho hi`

      await save()

      expect(api.callsTo('put', '/platform-tools/docker/startup-script')).toHaveLength(1)
    })

    it('refuses a script with no hashbang and adds one', async () => {
      await open(<StartupScript />, { script: 'echo hello' })
      editorValue = 'echo hello'

      await save()

      // The container runs this directly, so without a hashbang it does not
      // execute at all - the script is repaired rather than just rejected
      expect(api.callsTo('put', '/platform-tools/docker/startup-script')).toHaveLength(0)
      expect(toast.at('error')[0].message).toBe('platform.docker.must_use_hashbang')
      expect(editorValue).toBe('#!/bin/sh\n\necho hello')
      expect(saveButton().disabled).toBe(false)
    })

    it('refuses a hashbang that is not on the first line', async () => {
      await open(<StartupScript />, { script: '# a comment\n#!/bin/sh' })
      editorValue = '# a comment\n#!/bin/sh'

      await save()

      expect(api.callsTo('put')).toHaveLength(0)
    })

    it('tolerates whitespace around the hashbang', async () => {
      await open(<StartupScript />, { script: '  #!/bin/sh  \necho hi' })
      editorValue = '  #!/bin/sh  \necho hi'

      await save()

      expect(api.callsTo('put', '/platform-tools/docker/startup-script')).toHaveLength(1)
    })

    it('re-enables the button when the save fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await open(<StartupScript />, { script: '#!/bin/sh\necho hi' })
      editorValue = '#!/bin/sh\necho hi'
      api.fail('put', '/platform-tools/docker/startup-script', new Error('read only'))

      await save()

      expect(saveButton().disabled).toBe(false)
      expect(toast.at('error')).toHaveLength(1)
    })

    it('ignores a second press while the first is in flight', async () => {
      await open(<StartupScript />, { script: '#!/bin/sh\necho hi' })
      editorValue = '#!/bin/sh\necho hi'

      fireEvent.click(saveButton())
      await save()

      // Two overlapping writes to the same file is how it ends up half written
      expect(api.callsTo('put', '/platform-tools/docker/startup-script')).toHaveLength(1)
    })

    it.each([
      ['ctrl+s', { ctrlKey: true }],
      ['cmd+s', { metaKey: true }],
    ])('saves on %s in the editor', async (_name, modifier) => {
      await open(<StartupScript />, { script: '#!/bin/sh\necho hi' })
      editorValue = '#!/bin/sh\necho hi'

      const event = fireEvent.keyDown(screen.getByTestId('monaco'), { key: 's', ...modifier })
      await act(async () => {
        for (let tick = 0; tick < 10; tick += 1) {
          await Promise.resolve()
        }
      })

      // The browser's own "save page" must not open over it
      expect(event).toBe(false)
      expect(api.callsTo('put', '/platform-tools/docker/startup-script')).toHaveLength(1)
    })

    /**
     * Making room for the on-screen keyboard.
     *
     * ⚠️ **The editor is full height, so an open keyboard would cover the line the
     * user is typing on.** The page listens to the visual viewport - the part of
     * the window not hidden by the keyboard - and lets the page scroll while it is
     * open, then locks scrolling again when it closes.
     */
    describe('the on-screen keyboard', () => {
      let viewportListener: (() => void) | undefined

      /**
       * Pretend the visible part of the window is a given height.
       * @param height - the visual viewport height
       */
      function viewportHeight(height: number) {
        Object.defineProperty(window, 'visualViewport', {
          value: {
            height,
            addEventListener: vi.fn((_event: string, listener: () => void) => {
              viewportListener = listener
            }),
            removeEventListener: vi.fn(),
          },
          configurable: true,
        })
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true })
      }

      const visualViewPortChanged = () => act(() => viewportListener!())

      afterEach(() => {
        delete (window as any).visualViewport
        viewportListener = undefined
      })

      it('locks touch scrolling while the page is open', async () => {
        viewportHeight(800)
        const view = await open(<StartupScript />)

        expect(holder.md!.disableTouchMove).toHaveBeenCalled()
        view.unmount()
        expect(holder.md!.enableTouchMove).toHaveBeenCalled()
      })

      it('lets the page scroll while the keyboard is up', async () => {
        // ⚠️ Locked, the user cannot scroll the line they are typing into view
        viewportHeight(800)
        await open(<StartupScript />)
        viewportHeight(400)

        visualViewPortChanged()

        expect(holder.md!.enableTouchMove).toHaveBeenCalled()
      })

      it('locks it again once the keyboard closes', async () => {
        viewportHeight(400)
        await open(<StartupScript />)
        holder.md!.disableTouchMove.mockClear()
        viewportHeight(800)

        visualViewPortChanged()

        expect(holder.md!.disableTouchMove).toHaveBeenCalled()
      })

      it('takes focus off the field when the keyboard closes', async () => {
        // ⚠️ Otherwise the keyboard reopens the moment the page is touched again,
        // because the field never lost focus.
        //
        // ⚠️ The whole open-then-close has to be driven: the blur fires on the
        // viewport growing back, which is only bigger than what the page last
        // recorded if the keyboard opened first
        viewportHeight(800)
        await open(<StartupScript />)
        const field = document.createElement('input')
        document.body.append(field)
        field.focus()

        viewportHeight(400)
        visualViewPortChanged()
        viewportHeight(800)
        visualViewPortChanged()

        expect(document.activeElement).not.toBe(field)
        field.remove()
      })

      it('leaves focus alone while the keyboard is opening', async () => {
        viewportHeight(800)
        await open(<StartupScript />)
        const field = document.createElement('input')
        document.body.append(field)
        field.focus()
        viewportHeight(400)

        visualViewPortChanged()

        expect(document.activeElement).toBe(field)
        field.remove()
      })
    })

    it('reads the script from the text box on a phone', async () => {
      holder.isMobile = true
      await open(<StartupScript />, { script: '#!/bin/sh\necho hi' })

      await save()

      // There is no Monaco editor on mobile, so reaching for one would throw
      expect(screen.queryByTestId('monaco')).toBeNull()
      expect(document.querySelector('textarea.hb-plain-text-editor')).not.toBeNull()
      expect(api.lastCall('put', '/platform-tools/docker/startup-script')?.body)
        .toEqual({ script: '#!/bin/sh\necho hi' })
    })

    it('saves what was typed on a phone', async () => {
      holder.isMobile = true
      await open(<StartupScript />, { script: '#!/bin/sh\necho hi' })

      fireEvent.change(document.querySelector('textarea')!, { target: { value: '#!/bin/bash\necho typed' } })
      await save()

      expect(api.lastCall('put', '/platform-tools/docker/startup-script')?.body)
        .toEqual({ script: '#!/bin/bash\necho typed' })
    })

    it('repairs a mobile script without touching an editor', async () => {
      holder.isMobile = true
      await open(<StartupScript />, { script: 'echo hi' })

      await save()

      expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('#!/bin/sh\n\necho hi')
      expect(api.callsTo('put')).toHaveLength(0)
    })
  })
})
