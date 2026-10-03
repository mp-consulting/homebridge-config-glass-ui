import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { TFunction } from 'i18next'
import type { CSSProperties } from 'react'

/** A tap on a door, window or covering: close it if it is open at all, else open it fully. */
export function togglePosition(service: ServiceTypeX) {
  if (service.values.TargetPosition) {
    void service.getCharacteristic!('TargetPosition').setValue!(0)
  } else {
    void service.getCharacteristic!('TargetPosition').setValue!(100)
  }
}

/** The `--position` (0-1) the tile's CSS animates the icon with. */
export function positionStyle(service: ServiceTypeX): CSSProperties {
  return { '--position': (service.values?.CurrentPosition ?? 0) / 100 } as CSSProperties
}

/**
 * What `PositionLabel` shows, as plain text for a tile's `aria-label`.
 * @param service - the door, window or window covering
 * @param t - the translate function
 */
export function positionStateText(service: ServiceTypeX, t: TFunction): string {
  const pos = service.values?.CurrentPosition
  const posState = service.values?.PositionState
  if (posState === 1) {
    return t('accessories.control.opening')
  }
  if (posState === 0) {
    return t('accessories.control.closing')
  }
  if (pos === 0) {
    return t('accessories.control.closed')
  }
  if (pos === 100) {
    return t('accessories.control.open')
  }
  return typeof pos === 'number' ? `${t('accessories.control.open')} ${pos}%` : ''
}
