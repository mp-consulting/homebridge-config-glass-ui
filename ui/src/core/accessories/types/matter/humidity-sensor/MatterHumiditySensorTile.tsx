import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { getHumiditySensorValue } from '@/core/accessories/types/matter/matter-device.utils'
import { sensorSrText } from '@/core/accessories/types/matter/matter-tile'

/** The Matter humidity sensor tile (Angular `MatterHumiditySensorComponent`). */
export function MatterHumiditySensorTile({ service }: MatterTileProps) {
  const { t } = useTranslation()

  const h = getHumiditySensorValue(service)
  const humidityText = h !== null ? `${h}%` : t('accessories.control.no_data')
  const srText = sensorSrText(service, t('accessories.core.humidity_sensor'), humidityText)

  return (
    <div className="accessory-box">
      <span className="visually-hidden">
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
            {/* outer casing */}
            <rect x="3.5" y="1" width="25" height="30" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="1.2" />
            {/* water droplet */}
            <g transform="translate(1.8, -4.3), scale(0.85)">
              <path
                d="M23.61 24.58C23.61 28.67 20.44 31.99 16.56 31.99C12.68 31.99 9.52 28.67 9.52 24.58C9.52 20.49 12.68 17.13 16.56 10.87C20.44 17.13 23.61 20.49 23.61 24.58Z"
                fill="#1976d2"
                fillOpacity="0.4"
                stroke="#7f7f7f"
                strokeWidth="1"
              />
            </g>
            {/* grille horizontal lines */}
            <line strokeLinecap="round" x1="7" y1="26" x2="25" y2="26" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="7" y1="27.5" x2="25" y2="27.5" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="7" y1="29" x2="25" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            {/* grille vertical lines */}
            <line strokeLinecap="round" x1="7" y1="26" x2="7" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="9" y1="26" x2="9" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="11" y1="26" x2="11" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="13" y1="26" x2="13" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="15" y1="26" x2="15" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="17" y1="26" x2="17" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="19" y1="26" x2="19" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="21" y1="26" x2="21" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="23" y1="26" x2="23" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
            <line strokeLinecap="round" x1="25" y1="26" x2="25" y2="29" stroke="#7f7f7f" strokeWidth="0.5" />
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text" aria-hidden="true">
          {humidityText}
        </div>
      </div>
    </div>
  )
}
