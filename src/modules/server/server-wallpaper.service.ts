import type { MultipartFile } from '@fastify/multipart'

import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { pipeline } from 'node:stream'
import { promisify } from 'node:util'

import { Inject, Injectable } from '@nestjs/common'
import { pathExists } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'
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
    // Get the config file and find the UI config block
    const configFile = await this.configEditorService.getConfigFile()
    const uiConfigBlock = configFile.platforms.find(x => x.platform === 'config')

    if (uiConfigBlock) {
      // Delete the old wallpaper if it exists
      if (uiConfigBlock.wallpaper) {
        const oldPath = join(this.configService.storagePath, uiConfigBlock.wallpaper)
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
      const fileExtension = extname(data.filename)
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
    const fullPath = join(this.configService.storagePath, uiConfigBlock.wallpaper)

    // Delete the wallpaper file if it exists
    if (uiConfigBlock && uiConfigBlock.wallpaper) {
      if (await pathExists(fullPath)) {
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
