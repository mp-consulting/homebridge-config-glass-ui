import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { cx } from '@/core/accessories/types/hap/hap-tile'
import { PositionLabel } from '@/core/accessories/types/hap/position-tile'
import { positionStyle, togglePosition } from '@/core/accessories/types/hap/position.utils'
import { WindowManage } from '@/core/accessories/types/hap/window/WindowManage'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'

import './window.scss'

export function WindowTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()

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
    openModal(WindowManage, { service }, { size: 'md', backdrop: 'static' })
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box hb-window', service.values?.CurrentPosition && 'accessory-on', readyForControl && 'cursor-pointer')}
      tabIndex={0}
      style={positionStyle(service)}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.window')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* outer frame */}
            <rect x="1" y="0.8" width="30" height="30.2" rx="0.5" stroke="#7f7f7f" fill="none" strokeWidth="1.5" />
            {/* left window frame */}
            <rect
              className="outline-left"
              x="2.8"
              y="2.6"
              width="12.4"
              height="26.6"
              stroke="#7f7f7f"
              fill="none"
              strokeWidth="1"
            />
            {/* left window divider */}
            <rect
              className="divider-left"
              x="3.66"
              y="15.65"
              width="10.68"
              height="0.5"
              stroke="#7f7f7f"
              fill="none"
              strokeWidth="0.5"
              ry="2"
            />
            {/* left window handle */}
            <rect
              className="handle-left"
              x="15.16"
              y="13.6"
              width="0.1"
              height="4.6"
              stroke="#1976d2"
              fill="none"
              strokeWidth="0.5"
              ry="2"
            />
            {/* right window frame */}
            <rect
              className="outline-right"
              x="16.8"
              y="2.6"
              width="12.4"
              height="26.6"
              stroke="#7f7f7f"
              fill="none"
              strokeWidth="1"
            />
            {/* right window divider */}
            <rect
              className="divider-right"
              x="17.66"
              y="15.65"
              width="10.68"
              height="0.5"
              stroke="#7f7f7f"
              fill="none"
              strokeWidth="0.5"
              ry="2"
            />
            {/* right window handle */}
            <rect
              className="handle-right"
              x="16.76"
              y="13.6"
              width="0.1"
              height="4.6"
              stroke="#1976d2"
              fill="none"
              strokeWidth="0.5"
              ry="2"
            />
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        <PositionLabel service={service} />
      </div>
    </div>
  )
}
