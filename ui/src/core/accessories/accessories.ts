import type { AccessoryLayout, ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryRoom } from '@/core/accessories/accessory-layout'
import type { IoNamespace } from '@/core/ws'
import type { ServiceType } from '@homebridge/hap-client'
import type { StoreApi } from 'zustand'

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import {
  applyCustomAttributes,
  combineRelatedServices,
  generateHelpers,
  orderRooms,
  parseServices,
  propagateLinkedChanges,
  refreshRoomServices,
  ServiceIndex,
  sortIntoRooms,
} from '@/core/accessories/accessory-grouping'
import { AccessoryInfo } from '@/core/accessories/accessory-info/AccessoryInfo'
import { emptyRoomsFromLayout, ensureDefaultRoom, layoutFromRooms, mergeWithUndiscoveredServices } from '@/core/accessories/accessory-layout'
import { useAuthStore } from '@/core/auth/auth.store'
import { cachedAccessoriesCache } from '@/core/caching/cached-accessories-cache'
import { serverPairingsCache } from '@/core/caching/server-pairings-cache'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { createEmitter } from '@/core/utilities/emitter'
import { toToastMessage } from '@/core/utilities/http-error'
import { ws } from '@/core/ws'

export type { AccessoryRoom }

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

export class AccessoriesService {
  private deps: Required<AccessoriesServiceDeps>
  private accessoryCache: any[] = []
  private pairingCache: any[] = []
  private cachedDataRequested = false
  private customAttributesApplied = new Set<string>()
  private combinedServiceIds = new Set<string>()
  // `accessories.services` indexed by uniqueId (first occurrence), so a live
  // update does not scan the whole list per service.
  private serviceIndex = new ServiceIndex()
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
        propagateLinkedChanges(this.accessories.services, changed)

        // Always order rooms to handle accessories that arrive late (e.g., Matter accessories).
        // Only the rooms that can be out of order are sorted, unless the rooms
        // or the layout were changed from outside since the last pass.
        const orderAll = roomsBefore !== this.lastRoomsSnapshot || this.accessoryLayout !== this.lastOrderedLayout
        const previousChanged = this.lastChangedIds
        this.setRooms(orderRooms(this.rooms(), this.accessoryLayout, orderAll
          ? null
          : room => touchedRooms.has(room.name) || room.services.some(s => changed.has(s.uniqueId) || previousChanged.has(s.uniqueId))))

        // Service objects are replaced, not mutated, so point the rooms at the
        // new references for anything that compares by identity
        this.setRooms(refreshRoomServices(this.rooms(), uniqueId => this.serviceIndex.find(this.accessories.services, uniqueId)))

        // Apply custom attributes after refreshing room references
        // This ensures attributes are applied to the new service objects, not the old ones
        applyCustomAttributes(this.rooms(), this.accessoryLayout, this.customAttributesApplied)

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
    // Generate layout schema from currently active rooms, merged with the
    // undiscovered services of the original layout to preserve their custom
    // information. This adds back rooms that exist in the original layout even
    // if they have no discovered services
    this.accessoryLayout = mergeWithUndiscoveredServices(layoutFromRooms(this.rooms()), this.originalLayout)

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
    ensureDefaultRoom(this.accessoryLayout)

    // Build empty room layout
    this.rooms.set(emptyRoomsFromLayout(this.accessoryLayout))
  }

  /** The position of a service in `accessories.services` (its first occurrence), or -1. */
  private indexOfService(uniqueId: string | undefined): number {
    return this.serviceIndex.indexOf(this.accessories.services, uniqueId)
  }

  /** Set the rooms, unless nothing changed. */
  private setRooms(next: AccessoryRoom[] | null) {
    if (next && next !== this.rooms()) {
      this.rooms.set(next)
    }
  }

  /**
   * Parse the incoming accessory data and refresh existing accessory statuses.
   * Returns the uniqueIds of the services the payload replaced or added.
   */
  private parseServices(services: ServiceTypeX[]): Set<string | undefined> {
    const parsed = parseServices(this.accessories.services, services, this.serviceIndex, this.customAttributesApplied)
    this.accessories.services = parsed.services
    return parsed.changed
  }

  /**
   * Sort the accessories into their rooms. Returns the names of the rooms that
   * received a service.
   */
  private sortIntoRooms(): Set<string> {
    const { rooms, touched } = sortIntoRooms({
      services: this.accessories.services,
      rooms: this.rooms(),
      layout: this.accessoryLayout,
      combined: this.combinedServiceIds,
      customAttributesApplied: this.customAttributesApplied,
    })
    this.setRooms(rooms)
    return touched
  }

  private combineRelatedServices() {
    const { combined, rooms } = combineRelatedServices(this.accessories.services, this.rooms())
    this.combinedServiceIds = combined
    this.setRooms(rooms)
  }

  private generateHelpers(services: ServiceTypeX[]) {
    generateHelpers(services, {
      hapReady: () => this.hapReadyForControl,
      matterReady: () => this.matterReadyForControl,
      send: payload => this.io.socket.emit('accessory-control', payload),
    })
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
