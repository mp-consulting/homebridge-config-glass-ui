import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { getTemperatureSensorValue } from '@/core/accessories/types/matter/matter-device.utils'
import { sensorSrText } from '@/core/accessories/types/matter/matter-tile'
import { convertTemp } from '@/core/pipes/convert-temp'
import { formatDecimal } from '@/core/pipes/decimal'
import { useSettingsStore } from '@/core/settings/settings.store'

/** The Matter temperature sensor tile (Angular `MatterTemperatureSensorComponent`). */
export function MatterTemperatureSensorTile({ service }: MatterTileProps) {
  const { t } = useTranslation()
  const temperatureUnits = useSettingsStore(state => state.env.temperatureUnits)

  const temp = getTemperatureSensorValue(service)
  const tempText = temp !== null
    ? `${formatDecimal(convertTemp(temp), '1.0-1')}°${(temperatureUnits ?? '').toUpperCase()}`
    : t('accessories.control.no_data')
  const srText = sensorSrText(service, t('accessories.core.temperature_sensor'), tempText)

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
            {/* thermometer symbol */}
            <line x1="16" y1="5" x2="16" y2="17" stroke="#7f7f7f" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="16" cy="20" r="3" stroke="#7f7f7f" strokeWidth="1.2" fill="#1976d2" fillOpacity="0.5" />
            {/* left tick marks */}
            <line x1="9" y1="6" x2="13" y2="6" stroke="#7f7f7f" strokeWidth="0.8" />
            <line x1="9" y1="9" x2="13" y2="9" stroke="#7f7f7f" strokeWidth="0.8" />
            <line x1="9" y1="12" x2="13" y2="12" stroke="#7f7f7f" strokeWidth="0.8" />
            <line x1="9" y1="15" x2="13" y2="15" stroke="#7f7f7f" strokeWidth="0.8" />
            {/* right tick marks */}
            <line x1="19" y1="6" x2="23" y2="6" stroke="#7f7f7f" strokeWidth="0.8" />
            <line x1="19" y1="9" x2="23" y2="9" stroke="#7f7f7f" strokeWidth="0.8" />
            <line x1="19" y1="12" x2="23" y2="12" stroke="#7f7f7f" strokeWidth="0.8" />
            <line x1="19" y1="15" x2="23" y2="15" stroke="#7f7f7f" strokeWidth="0.8" />
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
          {tempText}
        </div>
      </div>
    </div>
  )
}
