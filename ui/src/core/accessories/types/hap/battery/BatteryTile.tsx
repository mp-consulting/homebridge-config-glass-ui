import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { cx } from '@/core/accessories/types/hap/hap-tile'

import './battery.scss'

export function BatteryTile({ service }: HapTileProps) {
  const { t } = useTranslation()
  const values = service.values
  const batteryLevel = values?.BatteryLevel ?? 0
  const isCharging = values?.ChargingState === 1
  const isLow = values?.StatusLowBattery === 1 || batteryLevel === 0

  const chargingText = values?.ChargingState === 0
    ? t('accessories.control.battery_notcharging')
    : values?.ChargingState === 1
      ? t('accessories.control.battery_charging')
      : values?.ChargingState === 2
        ? t('accessories.control.battery_notchargeable')
        : isLow
          ? t('accessories.control.battery_low')
          : t('accessories.control.battery_charged')

  const srBaseName = (service.customName || service.serviceName || '').trim()
  const srType = t('accessories.core.battery')
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  const srText = `${srBaseName + (includeType ? `, ${srType}` : '')}, ${batteryLevel}%, ${chargingText}`

  let label
  if (values?.ChargingState === 0) {
    label = t('accessories.control.battery_notcharging')
  } else if (values?.ChargingState === 1) {
    label = t('accessories.control.battery_charging')
  } else if (values?.ChargingState === 2) {
    label = t('accessories.control.battery_notchargeable')
  } else if (values?.StatusLowBattery === 1 || values?.BatteryLevel === 0) {
    label = <span className="red-text">{t('accessories.control.battery_low')}</span>
  } else {
    label = t('accessories.control.battery_charged')
  }

  return (
    <div className={cx('accessory-box hb-battery', isCharging && 'accessory-on')}>
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
            {/* filler colour */}
            <rect
              x="1"
              y="5"
              height="13"
              rx="2"
              stroke="none"
              strokeWidth="0"
              width={Math.round((29 / 100) * (values?.BatteryLevel || 0))}
              fill={values?.ChargingState === 1 ? '#4caf50' : values?.StatusLowBattery === 1 ? '#e69533' : '#808080'}
              fillOpacity={values?.ChargingState === 1 ? '0.5' : values?.StatusLowBattery === 1 ? '0.5' : '1'}
            />

            {/* battery outline */}
            <rect x="29.5" y="8" width="2" height="7" rx="2" stroke="none" fill="#7f7f7f" strokeWidth="1" />

            {/* battery right spot */}
            <rect x="1" y="5" width="29" height="13" rx="2" stroke="#7f7f7f" fill="none" strokeWidth="0.75" />

            {/* battery level */}
            <text x="16" y="28" fontSize="9" textAnchor="middle" fill="#7f7f7f" fontFamily="Arial, sans-serif">
              {`${values?.BatteryLevel || 0}%`}
            </text>
          </svg>
        </div>

        <div className="accessory-label mt-auto" aria-hidden="true">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text" aria-hidden="true">{label}</div>
      </div>
    </div>
  )
}
