import type { FitAddon } from '@xterm/addon-fit'
import type { ITerminalOptions, Terminal } from '@xterm/xterm'

import type {
  ConfirmFn,
  ResizeSource,
  SaveAs,
  TerminalApi,
  TerminalFactory,
  TerminalNamespace,
  TerminalWs,
  ToastFn,
  TranslateFn,
} from './types'

import { RE_ANSI_SIMPLE, RE_BRACKET_TAG } from '@/core/regex.constants'
import { debounce } from '@/core/utilities/debounce'

import { subscribeResize } from './types'

/**
 * xterm.js always renders a hidden <textarea class="xterm-helper-textarea"> to
 * capture keyboard input. Even with `disableStdin: true` it stays in the DOM
 * and screen readers find it as a focusable "Terminal input" form field — but
 * on read-only views (logs, install progress, restore output) there's nothing
 * to type into it.
 *
 * xterm internally rebuilds parts of its DOM as it renders, so a one-shot
 * patch after `term.open()` isn't enough — a MutationObserver watches the host
 * element and re-applies the patch whenever xterm regenerates the subtree.
 *
 * Returns a disposer the caller must invoke when the terminal goes away, to
 * release the observer.
 */
export function hideXtermInputFromScreenReader(host: HTMLElement): () => void {
  const apply = () => {
    const ta = host.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    if (!ta) {
      return
    }
    // Hide from the AX tree and the tab order, but DO NOT set `disabled` and
    // DO NOT blur it. xterm copies a selection by focusing this textarea so the
    // browser's `copy` event reaches xterm's handler — a disabled (or blurred)
    // textarea can't take focus, which silently breaks Ctrl+C/Cmd+C copy on
    // every read-only view that uses this helper (logs page + widget, scope
    // switch, restore).
    // `aria-hidden` + `tabindex="-1"` already keep it off the screen reader and
    // out of the tab order, while leaving click/programmatic focus intact.
    ta.setAttribute('aria-hidden', 'true')
    ta.setAttribute('tabindex', '-1')
    ta.setAttribute('readonly', 'true')
  }

  apply()
  // xterm creates the helper textarea lazily on first render; cover the
  // common timing windows.
  setTimeout(apply, 0)
  setTimeout(apply, 50)
  setTimeout(apply, 250)

  const observer = new MutationObserver(apply)
  observer.observe(host, { childList: true, subtree: true })

  return () => observer.disconnect()
}

export interface LogServiceDeps {
  terminals: TerminalFactory
  ws: TerminalWs
  api: TerminalApi
  confirm: ConfirmFn
  toast: ToastFn
  t: TranslateFn
  saveAs: SaveAs
}

interface Size { cols: number, rows: number }

/**
 * Drives one read-only log terminal.
 *
 * ⚠️ Not a singleton: it holds per-terminal state (the xterm instance, the
 * plugin filter, the log buffer, the teardowns), so each host creates its own
 * (`useLog` does). When it was shared, opening the plugin logs modal over the
 * dashboard logs widget made the two clobber each other.
 */
export class LogService {
  private io!: TerminalNamespace
  private fitAddon!: FitAddon
  private pluginName: string | undefined
  private searchFilter: string | null = null
  private logBuffer: string[] = []
  private readonly maxBufferSize = 1000 // Maximum number of log chunks to keep in buffer
  private teardowns: Array<() => void> = []
  private xtermA11yDisposer: (() => void) | null = null
  // Kept as references so destroyTerminal can `off()` exactly these: the `log`
  // namespace is cached and shared, so removing every listener for the event
  // would also silence any other terminal tailing on the same socket
  private stdoutHandler?: (data: string) => void
  private disconnectHandler?: () => void

  public term!: Terminal

  constructor(private readonly deps: LogServiceDeps) {}

  public startTerminal(
    target: HTMLElement,
    termOpts: ITerminalOptions = {},
    elementResize?: ResizeSource,
    pluginName?: string,
  ) {
    this.pluginName = pluginName

    // Connect to the websocket endpoint
    this.io = this.deps.ws.connectToNamespace('log')

    // Create addons
    this.fitAddon = this.deps.terminals.createFitAddon()
    const webLinksAddon = this.deps.terminals.createWebLinksAddon()

    // Create a terminal instance (always read-only)
    this.term = this.deps.terminals.createTerminal({ ...termOpts, disableStdin: true })

    // Load addons
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(webLinksAddon)

    // Open the terminal in the target element
    this.term.open(target)

    // xterm.js always renders a hidden <textarea.xterm-helper-textarea> to
    // capture keyboard input. On read-only views (`disableStdin: true`) that
    // textarea swallows nothing — but screen readers still find it as a
    // focusable "Terminal input" form field. Hide it from the AX tree.
    this.xtermA11yDisposer?.()
    this.xtermA11yDisposer = hideXtermInputFromScreenReader(target)

    // Fit to the element
    const fitAddon = this.fitAddon
    setTimeout(() => {
      fitAddon.fit()
    })

    // Start the terminal session when the socket is connected.
    // `IoNamespace.connected` replays its last value, so this subscription
    // reliably fires for both fresh and cache-hit paths — do NOT also emit
    // `tail-log` synchronously here, or the server will attach two log streams
    // to this socket and every line is delivered twice (see #2806).
    //
    // A second LogService on the same page (the plugin logs modal over the
    // dashboard logs widget) shares this socket and sends its own `tail-log`.
    // The server keeps one stream per socket and ignores the repeat, so both
    // terminals read the first one's `stdout`; the stream only stops when the
    // last of them ends its ws handle (see destroyTerminal).
    this.teardowns.push(this.io.connected.subscribe(() => {
      this.term.reset()
      this.logBuffer = []
      this.io.socket.emit('tail-log', { cols: this.term.cols, rows: this.term.rows })
    }))

    // Handle disconnect events
    this.disconnectHandler = () => {
      this.term.write('\n\r\n\rWebsocket failed to connect. Is the server running?\n\r\n\r')
    }
    this.io.socket.on('disconnect', this.disconnectHandler)

    // Send resize events to server
    const sendResize = debounce((size: Size) => {
      this.io.socket.emit('resize', size)
    }, 500)
    this.teardowns.push(() => sendResize.cancel())

    // Subscribe to incoming data events from server to client
    this.stdoutHandler = (data: string) => {
      if (this.pluginName) {
        const lines = data.split('\n\r')
        let includeNextLine = false

        lines.forEach((line: string) => {
          if (!line) {
            return
          }

          if (includeNextLine) {
            if (RE_BRACKET_TAG.test(line)) {
              includeNextLine = false
            } else {
              this.term.write(`${line}\n\r`)
              return
            }
          }

          if (line.includes(`36m[${this.pluginName}]`)) {
            this.term.write(`${line}\n\r`)
            includeNextLine = true
          }
        })
      } else {
        // Store raw data in buffer
        this.logBuffer.push(data)

        // Limit buffer size to prevent memory issues
        if (this.logBuffer.length > this.maxBufferSize) {
          this.logBuffer.shift() // Remove oldest entry
        }

        // Apply search filter if active
        if (this.searchFilter) {
          const lines = data.split('\n\r')
          lines.forEach((line: string) => {
            if (line && this.lineMatchesFilter(line)) {
              this.term.write(`${line}\n\r`)
            }
          })
        } else {
          this.term.write(data)
        }
      }
    }
    this.io.socket.on('stdout', this.stdoutHandler)

    // Handle resize events from the client
    this.term.onResize((size) => {
      sendResize(size)
    })

    if (elementResize) {
      // Subscribe to grid resize event
      const refit = debounce(() => fitAddon.fit(), 100)
      const unsubscribe = subscribeResize(elementResize, () => refit())
      this.teardowns.push(() => {
        refit.cancel()
        unsubscribe()
      })
    }
  }

  public setSearchFilter(filter: string): void {
    this.searchFilter = filter.toLowerCase()
    this.redrawTerminalWithFilter()
  }

  public clearSearchFilter(): void {
    this.searchFilter = null
    this.redrawTerminalWithFilter()
  }

  public getSearchFilter(): string | null {
    return this.searchFilter
  }

  public scrollToBottom(): void {
    if (this.term) {
      // Use setTimeout to ensure scrolling happens after any pending terminal updates
      setTimeout(() => this.term.scrollToLine(this.term.buffer.active.length), 10)
    }
  }

  private lineMatchesFilter(line: string): boolean {
    if (!this.searchFilter) {
      return true
    }
    // Strip ANSI color codes before searching
    const cleanLine = line.replace(RE_ANSI_SIMPLE, '').toLowerCase()
    return cleanLine.includes(this.searchFilter)
  }

  private redrawTerminalWithFilter(): void {
    if (!this.term) {
      return
    }

    // Clear the terminal
    this.term.clear()

    // Redraw all buffered logs with filter
    this.logBuffer.forEach((data: string) => {
      if (this.searchFilter) {
        const lines = data.split('\n\r')
        lines.forEach((line: string) => {
          if (line && this.lineMatchesFilter(line)) {
            this.term.write(`${line}\n\r`)
          }
        })
      } else {
        this.term.write(data)
      }
    })
  }

  public async downloadLogFile(): Promise<void> {
    const { t } = this.deps
    const confirmed = await this.deps.confirm({
      title: t('logs.title_download_log_file'),
      message: t('logs.download_warning'),
      confirmButtonLabel: t('form.button_download'),
      faIconClass: 'fas fa-user-secret primary-text',
    })
    if (!confirmed) {
      // Modal dismissed, do nothing
      return
    }

    try {
      const res = await this.deps.api.get('/platform-tools/hb-service/log/download', { observe: 'response', responseType: 'blob' })
      const body = res.body

      // If a search filter is active, filter the downloaded log content client-side
      if (this.searchFilter) {
        const logText = await body.text()
        const filter = this.searchFilter
        const filteredLines = logText.split('\n').filter((line: string) => {
          const cleanLine = line.replace(RE_ANSI_SIMPLE, '').toLowerCase()
          return cleanLine.includes(filter)
        })
        const filteredBlob = new Blob([filteredLines.join('\n')], { type: 'text/plain' })
        this.deps.saveAs(filteredBlob, 'homebridge.log.txt')
      } else {
        this.deps.saveAs(body, 'homebridge.log.txt')
      }
    } catch (err) {
      let message: string | undefined
      try {
        // A blob request carries the server's JSON error as a Blob
        if (err && typeof err === 'object' && 'error' in err) {
          const error = (err as { error: unknown }).error
          if (error instanceof Blob) {
            message = JSON.parse(await error.text()).message
          } else if (error && typeof error === 'object' && 'message' in error) {
            message = String((error as { message: unknown }).message)
          }
        }
      } catch (error) {
        console.error(error)
      }
      this.deps.toast.error(message || t('logs.download.error'), t('toast.title_error'))
    }
  }

  public async truncateLogFile(): Promise<void> {
    const { t } = this.deps
    const confirmed = await this.deps.confirm({
      title: t('logs.title_truncate_log_file'),
      message: t('logs.truncate_log_warning'),
      confirmButtonLabel: t('form.button_delete'),
      confirmButtonClass: 'btn-danger',
      faIconClass: 'fas fa-circle-exclamation primary-text',
    })
    if (!confirmed) {
      // Modal dismissed, do nothing
      return
    }

    try {
      await this.deps.api.put('/platform-tools/hb-service/log/truncate', {})
      this.deps.toast.success(t('logs.log_file_truncated'), t('toast.title_success'))
      this.term?.clear()
    } catch (error) {
      console.error(error)
      const message = (error && typeof error === 'object' && 'error' in error && error.error && typeof error.error === 'object' && 'message' in error.error)
        ? String(error.error.message)
        : t('logs.truncate.error')
      this.deps.toast.error(message, t('toast.title_error'))
    }
  }

  public destroyTerminal() {
    // Complete all subscriptions
    const teardowns = this.teardowns
    this.teardowns = []
    teardowns.forEach(fn => fn())

    // Remove socket event listeners before ending connection
    if (this.io && this.io.socket) {
      if (this.stdoutHandler) {
        this.io.socket.off('stdout', this.stdoutHandler)
      }
      if (this.disconnectHandler) {
        this.io.socket.off('disconnect', this.disconnectHandler)
      }
    }
    this.stdoutHandler = undefined
    this.disconnectHandler = undefined

    if (this.io) {
      this.io.end()
    }

    if (this.term) {
      this.term.dispose()
    }

    this.xtermA11yDisposer?.()
    this.xtermA11yDisposer = null

    // Reset for next session
    this.logBuffer = []
    this.searchFilter = null
  }
}
