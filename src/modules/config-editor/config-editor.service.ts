import { copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { readJson } from 'fs-extra/esm'
import { gte } from 'semver'

import {
  AccessoryConfig,
  HomebridgeConfig,
  HomebridgeUiBridgeConfig,
  PlatformConfig,
} from '../../core/config/config.interfaces.js'
import { ConfigService } from '../../core/config/config.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { RE_PLUGIN_NAME, RE_USERNAME } from '../../core/regex.constants.js'
import { BackupService } from '../backup/backup.service.js'
import { ChildBridgesService } from '../child-bridges/child-bridges.service.js'
import { PluginsService } from '../plugins/plugins.service.js'
import { ConfigBackupService } from './config-backup.service.js'
import { cleanUpUiConfig, generatePin, generateUsername, normaliseConfig } from './config-normalise.js'
import { findUnsafeUiValues, RESTART_COMMAND_RULE } from './config-safety.js'

export interface ConfigEditorRestartInfo<T> {
  config: T
  affectedBridges: Awaited<ReturnType<ChildBridgesService['getChildBridges']>>
}

@Injectable()
export class ConfigEditorService {
  constructor(
    @Inject(Logger) private readonly logger: Logger,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
    @Inject(ChildBridgesService) private readonly childBridgesService: ChildBridgesService,
    @Inject(BackupService) private readonly backupService: BackupService,
    @Inject(JsonFileStoreService) private readonly jsonStore: JsonFileStoreService,
    @Inject(ConfigBackupService) private readonly configBackupService: ConfigBackupService,
  ) {}

  /**
   * Resolves once the config backup start-up work (backup directory and
   * legacy migration) has finished, so saves never race with it.
   */
  private get ready(): Promise<void> {
    return this.configBackupService.ready
  }

  /**
   * Returns the config file
   */
  public async getConfigFile(): Promise<HomebridgeConfig> {
    const config = await readJson(this.configService.configPath)

    // Ensure bridge is an object
    if (!config.bridge || typeof config.bridge !== 'object') {
      config.bridge = {}
    }

    // Ensure accessories is an array
    if (!config.accessories || !Array.isArray(config.accessories)) {
      config.accessories = []
    }

    // Ensure platforms is an array
    if (!config.platforms || !Array.isArray(config.platforms)) {
      config.platforms = []
    }

    return config
  }

  /**
   * Throw a BadRequestException if a *new* value for `ui.restart`,
   * `ui.linux.restart`, or `ui.linux.shutdown` doesn't match the
   * allowlist regex, or a new `ui.log.command` / `ui.log.path` fails the
   * checks in `config-safety.ts` (the log command needs terminal access or
   * the log-command allowlist). Pre-existing values from earlier installs are
   * grandfathered — comparing the incoming value to the in-memory
   * `configService.ui` snapshot lets users with custom legacy commands
   * keep saving unrelated config changes, while still blocking any
   * fresh introduction of shell-injection-capable commands through the
   * settings UI or the full-config JSON editor.
   */
  private assertRestartCommandsSafe(config: HomebridgeConfig): void {
    const newUi = config.platforms?.find(p => p?.platform === 'config')
    const unsafe = findUnsafeUiValues(newUi, this.configService.ui, {
      terminalEnabled: this.configService.enableTerminalAccess,
      storagePath: this.configService.storagePath,
    })
    if (unsafe.length) {
      const { path, reason } = unsafe[0]
      this.logger.warn(`Refused to save config.json: "${path}" is not allowed.`)
      if (path.endsWith('restart') || path.endsWith('shutdown')) {
        throw new BadRequestException(`Refusing to save unsafe restart/shutdown command for "${path}". ${RESTART_COMMAND_RULE}`)
      }
      throw new BadRequestException(`Refusing to save "${path}". ${reason}`)
    }
  }

  /**
   * Normalise a config object in place (see `normaliseConfig`).
   */
  private normaliseConfig(config: HomebridgeConfig | null): HomebridgeConfig {
    return normaliseConfig(config, this.configService.homebridgeConfig.bridge, c => this.assertRestartCommandsSafe(c))
  }

  /**
   * Updates the config file
   */
  public async updateConfigFile(config: HomebridgeConfig) {
    // Wait until bootstrap-time migration has finished. Otherwise a save
    // landing during start() could race with the backup migration's
    // move/remove of legacy config.json.<ts> files.
    await this.ready
    const now = new Date()

    config = this.normaliseConfig(config)

    // Snapshot the existing config to a timestamped backup path before
    // overwriting. copyFile keeps the live file present (never unlinked)
    // so a crash between snapshot and write can't lose config.json. The
    // ENOENT case here means there isn't a live config yet — first
    // install or first save after wipe — so make sure the backup
    // directory exists ready for the next save and proceed.
    try {
      await copyFile(this.configService.configPath, resolve(this.configService.configBackupPath, `config.json.${now.getTime().toString()}`))
    } catch (e) {
      if (e.code === 'ENOENT') {
        await this.configBackupService.ensureBackupPathExists()
      } else {
        this.logger.warn(`Could not create a backup of the config.json file to ${this.configService.configBackupPath} as ${e.message}.`)
      }
    }

    // Atomic write via shared JsonFileStore: write-temp + fsync + rename
    // under the per-path mutex. Closes both the half-written-file
    // window AND the concurrent read-modify-write race when this method
    // is reached from multiple in-flight save endpoints at once.
    await this.jsonStore.write(this.configService.configPath, config, { spaces: 4 })

    this.logger.log('Changes to config.json saved.')

    // Parse the config for ui settings
    const configCopy = JSON.parse(JSON.stringify(config))
    this.configService.parseConfig(configCopy)

    return config
  }

  /**
   * Read-modify-write of config.json inside the JsonFileStore's per-path
   * mutex. The mutator receives the current config, fresh from disk and
   * normalised, and mutates it in place; its return value is handed back to
   * the caller.
   *
   * The targeted mutation endpoints (disable/enable plugin, the ui hide
   * lists, per-bridge properties, per-plugin config) used to read via
   * getConfigFile() outside the lock and then persist the whole file - so
   * two concurrent calls both loaded the same baseline and the second write
   * silently discarded the first's change. Only full-file saves, where the
   * caller intentionally supplies the entire config, stay on
   * updateConfigFile().
   */
  private async mutateConfigFile<R>(mutator: (config: HomebridgeConfig) => R | Promise<R>): Promise<R> {
    // Wait until bootstrap-time migration has finished, same as
    // updateConfigFile().
    await this.ready
    const now = new Date()

    let result: R
    await this.jsonStore.mutate<HomebridgeConfig>(
      this.configService.configPath,
      async (current) => {
        const config = this.normaliseConfig(current)
        result = await mutator(config)
        // The mutators here never touch the restart commands, but keep the
        // allowlist chokepoint on every path that persists the file.
        this.assertRestartCommandsSafe(config)
        return config
      },
      {
        spaces: 4,
        backupTo: resolve(this.configService.configBackupPath, `config.json.${now.getTime().toString()}`),
      },
    )

    this.logger.log('Changes to config.json saved.')

    // Re-parse the saved config into the runtime config service so
    // subsequent reads reflect the change.
    const updatedConfig = await this.getConfigFile()
    this.configService.parseConfig(JSON.parse(JSON.stringify(updatedConfig)))

    return result
  }

  /**
   * Return the config for a specific plugin
   */
  public async getConfigForPlugin(pluginName: string) {
    const [plugin, config] = await Promise.all([
      await this.pluginsService.getPluginAlias(pluginName),
      await this.getConfigFile(),
    ])

    if (!plugin.pluginAlias) {
      throw new BadRequestException('Plugin alias could not be determined.')
    }

    const arrayKey = plugin.pluginType === 'accessory' ? 'accessories' : 'platforms'

    return config[arrayKey].filter((block) => {
      return block[plugin.pluginType] === plugin.pluginAlias
        || block[plugin.pluginType] === `${pluginName}.${plugin.pluginAlias}`
    })
  }

  /**
   * Update the config for a specific plugin
   */
  public async updateConfigForPlugin(pluginName: string, pluginConfig: Record<string, any>[]) {
    // The alias lookup does plugin io, so it runs outside the config lock.
    const plugin = await this.pluginsService.getPluginAlias(pluginName)

    if (!plugin.pluginAlias) {
      throw new BadRequestException('Plugin alias could not be determined.')
    }

    const arrayKey = plugin.pluginType === 'accessory' ? 'accessories' : 'platforms'

    // Ensure the update contains an array
    if (!Array.isArray(pluginConfig)) {
      throw new BadRequestException('Plugin Config must be an array.')
    }

    // Validate each block in the array
    for (const block of pluginConfig) {
      if (typeof block !== 'object' || Array.isArray(block)) {
        throw new BadRequestException('Plugin config must be an array of objects.')
      }
      block[plugin.pluginType] = plugin.pluginAlias
    }

    // Try and keep any _bridge object 'clean'
    pluginConfig.forEach((block) => {
      if (block._bridge) {
        // Matter is only supported for platform-based plugins, not accessory-based plugins
        if (plugin.pluginType === 'accessory' && block._bridge.matter) {
          this.logger.warn(`Removing Matter configuration from accessory-based plugin: ${pluginName}`)
          delete block._bridge.matter
        }

        // The env object is only compatible with homebridge 1.8.0 and above
        const isEnvObjAllowed = gte(this.configService.homebridgeVersion, '1.8.0')

        Object.keys(block._bridge).forEach((key) => {
          if (key === 'env' && isEnvObjAllowed) {
            Object.keys(block._bridge.env).forEach((envKey) => {
              if (block._bridge.env[envKey] === undefined || typeof block._bridge.env[envKey] !== 'string' || block._bridge.env[envKey].trim() === '') {
                delete block._bridge.env[envKey]
              }
            })

            // If the result of env is an empty object, remove it
            if (Object.keys(block._bridge.env).length === 0) {
              delete block._bridge.env
            }
          } else {
            if (block._bridge[key] === undefined || (typeof block._bridge[key] === 'string' && block._bridge[key].trim() === '')) {
              delete block._bridge[key]
            }
          }
        })
      }
    })

    // Remove the existing blocks and put the new ones back in the same
    // location, against a fresh read of the config inside the lock.
    return this.mutateConfigFile((config) => {
      let positionIndices: number

      const removeExisting = (block: Record<string, any>, index: number) => {
        if (block[plugin.pluginType] === plugin.pluginAlias || block[plugin.pluginType] === `${pluginName}.${plugin.pluginAlias}`) {
          positionIndices = index
          return false
        } else {
          return true
        }
      }

      if (arrayKey === 'accessories') {
        config.accessories = config.accessories?.filter(removeExisting) || []
        if (positionIndices !== undefined) {
          config.accessories?.splice(positionIndices, 0, ...(pluginConfig as AccessoryConfig[]))
        } else {
          config.accessories?.push(...(pluginConfig as AccessoryConfig[]))
        }
      } else {
        config.platforms = config.platforms?.filter(removeExisting) || []
        if (positionIndices !== undefined) {
          config.platforms?.splice(positionIndices, 0, ...(pluginConfig as PlatformConfig[]))
        } else {
          config.platforms?.push(...(pluginConfig as PlatformConfig[]))
        }
      }

      return pluginConfig
    })
  }

  /**
   * Set a specific property for the Homebridge Glass UI
   */
  /**
   * Get a property from the UI config
   */
  public async getPropertyForUi(property: string) {
    // 1. Get the current config for the Homebridge Glass UI
    const config = await this.getConfigFile()
    const pluginConfig = config.platforms.find(x => x.platform === 'config')

    // 2. Get the property value, supporting dot notation for nested properties
    if (property.includes('.')) {
      const properties = property.split('.')
      let current = pluginConfig

      for (const prop of properties) {
        if (current && typeof current === 'object') {
          current = current[prop]
        } else {
          return undefined
        }
      }
      return current
    }

    return pluginConfig?.[property]
  }

  public async setPropertyForUi(property: string, value: any) {
    await this.setPropertiesForUi({ [property]: value })
  }

  /**
   * Apply multiple UI config properties in a single read/write of the
   * Homebridge config file. The settings page batches concurrent field
   * changes here so a burst of edits collapses into one disk write.
   */
  public async setPropertiesForUi(properties: Record<string, any>): Promise<void> {
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
      throw new BadRequestException('Properties must be a key/value object.')
    }

    const entries = Object.entries(properties)
    if (entries.length === 0) {
      return
    }

    if (entries.some(([key]) => key === 'platform')) {
      throw new BadRequestException('Cannot update the platform property.')
    }

    const forbiddenKeys = ['__proto__', 'constructor', 'prototype']
    const offending = entries.find(([key]) => key.split('.').some(segment => forbiddenKeys.includes(segment)))
    if (offending) {
      throw new BadRequestException(`Property "${offending[0]}" contains a forbidden key segment.`)
    }

    // Read-modify-write inside the JsonFileStore's per-path mutex so
    // two concurrent PATCH calls (multi-tab settings save, batched
    // field edits) can't both load the same baseline and clobber each
    // other on write. The mutator runs synchronously inside the lock;
    // the mutate() call also handles the atomic write-temp/fsync/
    // rename and the rotating backup snapshot.
    await this.ready
    const now = new Date()
    await this.jsonStore.mutate<HomebridgeConfig>(
      this.configService.configPath,
      (config) => {
        if (!config) {
          config = {} as HomebridgeConfig
        }
        if (!config.platforms || !Array.isArray(config.platforms)) {
          config.platforms = []
        }
        let pluginConfig = config.platforms.find(x => x.platform === 'config') as PlatformConfig | undefined
        if (!pluginConfig) {
          pluginConfig = { platform: 'config' } as PlatformConfig
          config.platforms.push(pluginConfig)
        }
        for (const [property, value] of entries) {
          this.applyPropertyToPluginConfig(pluginConfig, property, value)
        }
        config.platforms[config.platforms.findIndex(x => x.platform === 'config')] = cleanUpUiConfig(pluginConfig)
        // Restart-command allowlist runs on the same chokepoint as the
        // full-config save path so a crafted PATCH can't smuggle an
        // unsafe `ui.restart` value past the runtime guard.
        this.assertRestartCommandsSafe(config)
        return config
      },
      {
        spaces: 4,
        backupTo: resolve(this.configService.configBackupPath, `config.json.${now.getTime().toString()}`),
      },
    )

    // Re-parse the saved config into the runtime config service so
    // subsequent reads reflect the patched UI block.
    const updatedConfig = await this.getConfigFile()
    this.configService.parseConfig(JSON.parse(JSON.stringify(updatedConfig)))
    this.logger.log('Changes to config.json saved.')

    // If the scheduled-backup toggle changed, re-register the cron
    // immediately. Otherwise the scheduler keeps using the value
    // captured at module construction and the user's toggle does
    // nothing until the next UI restart.
    if (entries.some(([key]) => key === 'scheduledBackupDisable')) {
      this.backupService.refreshBackupSchedule()
    }
  }

  private applyPropertyToPluginConfig(pluginConfig: any, property: string, value: any): void {
    if (property.includes('.')) {
      const properties = property.split('.')
      let current = pluginConfig

      for (let i = 0; i < properties.length - 1; i += 1) {
        const pathSegment = properties[i]
        const hasOwnSegment = Object.hasOwn(current, pathSegment)
        if (!hasOwnSegment && pathSegment in current) {
          throw new BadRequestException(`Property "${property}" contains an invalid nested key segment.`)
        }
        if (!hasOwnSegment) {
          current[pathSegment] = {}
        }
        if (typeof current[pathSegment] !== 'object' || Array.isArray(current[pathSegment])) {
          throw new BadRequestException(`Property "${property}" cannot traverse through a non-object value.`)
        }
        current = current[pathSegment]
      }

      current[properties.at(-1)] = value
    } else {
      pluginConfig[property] = value
    }
  }

  /**
   * Find the UI's own platform block in the given config, creating it when the
   * config has none. A config.json without a `platform: config` block is a
   * supported state (ConfigService falls back to a stub at startup - the
   * standalone mode), but the mutation endpoints below dereference the block
   * unconditionally and each returned a 500 TypeError in that state.
   */
  private findOrCreateUiConfigBlock(config: HomebridgeConfig): PlatformConfig {
    let pluginConfig = config.platforms.find(x => x.platform === 'config') as PlatformConfig | undefined
    if (!pluginConfig) {
      pluginConfig = { platform: 'config' } as PlatformConfig
      config.platforms.push(pluginConfig)
    }
    return pluginConfig
  }

  /**
   * Set the accessory control blacklist (this request is not partial)
   */
  public async setAccessoryControlInstanceBlacklist(value: string[]) {
    await this.mutateConfigFile((config) => {
      const pluginConfig = this.findOrCreateUiConfigBlock(config)

      if (!pluginConfig.accessoryControl) {
        pluginConfig.accessoryControl = {}
      }
      pluginConfig.accessoryControl.instanceBlacklist = (value || [])
        .filter(x => typeof x === 'string' && x.trim() !== '' && RE_USERNAME.test(x.trim()))
        .map(x => x.trim().toUpperCase())
        .sort((a, b) => a.localeCompare(b))

      config.platforms[config.platforms.findIndex(x => x.platform === 'config')] = cleanUpUiConfig(pluginConfig)
    })
  }

  /**
   * Get the plugin hide update list
   */
  public async getPluginsHideUpdatesFor(): Promise<string[]> {
    // 1. Get the current config for the Homebridge Glass UI
    const config = await this.getConfigFile()
    const pluginConfig = config.platforms.find(x => x.platform === 'config')

    // 2. Return the hideUpdatesFor list or empty array if not set
    return pluginConfig?.plugins?.hideUpdatesFor || []
  }

  /**
   * Set the plugin hide update list (this request is not partial)
   */
  public async setPluginsHideUpdatesFor(value: string[]) {
    await this.mutateConfigFile((config) => {
      const pluginConfig = this.findOrCreateUiConfigBlock(config)

      if (!pluginConfig.plugins) {
        pluginConfig.plugins = {}
      }
      pluginConfig.plugins.hideUpdatesFor = (value || [])
        .filter(x => typeof x === 'string' && x.trim() !== '' && RE_PLUGIN_NAME.test(x.trim()))
        .map(x => x.trim().toLowerCase())

      config.platforms[config.platforms.findIndex(x => x.platform === 'config')] = cleanUpUiConfig(pluginConfig)
    })
  }

  /**
   * Get the plugin hide child-bridge-setup recommendation list
   */
  public async getPluginsHideChildBridgeSetupFor(): Promise<string[]> {
    const config = await this.getConfigFile()
    const pluginConfig = config.platforms.find(x => x.platform === 'config')
    return pluginConfig?.plugins?.hideChildBridgeSetupFor || []
  }

  /**
   * Set the plugin hide child-bridge-setup recommendation list (this request is not partial)
   */
  public async setPluginsHideChildBridgeSetupFor(value: string[]) {
    await this.mutateConfigFile((config) => {
      const pluginConfig = this.findOrCreateUiConfigBlock(config)

      if (!pluginConfig.plugins) {
        pluginConfig.plugins = {}
      }
      pluginConfig.plugins.hideChildBridgeSetupFor = (value || [])
        .filter(x => typeof x === 'string' && x.trim() !== '' && RE_PLUGIN_NAME.test(x.trim()))
        .map(x => x.trim().toLowerCase())

      config.platforms[config.platforms.findIndex(x => x.platform === 'config')] = cleanUpUiConfig(pluginConfig)
    })
  }

  /**
   * Get a specific bridge configuration by username
   * Returns an object with username and boolean flags (defaults to false if not set)
   */
  public async getBridge(username: string): Promise<HomebridgeUiBridgeConfig | null> {
    // Validate username format
    if (!username || !RE_USERNAME.test(username.trim())) {
      return null
    }

    const config = await this.getConfigFile()
    const pluginConfig = config.platforms.find(x => x.platform === 'config')
    const normalizedUsername = username.trim().toUpperCase()

    const bridge = pluginConfig?.bridges?.find((b: HomebridgeUiBridgeConfig) => b.username.toUpperCase() === normalizedUsername)

    // Always return an object with consistent structure
    return {
      username: normalizedUsername,
      hideHapAlert: bridge?.hideHapAlert || false,
      hideMatterAlert: bridge?.hideMatterAlert || false,
      scheduledRestartCron: bridge?.scheduledRestartCron || null,
      // Spread any other properties that might exist on the bridge
      ...(bridge
        ? Object.keys(bridge).reduce<Record<string, any>>((acc, key) => {
            if (key !== 'username' && key !== 'hideHapAlert' && key !== 'hideMatterAlert' && key !== 'scheduledRestartCron') {
              acc[key] = bridge[key]
            }
            return acc
          }, {})
        : {}),
    }
  }

  /**
   * Update a specific bridge property
   */
  private async updateBridgeProperty(username: string, property: string, value: any): Promise<void> {
    // Validate username format
    if (!username || !RE_USERNAME.test(username.trim())) {
      throw new NotFoundException('Invalid bridge username format')
    }

    const normalizedUsername = username.trim().toUpperCase()

    await this.mutateConfigFile((config) => {
      const pluginConfig = this.findOrCreateUiConfigBlock(config)

      // Initialize bridges array if it doesn't exist
      if (!pluginConfig.bridges) {
        pluginConfig.bridges = []
      }

      let bridge = pluginConfig.bridges.find((b: HomebridgeUiBridgeConfig) => b.username.toUpperCase() === normalizedUsername)

      // Check if value is "truthy" - for booleans this is true, for strings this is non-empty, for null/undefined this is false
      const shouldSet = value !== null && value !== undefined && value !== false && value !== '' && value !== 'never'

      if (shouldSet) {
        // Set property to the value
        if (!bridge) {
          bridge = { username: normalizedUsername }
          pluginConfig.bridges.push(bridge)
        }
        bridge[property] = value
      } else {
        // Remove the property
        if (bridge) {
          delete bridge[property]

          // Remove bridge if it has no properties other than username
          const hasOtherProps = Object.keys(bridge).some(key => key !== 'username')
          if (!hasOtherProps) {
            pluginConfig.bridges = pluginConfig.bridges.filter((b: HomebridgeUiBridgeConfig) => b.username.toUpperCase() !== normalizedUsername)
          }
        }
      }

      config.platforms[config.platforms.findIndex(x => x.platform === 'config')] = cleanUpUiConfig(pluginConfig)
    })
  }

  /**
   * Set hideHapAlert for a specific bridge
   */
  public async setBridgeHideHapAlert(username: string, value: boolean): Promise<void> {
    await this.updateBridgeProperty(username, 'hideHapAlert', value)
  }

  /**
   * Set hideMatterAlert for a specific bridge
   */
  public async setBridgeHideMatterAlert(username: string, value: boolean): Promise<void> {
    await this.updateBridgeProperty(username, 'hideMatterAlert', value)
  }

  /**
   * Set scheduledRestartCron for a specific bridge
   */
  public async setBridgeScheduledRestartCron(username: string, value: string | null): Promise<void> {
    await this.updateBridgeProperty(username, 'scheduledRestartCron', value)
  }

  /**
   * Mark a plugin as disabled
   */
  public async disablePlugin(pluginName: string) {
    if (pluginName === this.configService.name) {
      throw new BadRequestException('Disabling this plugin is now allowed.')
    }

    return this.mutateConfigFile((config) => {
      if (!Array.isArray(config.disabledPlugins)) {
        config.disabledPlugins = []
      }

      config.disabledPlugins.push(pluginName)
      return config.disabledPlugins
    })
  }

  /**
   * Mark a plugin as enabled
   */
  public async enablePlugin(pluginName: string) {
    // The mutator always runs and returns the (possibly untouched) list; the
    // write is a no-op change when the plugin was not in the list, which is
    // the price of doing the check against a fresh read inside the lock.
    return this.mutateConfigFile((config) => {
      if (!Array.isArray(config.disabledPlugins)) {
        config.disabledPlugins = []
      }

      const idx = config.disabledPlugins.findIndex(x => x === pluginName)
      if (idx > -1) {
        config.disabledPlugins.splice(idx, 1)
      }

      return config.disabledPlugins
    })
  }

  /**
   * Compute the restart-info wrapper used by the mutation endpoints when
   * the caller passes `?include=restart-info`. Pulls running child bridges
   * via IPC and, for plugin-scoped mutations, filters to that plugin so
   * the frontend can skip the follow-up `/status/homebridge/child-bridges`
   * call it used to issue after every save.
   */
  private async buildRestartInfo<T>(payload: T, pluginName: string | null): Promise<ConfigEditorRestartInfo<T>> {
    // The config has already been persisted by the caller. Treat the IPC
    // fetch as best-effort: if Homebridge is mid-restart or the IPC
    // channel is missing (requestResponse times out after 3 s), surface
    // an empty `affectedBridges` instead of rejecting the wrapped
    // endpoint — otherwise a successful save returns 500 to the UI even
    // though config.json on disk reflects the new state.
    let affectedBridges: Awaited<ReturnType<ChildBridgesService['getChildBridges']>> = []
    try {
      const allBridges = await this.childBridgesService.getChildBridges()
      affectedBridges = pluginName === null
        ? allBridges
        : allBridges.filter(bridge => bridge.plugin === pluginName)
    } catch (e) {
      this.logger.warn(`Could not fetch child bridges for restart-info wrapper as ${e.message}.`)
    }
    return {
      config: payload,
      affectedBridges,
    }
  }

  /**
   * `updateConfigFile` + restart-info wrapper. Used by the controller when
   * the caller opts in via `?include=restart-info`.
   */
  public async updateConfigFileWithRestartInfo(config: HomebridgeConfig): Promise<ConfigEditorRestartInfo<HomebridgeConfig>> {
    const saved = await this.updateConfigFile(config)
    return this.buildRestartInfo(saved, null)
  }

  public async updateConfigForPluginWithRestartInfo(pluginName: string, pluginConfig: Record<string, any>[]): Promise<ConfigEditorRestartInfo<Record<string, any>[]>> {
    const saved = await this.updateConfigForPlugin(pluginName, pluginConfig)
    return this.buildRestartInfo(saved, pluginName)
  }

  public async disablePluginWithRestartInfo(pluginName: string): Promise<ConfigEditorRestartInfo<string[]>> {
    // Disable first, then capture the snapshot — mirrors the enable path
    // and avoids the case where an IPC failure (e.g. Homebridge
    // restarting) before mutation blocks the user-requested disable from
    // ever running. buildRestartInfo treats the IPC fetch as best-effort
    // so the disable still completes if IPC is unavailable.
    const disabledPlugins = await this.disablePlugin(pluginName)
    return this.buildRestartInfo(disabledPlugins, pluginName)
  }

  public async enablePluginWithRestartInfo(pluginName: string): Promise<ConfigEditorRestartInfo<string[]>> {
    const disabledPlugins = await this.enablePlugin(pluginName)
    return this.buildRestartInfo(disabledPlugins, pluginName)
  }

  /**
   * Generates a new random pin
   */
  public generatePin() {
    return generatePin()
  }

  /**
   * Generates a new random username
   */
  public generateUsername() {
    return generateUsername()
  }
}
