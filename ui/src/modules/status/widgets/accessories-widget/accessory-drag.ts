import type { PointerSensorOptions } from '@dnd-kit/core'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { PointerSensor } from '@dnd-kit/core'

/**
 * Whether a press may start dragging a tile: not on a phone (a drag on a touch
 * screen is indistinguishable from a scroll), and not from inside a `.no-drag`
 * element.
 * @param target - where the press landed
 * @param isMobile - whether this is a phone
 */
export function canStartDrag(target: EventTarget | null, isMobile: boolean): boolean {
  if (isMobile) {
    return false
  }
  return !(target instanceof Element && target.closest('.no-drag'))
}

/** dnd-kit's pointer sensor, with the dragula `moves` rule of the Angular widget. */
export class AccessoryPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: ReactPointerEvent, { isMobile }: PointerSensorOptions & { isMobile?: boolean }) => {
        // Only the primary button, like the stock pointer sensor
        if (!nativeEvent.isPrimary || nativeEvent.button !== 0) {
          return false
        }
        return canStartDrag(nativeEvent.target, !!isMobile)
      },
    },
  ]
}
