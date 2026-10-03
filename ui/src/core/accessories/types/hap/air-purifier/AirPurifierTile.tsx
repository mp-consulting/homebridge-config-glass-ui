import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { airPurifierIsOn, airPurifierIsPurifying } from '@/core/accessories/types/hap/air-purifier/air-purifier.utils'
import { currentConsumption, hasCurrentConsumption } from '@/core/accessories/types/hap/hap-tile'
import { toggleActiveOrOn } from '@/core/accessories/types/hap/heater-cooler/heater-cooler.utils'
import { AirPurifierManage } from '@/core/accessories/types/hap/lazy-manage'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './air-purifier.scss'

export function AirPurifierTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()

  // Decided once, as in ngOnInit
  const [hasTargetValidValues] = useState(() => 'TargetAirPurifierState' in service.values
    && service.getCharacteristic!('TargetAirPurifierState').validValues!.length > 0)

  const values = service.values
  const hasPurifierState = 'CurrentAirPurifierState' in values
  const hasSpeed = 'RotationSpeed' in values
  const on = airPurifierIsOn(service)
  const purifying = airPurifierIsPurifying(service)
  const idle = values?.Active && hasPurifierState && values?.CurrentAirPurifierState === 1 && !purifying

  const speedText = hasSpeed ? `${values?.RotationSpeed}%` : ''
  const stateText = purifying
    ? hasSpeed
      ? speedText
      : t('accessories.control.on')
    : idle
      ? t('accessories.control.idle')
      : t('accessories.control.off')

  const srBaseName = (service.customName || service.serviceName || '').trim()
  const srType = t('accessories.core.air_purifier')
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  const srText = `${srBaseName + (includeType ? `, ${srType}` : '')}, ${stateText}`

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
    if (hasTargetValidValues || 'RotationSpeed' in service.values) {
      openModal(AirPurifierManage, { service }, { size: 'md', backdrop: 'static' })
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })
  const line = (x1: number, y1: number, x2: number, y2: number, width = 1.5) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#7f7f7f" strokeWidth={width} strokeLinecap="round" />
  )

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box hb-air-purifier', on && 'accessory-on', purifying && 'purifying', readyForControl && 'cursor-pointer')}
      role="button"
      tabIndex={0}
      aria-label={srText}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onClick()
        } else if (event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
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
            {/* top wave */}
            <path
              d="M3,3.0706147 C3.28945166,3.8007217 5.978098,4.1773883 10.0660175,4.2006147 C12.5085124,4.2144929 18.5053297,1.8514837 22.4060749,1.1943647 C24.1588716,0.898084 26.5955382,1.1756219 28.716875,2.0221772"
              className="air-wave"
              stroke="#7f7f7f"
              fill="transparent"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            {/* bottom wave */}
            <path
              d="M3,9.0706147 C3.28945166,9.8007217 5.978098,10.1773883 10.0660175,10.2006147 C12.5085124,10.2144929 18.5053297,7.8514837 22.4060749,7.1943647 C24.1588716,6.898084 26.5955382,7.1756219 28.716875,8.0221772"
              className="air-wave bottom-line"
              stroke="#7f7f7f"
              fill="transparent"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            {/* back top line */}
            {line(7, 14, 25, 14)}
            {/* back left to front left */}
            {line(7, 14, 2, 23)}
            {/* back right to front right */}
            {line(25, 14, 30, 23)}
            {/* grille lines */}
            {line(8, 16.5, 24, 16.5, 1)}
            {line(7, 18.5, 25, 18.5, 1)}
            {line(6, 20.5, 26, 20.5, 1)}
            {/* front top line */}
            {line(2, 23, 30, 23)}
            {/* side left line */}
            {line(30, 23, 30, 31)}
            {/* side right line */}
            {line(2, 23, 2, 31)}
            {/* power button */}
            <circle cx="15.5" cy="27" r="2.5" stroke="#7f7f7f" strokeWidth="1" fill="#1976d2" fillOpacity="0.5" />
            {/* front bottom line */}
            {line(2, 31, 30, 31)}
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text" aria-hidden="true">
          {stateText}
          {on && hasCurrentConsumption(service) && ` · ${currentConsumption(service)}W`}
        </div>
      </div>
    </div>
  )
}
