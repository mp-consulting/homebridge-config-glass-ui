import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { controlDevice, getActivePowerWatts, getDeviceActiveState } from '@/core/accessories/types/matter/matter-device.utils'
import { onEnterOrSpace, tileName, tileSrText } from '@/core/accessories/types/matter/matter-tile'
import { formatDecimal } from '@/core/pipes/decimal'
import { useSettingsStore } from '@/core/settings/settings.store'
import { cx } from '@/core/utilities/cx'

import './on-off-plug-in-unit.scss'

export function OnOffPlugInUnitTile({ service, readyForControl = false }: MatterTileProps) {
  const { t } = useTranslation()
  const browserLang = useSettingsStore(state => state.browserLang)

  const on = getDeviceActiveState(service)
  // Live power reading in watts, or null when the outlet does not expose the
  // ElectricalPowerMeasurement cluster (or has no reading yet)
  const watts = getActivePowerWatts(service)
  const baseStateText = on ? t('accessories.control.on') : t('accessories.control.off')
  const stateText = on && watts !== null ? `${baseStateText} · ${formatDecimal(watts, '1.0-1')}W` : baseStateText
  const srText = tileSrText(service, t('accessories.core.outlet'), stateText)

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    controlDevice(service)
  }

  return (
    <div
      className={cx('accessory-box hb-matter-on-off-plug-in-unit', on && 'accessory-on', readyForControl && 'cursor-pointer')}
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
            {/* socket outline */}
            <rect
              x="1"
              y="1"
              width="30"
              height="30"
              rx="6"
              ry="6"
              fill="none"
              stroke="#7f7f7f"
              strokeWidth="1.5"
              className="outer"
            />
            {/* inner circle */}
            <circle cx="16" cy="16" r="10" fill="none" stroke="#7f7f7f" strokeWidth="1.5" className="inner" />
            {browserLang === 'en-GB'
              ? (
                  <>
                    {/* UK plug holes: earth pin at top, two horizontal pins below */}
                    <line x1="16" y1="10" x2="16" y2="13" stroke="#7f7f7f" strokeLinecap="round" strokeWidth="1.5" />
                    <line x1="10" y1="19" x2="13" y2="19" stroke="#7f7f7f" strokeLinecap="round" strokeWidth="1.5" />
                    <line x1="19" y1="19" x2="22" y2="19" stroke="#7f7f7f" strokeLinecap="round" strokeWidth="1.5" />
                  </>
                )
              : browserLang === 'en-AU' || browserLang === 'en-NZ'
                ? (
                    <>
                      {/* Australian/NZ Type I plug holes: two angled pins forming inverted V, earth pin below */}
                      <line x1="11.5" y1="14.5" x2="13.5" y2="11.5" stroke="#7f7f7f" strokeLinecap="round" strokeWidth="1.5" />
                      <line x1="18.5" y1="11.5" x2="20.5" y2="14.5" stroke="#7f7f7f" strokeLinecap="round" strokeWidth="1.5" />
                      <line x1="16" y1="19" x2="16" y2="22" stroke="#7f7f7f" strokeLinecap="round" strokeWidth="1.5" />
                    </>
                  )
                : (
                    <>
                      {/* Generic plug holes: earth pin at bottom, two horizontal pins above */}
                      <line x1="16" y1="19" x2="16" y2="22" stroke="#7f7f7f" strokeLinecap="round" strokeWidth="1.5" />
                      <line x1="10" y1="14" x2="13" y2="14" stroke="#7f7f7f" strokeLinecap="round" strokeWidth="1.5" />
                      <line x1="19" y1="14" x2="22" y2="14" stroke="#7f7f7f" strokeLinecap="round" strokeWidth="1.5" />
                    </>
                  )}
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">
          {tileName(service)}
        </div>
        <div className="accessory-label grey-text" aria-hidden="true">{stateText}</div>
      </div>
    </div>
  )
}
