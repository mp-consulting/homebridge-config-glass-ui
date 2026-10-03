import type { CSSProperties } from 'react'

import { cx } from '@/core/utilities/cx'

import { useJsfContext } from './context'
import { layoutKey } from './keys'
import { SelectFrameworkWidget } from './SelectFrameworkWidget'

export interface RootWidgetProps {
  layout: any[]
  dataIndex?: number[]
  layoutIndex?: number[]
  isOrderable?: boolean
  isFlexItem?: boolean
  /** Host bindings set by the parent section (`[class.x]`, `[style.x]`) */
  className?: string
  style?: CSSProperties
  id?: string
}

function getFlexAttribute(node: any, attribute: string) {
  const index = ['flex-grow', 'flex-shrink', 'flex-basis'].indexOf(attribute)
  return ((node.options || {}).flex || '').split(/\s+/)[index]
    || (node.options || {})[attribute] || ['1', '1', 'auto'][index]
}

/**
 * formworks' RootComponent (`<root-widget>`): renders a list of layout nodes,
 * skipping the ones whose `condition` is false.
 *
 * Items are draggable in Angular (cdk drag & drop) when they are list array
 * items. TODO(dnd-kit): reordering is not implemented yet; `jsf.moveArrayItem`
 * is the engine call a drag-and-drop or keyboard reorder should make.
 */
export function RootWidget({ layout, dataIndex, layoutIndex, isOrderable, isFlexItem = false, className, style, id }: RootWidgetProps) {
  const { jsf } = useJsfContext()

  const isDraggable = (node: any) => node.arrayItem && node.type !== '$ref'
    && node.arrayItemType === 'list' && isOrderable !== false
    && node.type !== 'submit'

  return (
    <root-widget className={className} style={style} id={id}>
      <div className="cdk-drop-list flex-inherit">
        {(layout || []).map((layoutItem: any, i: number) => {
          const itemDataIndex = layoutItem?.arrayItem ? [...(dataIndex || []), i] : (dataIndex || [])
          const itemLayoutIndex = [...(layoutIndex || []), i]
          const draggable = isDraggable(layoutItem)
          return (
            <div
              key={layoutKey(layoutItem)}
              className={cx('cdk-drag', { 'cdk-drag-disabled': !draggable, 'form-flex-item': isFlexItem })}
              style={{
                alignSelf: (layoutItem.options || {})['align-self'],
                flexBasis: getFlexAttribute(layoutItem, 'flex-basis'),
                flexGrow: getFlexAttribute(layoutItem, 'flex-grow'),
                flexShrink: getFlexAttribute(layoutItem, 'flex-shrink'),
                order: (layoutItem.options || {}).order,
              }}
            >
              {jsf.evaluateCondition(layoutItem, dataIndex) && (
                <SelectFrameworkWidget
                  layoutNode={layoutItem}
                  layoutIndex={itemLayoutIndex}
                  dataIndex={itemDataIndex}
                />
              )}
            </div>
          )
        })}
      </div>
    </root-widget>
  )
}
