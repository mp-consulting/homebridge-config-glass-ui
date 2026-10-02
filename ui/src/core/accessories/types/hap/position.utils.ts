import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
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
