import type { AccessoryConfig, HomebridgeConfig, PlatformConfig } from '../../core/config/config.interfaces.js'
import type { BridgeOwnerBlock, DevicePairing, ExternalAccessoryAttribution, HapAccessoryInfo } from './server.utils.js'

import { readdir, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { Categories } from '@homebridge/hap-client/hap-types'
import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { pathExists, readJson, remove } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import {
  RE_ACCESSORY_INFO_FILE,
  RE_DEVICE_ID,
  RE_EXTERNAL_ACCESSORIES_EXACT,
  RE_HEX_12,
} from '../../core/regex.constants.js'
import { ConfigEditorService } from '../config-editor/config-editor.service.js'
import { generateSetupCode, hexToMac, macToHex } from './server.utils.js'

/**
 * Device pairings (HAP bridges, external accessories and Matter-only externals)
 * and per-bridge cached accessory removal.
 */
@Injectable()
export class ServerPairingsService {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(ConfigEditorService) private readonly configEditorService: ConfigEditorService,
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Delete the cached accessory files for a single bridge.
   * @param id
   * @param cachedAccessoriesDir
   * @param protocol - Which protocol to clean: 'hap', 'matter', or 'both'
   * @private
   */
  private async deleteSingleDeviceAccessories(id: string, cachedAccessoriesDir: string, protocol: 'hap' | 'matter' | 'both' = 'both') {
    // Clean HAP accessories
    if (protocol === 'hap' || protocol === 'both') {
      const cachedAccessories = resolve(cachedAccessoriesDir, `cachedAccessories.${id}`)
      const cachedAccessoriesBackup = resolve(cachedAccessoriesDir, `.cachedAccessories.${id}.bak`)

      if (cachedAccessories.startsWith(cachedAccessoriesDir) && await pathExists(cachedAccessories)) {
        await unlink(cachedAccessories)
        this.logger.warn(`Bridge ${id} HAP accessory removal: removed ${cachedAccessories}.`)
      }

      if (cachedAccessoriesBackup.startsWith(cachedAccessoriesDir) && await pathExists(cachedAccessoriesBackup)) {
        await unlink(cachedAccessoriesBackup)
        this.logger.warn(`Bridge ${id} HAP accessory removal: removed ${cachedAccessoriesBackup}.`)
      }
    }

    // Clean Matter cached accessories only (preserve commissioning state)
    if (protocol === 'matter' || protocol === 'both') {
      const matterDeviceId = macToHex(id)
      const matterDir = resolve(this.configService.storagePath, 'matter')
      const matterAccessoriesPath = resolve(matterDir, matterDeviceId, 'accessories.json')

      if (matterAccessoriesPath.startsWith(matterDir) && await pathExists(matterAccessoriesPath)) {
        await unlink(matterAccessoriesPath)
        this.logger.warn(`Bridge ${id} Matter accessory removal: removed ${matterAccessoriesPath}.`)
      }
    }
  }

  /**
   * Delete the pairing information for a single bridge.
   * @param id
   * @param resetPairingInfo
   * @private
   */
  private async deleteSingleDevicePairing(id: string, resetPairingInfo: boolean) {
    const persistPath = resolve(this.configService.storagePath, 'persist')
    const accessoryInfo = resolve(persistPath, `AccessoryInfo.${id}.json`)
    const identifierCache = resolve(persistPath, `IdentifierCache.${id}.json`)

    // Handle both formats: with colons (0E:3C:22:18:EC:79) and without (0E3C2218EC79)
    const deviceId = id.includes(':') ? macToHex(id) : id.toUpperCase()
    const matterDir = resolve(this.configService.storagePath, 'matter')
    const matterPath = resolve(matterDir, deviceId)

    try {
      // Format username with colons if not already present
      const configFile = await this.configEditorService.getConfigFile()
      const username = id.includes(':') ? id.toUpperCase() : hexToMac(id)

      // Check if the original username is in the access list, if so, update it to the new username
      const uiConfig = configFile.platforms.find(x => x.platform === 'config')
      let blacklistChanged = false
      let bridgesChanged = false
      if (uiConfig.accessoryControl?.instanceBlacklist?.includes(username)) {
        // Remove the old username from the blacklist
        blacklistChanged = true
        uiConfig.accessoryControl.instanceBlacklist = uiConfig.accessoryControl.instanceBlacklist
          .filter((x: string) => x.toUpperCase() !== username)
      }

      // Check if the original username is in the config.bridges list (as a username property with colons)
      let oldBridgeConfig: { username: string, hideHapAlert?: boolean, scheduledRestartCron?: string } | undefined
      if (uiConfig.bridges && Array.isArray(uiConfig.bridges)) {
        const bridgeIndex = uiConfig.bridges.findIndex(x => x.username?.toUpperCase() === username)
        if (bridgeIndex > -1) {
          bridgesChanged = true
          oldBridgeConfig = uiConfig.bridges[bridgeIndex]
          uiConfig.bridges.splice(bridgeIndex, 1)
        }
      }

      // Only available for child bridges
      if (resetPairingInfo) {
        // An error thrown here should not interrupt the process, this is a convenience feature
        const pluginBlocks = ([
          ...(configFile.accessories || []),
          ...(configFile.platforms || []),
          { _bridge: configFile.bridge },
        ] as BridgeOwnerBlock[])
          .filter(block => block._bridge?.username?.toUpperCase() === username.toUpperCase())

        const pluginBlock = pluginBlocks.find(block => block._bridge?.port)
        const otherBlocks = pluginBlocks.filter(block => !block._bridge?.port)

        if (pluginBlock) {
          // Generate new random username and pin, and save the config file
          pluginBlock._bridge.username = this.configEditorService.generateUsername()
          pluginBlock._bridge.pin = this.configEditorService.generatePin()

          // Multiple blocks may share the same username, for accessory blocks that are part of the same bridge
          otherBlocks.forEach((block) => {
            block._bridge.username = pluginBlock._bridge.username
          })

          // Add the new username to the blacklist if it was previously there
          if (blacklistChanged) {
            uiConfig.accessoryControl.instanceBlacklist = [...uiConfig.accessoryControl.instanceBlacklist, pluginBlock._bridge.username]
          }

          // Add an entry to the bridges list mirroring the new username and original object
          if (bridgesChanged) {
            uiConfig.bridges.push({
              ...oldBridgeConfig,
              username: pluginBlock._bridge.username,
            })
          }

          this.logger.warn(`Bridge ${id} reset: new username: ${pluginBlock._bridge.username} and new pin: ${pluginBlock._bridge.pin}.`)
        } else {
          this.logger.error(`Failed to reset username and pin for child bridge ${id} as the plugin block could not be found.`)
        }
      }

      if (blacklistChanged) {
        uiConfig.accessoryControl.instanceBlacklist = uiConfig.accessoryControl.instanceBlacklist
          .sort((a: string, b: string) => a.localeCompare(b))
      }

      await this.configEditorService.updateConfigFile(configFile)
    } catch (e) {
      this.logger.error(`Failed to reset username and pin for child bridge ${id} as ${e.message}.`)
    }

    if (accessoryInfo.startsWith(persistPath) && await pathExists(accessoryInfo)) {
      await unlink(accessoryInfo)
      this.logger.warn(`Bridge ${id} reset: removed ${accessoryInfo}.`)
    }

    if (identifierCache.startsWith(persistPath) && await pathExists(identifierCache)) {
      await unlink(identifierCache)
      this.logger.warn(`Bridge ${id} reset: removed ${identifierCache}.`)
    }

    if (matterPath.startsWith(matterDir) && await pathExists(matterPath)) {
      await remove(matterPath)
      this.logger.warn(`Bridge ${id} reset: removed Matter bridge storage at ${matterPath}.`)
    }

    await this.deleteDeviceAccessories(id)
  }

  /**
   * Return a list of the device pairings in the homebridge persist folder
   */
  public async getDevicePairings() {
    const persistPath = join(this.configService.storagePath, 'persist')

    const devices = (await readdir(persistPath))
      .filter(x => x.match(RE_ACCESSORY_INFO_FILE))

    const configFile = await this.configEditorService.getConfigFile()
    const externalAttribution = await this.getExternalAccessoryAttribution()

    // Get HAP devices
    const hapDevices = await Promise.all(devices.map(async (x) => {
      return await this.getDevicePairingById(x.split('.')[1], configFile, externalAttribution)
    }))

    // Get Matter external published accessories
    const matterExternalDevices = await this.getMatterExternalAccessories(hapDevices)

    // Combine and sort by name
    return [...hapDevices, ...matterExternalDevices].sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Read the externalAccessories index files written by the homebridge runtime so we can
   * attribute each external HAP accessory to the plugin that published it (HAP-NodeJS
   * AccessoryInfo files do not store plugin attribution). Older homebridge versions don't
   * write these files, in which case this returns an empty map.
   * @returns Map keyed by uppercase MAC username
   * @private
   */
  private async getExternalAccessoryAttribution(): Promise<Map<string, ExternalAccessoryAttribution>> {
    const attribution = new Map<string, ExternalAccessoryAttribution>()
    const cachedAccessoriesDir = join(this.configService.storagePath, 'accessories')

    if (!await pathExists(cachedAccessoriesDir)) {
      return attribution
    }

    const externalFiles = (await readdir(cachedAccessoriesDir))
      .filter(x => x.match(RE_EXTERNAL_ACCESSORIES_EXACT) || x === 'externalAccessories')

    for (const file of externalFiles) {
      try {
        const entries = await readJson(join(cachedAccessoriesDir, file))
        if (!Array.isArray(entries)) {
          continue
        }
        for (const entry of entries) {
          if (typeof entry?.username === 'string' && typeof entry?.plugin === 'string') {
            attribution.set(entry.username.toUpperCase(), {
              plugin: entry.plugin,
              displayName: entry.displayName,
              category: entry.category,
              port: entry.port,
            })
          }
        }
      } catch (e) {
        this.logger.warn(`Failed to read external accessory attribution file ${file}: ${e.message}`)
      }
    }

    return attribution
  }

  /**
   * Get Matter external published accessories
   * These are Matter-only accessories that don't have HAP AccessoryInfo files
   * @param hapDevices - List of HAP devices to check against
   * @returns Array of Matter external accessory devices
   * @private
   */
  private async getMatterExternalAccessories(hapDevices: { _id: string }[]): Promise<DevicePairing[]> {
    const matterPath = join(this.configService.storagePath, 'matter')

    // Check if matter directory exists
    if (!await pathExists(matterPath)) {
      return []
    }

    const matterDirs = (await readdir(matterPath))
      .filter(x => x.match(RE_HEX_12)) // Match 12 hex character device IDs

    const matterExternalDevices: DevicePairing[] = []

    for (const deviceId of matterDirs) {
      try {
        // Check if this is a HAP device (has AccessoryInfo file)
        const hasHapAccessoryInfo = hapDevices.some(d => d._id === deviceId)
        if (hasHapAccessoryInfo) {
          // This is a HAP device with Matter enabled, not a Matter-only external accessory
          continue
        }

        // Check if this is the main bridge
        const mainBridgeId = macToHex(this.configService.homebridgeConfig.bridge.username)
        if (deviceId.toUpperCase() === mainBridgeId) {
          // This is the main bridge, skip it
          continue
        }

        // Read the accessories.json file
        const accessoriesPath = join(matterPath, deviceId, 'accessories.json')
        if (!await pathExists(accessoriesPath)) {
          // No accessories.json, might be a child bridge Matter storage, skip
          continue
        }

        const accessories = await readJson(accessoriesPath)
        if (!Array.isArray(accessories) || accessories.length === 0) {
          continue
        }

        // For Matter external accessories, we create one device entry per accessory
        // But since they're published as external, each has its own Matter server
        // We'll just use the first accessory's info for the device name
        const accessory = accessories[0]

        // Read commissioning info if available
        const commissioningPath = join(matterPath, deviceId, 'commissioning.json')
        let commissioned = false
        let qrCode: string | undefined
        let manualPairingCode: string | undefined
        if (await pathExists(commissioningPath)) {
          try {
            const commissioningInfo = await readJson(commissioningPath)
            commissioned = commissioningInfo.commissioned || false
            qrCode = typeof commissioningInfo.qrCode === 'string' ? commissioningInfo.qrCode : undefined
            manualPairingCode = typeof commissioningInfo.manualPairingCode === 'string' ? commissioningInfo.manualPairingCode : undefined
          } catch (parseError) {
            this.logger.warn(`Malformed commissioning.json at ${commissioningPath}, removing corrupted file`)
            try {
              await remove(commissioningPath)
            } catch (removeError) {
              this.logger.warn(`Failed to remove corrupted commissioning.json: ${removeError.message}`)
            }
          }
        }

        // Create a device object similar to HAP devices
        const device: DevicePairing = {
          _id: deviceId,
          _username: hexToMac(deviceId), // Format as MAC address
          _main: false,
          _category: 'other', // Matter external accessories don't have HAP categories
          _matter: true,
          _matterOnly: true, // Flag to indicate this is Matter-only
          _isExternal: true,
          _isPaired: commissioned,
          _plugin: accessory.plugin, // Plugin identifier for filtering
          _setupCode: qrCode, // Matter QR-code payload string (encodes the commissioning info)
          pincode: manualPairingCode, // Human-readable manual pairing code
          name: accessory.displayName || 'Matter External Accessory',
          displayName: accessory.displayName || 'Matter External Accessory',
          manufacturer: accessory.manufacturer || 'Unknown',
          model: accessory.model || 'Unknown',
          serialNumber: accessory.serialNumber || deviceId,
          category: 1, // Fallback category
        }

        matterExternalDevices.push(device)
      } catch (e) {
        this.logger.error(`Failed to read Matter external accessory ${deviceId}: ${e.message}`)
      }
    }

    return matterExternalDevices
  }

  /**
   * Return a single device pairing
   * @param deviceId
   * @param configFile
   * @param externalAttribution - optional pre-computed map of external accessory plugin
   * attribution (use when calling in a loop to avoid re-reading the same files)
   */
  public async getDevicePairingById(
    deviceId: string,
    configFile: HomebridgeConfig | null = null,
    externalAttribution: Map<string, ExternalAccessoryAttribution> | null = null,
  ): Promise<DevicePairing> {
    const persistPath = join(this.configService.storagePath, 'persist')

    let device: HapAccessoryInfo
    try {
      device = await readJson(join(persistPath, `AccessoryInfo.${deviceId}.json`))
    } catch (e) {
      throw new NotFoundException()
    }

    if (!configFile) {
      configFile = await this.configEditorService.getConfigFile()
    }

    if (!externalAttribution) {
      externalAttribution = await this.getExternalAccessoryAttribution()
    }

    const username = hexToMac(deviceId)
    const isMain = this.configService.homebridgeConfig.bridge.username.toUpperCase() === username.toUpperCase()
    const pluginBlock = ([...configFile.accessories, ...configFile.platforms, { _bridge: configFile.bridge }] as BridgeOwnerBlock[])
      .find(block => block._bridge?.username?.toUpperCase() === username.toUpperCase())

    try {
      device._category = Object.entries(Categories).find(([, value]) => value === device.category)[0].toLowerCase()
    } catch (e) {
      device._category = 'Other'
    }

    device.name = pluginBlock?._bridge.name || pluginBlock?.name || device.displayName
    device._id = deviceId
    device._username = username
    device._main = isMain
    device._isPaired = device.pairedClients && Object.keys(device.pairedClients).length > 0
    device._setupCode = generateSetupCode(device)
    device._couldBeStale = !device._main && device._category === 'bridge' && !pluginBlock
    device._matter = !!(pluginBlock?._bridge?.matter)

    const externalMeta = externalAttribution.get(username.toUpperCase())
    if (externalMeta && !isMain) {
      device._plugin = externalMeta.plugin
      device._isExternal = true
      if (typeof externalMeta.port === 'number') {
        device._port = externalMeta.port
      }
      // An attributed external is by definition not a stale orphan
      device._couldBeStale = false
    }

    // Validate that Matter should not be on accessory-based plugins
    if (device._matter && pluginBlock && 'accessory' in pluginBlock) {
      this.logger.warn(`Device ${deviceId} has Matter configuration on an accessory-based plugin. Matter is only supported for platform-based plugins.`)
    }

    // Filter out some properties
    delete device.signSk
    delete device.signPk
    delete device.configHash
    delete device.pairedClients
    delete device.pairedClientsPermission

    return device
  }

  /**
   * Remove a device pairing
   */
  public async deleteDevicePairing(id: string, resetPairingInfo: boolean) {
    if (!RE_DEVICE_ID.test(id)) {
      throw new BadRequestException('Invalid device ID.')
    }

    this.logger.warn(`Shutting down Homebridge before resetting paired bridge ${id}...`)

    // Wait for homebridge to stop
    await this.homebridgeIpcService.restartAndWaitForClose()

    // Remove the bridge cache files
    await this.deleteSingleDevicePairing(id, resetPairingInfo)

    return { ok: true }
  }

  /**
   * Remove Matter configuration from a child bridge
   * Removes the matter config from config.json and deletes the Matter storage directory
   * @param id - The bridge device ID (can be with or without colons)
   * @returns Success status object
   * @throws InternalServerErrorException if removal fails
   */
  public async deleteDeviceMatterConfig(id: string): Promise<{ ok: boolean }> {
    if (!RE_DEVICE_ID.test(id)) {
      throw new BadRequestException('Invalid device ID.')
    }

    // 1. Shutdown first to prevent Homebridge from reacting to partial config
    this.logger.warn(`Shutting down Homebridge before removing Matter config for bridge ${id}...`)
    await this.homebridgeIpcService.restartAndWaitForClose()

    // 2. Update config
    try {
      const configFile = await this.configEditorService.getConfigFile()
      // Format username with colons if not already present
      const username = id.includes(':') ? id.toUpperCase() : hexToMac(id)

      // Find the child bridge plugin block
      const pluginBlocks = ([
        ...(configFile.accessories || []),
        ...(configFile.platforms || []),
      ] as (AccessoryConfig | PlatformConfig)[])
        .filter(block => block._bridge?.username?.toUpperCase() === username.toUpperCase())

      const pluginBlock = pluginBlocks.find(block => block._bridge?.matter)

      if (!pluginBlock) {
        this.logger.warn(`Matter configuration already removed from config.json for child bridge ${id}, skipping config update.`)
      } else {
        // Validate that Matter should not be on accessory-based plugins
        if ('accessory' in pluginBlock) {
          this.logger.warn(`Removing Matter configuration from accessory-based plugin block for bridge ${id}. Matter is only supported for platform-based plugins.`)
        }

        // Remove the matter configuration from the bridge
        delete pluginBlock._bridge.matter
        this.logger.warn(`Bridge ${id} Matter configuration removed from config.json.`)

        // Save the config file
        await this.configEditorService.updateConfigFile(configFile)
      }
    } catch (e) {
      this.logger.error(`Failed to remove Matter configuration for child bridge ${id} as ${e.message}.`)
      throw new InternalServerErrorException(`Failed to remove Matter configuration: ${e.message}`)
    }

    // 3. Delete storage
    const deviceId = id.includes(':') ? macToHex(id) : id.toUpperCase()
    const matterPath = join(this.configService.storagePath, 'matter', deviceId)

    if (await pathExists(matterPath)) {
      await remove(matterPath)
      this.logger.warn(`Bridge ${id} Matter storage removed at ${matterPath}.`)
    }

    return { ok: true }
  }

  /**
   * Remove multiple device pairings
   */
  public async deleteDevicesPairing(bridges: { id: string, resetPairingInfo: boolean }[]) {
    if (bridges.some(x => !RE_DEVICE_ID.test(x.id))) {
      throw new BadRequestException('Invalid device ID.')
    }

    this.logger.warn(`Shutting down Homebridge before resetting paired bridges ${bridges.map(x => x.id).join(', ')}...`)

    // Wait for homebridge to stop
    await this.homebridgeIpcService.restartAndWaitForClose()

    for (const { id, resetPairingInfo } of bridges) {
      try {
        // Remove the bridge cache files
        await this.deleteSingleDevicePairing(id, resetPairingInfo)
      } catch (e) {
        this.logger.error(`Failed to reset paired bridge ${id} as ${e.message}.`)
      }
    }

    return { ok: true }
  }

  /**
   * Remove a device's accessories
   */
  public async deleteDeviceAccessories(id: string) {
    if (!RE_DEVICE_ID.test(id)) {
      throw new BadRequestException('Invalid device ID.')
    }

    this.logger.warn(`Shutting down Homebridge before removing accessories for paired bridge ${id}...`)

    // Wait for homebridge to stop.
    await this.homebridgeIpcService.restartAndWaitForClose()

    const cachedAccessoriesDir = join(this.configService.storagePath, 'accessories')

    await this.deleteSingleDeviceAccessories(id, cachedAccessoriesDir)
  }

  /**
   * Remove multiple devices' accessories
   * @param bridges - Array of bridge objects with id and optional protocol ('hap', 'matter', or 'both')
   */
  public async deleteDevicesAccessories(bridges: { id: string, protocol?: 'hap' | 'matter' | 'both' }[]): Promise<void> {
    if (bridges.some(x => !RE_DEVICE_ID.test(x.id))) {
      throw new BadRequestException('Invalid device ID.')
    }

    this.logger.warn(`Shutting down Homebridge before removing accessories for paired bridges ${bridges.map(x => x.id).join(', ')}...`)

    // Wait for homebridge to stop.
    await this.homebridgeIpcService.restartAndWaitForClose()

    const cachedAccessoriesDir = join(this.configService.storagePath, 'accessories')

    for (const { id, protocol } of bridges) {
      try {
        await this.deleteSingleDeviceAccessories(id, cachedAccessoriesDir, protocol || 'both')
      } catch (e) {
        this.logger.error(`Failed to remove accessories for bridge ${id} as ${e.message}.`)
      }
    }
  }
}
