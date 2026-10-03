import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { controlOnOffDevice, getOnOffState } from '@/core/accessories/types/matter/matter-device.utils'
import { onEnterOrSpace, tileName, tileSrText } from '@/core/accessories/types/matter/matter-tile'
import { cx } from '@/core/utilities/cx'

import './pump.scss'

/** The Matter pump tile (Angular `MatterPumpComponent`). */
export function MatterPumpTile({ service, readyForControl = false }: MatterTileProps) {
  const { t } = useTranslation()

  const on = getOnOffState(service)
  const stateText = on ? t('accessories.control.on') : t('accessories.control.off')
  const srText = tileSrText(service, t('accessories.core.pump'), stateText)

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    void controlOnOffDevice(service)
  }

  return (
    <div
      className={cx('accessory-box hb-matter-pump', on && 'accessory-on', readyForControl && 'cursor-pointer')}
      role="switch"
      tabIndex={0}
      aria-checked={on}
      aria-label={srText}
      onClick={onClick}
      onKeyDown={onEnterOrSpace(onClick)}
    >
      <span className="visually-hidden">
        {srText}
      </span>
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-hidden="true">
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            xmlns="http://www.w3.org/2000/svg"
            focusable="false"
            aria-hidden="true"
          >
            {/* inlet pipe */}
            <line x1="1" y1="16" x2="6" y2="16" stroke="#7f7f7f" strokeWidth="3" strokeLinecap="round" />
            {/* outlet pipe */}
            <line x1="16" y1="6" x2="16" y2="1" stroke="#7f7f7f" strokeWidth="3" strokeLinecap="round" />
            {/* pump housing */}
            <circle className="housing" cx="16" cy="16" r="10" fill="none" stroke="#7f7f7f" strokeWidth="2" />
            {/* impeller */}
            <g className="impeller" stroke="#7f7f7f" strokeWidth="1.5" strokeLinecap="round">
              <line x1="16" y1="16" x2="16" y2="10" />
              <line x1="16" y1="16" x2="21.2" y2="19" />
              <line x1="16" y1="16" x2="10.8" y2="19" />
            </g>
            {/* impeller hub */}
            <circle className="hub" cx="16" cy="16" r="2" fill="#7f7f7f" stroke="none" />
            {/* pump base */}
            <line x1="9" y1="30" x2="23" y2="30" stroke="#7f7f7f" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">
          {tileName(service)}
        </div>
        <div className="accessory-label grey-text" aria-hidden="true">
          {t(on ? 'accessories.control.on' : 'accessories.control.off')}
        </div>
      </div>
    </div>
  )
}
