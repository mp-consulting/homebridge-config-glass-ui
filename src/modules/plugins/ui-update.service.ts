/* global NodeJS */

import type {
  PackageUpdateResult,
} from './plugins.interfaces.js'

import { EventEmitter } from 'node:events'
import { platform } from 'node:os'
import {
  resolve,
} from 'node:path'
import process from 'node:process'

import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common'
import { pathExists } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import {
  RE_PLUGIN_NAME,
} from '../../core/regex.constants.js'
import { ChildBridgesService } from '../child-bridges/child-bridges.service.js'
import { InstalledPluginsService } from './installed-plugins.service.js'
import { PluginInstallerService } from './plugin-installer.service.js'
import { PluginMetadataService } from './plugin-metadata.service.js'
import { HomebridgeUpdateActionDto, RE_NPM_VERSION } from './plugins.dto.js'

/**
 * Updates of Homebridge and the UI itself, the scheduled single-package
 * update endpoint, and the UI's delayed self-restart.
 */
@Injectable()
export class UiUpdateService implements OnModuleDestroy {
  // Constants
  private static readonly UI_RESTART_DELAY_MS = 5000

  // Handle for the pending self-restart, so it can be cancelled if this module
  // is torn down before it fires. See scheduleUiRestart / onModuleDestroy.
  private uiRestartTimer?: NodeJS.Timeout

  /**
   * Arm the delayed self-restart after the UI has updated itself.
   *
   * ⚠️ This calls `process.exit`, so it must not outlive the module that armed
   * it. It previously ran as a bare `setTimeout`, which meant an e2e test that
   * exercised `POST /plugins/update/@mp-consulting/homebridge-config-glass-ui` left a five second
   * fuse burning: the test passed, then the timer killed the test runner
   * mid-suite with "process.exit unexpectedly called with 0". Whether it went
   * off at all came down to whether the worker happened to still be alive five
   * seconds later, so adding an unrelated test file was enough to turn it from
   * dormant to reproducible on every platform.
   *
   * `unref` so it can never be the only thing holding the process open, and the
   * handle is kept so `onModuleDestroy` can clear it.
   *
   * Public because the Update All finale arms it too - always after its
   * journal is safely on disk, since this timer ends the process.
   */
  public scheduleUiRestart(): void {
    // Re-arming must reset the fuse, not orphan the old one - an uncleared
    // earlier timer keeps its original deadline and can end the process
    // inside the fresh window the new caller was promised
    if (this.uiRestartTimer) {
      clearTimeout(this.uiRestartTimer)
    }
    this.uiRestartTimer = setTimeout(() => {
      void this.exitOnceUpdatesFinish()
    }, UiUpdateService.UI_RESTART_DELAY_MS)
    this.uiRestartTimer.unref()
  }

  /**
   * True while a self-restart fuse is burning. Long work started now (an
   * Update All run) would be cut short by the exit, so callers refuse to
   * start until the restart has happened.
   */
  public get uiRestartPending(): boolean {
    return this.uiRestartTimer !== undefined
  }

  /**
   * Exit for the self-restart only once no package operation is running or
   * queued. Exiting kills this process's npm children, and an npm install
   * killed mid-extraction leaves the package half-unpacked on disk - a
   * homebridge caught like that cannot start again (updater#278: an
   * auto-updater posted homebridge + ui + plugin updates in one pass, the
   * ui's own update finished first, and this exit destroyed the rest).
   */
  private async exitOnceUpdatesFinish(): Promise<void> {
    while (this.installer.pendingPackageOperations > 0) {
      this.logger.warn('Waiting for a package update to finish before restarting the UI...')
      await this.installer.packageOperationsSettled
    }
    // Torn down while waiting (tests) - never exit someone else's process
    if (!this.uiRestartTimer) {
      return
    }
    process.exit(0)
  }

  public onModuleDestroy(): void {
    if (this.uiRestartTimer) {
      clearTimeout(this.uiRestartTimer)
      this.uiRestartTimer = undefined
    }
  }

  constructor(
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
    @Inject(ChildBridgesService) private readonly childBridgesService: ChildBridgesService,
    @Inject(InstalledPluginsService) private readonly installed: InstalledPluginsService,
    @Inject(PluginInstallerService) private readonly installer: PluginInstallerService,
    @Inject(PluginMetadataService) private readonly metadata: PluginMetadataService,
  ) {}

  /**
   * Updates the Homebridge package
   */
  public async updateHomebridgePackage(homebridgeUpdateAction: HomebridgeUpdateActionDto, client: EventEmitter) {
    this.installer.assertValidPackageRequest(null, homebridgeUpdateAction?.version)
    return this.installer.queuePackageOperation(() => this.doUpdateHomebridgePackage(homebridgeUpdateAction, client))
  }

  private async doUpdateHomebridgePackage(homebridgeUpdateAction: HomebridgeUpdateActionDto, client: EventEmitter) {
    const homebridge = await this.installed.getHomebridgePackage()

    homebridgeUpdateAction.version = homebridgeUpdateAction.version || 'latest'
    if (homebridgeUpdateAction.version === 'latest' && homebridge.latestVersion) {
      homebridgeUpdateAction.version = homebridge.latestVersion
    }

    // Get the currently installed
    let installPath = homebridge.installPath

    // Prepare flags for npm command
    const installOptions: Array<string> = []
    installOptions.push('--omit=dev')

    // Check to see if the custom plugin path is using a package.json file
    if (installPath === this.configService.customPluginPath && await pathExists(resolve(installPath, '../package.json'))) {
      installOptions.push('--save')
    }

    installPath = resolve(installPath, '../')

    // Set global flag
    if (homebridge.globalInstall || platform() === 'win32') {
      installOptions.push('-g')
    }

    await this.installer.runNpmCommand(
      [...this.installer.npm, 'install', ...installOptions, `${homebridge.name}@${homebridgeUpdateAction.version}`],
      installPath,
      client,
      homebridgeUpdateAction.termCols,
      homebridgeUpdateAction.termRows,
    )

    return true
  }

  /**
   * Trigger an update for Homebridge, @mp-consulting/homebridge-config-glass-ui, or any plugin
   * This method queues the update to be performed asynchronously
   * @param name - The package name (homebridge, @mp-consulting/homebridge-config-glass-ui, or a plugin name)
   * @param version - Optional version to install (defaults to latest)
   * @returns Object containing operation status, package name, and version
   */
  public async triggerUpdate(name: string, version?: string): Promise<{ ok: boolean, name: string, version: string }> {
    if (version !== undefined && (typeof version !== 'string' || (version !== '' && !RE_NPM_VERSION.test(version)))) {
      throw new BadRequestException('Invalid version parameter.')
    }

    // Get package information to validate it exists
    let targetVersion = version || 'latest'

    try {
      switch (name) {
        case 'homebridge': {
          const homebridge = await this.installed.getHomebridgePackage()
          if (targetVersion === 'latest' && homebridge.latestVersion) {
            targetVersion = homebridge.latestVersion
          }
          break
        }
        case '@mp-consulting/homebridge-config-glass-ui': {
          const uiPackage = await this.installed.getHomebridgeUiPackage()
          if (!uiPackage) {
            throw new NotFoundException(`Package ${name} is not installed.`)
          }
          if (targetVersion === 'latest' && uiPackage.latestVersion) {
            targetVersion = uiPackage.latestVersion
          }
          break
        }
        default: {
          if (!RE_PLUGIN_NAME.test(name)) {
            throw new BadRequestException('Invalid package name. Must be "homebridge", "@mp-consulting/homebridge-config-glass-ui", or a valid Homebridge plugin name.')
          }

          // It's a plugin
          const plugins = await this.installed.getInstalledPlugins()
          const plugin = plugins.find(p => p.name === name)
          if (!plugin) {
            throw new NotFoundException(`Plugin ${name} is not installed.`)
          }
          if (targetVersion === 'latest' && plugin.latestVersion) {
            targetVersion = plugin.latestVersion
          }
        }
      }
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw e
      }
      this.logger.error(`Failed to validate package ${name} for update: ${e.message}`)
      throw new BadRequestException(`Failed to validate package ${name} for update.`)
    }

    // Schedule the update to run asynchronously
    setImmediate(async () => {
      this.logger.log(`Starting scheduled update for ${name} to version ${targetVersion}`)

      // Create a mock client for capturing output
      const mockClient = new EventEmitter()
      mockClient.on('stdout', (data) => {
        this.logger.log(`[${name} update] ${data.toString().trim()}`)
      })

      const result = await this.performPackageUpdate(name, targetVersion, mockClient)

      if (!result.ok) {
        this.logger.error(`Failed to update ${name}: ${result.error}`)
        // Fallback to restarting Homebridge if anything goes wrong
        try {
          this.logger.warn('Attempting fallback restart of Homebridge process...')
          this.homebridgeIpcService.restartHomebridge()
        } catch (restartError) {
          this.logger.error(`Failed to restart Homebridge: ${restartError.message}`)
        }
        return
      }

      // Apply the restart the update calls for. The narration matches the
      // pre-extraction behaviour exactly.
      try {
        if (result.restart.homebridge && name === 'homebridge') {
          this.logger.log(`Successfully updated Homebridge to version ${targetVersion}. Performing quick restart of Homebridge process...`)
          this.homebridgeIpcService.restartHomebridge()
        } else if (result.restart.ui) {
          this.logger.warn(`@mp-consulting/homebridge-config-glass-ui has been updated, server will restart in ${UiUpdateService.UI_RESTART_DELAY_MS / 1000} seconds...`)
          this.scheduleUiRestart()
        } else if (result.restart.childBridgeUsernames.length > 0) {
          this.logger.log(`Successfully updated ${name} to version ${targetVersion}.`)
          this.logger.log(`${name} is running in ${result.restart.childBridgeUsernames.length} child bridge(s). Restarting child bridges: ${result.restart.childBridgeUsernames.join(', ')}`)
          for (const username of result.restart.childBridgeUsernames) {
            this.logger.log(`Restarting child bridge ${username}...`)
            this.childBridgesService.restartChildBridge(username)
          }
        } else if (result.restart.homebridge) {
          this.logger.log(`Successfully updated ${name} to version ${targetVersion}.`)
          this.logger.log(`${name} is not running in a child bridge. Performing quick restart of Homebridge process...`)
          this.homebridgeIpcService.restartHomebridge()
        }
      } catch (error) {
        this.logger.error(`Failed to update ${name}: ${error.message}`)
        try {
          this.logger.warn('Attempting fallback restart of Homebridge process...')
          this.homebridgeIpcService.restartHomebridge()
        } catch (restartError) {
          this.logger.error(`Failed to restart Homebridge: ${restartError.message}`)
        }
      }
    })

    return {
      ok: true,
      name,
      version: targetVersion,
    }
  }

  /**
   * Perform a single package update (plugin, Homebridge, or the UI itself)
   * WITHOUT any restart side effect. The result says what restart the update
   * calls for; the caller decides when - and whether - to apply it. This is
   * the shared path between the single-package endpoint above and the
   * Update All orchestrator, which must control restart ordering itself
   * (one Homebridge restart at the end, the UI's own restart last of all).
   */
  public async performPackageUpdate(name: string, version: string, client: EventEmitter): Promise<PackageUpdateResult> {
    const restart = { homebridge: false, ui: false, childBridgeUsernames: [] as string[] }
    try {
      if (name === 'homebridge') {
        await this.updateHomebridgePackage({ version }, client)
        restart.homebridge = true
      } else if (name === this.configService.name) {
        await this.installer.managePlugin('install', { name, version }, client)
        restart.ui = true
      } else {
        // A regular plugin - install it, then work out what runs it
        await this.installer.managePlugin('install', { name, version }, client)
        restart.childBridgeUsernames = await this.metadata.getPluginChildBridgeUsernames(name)
        if (restart.childBridgeUsernames.length === 0) {
          restart.homebridge = true
        }
      }
      return { ok: true, name, version, restart }
    } catch (error) {
      return { ok: false, name, version, error: error.message, restart }
    }
  }
}
