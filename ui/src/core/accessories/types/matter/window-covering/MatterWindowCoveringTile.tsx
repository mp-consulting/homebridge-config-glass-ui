import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'
import type { CSSProperties } from 'react'

import { useTranslation } from 'react-i18next'

import { getWindowCoveringOpenPercentage, toggleWindowCovering } from '@/core/accessories/types/matter/matter-device.utils'
import { openManageModal, tileName, tileSrText } from '@/core/accessories/types/matter/matter-tile'
import { WindowCoveringManage } from '@/core/accessories/types/matter/window-covering/WindowCoveringManage'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './window-covering.scss'

/** The Matter window covering tile, also drawn as a door or a window (Angular `MatterWindowCoveringComponent`). */
export function MatterWindowCoveringTile({ service, readyForControl = false }: MatterTileProps) {
  const { t } = useTranslation()

  // Reports the tilt on a covering that only tilts - see getWindowCoveringOpenPercentage
  const pos = getWindowCoveringOpenPercentage(service)
  const deviceType = service.customType || service.deviceType || 'WindowCovering'
  const isWindowCovering = deviceType === 'WindowCovering'
  const isDoor = deviceType === 'Door'
  const isWindow = deviceType === 'Window'

  const openText = t('accessories.control.open')
  const stateText = pos === 0 ? t('accessories.control.closed') : pos === 100 ? openText : `${openText} ${pos}%`
  const srType = isDoor
    ? t('accessories.core.door')
    : isWindow
      ? t('accessories.core.window')
      : t('accessories.core.window_covering')
  const srText = tileSrText(service, srType, stateText)

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    void toggleWindowCovering(service)
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    openManageModal(WindowCoveringManage, service)
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box hb-matter-window-covering', pos > 0 && 'accessory-on', readyForControl && 'cursor-pointer')}
      role="slider"
      tabIndex={0}
      style={{ '--position': pos / 100 } as CSSProperties}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pos}
      aria-valuetext={stateText}
      aria-label={srText}
    >
      <span className="visually-hidden">
        {srText}
      </span>
      <div className="d-flex flex-column h-100">
        {/* Window Covering Icon */}
        {isWindowCovering && (
          <div className="accessory-svg" aria-hidden="true">
            <svg
              width="32px"
              height="32px"
              viewBox="0 0 32 32"
              xmlns="http://www.w3.org/2000/svg"
              focusable="false"
              aria-hidden="true"
            >
              <rect x="1" y="0.8" width="30" height="30.2" rx="0.5" stroke="#7f7f7f" fill="none" strokeWidth="1.5" />
              <rect x="2.8" y="2.6" width="12.4" height="26.6" stroke="#7f7f7f" fill="none" strokeWidth="1" />
              <rect x="3.66" y="15.65" width="10.68" height="0.5" stroke="#7f7f7f" fill="none" strokeWidth="0.5" rx="2" />
              <rect x="16.8" y="2.6" width="12.4" height="26.6" stroke="#7f7f7f" fill="none" strokeWidth="1" />
              <rect x="17.66" y="15.65" width="10.68" height="0.5" stroke="#7f7f7f" fill="none" strokeWidth="0.5" rx="2" />
              <rect
                className="c-blinds"
                x="2.3"
                y="2.1"
                width="27.4"
                height="27.6"
                stroke="#808080"
                fill="#808080"
                strokeWidth="0.5"
                strokeOpacity="0.9"
                fillOpacity="0.9"
              />
              <rect
                className="c-light"
                x="2.05"
                y="29.9"
                width="27.9"
                height="0"
                stroke="#ffffff"
                fill="#ffffff"
                strokeWidth="0.5"
                strokeOpacity="0"
                fillOpacity="0.5"
              />
            </svg>
          </div>
        )}
        {/* Door Icon */}
        {isDoor && (
          <div className="accessory-svg" aria-hidden="true">
            <svg
              width="32px"
              height="32px"
              viewBox="0 0 32 32"
              xmlns="http://www.w3.org/2000/svg"
              focusable="false"
              aria-hidden="true"
            >
              <rect x="7.8" y="0.8" width="16.4" height="30.2" rx="0.5" stroke="#7f7f7f" fill="none" strokeWidth="1.5" />
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
              <line x1="0" y1="31" x2="32" y2="31" stroke="#7f7f7f" strokeWidth="1.5" />
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
        )}
        {/* Window Icon */}
        {isWindow && (
          <div className="accessory-svg" aria-hidden="true">
            <svg
              width="32px"
              height="32px"
              viewBox="0 0 32 32"
              xmlns="http://www.w3.org/2000/svg"
              focusable="false"
              aria-hidden="true"
            >
              <rect x="1" y="0.8" width="30" height="30.2" rx="0.5" stroke="#7f7f7f" fill="none" strokeWidth="1.5" />
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
        )}
        <div className="accessory-label mt-auto" aria-hidden="true">
          {tileName(service)}
        </div>
        <div className="accessory-label grey-text" aria-hidden="true">
          {pos === 0
            ? t('accessories.control.closed')
            : pos === 100
              ? t('accessories.control.open')
              : `${t('accessories.control.open')} ${pos}%`}
        </div>
      </div>
    </div>
  )
}
