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
import { createEmitter } from '@/core/utilities/emitter'
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

/**
 * Fields the client writes onto a service after it arrives (control helpers,
 * the saved layout's custom attributes, the links to sibling services). They
 * are not part of the payload, so they are left out of the comparison.
 */
const CLIENT_SERVICE_FIELDS = new Set(['getCharacteristic', 'getCluster', 'linkedServices', 'customName', 'customType', 'hidden', 'onDashboard'])

/** Structural equality of payload data; function-valued fields (helpers such as `setValue`) are ignored. */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false
  }
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((value, index) => sameData(value, other[index]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = (record: Record<string, unknown>) => Object.keys(record).filter(key => typeof record[key] !== 'function')
  const leftKeys = keys(left)
  const rightKeys = keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.hasOwn(right, key) && sameData(left[key], right[key]))
}

/**
 * Whether an incoming service carries the same data as the object already
 * held for it. The client-written fields are ignored on the existing object;
 * `hidden` (also a HAP field) is compared when the payload sends it.
 */
function sameServiceData(existing: ServiceTypeX, incoming: ServiceTypeX): boolean {
  const current = existing as unknown as Record<string, unknown>
  const next = incoming as unknown as Record<string, unknown>
  for (const key of Object.keys(next)) {
    if (typeof next[key] === 'function') {
      continue
    }
    if (!sameData(current[key], next[key])) {
      return false
    }
  }
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(next, key) && !CLIENT_SERVICE_FIELDS.has(key) && typeof current[key] !== 'function') {
      return false
    }
  }
  return true
}

export class AccessoriesService {
  private deps: Required<AccessoriesServiceDeps>
  private accessoryCache: any[] = []
  private pairingCache: any[] = []
  private cachedDataRequested = false
  private customAttributesApplied = new Set<string>()
  private combinedServiceIds = new Set<string>()
  // `accessories.services` indexed by uniqueId (first occurrence), so a live
  // update does not scan the whole list per service. See `indexOfService()`.
  private serviceIndex = new Map<string | undefined, number>()
  private indexedServices: ServiceTypeX[] | null = null
  // What the last `accessories-data` pass left behind: the rooms it set, the
  // layout it ordered them by, and the services it replaced. While neither the
  // rooms nor the layout changed since, only the rooms that gained or replaced
  // a service can be out of order, so the others are not re-sorted.
  private lastRoomsSnapshot: AccessoryRoom[] | null = null
  private lastOrderedLayout: AccessoryLayout | null = null
  private lastChangedIds = new Set<string | undefined>()
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

  public layoutSaved = createEmitter()
  public accessoryData = createEmitter<unknown>()
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
      const flatIndex = this.indexOfService(updated.uniqueId)
      if (flatIndex !== -1) {
        this.accessories.services[flatIndex] = updated
      }

      // Only the rooms holding the service get new objects
      this.rooms.update(rooms => rooms.map(room => (room.services.some(s => s.uniqueId === updated.uniqueId)
        ? { ...room, services: room.services.map(s => (s.uniqueId === updated.uniqueId ? updated : s)) }
        : room)))

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
    this.serviceIndex.clear()
    this.indexedServices = null
    this.lastRoomsSnapshot = null
    this.lastOrderedLayout = null
    this.lastChangedIds = new Set()
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
        // One event per characteristic change: everything below touches only
        // the services in the payload (and the rooms holding them), so the
        // rooms and services nothing changed in keep their references and
        // their memoised tiles do not re-render.
        const roomsBefore = this.rooms()
        const changed = this.parseServices(data as ServiceTypeX[])
        this.combineRelatedServices()
        this.generateHelpers(data as ServiceTypeX[])
        const touchedRooms = this.sortIntoRooms()
        this.propagateLinkedChanges(changed)

        // Always order rooms to handle accessories that arrive late (e.g., Matter accessories).
        // Only the rooms that can be out of order are sorted, unless the rooms
        // or the layout were changed from outside since the last pass.
        const orderAll = roomsBefore !== this.lastRoomsSnapshot || this.accessoryLayout !== this.lastOrderedLayout
        const previousChanged = this.lastChangedIds
        this.orderRooms(orderAll
          ? null
          : room => touchedRooms.has(room.name) || room.services.some(s => changed.has(s.uniqueId) || previousChanged.has(s.uniqueId)))

        // Service objects are replaced, not mutated, so point the rooms at the
        // new references for anything that compares by identity
        this.refreshRoomsForChangeDetection()

        // Apply custom attributes after refreshing room references
        // This ensures attributes are applied to the new service objects, not the old ones
        this.applyCustomAttributes()

        this.lastRoomsSnapshot = this.rooms()
        this.lastOrderedLayout = this.accessoryLayout
        this.lastChangedIds = changed

        this.accessoryData.emit(data)
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
            this.layoutSaved.emit()
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
   * The position of a service in `accessories.services` (its first occurrence),
   * or -1. Served from an index by uniqueId, rebuilt when the list was replaced
   * or changed from outside (specs and the manage modals swap it).
   */
  private indexOfService(uniqueId: string | undefined): number {
    const list = this.accessories.services
    const index = this.indexedServices === list ? this.serviceIndex.get(uniqueId) : undefined
    if (index !== undefined && list[index]?.uniqueId === uniqueId) {
      return index
    }
    if (index === undefined && this.indexedServices === list && this.serviceIndex.size === list.length) {
      return -1
    }
    this.reindexServices()
    return this.serviceIndex.get(uniqueId) ?? -1
  }

  private reindexServices() {
    const list = this.accessories.services
    this.serviceIndex = new Map()
    list.forEach((service, index) => {
      if (!this.serviceIndex.has(service.uniqueId)) {
        this.serviceIndex.set(service.uniqueId, index)
      }
    })
    this.indexedServices = list
  }

  /** The current object for a uniqueId, or undefined. */
  private currentService(uniqueId: string | undefined): ServiceTypeX | undefined {
    const index = this.indexOfService(uniqueId)
    return index === -1 ? undefined : this.accessories.services[index]
  }

  /** Set the rooms, unless nothing changed. */
  private setRooms(next: AccessoryRoom[]) {
    if (next !== this.rooms()) {
      this.rooms.set(next)
    }
  }

  /**
   * Parse the incoming accessory data and refresh existing accessory statuses.
   * Returns the uniqueIds of the services the payload replaced or added.
   */
  private parseServices(services: ServiceTypeX[]): Set<string | undefined> {
    if (!this.accessories.services.length) {
      this.accessories.services = services
      this.reindexServices()
      return new Set<string | undefined>(services.map(service => service.uniqueId))
    }

    const changed = new Set<string | undefined>()

    // Replace existing objects instead of mutating them
    services.forEach((service) => {
      const existingIndex = this.indexOfService(service.uniqueId)

      if (existingIndex !== -1) {
        // A full payload repeats every service: one whose data did not change
        // keeps its object, so the memoised tiles showing it do not re-render
        if (sameServiceData(this.accessories.services[existingIndex], service)) {
          return
        }
        changed.add(service.uniqueId)
        // Replace the object instead of mutating it
        this.accessories.services[existingIndex] = service
        // Clear from customAttributesApplied Set so attributes get re-applied to the new object
        this.customAttributesApplied.delete(service.uniqueId!)
      } else {
        changed.add(service.uniqueId)
        this.accessories.services.push(service)
        if (this.indexedServices === this.accessories.services && this.serviceIndex.size === this.accessories.services.length - 1) {
          this.serviceIndex.set(service.uniqueId, this.accessories.services.length - 1)
        } else {
          this.reindexServices()
        }
      }
    })

    return changed
  }

  /**
   * Sort the accessories into their rooms. Returns the names of the rooms that
   * received a service.
   */
  private sortIntoRooms(): Set<string> {
    const touched = new Set<string>()

    // The rooms are copied on write: only a room that receives a service gets
    // a new object, so the others keep their references
    let working: AccessoryRoom[] | null = null
    const copied = new Set<number>()
    const rooms = () => working ?? this.rooms()
    const addTo = (name: string, service: ServiceTypeX): boolean => {
      const current = rooms()
      let added = false
      current.forEach((room, index) => {
        if (room.name !== name) {
          return
        }
        working ??= [...current]
        if (!copied.has(index)) {
          working[index] = { ...room, services: [...room.services] }
          copied.add(index)
        }
        working[index].services.push(service)
        touched.add(name)
        added = true
      })
      return added
    }

    // The uniqueIds already allocated to an active room
    const inRooms = new Set<string | undefined>()
    for (const room of this.rooms()) {
      for (const service of room.services) {
        inRooms.add(service.uniqueId)
      }
    }

    // Services by bridge, aid and iid (first occurrence), for the links
    let byAddress: Map<string, ServiceTypeX> | null = null
    const addressOf = (username: string | undefined, aid: number, iid: number) => `${username}\u0000${aid}\u0000${iid}`

    this.accessories.services.forEach((service) => {
      // Don't put hidden types or combined services into rooms
      // Matter services use deviceType instead of type
      if (this.hiddenTypes.has(service.type) || this.hiddenTypes.has(service.deviceType!) || this.combinedServiceIds.has(service.uniqueId!)) {
        return
      }

      // Link services
      if (service.linked) {
        if (!byAddress) {
          byAddress = new Map()
          for (const s of this.accessories.services) {
            const key = addressOf(s.instance?.username, s.aid, s.iid)
            if (!byAddress.has(key)) {
              byAddress.set(key, s)
            }
          }
        }
        const lookup = byAddress
        service.linkedServices = {}
        service.linked.forEach((iid) => {
          service.linkedServices![iid] = lookup.get(addressOf(service.instance?.username, service.aid, iid))!
        })
      }

      // Check if the service has already been allocated to an active room
      if (inRooms.has(service.uniqueId)) {
        return
      }

      // Not in an active room, perhaps the service is in the layout cache
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
        if (addTo(cached.room.name, service)) {
          inRooms.add(service.uniqueId)
        }
      } else {
        // Mark as processed (even though no custom attributes to apply)
        this.customAttributesApplied.add(service.uniqueId!)

        // New accessory add to the default room
        const defaultRoom = rooms().find(r => r.isDefault === true)
          || rooms().find(r => r.name === 'Default Room')

        if (defaultRoom) {
          addTo(defaultRoom.name, service)
        } else {
          working = [...rooms(), {
            name: 'Default Room',
            isDefault: true,
            services: [service],
          }]
          copied.add(working.length - 1)
          touched.add('Default Room')
        }
        // The default room always exists by name, so it was added
        inRooms.add(service.uniqueId)
      }
    })

    if (working) {
      this.setRooms(working)
    }
    return touched
  }

  /**
   * A tile reads its linked services (a television's inputs, a heater-cooler's
   * fan, a lock's management), but those links are written onto the parent in
   * place. So that a memoised tile still sees a linked service change, a parent
   * whose linked service was replaced is replaced by a copy too.
   */
  private propagateLinkedChanges(changed: Set<string | undefined>) {
    const list = this.accessories.services
    let grew = true
    while (grew) {
      grew = false
      list.forEach((service, index) => {
        if (!service.linkedServices || changed.has(service.uniqueId)) {
          return
        }
        const linkedChanged = Object.values(service.linkedServices).some(linked => linked && changed.has(linked.uniqueId))
        if (linkedChanged) {
          list[index] = { ...service } as ServiceTypeX
          changed.add(service.uniqueId)
          grew = true
        }
      })
    }
  }

  /**
   * Order the services within each room based on the cached layout positions.
   * @param only - which rooms to order; all of them when null
   */
  private orderRooms(only: ((room: AccessoryRoom) => boolean) | null) {
    const current = this.rooms()
    let next: AccessoryRoom[] | null = null
    current.forEach((room, index) => {
      if (only && !only(room)) {
        return
      }
      const roomCache = this.accessoryLayout.find(r => r.name === room.name)
      if (!roomCache) {
        return
      }

      // Each service's position is looked up once, not once per comparison
      const positions = new Map<ServiceTypeX, number>()
      for (const service of room.services) {
        if (!positions.has(service)) {
          positions.set(service, roomCache.services.findIndex(s => this.servicesMatch(s, service)))
        }
      }
      const sortedServices = room.services.toSorted((a, b) => positions.get(a)! - positions.get(b)!)
      if (sortedServices.every((service, i) => service === room.services[i])) {
        return
      }
      next ??= [...current]
      next[index] = { ...room, services: sortedServices }
    })
    if (next) {
      this.setRooms(next)
    }
  }

  /**
   * Refresh rooms to use updated service references.
   * After parseServices() replaces service objects, we need to update the rooms
   * to point to the new service references from this.accessories.services.
   * A room none of whose services were replaced keeps its reference.
   */
  private refreshRoomsForChangeDetection() {
    const current = this.rooms()
    let changedRooms = false
    const next = current.map((room) => {
      let services: ServiceTypeX[] | null = null
      room.services.forEach((service, index) => {
        // Find the updated service from the main accessories array
        const updatedService = this.currentService(service.uniqueId)
        if (updatedService && updatedService !== service) {
          services ??= [...room.services]
          services[index] = updatedService
        }
      })
      if (!services) {
        return room
      }
      changedRooms = true
      return { ...room, services }
    })
    if (changedRooms) {
      this.setRooms(next)
    }
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
   * Generate helpers for accessory control on the services of a payload (the
   * others got theirs when they arrived, and copies carry them over)
   */
  private generateHelpers(services: ServiceTypeX[]) {
    services.forEach((service) => {
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
   * The key two services of the same physical accessory share
   * (same name, serial number, and bridge instance)
   */
  private accessoryKey(service: ServiceType): string {
    return JSON.stringify([
      service.accessoryInformation?.Name,
      service.accessoryInformation?.['Serial Number'],
      service.instance?.username,
    ])
  }

  private attachLockManagementToMechanism(service: ServiceType, sameAccessory: ServiceType[]) {
    const lockMechanisms: ServiceType[] = []
    const lockManagements: ServiceType[] = []

    for (const serv of sameAccessory) {
      if (serv.type === 'LockMechanism') {
        lockMechanisms.push(serv)
      } else if (serv.type === 'LockManagement') {
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

  /** Link the one fan of an accessory that has exactly one `parentType` service, and hide the fan's own tile. */
  private attachFanTo(service: ServiceType, parentType: string, sameAccessory: ServiceType[]) {
    const parents: ServiceType[] = []
    const fans: ServiceType[] = []

    for (const serv of sameAccessory) {
      if (serv.type === parentType) {
        parents.push(serv)
      } else if (serv.type === 'Fan' || serv.type === 'Fanv2') {
        fans.push(serv)
      }
    }

    if (parents.length === 1 && fans.length === 1) {
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

    // The services of each physical accessory, in list order - built only when
    // there is something to combine
    let byAccessory: Map<string, ServiceType[]> | null = null
    const sameAccessoryAs = (service: ServiceType): ServiceType[] => {
      if (!byAccessory) {
        byAccessory = new Map()
        for (const serv of this.accessories.services) {
          const key = this.accessoryKey(serv)
          const group = byAccessory.get(key)
          if (group) {
            group.push(serv)
          } else {
            byAccessory.set(key, [serv])
          }
        }
      }
      return byAccessory.get(this.accessoryKey(service)) ?? []
    }

    for (const service of this.accessories.services) {
      if (service.type === 'HeaterCooler') {
        this.attachFanTo(service, 'HeaterCooler', sameAccessoryAs(service))
      } else if (service.type === 'HumidifierDehumidifier') {
        this.attachFanTo(service, 'HumidifierDehumidifier', sameAccessoryAs(service))
      } else if (service.type === 'LockMechanism') {
        // Here rather than in parseServices, which is where this used to live.
        // parseServices returns early on the very first payload, so the link
        // was never made on load: the long-press modal offered no lock
        // management settings until the lock next changed state, which for a
        // door lock can be hours. And on later payloads it searched the array
        // before the replacement objects were written back, so the mechanism
        // ended up linked to the previous management object — a stale
        // reference that was replaced again on the following event.
        this.attachLockManagementToMechanism(service, sameAccessoryAs(service))
      }
    }

    // Remove combined fan services from rooms; the other rooms keep their references
    if (this.combinedServiceIds.size) {
      const current = this.rooms()
      let removed = false
      const next = current.map((room) => {
        if (!room.services.some(s => this.combinedServiceIds.has(s.uniqueId!))) {
          return room
        }
        removed = true
        return { ...room, services: room.services.filter(s => !this.combinedServiceIds.has(s.uniqueId!)) }
      })
      if (removed) {
        this.setRooms(next)
      }
    }
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
