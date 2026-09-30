import type { UpdateAllJournal } from '@/app/core/update-all/update-all.interfaces'
import type { LogService } from '@/app/core/utilities/log.service'
import type { FakeSocket } from '@/testing'

import { createEnvironmentInjector, EnvironmentInjector, NO_ERRORS_SCHEMA } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { TranslatePipe } from '@ngx-translate/core'
import { firstValueFrom } from 'rxjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TtlCacheService } from '@/app/core/caching/ttl-cache.service'
import { SOCKET_FACTORY } from '@/app/core/communication/socket.factory'
import { WsService } from '@/app/core/communication/ws.service'
import { SAVE_AS } from '@/app/core/utilities/file-saver.factory'
import { TERMINAL_FACTORY } from '@/app/core/utilities/terminal.factory'
import { BridgesWidgetComponent } from '@/app/modules/status/widgets/bridges-widget/bridges-widget.component'
import { environment } from '@/environments/environment'
import { activeModalStub, fakeApi, fakeSaveAs, fakeSocket, fakeTerminals, makeAuth, makeSettings, modalServiceSpy, toastrStub } from '@/testing'
import { provideFakes, provideTestTranslate } from '@/testing/providers'

/**
 * ⚠️ No `vi.mock('socket.io-client')` here. The unit-test builder compiles the
 * app through its build target, so socket.io is bundled into the service and a
 * module mock never reaches it - the service would quietly open a real socket.
 * The factory token is the seam that survives bundling.
 */
const io = vi.fn()

describe('WsService', () => {
  let service: WsService
  let auth: ReturnType<typeof makeAuth>
  let sockets: FakeSocket[]

  beforeEach(() => {
    sockets = []
    vi.mocked(io).mockReset()
    vi.mocked(io).mockImplementation(() => {
      const socket = fakeSocket(false)
      sockets.push(socket)
      return socket as any
    })

    auth = makeAuth()
    TestBed.configureTestingModule({
      providers: [
        provideFakes({ auth }),
        { provide: SOCKET_FACTORY, useValue: io },
      ],
    })
    service = TestBed.inject(WsService)
  })

  describe('connecting', () => {
    it('opens the namespace with the app reconnection settings', () => {
      service.connectToNamespace('status')

      expect(io).toHaveBeenCalledTimes(1)
      const [url, options] = vi.mocked(io).mock.calls[0]
      expect(url).toBe(`${environment.api.socket}/status`)
      expect(options).toMatchObject({ reconnectionAttempts: 10, reconnectionDelayMax: 30000 })
    })

    it('sends the token that is current at each handshake', () => {
      service.connectToNamespace('status')
      const { auth: authCallback } = vi.mocked(io).mock.calls[0][1] as any

      // socket.io calls this again on every reconnect. A plain object would
      // freeze whatever the token was when the socket was built - which during
      // bootstrap is null, and the server then rejects every retry
      const first = vi.fn()
      authCallback(first)
      expect(first).toHaveBeenCalledWith({ token: 'test-access-token' })

      auth.token = 'rotated-token'
      const second = vi.fn()
      authCallback(second)
      expect(second).toHaveBeenCalledWith({ token: 'rotated-token' })
    })
  })

  describe('caching a namespace', () => {
    it('shares one socket between callers and does not open a second', () => {
      const first = service.connectToNamespace('status')
      const second = service.connectToNamespace('status')

      // Each caller gets its own handle (its own end()), over the same socket
      // and the same `connected` subject
      expect(second).not.toBe(first)
      expect(second.socket).toBe(first.socket)
      expect(second.connected).toBe(first.connected)
      expect(io).toHaveBeenCalledTimes(1)
    })

    it('registers the connect handler only once', () => {
      service.connectToNamespace('status')
      service.connectToNamespace('status')

      // Re-binding on a cache hit stacks a listener per call and eventually
      // trips MaxListenersExceededWarning, and doubles the emit on reconnect
      expect(sockets[0].handlers('connect')).toHaveLength(1)
    })

    it('opens a separate socket per namespace', () => {
      const status = service.connectToNamespace('status')
      const child = service.connectToNamespace('child-bridges')

      expect(child).not.toBe(status)
      expect(io).toHaveBeenCalledTimes(2)
    })

    it('replays the connection to a subscriber that arrives late', async () => {
      const namespace = service.connectToNamespace('status')

      sockets[0].fire('connect')

      // `connected` is a ReplaySubject(1) so a caller that subscribes after
      // the socket is already up still fires. This is what lets callers skip
      // an `if (socket.connected)` fallback, which would double-emit (#2806)
      await expect(firstValueFrom(namespace.connected!)).resolves.toBeUndefined()
    })
  })

  describe('getExistingNamespace', () => {
    it('returns nothing until the namespace has been opened', () => {
      expect(service.getExistingNamespace('status')).toBeUndefined()
    })

    it('returns the open namespace without opening another socket', () => {
      const opened = service.connectToNamespace('status')

      expect(service.getExistingNamespace('status').socket).toBe(opened.socket)
      expect(io).toHaveBeenCalledTimes(1)
    })

    it('hands a borrower no end(), so it cannot end the session it does not own', () => {
      service.connectToNamespace('status')

      expect(service.getExistingNamespace('status').end).toBeUndefined()
    })
  })

  describe('request', () => {
    it('emits the acknowledgement and completes', async () => {
      const namespace = service.connectToNamespace('status')
      sockets[0].respondTo('get-server-uptime-info', { time: { uptime: 42 } })

      await expect(firstValueFrom(namespace.request('get-server-uptime-info'))).resolves.toEqual({ time: { uptime: 42 } })
      expect(sockets[0].payloadsFor('get-server-uptime-info')).toEqual([undefined])
    })

    it('sends the payload with the request', async () => {
      const namespace = service.connectToNamespace('status')
      sockets[0].respondTo('get-server-network-info', {})

      await firstValueFrom(namespace.request('get-server-network-info', { netInterfaces: ['eth0'] }))

      expect(sockets[0].payloadsFor('get-server-network-info')).toEqual([{ netInterfaces: ['eth0'] }])
    })

    it('fails when the server acknowledges with an error', async () => {
      const namespace = service.connectToNamespace('status')
      sockets[0].respondTo('restart-child-bridge', { error: 'Bridge not found' })

      await expect(firstValueFrom(namespace.request('restart-child-bridge', 'AA:BB'))).rejects.toEqual({ error: 'Bridge not found' })
    })

    it('treats a null acknowledgement as an empty result', async () => {
      const namespace = service.connectToNamespace('status')
      sockets[0].respondTo('get-dashboard-init', null)

      // typeof null is 'object', so without the null guard this throws inside
      // the acknowledgement callback rather than resolving
      await expect(firstValueFrom(namespace.request('get-dashboard-init'))).resolves.toBeNull()
    })
  })

  describe('end', () => {
    it('tells the server to end the session but leaves the listeners alone', () => {
      const namespace = service.connectToNamespace('status')

      namespace.end!()

      expect(sockets[0].emitted.at(-1)?.event).toBe('end')
      // The namespace is shared - status feeds the dashboard and every widget -
      // so wiping listeners when one consumer closes would silence the rest
      expect(sockets[0].removeAllListeners).not.toHaveBeenCalled()
    })

    it('keeps the server session while another consumer still holds the namespace', () => {
      const first = service.connectToNamespace('log')
      service.connectToNamespace('log')

      first.end!()

      // 'end' drops every server-side subscription on the socket - including
      // the ones the second consumer is still reading
      expect(sockets[0].payloadsFor('end')).toHaveLength(0)
    })

    it('ends the server session when the last consumer releases', () => {
      const first = service.connectToNamespace('log')
      const second = service.connectToNamespace('log')

      first.end!()
      second.end!()

      expect(sockets[0].payloadsFor('end')).toHaveLength(1)
    })

    it('releases a consumer only once however often it ends', () => {
      const first = service.connectToNamespace('log')
      const second = service.connectToNamespace('log')

      // A stop() that runs twice must not give up the other consumer's hold
      first.end!()
      first.end!()
      expect(sockets[0].payloadsFor('end')).toHaveLength(0)

      second.end!()
      expect(sockets[0].payloadsFor('end')).toHaveLength(1)
    })

    it('counts afresh on the cached socket after the last release', () => {
      service.connectToNamespace('log').end!()
      const again = service.connectToNamespace('log')
      const other = service.connectToNamespace('log')

      again.end!()
      expect(sockets[0].payloadsFor('end')).toHaveLength(1)

      other.end!()
      expect(sockets[0].payloadsFor('end')).toHaveLength(2)
      expect(io).toHaveBeenCalledTimes(1)
    })

    it('counts each namespace on its own', () => {
      const log = service.connectToNamespace('log')
      service.connectToNamespace('status')

      log.end!()

      expect(sockets[0].payloadsFor('end')).toHaveLength(1)
      expect(sockets[1].payloadsFor('end')).toHaveLength(0)
    })
  })
})

/**
 * The real consumers that share a namespace, over the real WsService. Each of
 * these used to end the other's server session when it closed.
 */
describe('consumers sharing a namespace', () => {
  let sockets: Map<string, FakeSocket>
  let xterm: ReturnType<typeof fakeTerminals>

  /**
   * The fake socket for a namespace, created up front so a spec can arrange
   * acknowledgements before a consumer opens it.
   * @param namespace - e.g. 'log'
   */
  function socketFor(namespace: string): FakeSocket {
    if (!sockets.has(namespace)) {
      sockets.set(namespace, fakeSocket(false))
    }
    return sockets.get(namespace)!
  }

  // Comes up a tick after WsService binds its `connect` listener, the way a
  // real socket does
  const factory = vi.fn((url: string) => {
    const socket = socketFor(url.slice(`${environment.api.socket}/`.length))
    void Promise.resolve().then(() => {
      socket.connected = true
      socket.fire('connect')
    })
    return socket as any
  })

  async function settle() {
    for (let tick = 0; tick < 12; tick += 1) {
      await Promise.resolve()
    }
  }

  beforeEach(() => {
    TestBed.resetTestingModule()
    sockets = new Map()
    xterm = fakeTerminals()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('the dashboard logs widget and the plugin logs modal', () => {
    let widget: LogService
    let pluginLogs: LogService

    beforeEach(async () => {
      const { LogService } = await import('@/app/core/utilities/log.service')
      TestBed.configureTestingModule({
        providers: [
          provideTestTranslate(),
          provideFakes({ auth: makeAuth(), api: fakeApi(), toastr: toastrStub(), modal: modalServiceSpy() }),
          { provide: SOCKET_FACTORY, useValue: factory },
          { provide: TERMINAL_FACTORY, useValue: xterm.factory },
          { provide: SAVE_AS, useValue: fakeSaveAs() },
        ],
      })
      // Each host provides its own LogService - the widget and the modal
      // opened over it hold one each
      const root = TestBed.inject(EnvironmentInjector)
      widget = createEnvironmentInjector([LogService], root).get(LogService)
      pluginLogs = createEnvironmentInjector([LogService], root).get(LogService)

      widget.startTerminal({ nativeElement: document.createElement('div') })
      pluginLogs.startTerminal({ nativeElement: document.createElement('div') }, {}, undefined, 'homebridge-example')
      await settle()
    })

    const line = '\u001B[36m[homebridge-example]\u001B[0m Hello\n\r'

    it('runs one server stream that both terminals read', () => {
      // Both ask; the server keeps one stream per socket and ignores the repeat
      expect(socketFor('log').payloadsFor('tail-log')).toHaveLength(2)

      socketFor('log').fire('stdout', line)

      expect(xterm.terminals[0].written.join('')).toContain('Hello')
      expect(xterm.terminals[1].written.join('')).toContain('Hello')
    })

    it('keeps the widget streaming when the modal closes', () => {
      pluginLogs.destroyTerminal()

      expect(socketFor('log').payloadsFor('end')).toHaveLength(0)
      socketFor('log').fire('stdout', line)
      expect(xterm.terminals[0].written.join('')).toContain('Hello')
    })

    it('keeps the modal streaming when the widget goes away first', () => {
      widget.destroyTerminal()

      expect(socketFor('log').payloadsFor('end')).toHaveLength(0)
      socketFor('log').fire('stdout', line)
      expect(xterm.terminals[1].written.join('')).toContain('Hello')
    })

    it('ends the stream once both have closed', () => {
      pluginLogs.destroyTerminal()
      widget.destroyTerminal()

      expect(socketFor('log').payloadsFor('end')).toHaveLength(1)
    })
  })

  describe('the update-all modal and the bridges widget', () => {
    const username = '0E:AA:BB:CC:DD:EE'

    it('leaves the widget its child bridge updates when the modal closes', async () => {
      vi.useFakeTimers()
      const api = fakeApi()
      const journal: UpdateAllJournal = {
        schemaVersion: 1,
        runId: 'run-1',
        startedAt: '2026-08-19T10:00:00.000Z',
        finishedAt: '2026-08-19T10:05:00.000Z',
        items: [{ type: 'plugin', name: 'homebridge-example', from: '1.0.0', to: '1.1.0', status: 'ok', childBridgeUsernames: [username] }],
        restart: { homebridge: 'not-needed', ui: 'not-needed', childBridges: 'done' },
      }
      api.respond('get', '/update-all/plan', {
        items: [{ type: 'plugin', name: 'homebridge-example', from: '1.0.0', to: '1.1.0', restartImpact: 'child-bridges', childBridgeUsernames: [username] }],
        needsReview: [],
        skipped: [],
      })
      api.respond('post', '/update-all/start', {})
      api.respond('get', '/update-all/journal', journal)
      socketFor('update-all').respondTo('subscribe', { active: false, journal })
      socketFor('status').respondTo('get-homebridge-status', { status: 'ok', name: 'Homebridge' })
      socketFor('child-bridges').respondTo('get-homebridge-child-bridge-status', [
        { username, name: 'Kitchen Bridge', plugin: 'homebridge-example', status: 'pending' },
      ])

      const { UpdateAllModalComponent } = await import('@/app/core/update-all/update-all-modal.component')
      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: 'restart', children: [] }]),
          provideTestTranslate(),
          provideFakes({
            api,
            auth: makeAuth({ user: { admin: true } }),
            settings: makeSettings(),
            toastr: toastrStub(),
            activeModal: activeModalStub(),
          }),
          { provide: TtlCacheService, useValue: { invalidateAll: vi.fn() } },
          { provide: SOCKET_FACTORY, useValue: factory },
          { provide: TERMINAL_FACTORY, useValue: xterm.factory },
        ],
      })
      for (const component of [BridgesWidgetComponent, UpdateAllModalComponent]) {
        TestBed.overrideComponent(component, { set: { imports: [TranslatePipe], schemas: [NO_ERRORS_SCHEMA] } })
      }

      const bridges = TestBed.createComponent(BridgesWidgetComponent)
      bridges.componentRef.setInput('widget', { component: 'BridgesWidgetComponent' })
      bridges.detectChanges()
      await settle()

      const modal = TestBed.createComponent(UpdateAllModalComponent)
      modal.detectChanges()
      await settle()
      await modal.componentInstance.confirm()
      await settle()
      modal.detectChanges()
      vi.advanceTimersByTime(1)

      // The run finished with a child bridge restart, so the modal watches the
      // shared child-bridges socket alongside the widget
      expect(modal.componentInstance.phase()).toBe('summary')
      expect(socketFor('child-bridges').payloadsFor('monitor-child-bridge-status')).toHaveLength(2)

      modal.destroy()

      expect(socketFor('child-bridges').payloadsFor('end')).toHaveLength(0)
      socketFor('child-bridges').fire('child-bridge-status-update', { username, name: 'Kitchen Bridge', status: 'ok' })
      expect(bridges.componentInstance.childBridges()[0].status).toBe('ok')

      bridges.destroy()

      expect(socketFor('child-bridges').payloadsFor('end')).toHaveLength(1)
    })
  })
})
