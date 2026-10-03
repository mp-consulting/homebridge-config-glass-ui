import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { ColorTemperatureLightManage } from '@/core/accessories/types/matter/color-temperature-light/ColorTemperatureLightManage'
import { getBrightnessPercentage, getDeviceActiveState, toggleDimmableLight } from '@/core/accessories/types/matter/matter-device.utils'
import { openManageModal, tileName, tileSrText } from '@/core/accessories/types/matter/matter-tile'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { useLongPress } from '@/core/ui/use-long-press'
import { colour } from '@/core/utilities/colour'
import { cx } from '@/core/utilities/cx'

export function ColorTemperatureLightTile({ service, readyForControl = false }: MatterTileProps) {
  const { t } = useTranslation()

  const on = getDeviceActiveState(service)
  const pct = getBrightnessPercentage(service)
  const stateText = on ? (pct > 0 ? `${pct}%` : t('accessories.control.on')) : t('accessories.control.off')
  const srText = tileSrText(service, t('accessories.core.lightbulb'), stateText)

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    void toggleDimmableLight(service)
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    openManageModal(ColorTemperatureLightManage, service)
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box', on && 'accessory-on', readyForControl && 'cursor-pointer')}
      role="switch"
      tabIndex={0}
      aria-checked={on}
      aria-label={srText}
    >
      <span className="visually-hidden">
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
            {/* bulb outline */}
            <path
              stroke="#7f7f7f"
              strokeWidth="1.5"
              d="M8 21c-2.8-2.2-4.5-5.4-4.5-9 0-6.1 5-11 11.5-11S27.5 5.9 27.5 12c0 3.5-1.7 6.7-4.5 8.9-1.2 1-1.8 4.8-3 7.3-.9 2-2.2 2.7-4.5 2.7s-3.6-.7-4.5-2.7c-1.2-2.5-1.8-6.3-3-7.3z"
              fill={
                on
                  ? colour.kelvinToHex(
                      colour.miredToKelvin(service.clusters?.colorControl?.colorTemperatureMireds || 250),
                    )
                  : 'none'
              }
              fillOpacity={0.25 + (pct / 100) * 0.5}
            />
            {/* top inner line */}
            <line stroke="#7f7f7f" strokeWidth="1.5" x1="8" y1="21.5" x2="23" y2="21.5" />
            {/* diagonal lines top to bottom */}
            <line stroke="#7f7f7f" strokeWidth="0.75" x1="10" y1="23" x2="21" y2="24" />
            <line stroke="#7f7f7f" strokeWidth="0.75" x1="10" y1="25.5" x2="21" y2="26.5" />
            <line stroke="#7f7f7f" strokeWidth="0.75" x1="11" y1="28" x2="20" y2="29" />
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">
          {tileName(service)}
        </div>
        <SafeHtml className="accessory-label grey-text" aria-hidden="true" html={stateText} />
      </div>
    </div>
  )
}
