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
 * The `ngbTooltip` the templates used everywhere (`[openDelay]="150"`),
 * rendered as Bootstrap's `.tooltip` markup. It opens on focus as well as
 * hover, so keyboard users get the same hint; the child must be focusable.
 */
export function HoverTooltip({ text, placement, children }: HoverTooltipProps) {
  return (
    <OverlayTrigger placement={placement ?? 'top'} trigger={['hover', 'focus']} delay={{ show: 150, hide: 0 }} overlay={<Tooltip>{text}</Tooltip>}>
      {children}
    </OverlayTrigger>
  )
}
