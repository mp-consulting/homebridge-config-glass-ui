import type { ServiceType } from '@homebridge/hap-client'
import type { Socket } from 'socket.io'

import type { AccessoriesSessionHost, HapMonitor } from './accessories-client-session.js'

import { join } from 'node:path'

import { HapClient } from '@homebridge/hap-client'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { mkdirp, pathExists, readJson } from 'fs-extra/esm'
import NodeCache from 'node-cache'

import { ConfigService } from '../../core/config/config.service.js'
import { JsonFileStoreService } from '../../core/fs/json-file-store.service.js'
import { Logger } from '../../core/logger/logger.service.js'
import { AccessoriesClientSession, INSTANCE_RELOAD_DEBOUNCE_MS } from './accessories-client-session.js'
import { MatterAccessoriesService } from './matter-accessories.service.js'

@Injectable()
export class AccessoriesService {
  /** How long a burst of instance discoveries is coalesced before the client is told to reload. */
  static readonly INSTANCE_RELOAD_DEBOUNCE_MS = INSTANCE_RELOAD_DEBOUNCE_MS
  /** How long a finished HAP load is handed to the clients that connect after it. */
  static readonly SHARED_LOAD_TTL_MS = 2000
  /** The least time between two discovery refreshes triggered by client connects. */
  static readonly REFRESH_INSTANCES_MIN_INTERVAL_MS = 30_000

  public hapClient: HapClient
  // Read-only: the cached list is only ever emitted, never mutated, so the
  // default clone on every get/set is pure overhead
  public accessoriesCache = new NodeCache({ stdTTL: 0, useClones: false })

  // Cached promise for the single shared HAP characteristic monitor. Each call
  // to hapClient.monitorCharacteristics() FINISHES the previous monitor before
  // creating a new one, so the pre-fix per-client monitor meant a second
  // browser tab silently froze live updates in the first. Cleared on failure
  // so a later client can retry.
  private hapMonitorPromise: Promise<HapMonitor> | null = null
  // The live session of each connected socket. Lets a repeat
  // `get-accessories` for an already-connected socket re-fetch data instead
  // of stacking a second set of listeners/timers on top of the live session.
  private clientSessions = new Map<Socket, AccessoriesClientSession>()
  // The HAP load shared by every client: the one in flight, or the last one
  // for SHARED_LOAD_TTL_MS after it finished. getAllServices() reads every
  // accessory of every bridge, and each tab used to run its own.
  private sharedHapLoad: { promise: Promise<ServiceType[]>, settledAt: number | null } | null = null
  private lastInstanceRefresh = 0
  // A loaded list's change signature, computed once per list however many
  // clients compare against it - taken when the list is first sent, which is
  // what every client sharing that load received
  private listSignatures = new WeakMap<object, string>()

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(Logger) private readonly logger: Logger,
    @Inject(JsonFileStoreService) private readonly jsonStore: JsonFileStoreService,
    @Inject(MatterAccessoriesService) private readonly matter: MatterAccessoriesService,
  ) {
    if (this.configService.homebridgeInsecureMode) {
      this.hapClient = new HapClient({
        pin: this.configService.homebridgeConfig.bridge.pin,
        pins: this.getChildBridgePins(),
        logger: this.logger,
        config: this.configService.ui.accessoryControl || {},
      })
    }
  }

  /** Every socket with a live session - shared with the Matter service, which broadcasts to them */
  private get activeClients(): Set<Socket> {
    return this.matter.activeClients
  }

  /** What an AccessoriesClientSession uses from this service */
  private createSessionHost(): AccessoriesSessionHost {
    return {
      hapClient: this.hapClient,
      accessoriesCache: this.accessoriesCache,
      logger: this.logger,
      matter: this.matter,
      loadHapServices: fresh => this.loadAccessoriesShared(fresh),
      listSignature: list => this.listSignature(list),
      ensureHapMonitor: () => this.ensureHapMonitor(),
      refreshInstances: () => this.refreshInstancesThrottled(),
      sessionEnded: (client) => {
        this.clientSessions.delete(client)
        this.activeClients.delete(client)
      },
    }
  }

  /**
   * The pin for each child bridge that sets its own, keyed by username.
   *
   * ⚠️ Even in insecure mode a bridge checks the `Authorization` header against
   * ITS OWN pincode, so sending the main bridge's pin to every instance only
   * works while every child bridge inherits it. A child bridge with a `pin` in
   * its `_bridge` block answered 470, was dropped during discovery, and its
   * accessories silently never appeared on the Accessories page (#2936).
   *
   * Bridges without their own pin are left out, so hap-client falls back to the
   * main bridge pin for them.
   */
  private getChildBridgePins(): Record<string, string> {
    const config = this.configService.homebridgeConfig
    const blocks = [
      ...(Array.isArray(config?.platforms) ? config.platforms : []),
      ...(Array.isArray(config?.accessories) ? config.accessories : []),
    ]

    const pins: Record<string, string> = {}
    for (const block of blocks) {
      const bridge = block?._bridge
      if (bridge?.username && bridge?.pin) {
        pins[bridge.username] = bridge.pin
      }
    }
    return pins
  }

  /**
   * Connects the client to the homebridge service
   * @param client
   */
  public async connect(client: Socket) {
    if (!this.configService.homebridgeInsecureMode) {
      this.logger.error('Homebridge must be running in insecure mode to control accessories.')
      return
    }

    // If this socket already has a live session, reload its data instead of
    // wiring up a second set of listeners/timers. A client that re-emits
    // `get-accessories` (e.g. a reconnect the server didn't observe as a
    // disconnect) would otherwise stack handlers on the shared hapClient and
    // characteristic monitor, multiplying the work done per update.
    // `activeClients` membership is the synchronous guard: it is set below
    // before the first `await`, so a racing repeat `get-accessories` still
    // short-circuits here.
    if (this.activeClients.has(client)) {
      await this.clientSessions.get(client)?.reload()
      return
    }

    // Track this client (synchronous — closes the race in the guard above)
    this.activeClients.add(client)

    const session = new AccessoriesClientSession(client, this.createSessionHost())
    this.clientSessions.set(client, session)
    await session.start()
  }

  /**
   * Ask for a discovery refresh - at most every 30 s, however many tabs
   * connect
   */
  private refreshInstancesThrottled(): void {
    const now = Date.now()
    if (now - this.lastInstanceRefresh >= AccessoriesService.REFRESH_INSTANCES_MIN_INTERVAL_MS) {
      this.lastInstanceRefresh = now
      this.hapClient.refreshInstances()
    }
  }

  /**
   * The HAP services, from one load shared by every client: a load in flight
   * is joined, and a finished one is reused for SHARED_LOAD_TTL_MS unless
   * `fresh` data is asked for.
   */
  private loadAccessoriesShared(fresh: boolean): Promise<ServiceType[]> {
    const current = this.sharedHapLoad
    if (current && (current.settledAt === null
      || (!fresh && Date.now() - current.settledAt < AccessoriesService.SHARED_LOAD_TTL_MS))) {
      return current.promise
    }

    const entry: { promise: Promise<ServiceType[]>, settledAt: number | null } = { promise: null, settledAt: null }
    entry.promise = this.loadAccessories().then(
      (services) => {
        entry.settledAt = Date.now()
        return services
      },
      (e) => {
        // A failed load is not handed to anyone else
        if (this.sharedHapLoad === entry) {
          this.sharedHapLoad = null
        }
        throw e
      },
    )
    this.sharedHapLoad = entry
    return entry.promise
  }

  /** A loaded list's change signature, computed once per list. */
  private listSignature(list: object[]): string {
    let signature = this.listSignatures.get(list)
    if (signature === undefined) {
      signature = JSON.stringify(list)
      this.listSignatures.set(list, signature)
    }
    return signature
  }

  /**
   * Create (once) and share the HAP characteristic monitor across every
   * connected client. Concurrent first connects await the same promise so
   * monitorCharacteristics() is only ever called once per UI process - each
   * call finishes the previous monitor, which is exactly the bug this
   * prevents.
   */
  private async ensureHapMonitor(): Promise<HapMonitor> {
    if (!this.hapMonitorPromise) {
      const attempt = this.hapClient.monitorCharacteristics().catch((e) => {
        if (this.hapMonitorPromise === attempt) {
          this.hapMonitorPromise = null
        }
        throw e
      })
      this.hapMonitorPromise = attempt
    }
    return this.hapMonitorPromise
  }

  /**
   * Load all the accessories from Homebridge
   */
  public async loadAccessories(): Promise<ServiceType[]> {
    if (!this.configService.homebridgeInsecureMode) {
      throw new BadRequestException('Homebridge must be running in insecure mode to access accessories.')
    }

    try {
      return await this.hapClient.getAllServices()
    } catch (e) {
      if (e.response?.status === 401) {
        this.logger.warn('Homebridge must be running in insecure mode to view and control accessories from this plugin.')
      } else {
        this.logger.error(`Failed to load accessories from Homebridge as ${e.message}.`)
      }
      return []
    }
  }

  /**
   * Get a single accessory and refresh its characteristics
   * @param uniqueId
   */
  public async getAccessory(uniqueId: string) {
    // Check if this is a Matter accessory
    if (uniqueId.startsWith('matter:')) {
      return this.matter.getAccessory(uniqueId)
    }

    // HAP accessory (existing logic)
    const services = await this.loadAccessories()
    const service = services.find(x => x.uniqueId === uniqueId)

    if (!service) {
      throw new BadRequestException(`Service with uniqueId of '${uniqueId}' not found.`)
    }

    try {
      await service.refreshCharacteristics()
      return service
    } catch (e) {
      throw new BadRequestException(e.message)
    }
  }

  /**
   * Set a characteristics value
   * @param uniqueId
   * @param characteristicType
   * @param value
   */
  public async setAccessoryCharacteristic(uniqueId: string, characteristicType: string, value: number | boolean | string) {
    const services = await this.loadAccessories()
    const service = services.find(x => x.uniqueId === uniqueId)

    if (!service) {
      throw new BadRequestException(`Service with uniqueId of '${uniqueId}' not found.`)
    }

    const characteristic = service.getCharacteristic(characteristicType)

    if (!characteristic || !characteristic.canWrite) {
      const types = service.serviceCharacteristics.filter(x => x.canWrite).map(x => `'${x.type}'`).join(', ')
      throw new BadRequestException(`Invalid characteristicType. Valid types are: ${types}.`)
    }

    // Integers
    if (['uint8', 'uint16', 'uint32', 'uint64'].includes(characteristic.format)) {
      value = Number.parseInt(value as string, 10)
      // NaN slips through both range checks below (every comparison against
      // NaN is false), so a non-numeric value would be sent on to Homebridge
      if (Number.isNaN(value)) {
        throw new BadRequestException('Invalid value. The value must be a number.')
      }
      if (characteristic.minValue !== undefined && value < characteristic.minValue) {
        throw new BadRequestException(`Invalid value. The value must be between ${characteristic.minValue} and ${characteristic.maxValue}.`)
      }
      if (characteristic.maxValue !== undefined && value > characteristic.maxValue) {
        throw new BadRequestException(`Invalid value. The value must be between ${characteristic.minValue} and ${characteristic.maxValue}.`)
      }
    }

    // Floats
    if (characteristic.format === 'float') {
      value = Number.parseFloat(value as string)
      if (Number.isNaN(value)) {
        throw new BadRequestException('Invalid value. The value must be a number.')
      }
      if (characteristic.minValue !== undefined && value < characteristic.minValue) {
        throw new BadRequestException(`Invalid value. The value must be between ${characteristic.minValue} and ${characteristic.maxValue}.`)
      }
      if (characteristic.maxValue !== undefined && value > characteristic.maxValue) {
        throw new BadRequestException(`Invalid value. The value must be between ${characteristic.minValue} and ${characteristic.maxValue}.`)
      }
    }

    // Booleans
    if (characteristic.format === 'bool') {
      if (typeof value === 'string') {
        if (['true', '1'].includes(value.toLowerCase())) {
          value = true
        } else if (['false', '0'].includes(value.toLowerCase())) {
          value = false
        }
      } else if (typeof value === 'number') {
        value = value === 1
      }

      if (typeof value !== 'boolean') {
        throw new BadRequestException('Invalid value. The value must be a boolean (true or false).')
      }
    }

    try {
      await characteristic.setValue(value)
      await service.refreshCharacteristics()
      return service
    } catch (e) {
      throw new BadRequestException(e.message)
    }
  }

  /**
   * Get the accessory layout
   */
  public async getAccessoryLayout(username: string) {
    try {
      const accessoryLayout = await readJson(this.configService.accessoryLayoutPath)
      if (username in accessoryLayout) {
        return accessoryLayout[username]
      } else {
        throw new Error('User not in Accessory Layout')
      }
    } catch (e) {
      return [
        {
          name: 'Default Room',
          isDefault: true,
          services: [],
        },
      ]
    }
  }

  /**
   * Saves the accessory layout
   * @param user
   * @param layout
   */
  public async saveAccessoryLayout(user: string, layout: Record<string, unknown>) {
    // Ensure the accessories dir exists for the first-ever save before
    // we acquire the file lock — pathExists/mkdirp don't touch the
    // accessory-layout.json itself.
    if (!await pathExists(join(this.configService.storagePath, 'accessories'))) {
      await mkdirp(join(this.configService.storagePath, 'accessories'))
    }

    // Per-path mutex on accessory-layout.json so two near-simultaneous
    // save-layout socket events don't both read the same baseline and
    // drop one user's update on top of the other's.
    await this.jsonStore.mutate<Record<string, unknown>>(
      this.configService.accessoryLayoutPath,
      (current) => {
        const accessoryLayout = current ?? {}
        accessoryLayout[user] = layout
        return accessoryLayout
      },
    )
    this.logger.log(`Accessory layout changes saved for ${user}.`)
    return layout
  }

  /**
   * Reset the instance pool and do a full scan for Homebridge instances
   */
  public resetInstancePool() {
    if (this.configService.homebridgeInsecureMode) {
      // The instances are about to be rediscovered: do not hand out a load of the old ones
      this.sharedHapLoad = null
      this.hapClient.resetInstancePool()
    }
  }
}
