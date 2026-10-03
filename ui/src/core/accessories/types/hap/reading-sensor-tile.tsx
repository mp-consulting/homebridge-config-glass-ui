import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { ReactNode } from 'react'

import { useTranslation } from 'react-i18next'

/**
 * The humidity, light and temperature tiles: display only, one reading, and a
 * status line a screen reader announces when it changes.
 */
export function ReadingSensorTile({ service, typeKey, reading, children }: {
  service: ServiceTypeX
  /** The sensor type, as a translation key, for the screen reader text. */
  typeKey: string
  /** The formatted reading, or undefined when the sensor reports none. */
  reading: string | undefined
  children: ReactNode
}) {
  const { t } = useTranslation()
  const text = reading ?? t('accessories.control.no_data')

  const srBaseName = (service.customName || service.serviceName || '').trim()
  const srType = t(typeKey)
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  const srText = `${srBaseName + (includeType ? `, ${srType}` : '')}, ${text}`

  return (
    <div className="accessory-box">
      <span className="visually-hidden">
        {srText}
      </span>
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-hidden="true">
          {children}
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text" aria-hidden="true">{text}</div>
      </div>
    </div>
  )
}
