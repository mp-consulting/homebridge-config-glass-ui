import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { tileLabel } from '@/core/accessories/types/hap/hap-tile'

/** Display only: there is nothing to control on an access code service. */
export function AccessCodeTile({ service }: HapTileProps) {
  const { t } = useTranslation()

  return (
    <div
      className="accessory-box"
      role="group"
      tabIndex={0}
      aria-label={tileLabel(service.customName || service.serviceName, t('accessories.core.access_code'), '')}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.access_code')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* outer casing */}
            <rect x="6" y="1" width="18" height="30" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="2" />

            {/* top screen */}
            <rect
              x="9"
              y="5"
              width="12"
              height="3"
              rx="1"
              stroke="#7f7f7f"
              strokeWidth="1"
              fill="#1976d2"
              fillOpacity="0.5"
            />

            {/* pad outline */}
            <rect x="9" y="11" width="12" height="16" rx="1" stroke="#7f7f7f" fill="none" strokeWidth="1" />

            {/* pad lines */}
            <line x1="13" y1="11" x2="13" y2="27" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="17" y1="11" x2="17" y2="27" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="9" y1="15" x2="21" y2="15" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="9" y1="19" x2="21" y2="19" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="9" y1="23" x2="21" y2="23" stroke="#7f7f7f" strokeWidth="1" />
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text">{t('accessories.core.access_code')}</div>
      </div>
    </div>
  )
}
