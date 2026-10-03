import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { WidgetProps } from '@/modules/status/widgets/widget.types'
import type { DragEndEvent } from '@dnd-kit/core'

import { closestCenter, DndContext, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { accessories } from '@/core/accessories/accessories'
import { AccessoryTile } from '@/core/accessories/accessory-tile/AccessoryTile'
import { mobileDetect } from '@/core/utilities/mobile-detect'

import { AccessoryPointerSensor } from './accessory-drag'

/** Memoised, so a live update re-renders only the tile whose service changed. */
const SortableAccessory = memo(({ service, disabled }: { service: ServiceTypeX, disabled: boolean }) => {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: service.uniqueId as string, disabled })
  return (
    <div
      ref={setNodeRef}
      className="accessory-item accessory-widget-box noselect"
      style={{ transform: CSS.Translate.toString(transform), transition, zIndex: isDragging ? 1 : undefined }}
      {...listeners}
    >
      <AccessoryTile service={service} />
    </div>
  )
})
SortableAccessory.displayName = 'SortableAccessory'

/**
 * The accessories pinned to the dashboard, in the order the widget stores.
 * @param rooms - the rooms, with every service in them
 * @param accessoryOrder - the saved order (unique ids)
 */
function dashboardAccessoriesOf(rooms: Array<{ services: ServiceTypeX[] }>, accessoryOrder: string[] | undefined): ServiceTypeX[] {
  const dashboardAccessories: ServiceTypeX[] = []

  for (const room of rooms) {
    for (const accessory of room.services) {
      if (accessory.onDashboard) {
        dashboardAccessories.push(accessory)
      }
    }
  }

  if (accessoryOrder && accessoryOrder.length) {
    dashboardAccessories.sort((a, b) => {
      const posA = accessoryOrder.findIndex(s => s === a.uniqueId)
      const posB = accessoryOrder.findIndex(s => s === b.uniqueId)
      if (posA < posB) {
        return -1
      } else if (posA > posB) {
        return 1
      }
      return 0
    })
  }

  return dashboardAccessories
}

export function AccessoriesWidget({ widget, saveWidgets }: WidgetProps) {
  const { t } = useTranslation()
  const [dashboardAccessories, setDashboardAccessories] = useState<ServiceTypeX[]>([])
  const [loaded, setLoaded] = useState(false)
  const [isMobile] = useState(() => !!mobileDetect.detect.mobile())

  const orderRef = useRef(widget.accessoryOrder)
  orderRef.current = widget.accessoryOrder

  useEffect(() => {
    let active = true
    const getDashboardAccessories = () => {
      setDashboardAccessories(dashboardAccessoriesOf(accessories.rooms(), orderRef.current))
      setLoaded(true)
    }

    // Subscribe to accessory data events
    const offData = accessories.accessoryData.subscribe(getDashboardAccessories)
    let offLayout: (() => void) | undefined

    // Start the accessory service, then follow layout saves made elsewhere
    void accessories.start().then(() => {
      if (active) {
        offLayout = accessories.layoutSaved.subscribe(getDashboardAccessories)
      }
    })

    return () => {
      active = false
      offData()
      offLayout?.()
      accessories.stop()
    }
  }, [])

  // Memoised options: a new options object makes new sensors, which re-render
  // every sortable tile on each render of the widget
  const sensorOptions = useMemo(() => ({ activationConstraint: { distance: 5 }, isMobile }), [isMobile])
  const sensors = useSensors(useSensor(AccessoryPointerSensor, sensorOptions))

  // Save the service order onto the widget, which the dashboard persists
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) {
      return
    }
    const from = dashboardAccessories.findIndex(s => s.uniqueId === active.id)
    const to = dashboardAccessories.findIndex(s => s.uniqueId === over.id)
    if (from < 0 || to < 0) {
      return
    }
    const reordered = arrayMove(dashboardAccessories, from, to)
    setDashboardAccessories(reordered)
    saveWidgets({ accessoryOrder: reordered.map(x => x.uniqueId as string) })
  }

  const visible = dashboardAccessories.filter(service => !service.hidden)

  // The same ids array while the ids are the same, so the sortable context
  // (and every tile under it) does not change on each live update
  const visibleIdsKey = JSON.stringify(visible.map(s => s.uniqueId as string))
  const visibleIds = useMemo(() => JSON.parse(visibleIdsKey) as string[], [visibleIdsKey])

  return (
    <div className="flex-column d-flex align-items-stretch h-100 w-100 pb-1 overflow-auto no-scrollbars">
      <div className={`drag-handler p-2${widget.draggable ? ' widget-cursor' : ''}`}>
        {t('menu.label_accessories')}
      </div>
      {dashboardAccessories.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visibleIds} strategy={rectSortingStrategy}>
            <div className="d-flex flex-wrap gridster-item-content">
              {visible.map(service => (
                <SortableAccessory key={service.uniqueId} service={service} disabled={isMobile} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {loaded && !dashboardAccessories.length && (
        <div className="d-flex flex-row flex-grow-1 align-items-center w-100 gridster-item-content text-center">
          <div className="d-flex flex-column w-100 pb-2">
            <h1><i className="fas fa-user-cog"></i></h1>
            <p className="grey-text">{t('status.widget.accessories.choose_accessories')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
