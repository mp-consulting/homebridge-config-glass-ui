import { Inject, UseGuards } from '@nestjs/common'
import { SubscribeMessage, WebSocketGateway, WsException } from '@nestjs/websockets'

import { WsAdminGuard } from '../../core/auth/guards/ws-admin-guard.js'
import { WsGuard } from '../../core/auth/guards/ws.guard.js'
import { devServerCorsConfig } from '../../core/cors.config.js'
import { PluginsService } from '../plugins/plugins.service.js'
import { serverInfoForUser, StatusService, versionOverviewForUser, withoutInstallPath, withoutPairingCodes } from './status.service.js'

@UseGuards(WsGuard)
@WebSocketGateway({
  namespace: 'status',
  allowEIO3: true,
  cors: devServerCorsConfig,
})
export class StatusGateway {
  constructor(
    @Inject(StatusService) private readonly statusService: StatusService,
    @Inject(PluginsService) private readonly pluginsService: PluginsService,
  ) {}

  @SubscribeMessage('get-dashboard-layout')
  async getDashboardLayout() {
    try {
      return await this.statusService.getDashboardLayout()
    } catch (e) {
      return new WsException(e.message)
    }
  }

  /**
   * Bundles `get-dashboard-layout` and (when the host is a Raspberry Pi)
   * `get-raspberry-pi-throttled-status` into one WS request — the dashboard
   * page uses this on (re)connect so init is a single round-trip.
   */
  @SubscribeMessage('get-dashboard-init')
  async getDashboardInit() {
    try {
      return await this.statusService.getDashboardInit()
    } catch (e) {
      return new WsException(e.message)
    }
  }

  // The layout is shared by every user, so only an administrator may change it
  @UseGuards(WsAdminGuard)
  @SubscribeMessage('set-dashboard-layout')
  async setDashboardLayout(client, payload) {
    if (!Array.isArray(payload)) {
      return new WsException('The dashboard layout must be an array of widgets.')
    }
    try {
      return await this.statusService.setDashboardLayout(payload)
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('homebridge-version-check')
  async homebridgeVersionCheck() {
    try {
      return await this.pluginsService.getHomebridgePackage()
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('homebridge-ui-version-check')
  async homebridgeUiVersionCheck() {
    try {
      return await this.pluginsService.getHomebridgeUiPackage()
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('npm-version-check')
  async npmVersionCheck() {
    try {
      return await this.pluginsService.getNpmPackage()
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('docker-version-check')
  async dockerVersionCheck() {
    try {
      return await this.statusService.getDockerDetails()
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('nodejs-version-check')
  async nodeVersionCheck(client) {
    try {
      return withoutInstallPath(await this.statusService.getNodeVersionInfo(), client?.data?.user?.admin === true)
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('clear-nodejs-version-cache')
  clearNodeJsVersionCache() {
    this.statusService.clearNodeJsVersionCache()
    return { success: true }
  }

  @SubscribeMessage('get-out-of-date-plugins')
  async getOutOfDatePlugins() {
    try {
      return await this.pluginsService.getOutOfDatePlugins()
    } catch (e) {
      return new WsException(e.message)
    }
  }

  // Paths, service user and network details for administrators only (see versionOverviewForUser)
  @SubscribeMessage('get-version-overview')
  async getVersionOverview(client) {
    try {
      return versionOverviewForUser(await this.statusService.getVersionOverview(), client?.data?.user?.admin === true)
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('get-homebridge-server-info')
  async getHomebridgeServerInfo(client) {
    try {
      return serverInfoForUser(await this.statusService.getHomebridgeServerInfo(), client?.data?.user?.admin === true)
    } catch (e) {
      return new WsException(e.message)
    }
  }

  // The metric requests may carry the widget's refresh interval (seconds), so
  // the shared sampler ticks at least that often; older clients send none
  @SubscribeMessage('get-server-cpu-info')
  async getServerCpuInfo(client?, payload?: { interval?: number }) {
    try {
      return await this.statusService.getServerCpuInfo(payload?.interval)
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('get-server-memory-info')
  async getServerMemoryInfo(client?, payload?: { interval?: number }) {
    try {
      return await this.statusService.getServerMemoryInfo(payload?.interval)
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('get-server-network-info')
  async getServerNetworkInfo(client, payload?: { netInterfaces: string[], interval?: number }) {
    try {
      return await this.statusService.getCurrentNetworkUsage(payload.netInterfaces || [], payload.interval)
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('get-server-uptime-info')
  async getServerUptimeInfo() {
    try {
      return await this.statusService.getServerUptimeInfo()
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('get-homebridge-pairing-pin')
  async getHomebridgePairingPin(client) {
    try {
      return withoutPairingCodes(await this.statusService.getHomebridgePairingPin(), client.data?.user?.admin === true)
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('get-homebridge-status')
  async getHomebridgeStatus(client) {
    try {
      return withoutPairingCodes(await this.statusService.getHomebridgeStatus(), client.data?.user?.admin === true)
    } catch (e) {
      return new WsException(e.message)
    }
  }

  @SubscribeMessage('monitor-server-status')
  async serverStatus(client) {
    this.statusService.watchStats(client)
  }

  @SubscribeMessage('get-raspberry-pi-throttled-status')
  async getRaspberryPiThrottledStatus() {
    try {
      return await this.statusService.getRaspberryPiThrottledStatus()
    } catch (e) {
      return new WsException(e.message)
    }
  }
}
