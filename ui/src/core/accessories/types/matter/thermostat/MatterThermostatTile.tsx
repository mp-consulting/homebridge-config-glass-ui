import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { MatterThermostatManage } from '@/core/accessories/types/matter/lazy-manage'
import { getThermostatLocalTemperature, getThermostatSystemMode, isThermostatOn } from '@/core/accessories/types/matter/matter-device.utils'
import { openManageModal, tileName } from '@/core/accessories/types/matter/matter-tile'
import { convertTemp } from '@/core/pipes/convert-temp'
import { formatDecimal } from '@/core/pipes/decimal'
import { useSettingsStore } from '@/core/settings/settings.store'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

function statusFill(mode: number): string {
  if (mode === 3) {
    return 'url(#coolingGradient)'
  }

  if (mode === 4) {
    return 'url(#heatingGradient)'
  }

  if (mode === 1) {
    return '#42d672'
  }

  return '#7b7b7b'
}

/** The Matter thermostat tile (Angular `MatterThermostatComponent`). */
export function MatterThermostatTile({ service, readyForControl = false }: MatterTileProps) {
  const { t } = useTranslation()
  const temperatureUnits = useSettingsStore(state => state.env.temperatureUnits)

  const mode = getThermostatSystemMode(service)
  const currentTemperature = getThermostatLocalTemperature(service)
  const modeText = mode === 0
    ? t('accessories.control.off')
    : mode === 3
      ? t('accessories.control.cool')
      : mode === 4
        ? t('accessories.control.heat')
        : mode === 1
          ? t('accessories.control.auto')
          : ''

  const srBaseName = (service.customName || service.serviceName || service.displayName || '').trim()
  const srType = t('accessories.core.thermostat')
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  const srText = modeText
    ? `${srBaseName + (includeType ? `, ${srType}` : '')}, ${modeText}`
    : `${srBaseName + (includeType ? `, ${srType}` : '')}`

  // A thermostat has nothing to toggle, so a tap goes straight to the modal
  const onClick = () => {
    if (!readyForControl) {
      return
    }
    openManageModal(MatterThermostatManage, service)
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick: onClick })

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box', isThermostatOn(service) && 'accessory-on', readyForControl && 'cursor-pointer')}
      role="button"
      tabIndex={0}
      aria-label={srText}
    >
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
            <defs>
              <linearGradient id="coolingGradient" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#1e8bbd">
                  <animate attributeName="stop-color" values="#1e8bbd;#66d6d6;#1e8bbd" dur="5s" repeatCount="indefinite" />
                </stop>
                <stop offset="50%" stopColor="#66d6d6">
                  <animate attributeName="stop-color" values="#66d6d6;#1e8bbd;#66d6d6" dur="5s" repeatCount="indefinite" />
                </stop>
                <stop offset="100%" stopColor="#1e8bbd">
                  <animate attributeName="stop-color" values="#1e8bbd;#66d6d6;#1e8bbd" dur="5s" repeatCount="indefinite" />
                </stop>
              </linearGradient>
              <linearGradient id="heatingGradient" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#cc5e00">
                  <animate
                    attributeName="stop-color"
                    values="#cc5e00;#e69533;#cc5e00;#e69533"
                    dur="5s"
                    repeatCount="indefinite"
                  />
                </stop>
                <stop offset="50%" stopColor="#e69533">
                  <animate
                    attributeName="stop-color"
                    values="#e69533;#cc5e00;#e69533;#cc5e00"
                    dur="5s"
                    repeatCount="indefinite"
                  />
                </stop>
                <stop offset="100%" stopColor="#cc5e00">
                  <animate
                    attributeName="stop-color"
                    values="#cc5e00;#e69533;#cc5e00;#e69533"
                    dur="5s"
                    repeatCount="indefinite"
                  />
                </stop>
              </linearGradient>
            </defs>
            {/* outer casing */}
            <rect x="1" y="1" width="30" height="30" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="1.2" />
            {/* status window */}
            <rect
              x="1"
              y="19"
              width="30"
              height="8"
              rx="0"
              stroke="#7f7f7f"
              strokeWidth="0.75"
              fillOpacity="0.5"
              fill={statusFill(mode)}
            />
            {/* current temperature */}
            {currentTemperature !== null && (
              <text x="16" y="13" fontSize="8" textAnchor="middle" fill="#7f7f7f" fontFamily="Arial, sans-serif">
                {formatDecimal(convertTemp(currentTemperature), '1.0-1')}
                &deg;
                {(temperatureUnits ?? '').toUpperCase()}
              </text>
            )}
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">
          {tileName(service)}
        </div>
        <div className="accessory-label grey-text" aria-hidden="true">
          {mode === 0
            ? t('accessories.control.off')
            : mode === 3
              ? t('accessories.control.cool')
              : mode === 4
                ? t('accessories.control.heat')
                : mode === 1
                  ? t('accessories.control.auto')
                  : null}
        </div>
      </div>
    </div>
  )
}
