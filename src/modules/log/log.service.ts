import type { EventEmitter } from 'node:events'

import { exec, spawn } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { platform } from 'node:os'
import process from 'node:process'

import { Inject, Injectable } from '@nestjs/common'
import { satisfies } from 'semver'

import { createAuthorizedRunner } from '../../core/auth/guards/ws-auth.js'
import { ConfigService } from '../../core/config/config.service.js'
import { cyan, green, red, yellow } from '../../core/logger/colors.js'
import { Logger } from '../../core/logger/logger.service.js'
import { NodePtyService } from '../../core/node-pty/node-pty.service.js'
import { RE_SUPERVISOR_DEBUG_LINE, RE_SUPERVISOR_LEVEL_TAG } from '../../core/regex.constants.js'
import { isLogCommandAllowed, isProtectedStoragePath, LOG_COMMAND_RULE, LOG_PATH_RULE } from '../config-editor/config-safety.js'
import { TermSize } from '../platform-tools/terminal/terminal.interfaces.js'
import { NativeLogTail } from './native-log-tail.js'

// How long a trailing partial line is held back waiting for its terminator
// before being flushed to the client anyway
const PARTIAL_LINE_FLUSH_MS = 50

// What a shared log command keeps to replay to a viewer who joins later: as
// many lines as the commands show on start (`tail -n 500`, `journalctl -n
// 500`), and no more than this many characters however long the lines are
export const LOG_HISTORY_MAX_LINES = 500
export const LOG_HISTORY_MAX_CHARS = 256 * 1024

/**
 * One log command's child process, shared by everyone viewing it
 */
interface CommandStream {
  key: string
  clients: Set<EventEmitter>
  /** Recent output, replayed to a viewer who joins later */
  history: string
  /** Set once the last viewer left and the process is being killed */
  ending: boolean
  /** Set once the process exited, so a later kill cannot hit a reused pid */
  exited: boolean
  kill: () => void
  resize?: (size: { rows: number, cols: number }) => void
}

/**
 * Keep the last LOG_HISTORY_MAX_LINES lines (and at most
 * LOG_HISTORY_MAX_CHARS characters) of a stream's output, cut at a line start
 */
export function trimLogHistory(history: string): string {
  let trimmed = history
  if (trimmed.length > LOG_HISTORY_MAX_CHARS) {
    trimmed = trimmed.slice(-LOG_HISTORY_MAX_CHARS)
    const firstNewline = trimmed.indexOf('\n')
    if (firstNewline !== -1) {
      trimmed = trimmed.slice(firstNewline + 1)
    }
  }

  // Find the newline that ends the line before the last MAX_LINES lines
  let index = trimmed.length
  for (let count = 0; count <= LOG_HISTORY_MAX_LINES; count++) {
    index = trimmed.lastIndexOf('\n', index - 1)
    if (index === -1) {
      return trimmed.startsWith('\r') ? trimmed.slice(1) : trimmed
    }
  }
  const start = trimmed[index + 1] === '\r' ? index + 2 : index + 1
  return trimmed.slice(start)
}

@Injectable()
export class LogService {
  private command: string[]
  // Extra environment for the log command (the Windows log path is passed
  // to PowerShell this way rather than spliced into the script)
  private commandEnv: Record<string, string> = {}
  // Set when a custom log command was refused, to explain why to the client
  private refusedCommand: string | undefined
  // Set when the log path points at secrets in the storage directory
  private refusedPath: string | undefined
  private useNative = false
  private nativeTail: NativeLogTail | undefined
  // The running log commands, keyed by command and environment
  private commandStreams = new Map<string, CommandStream>()
  private activeClients = new WeakSet<EventEmitter>()
  private logBuffers = new WeakMap<EventEmitter, { buffer: string, flushTimeout: ReturnType<typeof setTimeout> }>()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(NodePtyService) private readonly nodePtyService: NodePtyService,
    @Inject(Logger) private readonly logger: Logger,
  ) {
    this.setLogMethod()
  }

  /**
   * Set the log method
   */
  public setLogMethod() {
    this.useNative = false
    this.commandEnv = {}
    this.refusedCommand = undefined
    this.refusedPath = undefined
    if (typeof this.configService.ui.log !== 'object') {
      this.logNotConfigured()
    } else if (['file', 'native'].includes(this.configService.ui.log.method) && isProtectedStoragePath(this.configService.ui.log.path, this.configService.storagePath)) {
      // A value saved before the check existed: checked again here, on use
      this.refusedPath = this.configService.ui.log.path
      this.logNotConfigured()
    } else if (this.configService.ui.log.method === 'file' && this.configService.ui.log.path) {
      this.logFromFile()
    } else if (this.configService.ui.log.method === 'native' && this.configService.ui.log.path) {
      this.useNative = true
      this.command = undefined
    } else if (this.configService.ui.log.method === 'systemd') {
      this.logFromSystemd()
    } else if (this.configService.ui.log.method === 'custom' && this.configService.ui.log.command) {
      this.logFromCommand()
    } else {
      this.logNotConfigured()
    }
  }

  /**
   * Socket handler
   * @param client
   * @param size
   */
  public connect(client: EventEmitter, size: TermSize) {
    // Guard against a single socket asking for a log stream twice. Without this,
    // duplicate `tail-log` events attach two listeners to the shared native Tail
    // / spawn two child processes, and every line is delivered to the client
    // twice (see #2806). The matching `delete` happens in the per-method `onEnd`
    // cleanups for paths that actually start a stream, or inline on the
    // early-exit paths below (no log file / unreadable / not configured). If an
    // early-exit path forgot to release the guard, the socket would stay
    // "active" forever and every later `tail-log` on the same (reused) socket
    // would be silently dropped — leaving the logs panel blank after the user
    // navigates away and back (common in dev/watch, where no log file exists).
    if (this.activeClients.has(client)) {
      return
    }
    this.activeClients.add(client)

    if (!satisfies(process.version, `>=${this.configService.minimumNodeVersion}`)) {
      client.emit('stdout', yellow(`Node.js v${this.configService.minimumNodeVersion} higher is required for ${this.configService.name}.\n\r`))
      client.emit('stdout', yellow(`You may experience issues while running on Node.js ${process.version}.\n\r\n\r`))
    }

    if (this.command) {
      client.emit('stdout', cyan(`Loading logs using ${this.configService.ui.log.method} method...\r\n`))
      client.emit('stdout', cyan(`CMD: ${this.command.join(' ')}\r\n\r\n`))
      this.tailLog(client, size)
    } else if (this.useNative) {
      client.emit('stdout', cyan('Loading logs using native method...\r\n'))
      client.emit('stdout', cyan(`File: ${this.configService.ui.log.path}\r\n\r\n`))
      this.tailLogFromFileNative(client)
    } else if (this.refusedPath !== undefined) {
      client.emit('stdout', red(`Refusing to show the log file "${this.refusedPath}". ${LOG_PATH_RULE}\r\n\r\n`))
      this.activeClients.delete(client)
    } else if (this.refusedCommand !== undefined) {
      client.emit('stdout', red(`Refusing to run the custom log command "${this.refusedCommand}". ${LOG_COMMAND_RULE}\r\n\r\n`))
      this.activeClients.delete(client)
    } else {
      client.emit('stdout', red('Cannot show logs. The log option is not configured correctly in your Homebridge config.json file.\r\n\r\n'))
      client.emit('stdout', cyan('See https://homebridge.io/w/JtHrm for instructions or use hb-service.\r\n'))
      // No stream was started here, so no `onEnd` will ever run to release the
      // guard — release it now so a later `tail-log` on this socket isn't dropped.
      this.activeClients.delete(client)
    }
  }

  /**
   * Stream the log command's output to the client. Every viewer of the same
   * command shares one child process: it is started by the first, its recent
   * output is replayed to each later one, and it is killed when the last
   * leaves. Each `tail -f` / `journalctl -f` used to be spawned per tab.
   * @param client
   * @param size
   */
  private tailLog(client: EventEmitter, size: TermSize) {
    const key = JSON.stringify([this.command, this.commandEnv])
    let stream = this.commandStreams.get(key)
    const joining = Boolean(stream)
    if (!stream) {
      stream = this.startCommandStream(key, [...this.command], size)
    }
    const shared = stream

    // A late joiner first gets what the stream has shown so far - the
    // command's own backlog (`-n 500`) plus what followed, capped the same way
    if (joining && shared.history) {
      this.emitMessage(client, shared.history)
    }
    shared.clients.add(client)

    // The pty is shared, so the last resize wins - harmless for a tail, whose
    // lines are not laid out to the terminal width
    const onResize = (resize: { rows: number, cols: number }) => {
      shared.resize?.(resize)
    }
    if (shared.resize) {
      client.on('resize', onResize)
    }

    // Cleanup on disconnect. Only this client's listeners are removed:
    // removeAllListeners would also strip the WS auth registry's and
    // socket.io's own disconnect listeners
    const onEnd = () => {
      this.activeClients.delete(client)
      this.discardMessageBuffer(client)

      client.off('resize', onResize)
      client.off('end', onEnd)
      client.off('disconnect', onEnd)

      shared.clients.delete(client)
      if (shared.clients.size === 0) {
        this.stopCommandStream(shared)
      }
    }

    client.on('end', onEnd)
    client.on('disconnect', onEnd)
  }

  /**
   * Spawn the log command once, fanning its output out to the stream's clients
   */
  private startCommandStream(key: string, command: string[], size: TermSize): CommandStream {
    const stream: CommandStream = {
      key,
      clients: new Set(),
      history: '',
      ending: false,
      exited: false,
      kill: () => {},
    }
    this.commandStreams.set(key, stream)

    const onOutput = (data: string) => {
      stream.history = trimLogHistory(stream.history + data)
      for (const client of stream.clients) {
        try {
          this.emitMessage(client, data)
        } catch {
          // The client socket probably closed. Not logged: this runs for every
          // chunk of output, and the socket leaves `stream.clients` on its own
          // disconnect, so one viewer must not stop the others' output
        }
      }
    }

    // Tell every viewer when the log tailing process exits early
    const onExit = (code: number) => {
      stream.exited = true
      if (this.commandStreams.get(key) === stream) {
        this.commandStreams.delete(key)
      }
      if (stream.ending) {
        return
      }
      for (const client of stream.clients) {
        try {
          this.flushMessage(client)
          client.emit('stdout', '\n\r')
          client.emit('stdout', red(`The log tail command ${command.join(' ')} exited with code ${code}.\n\r`))
          client.emit('stdout', red('Please check the command in your config.json is correct.\n\r\n\r'))
          client.emit('stdout', cyan('See https://github.com/mp-consulting/homebridge-config-glass-ui/wiki/Manual-Configuration#log-viewer-configuration for instructions.\r\n'))
        } catch (e) {
          // The client socket probably closed - the other viewers are still told
          this.logger.debug(`Could not tell a log viewer that the log tail command exited: ${e?.message ?? e}`)
        }
      }
    }

    // On Windows, avoid PTY for PowerShell to prevent ConPTY attach failures
    if (platform() === 'win32') {
      const proc = spawn(command[0], command.slice(1), {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: this.configService.storagePath,
        env: { ...process.env, ...this.commandEnv },
      })

      proc.stdout?.on('data', data => onOutput(data.toString('utf8').split('\n').join('\n\r')))
      proc.stderr?.on('data', data => onOutput(data.toString('utf8').split('\n').join('\n\r')))
      proc.on('exit', code => onExit(code))

      stream.kill = () => {
        try {
          proc.kill()
        } catch (e) {
          // The process has probably already exited
          this.logger.debug(`Could not stop the log tail command: ${e?.message ?? e}`)
        }
      }
    } else {
      // PTY mode for non-Windows platforms
      const sudo = Boolean(this.configService.ui.sudo)
      const term = this.nodePtyService.spawn(command[0], command.slice(1), {
        name: 'xterm-color',
        cols: size.cols,
        rows: size.rows,
        cwd: this.configService.storagePath,
        env: { ...process.env, ...this.commandEnv },
      })

      term.onData(data => onOutput(data))
      term.onExit(code => onExit(code.exitCode))

      stream.resize = (resize) => {
        try {
          term.resize(resize.cols, resize.rows)
        } catch {
          // The terminal has probably already exited; a resize can race its
          // exit, and there is nothing left to resize
        }
      }
      stream.kill = () => {
        try {
          term.kill()
        } catch (e) {
          // The terminal has probably already exited - the sudo kill below still runs
          this.logger.debug(`Could not stop the log tail command: ${e?.message ?? e}`)
        }
        // Really make sure the log tail command is killed when using sudo mode
        if (sudo && term && term.pid) {
          exec(`sudo -n kill -9 ${term.pid}`)
        }
      }
    }

    return stream
  }

  private stopCommandStream(stream: CommandStream) {
    stream.ending = true
    if (this.commandStreams.get(stream.key) === stream) {
      this.commandStreams.delete(stream.key)
    }
    if (!stream.exited) {
      stream.kill()
    }
  }

  /**
   * Construct the logs from file command
   */
  private logFromFile() {
    let command: string[]
    if (platform() === 'win32') {
      // Windows - use powershell to tail log
      // The path is user config: hand it over in an environment variable and
      // read it with -LiteralPath, so no quoting in it can end the string
      // and run PowerShell code.
      command = ['powershell.exe', '-NoProfile', '-Command', 'Get-Content -LiteralPath $env:UIX_LOG_PATH -Wait -Tail 200']
      this.commandEnv = { UIX_LOG_PATH: this.configService.ui.log.path }
    } else {
      // Linux / macos etc
      command = ['tail', '-n', '500', '-f', this.configService.ui.log.path]

      // Sudo mode is requested in plugin config
      if (this.configService.ui.sudo) {
        command.unshift('sudo', '-n')
      }
    }

    this.command = command
  }

  /**
   * Construct the logs from systemd command
   */
  private logFromSystemd() {
    const command = ['journalctl', '-o', 'cat', '-n', '500', '-f', '-u', this.configService.ui.log.service || 'homebridge']

    // Sudo mode is requested in plugin config
    if (this.configService.ui.sudo) {
      command.unshift('sudo', '-n')
    }

    this.command = command
  }

  /**
   * Logs from a file without spawning a child_process
   */
  private async tailLogFromFileNative(client: EventEmitter) {
    if (!existsSync(this.configService.ui.log.path)) {
      client.emit('stdout', '\n\r')
      client.emit('stdout', red(`No log file exists at path: ${this.configService.ui.log.path}\n\r`))
    }

    let ended = false
    let logStream: ReturnType<typeof createReadStream> | undefined
    // Assigned once this client is attached to the shared tail
    let tail: NativeLogTail | undefined
    let onLine: ((line: string) => void) | undefined
    let onError: ((err: Error) => void) | undefined

    // Cleanup on disconnect. Registered before the first `await`: a client
    // that disconnects while the initial read is in flight would otherwise
    // never run it, and stay attached to the shared tail below forever.
    const onEnd = () => {
      ended = true
      this.activeClients.delete(client)
      this.discardMessageBuffer(client)
      logStream?.destroy()

      if (tail && onLine) {
        tail.removeListener('line', onLine)
        tail.removeListener('error', onError)

        // Stop watching the file if there are no other watchers
        if (tail.listenerCount('line') === 0) {
          tail.stop()
        }
      }

      client.off('end', onEnd)
      client.off('disconnect', onEnd)
    }

    client.on('end', onEnd)
    client.on('disconnect', onEnd)

    // Read the last 50000 bytes of the log and emit to the client
    let logSize: number
    try {
      const logStats = await stat(this.configService.ui.log.path)
      if (ended) {
        return
      }
      logSize = logStats.size
      const logStartPosition = logStats.size <= 50000 ? 0 : logStats.size - 50000
      // Up to the size just read, where the tail below takes over - so a line
      // written meanwhile is not shown twice
      const stream = createReadStream(this.configService.ui.log.path, logStats.size > 0
        ? { start: logStartPosition, end: logStats.size - 1 }
        : { start: 0 })
      logStream = stream

      stream.on('data', (buffer) => {
        this.emitMessage(client, buffer.toString('utf8').split('\n').join('\n\r'))
      })

      stream.on('end', () => {
        // The initial dump is done — flush any held partial line right away
        // (e.g. when the log file does not end with a newline)
        this.flushMessage(client)
        stream.close()
      })
    } catch (e) {
      if (ended) {
        return
      }
      client.emit('stdout', red(`Failed to read log file: ${e.message}\n\r`))
      // No tail was started (the file is missing or unreadable), so there is
      // nothing for `onEnd` to clean up. Detach it and release the guard here,
      // otherwise this socket stays in activeClients forever and every later
      // `tail-log` on it is dropped — the logs panel goes blank after
      // navigating away and back.
      client.removeListener('end', onEnd)
      client.removeListener('disconnect', onEnd)
      this.activeClients.delete(client)
      return
    }

    // One tail of the file shared by every viewer. A new one is made when the
    // configured path changed; viewers still on the old one keep it until
    // they leave (each holds its own reference).
    const path = this.configService.ui.log.path
    if (!this.nativeTail || (this.nativeTail.path !== path && !this.nativeTail.isWatching)) {
      this.nativeTail = new NativeLogTail(path)
    }
    tail = this.nativeTail
    // Follow on from where the initial read above stopped (a no-op while
    // another viewer already has it running)
    tail.start(logSize)

    // Watch for lines and emit to client
    onLine = (line: string) => {
      this.emitMessage(client, `${line}\n\r`)
    }

    onError = (err: Error) => {
      client.emit('stdout', `${err.message}\n\r`)
    }

    tail.on('line', onLine)
    tail.on('error', onError)
  }

  /**
   * Construct the logs from custom command
   */
  private logFromCommand() {
    // The custom command is spawned directly, so it is a shell for whoever can
    // edit the config. Allow any command only when the terminal is enabled
    // (an admin has a shell anyway), otherwise only the log-command allowlist.
    const command = this.configService.ui.log.command
    if (!isLogCommandAllowed(command, this.configService.enableTerminalAccess, this.configService.storagePath)) {
      this.command = null
      this.refusedCommand = String(command)
      return
    }
    this.command = command.split(' ')
  }

  /**
   * Logs are not configured
   */
  private logNotConfigured() {
    this.command = null
  }

  private emitMessage(client: EventEmitter, msg: string) {
    // Chunks from the pty/stream can split a log line in two, which would let
    // half a supervisor line slip past the tag handling in processMessage().
    // Emit up to the last complete line and hold the remainder until its
    // terminator arrives — or until a short idle timeout, so output that
    // legitimately ends without a newline still reaches the client.
    const pending = this.logBuffers.get(client)
    if (pending) {
      clearTimeout(pending.flushTimeout)
    }

    const data = (pending?.buffer ?? '') + msg
    const lastNewline = data.lastIndexOf('\n')

    // Keep a `\r` directly after the last `\n` with the complete part so
    // `\n\r` line endings are not split in half
    const splitAt = lastNewline === -1 ? 0 : (data[lastNewline + 1] === '\r' ? lastNewline + 2 : lastNewline + 1)
    const partial = data.slice(splitAt)

    if (partial) {
      this.logBuffers.set(client, {
        buffer: partial,
        flushTimeout: setTimeout(() => this.flushMessage(client), PARTIAL_LINE_FLUSH_MS).unref(),
      })
    } else {
      this.logBuffers.delete(client)
    }

    if (splitAt > 0) {
      this.processMessage(client, data.slice(0, splitAt))
    }
  }

  /**
   * Emit any held partial line through the normal processing path
   */
  private flushMessage(client: EventEmitter) {
    const pending = this.logBuffers.get(client)
    if (!pending) {
      return
    }
    clearTimeout(pending.flushTimeout)
    this.logBuffers.delete(client)
    this.processMessage(client, pending.buffer)
  }

  /**
   * Discard any held partial line without emitting it (client is disconnecting)
   */
  private discardMessageBuffer(client: EventEmitter) {
    const pending = this.logBuffers.get(client)
    if (pending) {
      clearTimeout(pending.flushTimeout)
      this.logBuffers.delete(client)
    }
  }

  private processMessage(client: EventEmitter, msg: string) {
    let output = msg

    // Only lines written by the hb-service supervisor carry the level tags —
    // Homebridge core and plugin output must pass through untouched, even if
    // it happens to contain text like `[DEBUG]`.
    if (process.env.UIX_DEBUG_LOGGING !== '1') {
      output = output.replace(RE_SUPERVISOR_DEBUG_LINE, '')
    }

    output = output.replace(RE_SUPERVISOR_LEVEL_TAG, (_match, prefix, level, content) => {
      switch (level) {
        case 'SUCCESS':
          return prefix + green(content)
        case 'WARN':
          return prefix + yellow(content)
        case 'ERROR':
          return prefix + red(content)
        default:
          return prefix + content
      }
    })

    if (output) {
      // Pushed, not requested, so no guard ever sees it: re-check the user
      // (and `restrictLogsToAdmins`) before each send, in order
      this.outputRunner(client)(() => client.emit('stdout', output))
    }
  }

  private outputRunners = new WeakMap<EventEmitter, (action: () => unknown) => void>()

  private outputRunner(client: EventEmitter): (action: () => unknown) => void {
    let runner = this.outputRunners.get(client)
    if (!runner) {
      runner = createAuthorizedRunner(client, { admin: () => this.configService.restrictLogsToAdmins })
      this.outputRunners.set(client, runner)
    }
    return runner
  }
}
