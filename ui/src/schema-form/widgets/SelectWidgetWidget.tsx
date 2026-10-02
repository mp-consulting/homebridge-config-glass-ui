import type { WidgetProps } from './context'

/**
 * formworks' SelectWidgetComponent (`<select-widget-widget>`): renders the
 * widget the layout builder picked for the node. Angular inserts it after an
 * empty anchor `<div>`, which is kept for an identical DOM.
 */
export function SelectWidgetWidget({ layoutNode, layoutIndex, dataIndex }: WidgetProps) {
  const Widget = layoutNode?.widget
  return (
    <select-widget-widget>
      <div />
      {typeof Widget === 'function' && <Widget layoutNode={layoutNode} layoutIndex={layoutIndex} dataIndex={dataIndex} />}
    </select-widget-widget>
  )
}
