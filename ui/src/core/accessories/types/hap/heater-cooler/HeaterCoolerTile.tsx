import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'
import type { HeaterCoolerType } from '@/core/accessories/types/hap/heater-cooler/heater-cooler.utils'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ClimateGradientDefs } from '@/core/accessories/types/hap/ClimateGradientDefs'
import { currentConsumption, formatTemp, hasCurrentConsumption, useTemperatureUnits } from '@/core/accessories/types/hap/hap-tile'
import { heaterCoolerStatusFill, toggleActiveOrOn } from '@/core/accessories/types/hap/heater-cooler/heater-cooler.utils'
import { HeaterCoolerManage } from '@/core/accessories/types/hap/heater-cooler/HeaterCoolerManage'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

export interface HeaterCoolerTileProps extends HapTileProps {
  /** Set when the accessory was published as a dedicated heater or cooler. */
  type?: HeaterCoolerType
}

export function HeaterCoolerTile({ service, readyForControl = false, type }: HeaterCoolerTileProps) {
  const { t } = useTranslation()
  const temperatureUnits = useTemperatureUnits()
  const unit = temperatureUnits.toUpperCase()

  // Decided once, as in ngOnInit
  const [{ hasHeating, hasCooling }] = useState(() => ({
    hasHeating: 'HeatingThresholdTemperature' in service.values,
    hasCooling: 'CoolingThresholdTemperature' in service.values,
  }))

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    toggleActiveOrOn(service)
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    if ('TargetHeaterCoolerState' in service.values) {
      openModal(HeaterCoolerManage, { service }, { size: 'md', backdrop: 'static' })
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })
  const values = service.values
  const temp = (value: number | undefined) => `${formatTemp(value, temperatureUnits)}°${unit}`
  const target = (text: string) => (
    <>
      <i className="fa fas fa-bullseye"></i>
      {` ${text}`}
    </>
  )

  let label
  if (('Active' in values && !values?.Active) || ('On' in values && !values?.On)) {
    label = t('accessories.control.off')
  } else if (values?.TargetHeaterCoolerState === 0 && (hasHeating || hasCooling)) {
    if (hasHeating && hasCooling) {
      label = target(`${temp(values?.HeatingThresholdTemperature)} - ${temp(values?.CoolingThresholdTemperature)}`)
    } else if (hasHeating) {
      label = target(temp(values?.HeatingThresholdTemperature))
    } else {
      label = target(temp(values?.CoolingThresholdTemperature))
    }
  } else if (values?.TargetHeaterCoolerState === 1 && hasHeating) {
    label = target(temp(values?.HeatingThresholdTemperature))
  } else if (values?.TargetHeaterCoolerState === 1) {
    label = t('accessories.control.heat')
  } else if (values?.TargetHeaterCoolerState === 2 && hasCooling) {
    label = target(temp(values?.CoolingThresholdTemperature))
  } else if (values?.TargetHeaterCoolerState === 2) {
    label = t('accessories.control.cool')
  } else {
    label = t('accessories.control.on')
  }

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box', (values.Active || values.On) && 'accessory-on', readyForControl && 'cursor-pointer')}
      tabIndex={0}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.heater_cooler')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <ClimateGradientDefs />
            {/* outer casing */}
            <rect x="3.5" y="1" width="25" height="30" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="1.2" />
            {/* grille */}
            {[8, 12, 16, 20, 24].map(x => (
              <line key={x} x1={x} y1="7" x2={x} y2="16" stroke="#7f7f7f" strokeWidth="1.2" strokeLinecap="round" />
            ))}
            {/* status window */}
            <rect
              x="3.5"
              y="4"
              width="25"
              height="15"
              rx="0"
              stroke="#7f7f7f"
              strokeWidth="1.2"
              fillOpacity="0.5"
              fill={heaterCoolerStatusFill(service, type)}
            />
            {/* current temperature */}
            {'CurrentTemperature' in values && (
              <text x="16" y="27.5" fontSize="7" textAnchor="middle" fill="#7f7f7f" fontFamily="Arial, sans-serif">
                {temp(values?.CurrentTemperature)}
              </text>
            )}
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text">
          {label}
          {(values?.Active || values?.On) && hasCurrentConsumption(service) && ` · ${currentConsumption(service)}W`}
        </div>
      </div>
    </div>
  )
}
