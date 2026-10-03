import type { Socket } from 'socket.io'

import { BadRequestException, Inject, Injectable } from '@nestjs/common'

import { ConfigService } from '../../core/config/config.service.js'
import { HomebridgeIpcService } from '../../core/homebridge-ipc/homebridge-ipc.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import {
  MatterAccessoriesResponse,
  MatterAccessory,
  MatterAccessoryInfo,
  MatterAccessoryPart,
  MatterControlResponse,
  MatterEvent,
  MatterService,
  MatterStateUpdate,
} from '../../core/matter/matter.interfaces.js'

/** Raised when a Matter IPC request gets no reply in time (retryable). */
class MatterIpcTimeoutError extends Error {}

/** A Matter accessory control request from the accessories page. */
export interface MatterControlRequest {
  uniqueId: string
  cluster: string
  attributes: Record<string, unknown>
}

/**
 * The Matter half of the accessories page: core's monitoring switch, the
 * correlation-id dispatcher for `matterEvent` IPC replies, the transform into
 * the unified service format, live state updates and control.
 */
@Injectable()
export class MatterAccessoriesService {
  /**
   * Every socket with a live accessories session (see AccessoriesService).
   * Held here because Matter pushes and the re-arm after a Homebridge restart
   * are broadcast to all of them.
   */
  readonly activeClients = new Set<Socket>()

  // Matter monitoring state
  private matterMonitoringActive = false
  private matterUpdateListener: ((event: MatterEvent) => void) | null = null
  // Cached promise for the one-shot Matter monitoring start. Concurrent
  // first-client connects all await the same promise so we only ever send
  // one startMatterMonitoring IPC per UI process lifetime. Cleared on
  // failure so a subsequent client can retry.
  private matterMonitoringStartPromise: Promise<void> | null = null
  private matterAccessories: MatterService[] = []
  // Single shared dispatcher for `matterEvent` IPC replies. Each in-flight
  // request stores `{ eventType, resolve, reject, timer }` keyed by its
  // correlation id; the dispatcher routes incoming events to the right
  // waiter instead of every request registering its own listener.
  private matterRequests = new Map<string, { eventType: string, resolve: (v: any) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>()
  private matterDispatcherInstalled = false

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(HomebridgeIpcService) private readonly homebridgeIpcService: HomebridgeIpcService,
  ) {
    // Core loses its Matter monitoring switch whenever the Homebridge process
    // restarts, while this process's one-shot (see
    // ensureMatterMonitoringStarted) still believes monitoring is armed — so
    // external (e.g. Matter controller) changes silently stop reaching the
    // accessories page until the UI itself restarts (#3993). Track the
    // process lifecycle instead: reset the one-shot when Homebridge goes
    // down, and re-arm as soon as it is back up while viewers are still
    // connected.
    this.homebridgeIpcService.on('serverStatusUpdate', this.onServerStatusUpdate)
  }

  /**
   * Get a single Matter accessory with detailed info
   * @param uniqueId
   */
  async getAccessory(uniqueId: string): Promise<MatterService> {
    try {
      const { uuid, partId } = this.parseMatterUniqueId(uniqueId)

      // Request detailed info via IPC using unified Matter event channel
      const response = await this.waitForMatterEvent<MatterAccessoryInfo>('accessoryInfo', (correlationId) => {
        this.homebridgeIpcService.sendMessage('getMatterAccessoryInfo', { uuid, correlationId })
      })

      if (response.error) {
        throw new BadRequestException(response.error)
      }

      // If asking for a part, find it
      if (partId) {
        const part = response.parts?.find((p: MatterAccessoryPart) => p.id === partId)
        if (part) {
          return this.transformMatterAccessory(response, part)
        }
        throw new BadRequestException(`Part '${partId}' not found in accessory`)
      }

      return this.transformMatterAccessory(response)
    } catch (error) {
      this.logger.error(`Failed to get Matter accessory info for ${uniqueId}:`, error)
      throw new BadRequestException(error.message || 'Failed to get Matter accessory info')
    }
  }

  /**
   * Parse a Matter uniqueId into its components. The format is exactly what
   * `buildMatterUniqueId` produces: `matter:<uuid>` or `matter:<uuid>:<partId>`,
   * with non-empty segments. Anything else (no prefix, empty segments, extra
   * segments, or a doubled `matter:matter:` prefix from building an id out of
   * an already-built one) is rejected rather than guessed at.
   */
  private parseMatterUniqueId(uniqueId: string): { uuid: string, partId?: string } {
    const prefix = 'matter:'
    const parts = typeof uniqueId === 'string' && uniqueId.startsWith(prefix)
      ? uniqueId.slice(prefix.length).split(':')
      : []
    if (parts.length < 1 || parts.length > 2 || parts.includes('') || parts[0] === 'matter') {
      throw new BadRequestException(`Invalid Matter accessory id '${uniqueId}'`)
    }
    return {
      uuid: parts[0],
      partId: parts[1],
    }
  }

  /**
   * Build a Matter uniqueId from components
   */
  private buildMatterUniqueId(uuid: string, partId?: string): string {
    return partId ? `matter:${uuid}:${partId}` : `matter:${uuid}`
  }

  /**
   * Wait for a specific Matter event type
   * Matter events use a unified 'matterEvent' channel with different types.
   * Uses a correlationId to avoid cross-talk between concurrent requests.
   * Retries once on timeout (10s per attempt).
   */
  private async waitForMatterEvent<T = unknown>(eventType: string, sendRequest: (correlationId: string) => void): Promise<T> {
    try {
      return await this.attemptMatterEvent<T>(eventType, sendRequest, 10000)
    } catch (error) {
      // only a timeout is worth retrying - a send failure (e.g. no Homebridge
      // process attached) would fail the same way again
      if (!(error instanceof MatterIpcTimeoutError)) {
        this.logger.warn(`Matter IPC request '${eventType}' failed: ${error?.message ?? error}`)
        throw error
      }
      this.logger.warn(`Matter IPC request '${eventType}' timed out, retrying...`)
      try {
        return await this.attemptMatterEvent<T>(eventType, sendRequest, 10000)
      } catch (retryError) {
        this.logger.error(`Matter IPC request '${eventType}' failed after retry`)
        throw retryError
      }
    }
  }

  /**
   * Single attempt to wait for a Matter event with the given timeout.
   * Each request gets a correlation id and parks `{ resolve, reject }` in
   * `matterRequests`; the shared dispatcher (installed on first use)
   * routes incoming `matterEvent`s to the right waiter. Pre-fix this
   * registered a fresh listener per request, so N concurrent requests
   * meant N listeners and each emit did O(N) work.
   */
  private async attemptMatterEvent<T = unknown>(eventType: string, sendRequest: (correlationId: string) => void, timeoutMs: number): Promise<T> {
    this.ensureMatterDispatcher()
    const correlationId = `${eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.matterRequests.delete(correlationId)) {
          reject(new MatterIpcTimeoutError('The Homebridge service did not respond'))
        }
      }, timeoutMs)

      this.matterRequests.set(correlationId, {
        eventType,
        resolve,
        reject,
        timer,
      })

      try {
        sendRequest(correlationId)
      } catch (e) {
        if (this.matterRequests.delete(correlationId)) {
          clearTimeout(timer)
          reject(e)
        }
      }
    })
  }

  /**
   * Install the single `matterEvent` listener on first use. Routes each
   * incoming event to the waiter parked under its correlation id.
   * Events whose correlation id is unknown (or whose `eventType` doesn't
   * match the parked request's expectation) are dropped — matches the
   * pre-fix per-listener filter behaviour.
   */
  private ensureMatterDispatcher(): void {
    if (this.matterDispatcherInstalled) {
      return
    }
    this.matterDispatcherInstalled = true
    this.homebridgeIpcService.on('matterEvent', (event: MatterEvent) => {
      if (!event?.correlationId) {
        return
      }
      const waiter = this.matterRequests.get(event.correlationId)
      if (!waiter) {
        return
      }
      if (event.type !== waiter.eventType) {
        return
      }
      this.matterRequests.delete(event.correlationId)
      clearTimeout(waiter.timer)
      waiter.resolve(event.data)
    })
  }

  /**
   * Follow the Homebridge process lifecycle (statuses come from core's
   * ServerStatus enum: 'pending' / 'ok' / 'down'). A restarted core comes
   * back with Matter monitoring off, so the one-shot must be cleared on
   * 'down' and re-armed on 'ok' — but only while sockets are connected;
   * with nobody watching, the next client connect re-arms it as normal.
   */
  private readonly onServerStatusUpdate = (data: { status?: string }): void => {
    if (data?.status === 'down') {
      this.resetMatterMonitoringState()
    } else if (data?.status === 'ok' && this.activeClients.size > 0 && !this.matterMonitoringStartPromise) {
      this.rearmMatterMonitoring()
    }
  }

  /**
   * Forget that Matter monitoring was ever started, so the next
   * ensureMatterMonitoringStarted call sends a fresh enable to core. The
   * update listener comes off the IPC bus too — re-arming installs a new
   * one, and leaving the old one attached would double up every event.
   */
  private resetMatterMonitoringState(): void {
    if (this.matterUpdateListener) {
      this.homebridgeIpcService.removeListener('matterEvent', this.matterUpdateListener)
      this.matterUpdateListener = null
    }
    this.matterMonitoringActive = false
    this.matterMonitoringStartPromise = null
  }

  /**
   * Re-arm Matter monitoring for the viewers already connected, then have
   * them re-fetch — the restarted core rebuilt its Matter state from
   * scratch, so this process's cached cluster values can't be trusted.
   */
  private rearmMatterMonitoring(): void {
    this.ensureMatterMonitoringStarted()
      .then(() => {
        // False when the start returned early (Matter unsupported or not
        // enabled) — nothing to reload in that case.
        if (!this.matterMonitoringActive) {
          return
        }
        for (const client of this.activeClients) {
          client.emit('matter-accessories-reload-required')
        }
      })
      .catch((error) => {
        this.logger.warn(`Failed to re-arm Matter monitoring after Homebridge restart: ${error.message}`)
      })
  }

  /**
   * Idempotently start Matter monitoring for the lifetime of this UI process.
   *
   * The actual start is one-shot: concurrent first-client connects all share
   * the same cached promise so we only send one `startMatterMonitoring` IPC
   * regardless of how many sockets arrive. If the start fails the cached
   * promise is cleared so a later client connect can retry — a transient
   * core-side hiccup shouldn't leave Matter monitoring permanently inactive
   * until the UI process restarts.
   */
  async ensureMatterMonitoringStarted(): Promise<void> {
    if (this.matterMonitoringActive) {
      return
    }
    if (!this.matterMonitoringStartPromise) {
      const attempt = this.startMatterMonitoring().catch((error) => {
        this.logger.error('Failed to start Matter monitoring:', error)
        if (this.matterMonitoringStartPromise === attempt) {
          this.matterMonitoringStartPromise = null
        }
      })
      this.matterMonitoringStartPromise = attempt
    }
    return this.matterMonitoringStartPromise
  }

  /**
   * Start Matter monitoring via IPC.
   *
   * Gates the first `getMatterAccessories` on core's `monitoringStarted` ack
   * so we don't race core's Matter init (which would log
   * 'Matter monitoring not active'). The ack arrives via the shared
   * matterEvent dispatcher, which only routes events that echo back the
   * request's correlationId — so the wait is feature-flagged: against an
   * older Homebridge that doesn't echo, we fall back to flipping the active
   * flag synchronously (the pre-ack behaviour) rather than hanging on a
   * reply that will never be delivered.
   */
  private async startMatterMonitoring(): Promise<void> {
    // Skip if the running Homebridge version pre-dates Matter, or if the user
    // hasn't turned Matter on for any bridge. Without the latter check we'd
    // still fire startMatterMonitoring + getMatterAccessories every time the
    // accessories tab loads, producing timeout/retry/failed log spam.
    const featureFlags = this.configService.getFeatureFlags()
    if (!featureFlags.matterSupport || !this.configService.isMatterEnabled()) {
      return
    }

    this.logger.debug('Starting Matter accessory monitoring')

    // Install the matter event listener BEFORE sending the start request so
    // we don't miss any server-pushed accessoryUpdate/Added/Removed events
    // that core may emit immediately after monitoring becomes active. The
    // correlation-id dispatcher (which handles request/response events like
    // accessoriesData and the monitoring acks) is installed lazily by
    // waitForMatterEvent and runs alongside this listener on the same channel.
    const listener: (event: MatterEvent) => void = (event) => {
      switch (event.type) {
        case 'accessoryUpdate':
          this.handleMatterStateUpdate(event.data)
          break

        case 'accessoryAdded':
        case 'accessoryRemoved':
          this.logger.debug(`Matter accessory ${event.type}: ${event.data.uuid} - triggering reload`)
          // Trigger a reload of only Matter accessories for all connected clients
          for (const client of this.activeClients) {
            client.emit('matter-accessories-reload-required')
          }
          break
      }
    }
    this.matterUpdateListener = listener
    this.homebridgeIpcService.on('matterEvent', listener)

    try {
      if (featureFlags.matterMonitoringAck) {
        // Send with a correlationId and await core's ack before flipping the
        // flag — this is what closes the startup race.
        await this.waitForMatterEvent('monitoringStarted', (correlationId) => {
          this.homebridgeIpcService.sendMessage('startMatterMonitoring', { correlationId })
        })
      } else {
        // Older Homebridge doesn't echo correlationId on the ack, so the
        // dispatcher would drop it. Fall back to fire-and-forget and accept
        // the small startup-race window the ack would otherwise close.
        this.homebridgeIpcService.sendMessage('startMatterMonitoring')
      }

      this.matterMonitoringActive = true
      this.logger.debug('Matter monitoring started successfully')
    } catch (error) {
      // Tear the listener back down so a retry from ensureMatterMonitoringStarted
      // doesn't end up with two listeners attached for accessory updates.
      this.homebridgeIpcService.removeListener('matterEvent', listener)
      if (this.matterUpdateListener === listener) {
        this.matterUpdateListener = null
      }
      throw error
    }
  }

  /**
   * Load Matter accessories via IPC
   */
  async loadMatterAccessories(): Promise<MatterService[]> {
    const featureFlags = this.configService.getFeatureFlags()
    if (!featureFlags.matterSupport || !this.configService.isMatterEnabled()) {
      return []
    }

    if (!this.matterMonitoringActive) {
      this.logger.warn('Matter monitoring not active, skipping accessory load')
      return []
    }

    try {
      // Request Matter accessories via IPC using unified Matter event channel
      const response = await this.waitForMatterEvent<MatterAccessoriesResponse>('accessoriesData', (correlationId) => {
        this.homebridgeIpcService.sendMessage('getMatterAccessories', { correlationId })
      })

      if (response.error) {
        throw new Error(response.error)
      }

      const accessories = response.accessories || []
      this.logger.debug(`Loaded ${accessories.length} Matter accessories from IPC`)

      // Transform to unified format with protocol marker
      const matterServices = accessories.flatMap((accessory: MatterAccessory) => {
        const services: MatterService[] = []

        // Main accessory
        services.push({
          ...this.transformMatterAccessory(accessory),
          protocol: 'matter',
        })

        // Parts (composed devices)
        if (accessory.parts) {
          for (const part of accessory.parts) {
            services.push({
              ...this.transformMatterAccessory(accessory, part),
              protocol: 'matter',
            })
          }
        }

        return services
      })

      this.logger.debug(`Transformed ${matterServices.length} Matter services (including parts)`)

      // Apply instanceBlacklist filtering to Matter accessories
      const blacklist = this.configService.ui.accessoryControl?.instanceBlacklist || []
      const filteredServices = blacklist.length > 0
        ? matterServices.filter((s) => {
            if (blacklist.some(b => s.instance.username.toLowerCase() === b.toLowerCase())) {
              this.logger.debug(`Matter accessory '${s.displayName}' filtered by instanceBlacklist (bridge: ${s.instance.username})`)
              return false
            }
            return true
          })
        : matterServices

      this.logger.debug(`${filteredServices.length} Matter services after blacklist filtering`)
      this.matterAccessories = filteredServices
      return filteredServices
    } catch (error) {
      this.logger.warn('Failed to load Matter accessories:', error)
      return []
    }
  }

  /**
   * Transform Matter accessory to unified service format
   */
  private transformMatterAccessory(accessory: MatterAccessory, part?: MatterAccessoryPart): MatterService {
    const targetClusters = part?.clusters || accessory.clusters
    const displayName = part
      ? `${accessory.displayName} - ${part.displayName}`
      : accessory.displayName
    const uniqueId = this.buildMatterUniqueId(accessory.uuid, part?.id)

    const deviceType = part?.deviceType || accessory.deviceType

    // Verify bridge.username is set for layout caching
    const bridgeUsername = accessory.bridge?.username || 'unknown'
    if (bridgeUsername === 'unknown') {
      this.logger.warn(`Matter accessory '${displayName}' (${uniqueId}) has no bridge.username - layout may not persist correctly`)
    }

    return {
      uniqueId,
      uuid: accessory.uuid,
      serviceName: displayName,
      displayName,
      deviceType,
      clusters: targetClusters,
      partId: part?.id,
      protocol: 'matter',
      instance: {
        name: accessory.bridge?.name || 'Matter Bridge',
        username: bridgeUsername,
      },
      accessoryInformation: {
        'Name': displayName,
        'Manufacturer': accessory.manufacturer || 'Unknown',
        'Model': accessory.model || deviceType,
        'Serial Number': accessory.serialNumber || accessory.uuid,
        'Firmware Revision': accessory.firmwareRevision || '1.0.0',
      },
      // Additional Matter info
      bridge: accessory.bridge,
      plugin: accessory.plugin,
      platform: accessory.platform,
      commissioned: accessory.commissioned,
      fabricCount: accessory.fabricCount,
      fabrics: accessory.fabrics,
      // Aid/iid placeholders (not used for Matter but required by some UI code)
      aid: 0,
      iid: 0,
    }
  }

  /**
   * Handle Matter state updates from IPC
   */
  private handleMatterStateUpdate(data: MatterStateUpdate): void {
    const uniqueId = this.buildMatterUniqueId(data.uuid, data.partId)

    const service = this.matterAccessories.find(s => s.uniqueId === uniqueId)
    if (!service) {
      return
    }

    // Update cluster state
    service.clusters[data.cluster] = {
      ...service.clusters[data.cluster],
      ...data.state,
    }

    // Notify all connected clients
    for (const client of this.activeClients) {
      client.emit('accessories-data', [service])
    }
  }

  /**
   * Handle Matter accessory control commands
   */
  async handleMatterControl(client: Socket, control: MatterControlRequest): Promise<void> {
    try {
      const { uuid, partId } = this.parseMatterUniqueId(control.uniqueId)

      // Find the accessory in the cache to get the bridge username
      // A part shares its parent's uuid, so match on the part id too
      // (undefined for the parent itself)
      const accessory = this.matterAccessories.find(acc => acc.uuid === uuid && acc.partId === partId)
      const bridgeUsername = accessory?.bridge?.username

      // Send control command via IPC using unified Matter event channel
      const response = await this.waitForMatterEvent<MatterControlResponse>('accessoryControlResponse', (correlationId) => {
        this.homebridgeIpcService.sendMessage('matterAccessoryControl', {
          uuid,
          cluster: control.cluster,
          attributes: control.attributes,
          bridgeUsername,
          partId,
          correlationId,
        })
      })

      if (!response.success) {
        client.emit('accessory-control-failure', response.error || 'Matter control failed')
        return
      }

      // Update local cluster state and notify all clients, mirroring handleMatterStateUpdate
      if (accessory?.clusters?.[control.cluster]) {
        accessory.clusters[control.cluster] = {
          ...accessory.clusters[control.cluster],
          ...control.attributes,
        }

        for (const c of this.activeClients) {
          c.emit('accessories-data', [accessory])
        }
      }
    } catch (error) {
      this.logger.error('Matter control failed:', error)
      client.emit('accessory-control-failure', error.message || 'Matter control failed')
    }
  }
}
