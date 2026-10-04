import type { ChildBridgeMetadata } from './child-bridges.interfaces.js'

import { Inject, Injectable } from '@nestjs/common'

import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { RE_CHAR_PAIRS } from '../../core/regex.constants.js'
import { AccessoriesService } from '../accessories/accessories.service.js'
import { ChildBridgeHealthService } from './child-bridge-health.service.js'

type ChildBridgePairingCodes = Partial<Pick<ChildBridgeMetadata, 'pin' | 'setupUri' | 'matterPin' | 'matterSetupUri'>>

/**
 * Drop a child bridge's pairing codes (HomeKit PIN and setup URI, Matter
 * manual code and setup URI) for anyone but an administrator - the per-bridge
 * equivalent of withoutPairingCodes() for the main bridge. Whoever holds them
 * can add an unpaired bridge to their own Home. Returns a copy, so the IPC
 * payload other (admin) listeners receive is left intact.
 */
export function withoutChildBridgePairingCodes<T extends ChildBridgePairingCodes>(bridge: T, admin: boolean): T {
  if (admin || !bridge || typeof bridge !== 'object') {
    return bridge
  }
  const redacted = { ...bridge }
  delete redacted.pin
  delete redacted.setupUri
  delete redacted.matterPin
  delete redacted.matterSetupUri
  return redacted
}

/** The verified user on a socket (set by the WS guards) is an administrator */
function isAdminClient(client: any): boolean {
  return client?.data?.user?.admin === true
}

@Injectable()
export class ChildBridgesService {
  // Sockets already watching child bridge status, as LogService.activeClients
  private watchingClients = new WeakSet<object>()

  constructor(
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
    @Inject(AccessoriesService) private readonly accessoriesService: AccessoriesService,
    @Inject(ChildBridgeHealthService) private readonly health: ChildBridgeHealthService,
  ) {}

  /**
   * Return an array of child bridges
   */
  public async getChildBridges(): Promise<ChildBridgeMetadata[]> {
    try {
      return await this.homebridgeIpcService.requestResponse('childBridgeMetadataRequest', 'childBridgeMetadataResponse') as ChildBridgeMetadata[]
    } catch (e) {
      return []
    }
  }

  /**
   * The child bridges as the given user may see them: an administrator gets
   * everything, anyone else gets them without their pairing codes
   */
  public async getChildBridgesForUser(admin: boolean): Promise<ChildBridgeMetadata[]> {
    const bridges = await this.getChildBridges()
    return Array.isArray(bridges) ? bridges.map(bridge => withoutChildBridgePairingCodes(bridge, admin)) : bridges
  }

  /** Per child bridge uptime, restart / crash counts and crash-loop state. */
  public async getChildBridgesHealth() {
    return this.health.getHealth(await this.getChildBridges())
  }

  /**
   * Socket Handler - Per Client
   * Start watching for child bridge status events
   * @param client
   */
  public async watchChildBridgeStatus(client) {
    // A repeat `monitor-child-bridge-status` on the same socket must not stack
    // a second IPC listener - every status update would reach it twice
    if (this.watchingClients.has(client)) {
      return
    }
    this.watchingClients.add(client)

    // Read per update from the user the WS guards verified on this socket
    const listener = (data) => {
      const admin = isAdminClient(client)
      client.emit('child-bridge-status-update', Array.isArray(data)
        ? data.map(bridge => withoutChildBridgePairingCodes(bridge, admin))
        : withoutChildBridgePairingCodes(data, admin))
    }

    this.homebridgeIpcService.setMaxListeners(this.homebridgeIpcService.getMaxListeners() + 1)
    this.homebridgeIpcService.on('childBridgeStatusUpdate', listener)

    // Cleanup on disconnect
    const onEnd = () => {
      this.watchingClients.delete(client)
      // Only our own pair: removeAllListeners would also strip the WS auth
      // registry's and socket.io's own disconnect listeners
      client.off('end', onEnd)
      client.off('disconnect', onEnd)
      client.setMaxListeners(client.getMaxListeners() - 2)
      this.homebridgeIpcService.removeListener('childBridgeStatusUpdate', listener)
      this.homebridgeIpcService.setMaxListeners(this.homebridgeIpcService.getMaxListeners() - 1)
    }

    client.setMaxListeners(client.getMaxListeners() + 2)
    client.on('end', onEnd)
    client.on('disconnect', onEnd)
  }

  /**
   * Start / stop / restart a child bridge
   * @param event
   * @param deviceId
   * @returns ok when done
   */
  public stopStartRestartChildBridge(event: 'startChildBridge' | 'stopChildBridge' | 'restartChildBridge', deviceId: string) {
    if (deviceId.length === 12) {
      deviceId = deviceId.match(RE_CHAR_PAIRS).join(':')
    }

    // Asked for: the bridge going down now is not a crash
    this.health.expectRestart(deviceId)
    this.homebridgeIpcService.sendMessage(event, deviceId)

    setTimeout(() => {
      this.accessoriesService.resetInstancePool()
    }, 5000)

    return {
      ok: true,
    }
  }

  /**
   * Restart a single child bridge
   */
  public restartChildBridge(deviceId: string) {
    return this.stopStartRestartChildBridge('restartChildBridge', deviceId)
  }

  /**
   * Restart a single child bridge
   */
  public stopChildBridge(deviceId: string) {
    return this.stopStartRestartChildBridge('stopChildBridge', deviceId)
  }

  /**
   * Start a single (currently stopped) child bridge
   */
  public startChildBridge(deviceId: string) {
    return this.stopStartRestartChildBridge('startChildBridge', deviceId)
  }
}
