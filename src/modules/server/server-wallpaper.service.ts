import type { MultipartFile } from '@fastify/multipart'

import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'

import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { pathExists } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'
import { resolveWallpaperPath, WALLPAPER_EXTENSIONS, wallpaperExtension } from '../../core/config/wallpaper.js'
import { Logger } from '../../core/logger/logger.service.js'
import { ConfigEditorService } from '../config-editor/config-editor.service.js'

const pump = promisify(pipeline)

/**
 * The UI wallpaper image.
 */
@Injectable()
export class ServerWallpaperService {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(ConfigEditorService) private readonly configEditorService: ConfigEditorService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Upload and set a new wallpaper. Will delete an old wallpaper if it exists.
   * File upload handler
   */
  public async uploadWallpaper(data: MultipartFile) {
    // Only image types, saved under the one name `ui.wallpaper` may hold
    const fileExtension = wallpaperExtension(data.filename)
    if (!fileExtension) {
      data.file.resume()
      throw new BadRequestException(`The wallpaper must be an image file (${WALLPAPER_EXTENSIONS.join(', ')}).`)
    }

    // Get the config file and find the UI config block
    const configFile = await this.configEditorService.getConfigFile()
    const uiConfigBlock = configFile.platforms.find(x => x.platform === 'config')

    if (uiConfigBlock) {
      // Delete the old wallpaper if it exists - only ever a file the upload
      // wrote, never whatever else `ui.wallpaper` was edited to name
      const oldPath = resolveWallpaperPath(this.configService.storagePath, uiConfigBlock.wallpaper)
      if (oldPath) {
        if (await pathExists(oldPath)) {
          try {
            await unlink(oldPath)
            this.logger.log(`Old wallpaper file ${oldPath} deleted successfully.`)
          } catch (e) {
            this.logger.error(`Failed to delete old wallpaper ${oldPath} as ${e.message}.`)
          }
        }
      }

      // Save the uploaded image file to the storage path
      const newPath = join(this.configService.storagePath, `ui-wallpaper${fileExtension}`)
      await pump(data.file, createWriteStream(newPath))

      // Update the config file with the new wallpaper path
      uiConfigBlock.wallpaper = `ui-wallpaper${fileExtension}`
      await this.configEditorService.updateConfigFile(configFile)
      this.logger.log('Wallpaper uploaded and set in the config file.')
    }
  }

  /**
   * Delete the current wallpaper if it exists.
   */
  public async deleteWallpaper(): Promise<void> {
    // Get the config file and find the UI config block
    const configFile = await this.configEditorService.getConfigFile()
    const uiConfigBlock = configFile.platforms.find(x => x.platform === 'config')

    // Delete the wallpaper file if it exists
    if (uiConfigBlock && uiConfigBlock.wallpaper) {
      // Only a file the upload wrote is deleted; any other value is just
      // removed from the config
      const fullPath = resolveWallpaperPath(this.configService.storagePath, uiConfigBlock.wallpaper)
      if (fullPath && await pathExists(fullPath)) {
        try {
          await unlink(fullPath)
          this.logger.log(`Wallpaper file ${uiConfigBlock.wallpaper} deleted successfully.`)
        } catch (e) {
          this.logger.error(`Failed to delete wallpaper file (${uiConfigBlock.wallpaper}) as ${e.message}.`)
        }
      }

      // Remove the wallpaper path from the config file
      delete uiConfigBlock.wallpaper
      await this.configEditorService.updateConfigFile(configFile)
      this.configService.removeWallpaperCache()
      this.logger.log('Wallpaper reference removed from the config file.')
    }
  }
}
