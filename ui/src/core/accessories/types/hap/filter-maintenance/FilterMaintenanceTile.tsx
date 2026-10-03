import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { FilterMaintenanceManage } from '@/core/accessories/types/hap/filter-maintenance/FilterMaintenanceManage'
import { tileLabel } from '@/core/accessories/types/hap/hap-tile'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './filter-maintenance.scss'

export function FilterMaintenanceTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const values = service.values

  // Nothing to toggle: a tap opens the modal too
  const onClick = () => {
    if (!readyForControl) {
      return
    }
    openModal(FilterMaintenanceManage, { service }, { size: 'md', backdrop: 'static' })
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick: onClick })
  const replace = values?.FilterChangeIndication === 1
  const srText = tileLabel(
    service.customName || service.serviceName,
    t('accessories.core.filter_maintenance'),
    [`${values?.FilterLifeLevel}%`, replace && t('accessories.control.replace')].filter(Boolean).join(', '),
  )

  return (
    <div
      ref={pressRef}
      className={cx(
        'accessory-box hb-filter-maintenance',
        (replace || values?.FilterLifeLevel < 10) && 'replace',
        !replace && values?.FilterLifeLevel < 50 && 'dirty',
        readyForControl && 'cursor-pointer',
      )}
      role="button"
      tabIndex={0}
      aria-label={srText}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.filter_maintenance')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* top outer ellipse */}
            <ellipse
              className="status"
              cx="16"
              cy="7"
              rx="11"
              ry="5"
              stroke="#7f7f7f"
              strokeWidth="1.75"
              fill="#4caf50"
              fillOpacity="0.5"
            />
            {/* top inner ellipse */}
            <ellipse
              className="back"
              cx="16"
              cy="7"
              rx="6"
              ry="2"
              stroke="#7f7f7f"
              strokeWidth="1"
              fill="#e0e0e0"
              fillOpacity="1"
            />
            {/* side walls */}
            <line x1="5" y1="7" x2="5" y2="27.7" stroke="#7f7f7f" strokeWidth="1.75" />
            <line x1="27" y1="7" x2="27" y2="27.7" stroke="#7f7f7f" strokeWidth="1.75" />
            {/* base arc */}
            <path d="M4.7,27 A13,6.9 0 0,0 27.3,27" stroke="#7f7f7f" strokeWidth="1.75" fill="none" />
            {/* outer front lines */}
            <line x1="7" y1="10" x2="7" y2="29" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="9" y1="11" x2="9" y2="29" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="11" y1="12" x2="11" y2="30" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="13" y1="12" x2="13" y2="30" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="15" y1="12" x2="15" y2="30" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="17" y1="12" x2="17" y2="30" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="19" y1="12" x2="19" y2="30" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="21" y1="12" x2="21" y2="30" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="23" y1="11" x2="23" y2="29" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="25" y1="10" x2="25" y2="29" stroke="#7f7f7f" strokeWidth="1" />
            {/* inner back lines */}
            <line x1="11" y1="6" x2="11" y2="8" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="13" y1="5" x2="13" y2="9" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="15" y1="5" x2="15" y2="9" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="17" y1="5" x2="17" y2="9" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="19" y1="5" x2="19" y2="9" stroke="#7f7f7f" strokeWidth="1" />
            <line x1="21" y1="6" x2="21" y2="8" stroke="#7f7f7f" strokeWidth="1" />
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text">
          <span className={cx(replace && 'red-text') || undefined}>
            {`${values?.FilterLifeLevel}%`}
          </span>
          {replace && (
            <>
              {' · '}
              <span className="red-text">{t('accessories.control.replace')}</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
