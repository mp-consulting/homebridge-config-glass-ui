import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { DoorManage } from '@/core/accessories/types/hap/door/DoorManage'
import { PositionLabel } from '@/core/accessories/types/hap/position-tile'
import { positionStyle, togglePosition } from '@/core/accessories/types/hap/position.utils'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './door.scss'

export function DoorTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const values = service.values
  const pos = values?.CurrentPosition
  const posState = values?.PositionState

  const stateText = posState === 1
    ? t('accessories.control.opening')
    : posState === 0
      ? t('accessories.control.closing')
      : pos === 0
        ? t('accessories.control.closed')
        : pos === 100
          ? t('accessories.control.open')
          : `${t('accessories.control.open')} ${pos}%`

  const srBaseName = (service.customName || service.serviceName || '').trim()
  const srType = t('accessories.core.door')
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  const srText = `${srBaseName + (includeType ? `, ${srType}` : '')}, ${stateText}`

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    togglePosition(service)
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    openModal(DoorManage, { service }, { size: 'md', backdrop: 'static' })
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box hb-door', pos && 'accessory-on', readyForControl && 'cursor-pointer')}
      role="button"
      tabIndex={0}
      style={positionStyle(service)}
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
      <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
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
            {/* outer frame */}
            <rect x="7.8" y="0.8" width="16.4" height="30.2" rx="0.5" stroke="#7f7f7f" fill="none" strokeWidth="1.5" />
            {/* door outline */}
            <rect
              className="outline"
              x="9.6"
              y="2.6"
              width="12.8"
              height="26.6"
              stroke="#7f7f7f"
              fill="none"
              strokeWidth="1"
            />
            {/* top panel */}
            <rect
              className="panel"
              x="11.2"
              y="4.2"
              width="9.6"
              height="10.8"
              stroke="#7f7f7f"
              fillOpacity="0"
              strokeWidth="0.5"
              rx="0.25"
            />
            {/* bottom panel */}
            <rect
              className="panel"
              x="11.2"
              y="16.8"
              width="9.6"
              height="10.8"
              stroke="#7f7f7f"
              fillOpacity="0"
              strokeWidth="0.5"
              rx="0.25"
            />
            {/* wider floor */}
            <line x1="0" y1="31" x2="32" y2="31" stroke="#7f7f7f" strokeWidth="1.5" />
            {/* door handle */}
            <rect
              className="handle"
              x="19.25"
              y="15.87"
              width="1.55"
              height="0.05"
              stroke="#1976d2"
              fill="none"
              strokeWidth="0.5"
              rx="10"
            />
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">{service.customName || service.serviceName}</div>
        <PositionLabel service={service} a11y />
      </div>
    </div>
  )
}
