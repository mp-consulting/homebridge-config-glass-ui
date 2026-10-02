import type * as React from 'react'
import type { ErrorInfo, ReactNode, Ref } from 'react'
import type { Layout, ResizeHandleAxis } from 'react-grid-layout'

import type { StatusStoreApi } from './status.store'
import type { Widget, WidgetProps } from './widgets/widget.types'

import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { GridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'

import { useSettingsStore } from '@/core/settings'

import { GRID_COLS, GRID_MAX_ROWS, GRID_MOBILE_BREAKPOINT, GRID_ROW_HEIGHT, gridMargin, RESIZE_HANDLES, toGridItem } from './grid'
import { WIDGETS_WITH_SETTINGS } from './widgets/widget.types'
import { widgetRegistry } from './widgets/widgetRegistry'

// Grid items keep gridster's element name: the global styles (widgets.scss,
// dashboard-edit.scss, the themes) select `gridster-item`
declare module 'react' {
  // eslint-disable-next-line ts/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'gridster-item': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}

/** Renders nothing for a widget that fails to load or throws, instead of taking the page down. */
class WidgetErrorBoundary extends Component<{ component: string, children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`Widget ${this.props.component} failed`, error, info.componentStack)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** `app-widgets`: looks the widget up by its saved name and hands it its props. */
function WidgetHost({ store, widget }: { store: StatusStoreApi, widget: Widget }) {
  const component = widget.component
  const WidgetComponent = Object.hasOwn(widgetRegistry, component) ? widgetRegistry[component] : undefined
  const { resizeEvent, configureEvent } = store.getState().eventsFor(component)

  // Completed on destroy, as the Angular host did - only when it built a widget
  const built = !!WidgetComponent
  useEffect(() => () => {
    if (built) {
      store.getState().releaseEvents(component)
    }
  }, [store, component, built])

  const props = useMemo<Omit<WidgetProps, 'widget'>>(() => ({
    resizeEvent,
    configureEvent,
    updateWidget: patch => store.getState().updateWidget(component, patch),
    saveWidgets: patch => store.getState().saveWidgets(component, patch),
  }), [store, component, resizeEvent, configureEvent])

  if (!WidgetComponent) {
    return <div className="d-flex h-100 w-100" />
  }
  return (
    <div className="d-flex h-100 w-100">
      <div style={{ height: '100%', width: '100%', display: 'flex' }}>
        <WidgetErrorBoundary component={component}>
          <Suspense fallback={null}>
            <WidgetComponent widget={widget} {...props} />
          </Suspense>
        </WidgetErrorBoundary>
      </div>
    </div>
  )
}

interface ItemBodyProps {
  store: StatusStoreApi
  widget: Widget
  showSettings: boolean
  isUnlocked: boolean
}

function ItemBody({ store, widget, showSettings, isUnlocked }: ItemBodyProps) {
  return (
    <>
      {isUnlocked && <span className="widget-grip" aria-hidden="true"><i className="fas fa-grip"></i></span>}
      <div className="gridster-item-content">
        {showSettings && (
          <button
            type="button"
            className="widget-control-button"
            aria-label={store.getState().getWidgetSettingsAriaLabel(widget)}
            onClick={() => void store.getState().manageWidget(widget)}
          >
            <i className="fas fa-cog" aria-hidden="true"></i>
          </button>
        )}
      </div>
      <WidgetHost store={store} widget={widget} />
    </>
  )
}

export interface DashboardGridProps {
  store: StatusStoreApi
  hidden: boolean
}

/** The `<gridster>` of the status page. */
export function DashboardGrid({ store, hidden }: DashboardGridProps) {
  useTranslation()
  const dashboard = useStore(store, s => s.dashboard)
  const isUnlocked = useStore(store, s => s.isUnlocked)
  const page = useStore(store, s => s.page)
  const reorderMode = useStore(store, s => s.reorderMode)
  const glassMode = useSettingsStore(s => s.glassMode)
  const margin = gridMargin(glassMode)

  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true })
  const mobile = width < GRID_MOBILE_BREAKPOINT
  const [moving, setMoving] = useState<string | null>(null)
  const [resizing, setResizing] = useState<string | null>(null)

  // gridster called itemResizeCallback for every item whose size changed,
  // which a change of the grid's width does to all of them
  const lastWidthRef = useRef<number | null>(null)
  useEffect(() => {
    if (!mounted) {
      return
    }
    if (lastWidthRef.current !== null && lastWidthRef.current !== width) {
      store.getState().gridResizeEvent()
    }
    lastWidthRef.current = width
  }, [store, width, mounted])

  const showSettingsFor = (widget: Widget) =>
    (isUnlocked || page.showWidgetConfigure)
    && (WIDGETS_WITH_SETTINGS as readonly string[]).includes(widget.component)
    && !reorderMode

  const visible = dashboard.filter(item => !(item.hideOnMobile && page.mobile) && !(item.hideOnDesktop && !page.mobile))
  const layout = useMemo<Layout>(() => visible.map(toGridItem), [visible])

  const className = ['gridster', 'flex-grow-1', 'no-scrollbars', 'py-0', isUnlocked ? 'layout-editing' : '', mounted && mobile ? 'mobile' : '']
    .filter(Boolean)
    .join(' ')

  const handleComponent = (axis: ResizeHandleAxis, ref: Ref<HTMLElement>) => (
    <div ref={ref as Ref<HTMLDivElement>} className={`gridster-item-resizable-handler handle-${axis}`} />
  )

  let content: ReactNode = null
  if (mounted && mobile) {
    // gridster's mobile layout: no grid, every item full width in list order,
    // its height keeping the grid's aspect ratio (overridden per widget in status.scss).
    // gridster used the grid's clientWidth, padding included; `width` here is the content width
    content = visible.map(item => (
      <gridster-item
        key={item.component}
        className="widget-item"
        id={item.component}
        style={{ height: `${(item.rows * (width + 2 * margin)) / item.cols}px`, marginBottom: `${margin}px` }}
      >
        <ItemBody store={store} widget={item} showSettings={showSettingsFor(item)} isUnlocked={isUnlocked} />
      </gridster-item>
    ))
  } else if (mounted) {
    content = (
      <GridLayout
        width={width}
        layout={layout}
        autoSize
        gridConfig={{
          cols: GRID_COLS,
          rowHeight: GRID_ROW_HEIGHT,
          margin: [margin, margin],
          containerPadding: [margin, 0],
          maxRows: GRID_MAX_ROWS,
        }}
        dragConfig={{
          enabled: isUnlocked,
          bounded: false,
          // gridster ignored drags that start in a widget's content
          cancel: '.gridster-item-content',
        }}
        resizeConfig={{
          enabled: isUnlocked,
          handles: RESIZE_HANDLES,
          handleComponent,
        }}
        // Widgets slide up to fill the space a moved or removed widget leaves
        compactor={verticalCompactor}
        onLayoutChange={next => store.getState().applyGridLayout(next, false)}
        onDragStart={(_layout, _old, item) => setMoving(item?.i ?? null)}
        onDragStop={(next) => {
          setMoving(null)
          store.getState().applyGridLayout(next, true)
        }}
        onResizeStart={(_layout, _old, item) => setResizing(item?.i ?? null)}
        onResizeStop={(next, _old, item) => {
          setResizing(null)
          store.getState().applyGridLayout(next, true)
          store.getState().gridResizeEvent(item?.i)
        }}
      >
        {visible.map(item => (
          <gridster-item
            key={item.component}
            className={['widget-item', moving === item.component ? 'gridster-item-moving' : '', resizing === item.component ? 'gridster-item-resizing' : ''].filter(Boolean).join(' ')}
            id={item.component}
          >
            <ItemBody store={store} widget={item} showSettings={showSettingsFor(item)} isUnlocked={isUnlocked} />
          </gridster-item>
        ))}
      </GridLayout>
    )
  }

  return (
    // gridster wrote its padding inline, so the `.row > *` gutter never
    // applied: the outer margin (containerPadding gives it on the desktop
    // grid; the stacked mobile items sit inside it)
    <div ref={containerRef} className={className} hidden={hidden} style={mobile ? { paddingLeft: margin, paddingRight: margin } : { paddingLeft: 0, paddingRight: 0 }}>
      {content}
    </div>
  )
}
