import type { AccessoryLayout, AccessoryLayoutService, ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { IoNamespace } from '@/core/ws'
import type { ServiceType } from '@homebridge/hap-client'
import type { StoreApi } from 'zustand'

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { AccessoryInfo } from '@/core/accessories/accessory-info/AccessoryInfo'
import { useAuthStore } from '@/core/auth/auth.store'
import { cachedAccessoriesCache } from '@/core/caching/cached-accessories-cache'
import { serverPairingsCache } from '@/core/caching/server-pairings-cache'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { toToastMessage } from '@/core/utilities/http-error'
import { ws } from '@/core/ws'

export interface AccessoryRoom {
  name: string
  isDefault?: boolean
  services: ServiceTypeX[]
}

export interface AccessoriesState {
  rooms: AccessoryRoom[]
  availableBridges: string[]
  selectedBridges: string[] | null
  /** Mirrors of the service's ready flags, so tiles re-render when a protocol becomes controllable. */
  hapReadyForControl: boolean
  matterReadyForControl: boolean
}

/** A Subject of the service's public streams (`accessoryData`, `layoutSaved`). */
export class Emitter<T = unknown> {
  private listeners = new Set<(value: T) => void>()

  public next(value: T): void {
    // A snapshot: a listener may unsubscribe itself while being called
    for (const listener of Array.from(this.listeners)) {
      listener(value)
    }
  }

  /** Returns the unsubscribe function. */
  public subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

/** A field of the store with the call / `set` / `update` shape of an Angular signal. */
export interface StoreSignal<T> {
  (): T
  set: (value: T) => void
  update: (fn: (value: T) => T) => void
}

function storeSignal<K extends keyof AccessoriesState>(store: StoreApi<AccessoriesState>, key: K): StoreSignal<AccessoriesState[K]> {
  const read = (() => store.getState()[key]) as StoreSignal<AccessoriesState[K]>
  read.set = value => store.setState({ [key]: value } as Pick<AccessoriesState, K>)
  read.update = fn => store.setState({ [key]: fn(store.getState()[key]) } as Pick<AccessoriesState, K>)
  return read
}

export interface AccessoriesServiceDeps {
  ws?: { connectToNamespace: (namespace: string) => IoNamespace }
  toast?: { error: (message: string, title?: string) => unknown, warning: (message: string, title?: string) => unknown }
  openModal?: (component: any, props?: Record<string, any>, options?: Record<string, any>) => { result: Promise<any> }
  accessoryCache?: { getHap: () => Promise<any> }
  pairingsCache?: { get: () => Promise<any> }
  getUser?: () => { username?: string, admin?: boolean } | undefined
}

export class AccessoriesService {
  private deps: Required<AccessoriesServiceDeps>
  private accessoryCache: any[] = []
  private pairingCache: any[] = []
  private cachedDataRequested = false
  private customAttributesApplied = new Set<string>()
  private combinedServiceIds = new Set<string>()
  private io!: IoNamespace
  // Bumped by stop(): replies to requests made in an earlier session are dropped
  private session = 0
  private unsubscribeConnected: (() => void) | null = null
  // The socket handlers of the current session, keyed by event, so `stop()`
  // can `off()` exactly these on the shared namespace socket.
  private socketHandlers: Record<string, (...args: any[]) => void> = {}
  // True between `start()` and `stop()`. Guards the `accessories-data` handler
  // so an in-flight payload landing after a session stops can't push stale
  // services to subscribers.
  private sessionActive = false
  private hiddenTypes = new Set([
    'InputSource',
    'LockManagement',
    'CameraRTPStreamManagement',
    'ProtocolInformation',
    'NFCAccess',
    'BridgedNode',
    'History', // Eve History
  ])

  public readonly store: StoreApi<AccessoriesState> = createStore<AccessoriesState>(() => ({
    rooms: [],
    availableBridges: [],
    selectedBridges: null,
    hapReadyForControl: false,
    matterReadyForControl: false,
  }))

  public layoutSaved = new Emitter<void>()
  public accessoryData = new Emitter<unknown>()
  public get hapReadyForControl(): boolean {
    return this.store.getState().hapReadyForControl
  }

  public set hapReadyForControl(value: boolean) {
    this.store.setState({ hapReadyForControl: value })
  }

  public get matterReadyForControl(): boolean {
    return this.store.getState().matterReadyForControl
  }

  public set matterReadyForControl(value: boolean) {
    this.store.setState({ matterReadyForControl: value })
  }

  public accessories: { services: ServiceTypeX[] } = { services: [] }
  public accessoryLayout!: AccessoryLayout
  private originalLayout!: AccessoryLayout
  public readonly availableBridges = storeSignal(this.store, 'availableBridges')
  public readonly selectedBridges = storeSignal(this.store, 'selectedBridges')
  public bridgeUsernameToNameMap: Map<string, string> = new Map()
  public readonly rooms = storeSignal(this.store, 'rooms')

  constructor(deps: AccessoriesServiceDeps = {}) {
    this.deps = {
      ws: deps.ws ?? ws,
      toast: deps.toast ?? toast,
      openModal: deps.openModal ?? (openModal as unknown as Required<AccessoriesServiceDeps>['openModal']),
      accessoryCache: deps.accessoryCache ?? cachedAccessoriesCache,
      pairingsCache: deps.pairingsCache ?? serverPairingsCache,
      getUser: deps.getUser ?? (() => useAuthStore.getState().user),
    }
  }

  /**
   * Angular loaded these when the root service was first injected. This
   * singleton exists from import time, before anyone is signed in, so the load
   * happens on the first `start()` instead - which is when the page or the
   * dashboard widget that injected it used to start a session.
   */
  private ensureCachedData(): void {
    if (this.cachedDataRequested) {
      return
    }
    if (this.deps.getUser()?.admin) {
      this.cachedDataRequested = true
      void this.loadCachedData()
    }
  }

  private async loadCachedData(): Promise<void> {
    // Show a single toast on first failure rather than per-cache, so a
    // backend that's down across the board doesn't fire two error toasts
    // in a row. Failures here mean the Accessory Info modal will be
    // missing data — without surfacing it, the user just sees a blank
    // panel and assumes the feature is broken.
    let surfaced = false
    const handle = (error: unknown) => {
      console.error(error)
      if (!surfaced) {
        surfaced = true
        this.deps.toast.warning(toToastMessage(error), i18n.t('toast.title_warning'))
      }
    }

    try {
      this.accessoryCache = await this.deps.accessoryCache.getHap()
    } catch (error) {
      handle(error)
    }

    try {
      this.pairingCache = await this.deps.pairingsCache.get()
    } catch (error) {
      handle(error)
    }
  }

  public async showAccessoryInformation(service: ServiceTypeX): Promise<boolean> {
    const ref = this.deps.openModal(AccessoryInfo, {
      service,
      accessoryCache: this.accessoryCache,
      pairingCache: this.pairingCache,
    }, {
      size: 'lg',
      backdrop: 'static',
    })

    try {
      const result = await ref.result

      // Apply saved values to the current service object in the room.
      // The original service reference may have been replaced by an accessories-data
      // event during the modal close animation, so find the current one by uniqueId.
      const currentService = this.rooms()
        .flatMap(r => r.services)
        .find(s => s.uniqueId === service.uniqueId)

      const target = currentService || service

      // Build a NEW service object carrying the saved values rather than mutating
      // `target` in place, so a memoised tile sees a new `service` prop and
      // re-renders now (the custom type, and therefore the icon, would otherwise
      // stay stale until the next live data event).
      const updated = {
        ...target,
        customName: result.customName,
        customType: result.customType,
        hidden: result.hidden,
        onDashboard: result.onDashboard,
      } as ServiceTypeX

      // Keep the flat accessories list in sync so later parses/refreshes build on the
      // new reference instead of resurrecting the stale one.
      const flatIndex = this.accessories.services.findIndex(s => s.uniqueId === updated.uniqueId)
      if (flatIndex !== -1) {
        this.accessories.services[flatIndex] = updated
      }

      this.rooms.update(rooms => rooms.map(room => ({
        ...room,
        services: room.services.map(s => (s.uniqueId === updated.uniqueId ? updated : s)),
      })))

      this.saveLayout()
    } catch {
      // Modal dismissed - do not save
    }

    return false
  }

  /**
   * Stop the accessory control session
   */
  public stop() {
    this.session += 1
    this.unsubscribeConnected?.()
    this.unsubscribeConnected = null

    // Mark the session inactive so any in-flight `accessories-data` event that
    // lands between `io.end()` and the socket actually closing is dropped
    // instead of pushing stale services to subscribers.
    //
    // The public `accessoryData`/`layoutSaved` emitters are deliberately kept.
    // This service is a singleton and its consumers (accessories page, control
    // modal, dashboard widget) subscribe once. Dropping their listeners on stop
    // killed them on the first `accessories-reload-required` reload, so a
    // late-discovered bridge was sorted into the rooms but never re-added to
    // the bridge filter — hiding the whole bridge until a manual page refresh.
    this.sessionActive = false

    // The namespace socket is cached and shared, and `end()` deliberately
    // keeps its listeners, so detach this session's handlers explicitly or
    // every stop()/start() cycle would stack another full set.
    this.unbindSocketHandlers()
    this.io?.end?.()
    this.rooms.set([])
    this.accessories = { services: [] }
    this.customAttributesApplied.clear()
    this.combinedServiceIds.clear()
    this.accessoryLayout = undefined as unknown as AccessoryLayout
    this.originalLayout = undefined as unknown as AccessoryLayout
  }

  /**
   * Start the accessory control session
   */
  public async start() {
    this.ensureCachedData()

    this.hapReadyForControl = false
    this.matterReadyForControl = false
    this.sessionActive = true
    const session = this.session

    // Connect to the socket endpoint
    this.io = this.deps.ws.connectToNamespace('accessories')

    // Load the room layout first
    await this.loadLayout()

    if (session !== this.session) {
      // Stopped while the layout was loading
      return
    }

    // Subscribe for reconnections — `connected` replays its last emission, so
    // this fires both for fresh connections and when the namespace is reused
    // while already connected, so no synchronous fallback is needed.
    this.unsubscribeConnected?.()
    this.unsubscribeConnected = this.io.connected.subscribe(() => {
      this.io.socket.emit('get-accessories')
    })

    // Subscribe to accessory events. The namespace socket is cached and shared,
    // and `io.end()` keeps its listeners, so every handler is bound through
    // `bindSocketHandlers()` and detached again in `stop()`.
    this.bindSocketHandlers()
  }

  /**
   * Register this session's socket handlers, keeping each reference so
   * `unbindSocketHandlers()` can remove exactly these and nothing else.
   */
  private bindSocketHandlers() {
    // A start() without a stop() in between must not stack a second set
    this.unbindSocketHandlers()
    this.socketHandlers = {
      'accessories-data': (data: ServiceType[]) => {
        // Drop events that arrive after the session was stopped (e.g. an
        // in-flight payload landing between `stop()` and the socket closing).
        if (!this.sessionActive) {
          return
        }
        this.parseServices(data as ServiceTypeX[])
        this.combineRelatedServices()
        this.generateHelpers()
        this.sortIntoRooms()

        // Always order rooms to handle accessories that arrive late (e.g., Matter accessories)
        this.orderRooms()

        // Service objects are replaced, not mutated, so point the rooms at the
        // new references for anything that compares by identity
        this.refreshRoomsForChangeDetection()

        // Apply custom attributes after refreshing room references
        // This ensures attributes are applied to the new service objects, not the old ones
        this.applyCustomAttributes()

        this.accessoryData.next(data)
      },

      // When a new instance is discovered, reload accessory data over the
      // existing socket instead of tearing the session down and back up.
      // A full stop()/start() cycle is heavier than needed and would drop the
      // rooms in between; re-fetching in place keeps the single set of
      // handlers, and parseServices() merges the new bridge in.
      'accessories-reload-required': () => {
        this.io.socket.emit('accessory-control', { refresh: true })
      },

      // When only Matter accessories need to reload
      'matter-accessories-reload-required': () => {
        // Trigger reload by emitting accessory-control-refresh
        // This will reload accessories from the backend without full reconnection
        this.matterReadyForControl = false
        this.io.socket.emit('accessory-control', { refresh: true })
      },

      'accessory-control-failure': (message: string) => {
        console.error(message)
        this.deps.toast.error(message, i18n.t('toast.title_error'))
      },

      // Protocol-specific ready events
      'hap-accessories-ready-for-control': () => {
        this.hapReadyForControl = true
      },

      'matter-accessories-ready-for-control': () => {
        this.matterReadyForControl = true
      },
    }

    for (const [event, handler] of Object.entries(this.socketHandlers)) {
      this.io.socket.on(event, handler)
    }
  }

  /**
   * Remove the handlers registered by `bindSocketHandlers()`.
   */
  private unbindSocketHandlers() {
    if (!this.io) {
      return
    }
    for (const [event, handler] of Object.entries(this.socketHandlers)) {
      this.io.socket.off(event, handler)
    }
    this.socketHandlers = {}
  }

  /**
   * Save the room layout
   */
  public saveLayout() {
    // Generate layout schema from currently active rooms
    const currentLayout = this.rooms().map(room => ({
      name: room.name,
      isDefault: room.isDefault,
      services: room.services.map(service => ({
        uniqueId: service.uniqueId,
        nameBasedUniqueId: service.nameBasedUniqueId || undefined,
        name: service.serviceName,
        serial: service.accessoryInformation?.['Serial Number'],
        bridge: service.instance?.username,
        aid: service.aid,
        iid: service.iid,
        uuid: service.uuid,
        customName: service.customName || undefined,
        customType: service.customType || undefined,
        hidden: service.hidden || undefined,
        onDashboard: service.onDashboard || undefined,
      })),
    }))

    // Ensure at least one room has isDefault: true
    const hasDefaultRoom = currentLayout.some(r => r.isDefault === true)
    if (!hasDefaultRoom && currentLayout.length > 0) {
      currentLayout[0].isDefault = true
    }

    // Merge with undiscovered services from original layout to preserve custom information
    // This will add back rooms that exist in the original layout even if they have no discovered services
    this.accessoryLayout = this.mergeWithUndiscoveredServices(currentLayout as AccessoryLayout)

    // Send update request to server
    const session = this.session
    this.io.request('save-layout', { user: this.deps.getUser()?.username, layout: this.accessoryLayout })
      .then(
        () => {
          if (session === this.session) {
            this.layoutSaved.next(undefined)
          }
        },
        (error: unknown) => {
          if (session !== this.session) {
            return
          }
          console.error(error)
          this.deps.toast.error(toToastMessage(error), i18n.t('toast.title_error'))
        },
      )
  }

  /**
   * Load the room layout
   */
  private async loadLayout() {
    this.accessoryLayout = await this.io.request<AccessoryLayout>('get-layout', { user: this.deps.getUser()?.username })

    // Store original layout to preserve undiscovered services
    this.originalLayout = JSON.parse(JSON.stringify(this.accessoryLayout))

    // Backward compatibility: Ensure at least one room has isDefault flag
    const hasDefaultRoom = this.accessoryLayout.some(r => r.isDefault)
    if (!hasDefaultRoom && this.accessoryLayout.length > 0) {
      // Find room named "Default Room" or use first room
      const defaultRoomIndex = this.accessoryLayout.findIndex(r => r.name === 'Default Room')
      const indexToMakeDefault = defaultRoomIndex !== -1 ? defaultRoomIndex : 0
      this.accessoryLayout[indexToMakeDefault].isDefault = true
    }

    // Build empty room layout
    this.rooms.set(this.accessoryLayout.map(room => ({
      name: room.name,
      isDefault: room.isDefault,
      services: [] as ServiceTypeX[],
    })))
  }

  /**
   * Check if a cached service matches a discovered service.
   *
   * Matching priority:
   * 1. nameBasedUniqueId (stable across sessions, available from hap-client)
   * 2. uniqueId (stable within a session, may change between sessions)
   * 3. Fallback: name + serial + bridge + uuid (legacy layouts without nameBasedUniqueId)
   *
   * Matter accessories use uniqueId + bridge matching only.
   */
  private servicesMatch(cachedService: AccessoryLayoutService, discoveredService: any): boolean {
    const isMatterAccessory = discoveredService.protocol === 'matter' || discoveredService.uniqueId?.startsWith('matter:')
    if (isMatterAccessory) {
      return cachedService.uniqueId === discoveredService.uniqueId
        && cachedService.bridge === (discoveredService.instance?.username || discoveredService.bridge)
    }

    // Primary match: nameBasedUniqueId (stable across sessions)
    if (cachedService.nameBasedUniqueId && discoveredService.nameBasedUniqueId) {
      return cachedService.nameBasedUniqueId === discoveredService.nameBasedUniqueId
    }

    // Secondary match: uniqueId
    if (cachedService.uniqueId === discoveredService.uniqueId) {
      return true
    }

    // Fallback: multi-field match for legacy layouts without nameBasedUniqueId
    return cachedService.name === (discoveredService.serviceName || discoveredService.name)
      && cachedService.serial === (discoveredService.accessoryInformation?.['Serial Number'] || discoveredService.serial)
      && cachedService.bridge === (discoveredService.instance?.username || discoveredService.bridge)
      && cachedService.uuid === discoveredService.uuid
  }

  /**
   * Find a cached service in the layout that matches a discovered service.
   * Returns the cached service and the room it belongs to, or null if not found.
   */
  private findInLayout(service: ServiceType): { room: AccessoryLayout[number], service: AccessoryLayoutService } | null {
    for (const room of this.accessoryLayout) {
      for (const cachedService of room.services) {
        if (!cachedService.name) {
          continue
        }
        if (this.servicesMatch(cachedService, service)) {
          return { room, service: cachedService }
        }
      }
    }
    return null
  }

  /**
   * Merge current layout with undiscovered services to preserve custom information
   */
  private mergeWithUndiscoveredServices(currentLayout: AccessoryLayout): AccessoryLayout {
    if (!this.originalLayout) {
      return currentLayout
    }

    // Create the merged layout starting with current rooms
    const mergedLayout: AccessoryLayout = JSON.parse(JSON.stringify(currentLayout))

    // Track which original services have been matched to a discovered service
    const matchedOriginalKeys = new Set<string>()

    // First pass: find all original services that match a discovered service
    for (const room of mergedLayout) {
      for (const discoveredService of room.services) {
        for (const originalRoom of this.originalLayout) {
          for (const originalService of originalRoom.services) {
            if (!originalService.name) {
              continue
            }
            if (this.servicesMatch(originalService, discoveredService)) {
              matchedOriginalKeys.add(this.getServiceKey(originalService))
              break
            }
          }
          if (matchedOriginalKeys.has(this.getServiceKey(discoveredService))) {
            break
          }
        }
      }
    }

    // Second pass: add unmatched services from original layout (truly undiscovered services)
    for (const originalRoom of this.originalLayout) {
      for (const originalService of originalRoom.services) {
        if (matchedOriginalKeys.has(this.getServiceKey(originalService))) {
          continue
        }
        if (!originalService.name) {
          continue
        }

        // Find the room for this undiscovered service
        let targetRoom = mergedLayout.find(room => room.name === originalRoom.name)

        // If the room doesn't exist in current layout, it was deleted by the user
        // Move undiscovered services to the default room instead of recreating the deleted room
        if (!targetRoom) {
          targetRoom = mergedLayout.find(room => room.isDefault)
          if (!targetRoom) {
            continue
          }
        }

        // Add the undiscovered service with its preserved custom information
        targetRoom.services.push({
          uniqueId: originalService.uniqueId,
          nameBasedUniqueId: originalService.nameBasedUniqueId,
          name: originalService.name,
          bridge: originalService.bridge,
          serial: originalService.serial,
          aid: originalService.aid,
          iid: originalService.iid,
          uuid: originalService.uuid,
          customName: originalService.customName,
          customType: originalService.customType,
          hidden: originalService.hidden,
          onDashboard: originalService.onDashboard,
        })
      }
    }

    // Keep rooms that either have services OR were in the current layout (user-created empty rooms)
    return mergedLayout.filter(room =>
      room.services.length > 0 || currentLayout.some(r => r.name === room.name),
    )
  }

  /**
   * Get a stable key for a service, preferring nameBasedUniqueId
   */
  private getServiceKey(service: { nameBasedUniqueId?: string, uniqueId?: string }): string {
    return (service.nameBasedUniqueId || service.uniqueId)!
  }

  /**
   * Parse the incoming accessory data and refresh existing accessory statuses
   */
  private parseServices(services: ServiceTypeX[]) {
    if (!this.accessories.services.length) {
      this.accessories.services = services
      return
    }

    // Replace existing objects instead of mutating them
    services.forEach((service) => {
      const existingIndex = this.accessories.services.findIndex(x => x.uniqueId === service.uniqueId)

      if (existingIndex !== -1) {
        // Replace the object instead of mutating it
        this.accessories.services[existingIndex] = service
        // Clear from customAttributesApplied Set so attributes get re-applied to the new object
        this.customAttributesApplied.delete(service.uniqueId!)
      } else {
        this.accessories.services.push(service)
      }
    })
  }

  /**
   * Sort the accessories into their rooms
   */
  private sortIntoRooms() {
    this.accessories.services.forEach((service) => {
      // Don't put hidden types or combined services into rooms
      // Matter services use deviceType instead of type
      if (this.hiddenTypes.has(service.type) || this.hiddenTypes.has(service.deviceType!) || this.combinedServiceIds.has(service.uniqueId!)) {
        return
      }

      // Link services
      if (service.linked) {
        service.linkedServices = {}
        service.linked.forEach((iid) => {
          service.linkedServices![iid] = this.accessories.services.find(s => s.aid === service.aid && s.iid === iid
            && s.instance.username === service.instance.username)!
        })
      }

      // Check if the service has already been allocated to an active room
      const inRoom = this.rooms().find(r => r.services.find(s => s.uniqueId === service.uniqueId))

      // Not in an active room, perhaps the service is in the layout cache
      if (!inRoom) {
        const cached = this.findInLayout(service)

        if (cached) {
          // Apply custom attributes from cache before adding to room
          if (cached.service.customType) {
            service.customType = cached.service.customType
          }
          if (cached.service.customName) {
            service.customName = cached.service.customName
          }
          if (cached.service.hidden) {
            service.hidden = cached.service.hidden
          }
          if (cached.service.onDashboard) {
            service.onDashboard = cached.service.onDashboard
          }

          // Mark that custom attributes have been applied to this accessory
          this.customAttributesApplied.add(service.uniqueId!)

          // Add to the correct room
          this.rooms.update(current => current.map(r =>
            r.name === cached.room.name
              ? { ...r, services: [...r.services, service] }
              : r,
          ))
        } else {
          // Mark as processed (even though no custom attributes to apply)
          this.customAttributesApplied.add(service.uniqueId!)

          // New accessory add to the default room
          const defaultRoom = this.rooms().find(r => r.isDefault === true)
            || this.rooms().find(r => r.name === 'Default Room')

          if (defaultRoom) {
            this.rooms.update(current => current.map(r =>
              r.name === defaultRoom.name
                ? { ...r, services: [...r.services, service] }
                : r,
            ))
          } else {
            this.rooms.update(current => [...current, {
              name: 'Default Room',
              isDefault: true,
              services: [service],
            }])
          }
        }
      }
    })
  }

  /**
   * Order the services within each room based on the cached layout positions
   */
  private orderRooms() {
    this.rooms.update(current => current.map((room) => {
      const roomCache = this.accessoryLayout.find(r => r.name === room.name)
      if (!roomCache) {
        return room
      }

      const sortedServices = room.services.toSorted((a, b) => {
        const posA = roomCache.services.findIndex(s => this.servicesMatch(s, a))
        const posB = roomCache.services.findIndex(s => this.servicesMatch(s, b))
        return posA - posB
      })
      return { ...room, services: sortedServices }
    }))
  }

  /**
   * Refresh rooms to use updated service references.
   * After parseServices() replaces service objects, we need to update the rooms
   * to point to the new service references from this.accessories.services
   */
  private refreshRoomsForChangeDetection() {
    this.rooms.update(current => current.map(room => ({
      ...room,
      services: room.services.map((service) => {
        // Find the updated service from the main accessories array
        const updatedService = this.accessories.services.find(s => s.uniqueId === service.uniqueId)
        return updatedService || service
      }),
    })))
  }

  /**
   * Apply custom attributes to services that haven't been processed yet
   * Only applies the custom properties we care about: customName, customType, hidden, onDashboard
   */
  private applyCustomAttributes() {
    this.rooms().forEach((room) => {
      room.services.forEach((service) => {
        // Skip if we've already applied custom attributes to this accessory
        if (this.customAttributesApplied.has(service.uniqueId!)) {
          return
        }

        // Use servicesMatch to find the cached service across any room in the layout
        const cached = this.findInLayout(service)
        if (!cached) {
          return
        }

        // Only apply the custom properties we care about, not all properties
        if (cached.service.customType) {
          service.customType = cached.service.customType
        }
        if (cached.service.customName) {
          service.customName = cached.service.customName
        }
        if (cached.service.hidden) {
          service.hidden = cached.service.hidden
        }
        if (cached.service.onDashboard) {
          service.onDashboard = cached.service.onDashboard
        }

        // Mark this accessory as processed
        this.customAttributesApplied.add(service.uniqueId!)
      })
    })
  }

  /**
   * Generate helpers for accessory control
   */
  private generateHelpers() {
    this.accessories.services.forEach((service) => {
      // Matter accessories use cluster-based control
      if (service.protocol === 'matter') {
        if (!service.getCluster) {
          service.getCluster = (clusterName: string) => {
            const clusters = service.clusters || {}

            if (!clusters[clusterName]) {
              return null
            }

            return {
              attributes: clusters[clusterName],
              /**
               * Fire-and-forget: emits a WebSocket message and resolves immediately.
               * The promise never rejects; errors are not surfaced to callers.
               * Try/catch blocks around setAttributes calls are therefore no-ops for
               * transport errors but kept for documentation and future-proofing.
               */
              setAttributes: (attributes: Record<string, unknown>) => new Promise<void>((resolve) => {
                if (!this.matterReadyForControl) {
                  console.warn('Matter control attempted but not ready for control:', {
                    matterReadyForControl: this.matterReadyForControl,
                    uniqueId: service.uniqueId,
                    cluster: clusterName,
                  })
                  return resolve(undefined)
                }

                this.io.socket.emit('accessory-control', {
                  set: {
                    uniqueId: service.uniqueId,
                    cluster: clusterName,
                    attributes,
                  },
                })
                return resolve(undefined)
              }),
            }
          }
        }
      } else {
        // HAP accessories use characteristic-based control
        if (!service.getCharacteristic) {
          service.getCharacteristic = ((type: string) => {
            const characteristic = service.serviceCharacteristics.find(x => x.type === type)

            if (!characteristic) {
              return null
            }

            characteristic.setValue = ((value: number | string | boolean) => new Promise<void>((resolve) => {
              if (!this.hapReadyForControl) {
                return resolve(undefined)
              }

              this.io.socket.emit('accessory-control', {
                set: {
                  uniqueId: service.uniqueId,
                  aid: service.aid,
                  siid: service.iid,
                  iid: characteristic.iid,
                  value,
                },
              })
              return resolve(undefined)
            })) as any

            return characteristic
          }) as any
        }
      }
    })
  }

  /**
   * Check if two services belong to the same physical accessory
   * (same name, serial number, and bridge instance)
   */
  private isSameAccessory(a: ServiceType, b: ServiceType): boolean {
    return a.accessoryInformation.Name === b.accessoryInformation.Name
      && a.accessoryInformation['Serial Number'] === b.accessoryInformation['Serial Number']
      && a.instance.username === b.instance.username
  }

  private attachLockManagementToMechanism(service: ServiceType) {
    const lockMechanisms: ServiceType[] = []
    const lockManagements: ServiceType[] = []

    for (const serv of this.accessories.services) {
      if (serv.type === 'LockMechanism' && this.isSameAccessory(serv, service)) {
        lockMechanisms.push(serv)
      } else if (serv.type === 'LockManagement' && this.isSameAccessory(serv, service)) {
        lockManagements.push(serv)
      }
    }

    if (lockMechanisms.length === 1 && lockManagements.length === 1) {
      const lockManagement = lockManagements[0]

      if (!service.linkedServices) {
        service.linkedServices = {}
      }
      service.linkedServices[lockManagement.iid] = lockManagement
    }
  }

  private attachFanToHeaterCooler(service: ServiceType) {
    const heaterCoolers: ServiceType[] = []
    const fans: ServiceType[] = []

    for (const serv of this.accessories.services) {
      if (this.isSameAccessory(serv, service)) {
        if (serv.type === 'HeaterCooler') {
          heaterCoolers.push(serv)
        } else if (serv.type === 'Fan' || serv.type === 'Fanv2') {
          fans.push(serv)
        }
      }
    }

    if (heaterCoolers.length === 1 && fans.length === 1) {
      const fan = fans[0]

      if (!service.linkedServices) {
        service.linkedServices = {}
      }
      service.linkedServices[fan.iid] = fan
      this.combinedServiceIds.add(fan.uniqueId!)
    }
  }

  private attachFanToHumidifierDehumidifier(service: ServiceType) {
    const humidifierDehumidifiers: ServiceType[] = []
    const fans: ServiceType[] = []

    for (const serv of this.accessories.services) {
      if (this.isSameAccessory(serv, service)) {
        if (serv.type === 'HumidifierDehumidifier') {
          humidifierDehumidifiers.push(serv)
        } else if (serv.type === 'Fan' || serv.type === 'Fanv2') {
          fans.push(serv)
        }
      }
    }

    if (humidifierDehumidifiers.length === 1 && fans.length === 1) {
      const fan = fans[0]

      if (!service.linkedServices) {
        service.linkedServices = {}
      }
      service.linkedServices[fan.iid] = fan
      this.combinedServiceIds.add(fan.uniqueId!)
    }
  }

  private combineRelatedServices() {
    this.combinedServiceIds.clear()

    for (const service of this.accessories.services) {
      if (service.type === 'HeaterCooler') {
        this.attachFanToHeaterCooler(service)
      } else if (service.type === 'HumidifierDehumidifier') {
        this.attachFanToHumidifierDehumidifier(service)
      } else if (service.type === 'LockMechanism') {
        // Here rather than in parseServices, which is where this used to live.
        // parseServices returns early on the very first payload, so the link
        // was never made on load: the long-press modal offered no lock
        // management settings until the lock next changed state, which for a
        // door lock can be hours. And on later payloads it searched the array
        // before the replacement objects were written back, so the mechanism
        // ended up linked to the previous management object — a stale
        // reference that was replaced again on the following event.
        this.attachLockManagementToMechanism(service)
      }
    }

    // Remove combined fan services from rooms
    this.rooms.update(current => current.map(room => ({
      ...room,
      services: room.services.filter(s => !this.combinedServiceIds.has(s.uniqueId!)),
    })))
  }
}

/** The app-wide accessories service (Angular's root `AccessoriesService`). */
export const accessories = new AccessoriesService()

/**
 * Read the accessories state in a component:
 * `useAccessoriesStore(s => s.rooms)`.
 * @param selector - picks what the component needs
 */
export function useAccessoriesStore<T>(selector: (state: AccessoriesState) => T): T {
  return useStore(accessories.store, selector)
}
