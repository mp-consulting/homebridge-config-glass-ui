import type { ReactElement, ReactNode } from 'react'
import type { Placement } from 'react-bootstrap/esm/types'

import { cloneElement, isValidElement } from 'react'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'

export interface HoverTooltipProps {
  text: string
  /** ngbTooltip's `placement`; defaults to `top` (ngb's `auto` tried top first). */
  placement?: Placement
  children: ReactElement
}

type ChildProps = Record<string, unknown> & { children?: ReactNode }

/** Whether any text would be read out of these children (icons have none). */
function hasText(node: ReactNode): boolean {
  if (Array.isArray(node)) {
    return node.some(hasText)
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).trim() !== ''
  }
  if (isValidElement<ChildProps>(node)) {
    // A component may render text we cannot see from here: assume it does
    if (typeof node.type !== 'string') {
      return true
    }
    return node.props['aria-hidden'] !== true && node.props['aria-hidden'] !== 'true' && hasText(node.props.children)
  }
  return false
}

/**
 * The child with the tooltip text as its `aria-label`, when it is a control
 * with no accessible name of its own (an icon-only button): the tooltip is
 * only shown, never announced, so it would otherwise be read as "button".
 * @param child - the element the tooltip is attached to
 * @param text - the tooltip text
 */
function withAccessibleName(child: ReactElement, text: string): ReactElement {
  const props = child.props as ChildProps
  const isControl = child.type === 'button' || child.type === 'a' || typeof props.role === 'string'
  const named = props['aria-label'] || props['aria-labelledby'] || props.title || hasText(props.children)
  // eslint-disable-next-line react/no-clone-element -- the tooltip wraps whatever control it is given, and only adds a missing name
  return isControl && !named ? cloneElement(child as ReactElement<ChildProps>, { 'aria-label': text }) : child
}

/**
 * The `ngbTooltip` the templates used everywhere (`[openDelay]="150"`),
 * rendered as Bootstrap's `.tooltip` markup. It opens on focus as well as
 * hover, so keyboard users get the same hint; the child must be focusable.
 * An icon-only button gets the text as its accessible name too.
 */
export function HoverTooltip({ text, placement, children }: HoverTooltipProps) {
  return (
    <OverlayTrigger placement={placement ?? 'top'} trigger={['hover', 'focus']} delay={{ show: 150, hide: 0 }} overlay={<Tooltip>{text}</Tooltip>}>
      {withAccessibleName(children, text)}
    </OverlayTrigger>
  )
}
