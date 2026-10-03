import { constants, createReadStream } from 'node:fs'
import { access, truncate } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Transform } from 'node:stream'

import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { pathExists, readJson, writeJsonSync } from 'fs-extra/esm'

import { ConfigService } from '../../../core/config/config.service.js'
import { Logger } from '../../../core/logger/logger.service.js'
import { RE_ANSI_COLOUR } from '../../../core/regex.constants.js'
import { findUnsafeNodeOption, isProtectedStoragePath, LOG_PATH_RULE, NODE_OPTIONS_RULE } from '../../config-editor/config-safety.js'
import { HbServiceStartupSettings } from './hb-service.dto.js'

@Injectable()
export class HbServiceService {
  private readonly hbServiceSettingsPath: string

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
  ) {
    this.hbServiceSettingsPath = resolve(this.configService.storagePath, '.uix-hb-service-homebridge-startup.json')
  }

  /**
   * Returns the Homebridge startup settings
   */
  async getHomebridgeStartupSettings() {
    try {
      if (await pathExists(this.hbServiceSettingsPath)) {
        const settings = await readJson(this.hbServiceSettingsPath)

        return {
          HOMEBRIDGE_DEBUG: settings.debugMode,
          HOMEBRIDGE_KEEP_ORPHANS: settings.keepOrphans,
          HOMEBRIDGE_INSECURE: typeof settings.insecureMode === 'boolean' ? settings.insecureMode : this.configService.homebridgeInsecureMode,
          ENV_DEBUG: settings.env.DEBUG,
          ENV_NODE_OPTIONS: settings.env.NODE_OPTIONS,
        }
      } else {
        return {
          HOMEBRIDGE_INSECURE: this.configService.homebridgeInsecureMode,
        }
      }
    } catch (e) {
      return {}
    }
  }

  /**
   * Sets the Homebridge startup settings
   */
  async setHomebridgeStartupSettings(data: HbServiceStartupSettings) {
    // NODE_OPTIONS reaches the Homebridge process: refuse flags that load
    // code or open a debugger (hb-service drops them again at start-up)
    const unsafeNodeOption = findUnsafeNodeOption(data.ENV_NODE_OPTIONS)
    if (unsafeNodeOption) {
      this.logger.warn(`Refused to save the Homebridge startup settings: NODE_OPTIONS flag "${unsafeNodeOption}" is not allowed.`)
      throw new BadRequestException(`Refusing to save NODE_OPTIONS: "${unsafeNodeOption}" is not allowed. ${NODE_OPTIONS_RULE}`)
    }

    // Restart ui on next restart
    this.configService.hbServiceUiRestartRequired = true

    // Format the settings payload
    const settings = {
      debugMode: data.HOMEBRIDGE_DEBUG,
      keepOrphans: data.HOMEBRIDGE_KEEP_ORPHANS,
      insecureMode: data.HOMEBRIDGE_INSECURE,
      env: {
        DEBUG: data.ENV_DEBUG ? data.ENV_DEBUG : undefined,
        NODE_OPTIONS: data.ENV_NODE_OPTIONS ? data.ENV_NODE_OPTIONS : undefined,
      },
    }

    return writeJsonSync(this.hbServiceSettingsPath, settings, { spaces: 4 })
  }

  /**
   * Set the flag to trigger a full restart on next boot
   */
  async setFullServiceRestartFlag() {
    // Restart ui on next restart
    this.configService.hbServiceUiRestartRequired = true

    return { status: 0 }
  }

  /**
   * Stream the full log file to the client
   */
  async downloadLogFile(shouldRemoveColour: boolean) {
    this.assertLogPathAllowed()
    if (!await pathExists(this.configService.ui.log.path)) {
      this.logger.error(`Cannot download log file ${this.configService.ui.log.path} as it does not exist.`)
      throw new BadRequestException('Log file not found on disk.')
    }
    try {
      await access(this.configService.ui.log.path, constants.R_OK)
    } catch (e) {
      this.logger.error(`Cannot download log file as missing read permissions on ${this.configService.ui.log.path}.`)
      throw new BadRequestException('Cannot read log file. Check the log file permissions.')
    }

    if (!shouldRemoveColour) {
      return createReadStream(this.configService.ui.log.path, { encoding: 'utf8' })
    }

    const removeColour = new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, chunk.toString().replace(RE_ANSI_COLOUR, ''))
      },
    })

    return createReadStream(this.configService.ui.log.path, { encoding: 'utf8' })
      .pipe(removeColour)
  }

  /**
   * Refuse a log path that points at secrets in the storage directory (a
   * value saved before the config check existed is checked again here)
   */
  private assertLogPathAllowed() {
    if (isProtectedStoragePath(this.configService.ui.log?.path, this.configService.storagePath)) {
      this.logger.error(`Refusing to use the log file ${this.configService.ui.log.path}.`)
      throw new BadRequestException(LOG_PATH_RULE)
    }
  }

  /**
   * Truncate the log file
   */
  async truncateLogFile(username?: string) {
    this.assertLogPathAllowed()
    if (!await pathExists(this.configService.ui.log.path)) {
      this.logger.error(`Cannot truncate log file ${this.configService.ui.log.path} as it does not exist.`)
      throw new BadRequestException('Log file not found on disk.')
    }
    try {
      await access(this.configService.ui.log.path, constants.R_OK | constants.W_OK)
    } catch (e) {
      this.logger.error(`Cannot truncate log file as missing write permissions on ${this.configService.ui.log.path}.`)
      throw new BadRequestException('Cannot access file. Check the log file permissions.')
    }

    await truncate(this.configService.ui.log.path)

    setTimeout(() => {
      this.logger.warn(`Homebridge log truncated by ${username || 'user'}.`)
    }, 1000)

    return { status: 0 }
  }
}
