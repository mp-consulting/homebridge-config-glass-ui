import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { currentConsumption, hasCurrentConsumption } from '@/core/accessories/types/hap/hap-tile'
import { switchIsOn, switchToggle } from '@/core/accessories/types/hap/switch/switch.utils'
import { useSettingsStore } from '@/core/settings/settings.store'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './outlet.scss'

/** The outlet is the switch tile with a socket icon: same on/off chain, same writes. */
export function OutletTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const browserLang = useSettingsStore(state => state.browserLang)
  const on = switchIsOn(service)

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    switchToggle(service)
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick })

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box hb-outlet', on && 'accessory-on', readyForControl && 'cursor-pointer')}
      tabIndex={0}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.outlet')}>
          <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* socket outline */}
            <rect x="1" y="1" width="30" height="30" rx="6" ry="6" fill="none" stroke="#7f7f7f" strokeWidth="1.5" className="outer" />
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
              : (browserLang === 'en-AU' || browserLang === 'en-NZ')
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
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        <div className="accessory-label grey-text">
          {t(on ? 'accessories.control.on' : 'accessories.control.off')}
          {on && hasCurrentConsumption(service) && ` · ${currentConsumption(service)}W`}
        </div>
      </div>
    </div>
  )
}
