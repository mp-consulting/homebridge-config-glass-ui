import type { AccessoryRoom } from '@/core/accessories/accessories'
import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { ChildBridgeStatusResponse } from '@/core/interfaces/server.interfaces'
import type { AddRoomResult, EditRoomResult } from '@/modules/accessories/modal-data-tokens'
import type { CollisionDetection, DragEndEvent } from '@dnd-kit/core'

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Dropdown } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { accessories, useAccessoriesStore } from '@/core/accessories/accessories'
import { AccessoryTile } from '@/core/accessories/accessory-tile/AccessoryTile'
import { openSmartOrganizer } from '@/core/ai/ai-entry'
import { useAiEnabled } from '@/core/ai/ai.store'
import { useAuthStore } from '@/core/auth/auth.store'
import { escapeHtml } from '@/core/helpers/html.helper'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { openModal } from '@/core/ui/modal'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { ws } from '@/core/ws'
import {
  addRoom as addRoomTo,
  computeAvailableBridges,
  editRoom as editRoomIn,
  moveRoom,
  moveService,
  roomDragId,
  serviceDragId,
  shouldDisplayService,
} from '@/modules/accessories/accessories-page'
import { AccessorySupport } from '@/modules/accessories/accessory-support/AccessorySupport'
import { AddRoom } from '@/modules/accessories/add-room/AddRoom'
import { DragHerePlaceholder } from '@/modules/accessories/drag-here-placeholder/DragHerePlaceholder'
import { EditRoom } from '@/modules/accessories/edit-room/EditRoom'

import './accessories.scss'

/** The wiki link the "must use insecure mode" message embeds: an icon, so it carries its own name. */
function insecureModeLink(label: string): string {
  return `<a href="https://github.com/mp-consulting/homebridge-config-glass-ui/wiki/Enabling-Accessory-Control" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)}"><i class="fas fa-up-right-from-square primary-text" aria-hidden="true"></i></a>`
}

/** Ten invisible boxes that keep the last row of tiles aligned to the grid. */
const PLACEHOLDERS = Array.from({ length: 10 }, (_, i) => i)

const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } }
const TOUCH_SENSOR_OPTIONS = { activationConstraint: { delay: 150, tolerance: 5 } }
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates }

/**
 * Rooms are dragged onto rooms; a tile onto the tile under the pointer, else
 * onto the room under it (it goes to the end), else the nearest tile.
 */
const collisionDetection: CollisionDetection = (args) => {
  const ofType = (type: string) => args.droppableContainers.filter(container => container.data.current?.type === type)
  if (args.active.data.current?.type === 'room') {
    return closestCenter({ ...args, droppableContainers: ofType('room') })
  }
  const onService = pointerWithin({ ...args, droppableContainers: ofType('service') })
  if (onService.length) {
    return onService
  }
  const onRoom = pointerWithin({ ...args, droppableContainers: ofType('room') })
  if (onRoom.length) {
    return onRoom
  }
  return closestCenter({ ...args, droppableContainers: ofType('service') })
}

/**
 * The same ids array while the ids are the same, so a sortable context (and
 * every sortable item under it) does not change on each live update.
 * @param ids - the item ids, in order
 */
function useStableIds(ids: string[]): string[] {
  const key = JSON.stringify(ids)
  return useMemo(() => JSON.parse(key) as string[], [key])
}

/** Memoised, as are the rooms: a live update re-renders only the tile whose service changed. */
const SortableService = memo(({ service, enabled }: { service: ServiceTypeX, enabled: boolean }) => {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: serviceDragId(service),
    data: { type: 'service' },
    disabled: !enabled,
  })

  return (
    <div
      ref={setNodeRef}
      className="accessory-item accessory-tab"
      style={transform ? { transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 10 : undefined } : undefined}
      {...(enabled ? listeners : {})}
    >
      <AccessoryTile service={service} />
    </div>
  )
})
SortableService.displayName = 'SortableService'

interface RoomProps {
  room: AccessoryRoom
  index: number
  layoutLocked: boolean
  manageLayoutMode: boolean
  isVisible: (service: ServiceTypeX) => boolean
  onEdit: (index: number) => void
}

const SortableRoom = memo(({ room, index, layoutLocked, manageLayoutMode, isVisible, onEdit }: RoomProps) => {
  const { t } = useTranslation()
  const serviceIds = useStableIds(room.services.map(serviceDragId))
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition } = useSortable({
    id: roomDragId(room),
    data: { type: 'room' },
    disabled: !manageLayoutMode,
  })

  return (
    <div ref={setNodeRef} style={transform ? { transform: CSS.Translate.toString(transform), transition } : undefined}>
      {(!layoutLocked || room.services.length > 0) && (
        <div className="row">
          <div className="col-md-12 d-flex align-items-center">
            <h5
              ref={setActivatorNodeRef}
              className={layoutLocked ? 'primary-text drag-handle room-title m-0 mb-1 mb-sm-0 flex-grow-1' : 'primary-text drag-handle room-title m-0 mb-1 mb-sm-0 flex-grow-1 cursor-move'}
              {...(manageLayoutMode ? { ...attributes, ...listeners } : {})}
            >
              {room.name}
            </h5>
            <HoverTooltip text={t('accessories.button_edit_room')} placement="bottom">
              <button
                type="button"
                className={layoutLocked ? 'btn btn-elegant ms-2 edit-room-hidden' : 'btn btn-elegant ms-2'}
                aria-label={t('accessories.button_edit_room')}
                onClick={() => onEdit(index)}
              >
                <i className="fas fa-cog" aria-hidden="true"></i>
              </button>
            </HoverTooltip>
          </div>
        </div>
      )}
      <div className="row mb-4">
        {room.services.length > 0 && (
          <SortableContext items={serviceIds} strategy={rectSortingStrategy}>
            <div className="col-md-12 d-flex flex-wrap noselect services-bag">
              {room.services.map(service => (isVisible(service)
                ? <SortableService key={service.uniqueId} service={service} enabled={manageLayoutMode} />
                : null))}
              {!manageLayoutMode && PLACEHOLDERS.map(i => (
                <div key={i} className="accessory-box accessory-box-placeholder no-drag"></div>
              ))}
            </div>
          </SortableContext>
        )}
        {!room.services.length && !layoutLocked && (
          <div className="col-md-12 d-flex flex-wrap noselect">
            <DragHerePlaceholder className="no-drag" />
          </div>
        )}
      </div>
    </div>
  )
})
SortableRoom.displayName = 'SortableRoom'

/** `/accessories`: the accessories, grouped into the user's rooms. */
export function Accessories() {
  const { t } = useTranslation()
  const isAdmin = useAuthStore(state => state.user.admin)
  const aiEnabled = useAiEnabled()
  const env = useSettingsStore(state => state.env)
  const enableAccessories = env.enableAccessories
  const [hasPlugins] = useState(() => env.hasInstalledPlugins ?? true)

  const rooms = useAccessoriesStore(state => state.rooms)
  const availableBridges = useAccessoriesStore(state => state.availableBridges)
  const selectedBridges = useAccessoriesStore(state => state.selectedBridges)

  // The room/tile layout starts locked; toggleLayoutLock opens it for editing
  const [layoutLocked, setLayoutLocked] = useState(true)
  const [hideHidden, setHideHidden] = useState(true)
  const [manageLayoutMode, setManageLayoutMode] = useState(false)
  const [filterOpen, setFilterOpen] = useState<string | null>(null)
  const previousBridgeSelectionRef = useRef<string[] | null>(null)
  // The bridge names live in a Map on the service; this re-renders the
  // filtered tiles when one arrives
  const [bridgeNamesVersion, bumpBridgeNames] = useReducer((version: number) => version + 1, 0)

  const shouldShowFilters = hasPlugins && availableBridges.length > 0
  const isShowingAllBridges = selectedBridges !== null
    && selectedBridges.length === availableBridges.length
    && availableBridges.length > 0
    && !manageLayoutMode

  useEffect(() => {
    settingsActions.setPageTitle(t('menu.label_accessories'))
  }, [t])

  // The session: accessory feed, and the configured bridge names
  useEffect(() => {
    // Initialize selectedBridges if null or empty - default to showing all bridges
    const selected = accessories.selectedBridges()
    if ((selected === null || selected.length === 0) && accessories.availableBridges().length > 0) {
      accessories.selectedBridges.set([...accessories.availableBridges()])
    }

    void accessories.start()

    const bridgeNames = accessories.bridgeUsernameToNameMap

    // Connect to status namespace for main Homebridge instance
    const ioStatus = ws.connectToNamespace('status')
    const offStatusConnected = ioStatus.connected.subscribe(() => {
      ioStatus.socket.emit('monitor-server-status')
    })
    const statusHandler = (data: { username?: string }) => {
      if (data.username) {
        bridgeNames.set(data.username, 'Homebridge')
        bumpBridgeNames()
      }
    }
    ioStatus.socket.on('homebridge-status', statusHandler)

    // Connect to child-bridges namespace for child bridge instances
    const ioChild = ws.connectToNamespace('child-bridges')
    const offChildConnected = ioChild.connected.subscribe(() => {
      ioChild.socket.emit('monitor-child-bridge-status')
      ioChild.request<ChildBridgeStatusResponse[]>('get-homebridge-child-bridge-status').then((data) => {
        data.forEach((bridge) => {
          bridgeNames.set(bridge.username, bridge.name)
        })
        bumpBridgeNames()
      }, () => {})
    })
    const childStatusHandler = (data: ChildBridgeStatusResponse) => {
      bridgeNames.set(data.username, data.name)
      bumpBridgeNames()
    }
    ioChild.socket.on('child-bridge-status-update', childStatusHandler)

    // Update the available bridges whenever the accessories change
    const offAccessoryData = accessories.accessoryData.subscribe(() => {
      const update = computeAvailableBridges(
        accessories.rooms(),
        bridgeNames,
        accessories.availableBridges(),
        accessories.selectedBridges(),
      )
      if (update) {
        accessories.selectedBridges.set(update.selectedBridges)
        accessories.availableBridges.set(update.availableBridges)
      }
    })

    return () => {
      offAccessoryData()
      accessories.stop()
      offStatusConnected()
      offChildConnected()
      // Both namespaces are cached and shared, and `end()` keeps listeners
      ioStatus.socket.off('homebridge-status', statusHandler)
      ioChild.socket.off('child-bridge-status-update', childStatusHandler)
      ioStatus.end()
      ioChild.end()
    }
  }, [])

  const lockLayout = () => setLayoutLocked(true)

  // Stable between live updates, so the memoised rooms skip them. The bridge
  // names are a Map mutated in place: its version re-creates the filter.
  const isVisible = useCallback((service: ServiceTypeX) => shouldDisplayService(service, {
    manageLayoutMode,
    hideHidden,
    selectedBridges,
    bridgeNames: accessories.bridgeUsernameToNameMap,
  // eslint-disable-next-line react/exhaustive-deps
  }), [manageLayoutMode, hideHidden, selectedBridges, bridgeNamesVersion])

  /** Smart organiser: suggested rooms and names, reviewed, then applied to the layout. */
  const organize = async () => {
    const current = accessories.rooms()
    const services = current.flatMap(room => room.services.map(service => ({
      uniqueId: service.uniqueId as string,
      name: service.customName || service.serviceName,
      type: service.humanType,
      manufacturer: service.accessoryInformation?.Manufacturer,
      model: service.accessoryInformation?.Model,
      room: room.name,
    }))).filter(service => service.uniqueId)
    try {
      const changes = await openSmartOrganizer({ accessories: services })
      accessories.applyOrganization(changes)
    } catch {
      // Closed without applying
    }
  }

  const addRoom = async () => {
    const ref = openModal(AddRoom, { existingRooms: accessories.rooms() }, { size: 'lg', backdrop: 'static' })
    try {
      const result: AddRoomResult = await ref.result
      const next = addRoomTo(accessories.rooms(), result)
      if (!next) {
        return
      }
      accessories.rooms.set(next)
      // Save the layout to persist the new room
      accessories.saveLayout()
      // Unlocked, so the new room can be filled
      setLayoutLocked(false)
    } catch {
      // Modal dismissed, do nothing
    }
  }

  const editRoom = useCallback(async (roomIndex: number) => {
    const room = accessories.rooms()[roomIndex]
    if (!room) {
      return
    }
    const ref = openModal(EditRoom, {
      roomName: room.name,
      isDefault: room.isDefault || false,
      existingRooms: accessories.rooms(),
      currentRoomIndex: roomIndex,
    }, { size: 'lg', backdrop: 'static' })
    try {
      const result: EditRoomResult = await ref.result
      const next = editRoomIn(accessories.rooms(), roomIndex, result)
      if (!next) {
        return
      }
      accessories.rooms.set(next)
      accessories.saveLayout()
    } catch {
      // Modal dismissed, do nothing
    }
  }, [])

  const onEditRoom = useCallback((index: number) => {
    void editRoom(index)
  }, [editRoom])

  const openSupport = () => {
    openModal(AccessorySupport, {}, { size: 'lg', backdrop: 'static' })
  }

  const toggleBridge = (bridgeName: string) => {
    // If in manage layout mode, start fresh with just this bridge selected
    if (manageLayoutMode) {
      accessories.selectedBridges.set([bridgeName])
      setManageLayoutMode(false)
      previousBridgeSelectionRef.current = null
      lockLayout()
      return
    }

    const current = accessories.selectedBridges() ?? []
    const index = current.indexOf(bridgeName)
    accessories.selectedBridges.set(index === -1 ? [...current, bridgeName] : current.filter((_, i) => i !== index))
    lockLayout()
  }

  const isBridgeSelected = (bridgeName: string) => !manageLayoutMode && (selectedBridges?.includes(bridgeName) ?? false)

  const clearBridgeFilter = () => {
    // If in manage layout mode, selecting "All Bridges" should select all
    if (manageLayoutMode) {
      accessories.selectedBridges.set([...availableBridges])
      setManageLayoutMode(false)
      previousBridgeSelectionRef.current = null
      lockLayout()
      return
    }

    // All selected → unselect everything; otherwise select all
    accessories.selectedBridges.set(isShowingAllBridges ? [] : [...availableBridges])
    lockLayout()
  }

  const toggleManageLayout = () => {
    if (!manageLayoutMode) {
      // Save current bridge selection, and unlock the layout
      const current = accessories.selectedBridges()
      previousBridgeSelectionRef.current = current ? [...current] : null
      setManageLayoutMode(true)
      setLayoutLocked(false)
    } else {
      // Restore previous bridge selection when toggling off via the button
      const previous = previousBridgeSelectionRef.current
      accessories.selectedBridges.set(previous ? [...previous] : null)
      previousBridgeSelectionRef.current = null
      setManageLayoutMode(false)
      // Lock layout when exiting manage mode
      lockLayout()
    }
  }

  // Dragging is restricted to manage-layout mode, where filters are off and the
  // model and the DOM stay 1-to-1 (#2790)
  // Options hoisted to constants: a new options object makes new sensors, and
  // new sensors re-render every sortable tile on each render of the page
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || !manageLayoutMode) {
      return
    }
    const current = accessories.rooms()
    const next = active.data.current?.type === 'room'
      ? moveRoom(current, String(active.id), String(over.id))
      : moveService(current, String(active.id), String(over.id))
    if (next) {
      accessories.rooms.set(next)
      // Save the room and service layout
      setTimeout(() => accessories.saveLayout())
    }
  }

  const bridgeFilterDropdown = (id: string, showManageLayout: boolean, showTooltip: boolean) => {
    const toggle = (
      <Dropdown.Toggle as="button" type="button" className="btn btn-elegant my-0" aria-label={t('accessories.filter_by_bridge')}>
        <i className="fas fa-house" aria-hidden="true"></i>
      </Dropdown.Toggle>
    )
    return (
      <Dropdown
        autoClose="outside"
        align="end"
        className="d-inline-block me-2"
        show={filterOpen === id}
        onToggle={next => setFilterOpen(next ? id : null)}
      >
        {showTooltip ? <HoverTooltip text={t('accessories.filter_by_bridge')} placement="bottom">{toggle}</HoverTooltip> : toggle}
        <Dropdown.Menu aria-label={t('accessories.filter_by_bridge')}>
          <div className="dropdown-item d-flex justify-content-between align-items-center px-0 bridge-filter-header">
            <Dropdown.Item as="button" type="button" className="flex-grow-1 border-0" active={isShowingAllBridges} onClick={clearBridgeFilter}>
              <span className="bridge-filter-check">
                {isShowingAllBridges && <i className="fas fa-check primary-text" aria-hidden="true"></i>}
              </span>
              {t('accessories.filter_all_bridges')}
            </Dropdown.Item>
            <button
              type="button"
              className="btn btn-sm btn-link text-secondary p-0 pe-2 bridge-close-btn"
              aria-label={t('form.button_close')}
              onClick={() => setFilterOpen(null)}
            >
              <i className="fas fa-times" aria-hidden="true"></i>
            </button>
          </div>
          <div className="dropdown-divider"></div>
          {availableBridges.map(bridge => (
            <Dropdown.Item key={bridge} as="button" type="button" active={isBridgeSelected(bridge)} onClick={() => toggleBridge(bridge)}>
              <span className="bridge-filter-check">
                {isBridgeSelected(bridge) && <i className="fas fa-check primary-text" aria-hidden="true"></i>}
              </span>
              {bridge}
            </Dropdown.Item>
          ))}
          {showManageLayout && (
            <>
              {availableBridges.length > 0 && <div className="dropdown-divider"></div>}
              <Dropdown.Item as="button" type="button" active={manageLayoutMode} onClick={toggleManageLayout}>
                <span className="bridge-filter-check">
                  {manageLayoutMode && <i className="fas fa-check primary-text" aria-hidden="true"></i>}
                </span>
                {t('accessories.manage_layout')}
              </Dropdown.Item>
            </>
          )}
        </Dropdown.Menu>
      </Dropdown>
    )
  }

  const roomIds = useStableIds(rooms.map(roomDragId))

  const supportButton = (
    <button type="button" className="btn btn-elegant my-0 me-0" aria-label={t('support.title')} onClick={openSupport}>
      <i className="far fa-circle-question" aria-hidden="true"></i>
    </button>
  )

  if (!enableAccessories) {
    return (
      <div className="hb-accessories">
        <div className="row">
          <div className="col-12">
            <h3 className="primary-text m-0 mb-3">{t('menu.label_accessories')}</h3>
          </div>
          <div className="col-12 text-center">
            <div className="alert alert-warning p-4" role="alert">
              <div className="text-center mb-3">
                <i className="fas fa-lightbulb primary-text icon-xl" aria-hidden="true"></i>
              </div>
              <h5 className="mb-3 mt-0">{t('accessories.control_disabled')}</h5>
              <SafeHtml as="p" className="mb-0 small" html={t('accessories.message_must_use_insecure_mode', { link: insecureModeLink(t('accessories.link_enabling_control')) })} />
              {/* "the cog icon in the side menu" is behind the hamburger on phones: link straight to Settings too */}
              {isAdmin && (
                <p className="mt-2 mb-0 small">
                  {t('accessories.settings_link')}
                  {' '}
                  <Link to="/settings">{t('accessories.settings_link_open')}</Link>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const hiddenLabel = hideHidden ? t('accessories.button_hidden_show') : t('accessories.button_hidden_hide')

  return (
    <div className="hb-accessories">
      <div className="row mb-3">
        <div className="col-6">
          <h3 className="primary-text m-0">{t('menu.label_accessories')}</h3>
        </div>
        <div className="col-6 text-end d-inline-block d-sm-none">
          {shouldShowFilters && bridgeFilterDropdown('mobile', false, false)}
          {supportButton}
        </div>
        <div className="col-6 text-end d-none d-sm-inline-block">
          {hasPlugins && isAdmin && aiEnabled && rooms.length > 0 && (
            <HoverTooltip text={t('ai.organizer.open')} placement="bottom">
              <button
                type="button"
                className="mp-ai-button my-0 me-2 align-middle hb-ai-organize-button"
                aria-label={t('ai.organizer.open')}
                onClick={() => void organize()}
              >
                <i className="fas fa-wand-magic-sparkles mp-ai-icon" aria-hidden="true"></i>
              </button>
            </HoverTooltip>
          )}
          {hasPlugins && (
            <>
              <HoverTooltip text={t('accessories.button_add_room')} placement="bottom">
                <button
                  type="button"
                  className="btn btn-elegant my-0 me-2"
                  hidden={layoutLocked}
                  aria-label={t('accessories.button_add_room')}
                  onClick={() => void addRoom()}
                >
                  <i className="fas fa-folder-plus" aria-hidden="true"></i>
                </button>
              </HoverTooltip>
              <HoverTooltip text={hiddenLabel} placement="bottom">
                <button
                  type="button"
                  className="btn btn-elegant my-0 me-2"
                  hidden={layoutLocked}
                  aria-label={hiddenLabel}
                  onClick={() => setHideHidden(!hideHidden)}
                >
                  <i className={hideHidden ? 'fas fa-eye-slash' : 'fas fa-eye'} aria-hidden="true"></i>
                </button>
              </HoverTooltip>
            </>
          )}
          {shouldShowFilters && bridgeFilterDropdown('desktop', true, true)}
          {supportButton}
        </div>
      </div>
      {hasPlugins
        ? (
            <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
              <SortableContext items={roomIds} strategy={verticalListSortingStrategy}>
                <div>
                  {rooms.map((room, index) => (
                    <SortableRoom
                      key={room.name}
                      room={room}
                      index={index}
                      layoutLocked={layoutLocked}
                      manageLayoutMode={manageLayoutMode}
                      isVisible={isVisible}
                      onEdit={onEditRoom}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )
        : (
            <div className="col-12 text-center">
              <div className="alert alert-warning p-5" role="alert">
                <div className="text-center mb-3">
                  <i className="fas fa-plug primary-text icon-xl" aria-hidden="true"></i>
                </div>
                <h5 className="mb-3 mt-0">{t('accessories.no_plugins.title')}</h5>
                <p className="mb-0 small">{t('accessories.no_plugins.message_1')}</p>
                <p className="mb-0 small mt-2">{t('accessories.no_plugins.message_2')}</p>
              </div>
            </div>
          )}
    </div>
  )
}
