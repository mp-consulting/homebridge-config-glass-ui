import type { HapClient, ServiceType } from '@homebridge/hap-client'
import type NodeCache from 'node-cache'
import type { Socket } from 'socket.io'

import type { Logger } from '../../core/logger/logger.service.js'
import type { MatterService } from '../../core/matter/matter.interfaces.js'
import type { AccessoryControlMessage } from './accessories.interfaces.js'
import type { MatterAccessoriesService } from './matter-accessories.service.js'

import { isWsClientAuthorized } from '../../core/auth/guards/ws-auth.js'

/** How long a burst of instance discoveries is coalesced before the client is told to reload. */
export const INSTANCE_RELOAD_DEBOUNCE_MS = 1000

/** The shared HAP characteristic monitor */
export type HapMonitor = Awaited<ReturnType<HapClient['monitorCharacteristics']>>

/** What a session uses from AccessoriesService, which owns the shared state. */
export interface AccessoriesSessionHost {
  readonly hapClient: HapClient
  readonly accessoriesCache: NodeCache
  readonly logger: Logger
  readonly matter: MatterAccessoriesService
  /** The HAP services, from the load shared by every client */
  loadHapServices: (fresh: boolean) => Promise<ServiceType[]>
  /** A loaded list's change signature, computed once per list */
  listSignature: (list: object[]) => string
  /** The HAP characteristic monitor shared by every client */
  ensureHapMonitor: () => Promise<HapMonitor>
  /** Ask hap-client for a discovery refresh, rate-limited across clients */
  refreshInstances: () => void
  /** Forget a client whose session has ended */
  sessionEnded: (client: Socket) => void
}

/**
 * One socket's live accessories session: the initial load, the listeners for
 * live updates, instance discovery and `accessory-control` requests, and their
 * teardown on disconnect.
 */
export class AccessoriesClientSession {
  private services: (ServiceType | MatterService)[] = []
  // Abort flag. `dispose` flips this when the client disconnects so any
  // in-flight `loadAllAccessories` / control requests can short-circuit at
  // the next `await` boundary instead of burning IPC + HAP work whose result
  // has nowhere to go.
  private disconnected = false
  // Assigned once setup gets past its awaits - null until then, so `dispose`
  // only tears down what was actually wired up.
  private monitor: HapMonitor | null = null
  private secondaryLoadTimeout: ReturnType<typeof setTimeout> | null = null
  private instanceReloadTimeout: ReturnType<typeof setTimeout> | null = null
  // What the last full load sent this client, so the blind secondary load
  // can skip re-sending a list that did not change
  private lastSent: { hap: string, matter: string } | null = null
  // Bound once setup completes, so `dispose` can detach exactly this listener
  private controlListener: ((msg?: AccessoryControlMessage) => void) | null = null
  // An instance found while setup ran may be missing from the initial load,
  // and no reload request would be sent for it (that listener comes later)
  private discoveredDuringSetup = false

  constructor(
    private readonly client: Socket,
    private readonly host: AccessoriesSessionHost,
  ) {}

  /**
   * Load the accessories and wire up the live listeners. Rejects (after
   * disposing) when a setup step fails.
   */
  async start(): Promise<void> {
    const { client, host } = this

    // Clean up on disconnect. Registered before the first `await` below: a
    // client that disconnects (or a setup step that rejects) mid-setup would
    // otherwise never run it, leaking the socket in `activeClients`, its
    // session, and the listeners/timer attached once setup completes.
    client.on('disconnect', this.dispose)
    client.on('end', this.dispose)
    host.hapClient.on('instance-discovered', this.setupDiscoveryHandler)

    try {
      // Ensure Matter monitoring is started (idempotent — one-shot per UI
      // process lifetime, shared across concurrent connects). Every client
      // awaits the same promise so loadMatterAccessories can rely on core's
      // monitoring being active by the time it runs, regardless of how many
      // clients have connected before.
      await host.matter.ensureMatterMonitoringStarted()

      // Initial load
      await this.loadAllAccessories(false)

      this.monitor = await host.ensureHapMonitor()
    } catch (e) {
      this.dispose()
      throw e
    }

    // The client left while setup was in flight - `dispose` already ran, so
    // wiring anything up now would leak it
    if (this.disconnected) {
      return
    }

    this.controlListener = (msg?: AccessoryControlMessage) => {
      this.handleControlRequest(msg).catch((e) => {
        host.logger.error(`Failed to handle accessory control request as ${e.message}.`)
        client.emit('accessory-control-failure', e.message)
      })
    }
    client.on('accessory-control', this.controlListener)

    this.monitor.on('service-update', this.updateHandler)
    host.hapClient.removeListener('instance-discovered', this.setupDiscoveryHandler)
    host.hapClient.on('instance-discovered', this.instanceUpdateHandler)

    // Load a second time only when something may have been missed: an
    // instance discovered while the initial load ran (before the
    // instance-discovered listener above was attached) never triggers a
    // reload of its own. The data is only sent when it differs.
    if (this.discoveredDuringSetup) {
      this.secondaryLoadTimeout = setTimeout(async () => {
        this.secondaryLoadTimeout = null
        await this.loadAllAccessories(true, true)
      }, 3000)
    }

    // Instances found later still reach every client through the
    // instance-discovered listener above
    host.refreshInstances()
  }

  /**
   * Re-fetch everything for this socket, in place of a second session
   */
  reload(): Promise<void> {
    return this.loadAllAccessories(true)
  }

  /**
   * Tear the session down. Bound to the socket's `disconnect` and `end`.
   */
  readonly dispose = (): void => {
    const { client, host } = this
    this.disconnected = true
    if (this.secondaryLoadTimeout) {
      clearTimeout(this.secondaryLoadTimeout)
      this.secondaryLoadTimeout = null
    }
    if (this.instanceReloadTimeout) {
      clearTimeout(this.instanceReloadTimeout)
      this.instanceReloadTimeout = null
    }
    // Only this session's listeners: removeAllListeners would also strip
    // the WS auth registry's and socket.io's own disconnect listeners
    client.off('end', this.dispose)
    client.off('disconnect', this.dispose)
    if (this.controlListener) {
      client.off('accessory-control', this.controlListener)
    }
    // Only detach THIS client's listener. The monitor is shared by every
    // connected client, so removing all listeners or finishing it here
    // would silence live updates for everyone else (the same reasoning as
    // the Matter monitoring note below - it stays up for the lifetime of
    // the UI process, and hap-client refreshes its connections itself as
    // instances come and go).
    this.monitor?.removeListener('service-update', this.updateHandler)
    host.hapClient.removeListener('instance-discovered', this.setupDiscoveryHandler)
    host.hapClient.removeListener('instance-discovered', this.instanceUpdateHandler)

    host.sessionEnded(client)

    // Intentionally do NOT stop Matter monitoring on the last client
    // disconnect. The pre-fix behaviour started monitoring on first connect
    // and stopped on last disconnect, so every page reload cycled core's
    // Matter state and re-raced its init on the next start — producing
    // 'Matter monitoring not active' spam. Keep monitoring active for the
    // lifetime of the UI process; core's matterMonitoringClients counter
    // stays at >0 and the start-up race only ever happens once.
  }

  private readonly setupDiscoveryHandler = (): void => {
    this.discoveredDuringSetup = true
  }

  private readonly updateHandler = (data: ServiceType | MatterService): void => {
    this.client.emit('accessories-data', data)
  }

  // Discovery announces instances one at a time (a dozen child bridges come
  // up within a second or two of each other), and every announcement makes
  // the client re-fetch everything. Coalesce a burst into one reload.
  private readonly instanceUpdateHandler = (): void => {
    if (this.instanceReloadTimeout) {
      clearTimeout(this.instanceReloadTimeout)
    }
    this.instanceReloadTimeout = setTimeout(() => {
      this.instanceReloadTimeout = null
      if (!this.disconnected) {
        this.client.emit('accessories-reload-required', this.services)
      }
    }, INSTANCE_RELOAD_DEBOUNCE_MS)
  }

  /**
   * `refresh`: the client asked for current data, so a recent shared load
   * is not reused (one still in flight is joined).
   * `skipUnchanged`: leave out the data the client already has from the
   * previous load (the ready events are still sent - they are idempotent)
   */
  private async loadAllAccessories(refresh: boolean, skipUnchanged = false): Promise<void> {
    const { client, host } = this
    if (this.disconnected) {
      return
    }
    if (!refresh) {
      const cached = host.accessoriesCache.get<(ServiceType | MatterService)[]>('services')
      if (cached && cached.length) {
        client.emit('accessories-data', cached)
      }
    }

    // Load HAP accessories first. getAllServices() already returns every
    // characteristic's current value, so no per-service refresh is needed.
    const hapServices = await host.loadHapServices(refresh)
    if (this.disconnected) {
      return
    }

    // Emit HAP ready immediately so HAP accessories can be controlled
    client.emit('hap-accessories-ready-for-control')
    const hapSignature = host.listSignature(hapServices)
    if (!skipUnchanged || hapSignature !== this.lastSent?.hap) {
      client.emit('accessories-data', hapServices)
    }

    // Load Matter accessories (maybe slower due to IPC)
    const matterServices = await host.matter.loadMatterAccessories()
    if (this.disconnected) {
      return
    }

    // Emit Matter ready
    client.emit('matter-accessories-ready-for-control')
    const matterSignature = host.listSignature(matterServices)
    if (matterServices.length > 0 && (!skipUnchanged || matterSignature !== this.lastSent?.matter)) {
      client.emit('accessories-data', matterServices)
    }
    this.lastSent = { hap: hapSignature, matter: matterSignature }

    // Merge both for caching and legacy compatibility
    this.services = [...hapServices, ...matterServices]
    host.accessoriesCache.set('services', this.services)
  }

  /**
   * Handle an incoming `accessory-control` request. The caller turns a
   * rejection into an `accessory-control-failure`: socket.io does not await
   * listeners, there is no global unhandledRejection handler, and Node's
   * default response to an unhandled rejection is to exit - so a single
   * malformed payload must never take the whole UI process down.
   */
  private async handleControlRequest(msg?: AccessoryControlMessage): Promise<void> {
    const { client, host } = this
    if (!msg || typeof msg !== 'object') {
      return
    }
    // This listener outlives the guarded 'get-accessories' message, so a
    // deleted user must not keep controlling accessories on an open socket
    if (!await isWsClientAuthorized(client, { admin: false })) {
      return
    }
    if (msg.refresh) {
      // Reload all accessories (typically triggered by Matter accessory changes)
      await this.loadAllAccessories(true)
    } else if (msg.set) {
      // Check if this is a Matter accessory
      if (msg.set.uniqueId && msg.set.uniqueId.startsWith('matter:')) {
        if (msg.set.cluster && msg.set.attributes) {
          await host.matter.handleMatterControl(client, {
            uniqueId: msg.set.uniqueId,
            cluster: msg.set.cluster,
            attributes: msg.set.attributes,
          })
        }
      } else {
        // HAP accessory
        const service = this.services.find(x => x.uniqueId === msg.set.uniqueId)
        if (service && 'serviceCharacteristics' in service) {
          try {
            await service.setCharacteristic(msg.set.iid, msg.set.value)

            // Re-read the touched service shortly afterwards so its cached
            // values catch up with any side effects of this write. Only this
            // service: a full reload plus a GET per service on every tap is
            // heavy on a Pi, and live changes elsewhere still arrive through
            // the shared characteristic monitor.
            setTimeout(() => {
              if (this.disconnected) {
                return
              }
              service.refreshCharacteristics().catch((error) => {
                host.logger.error(`Failed to refresh characteristics for service ${service.uniqueId}: ${error.message}`)
              })
            }, 1500)
          } catch (e) {
            client.emit('accessory-control-failure', e.message)
          }
        }
      }
    }
  }
}
