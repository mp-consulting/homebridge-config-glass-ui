import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { cx } from '@/core/accessories/types/hap/hap-tile'

import './irrigation-system.scss'

/** Display only: the system's valves have their own tiles. */
export function IrrigationSystemTile({ service }: HapTileProps) {
  const { t } = useTranslation()
  const inUse = service.values?.InUse

  return (
    <div className={cx('accessory-box hb-irrigation-system', inUse && 'accessory-on')}>
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.irrigation_system')}>
          <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* water tank */}
            <rect
              x="9"
              y="1"
              width="14"
              height="6.5"
              rx="2"
              fill="#1976d2"
              stroke="#7b7b7b"
              strokeWidth="0.5"
              fillOpacity="0.5"
            />
            {/* vertical pipe */}
            <line className="pipe" x1="16" y1="8" x2="16" y2="31" stroke="#7f7f7f" strokeWidth="1" strokeLinecap="round" />
            {/* horizontal pipes, top to bottom */}
            <line className="pipe" x1="1" y1="9" x2="31" y2="9" stroke="#7f7f7f" strokeWidth="1" strokeLinecap="round" />
            <line className="pipe" x1="1" y1="20" x2="31" y2="20" stroke="#7f7f7f" strokeWidth="1" strokeLinecap="round" />
            <line className="pipe" x1="1" y1="31" x2="31" y2="31" stroke="#7f7f7f" strokeWidth="1" strokeLinecap="round" />
            {/* top left field */}
            <rect
              className="field"
              x="1"
              y="10"
              width="14"
              height="9"
              rx="0"
              fill="#7f7f7f"
              strokeWidth="0"
              fillOpacity="0.5"
            />
            {/* top right field */}
            <rect
              className="field"
              x="17"
              y="10"
              width="14"
              height="9"
              rx="0"
              fill="#7f7f7f"
              strokeWidth="0"
              fillOpacity="0.5"
            />
            {/* bottom left field */}
            <rect
              className="field"
              x="1"
              y="21"
              width="14"
              height="9"
              rx="0"
              fill="#7f7f7f"
              strokeWidth="0"
              fillOpacity="0.5"
            />
            {/* bottom right field */}
            <rect
              className="field"
              x="17"
              y="21"
              width="14"
              height="9"
              rx="0"
              fill="#7f7f7f"
              strokeWidth="0"
              fillOpacity="0.5"
            />
          </svg>
        </div>
        <div className="accessory-label mt-auto">
          {service.customName || service.values?.ConfiguredName || service.serviceName}
        </div>
        <div className="accessory-label grey-text">{t(inUse ? 'accessories.control.running' : 'accessories.control.off')}</div>
      </div>
    </div>
  )
}
