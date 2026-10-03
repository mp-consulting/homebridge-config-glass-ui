import type { EventEmitter } from 'node:events'

import type { HomebridgePlugin } from '../plugins/plugins.interfaces.js'

import { lstat, realpath } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import process from 'node:process'

import { Inject, Injectable } from '@nestjs/common'
import { cyan, red, yellow } from 'bash-color'
import { copy, pathExists, readJson } from 'fs-extra/esm'
import { networkInterfaces } from 'systeminformation'

import { HomebridgeConfig } from '../../core/config/config.interfaces.js'
import { ConfigService } from '../../core/config/config.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { RE_COLON } from '../../core/regex.constants.js'
import { findUnsafeBridgeEnvValues, findUnsafeUiValues, removeUnsafeBridgeEnvValues, removeUnsafeUiValues } from '../config-editor/config-safety.js'
import { PluginsService } from '../plugins/plugins.service.js'
import { assertNoSymlinks } from './archive-safety.js'
import { BACKUP_EXCLUDED_NAMES } from './backup.constants.js'

/** Plugins never reinstalled from an instance backup */
const NOT_RESTORED_PLUGINS = [
  '@mp-consulting/homebridge-config-glass-ui',
]

/** Map hbfx plugins to homebridge plugins */
const HBFX_PLUGIN_MAP: Record<string, string> = {
  'hue': 'homebridge-hue',
  'chamberlain': 'homebridge-chamberlain',
  'google-home': 'homebridge-gsh',
  'ikea-tradfri': 'homebridge-ikea-tradfri-gateway',
  'nest': 'homebridge-nest',
  'ring': 'homebridge-ring',
  'roborock': 'homebridge-roborock',
  'shelly': 'homebridge-shelly',
  'wink': 'homebridge-wink3',
  'homebridge-tuya-web': '@milo526/homebridge-tuya-web',
}

/** Files in an hbfx `etc` directory that are not restored into storage */
const HBFX_SKIPPED_FILES = [
  'access.json',
  'dashboard.json',
  'layout.json',
  'config.json',
  ...BACKUP_EXCLUDED_NAMES,
]

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

/**
 * The format-specific steps of a restore. The shared pipeline (see
 * BackupRestoreService.run) validates the archive, prints its information,
 * then runs these in order and saves the config they build.
 */
interface RestorePlan {
  /** Paths (relative to the extracted archive) that must exist */
  requiredPaths: string[][]
  /** The error when one is missing */
  invalidMessage: string
  /** The JSON file describing the archive */
  infoFile: string[]
  /** The archive information lines printed from it */
  describe: (info: any) => string[]
  /** Logged when the restore starts */
  startLog: string
  /** Printed when the restore starts */
  startBanner: string
  restoreFiles: (dir: string, storagePath: string, client: EventEmitter) => Promise<void>
  restorePlugins: (dir: string, client: EventEmitter) => Promise<void>
  /** The config.json to save, checked like a config save */
  buildConfig: (dir: string, client: EventEmitter) => Promise<HomebridgeConfig>
}

/**
 * Restores an extracted backup archive - an instance backup (.tar.gz) or an
 * hbfx backup (.hbfx) - into the storage path, and restarts afterwards.
 */
@Injectable()
export class BackupRestoreService {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(JsonFileStoreService) private readonly jsonStore: JsonFileStoreService,
  ) {}

  /**
   * Restore an extracted instance backup
   * @param dir - the extracted archive
   * @param client - receives the progress output
   * @param discard - removes the archive; called when it is not valid
   */
  async restoreInstanceBackup(dir: string, client: EventEmitter, discard: () => Promise<unknown>): Promise<void> {
    await this.run(dir, client, discard, {
      requiredPaths: [['info.json'], ['plugins.json'], ['storage']],
      invalidMessage: 'Uploaded file is not a valid Homebridge Backup Archive.',
      infoFile: ['info.json'],
      describe: info => [
        `Source Node.js Version: ${info.node}\r\n`,
        `Source Homebridge Glass UI Version: v${info.uix}\r\n`,
        `Source Platform: ${info.platform}\r\n`,
        `Created: ${info.timestamp}\r\n`,
      ],
      startLog: 'Starting backup restore...',
      startBanner: '\r\nRestoring backup...\r\n\r\n',
      restoreFiles: async (dir, storagePath, client) => {
        await sleep(100)
        await copy(resolve(dir, 'storage'), storagePath, {
          filter: async (filePath) => {
            // Anything a backup leaves out is refused here too, so a crafted (or
            // older) archive cannot plant the JWT secret, hb-service startup
            // options, startup.sh, node_modules, ...
            if (BACKUP_EXCLUDED_NAMES.includes(basename(filePath))) {
              client.emit('stdout', `Skipping ${basename(filePath)}\r\n`)
              return false
            }

            // Check each item is a real directory or real file (no symlinks, pipes, unix sockets etc.)
            try {
              const stat = await lstat(filePath)
              if (stat.isDirectory() || stat.isFile()) {
                client.emit('stdout', `Restoring ${basename(filePath)}\r\n`)
                return true
              } else {
                client.emit('stdout', `Skipping ${basename(filePath)}\r\n`)
                return false
              }
            } catch {
              // Gone or unreadable - not restorable, and the skip is reported
              client.emit('stdout', `Skipping ${basename(filePath)}\r\n`)
              return false
            }
          },
        })
        client.emit('stdout', yellow('File restore complete.\r\n'))
        await sleep(1000)
      },
      restorePlugins: async (dir, client) => {
        client.emit('stdout', cyan('\r\nRestoring plugins...\r\n'))
        const plugins: HomebridgePlugin[] = (await readJson(resolve(dir, 'plugins.json')))
          .filter((x: HomebridgePlugin) => !NOT_RESTORED_PLUGINS.includes(x.name) && x.publicPackage)
        await this.installPlugins(plugins.map(x => ({ name: x.name, version: x.installedVersion })), client)
      },
      buildConfig: async (_dir, client) => {
        // The files restored above include config.json
        const restoredConfig: HomebridgeConfig = await readJson(this.configService.configPath)

        // Ensure the bridge port does not change
        if (restoredConfig.bridge) {
          restoredConfig.bridge.port = this.configService.homebridgeConfig.bridge.port
        }

        // Check the bridge.bind config contains valid interface names
        if (restoredConfig.bridge?.bind) {
          await this.checkBridgeBindConfig(restoredConfig)
        }

        // Ensure platforms in an array
        if (!Array.isArray(restoredConfig.platforms)) {
          restoredConfig.platforms = []
        }

        // Apply the same command checks as a config save
        this.sanitiseRestoredUiConfig(restoredConfig, client)

        // Load the ui config block
        const uiConfigBlock = restoredConfig.platforms.find(x => x.platform === 'config')

        if (uiConfigBlock) {
          uiConfigBlock.port = this.configService.ui.port
        } else {
          restoredConfig.platforms.push({
            name: 'Config',
            port: this.configService.ui.port,
            platform: 'config',
          })
        }
        return restoredConfig
      },
    })
  }

  /**
   * Restore an extracted .hbfx backup
   * @param dir - the extracted archive
   * @param client - receives the progress output
   * @param discard - removes the archive; called when it is not valid
   */
  async restoreHbfxBackup(dir: string, client: EventEmitter, discard: () => Promise<unknown>): Promise<void> {
    // Read by restorePlugins, used again by buildConfig
    let sourceConfig: any

    await this.run(dir, client, discard, {
      requiredPaths: [['package.json'], ['etc', 'config.json']],
      invalidMessage: 'Uploaded file is not a valid HBFX Backup Archive.',
      infoFile: ['package.json'],
      describe: info => [
        `Backup Source: ${info.name}\r\n`,
        `Version: v${info.version}\r\n`,
      ],
      startLog: 'Starting hbfx restore...',
      startBanner: '\r\nRestoring hbfx backup...\r\n\r\n',
      restoreFiles: async (dir, storagePath, client) => {
        await copy(resolve(dir, 'etc'), resolve(storagePath), {
          filter: (filePath) => {
            if (HBFX_SKIPPED_FILES.includes(basename(filePath))) {
              return false
            }
            client.emit('stdout', `Restoring ${basename(filePath)}\r\n`)
            return true
          },
        })

        // Restore accessories
        const sourceAccessoriesPath = resolve(dir, 'etc', 'accessories')
        const targetAccessoriesPath = resolve(storagePath, 'accessories')
        if (await pathExists(sourceAccessoriesPath)) {
          await copy(sourceAccessoriesPath, targetAccessoriesPath, {
            filter: (filePath) => {
              client.emit('stdout', `Restoring ${basename(filePath)}\r\n`)
              return true
            },
          })
        }
      },
      restorePlugins: async (dir, client) => {
        sourceConfig = await readJson(resolve(dir, 'etc', 'config.json'))
        if (sourceConfig.plugins?.length) {
          await this.installPlugins(sourceConfig.plugins.map((plugin: string) => ({
            name: plugin in HBFX_PLUGIN_MAP ? HBFX_PLUGIN_MAP[plugin] : plugin,
            version: 'latest',
          })), client)
        }
      },
      buildConfig: async (_dir, client) => {
        // Clone elements from the source config that we care about
        const targetConfig: HomebridgeConfig = JSON.parse(JSON.stringify({
          bridge: sourceConfig.bridge && typeof sourceConfig.bridge === 'object' ? sourceConfig.bridge : {},
          accessories: sourceConfig.accessories?.map((x: any) => {
            delete x.plugin_map
            return x
          }) || [],
          // The UI block is replaced with this instance's own below
          platforms: sourceConfig.platforms?.filter((x: any) => x?.platform !== 'config').map((x: any) => {
            if (x.platform === 'google-home') {
              x.platform = 'google-smarthome'
              x.notice = 'Keep your token a secret!'
            }
            delete x.plugin_map
            return x
          }) || [],
        }))

        // An hbfx config without a bridge username keeps this instance's one
        if (typeof targetConfig.bridge.username !== 'string' || !targetConfig.bridge.username) {
          targetConfig.bridge.username = this.configService.homebridgeConfig.bridge.username
        }

        // Correct bridge name
        targetConfig.bridge.name = `Homebridge ${targetConfig.bridge.username.substring(targetConfig.bridge.username.length - 5).replace(RE_COLON, '')}`

        // Check the bridge.bind config contains valid interface names
        if (targetConfig.bridge.bind) {
          await this.checkBridgeBindConfig(targetConfig)
        }

        this.sanitiseRestoredBridgeEnv(targetConfig, client)

        // Add config ui platform
        targetConfig.platforms.push({
          ...this.configService.ui,
          platform: 'config',
        })
        return targetConfig
      },
    })
  }

  /**
   * The pipeline both formats share: validate the archive, print what it
   * is, restore the files and plugins, then save the checked config.
   */
  private async run(dir: string, client: EventEmitter, discard: () => Promise<unknown>, plan: RestorePlan): Promise<void> {
    await this.validateArchive(dir, plan, discard)

    // Display backup archive information
    const info = await readJson(resolve(dir, ...plan.infoFile))
    client.emit('stdout', cyan('Backup Archive Information\r\n'))
    for (const line of plan.describe(info)) {
      client.emit('stdout', line)
    }

    // Start restore
    this.logger.warn(plan.startLog)
    client.emit('stdout', cyan(plan.startBanner))
    await sleep(1000)

    // Resolve the real path of the storage directory (in case it's a symbolic link)
    const storagePath = await realpath(this.configService.storagePath)

    // Restore files
    client.emit('stdout', yellow(`Restoring Homebridge storage to ${storagePath}\r\n`))
    await plan.restoreFiles(dir, storagePath, client)

    await plan.restorePlugins(dir, client)

    const config = await plan.buildConfig(dir, client)

    // Save the config (atomic write under the JSON store lock so a
    // crash mid-write doesn't leave config.json half-truncated).
    await this.jsonStore.write(this.configService.configPath, config)
  }

  /**
   * Refuse (and discard) an archive missing a required file, or holding a
   * symlink anywhere
   */
  private async validateArchive(dir: string, plan: RestorePlan, discard: () => Promise<unknown>): Promise<void> {
    for (const path of plan.requiredPaths) {
      if (!await pathExists(resolve(dir, ...path))) {
        await discard()
        throw new Error(plan.invalidMessage)
      }
    }

    // Reject the whole archive up front if any extracted entry is a symlink.
    // The extractors already block symlink *entries*; this catches anything
    // that slipped through (e.g. fs-extra dereferencing a dir entry whose
    // contents are symlinks).
    try {
      await assertNoSymlinks(dir)
    } catch (err) {
      await discard()
      throw err
    }
  }

  /**
   * Install each plugin in turn, reporting (not throwing) a failed install
   */
  private async installPlugins(plugins: { name: string, version: string }[], client: EventEmitter): Promise<void> {
    for (const plugin of plugins) {
      try {
        client.emit('stdout', yellow(`\r\nInstalling ${plugin.name}...\r\n`))
        await this.pluginsService.managePlugin('install', { name: plugin.name, version: plugin.version }, client)
      } catch {
        // Reported to the client; the restore carries on with the others
        client.emit('stdout', red(`Failed to install ${plugin.name}.\r\n`))
      }
    }
  }

  /**
   * Send SIGKILL to Homebridge to prevent accessory cache being re-generated on shutdown
   */
  restartAfterRestore() {
    setTimeout(async () => {
      // Kill homebridge first. If `kill()` returns false the signal
      // didn't land — Homebridge is still running. Self-killing the
      // UI from that state would leave Homebridge alive on the OLD
      // pre-restore config and the service supervisor would bring the
      // UI back up to a mismatched setup.
      const delivered = await this.homebridgeIpcService.killHomebridge()
      if (!delivered) {
        this.logger.error('Skipping UI self-kill: Homebridge SIGKILL was not delivered.')
        return
      }

      // Kill self
      setTimeout(() => {
        process.kill(process.pid, 'SIGKILL')
      }, 500)
    }, 500)

    return { status: 0 }
  }

  /**
   * Run the restored UI block(s), and every child bridge's NODE_OPTIONS,
   * through the checks a config save uses, dropping any unsafe value so the
   * restore still completes.
   */
  private sanitiseRestoredUiConfig(restoredConfig: HomebridgeConfig, client: EventEmitter) {
    for (const uiBlock of restoredConfig.platforms.filter(x => x?.platform === 'config')) {
      const unsafe = findUnsafeUiValues(uiBlock, this.configService.ui, {
        terminalEnabled: this.configService.enableTerminalAccess,
        storagePath: this.configService.storagePath,
      })
      if (!unsafe.length) {
        continue
      }
      removeUnsafeUiValues(uiBlock, unsafe)
      for (const { path, reason } of unsafe) {
        this.logger.warn(`Backup restore removed the unsafe "${path}" value from the restored config.json. ${reason}`)
        client.emit('stdout', red(`Removed unsafe "${path}" from the restored config.json. ${reason}\r\n`))
      }
    }

    this.sanitiseRestoredBridgeEnv(restoredConfig, client)
  }

  /**
   * Drop a child bridge `_bridge.env.NODE_OPTIONS` that a config save would
   * refuse (see `findUnsafeBridgeEnvValues`): Homebridge hands it to the child
   * bridge process, so it would load code just like the startup NODE_OPTIONS.
   */
  private sanitiseRestoredBridgeEnv(restoredConfig: HomebridgeConfig, client: EventEmitter) {
    const unsafe = findUnsafeBridgeEnvValues(restoredConfig)
    removeUnsafeBridgeEnvValues(restoredConfig, unsafe)
    for (const { path, reason } of unsafe) {
      this.logger.warn(`Backup restore removed the unsafe "${path}" value from the restored config.json. ${reason}`)
      client.emit('stdout', red(`Removed unsafe "${path}" from the restored config.json. ${reason}\r\n`))
    }
  }

  /**
   * Checks the 'bridge.bind' options are valid for the current system when restoring.
   */
  private async checkBridgeBindConfig(restoredConfig: HomebridgeConfig) {
    if (restoredConfig.bridge.bind) {
      // If it's a string, convert to an array
      if (typeof restoredConfig.bridge.bind === 'string') {
        restoredConfig.bridge.bind = [restoredConfig.bridge.bind]
      }

      // If it's still not an array, delete it
      if (!Array.isArray(restoredConfig.bridge.bind)) {
        delete restoredConfig.bridge.bind
        return
      }

      // Check each interface exists on the new host
      const interfaces = await networkInterfaces()
      const ifaceNames = interfaces.map(i => i.iface)
      restoredConfig.bridge.bind = restoredConfig.bridge.bind.filter(x => ifaceNames.includes(x))

      // If empty delete
      if (!restoredConfig.bridge.bind.length) {
        delete restoredConfig.bridge.bind
      }
    }
  }
}
