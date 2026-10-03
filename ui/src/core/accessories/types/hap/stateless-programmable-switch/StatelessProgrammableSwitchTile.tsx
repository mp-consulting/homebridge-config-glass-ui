import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { cx } from '@/core/utilities/cx'

import './stateless-programmable-switch.scss'

/** Display only: lights up the last press (single, double or long). */
export function StatelessProgrammableSwitchTile({ service }: HapTileProps) {
  const { t } = useTranslation()
  const event = service.values?.ProgrammableSwitchEvent

  return (
    <div
      className={cx(
        'accessory-box hb-stateless-programmable-switch',
        event === 0 && 'press-single',
        event === 1 && 'press-double',
        event === 2 && 'press-long',
      )}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.stateless_programmable_switch')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* frame */}
            <rect x="1" y="1" width="30" height="30" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="2" />
            {/* single click */}
            <circle
              className="single"
              cx="8.5"
              cy="9.5"
              r="5"
              stroke="#7f7f7f"
              strokeWidth="1"
              fill="none"
              fillOpacity="0.5"
            />
            {/* double click, outer then inner */}
            <circle
              className="double"
              cx="23.5"
              cy="9.5"
              r="5"
              stroke="#7f7f7f"
              strokeWidth="1"
              fill="none"
              fillOpacity="0.5"
            />
            <circle cx="23.5" cy="9.5" r="3" stroke="#7f7f7f" strokeWidth="1" fill="none" />
            {/* long click */}
            <circle className="long" cx="16" cy="23.5" r="5" stroke="#7f7f7f" strokeWidth="1" fill="none" fillOpacity="0.5" />
            {/* long click lies, left then right */}
            <line x1="5" y1="23.5" x2="11" y2="23.5" stroke="#7f7f7f" strokeWidth="0.5" strokeLinecap="round" />
            <line x1="21" y1="23.5" x2="27" y2="23.5" stroke="#7f7f7f" strokeWidth="0.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text">{t('accessories.control.stateless')}</div>
      </div>
    </div>
  )
}
