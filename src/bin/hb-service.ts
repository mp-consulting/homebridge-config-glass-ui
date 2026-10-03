#!/usr/bin/env node
/* global NodeJS */
/* eslint-disable no-console */
/**
 * The purpose of this file is to run and install homebridge and @mp-consulting/homebridge-config-glass-ui as a service
 *
 * HomebridgeServiceHelper is the facade the platform installers talk to
 * (`this.hbService.*`); the work is done by the modules in ./hb-service/.
 */

import type { PathLike, WriteStream } from 'node:fs'
import type { TarOptionsWithAliases } from 'tar'

import type { BasePlatform } from './base-platform.js'
import type { Action } from './hb-service/cli.js'

import { homedir, platform } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import axios from 'axios'
import { readJson, readJsonSync } from 'fs-extra/esm'
import { networkInterfaceDefault, networkInterfaces } from 'systeminformation'

import { isPortInUse } from '../core/net/port.js'
import { RE_SERVICE_NAME } from '../core/regex.constants.js'
import { parseCommandLine, printUsage } from './hb-service/cli.js'
import { ConfigBootstrap } from './hb-service/config-bootstrap.js'
import { tailLogs, truncateLog, viewLogs } from './hb-service/log-tools.js'
import { checkForNodejsUpdates, downloadNodejs, extractNodejs, removeNpmPackage } from './hb-service/node-updater.js'
import { npmPluginManagement } from './hb-service/plugin-cli.js'
import { ProcessSupervisor } from './hb-service/process-supervisor.js'
import { Logger } from './logger.js'
import { DarwinInstaller } from './platforms/darwin.js'
import { FreeBSDInstaller } from './platforms/freebsd.js'
import { LinuxInstaller } from './platforms/linux.js'
import { Win32Installer } from './platforms/win32.js'

process.title = 'hb-service'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export class HomebridgeServiceHelper {
  public action: Action
  public selfPath = __filename
  public serviceName = 'Homebridge'
  public storagePath: string
  public usingCustomStoragePath = false
  public allowRunRoot = false
  public enableHbServicePluginManagement = false
  public asUser: string
  public addGroup: string
  public _logger: Logger
  public logFile: WriteStream | NodeJS.WriteStream
  public homebridgeOpts = ['-I']
  public homebridgeCustomEnv: Record<string, string> = {}

  // Send logs to stdout instead of the homebridge.log
  public stdout: boolean

  // homebridge/docker-homebridge options
  public docker: boolean
  public uid: number
  public gid: number

  public uiPort = 8581

  public installer: BasePlatform

  private readonly configBootstrap = new ConfigBootstrap(this)
  private readonly supervisor = new ProcessSupervisor(this)

  get logPath(): string {
    return resolve(this.storagePath, 'homebridge.log')
  }

  get logger(): Logger {
    if (!this._logger) {
      this._logger = new Logger(this)
    }
    return this._logger
  }

  constructor() {
    // Check the node.js version
    this.nodeVersionCheck()

    // Select the installer for the current platform
    switch (platform()) {
      case 'linux':
        this.installer = new LinuxInstaller(this)
        break
      case 'win32':
        this.installer = new Win32Installer(this)
        break
      case 'darwin':
        this.installer = new DarwinInstaller(this)
        break
      case 'freebsd':
        this.installer = new FreeBSDInstaller(this)
        break
      default:
        this.logger.error(`ERROR: This command is not supported on ${platform()}.`)
        process.exit(1)
    }

    const { args, outputHelp } = parseCommandLine(this, process.argv, () => this.showVersion())

    this.setEnv()

    switch (this.action) {
      case 'install': {
        this.nvmCheck()
        this.logger.log(`Installing ${this.serviceName} service...`)
        this.installer.install()
        break
      }
      case 'uninstall': {
        this.logger.log(`Removing ${this.serviceName} service...`)
        this.installer.uninstall()
        break
      }
      case 'start': {
        this.installer.start()
        break
      }
      case 'stop': {
        this.installer.stop()
        break
      }
      case 'restart': {
        this.logger.log(`Restarting ${this.serviceName} service...`)
        this.installer.restart()
        break
      }
      case 'rebuild': {
        this.logger.log(`Rebuilding for Node.js ${process.version}...`)
        this.installer.rebuild(args.includes('--all'))
        break
      }
      case 'run': {
        this.supervisor.launch()
        break
      }
      case 'logs': {
        tailLogs(this.logPath, this.logger)
        break
      }
      case 'view': {
        this.installer.viewLogs()
        viewLogs(this.logPath, this.logger)
        break
      }
      case 'add':
      case 'remove': {
        npmPluginManagement(args, { enabled: this.enableHbServicePluginManagement, logger: this.logger })
        break
      }
      case 'update-node': {
        checkForNodejsUpdates(args.length === 2 ? args[1] : null, { installer: this.installer, logger: this.logger })
        break
      }
      case 'update-homebridge': {
        this.installer.updateHomebridgePackage()
        break
      }
      case 'before-start': {
        this.installer.beforeStart()
        break
      }
      case 'status': {
        this.checkStatus()
        break
      }
      default: {
        printUsage(outputHelp, this.enableHbServicePluginManagement)
        process.exit(1)
      }
    }
  }

  /**
   * Sets the required environment variables passed on to the child processes
   */
  private setEnv() {
    // Ensure service name is valid
    if (!RE_SERVICE_NAME.test(this.serviceName)) {
      this.logger.error('Service name must not contain spaces or special characters.')
      process.exit(1)
    }

    // Setup default storage path
    if (!this.storagePath) {
      if (platform() === 'linux' || platform() === 'freebsd') {
        this.storagePath = resolve('/var/lib', this.serviceName.toLowerCase())
      } else {
        this.storagePath = resolve(homedir(), `.${this.serviceName.toLowerCase()}`)
      }
    }

    // Certain commands are not supported when running in Docker
    if (process.env.CONFIG_UI_VERSION && process.env.HOMEBRIDGE_VERSION && process.env.QEMU_ARCH) {
      if (platform() === 'linux' && ['install', 'uninstall', 'start', 'stop', 'restart', 'logs'].includes(this.action)) {
        this.logger.error(`Sorry, the ${this.action} command is not supported in Docker.`)
        process.exit(1)
      }
    }

    // Plugin management (install / uninstall) is only available when running as a package
    this.enableHbServicePluginManagement = Boolean(
      process.env.UIX_CUSTOM_PLUGIN_PATH
      && (process.env.HOMEBRIDGE_SYNOLOGY_PACKAGE === '1' || process.env.HOMEBRIDGE_APT_PACKAGE === '1'),
    )

    // Set Env Vars
    process.env.UIX_STORAGE_PATH = this.storagePath
    process.env.UIX_CONFIG_PATH = resolve(this.storagePath, 'config.json')
    process.env.UIX_BASE_PATH = process.env.UIX_BASE_PATH_OVERRIDE || resolve(__dirname, '../../')
    process.env.UIX_SERVICE_MODE = '1'
    process.env.UIX_INSECURE_MODE = '1'
  }

  /**
   * Outputs the package version number
   */
  private showVersion() {
    const pjson = readJsonSync(resolve(__dirname, '../../', 'package.json'))
    console.log(`v${pjson.version}`)
    process.exit(0)
  }

  /**
   * Truncate the log file to prevent large log files
   */
  public async truncateLog() {
    await truncateLog(this.logPath, {
      readConfig: () => readJson(process.env.UIX_CONFIG_PATH),
      logFile: this.logFile,
      logger: this.logger,
    })
  }

  /**
   * Checks the current Node.js version is > 10
   */
  private nodeVersionCheck() {
    // 64 = v10;
    if (Number.parseInt(process.versions.modules, 10) < 64) {
      this.logger.error(`Node.js v10.13.0 or greater is required, current: ${process.version}.`)
      process.exit(1)
    }
  }

  /**
   * Show a warning if the user is trying to install with NVM on Linux
   */
  private nvmCheck() {
    if (process.execPath.includes('nvm') && platform() === 'linux') {
      this.logger.warn(
        'WARNING: It looks like you are running Node.js via NVM (Node Version Manager).\n'
        + '  Using hb-service with NVM may not work unless you have configured NVM for the\n'
        + '  user this service will run as. See https://homebridge.io/w/JUZ2g for instructions on how\n'
        + '  to remove NVM, then follow the wiki instructions to install Node.js and Homebridge.',
      )
    }
  }

  /**
   * Prints usage information to the screen after installations
   */
  public async printPostInstallInstructions() {
    const defaultAdapter = await networkInterfaceDefault()
    const defaultInterface = (await networkInterfaces()).find((x: any) => x.iface === defaultAdapter)

    console.log('\nManage Homebridge by going to one of the following in your browser:\n')

    console.log(`* http://localhost:${this.uiPort}`)

    if (defaultInterface && defaultInterface.ip4) {
      console.log(`* http://${defaultInterface.ip4}:${this.uiPort}`)
    }

    if (defaultInterface && defaultInterface.ip6) {
      console.log(`* http://[${defaultInterface.ip6}]:${this.uiPort}`)
    }

    console.log('')

    this.logger.success('Homebridge setup complete.')
  }

  /**
   * Checks if the port is currently in use by another process
   */
  public async portCheck() {
    const inUse = await isPortInUse(this.uiPort)
    if (inUse) {
      this.logger.error(`Port ${this.uiPort} is already in use by another process on this host.`)
      this.logger.error('You can specify another port using the --port flag, e.g.:')
      this.logger.error(`hb-service ${this.action} --port 8581`)
      process.exit(1)
    }
  }

  /**
   * Ensures the storage path defined exists
   */
  public async storagePathCheck() {
    return this.configBootstrap.storagePathCheck()
  }

  /**
   * Ensures the config.json exists and is valid.
   * If the config is not valid json it will be backed up and replaced with the default.
   */
  public async configCheck() {
    return this.configBootstrap.configCheck()
  }

  /**
   * Creates the default config.json
   */
  public async createDefaultConfig() {
    return this.configBootstrap.createDefaultConfig()
  }

  /**
   * Corrects the permissions on files when running the hb-service command using sudo
   */
  public async chownPath(pathToChown: PathLike) {
    return this.configBootstrap.chownPath(pathToChown)
  }

  /**
   * Returns the path of the homebridge startup settings file
   */
  get homebridgeStartupOptionsPath() {
    return resolve(this.storagePath, '.uix-hb-service-homebridge-startup.json')
  }

  /**
   * Download the Node.js binary to a temp file
   */
  public async downloadNodejs(downloadUrl: string): Promise<string> {
    return downloadNodejs(downloadUrl)
  }

  /**
   * Extract the Node.js tarball
   */
  public async extractNodejs(targetVersion: string, extractConfig: TarOptionsWithAliases) {
    return extractNodejs(targetVersion, extractConfig)
  }

  /**
   * Remove npm package
   */
  public async removeNpmPackage(npmInstallPath: string) {
    return removeNpmPackage(npmInstallPath)
  }

  /**
   * Check the current status of the Homebridge Glass UI by calling its API
   */
  private async checkStatus() {
    this.logger.log(`Testing hb-service is running on port ${this.uiPort}...`)

    try {
      const res = await axios.get(`http://localhost:${this.uiPort}/api`)
      if (res.data === 'Hello World!') {
        this.logger.success('Homebridge Glass UI running.')
      } else {
        this.logger.error('Unexpected response.')
        process.exit(1)
      }
    } catch (e) {
      this.logger.error('Homebridge Glass UI not running.')
      process.exit(1)
    }
  }
}

function bootstrap() {
  return new HomebridgeServiceHelper()
}

bootstrap()
