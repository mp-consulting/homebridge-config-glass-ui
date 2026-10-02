import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { cx } from '@/core/accessories/types/hap/hap-tile'
import { securityTransition } from '@/core/accessories/types/hap/security-system/security-system.utils'
import { SecuritySystemManage } from '@/core/accessories/types/hap/security-system/SecuritySystemManage'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'

import './security-system.scss'

export function SecuritySystemTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const { isArming, isDisarming } = securityTransition(service)
  const current = service.values?.SecuritySystemCurrentState

  // Nothing to toggle: a tap opens the modal too
  const onClick = () => {
    if (!readyForControl) {
      return
    }
    openModal(SecuritySystemManage, { service }, { size: 'md', backdrop: 'static' })
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick: onClick })

  let label = null
  if (isArming) {
    label = <div className="accessory-label red-text">{`${t('accessories.control.arming')}...`}</div>
  } else if (isDisarming) {
    label = <div className="accessory-label grey-text">{`${t('accessories.control.disarming')}...`}</div>
  } else {
    const states: Record<number, [string, string]> = {
      0: ['grey-text', 'accessories.control.home'],
      1: ['grey-text', 'accessories.control.away'],
      2: ['grey-text', 'accessories.control.night'],
      3: ['red-text', 'accessories.control.off'],
      4: ['red-text', 'accessories.control.triggered'],
    }
    const state = states[current]
    if (state) {
      label = <div className={`accessory-label ${state[0]}`}>{t(state[1])}</div>
    }
  }

  return (
    <div
      ref={pressRef}
      className={cx(
        'accessory-box hb-security-system',
        (current !== 3 || isDisarming) && 'accessory-on',
        current === 0 && !isArming && 'home',
        current === 1 && !isArming && 'away',
        current === 2 && !isArming && 'night',
        current === 4 && 'triggered',
        readyForControl && 'cursor-pointer',
      )}
      tabIndex={0}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.security_system')}>
          <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* siren dome */}
            <path
              className="dome"
              d="M7 18 C7 5, 25 5, 25 18 V26 H7 V18 Z"
              fill="none"
              stroke="#7f7f7f"
              strokeWidth="1.5"
              fillOpacity="0.5"
            />
            {/* base */}
            <rect x="2" y="26" width="28" height="4" fill="none" stroke="#7f7f7f" strokeWidth="1.5" rx="1" />
            {/* light waves left to right */}
            <line className="ray" x1="6" y1="3" x2="10" y2="7" strokeWidth="3" />
            <line className="ray" x1="16" y1="0" x2="16" y2="5" strokeWidth="3" />
            <line className="ray" x1="26" y1="3" x2="22" y2="7" strokeWidth="3" />
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        {label}
      </div>
    </div>
  )
}
