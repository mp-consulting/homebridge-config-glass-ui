import { resolve } from 'node:path'

import { Inject, Injectable } from '@nestjs/common'
import { readJson, writeJsonSync } from 'fs-extra/esm'

import { ConfigService } from '../../core/config/config.service.js'

/**
 * The dashboard widget layout, kept in `.uix-dashboard.json` in the storage
 * path and cached in memory once read or saved.
 */
@Injectable()
export class DashboardLayoutService {
  private dashboardLayout: any

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  private get layoutPath() {
    return resolve(this.configService.storagePath, '.uix-dashboard.json')
  }

  /**
   * Get the current dashboard layout (an empty one when none was saved yet)
   */
  public async getLayout() {
    if (!this.dashboardLayout) {
      try {
        const layout = await readJson(this.layoutPath)
        this.dashboardLayout = layout
        return layout
      } catch (e) {
        return []
      }
    } else {
      return this.dashboardLayout
    }
  }

  /**
   * Saves the current dashboard layout
   */
  public async setLayout(layout: any) {
    writeJsonSync(this.layoutPath, layout)
    this.dashboardLayout = layout
    return { status: 'ok' }
  }
}
