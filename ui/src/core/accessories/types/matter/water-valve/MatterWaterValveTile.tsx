import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { isWaterValveOpen, toggleWaterValve } from '@/core/accessories/types/matter/matter-device.utils'
import { onEnterOrSpace, tileName, tileSrText } from '@/core/accessories/types/matter/matter-tile'
import { cx } from '@/core/utilities/cx'

import './water-valve.scss'

/** The Matter water valve tile (Angular `MatterWaterValveComponent`). */
export function MatterWaterValveTile({ service, readyForControl = false }: MatterTileProps) {
  const { t } = useTranslation()

  const on = isWaterValveOpen(service)
  const stateText = on ? t('accessories.control.open') : t('accessories.control.closed')
  const srText = tileSrText(service, t('accessories.core.valve'), stateText)

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    void toggleWaterValve(service)
  }

  return (
    <div
      className={cx('accessory-box hb-matter-water-valve', on && 'accessory-on', readyForControl && 'cursor-pointer')}
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
            {/* top twister */}
            <line x1="8" y1="3" x2="14" y2="3" stroke="#7f7f7f" strokeWidth="3" strokeLinecap="round" />
            {/* twister to main pipe */}
            <line x1="11" y1="8" x2="11" y2="3" stroke="#7f7f7f" strokeWidth="3" strokeLinecap="round" />
            {/* main pipe */}
            <line x1="0" y1="9" x2="21" y2="9" stroke="#7f7f7f" strokeWidth="4" strokeLinecap="round" />
            {/* nozzle */}
            <line x1="21" y1="9" x2="21" y2="14" stroke="#7f7f7f" strokeWidth="4" strokeLinecap="round" />
            {/* top row of drops */}
            <circle className="drop drop-top" fill="#1976d2" fillOpacity="0" cx="21" cy="19" r="1.5" />
            {/* middle row of drops */}
            <circle className="drop drop-middle" fill="#1976d2" fillOpacity="0" cx="17" cy="24" r="1.5" />
            <circle className="drop drop-middle" fill="#1976d2" fillOpacity="0" cx="25" cy="24" r="1.5" />
            {/* bottom row of drops */}
            <circle className="drop drop-bottom" fill="#1976d2" fillOpacity="0" cx="13" cy="29" r="1.5" />
            <circle className="drop drop-bottom" fill="#1976d2" fillOpacity="0" cx="21" cy="29" r="1.5" />
            <circle className="drop drop-bottom" fill="#1976d2" fillOpacity="0" cx="29" cy="29" r="1.5" />
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">
          {tileName(service)}
        </div>
        <div className="accessory-label grey-text" aria-hidden="true">
          {t(on ? 'accessories.control.open' : 'accessories.control.closed')}
        </div>
      </div>
    </div>
  )
}
