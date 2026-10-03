import type { StoredMatterAccessory } from '../../core/matter/matter.interfaces.js'

import { readdir, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common'
import { pathExists, readJson } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import {
  RE_CACHED_ACCESSORIES,
  RE_CACHED_ACCESSORIES_EXACT,
  RE_HEX_12,
  RE_HEX_ANY,
} from '../../core/regex.constants.js'
import { ServerPairingsService } from './server-pairings.service.js'

/** A HAP accessory as stored in a `cachedAccessories[.<id>]` file. */
export interface CachedAccessory {
  UUID: string
  $cacheFile?: string
  [key: string]: unknown
}

/**
 * Cached HAP and Matter accessories.
 */
@Injectable()
export class ServerCachedAccessoriesService {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
    @Inject(JsonFileStoreService) private readonly jsonStore: JsonFileStoreService,
    @Inject(ServerPairingsService) private readonly serverPairingsService: ServerPairingsService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Aggregated snapshot used by accessory-management modals — bundles
   * cached HAP accessories, cached Matter accessories, and HAP pairings
   * into a single response so modal opens are a single round-trip.
   */
  public async getAccessoryOverview() {
    const [hapAccessories, matterAccessories, pairings] = await Promise.all([
      this.getCachedAccessories(),
      this.getMatterAccessories(),
      this.serverPairingsService.getDevicePairings(),
    ])
    return { hapAccessories, matterAccessories, pairings }
  }

  /**
   * Returns all cached accessories
   */
  public async getCachedAccessories() {
    const cachedAccessoriesDir = join(this.configService.storagePath, 'accessories')

    // Homebridge creates the folder on its first run; until then nothing is cached
    if (!await pathExists(cachedAccessoriesDir)) {
      return []
    }

    const cachedAccessoryFiles = (await readdir(cachedAccessoriesDir))
      .filter(x => x.match(RE_CACHED_ACCESSORIES_EXACT) || x === 'cachedAccessories')

    const cachedAccessories: CachedAccessory[] = []

    await Promise.all(cachedAccessoryFiles.map(async (x) => {
      const accessories = await readJson(join(cachedAccessoriesDir, x))
      for (const accessory of accessories) {
        accessory.$cacheFile = x
        cachedAccessories.push(accessory)
      }
    }))

    return cachedAccessories
  }

  /**
   * Remove a single cached accessory
   */
  public async deleteCachedAccessory(uuid: string, cacheFile: string) {
    cacheFile = basename(cacheFile || 'cachedAccessories')

    if (cacheFile !== 'cachedAccessories' && !RE_CACHED_ACCESSORIES_EXACT.test(cacheFile)) {
      throw new BadRequestException('Invalid cache file name.')
    }

    const cachedAccessoriesPath = resolve(this.configService.storagePath, 'accessories', cacheFile)

    this.logger.warn(`Shutting down Homebridge before removing cached accessory ${uuid}...`)

    // Wait for homebridge to stop.
    await this.homebridgeIpcService.restartAndWaitForClose()

    let found = false
    await this.jsonStore.mutate<CachedAccessory[]>(cachedAccessoriesPath, (current) => {
      if (current === null) {
        // A missing cache file is treated as not-found (matching
        // readJson()'s ENOENT exit path), not auto-created — also
        // keeps the path-traversal-blocked-via-basename test happy.
        throw new NotFoundException()
      }
      const accessoryIndex = current.findIndex(x => x.UUID === uuid)
      if (accessoryIndex > -1) {
        current.splice(accessoryIndex, 1)
        found = true
        this.logger.warn(`Removed cached accessory with UUID ${uuid} from file ${cacheFile}.`)
      }
      return current
    })

    if (!found) {
      this.logger.error(`Cannot find cached accessory with UUID ${uuid} from file ${cacheFile}.`)
      throw new NotFoundException()
    }

    return { ok: true }
  }

  /**
   * Remove multiple cached accessories
   */
  public async deleteCachedAccessories(accessories?: { uuid: string, cacheFile: string }[]) {
    if (!Array.isArray(accessories) || accessories.length === 0) {
      throw new BadRequestException('Send the accessories to remove as an array of { uuid, cacheFile }.')
    }

    this.logger.warn(`Shutting down Homebridge before removing cached accessories ${accessories.map(x => x.uuid).join(', ')}.`)

    // Wait for homebridge to stop.
    await this.homebridgeIpcService.restartAndWaitForClose()

    const accessoriesByCacheFile = new Map<string, { uuid: string }[]>()

    // Group accessories by cacheFile
    for (const { cacheFile, uuid } of accessories) {
      const accessoryCacheFile = basename(cacheFile || 'cachedAccessories')
      if (accessoryCacheFile !== 'cachedAccessories' && !RE_CACHED_ACCESSORIES_EXACT.test(accessoryCacheFile)) {
        throw new BadRequestException(`Invalid cache file name: ${accessoryCacheFile}.`)
      }
      if (!accessoriesByCacheFile.has(accessoryCacheFile)) {
        accessoriesByCacheFile.set(accessoryCacheFile, [])
      }
      accessoriesByCacheFile.get(accessoryCacheFile).push({ uuid })
    }

    // Process each group of accessories
    for (const [cacheFile, accessories] of accessoriesByCacheFile.entries()) {
      const cachedAccessoriesPath = resolve(this.configService.storagePath, 'accessories', cacheFile)
      await this.jsonStore.mutate<CachedAccessory[]>(cachedAccessoriesPath, (current) => {
        if (current === null) {
          // Don't auto-create a fresh cache file just because a caller
          // pointed at a path that doesn't exist (e.g. an attempted
          // path-traversal that basename() flattened to an unrelated
          // name). Skip this cacheFile and let other groups proceed.
          this.logger.error(`Cached accessories file not found: ${cacheFile}.`)
          throw new NotFoundException(`Cache file ${cacheFile} not found.`)
        }
        for (const { uuid } of accessories) {
          try {
            const accessoryIndex = current.findIndex(x => x.UUID === uuid)
            if (accessoryIndex > -1) {
              current.splice(accessoryIndex, 1)
              this.logger.warn(`Removed cached accessory with UUID ${uuid} from file ${cacheFile}.`)
            } else {
              this.logger.error(`Cannot find cached accessory with UUID ${uuid} from file ${cacheFile}.`)
            }
          } catch (e) {
            this.logger.error(`Failed to remove cached accessory with UUID ${uuid} from file ${cacheFile} as ${e.message}.`)
          }
        }
        return current
      })
    }

    return { ok: true }
  }

  /**
   * Clears the Homebridge Accessory Cache
   */
  public async deleteAllCachedAccessories() {
    const cachedAccessoriesDir = join(this.configService.storagePath, 'accessories')
    const cachedAccessoryPaths = await pathExists(cachedAccessoriesDir)
      ? (await readdir(cachedAccessoriesDir))
          .filter(x => x.match(RE_CACHED_ACCESSORIES) || x === 'cachedAccessories' || x === '.cachedAccessories.bak')
          .map(x => resolve(cachedAccessoriesDir, x))
      : []

    const cachedAccessoriesPath = resolve(this.configService.storagePath, 'accessories', 'cachedAccessories')

    // Wait for homebridge to stop.
    await this.homebridgeIpcService.restartAndWaitForClose()

    this.logger.warn('Shutting down Homebridge before removing cached accessories')

    try {
      // Remove HAP cached accessories
      this.logger.log('Clearing all HAP cached accessories...')
      for (const thisCachedAccessoriesPath of cachedAccessoryPaths) {
        if (await pathExists(thisCachedAccessoriesPath)) {
          await unlink(thisCachedAccessoriesPath)
          this.logger.warn(`Removed ${thisCachedAccessoriesPath}.`)
        }
      }

      // Remove Matter cached accessories only (preserve commissioning state)
      const matterDir = join(this.configService.storagePath, 'matter')
      if (await pathExists(matterDir)) {
        this.logger.log('Clearing all Matter cached accessories...')
        const matterBridges = (await readdir(matterDir)).filter(x => x.match(RE_HEX_12))
        for (const deviceId of matterBridges) {
          const accessoriesPath = join(matterDir, deviceId, 'accessories.json')
          if (await pathExists(accessoriesPath)) {
            await unlink(accessoriesPath)
            this.logger.warn(`Removed Matter cached accessories for bridge ${deviceId}.`)
          }
        }
      }
    } catch (e) {
      this.logger.error(`Failed to clear all cached accessories at ${cachedAccessoriesPath} as ${e.message}.`)
      console.error(e)
      throw new InternalServerErrorException('Failed to clear Homebridge accessory cache - see logs.')
    }

    return { ok: true }
  }

  /**
   * Returns all Matter accessories from all bridges
   * @returns Array of Matter accessories with metadata ($deviceId and $protocol)
   */
  public async getMatterAccessories(): Promise<StoredMatterAccessory[]> {
    const matterDir = join(this.configService.storagePath, 'matter')

    // Check if matter directory exists
    if (!await pathExists(matterDir)) {
      return []
    }

    const matterBridges = (await readdir(matterDir))
      .filter(x => x.match(RE_HEX_ANY)) // Match 12-char bridge device IDs

    const matterAccessories: StoredMatterAccessory[] = []

    await Promise.all(matterBridges.map(async (deviceId) => {
      try {
        const accessoriesPath = join(matterDir, deviceId, 'accessories.json')
        if (await pathExists(accessoriesPath)) {
          const accessories = await readJson(accessoriesPath)
          if (Array.isArray(accessories)) {
            for (const accessory of accessories) {
              // Add metadata to identify which bridge this accessory belongs to
              accessory.$deviceId = deviceId
              accessory.$protocol = 'matter'
              matterAccessories.push(accessory)
            }
          }
        }
      } catch (e) {
        this.logger.error(`Failed to read Matter accessories for bridge ${deviceId}: ${e.message}`)
      }
    }))

    return matterAccessories
  }

  /**
   * Remove a single Matter accessory
   * @param deviceId - The bridge device ID (12 hex characters)
   * @param uuid - The accessory UUID to remove
   * @returns Success status object
   */
  public async deleteMatterAccessory(deviceId: string, uuid: string): Promise<{ ok: boolean }> {
    // Matter device IDs are always 12 hex chars; reject anything else so a
    // request-supplied value can't traverse out of the matter storage dir.
    if (!RE_HEX_12.test(deviceId)) {
      throw new BadRequestException('Invalid device ID.')
    }

    const matterAccessoriesPath = join(this.configService.storagePath, 'matter', deviceId, 'accessories.json')

    if (!await pathExists(matterAccessoriesPath)) {
      this.logger.error(`Matter accessories file not found for bridge ${deviceId}`)
      throw new NotFoundException()
    }

    this.logger.warn(`Shutting down Homebridge before removing Matter accessory ${uuid} from bridge ${deviceId}...`)

    // Wait for homebridge to stop
    await this.homebridgeIpcService.restartAndWaitForClose()

    let found = false
    await this.jsonStore.mutate<StoredMatterAccessory[]>(matterAccessoriesPath, (current) => {
      const matterAccessories = current ?? []
      const accessoryIndex = matterAccessories.findIndex(x => x.uuid === uuid)
      if (accessoryIndex > -1) {
        matterAccessories.splice(accessoryIndex, 1)
        found = true
        this.logger.warn(`Removed Matter accessory with UUID ${uuid} from bridge ${deviceId}.`)
      }
      return matterAccessories
    }, { spaces: 2 })

    if (!found) {
      this.logger.error(`Cannot find Matter accessory with UUID ${uuid} in bridge ${deviceId}.`)
      throw new NotFoundException()
    }

    return { ok: true }
  }

  /**
   * Remove multiple Matter accessories
   * @param accessories - Array of objects containing deviceId and uuid to remove
   * @returns Success status object
   */
  public async deleteMatterAccessories(accessories: { deviceId: string, uuid: string }[]): Promise<{ ok: boolean }> {
    // Matter device IDs are always 12 hex chars; reject anything else (before
    // restarting Homebridge) so a request-supplied value can't traverse out of
    // the matter storage dir.
    if (accessories.some(({ deviceId }) => !RE_HEX_12.test(deviceId))) {
      throw new BadRequestException('Invalid device ID.')
    }

    this.logger.warn(`Shutting down Homebridge before removing Matter accessories ${accessories.map(x => x.uuid).join(', ')}.`)

    // Wait for homebridge to stop
    await this.homebridgeIpcService.restartAndWaitForClose()

    // Group accessories by deviceId
    const accessoriesByBridge = new Map<string, { uuid: string }[]>()

    for (const { deviceId, uuid } of accessories) {
      if (!accessoriesByBridge.has(deviceId)) {
        accessoriesByBridge.set(deviceId, [])
      }
      accessoriesByBridge.get(deviceId).push({ uuid })
    }

    // Process each bridge's accessories
    for (const [deviceId, bridgeAccessories] of accessoriesByBridge.entries()) {
      const matterAccessoriesPath = join(this.configService.storagePath, 'matter', deviceId, 'accessories.json')

      try {
        if (!await pathExists(matterAccessoriesPath)) {
          this.logger.error(`Matter accessories file not found for bridge ${deviceId}`)
          continue
        }

        await this.jsonStore.mutate<StoredMatterAccessory[]>(matterAccessoriesPath, (current) => {
          const matterAccessories = current ?? []
          for (const { uuid } of bridgeAccessories) {
            try {
              const accessoryIndex = matterAccessories.findIndex(x => x.uuid === uuid)
              if (accessoryIndex > -1) {
                matterAccessories.splice(accessoryIndex, 1)
                this.logger.warn(`Removed Matter accessory with UUID ${uuid} from bridge ${deviceId}.`)
              } else {
                this.logger.error(`Cannot find Matter accessory with UUID ${uuid} in bridge ${deviceId}.`)
              }
            } catch (e) {
              this.logger.error(`Failed to remove Matter accessory with UUID ${uuid} from bridge ${deviceId} as ${e.message}.`)
            }
          }
          return matterAccessories
        }, { spaces: 2 })
      } catch (e) {
        this.logger.error(`Failed to process Matter accessories for bridge ${deviceId} as ${e.message}.`)
      }
    }

    return { ok: true }
  }
}
