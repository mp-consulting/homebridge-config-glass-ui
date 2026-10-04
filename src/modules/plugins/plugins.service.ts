import type { EventEmitter } from 'node:events'

import type { HomebridgeConfig } from '../../core/config/config.interfaces.js'
import type { HomebridgeUpdateActionDto, PluginActionDto } from './plugins.dto.js'
import type {
  HomebridgePlugin,
  HomebridgePluginUiMetadata,
  HomebridgePluginVersions,
  PackageUpdateResult,
  PluginAction,
  PluginAlias,
} from './plugins.interfaces.js'

import { Inject, Injectable } from '@nestjs/common'

import { ConfigService } from '../../core/config/config.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { InstalledPluginsService } from './installed-plugins.service.js'
import { PluginInstallerService } from './plugin-installer.service.js'
import { PluginMetadataService } from './plugin-metadata.service.js'
import { PluginRegistryService } from './plugin-registry.service.js'
import { UiUpdateService } from './ui-update.service.js'

/**
 * The plugins module's public face. The work is split across
 * PluginRegistryService (npm registry + plugin list), InstalledPluginsService
 * (what is on disk), PluginInstallerService (npm operations),
 * PluginMetadataService (schemas, aliases, changelogs) and UiUpdateService
 * (Homebridge / UI self-update and restart). This facade keeps the API the
 * controller, gateway and other modules use in one place.
 */
@Injectable()
export class PluginsService {
  constructor(
    @Inject(PluginRegistryService) private readonly registry: PluginRegistryService,
    @Inject(InstalledPluginsService) private readonly installed: InstalledPluginsService,
    @Inject(PluginInstallerService) private readonly installer: PluginInstallerService,
    @Inject(PluginMetadataService) private readonly metadata: PluginMetadataService,
    @Inject(UiUpdateService) private readonly uiUpdate: UiUpdateService,
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  // Installed packages

  public get isPluginManagementInProgress(): boolean {
    return this.installed.isPluginManagementInProgress
  }

  public getCachedInstalledPlugins(): HomebridgePlugin[] | undefined {
    return this.installed.getCachedInstalledPlugins()
  }

  public getInstalledPlugins(): Promise<HomebridgePlugin[]> {
    return this.installed.getInstalledPlugins()
  }

  public getOutOfDatePlugins(): Promise<HomebridgePlugin[]> {
    return this.installed.getOutOfDatePlugins()
  }

  public clearInstalledPluginsCache(): void {
    this.installed.clearInstalledPluginsCache()
  }

  public getHomebridgePackage(): Promise<HomebridgePlugin> {
    return this.installed.getHomebridgePackage()
  }

  public getHomebridgeUiPackage(): Promise<HomebridgePlugin> {
    return this.installed.getHomebridgeUiPackage()
  }

  public getNpmPackage() {
    return this.installed.getNpmPackage()
  }

  // Registry

  public lookupPlugin(pluginName: string): Promise<HomebridgePlugin> {
    return this.registry.lookupPlugin(pluginName, this.installed)
  }

  public getAvailablePluginVersions(pluginName: string): Promise<HomebridgePluginVersions> {
    return this.registry.getAvailablePluginVersions(pluginName)
  }

  public searchNpmRegistry(query: string): Promise<HomebridgePlugin[]> {
    return this.registry.searchNpmRegistry(query, this.installed)
  }

  public searchNpmRegistrySingle(query: string): Promise<HomebridgePlugin[]> {
    return this.registry.searchNpmRegistrySingle(query, this.installed)
  }

  // Install / update

  public managePlugin(action: 'install' | 'uninstall', pluginAction: PluginActionDto, client: EventEmitter) {
    return this.installer.managePlugin(action, pluginAction, client)
  }

  /**
   * Install, update or uninstall a plugin, streaming npm's output to `client`
   * as `stdout` events. Shared by the `plugins` socket namespace and the
   * plugin job endpoints (PluginJobsService).
   *
   * Installing or updating the UI itself restarts it afterwards. The browser
   * normally asks for the restart, but it can lose the connection (the update
   * replaces the running server) or be closed first, which left the old
   * version running indefinitely; a restart the browser also asks for is
   * harmless.
   */
  public async runPluginAction(action: PluginAction, pluginAction: PluginActionDto, client: EventEmitter) {
    if (action === 'uninstall') {
      return this.managePlugin('uninstall', pluginAction, client)
    }
    const result = await this.managePlugin('install', pluginAction, client)
    if (pluginAction.name === this.configService.name) {
      this.logger.warn(`${this.configService.name} has been updated, the server will restart shortly...`)
      this.scheduleUiRestart()
    }
    return result
  }

  /** Reject a package name or version npm must never see (see PluginInstallerService) */
  public assertValidPackageRequest(name: string | null, version?: string): void {
    this.installer.assertValidPackageRequest(name, version)
  }

  public updateHomebridgePackage(homebridgeUpdateAction: HomebridgeUpdateActionDto, client: EventEmitter) {
    return this.uiUpdate.updateHomebridgePackage(homebridgeUpdateAction, client)
  }

  public triggerUpdate(name: string, version?: string): Promise<{ ok: boolean, name: string, version: string }> {
    return this.uiUpdate.triggerUpdate(name, version)
  }

  public performPackageUpdate(name: string, version: string, client: EventEmitter): Promise<PackageUpdateResult> {
    return this.uiUpdate.performPackageUpdate(name, version, client)
  }

  public scheduleUiRestart(): void {
    this.uiUpdate.scheduleUiRestart()
  }

  public get uiRestartPending(): boolean {
    return this.uiUpdate.uiRestartPending
  }

  // Metadata

  public getPluginConfigSchema(pluginName: string) {
    return this.metadata.getPluginConfigSchema(pluginName)
  }

  public getPluginChangeLog(pluginName: string) {
    return this.metadata.getPluginChangeLog(pluginName)
  }

  public getPluginRelease(pluginName: string, version?: string) {
    return this.metadata.getPluginRelease(pluginName, version)
  }

  public getPluginAlias(pluginName: string): Promise<PluginAlias> {
    return this.metadata.getPluginAlias(pluginName)
  }

  public getEditorContext(pluginName: string) {
    return this.metadata.getEditorContext(pluginName)
  }

  public getInstalledPluginsWithConfig(): Promise<HomebridgePlugin[]> {
    return this.metadata.getInstalledPluginsWithConfig()
  }

  public getPluginChildBridgeUsernames(pluginName: string, config?: HomebridgeConfig): Promise<string[]> {
    return this.metadata.getPluginChildBridgeUsernames(pluginName, config)
  }

  public getPluginUiMetadata(pluginName: string): Promise<HomebridgePluginUiMetadata> {
    return this.metadata.getPluginUiMetadata(pluginName)
  }
}
