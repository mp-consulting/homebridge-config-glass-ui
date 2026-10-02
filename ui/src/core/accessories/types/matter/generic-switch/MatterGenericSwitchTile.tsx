import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { tileName } from '@/core/accessories/types/matter/matter-tile'

/** The Matter generic (stateless) switch tile (Angular `MatterGenericSwitchComponent`): nothing to control. */
export function MatterGenericSwitchTile({ service }: MatterTileProps) {
  const { t } = useTranslation()

  return (
    <div className="accessory-box">
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.stateless_programmable_switch')}>
          <svg
            width="32px"
            height="32px"
            viewBox="0 0 32 32"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
            aria-hidden="true"
          >
            {/* frame */}
            <rect x="1" y="1" width="30" height="30" rx="3" stroke="#7f7f7f" fill="none" strokeWidth="2" />
            {/* single click */}
            <circle cx="8.5" cy="9.5" r="5" stroke="#7f7f7f" strokeWidth="1" fill="none" fillOpacity="0.5" />
            {/* double click, outer then inner */}
            <circle cx="23.5" cy="9.5" r="5" stroke="#7f7f7f" strokeWidth="1" fill="none" fillOpacity="0.5" />
            <circle cx="23.5" cy="9.5" r="3" stroke="#7f7f7f" strokeWidth="1" fill="none" />
            {/* long click */}
            <circle cx="16" cy="23.5" r="5" stroke="#7f7f7f" strokeWidth="1" fill="none" fillOpacity="0.5" />
            {/* long click lines, left then right */}
            <line x1="5" y1="23.5" x2="11" y2="23.5" stroke="#7f7f7f" strokeWidth="0.5" strokeLinecap="round" />
            <line x1="21" y1="23.5" x2="27" y2="23.5" stroke="#7f7f7f" strokeWidth="0.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">
          {tileName(service)}
        </div>
        <div className="accessory-label grey-text" aria-hidden="true">
          {t('accessories.control.stateless')}
        </div>
      </div>
    </div>
  )
}
