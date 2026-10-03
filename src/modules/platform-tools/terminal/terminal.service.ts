import type { IPty } from '@homebridge/node-pty-prebuilt-multiarch'

import type { TermSize, WsEventEmitter } from './terminal.interfaces.js'

import os from 'node:os'
import process from 'node:process'

import { Inject, Injectable } from '@nestjs/common'
import { pathExists } from 'fs-extra/esm'

import { createAuthorizedRunner } from '../../../core/auth/guards/ws-auth.js'
import { ConfigService } from '../../../core/config/config.service.js'
import { Logger } from '../../../core/logger/logger.service.js'
import { NodePtyService } from '../../../core/node-pty/node-pty.service.js'

@Injectable()
export class TerminalService {
  private static persistentTerminal: IPty | null = null
  private static connectedClients: Set<WsEventEmitter> = new Set()
  private static dataListenerAttached = false
  private static terminalBuffer: string = ''
  private static persistentAptHintInjected = false
  // Detaches a socket's current session listeners (stdin/resize/end/disconnect)
  private static clientDetach = new WeakMap<WsEventEmitter, () => void>()
  private static outputRunners = new WeakMap<WsEventEmitter, (action: () => unknown) => void>()
  private instanceId: string

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(NodePtyService) private readonly nodePtyService: NodePtyService,
  ) {
    this.instanceId = Math.random().toString(36).substring(2, 11)
    this.logger.debug(`TerminalService instance created: ${this.instanceId}`)
  }

  /**
   * The order-preserving, re-checking runner that sends a client the
   * persistent shell's output (one per client, kept for its lifetime).
   */
  private static outputRunner(client: WsEventEmitter): (action: () => unknown) => void {
    let runner = TerminalService.outputRunners.get(client)
    if (!runner) {
      runner = createAuthorizedRunner(client, { admin: true })
      TerminalService.outputRunners.set(client, runner)
    }
    return runner
  }

  private shouldInjectAptPackageCommandHint(): boolean {
    return this.configService.runningInPackageMode && !this.configService.runningInSynologyPackage
  }

  private getAptPackageCommandHintLine(): string {
    return '\x1B[37mUpdate Homebridge APT package: \x1B[92mhb-service update-homebridge\x1B[0m\r\n'
  }

  private injectAptHintBeforeNodeUpdateLine(data: string): string {
    if (!data.includes('Update Node.js:')) {
      return data
    }

    return data.replace('Update Node.js:', `${this.getAptPackageCommandHintLine()}Update Node.js:`)
  }

  /**
   * Get the preferred shell for the current platform
   */
  private async getPreferredShell(): Promise<'/bin/zsh' | '/bin/bash' | '/bin/sh'> {
    // On macOS, prefer zsh if available
    if (os.platform() === 'darwin' && await pathExists('/bin/zsh')) {
      return '/bin/zsh'
    }

    // Fallback to bash if available, otherwise sh
    return await pathExists('/bin/bash') ? '/bin/bash' : '/bin/sh'
  }

  /**
   * Create a new terminal session
   * @param client
   * @param size
   */
  async startSession(client: WsEventEmitter, size: TermSize) {
    // If terminal is not enabled, disconnect the client
    if (!this.configService.enableTerminalAccess) {
      this.logger.warn('Terminal is not enabled, disconnecting client...')
      client.disconnect()
      return
    }

    // Check if terminal persistence is enabled
    const terminalPersistence = Boolean(this.configService.ui.terminal?.persistence)

    if (terminalPersistence) {
      return this.attachToPersistentTerminal(client, size)
    } else {
      return this.createNewTerminal(client, size)
    }
  }

  private async createNewTerminal(client: WsEventEmitter, size: TermSize) {
    this.logger.debug('Starting new terminal session.')

    // Per-session closure flag. This service is a singleton serving every
    // client, so a shared instance-level `ending` let one client's disconnect
    // suppress the process-exit notification for every other client's shell.
    // (The log service fixed the identical pattern the same way.)
    let ending = false

    // Get the preferred shell for the current platform
    const shell = await this.getPreferredShell()

    // Spawn a new shell
    const term = this.nodePtyService.spawn(shell, [], {
      name: 'xterm-color',
      cols: size.cols,
      rows: size.rows,
      cwd: this.configService.storagePath,
      env: process.env,
    })

    let aptHintInjected = false

    // Write to the client - re-checking its user first, like stdin below:
    // output is pushed, so no guard would ever see a revoked user otherwise
    const runAuthorizedOutput = createAuthorizedRunner(client, { admin: true })
    term.onData((data) => {
      let output = data

      if (!aptHintInjected && this.shouldInjectAptPackageCommandHint()) {
        const injectedOutput = this.injectAptHintBeforeNodeUpdateLine(data)
        aptHintInjected = injectedOutput !== data
        output = injectedOutput
      }

      runAuthorizedOutput(() => client.emit('stdout', output))
    })

    // Let the client know when the session ends
    term.onExit((exitInfo: { exitCode: number, signal?: number }) => {
      try {
        if (!ending) {
          client.emit('process-exit', exitInfo.exitCode)
        }
      } catch (e) {
        // The client socket probably closed
      }
    })

    // Write input to the terminal - re-checking the user first, as a shell
    // must not outlive its user's admin rights
    const runAuthorized = createAuthorizedRunner(client, { admin: true })
    const onStdin = (data) => {
      runAuthorized(() => term.write(data))
    }

    // capture resize events
    const onResize = (resize: TermSize) => {
      try {
        term.resize(resize.cols, resize.rows)
      } catch {
        // The terminal has probably already exited
      }
    }

    // A second start on the same socket replaces the previous session
    TerminalService.clientDetach.get(client)?.()

    client.on('stdin', onStdin)
    client.on('resize', onResize)

    // cleanup on disconnect
    const onEnd = () => {
      ending = true

      // Only this session's listeners: removeAllListeners would also strip
      // the WS auth registry's and socket.io's own disconnect listeners
      client.off('stdin', onStdin)
      client.off('resize', onResize)
      client.off('end', onEnd)
      client.off('disconnect', onEnd)
      if (TerminalService.clientDetach.get(client) === onEnd) {
        TerminalService.clientDetach.delete(client)
      }

      try {
        this.logger.debug('Terminal session ended.')
        term.kill()
      } catch {
        // The terminal has probably already exited
      }
    }

    TerminalService.clientDetach.set(client, onEnd)
    client.on('end', onEnd)
    client.on('disconnect', onEnd)
  }

  private async attachToPersistentTerminal(client: WsEventEmitter, size: TermSize) {
    this.logger.debug(`[${this.instanceId}] attachToPersistentTerminal called`)

    // Resolved before the check below, so the check and the spawn run with no
    // await between them: two overlapping starts would otherwise both see no
    // terminal and each spawn a shell, orphaning one of them
    const shell = await this.getPreferredShell()

    // If we don't have a persistent terminal, create one
    if (!TerminalService.persistentTerminal) {
      this.logger.debug(`[${this.instanceId}] Creating new persistent terminal session.`)

      const terminal = this.nodePtyService.spawn(shell, [], {
        name: 'xterm-color',
        cols: size.cols,
        rows: size.rows,
        cwd: this.configService.storagePath,
        env: process.env,
      })
      TerminalService.persistentTerminal = terminal
      TerminalService.persistentAptHintInjected = false

      // Set up the SINGLE data listener that routes to current client
      if (!TerminalService.dataListenerAttached) {
        this.logger.debug(`[${this.instanceId}] Attaching data listener`)
        terminal.onData((data) => {
          // Late output from a shell that has since been destroyed and
          // replaced must not leak into the new session
          if (TerminalService.persistentTerminal !== terminal) {
            return
          }
          try {
            let output = data

            if (!TerminalService.persistentAptHintInjected && this.shouldInjectAptPackageCommandHint()) {
              const injectedOutput = this.injectAptHintBeforeNodeUpdateLine(data)
              TerminalService.persistentAptHintInjected = injectedOutput !== data
              output = injectedOutput
            }

            // Add to buffer for future clients
            TerminalService.terminalBuffer += output

            // Keep buffer size reasonable (configurable)
            const maxBufferSize = this.configService.ui.terminal?.bufferSize || globalThis.terminal.bufferSize
            if (TerminalService.terminalBuffer.length > maxBufferSize) {
              TerminalService.terminalBuffer = TerminalService.terminalBuffer.slice(-maxBufferSize)
            }

            if (TerminalService.connectedClients.size > 0) {
              TerminalService.connectedClients.forEach((client) => {
                try {
                  // Re-checked per client, as the shell is shared: one
                  // revoked or demoted viewer must stop receiving its output
                  // without affecting the others
                  TerminalService.outputRunner(client)(() => client.emit('stdout', output))
                } catch (e) {
                  this.logger.error(`[${this.instanceId}] Error sending output to a client: ${e}`)
                  // Remove client if it's no longer valid
                  TerminalService.connectedClients.delete(client)
                }
              })
            }
          } catch (e) {
            this.logger.error(`[${this.instanceId}] Error sending output to client: ${e}`)
          }
        })
        TerminalService.dataListenerAttached = true
      }

      // Handle terminal exit
      terminal.onExit((exitInfo: { exitCode: number, signal?: number }) => {
        this.logger.debug(`[${this.instanceId}] Persistent terminal exited.`)

        // destroyPersistentSession() already reset the shared state for this
        // shell, and a new one may have been started since - its exit comes
        // after the kill and must not orphan (or notify the clients of) the
        // session that replaced it
        if (TerminalService.persistentTerminal !== terminal) {
          return
        }

        // Notify all connected clients that the process has exited
        TerminalService.connectedClients.forEach((client) => {
          try {
            client.emit('process-exit', exitInfo.exitCode)
          } catch (e) {
            // Client socket probably closed, remove it
            TerminalService.connectedClients.delete(client)
          }
        })

        TerminalService.persistentTerminal = null
        TerminalService.connectedClients.clear()
        TerminalService.dataListenerAttached = false
        TerminalService.terminalBuffer = ''
        TerminalService.persistentAptHintInjected = false
      })
    } else {
      this.logger.debug(`[${this.instanceId}] Attaching to existing persistent terminal.`)
      // Resize to match current client
      try {
        TerminalService.persistentTerminal.resize(size.cols, size.rows)
      } catch {
        // The terminal has probably already exited
      }
    }

    // Detach this socket's previous session (a repeat start) before adding new listeners
    this.logger.debug(`[${this.instanceId}] Cleaning up existing client listeners`)
    TerminalService.clientDetach.get(client)?.()

    // Add client to connected clients set
    this.logger.debug(`[${this.instanceId}] Adding client to connected clients`)
    TerminalService.connectedClients.add(client)

    // Send buffer to new client if this is an existing persistent terminal
    if (TerminalService.terminalBuffer && TerminalService.terminalBuffer.length > 0) {
      this.logger.debug(`[${this.instanceId}] Sending ${TerminalService.terminalBuffer.length} chars of buffer to new client`)
      try {
        client.emit('stdout', TerminalService.terminalBuffer)
      } catch (e) {
        this.logger.error(`[${this.instanceId}] Error sending buffer to client: ${e}`)
      }
    } else {
      this.logger.debug(`[${this.instanceId}] No buffer to send to new client`)
    }

    // Always add listeners for the new client (each client needs its own listeners)
    this.logger.debug(`[${this.instanceId}] Adding stdin and resize listeners`)

    // Re-check the user before each write, as a shell must not outlive its
    // user's admin rights
    const runAuthorized = createAuthorizedRunner(client, { admin: true })
    const onStdin = (data) => {
      runAuthorized(() => {
        if (TerminalService.persistentTerminal) {
          TerminalService.persistentTerminal.write(data)
        } else {
          this.logger.warn(`[${this.instanceId}] No persistent terminal to write to!`)
        }
      })
    }

    const onResize = (resize: TermSize) => {
      this.logger.debug(`[${this.instanceId}] Received resize from client`)
      try {
        if (TerminalService.persistentTerminal) {
          TerminalService.persistentTerminal.resize(resize.cols, resize.rows)
        }
      } catch {
        // The terminal has probably already exited
      }
    }

    client.on('stdin', onStdin)
    client.on('resize', onResize)

    // Clean up client listeners on disconnect (but keep terminal alive)
    const onEnd = () => {
      this.logger.debug(`[${this.instanceId}] Client disconnecting`)

      // Only this session's listeners: removeAllListeners would also strip
      // the WS auth registry's and socket.io's own disconnect listeners
      client.off('stdin', onStdin)
      client.off('resize', onResize)
      client.off('end', onEnd)
      client.off('disconnect', onEnd)
      if (TerminalService.clientDetach.get(client) === onEnd) {
        TerminalService.clientDetach.delete(client)
      }

      // Remove client from connected clients set
      if (TerminalService.connectedClients.has(client)) {
        TerminalService.connectedClients.delete(client)
        this.logger.debug(`[${this.instanceId}] Removed client from connected clients`)
      }

      this.logger.debug(`[${this.instanceId}] Client cleanup complete`)
    }

    TerminalService.clientDetach.set(client, onEnd)
    client.on('end', onEnd)
    client.on('disconnect', onEnd)
  }

  /**
   * Check if there's an active persistent terminal session
   * This is the authoritative source of truth for backend state
   */
  hasPersistentSession(): boolean {
    const hasPersistent = TerminalService.persistentTerminal !== null
    this.logger.debug(`[${this.instanceId}] hasPersistentSession: ${hasPersistent}`)
    return hasPersistent
  }

  /**
   * Destroy the persistent terminal session completely
   * This is called when terminal persistence is disabled
   */
  destroyPersistentSession() {
    this.logger.debug(`[${this.instanceId}] Destroying persistent terminal session`)

    if (TerminalService.persistentTerminal) {
      try {
        this.logger.debug(`[${this.instanceId}] Killing persistent terminal process`)
        TerminalService.persistentTerminal.kill()
      } catch (e) {
        this.logger.error(`[${this.instanceId}] Error killing persistent terminal: ${e}`)
      }
      TerminalService.persistentTerminal = null
    }

    // Clear the terminal buffer
    TerminalService.terminalBuffer = ''

    // Clear data listener flag
    TerminalService.dataListenerAttached = false

    // Clear all connected clients
    TerminalService.connectedClients.clear()

    // Reset apt hint insertion state
    TerminalService.persistentAptHintInjected = false

    this.logger.debug(`[${this.instanceId}] Persistent terminal session destroyed`)
  }
}
