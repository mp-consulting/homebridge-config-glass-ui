import type { Widget, WidgetProps } from './context'

import { useJsfContext } from './context'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'

/**
 * formworks' SelectFrameworkComponent (`<select-framework-widget>`): wraps a
 * layout node in the active framework (Bootstrap 5).
 */
export function SelectFrameworkWidget({ layoutNode, layoutIndex, dataIndex, className }: WidgetProps & { className?: string }) {
  const { jsf } = useJsfContext()
  const Framework = jsf.framework as Widget | null
  return (
    <select-framework-widget className={className}>
      <div />
      {Framework && (
        <WidgetErrorBoundary>
          <Framework layoutNode={layoutNode} layoutIndex={layoutIndex} dataIndex={dataIndex} />
        </WidgetErrorBoundary>
      )}
    </select-framework-widget>
  )
}
