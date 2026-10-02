import type { ReactElement } from 'react'
import type { Placement } from 'react-bootstrap/esm/types'

import { OverlayTrigger, Tooltip } from 'react-bootstrap'

export interface HoverTooltipProps {
  text: string
  /** ngbTooltip's `placement`; defaults to `top` (ngb's `auto` tried top first). */
  placement?: Placement
  children: ReactElement
}

/**
 * The `ngbTooltip` the templates used everywhere: `triggers="hover"` and
 * `[openDelay]="150"`, rendered as Bootstrap's `.tooltip` markup.
 */
export function HoverTooltip({ text, placement, children }: HoverTooltipProps) {
  return (
    <OverlayTrigger placement={placement ?? 'top'} trigger={['hover']} delay={{ show: 150, hide: 0 }} overlay={<Tooltip>{text}</Tooltip>}>
      {children}
    </OverlayTrigger>
  )
}
