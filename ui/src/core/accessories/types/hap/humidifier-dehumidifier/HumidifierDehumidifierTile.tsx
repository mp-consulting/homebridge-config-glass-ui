import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'
import type { HumidifierType } from '@/core/accessories/types/hap/humidifier-dehumidifier/humidifier-dehumidifier.utils'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ClimateGradientDefs } from '@/core/accessories/types/hap/ClimateGradientDefs'
import { consumptionSuffix, currentConsumption, hasCurrentConsumption, tileLabel } from '@/core/accessories/types/hap/hap-tile'
import { toggleActiveOrOn } from '@/core/accessories/types/hap/heater-cooler/heater-cooler.utils'
import { humidifierStatusFill } from '@/core/accessories/types/hap/humidifier-dehumidifier/humidifier-dehumidifier.utils'
import { HumidifierDehumidifierManage } from '@/core/accessories/types/hap/lazy-manage'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

export interface HumidifierDehumidifierTileProps extends HapTileProps {
  /** Set when the accessory was published as a dedicated humidifier or dehumidifier. */
  type?: HumidifierType
}

export function HumidifierDehumidifierTile({ service, readyForControl = false, type }: HumidifierDehumidifierTileProps) {
  const { t } = useTranslation()

  // Decided once, as in ngOnInit
  const [{ hasHumidifier, hasDehumidifier }] = useState(() => ({
    hasHumidifier: 'RelativeHumidityHumidifierThreshold' in service.values,
    hasDehumidifier: 'RelativeHumidityDehumidifierThreshold' in service.values,
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
    if ('TargetHumidifierDehumidifierState' in service.values) {
      openModal(HumidifierDehumidifierManage, { service }, { size: 'md', backdrop: 'static' })
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })
  const values = service.values
  const pct = (value: number | undefined) => `${value}%`
  const target = (text: string) => (
    <>
      <i className="fa fas fa-bullseye"></i>
      {` ${text}`}
    </>
  )

  // The state line: a word, or a target with the bullseye in front of it
  let stateText = ''
  let targetText = ''
  if (('Active' in values && !values?.Active) || ('On' in values && !values?.On)) {
    stateText = t('accessories.control.off')
  } else if (values?.TargetHumidifierDehumidifierState === 0 && (hasHumidifier || hasDehumidifier)) {
    if (hasHumidifier && hasDehumidifier) {
      targetText = `${pct(values?.RelativeHumidityHumidifierThreshold)} - ${pct(values?.RelativeHumidityDehumidifierThreshold)}`
    } else if (hasHumidifier) {
      targetText = pct(values?.RelativeHumidityHumidifierThreshold)
    } else {
      targetText = pct(values?.RelativeHumidityDehumidifierThreshold)
    }
  } else if (values?.TargetHumidifierDehumidifierState === 1 && hasHumidifier) {
    targetText = pct(values?.RelativeHumidityHumidifierThreshold)
  } else if (values?.TargetHumidifierDehumidifierState === 1) {
    stateText = t('accessories.control.humidify')
  } else if (values?.TargetHumidifierDehumidifierState === 2 && hasDehumidifier) {
    targetText = pct(values?.RelativeHumidityDehumidifierThreshold)
  } else if (values?.TargetHumidifierDehumidifierState === 2) {
    stateText = t('accessories.control.dehumidify')
  } else {
    stateText = t('accessories.control.on')
  }

  const label = targetText ? target(targetText) : stateText
  if (targetText) {
    stateText = `${t('accessories.control.target')} ${targetText}`
  }
  const on = !!(values.Active || values.On)
  const srText = tileLabel(
    service.customName || service.serviceName,
    t('accessories.core.humidifier_dehumidifier'),
    on ? stateText + consumptionSuffix(service) : stateText,
  )

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box', (values.Active || values.On) && 'accessory-on', readyForControl && 'cursor-pointer')}
      role="switch"
      tabIndex={0}
      aria-checked={on}
      aria-label={srText}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.humidifier_dehumidifier')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <ClimateGradientDefs coolId="humidifyingGradient" heatId="dehumidifyingGradient" />
            {/* outer casing */}
            <rect x="1" y="3.5" width="30" height="25" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="1.2" />
            {/* grille */}
            {[6, 10, 14, 18, 22, 26].flatMap(x => [10, 12, 14].map(y => (
              <line key={`${x}-${y}`} x1={x} y1={y} x2={x} y2={y} stroke="#7f7f7f" strokeWidth="1.2" strokeLinecap="round" />
            )))}
            {/* status window */}
            <rect
              x="1"
              y="7"
              width="30"
              height="10"
              rx="0"
              stroke="#7f7f7f"
              strokeWidth="1.2"
              fillOpacity="0.5"
              fill={humidifierStatusFill(service, type)}
            />
            {/* current humidity */}
            {'CurrentRelativeHumidity' in values && (
              <text x="16.5" y="25.5" fontSize="7" textAnchor="middle" fill="#7f7f7f" fontFamily="Arial, sans-serif">
                {`${values?.CurrentRelativeHumidity}%`}
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
