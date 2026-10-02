import type { WidgetProps } from './context'

import { CssFramework } from './CssFramework'

/** @ng-formworks/bootstrap5's Bootstrap5FrameworkComponent */
export function Bootstrap5Framework({ layoutNode, layoutIndex, dataIndex }: WidgetProps) {
  return (
    <bootstrap-5-framework>
      <div>
        <CssFramework layoutNode={layoutNode} layoutIndex={layoutIndex} dataIndex={dataIndex} />
      </div>
    </bootstrap-5-framework>
  )
}
