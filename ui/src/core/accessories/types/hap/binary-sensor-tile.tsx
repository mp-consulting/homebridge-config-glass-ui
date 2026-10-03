import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { ReactNode } from 'react'

import { useTranslation } from 'react-i18next'

import { cx } from '@/core/utilities/cx'

export interface BinarySensorTileProps {
  service: ServiceTypeX
  /** Whether the sensor is tripped (open, detected…). */
  detected: boolean
  /** The root class (`hb-contact-sensor`, …), for the component styles. */
  className: string
  /** The sensor type, as a translation key, for the screen reader text. */
  typeKey: string
  onKey?: string
  offKey?: string
  children: ReactNode
}

/**
 * The contact, leak, motion, occupancy, smoke, carbon monoxide and carbon
 * dioxide tiles: display only, one boolean each, and a status line a screen
 * reader announces when it changes. Seven identical templates in Angular,
 * apart from the icon and the characteristic.
 */
export function BinarySensorTile({
  service,
  detected,
  className,
  typeKey,
  onKey = 'accessories.control.detected',
  offKey = 'accessories.control.not_detected',
  children,
}: BinarySensorTileProps) {
  const { t } = useTranslation()

  const stateText = detected ? t(onKey) : t(offKey)
  const srBaseName = (service.customName || service.serviceName || '').trim()
  const srType = t(typeKey)
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  const srText = `${srBaseName + (includeType ? `, ${srType}` : '')}, ${stateText}`

  return (
    <div className={cx('accessory-box', className, detected && 'accessory-on')}>
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {srText}
      </span>
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-hidden="true">
          {children}
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">{service.customName || service.serviceName}</div>
        {detected
          ? <div className="accessory-label red-text" aria-hidden="true">{t(onKey)}</div>
          : <div className="accessory-label grey-text" aria-hidden="true">{t(offKey)}</div>}
      </div>
    </div>
  )
}
