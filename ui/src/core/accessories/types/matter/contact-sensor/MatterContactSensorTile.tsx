import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { getContactSensorState } from '@/core/accessories/types/matter/matter-device.utils'
import { sensorSrText } from '@/core/accessories/types/matter/matter-tile'
import { cx } from '@/core/utilities/cx'

import './contact-sensor.scss'

/** The Matter contact sensor tile (Angular `MatterContactSensorComponent`). */
export function MatterContactSensorTile({ service }: MatterTileProps) {
  const { t } = useTranslation()

  const open = getContactSensorState(service)
  const stateText = open ? t('accessories.control.open') : t('accessories.control.closed')
  const srText = sensorSrText(service, t('accessories.core.contact_sensor'), stateText)

  return (
    <div className={cx('accessory-box hb-matter-contact-sensor', open && 'accessory-on')}>
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {srText}
      </span>
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-hidden="true">
          <svg
            width="32px"
            height="32px"
            viewBox="0 0 32 32"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
            aria-hidden="true"
          >
            {/* left object */}
            <rect
              className="left-object"
              x="1"
              y="1"
              width="15"
              height="30"
              rx="1"
              stroke="#7f7f7f"
              fill="none"
              strokeWidth="1.5"
            />
            {/* right object */}
            <rect
              className="right-object"
              x="16"
              y="1"
              width="15"
              height="30"
              rx="1"
              stroke="#7f7f7f"
              fill="none"
              strokeWidth="1.5"
            />
            {/* left sensor */}
            <rect
              className="left-sensor"
              x="10"
              y="11"
              width="6"
              height="10"
              rx="1"
              stroke="#7f7f7f"
              fill="#4caf50"
              fillOpacity="0.5"
              strokeWidth="0.5"
            />
            {/* right sensor */}
            <rect
              className="right-sensor"
              x="16"
              y="11"
              width="6"
              height="10"
              rx="1"
              stroke="#7f7f7f"
              fill="#4caf50"
              fillOpacity="0.5"
              strokeWidth="0.5"
            />
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">{service.customName || service.serviceName}</div>
        {open
          ? <div className="accessory-label red-text" aria-hidden="true">{t('accessories.control.open')}</div>
          : <div className="accessory-label grey-text" aria-hidden="true">{t('accessories.control.closed')}</div>}
      </div>
    </div>
  )
}
