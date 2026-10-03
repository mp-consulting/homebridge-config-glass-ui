import { exec } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'

import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common'

import { ConfigService } from '../../../core/config/config.service.js'
import { Logger } from '../../../core/logger/logger.service.js'

@Injectable()
export class DockerService {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * startup.sh runs as root each time the container starts, so editing it is
   * a shell on the host by another name: only offered in the Docker image,
   * and only where the terminal is enabled (HOMEBRIDGE_CONFIG_UI_TERMINAL is
   * not `0`) - the same gate as the web terminal.
   */
  private assertStartupScriptAccess() {
    if (!this.configService.runningInDocker) {
      throw new ForbiddenException('The startup script is only available in the homebridge/homebridge Docker image.')
    }
    if (!this.configService.enableTerminalAccess) {
      throw new ForbiddenException('Editing the startup script requires terminal access, which is disabled (HOMEBRIDGE_CONFIG_UI_TERMINAL=0).')
    }
  }

  /**
   * Returns the docker startup.sh script
   */
  async getStartupScript() {
    this.assertStartupScriptAccess()
    try {
      const script = await readFile(this.configService.startupScript, 'utf-8')
      return { script }
    } catch (error) {
      this.logger.error('Error reading startup script:', error)
      throw new Error('Could not read the startup script.')
    }
  }

  /**
   * Updates the docker startup.sh script
   * @param script
   */
  async updateStartupScript(script: unknown) {
    this.assertStartupScriptAccess()
    if (typeof script !== 'string') {
      throw new BadRequestException('The startup script must be a string.')
    }
    await writeFile(this.configService.startupScript, script)
    return { script }
  }

  /**
   * Restarts the docker container
   */
  async restartDockerContainer() {
    const cmd = 'sudo kill 1'

    this.logger.log('Restarting the docker container, make sure you have --restart=always turned on or the container will not come back online.')

    setTimeout(() => {
      exec(cmd)
    }, 500)

    return { ok: true, command: cmd }
  }
}
