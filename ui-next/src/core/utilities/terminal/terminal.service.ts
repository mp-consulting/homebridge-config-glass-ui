import type { FitAddon } from '@xterm/addon-fit'
import type { IDisposable, ITerminalOptions, Terminal } from '@xterm/xterm'
import type { TouchEvent as ReactTouchEvent } from 'react'

import type { ResizeSource, TerminalApi, TerminalFactory, TerminalNamespace, TerminalWs } from './types'

import { debounce, subscribeResize } from './types'

export interface TerminalServiceDeps {
  terminals: TerminalFactory
  ws: TerminalWs
  api: TerminalApi
}

interface Size { cols: number, rows: number }

/**
 * Drives the interactive shell (`platform-tools/terminal` namespace).
 *
 * One app-wide instance (`terminalService` in `./index`): the session can
 * outlive the page that shows it when terminal persistence is on, so the
 * full-page terminal and the dashboard widget share it.
 */
export class TerminalService {
  private io!: TerminalNamespace
  private fitAddon!: FitAddon
  private dataDisposable: IDisposable | null = null
  private isInitializing = false
  private hasUserTyped = false
  // Whether startSession() should grab keyboard focus. The full-page terminal wants
  // this (you land there to type); the dashboard widget opts out so it doesn't pull
  // focus and scroll the page down on first load.
  private autoFocusOnStart = true
  // Teardowns for everything that the Angular version ended with `takeUntil(destroy$)`
  private teardowns: Array<() => void> = []
  private sendResize: ((size: Size) => void) | null = null
  private touchStartY: number | null = null
  public term!: Terminal

  constructor(private readonly deps: TerminalServiceDeps) {}

  private runTeardowns() {
    const teardowns = this.teardowns
    this.teardowns = []
    teardowns.forEach(fn => fn())
    this.sendResize = null
  }

  public destroyTerminal() {
    this.runTeardowns()

    if (this.dataDisposable) {
      this.dataDisposable.dispose()
      this.dataDisposable = null
    }
    // Remove socket event listeners before ending the connection. The socket
    // is cached by the ws layer and outlives this terminal — any listener left
    // behind would fire against the nulled `term` the next time the socket
    // disconnects (e.g. the ws layer bouncing sockets on token rotation).
    if (this.io && this.io.socket) {
      this.io.socket.removeAllListeners('disconnect')
      this.io.socket.removeAllListeners('stdout')
      this.io.socket.removeAllListeners('process-exit')
    }
    if (this.io) {
      this.io.end()
    }
    if (this.term) {
      this.term.dispose()
      this.term = null as unknown as Terminal
    }

    // Reset for next session
    this.isInitializing = false
    this.hasUserTyped = false
  }

  public async destroyPersistentSession(): Promise<void> {
    // First destroy the frontend terminal
    this.destroyTerminal()

    // Then tell the backend to destroy the persistent session via HTTP API
    try {
      await this.deps.api.post('/platform-tools/terminal/destroy-persistent-session', {})
    } catch (error) {
      console.error('Failed to destroy persistent session:', error)
    }
  }

  public detachTerminal() {
    // Clean up UI components but keep socket connection alive for persistence
    this.runTeardowns()

    if (this.dataDisposable) {
      this.dataDisposable.dispose()
      this.dataDisposable = null
    }
    if (this.term) {
      this.term.dispose()
    }

    // Note: We intentionally do NOT call this.io.end() here to keep the connection alive
    // Keep hasUserTyped state for persistence mode
    this.isInitializing = false
  }

  public hasActiveSession(): boolean {
    return Boolean(this.io && this.io.socket && this.io.socket.connected)
  }

  public hasUserTypedInSession(): boolean {
    return this.hasUserTyped
  }

  public isTerminalReady(): boolean {
    return Boolean(this.term) && !this.isInitializing
  }

  public activateTerminal(): void {
    if (this.isTerminalReady() && this.term) {
      this.term.focus()
    }
  }

  public onTouchStart(event: TouchEvent | ReactTouchEvent): void {
    this.touchStartY = event.touches[0].clientY
  }

  public onTouchEnd(event: TouchEvent | ReactTouchEvent): void {
    if (this.touchStartY === null) {
      return
    }
    const deltaY = Math.abs(event.changedTouches[0].clientY - this.touchStartY)
    this.touchStartY = null
    // Only focus if the finger barely moved (tap, not scroll)
    if (deltaY < 10) {
      this.activateTerminal()
    }
  }

  /** Create the terminal + addons, open it in `target`, and schedule the first fit. */
  private openTerminal(target: HTMLElement, termOpts: ITerminalOptions) {
    // Create addons
    this.fitAddon = this.deps.terminals.createFitAddon()
    const webLinksAddon = this.deps.terminals.createWebLinksAddon()

    // Create a terminal instance
    this.term = this.deps.terminals.createTerminal(termOpts)

    // Load addons before open
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(webLinksAddon)

    // Open the terminal in the target element
    this.term.open(target)

    // Fit to the element
    const fitAddon = this.fitAddon
    setTimeout(() => {
      fitAddon.fit()
    })

    // Send resize events to server (debounced 500ms)
    const sendResize = debounce((size: Size) => {
      this.io.socket.emit('resize', size)
    }, 500)
    this.sendResize = sendResize
    this.teardowns.push(() => sendResize.cancel())
  }

  /** Wire stdin and client resize; refit on element resize. */
  private wireTerminal(elementResize?: ResizeSource) {
    // Dispose any existing data listener first
    if (this.dataDisposable) {
      this.dataDisposable.dispose()
    }
    // Handle outgoing data events from client to server
    this.dataDisposable = this.term.onData((data) => {
      this.hasUserTyped = true
      this.io.socket.emit('stdin', data)
    })

    // Handle resize events from the client
    this.term.onResize((size) => {
      this.sendResize?.(size)
    })

    if (elementResize) {
      // Subscribe to grid resize event
      const fitAddon = this.fitAddon
      const refit = debounce(() => fitAddon.fit(), 100)
      const unsubscribe = subscribeResize(elementResize, () => refit())
      this.teardowns.push(() => {
        refit.cancel()
        unsubscribe()
      })
    }
  }

  public reconnectTerminal(target: HTMLElement, termOpts: ITerminalOptions = {}, elementResize?: ResizeSource, autoFocus = true): boolean {
    if (this.isInitializing) {
      return false
    }

    this.isInitializing = true
    this.autoFocusOnStart = autoFocus

    // Reuse existing connection if still active
    if (this.io && this.io.socket && this.io.socket.connected) {
      this.openTerminal(target, termOpts)

      // Remove existing listeners to avoid duplicates
      this.io.socket.removeAllListeners('stdout')
      this.io.socket.removeAllListeners('process-exit')

      // Subscribe to incoming data events from server to client
      this.io.socket.on('stdout', (data: string) => {
        this.term.write(data)
      })

      // Handle terminal process exit - immediately start new session
      this.io.socket.on('process-exit', () => {
        this.startSession()
      })

      this.wireTerminal(elementResize)

      // Rejoin the existing session
      this.io.socket.emit('start-session', {
        cols: this.term.cols,
        rows: this.term.rows,
      })

      this.isInitializing = false
      return true
    } else {
      // No active connection, start fresh.
      //
      // Release the flag first: `startTerminal` has the same `isInitializing`
      // guard at the top, so handing over while it is still set made it refuse
      // straight away — `reconnectTerminal` returned false having done nothing
      // at all. The terminal widget reaches this path whenever it re-initialises
      // after the socket has dropped (a server restart, then coming back to the
      // dashboard): it asks to reconnect because a terminal object still exists,
      // and the user was left looking at a dead terminal until a page reload.
      this.isInitializing = false
      return this.startTerminal(target, termOpts, elementResize, autoFocus)
    }
  }

  public startTerminal(target: HTMLElement, termOpts: ITerminalOptions = {}, elementResize?: ResizeSource, autoFocus = true): boolean {
    if (this.isInitializing) {
      return false
    }

    this.isInitializing = true
    this.autoFocusOnStart = autoFocus

    // Connect to the websocket endpoint
    this.io = this.deps.ws.connectToNamespace('platform-tools/terminal')

    this.openTerminal(target, termOpts)

    // Start the terminal session when the socket is connected (after a 200ms settle)
    const onConnected = debounce(() => this.startSession(), 200)
    const unsubscribeConnected = this.io.connected.subscribe(() => onConnected())
    this.teardowns.push(() => {
      onConnected.cancel()
      unsubscribeConnected()
    })

    // Strip any prior listeners on the cached socket — the WS namespace
    // cache may hand back the same `socket` instance on a remount, and
    // without this `startTerminal` would stack a fresh `disconnect`,
    // `process-exit`, and `stdout` handler on top of the old ones every
    // time the terminal widget was attached, doubling (then tripling)
    // the user-visible output over time. `reconnectTerminal` already
    // does the same cleanup before re-registering.
    this.io.socket.removeAllListeners('disconnect')
    this.io.socket.removeAllListeners('process-exit')
    this.io.socket.removeAllListeners('stdout')

    // Handle disconnect events. `term` may be gone while the listener is
    // still attached (detachTerminal keeps the socket alive on purpose), so
    // guard the write.
    this.io.socket.on('disconnect', () => {
      this.term?.write(
        '\n\r\n\rTerminal disconnected. Is the server running?\n\r\n\r',
      )
    })

    // Handle terminal process exit - immediately start new session
    this.io.socket.on('process-exit', () => {
      this.startSession()
    })

    // Subscribe to incoming data events from server to client
    this.io.socket.on('stdout', (data: string) => {
      this.term.write(data)
    })

    this.wireTerminal(elementResize)
    return true
  }

  private startSession() {
    this.term.reset()
    this.hasUserTyped = false
    this.io.socket.emit('start-session', {
      cols: this.term.cols,
      rows: this.term.rows,
    })
    this.sendResize?.({ cols: this.term.cols, rows: this.term.rows })
    this.isInitializing = false
    if (this.autoFocusOnStart) {
      this.term.focus()
    }
  }
}
