import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { consumptionSuffix, currentConsumption, hasCurrentConsumption, tileLabel } from '@/core/accessories/types/hap/hap-tile'
import { ValveManage } from '@/core/accessories/types/hap/lazy-manage'
import { useLatest } from '@/core/hooks/use-latest'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './valve.scss'

/**
 * Seconds as `mm:ss`, or `hh:mm:ss` from an hour up.
 * @param remainingSeconds - the seconds left
 */
function formatRemaining(remainingSeconds: number): string {
  return remainingSeconds < 3600
    ? new Date(remainingSeconds * 1000).toISOString().substring(14, 19)
    : new Date(remainingSeconds * 1000).toISOString().substring(11, 19)
}

export function ValveTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const live = useLatest(service)
  const secondsActiveRef = useRef(0)
  const [remainingDuration, setRemainingDuration] = useState('')
  // Decided once, as in ngOnInit
  const [hasSetDuration] = useState(() => 'SetDuration' in service.values)

  // Count the RemainingDuration down locally while the valve runs: the
  // accessory only reports it when the run starts
  useEffect(() => {
    if (!hasSetDuration) {
      return
    }
    const timer = setInterval(() => {
      const current = live.current
      if (!current.values.Active) {
        secondsActiveRef.current = 0
        if (current.getCharacteristic?.('RemainingDuration')) {
          setRemainingDuration('')
        }
        return
      }
      secondsActiveRef.current++
      const remainingSeconds = (current.getCharacteristic!('RemainingDuration').value as number) - secondsActiveRef.current
      setRemainingDuration(remainingSeconds > 0 ? formatRemaining(remainingSeconds) : '')
    }, 1000)
    return () => clearInterval(timer)
  }, [hasSetDuration, live])

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    if ('Active' in service.values) {
      void service.getCharacteristic!('Active').setValue!(service.values.Active ? 0 : 1)
    } else if ('On' in service.values) {
      void service.getCharacteristic!('On').setValue!(!service.values.On)
    }
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    if ('SetDuration' in service.values) {
      openModal(ValveManage, { service }, { size: 'md', backdrop: 'static' })
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })
  const values = service.values

  let icon = null
  if (values?.ValveType === 0 || !values?.ValveType) {
    icon = (
      <div className="accessory-svg" aria-label={t('accessories.core.generic_valve')}>
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
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
    )
  } else if (values?.ValveType === 1) {
    icon = (
      <div className="accessory-svg" aria-label={t('accessories.core.irrigation_valve')}>
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          {/* small drops, left to right */}
          <circle className="drop drop-out" fill="#1976d2" fillOpacity="0" cx="1" cy="16" r="1" />
          <circle className="drop drop-out" fill="#1976d2" fillOpacity="0" cx="6" cy="8" r="1" />
          <circle className="drop drop-out" fill="#1976d2" fillOpacity="0" cx="16" cy="4" r="1" />
          <circle className="drop drop-out" fill="#1976d2" fillOpacity="0" cx="26" cy="8" r="1" />
          <circle className="drop drop-out" fill="#1976d2" fillOpacity="0" cx="31" cy="16" r="1" />
          {/* large drops, left to right */}
          <circle className="drop drop-in" fill="#1976d2" fillOpacity="0" cx="7" cy="16" r="1.5" />
          <circle className="drop drop-in" fill="#1976d2" fillOpacity="0" cx="25" cy="16" r="1.5" />
          <circle className="drop drop-in" fill="#1976d2" fillOpacity="0" cx="10.5" cy="11.5" r="1.5" />
          <circle className="drop drop-in" fill="#1976d2" fillOpacity="0" cx="21.5" cy="11.5" r="1.5" />
          <circle className="drop drop-in" fill="#1976d2" fillOpacity="0" cx="16" cy="9" r="1.5" />
          {/* vertical pipe */}
          <line x1="16" y1="16" x2="16" y2="31" stroke="#7f7f7f" strokeWidth="2" strokeLinecap="round" />
          {/* spout */}
          <line x1="14" y1="16" x2="18" y2="16" stroke="#7f7f7f" strokeWidth="4" strokeLinecap="round" />
          {/* grass */}
          <line
            className="grass"
            x1="4"
            y1="31"
            x2="28"
            y2="31"
            stroke="#7f7f7f"
            strokeOpacity="0.5"
            strokeWidth="10"
            strokeLinecap="round"
          />
        </svg>
      </div>
    )
  } else if (values?.ValveType === 2) {
    icon = (
      <div className="accessory-svg" aria-label={t('accessories.core.shower_head_valve')}>
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          {/* top horizontal pipe */}
          <line x1="1" y1="1" x2="16" y2="1" stroke="#7f7f7f" strokeWidth="2" strokeLinecap="round" />
          {/* left vertical pipe */}
          <line x1="1" y1="1" x2="1" y2="31" stroke="#7f7f7f" strokeWidth="2" strokeLinecap="round" />
          {/* pipe to head */}
          <line x1="16" y1="1" x2="16" y2="3" stroke="#7f7f7f" strokeWidth="2" strokeLinecap="round" />
          {/* shower head */}
          <path d="M8 11 A8 7 0 0 1 24 11" fill="none" stroke="#7f7f7f" strokeWidth="2" />
          <line x1="7" y1="11" x2="25" y2="11" stroke="#7f7f7f" strokeWidth="2" strokeLinecap="round" />
          {/* large drops, left to right */}
          <circle className="drop drop-top" fill="#1976d2" fillOpacity="0" cx="8" cy="16" r="1.25" />
          <circle className="drop drop-top" fill="#1976d2" fillOpacity="0" cx="13.3" cy="16" r="1.25" />
          <circle className="drop drop-top" fill="#1976d2" fillOpacity="0" cx="18.6" cy="16" r="1.25" />
          <circle className="drop drop-top" fill="#1976d2" fillOpacity="0" cx="24" cy="16" r="1.25" />
          {/* middle drops, left to right */}
          <circle className="drop drop-middle" fill="#1976d2" fillOpacity="0" cx="8" cy="22" r="1" />
          <circle className="drop drop-middle" fill="#1976d2" fillOpacity="0" cx="13.3" cy="22" r="1" />
          <circle className="drop drop-middle" fill="#1976d2" fillOpacity="0" cx="18.6" cy="22" r="1" />
          <circle className="drop drop-middle" fill="#1976d2" fillOpacity="0" cx="24" cy="22" r="1" />
          {/* small drops, left to right */}
          <circle className="drop drop-bottom" fill="#1976d2" fillOpacity="0" cx="8" cy="28" r="0.75" />
          <circle className="drop drop-bottom" fill="#1976d2" fillOpacity="0" cx="13.3" cy="28" r="0.75" />
          <circle className="drop drop-bottom" fill="#1976d2" fillOpacity="0" cx="18.6" cy="28" r="0.75" />
          <circle className="drop drop-bottom" fill="#1976d2" fillOpacity="0" cx="24" cy="28" r="0.75" />
        </svg>
      </div>
    )
  } else if (values?.ValveType === 3) {
    icon = (
      <div className="accessory-svg" aria-label={t('accessories.core.faucet_valve')}>
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
          {/* sink */}
          <rect className="sink" x="-3" y="28" width="21" height="6.5" fill="#7f7f7f" strokeWidth="0" fillOpacity="0.5" />
          {/* cold tap */}
          <line
            strokeLinecap="round"
            x1="24"
            y1="18"
            x2="26"
            y2="18"
            stroke="#1976d2"
            strokeWidth="3"
            strokeOpacity="0.5"
          />
          {/* hot tap */}
          <line
            strokeLinecap="round"
            x1="20"
            y1="18"
            x2="22"
            y2="18"
            stroke="#d32f2f"
            strokeWidth="3"
            strokeOpacity="0.5"
          />
          {/* tap outline */}
          <rect x="19" y="16.5" rx="1" width="8" height="3" fill="none" strokeWidth="1" stroke="#7f7f7f" />
          {/* tap shape */}
          <path d="M10 9 C10 -1, 23 -1, 23 10 V26" fill="none" stroke="#7f7f7f" strokeWidth="2" />
          {/* water */}
          <line className="stream" x1="10" y1="9" x2="10" y2="28" stroke="#1976d2" strokeOpacity="0" strokeWidth="1.5" />
          {/* tap base */}
          <line x1="20" y1="31" x2="26" y2="31" stroke="#7f7f7f" strokeWidth="10" strokeLinecap="round" />
        </svg>
      </div>
    )
  }

  let label
  let stateText
  let srType = t('accessories.core.generic_valve')
  if (values?.ValveType === 1) {
    srType = t('accessories.core.irrigation_valve')
  } else if (values?.ValveType === 2) {
    srType = t('accessories.core.shower_head_valve')
  } else if (values?.ValveType === 3) {
    srType = t('accessories.core.faucet_valve')
  }
  if (values?.Active && remainingDuration) {
    stateText = `${t('accessories.control.running')}, ${remainingDuration}`
    label = <div className="accessory-label grey-text">{remainingDuration}</div>
  } else if ((values?.Active && !remainingDuration) || values?.On) {
    stateText = t('accessories.control.running') + consumptionSuffix(service)
    label = (
      <div className="accessory-label grey-text">
        {t('accessories.control.running')}
        {hasCurrentConsumption(service) && ` · ${currentConsumption(service)}W`}
      </div>
    )
  } else {
    stateText = t('accessories.control.off')
    label = <div className="accessory-label grey-text">{t('accessories.control.off')}</div>
  }
  const on = !!(values?.Active || values?.On)
  const srText = tileLabel(service.customName || values?.ConfiguredName || service.serviceName, srType, stateText)

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box hb-valve', (values?.Active || values?.On) && 'accessory-on', readyForControl && 'cursor-pointer')}
      role="switch"
      tabIndex={0}
      aria-checked={on}
      aria-label={srText}
    >
      <div className="d-flex flex-column h-100">
        {icon}
        <div className="accessory-label mt-auto">
          {service.customName || values?.ConfiguredName || service.serviceName}
        </div>
        {label}
      </div>
    </div>
  )
}
