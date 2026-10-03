import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { ClimateGradientDefs } from '@/core/accessories/types/hap/ClimateGradientDefs'
import { formatTemp, tileLabel, useTemperatureUnits } from '@/core/accessories/types/hap/hap-tile'
import { ThermostatManage } from '@/core/accessories/types/hap/lazy-manage'
import { thermostatStatusFill } from '@/core/accessories/types/hap/thermostat/thermostat.utils'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

export function ThermostatTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const temperatureUnits = useTemperatureUnits()
  const values = service.values

  // A thermostat has nothing to toggle, so a tap opens the modal too
  const onClick = () => {
    if (!readyForControl) {
      return
    }
    openModal(ThermostatManage, { service }, { size: 'md', backdrop: 'static' })
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick: onClick })

  const unit = `°${temperatureUnits.toUpperCase()}`
  let stateText = ''
  if (values?.TargetHeatingCoolingState === 0) {
    stateText = t('accessories.control.off')
  } else if (values?.CurrentHeatingCoolingState === 1) {
    stateText = t('accessories.control.heat')
  } else if (values?.CurrentHeatingCoolingState === 2) {
    stateText = t('accessories.control.cool')
  } else if (values?.TargetHeatingCoolingState === 3) {
    stateText = `${t('accessories.control.target')} ${formatTemp(values?.TargetTemperature, temperatureUnits)}${unit}`
  }
  const srText = tileLabel(
    service.customName || service.serviceName,
    t('accessories.core.thermostat'),
    [
      'CurrentTemperature' in values && `${formatTemp(values?.CurrentTemperature, temperatureUnits)}${unit}`,
      stateText,
    ].filter(Boolean).join(', '),
  )

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box', values?.TargetHeatingCoolingState > 0 && 'accessory-on', readyForControl && 'cursor-pointer')}
      role="button"
      tabIndex={0}
      aria-label={srText}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.thermostat')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <ClimateGradientDefs />
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
              fill={thermostatStatusFill(service)}
            />
            {/* current temperature */}
            {'CurrentTemperature' in values && (
              <text x="16" y="13" fontSize="8" textAnchor="middle" fill="#7f7f7f" fontFamily="Arial, sans-serif">
                {`${formatTemp(values?.CurrentTemperature, temperatureUnits)}°${temperatureUnits.toUpperCase()}`}
              </text>
            )}
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>

        <div className="accessory-label grey-text">
          {values?.TargetHeatingCoolingState === 0
            ? t('accessories.control.off')
            : values?.CurrentHeatingCoolingState === 1
              ? t('accessories.control.heat')
              : values?.CurrentHeatingCoolingState === 2
                ? t('accessories.control.cool')
                : values?.TargetHeatingCoolingState === 3 && (
                  <>
                    <i className="fa fas fa-bullseye"></i>
                    {` ${formatTemp(values?.TargetTemperature, temperatureUnits)}°${temperatureUnits.toUpperCase()}`}
                  </>
                )}
        </div>
      </div>
    </div>
  )
}
