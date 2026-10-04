/* global NodeJS */
/* eslint-disable no-console */
import type { ChildProcessWithoutNullStreams, ForkOptions } from 'node:child_process'
import type { WriteStream } from 'node:fs'

import type { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import type { BasePlatform } from '../base-platform.js'
import type { Logger } from '../logger.js'

import { Buffer } from 'node:buffer'
import { execSync, fork } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { arch, cpus, platform, release, type } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { StringDecoder } from 'node:string_decoder'

import { pathExists, pathExistsSync, readJson } from 'fs-extra/esm'

import { getUiNodeModulesPath } from '../../core/install-paths.js'
import { isPortInUse } from '../../core/net/port.js'
import { npmGlobalModulesPath, npmGlobalPrefixSync } from '../../core/npm/npm-runner.js'
import { sanitiseStartupEnv } from '../../modules/config-editor/config-safety.js'

/**
 * Splits a child's output stream into whole lines for `write`, so concurrent
 * stdout/stderr writes don't interleave mid-line in the log file. `end()`
 * flushes a trailing partial line (with a newline added).
 */
export function createLineBuffer(write: (text: string) => void) {
  const decoder = new StringDecoder('utf8')
  let buffer = ''

  return {
    push(chunk: Buffer | string) {
      buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk)
      let consumed = 0
      let idx = buffer.indexOf('\n', consumed)
      while (idx !== -1) {
        write(buffer.slice(consumed, idx + 1))
        consumed = idx + 1
        idx = buffer.indexOf('\n', consumed)
      }
      buffer = buffer.slice(consumed)
    },
    end() {
      buffer += decoder.end()
      if (buffer) {
        write(buffer.endsWith('\n') ? buffer : `${buffer}\n`)
        buffer = ''
      }
    },
  }
}

/**
 * The parts of HomebridgeServiceHelper the supervisor reads and sets
 */
export interface SupervisorHost {
  storagePath: string
  allowRunRoot: boolean
  docker: boolean
  uid: number
  gid: number
  stdout: boolean
  homebridgeOpts: string[]
  homebridgeCustomEnv: Record<string, string>
  logFile: WriteStream | NodeJS.WriteStream
  readonly logPath: string
  readonly logger: Logger
  readonly installer: BasePlatform
  readonly homebridgeStartupOptionsPath: string
  storagePathCheck: () => Promise<void>
  configCheck: () => Promise<void>
  truncateLog: () => Promise<void>
}

/**
 * `hb-service run`: starts the UI in this process and Homebridge as a child
 * process, pipes Homebridge's output into the log and restarts it when it exits.
 */
export class ProcessSupervisor {
  private homebridgeModulePath: string
  private homebridgePackage: { version: string, bin: { homebridge: string } }
  private homebridgeBinary: string
  private homebridge: ChildProcessWithoutNullStreams
  private uiBinary: string

  // UI services
  private ipcService: HomebridgeIpcService

  constructor(private readonly hb: SupervisorHost) {}

  private get logger() {
    return this.hb.logger
  }

  /**
   * Launch script, starts homebridge and @mp-consulting/homebridge-config-glass-ui
   */
  public async launch() {
    if (platform() !== 'win32' && process.getuid() === 0 && !this.hb.allowRunRoot) {
      this.logger.log('The hb-service run command should not be executed as root.')
      this.logger.log('Use the --allow-root flag to force the service to run as the root user.')
      process.exit(0)
    }

    this.logger.debug(`Homebridge storage path: ${this.hb.storagePath}.`)
    this.logger.debug(`Homebridge config path: ${process.env.UIX_CONFIG_PATH}.`)

    // Start the interval to truncate the logs every two hours
    setInterval(() => {
      this.hb.truncateLog()
    }, (1000 * 60 * 60) * 2)

    // Pre-start
    try {
      // Check storage path exists
      await this.hb.storagePathCheck()

      // Start logging to file
      await this.startLog()

      // Verify the config
      await this.hb.configCheck()

      // Log os info
      this.logger.debug(`OS: ${type()} ${release()} ${arch()}.`)
      this.logger.debug(`Node.js ${process.version} ${process.execPath}.`)

      // Work out the homebridge binary path
      this.homebridgeBinary = await this.findHomebridgePath()
      this.logger.debug(`Homebridge path: ${this.homebridgeBinary}.`)

      // Load startup options if they exist
      await this.loadHomebridgeStartupOptions()

      // Get the standalone ui binary on this system
      this.uiBinary = resolve(process.env.UIX_BASE_PATH, 'dist', 'bin', 'standalone.js')
      this.logger.debug(`UI path: ${this.uiBinary}.`)
    } catch (e) {
      this.logger.log(e.message)
      process.exit(1)
    }

    // Start homebridge
    this.startExitHandler()

    // Start the ui
    await this.runUi()

    // Tell the ui what homebridge we are running initially (this is refreshed when Homebridge is restarted)
    if (this.ipcService && this.homebridgePackage) {
      this.ipcService.setHomebridgeVersion(this.homebridgePackage.version, this.homebridgeModulePath)
    }

    // Delay the launch of homebridge on Raspberry Pi 1/Zero by 20 seconds
    if (cpus().length === 1 && arch() === 'arm') {
      this.logger.log('Delaying Homebridge startup by 20 seconds on low powered server.')
      setTimeout(() => {
        this.runHomebridge()
      }, 20000)
    } else {
      this.runHomebridge()
    }
  }

  /**
   * Opens the log file stream
   */
  private async startLog() {
    if (this.hb.stdout === true) {
      this.hb.logFile = process.stdout
      // No homebridge.log is written, so the logs panel explains where the logs went
      process.env.UIX_LOG_STDOUT = '1'
      return
    }

    // Work out the log path
    this.logger.debug(`Logging to ${this.hb.logPath}.`)

    // Redirect all stdout to the log file
    const logFile = createWriteStream(this.hb.logPath, { flags: 'a' })
    this.hb.logFile = logFile
    process.stdout.write = process.stderr.write = logFile.write.bind(logFile)
  }

  /**
   * Handles exit event
   */
  private startExitHandler() {
    const exitHandler = () => {
      this.logger.debug('Stopping services...')
      try {
        this.homebridge.kill()
      } catch (e) {
        // Homebridge is not running (yet) - nothing to stop
        this.logger.debug(`Could not stop Homebridge: ${e.message}`)
      }

      setTimeout(() => {
        try {
          this.homebridge.kill('SIGKILL')
        } catch (e) {
          this.logger.debug(`Could not kill Homebridge: ${e.message}`)
        }
        process.exit(1282)
      }, 7000)
    }

    process.on('SIGTERM', exitHandler)
    process.on('SIGINT', exitHandler)
  }

  /**
   * Starts homebridge as a child process, sending the log output to the homebridge.log
   */
  private runHomebridge() {
    if (!this.homebridgeBinary || !pathExistsSync(this.homebridgeBinary)) {
      this.logger.error('Could not find Homebridge. Make sure you have installed Homebridge using the -g flag then restart.')
      this.logger.error('npm install -g homebridge')
      return
    }

    const { homebridgeOpts, homebridgeCustomEnv } = this.hb

    if (process.env.UIX_STRICT_PLUGIN_RESOLUTION === '1') {
      if (!homebridgeOpts.includes('--strict-plugin-resolution')) {
        homebridgeOpts.push('--strict-plugin-resolution')
      }
    }

    if (homebridgeOpts.length) {
      this.logger.debug(`Starting Homebridge with extra flags: ${homebridgeOpts.join(' ')}.`)
    }

    if (Object.keys(homebridgeCustomEnv).length) {
      this.logger.debug(`Starting Homebridge with custom env: ${JSON.stringify(homebridgeCustomEnv)}.`)
    }

    // Env setup
    const env = {}
    Object.assign(env, process.env)
    Object.assign(env, homebridgeCustomEnv)

    // Child process spawn options
    const childProcessOpts: ForkOptions = {
      env,
      silent: true,
    }

    // Spawn homebridge as a different user (probably for docker)
    if (this.hb.allowRunRoot && this.hb.uid && this.hb.gid) {
      childProcessOpts.uid = this.hb.uid
      childProcessOpts.gid = this.hb.gid
    }

    // Fix docker permission if running on docker
    if (this.hb.docker) {
      this.fixDockerPermissions()
    }

    // Launch the homebridge process
    this.homebridge = fork(this.homebridgeBinary, [
      '-C',
      '-Q',
      '-U',
      this.hb.storagePath,
      ...homebridgeOpts,
    ], childProcessOpts) as ChildProcessWithoutNullStreams

    // Let the ipc service know of the new process
    if (this.ipcService) {
      this.ipcService.setHomebridgeProcess(this.homebridge)
      this.ipcService.setHomebridgeVersion(this.homebridgePackage.version, this.homebridgeModulePath)
    }

    this.logger.success(`Started Homebridge v${this.homebridgePackage.version} with PID: ${this.homebridge.pid}.`)

    // Whole lines only, per stream, so stdout and stderr don't interleave mid-line
    const writeToLog = (text: string) => this.hb.logFile.write(text)
    const out = createLineBuffer(writeToLog)
    const err = createLineBuffer(writeToLog)

    this.homebridge.stdout.on('data', data => out.push(data))
    this.homebridge.stderr.on('data', data => err.push(data))

    this.homebridge.on('close', (code, signal) => {
      out.end()
      err.end()
      this.handleHomebridgeClose(code, signal)
    })
  }

  /**
   * Ensures homebridge is restarted automatically if it crashed or was stopped
   */
  private handleHomebridgeClose(code: number, signal: string) {
    this.logger.log(`Homebridge process ended. Code: ${code}, signal: ${signal}.`)

    this.checkForStaleHomebridgeProcess()
    this.refreshHomebridgePackage()

    setTimeout(() => {
      this.logger.log('Restarting Homebridge...')
      this.runHomebridge()
    }, 5000)
  }

  /**
   * Start the user interface
   */
  private async runUi() {
    try {
      // Import main module
      const main = await import('../../main.js')

      // Load the nest js instance
      const ui = await main.app

      // Extract services
      this.ipcService = ui.get(main.HomebridgeIpcService)
    } catch (e) {
      this.logger.log('The user interface threw an unhandled error.')
      console.error(e)

      setTimeout(() => {
        process.exit(1)
      }, 4500)

      if (this.homebridge) {
        this.homebridge.kill()
      }
    }
  }

  /**
   * Get the global npm directory
   */
  private async getNpmGlobalModulesDirectory() {
    try {
      return npmGlobalModulesPath(npmGlobalPrefixSync())
    } catch (e) {
      this.logger.debug(`Could not determine the npm global prefix: ${e.message}`)
      return null
    }
  }

  /**
   * Finds the homebridge binary
   */
  private async findHomebridgePath() {
    // Check the folder directly above
    const nodeModules = getUiNodeModulesPath()
    if (await pathExists(resolve(nodeModules, 'homebridge', 'package.json'))) {
      this.homebridgeModulePath = resolve(nodeModules, 'homebridge')
    }

    // Check the global npm modules directory
    if (!this.homebridgeModulePath && !(process.env.UIX_STRICT_PLUGIN_RESOLUTION === '1' && process.env.UIX_CUSTOM_PLUGIN_PATH)) {
      const globalModules = await this.getNpmGlobalModulesDirectory()
      if (globalModules && await pathExists(resolve(globalModules, 'homebridge'))) {
        this.homebridgeModulePath = resolve(globalModules, 'homebridge')
      }
    }

    // Check the custom plugins path
    if (!this.homebridgeModulePath && process.env.UIX_CUSTOM_PLUGIN_PATH) {
      if (await pathExists(resolve(process.env.UIX_CUSTOM_PLUGIN_PATH, 'homebridge', 'package.json'))) {
        this.homebridgeModulePath = resolve(process.env.UIX_CUSTOM_PLUGIN_PATH, 'homebridge')
      }
    }

    if (this.homebridgeModulePath) {
      try {
        await this.refreshHomebridgePackage()
        return resolve(this.homebridgeModulePath, this.homebridgePackage.bin.homebridge)
      } catch (e) {
        console.log(e)
      }
    }

    return null
  }

  /**
   * Refresh the homebridge package.json
   */
  private async refreshHomebridgePackage() {
    try {
      if (await pathExists(this.homebridgeModulePath)) {
        this.homebridgePackage = await readJson(join(this.homebridgeModulePath, 'package.json'))
      } else {
        this.logger.error(`Homebridge not longer found at ${this.homebridgeModulePath}.`)
        this.homebridgeModulePath = undefined
        this.homebridgeBinary = await this.findHomebridgePath()
        this.logger.log(`Found new Homebridge path: ${this.homebridgeBinary}.`)
      }
    } catch (e) {
      console.log(e)
    }
  }

  /**
   * Checks to see if there are stale homebridge processes running on the same port
   */
  private async checkForStaleHomebridgeProcess() {
    if (platform() === 'win32') {
      return
    }
    try {
      // Load the config to get the homebridge port
      const currentConfig = await readJson(process.env.UIX_CONFIG_PATH)
      if (!currentConfig.bridge || !currentConfig.bridge.port) {
        return
      }

      // Check if port is still in use
      if (!await isPortInUse(Number.parseInt(currentConfig.bridge.port.toString(), 10))) {
        return
      }

      // Find the pid of the process using the port
      const pid = Number.parseInt(this.hb.installer.getPidOfPort(Number.parseInt(currentConfig.bridge.port.toString(), 10)), 10)
      if (!pid) {
        return
      }

      // Kill the stale Homebridge process
      this.logger.log(`Found stale Homebridge process running on port: ${currentConfig.bridge.port}, with PID: ${pid}, killing...`)
      process.kill(pid, 'SIGKILL')
    } catch (e) {
      // Best effort: Homebridge is restarted either way
      this.logger.debug(`Could not check for a stale Homebridge process: ${e.message}`)
    }
  }

  /**
   * Get the Homebridge startup options defined in the UI
   */
  private async loadHomebridgeStartupOptions() {
    const { homebridgeOpts } = this.hb
    try {
      if (await pathExists(this.hb.homebridgeStartupOptionsPath)) {
        const homebridgeStartupOptions = await readJson(this.hb.homebridgeStartupOptionsPath)

        // Check if debug should be enabled
        if (homebridgeStartupOptions.debugMode && !homebridgeOpts.includes('-D')) {
          homebridgeOpts.push('-D')
        }

        // Check if keep orphans should be enabled
        if (homebridgeStartupOptions.keepOrphans && !homebridgeOpts.includes('-K')) {
          homebridgeOpts.push('-K')
        }

        // Insecure mode is enabled by default, allow it to be removed if set to false
        if (homebridgeStartupOptions.insecureMode === false && homebridgeOpts.includes('-I')) {
          homebridgeOpts.splice(homebridgeOpts.findIndex(x => x === '-I'), 1)
          process.env.UIX_INSECURE_MODE = '0'
        }

        // Copy any custom env vars in. NODE_OPTIONS is set from the UI, so
        // it may not load code or open a debugger (that would be a shell
        // for any admin, even with the terminal disabled).
        Object.assign(this.hb.homebridgeCustomEnv, sanitiseStartupEnv(homebridgeStartupOptions.env, msg => this.logger.warn(msg)))
      } else if (this.hb.docker) {
        // Check old docker flag for debug mode
        if (process.env.HOMEBRIDGE_DEBUG === '1' && !homebridgeOpts.includes('-D')) {
          homebridgeOpts.push('-D')
        }

        // Check old docker flag for insecure mode
        if (process.env.HOMEBRIDGE_INSECURE !== '1' && homebridgeOpts.includes('-I')) {
          homebridgeOpts.splice(homebridgeOpts.findIndex(x => x === '-I'), 1)
          process.env.UIX_INSECURE_MODE = '0'
        }
      }
    } catch (e) {
      this.logger.log(`Failed to load startup options as ${e.message}.`)
    }
  }

  /**
   * Fix the permission on the docker storage directory
   * This is only used when running in the homebridge/docker-homebridge docker container
   */
  private fixDockerPermissions() {
    try {
      execSync(`chown -R ${this.hb.uid}:${this.hb.gid} "${this.hb.storagePath}"`)
    } catch (e) {
      // Homebridge may still start; it reports any file it cannot write
      this.logger.debug(`Could not fix the storage permissions: ${e.message}`)
    }
  }
}
