import type { PathLike } from 'node:fs'

import type { BasePlatform } from '../base-platform.js'
import type { Logger } from '../logger.js'
import type { Action } from './cli.js'

import { execSync } from 'node:child_process'
import { chownSync } from 'node:fs'
import { readFile, rename } from 'node:fs/promises'
import { platform } from 'node:os'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

import { mkdirp, pathExists, readJson, writeJson } from 'fs-extra/esm'

import { generatePin, generateUsername } from '../../core/hap-identity.js'
import { findFreePort } from '../../core/net/port.js'
import { RE_COLON } from '../../core/regex.constants.js'

/** The range a new bridge port is picked from */
export const BRIDGE_PORT_RANGE = { min: 51000, max: 52000 } as const

export interface BridgeConfig {
  name: string
  username: string
  port: number
  pin: string
  advertiser: 'avahi' | 'bonjour-hap'
}

/**
 * A new bridge block with a random username and pin; the name ends with the
 * last two bytes of the username, e.g. `Homebridge 3C9B`.
 */
export function createBridgeConfig(port: number, advertiser: BridgeConfig['advertiser']): BridgeConfig {
  const username = generateUsername()
  const name = `Homebridge ${username.substring(username.length - 5).replace(RE_COLON, '')}`
  return {
    name,
    username,
    port,
    pin: generatePin(),
    advertiser,
  }
}

/**
 * The UI platform block
 */
export function createUiConfig(port: number) {
  return {
    name: 'Config',
    port,
    platform: 'config',
  }
}

/**
 * A new config.json with just the bridge and the UI
 */
export function createDefaultConfig(bridge: BridgeConfig, uiConfig: ReturnType<typeof createUiConfig>) {
  return {
    bridge,
    accessories: [],
    platforms: [uiConfig],
  }
}

/**
 * A UI port read from a file or an env var, or null when it is not a port
 */
export function parseUiPort(value: string | undefined): number | null {
  const port = Number.parseInt(value, 10)
  return !Number.isNaN(port) && port <= 65535 ? port : null
}

export interface RepairContext {
  action: Action
  /** The --port given to `hb-service install` */
  uiPort: number
  configPath: string
  logger: Logger
  lastKnownUiPort: () => Promise<number>
  generatePort: () => Promise<number>
  generateBridgeConfig: () => Promise<BridgeConfig>
  createUiConfig: () => Promise<ReturnType<typeof createUiConfig>>
}

/**
 * Bring a parsed config.json up to what hb-service needs, in place: a UI
 * platform block with a port (the --port on install), a bridge block with a
 * port that is not the UI's, and this plugin in a `plugins` allow-list.
 * Returns whether it changed and whether the change needs a restart.
 */
export async function repairServiceConfig(currentConfig: any, ctx: RepairContext): Promise<{ saveRequired: boolean, restartRequired: boolean }> {
  const { action, uiPort, configPath, logger } = ctx
  let saveRequired = false
  let restartRequired = false

  // Extract ui config
  if (!Array.isArray(currentConfig.platforms)) {
    currentConfig.platforms = []
  }
  let uiConfigBlock = currentConfig.platforms.find((x: any) => x.platform === 'config')

  // If the config block does not exist, then create it
  if (!uiConfigBlock) {
    logger.log(`Adding missing UI platform block to ${configPath}.`)
    uiConfigBlock = await ctx.createUiConfig()
    currentConfig.platforms.push(uiConfigBlock)
    saveRequired = true
    restartRequired = true
  }

  // Ensure the port is set
  if (action !== 'install' && typeof uiConfigBlock.port !== 'number') {
    uiConfigBlock.port = await ctx.lastKnownUiPort()
    logger.log(`Added missing port number to UI config: ${uiConfigBlock.port}.`)
    saveRequired = true
    restartRequired = true
  }

  // If doing an installation, make sure the port number matches the value passed in by the user
  if (action === 'install') {
    // Correct the port
    if (uiConfigBlock.port !== uiPort) {
      uiConfigBlock.port = uiPort
      logger.warn(`Homebridge Glass UI port in ${configPath} changed to: ${uiPort}.`)
    }
    // Delete unnecessary config
    delete uiConfigBlock.restart
    delete uiConfigBlock.sudo
    delete uiConfigBlock.log
    saveRequired = true
  }

  // Ensure the ui port is defined and is a number
  if (typeof uiConfigBlock.port !== 'number') {
    uiConfigBlock.port = await ctx.lastKnownUiPort()
    logger.log(`Added missing port number to UI config: ${uiConfigBlock.port}.`)
    saveRequired = true
    restartRequired = true
  }

  // Check the bridge section exists
  if (!currentConfig.bridge) {
    currentConfig.bridge = await ctx.generateBridgeConfig()
    logger.log('Added missing Homebridge bridge section to the config.json.')
    saveRequired = true
  }

  // Ensure port is set in bridge config
  if (!currentConfig.bridge.port) {
    currentConfig.bridge.port = await ctx.generatePort()
    logger.log(`Added port to the Homebridge bridge section of the config.json: ${currentConfig.bridge.port}.`)
    saveRequired = true
  }

  // Ensure bridge port is not the same as the UI port
  if ((uiConfigBlock && currentConfig.bridge.port === uiConfigBlock.port) || currentConfig.bridge.port === 8080) {
    currentConfig.bridge.port = await ctx.generatePort()
    logger.log(`Bridge port must not be the same as the UI port. Changing bridge port to: ${currentConfig.bridge.port}.`)
    saveRequired = true
  }

  // Ensure @mp-consulting/homebridge-config-glass-ui is enabled if the plugins array is set
  if (currentConfig.plugins && Array.isArray(currentConfig.plugins)) {
    if (!currentConfig.plugins.includes('@mp-consulting/homebridge-config-glass-ui')) {
      currentConfig.plugins.push('@mp-consulting/homebridge-config-glass-ui')
      logger.log('Added Homebridge Glass UI to the plugins array in the config.json.')
      saveRequired = true
    }
  }

  return { saveRequired, restartRequired }
}

/**
 * The parts of HomebridgeServiceHelper the config bootstrap reads
 */
export interface ConfigBootstrapHost {
  action: Action
  uiPort: number
  storagePath: string
  logger: Logger
  installer: BasePlatform
}

/**
 * Creates and checks the storage directory and config.json before Homebridge
 * starts or the service is installed.
 */
export class ConfigBootstrap {
  private avahiDaemonRunning: boolean | undefined

  constructor(private readonly hb: ConfigBootstrapHost) {}

  private get configPath() {
    return process.env.UIX_CONFIG_PATH
  }

  /**
   * Ensures the storage path defined exists
   */
  public async storagePathCheck() {
    const { storagePath, logger } = this.hb
    if (platform() === 'darwin' && !await pathExists(dirname(storagePath))) {
      logger.error(`Cannot create Homebridge storage directory, base path does not exist: ${dirname(storagePath)}.`)
      process.exit(1)
    }

    if (!await pathExists(storagePath)) {
      logger.log(`Creating Homebridge directory: ${storagePath}.`)
      await mkdirp(storagePath)
      await this.chownPath(storagePath)
    }
  }

  /**
   * Ensures the config.json exists and is valid.
   * If the config is not valid json it will be backed up and replaced with the default.
   */
  public async configCheck() {
    const { logger } = this.hb
    let restartRequired = false

    if (!await pathExists(this.configPath)) {
      logger.log(`Creating default config.json: ${this.configPath}.`)
      await this.createDefaultConfig()
      restartRequired = true
    }

    try {
      const currentConfig = await readJson(this.configPath)

      const result = await repairServiceConfig(currentConfig, {
        action: this.hb.action,
        uiPort: this.hb.uiPort,
        configPath: this.configPath,
        logger,
        lastKnownUiPort: () => this.getLastKnownUiPort(),
        generatePort: () => this.generatePort(),
        generateBridgeConfig: () => this.generateBridgeConfig(),
        createUiConfig: () => this.createDefaultUiConfig(),
      })
      restartRequired ||= result.restartRequired

      if (result.saveRequired) {
        await writeJson(this.configPath, currentConfig, { spaces: 4 })
      }
    } catch (e) {
      const backupFile = resolve(this.hb.storagePath, `config.json.invalid.${Date.now().toString()}`)
      logger.warn(`${this.configPath} does not contain valid JSON.`)
      logger.warn(`Invalid config.json file has been backed up to ${backupFile}.`)
      await rename(this.configPath, backupFile)
      await this.createDefaultConfig()
      restartRequired = true
    }

    // If the port number potentially changed, we need to restart here when running the
    // Raspbian image so the nginx config will be updated
    if (restartRequired && this.hb.action === 'run' && await this.isRaspbianImage()) {
      logger.log('Restarting process after port number update.')
      process.exit(1)
    }
  }

  /**
   * Creates the default config.json
   */
  public async createDefaultConfig() {
    await writeJson(this.configPath, createDefaultConfig(
      await this.generateBridgeConfig(),
      await this.createDefaultUiConfig(),
    ), { spaces: 4 })
    await this.chownPath(this.configPath)
  }

  /**
   * Create a default Homebridge bridge config
   */
  private async generateBridgeConfig() {
    const port = await this.generatePort()
    const advertiser = await this.isAvahiDaemonRunning() ? 'avahi' : 'bonjour-hap'
    return createBridgeConfig(port, advertiser)
  }

  /**
   * Create the default ui config
   */
  private async createDefaultUiConfig() {
    return createUiConfig(this.hb.action === 'install' ? this.hb.uiPort : await this.getLastKnownUiPort())
  }

  /**
   * Returns true if running on the Homebridge Raspbian Image
   */
  private async isRaspbianImage(): Promise<boolean> {
    return platform() === 'linux' && await pathExists('/etc/hb-ui-port')
  }

  /**
   * Check what the last known UI port was
   * Used when the ui config block is deleted and needs to be recreated
   */
  private async getLastKnownUiPort() {
    // Check if we are running the raspbian image, the port will be stored in /etc/hb-ui-port
    if (await this.isRaspbianImage()) {
      const lastPort = parseUiPort(await readFile('/etc/hb-ui-port', 'utf8'))
      if (lastPort !== null) {
        return lastPort
      }
    }

    // Check if the port is defined in an env var (docker)
    const envPort = parseUiPort(process.env.HOMEBRIDGE_CONFIG_UI_PORT)
    if (envPort !== null) {
      return envPort
    }

    // Otherwise return the default port
    return this.hb.uiPort
  }

  /**
   * Generate a random port for Homebridge
   */
  private async generatePort() {
    return findFreePort(BRIDGE_PORT_RANGE.min, BRIDGE_PORT_RANGE.max)
  }

  /**
   * Test to see if the avahi-daemon service is running
   * @returns boolean true if the avahi-daemon service is running
   */
  private async isAvahiDaemonRunning(): Promise<boolean> {
    if (this.avahiDaemonRunning !== undefined) {
      return this.avahiDaemonRunning
    }
    if (platform() !== 'linux') {
      this.avahiDaemonRunning = false
      return false
    }
    if (!await pathExists('/etc/avahi/avahi-daemon.conf') || !await pathExists('/usr/bin/systemctl')) {
      this.avahiDaemonRunning = false
      return false
    }
    try {
      if (await pathExists('/usr/lib/systemd/system/avahi.service')) {
        execSync('systemctl is-active --quiet avahi 2> /dev/null')
        this.avahiDaemonRunning = true
        return true
      } else if (await pathExists('/lib/systemd/system/avahi-daemon.service')) {
        execSync('systemctl is-active --quiet avahi-daemon 2> /dev/null')
        this.avahiDaemonRunning = true
        return true
      } else {
        this.avahiDaemonRunning = false
        return false
      }
    } catch (e) {
      this.avahiDaemonRunning = false
      return false
    }
  }

  /**
   * Corrects the permissions on files when running the hb-service command using sudo
   */
  public async chownPath(pathToChown: PathLike) {
    if (platform() !== 'win32' && process.getuid() === 0) {
      const { uid, gid } = await this.hb.installer.getId()
      chownSync(pathToChown, uid, gid)
    }
  }
}
