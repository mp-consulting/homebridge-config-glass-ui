import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useTranslation } from 'react-i18next'

import { currentConsumption, hasCurrentConsumption } from '@/core/accessories/types/hap/hap-tile'
import { LockMechanismManage } from '@/core/accessories/types/hap/lazy-manage'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './lock-mechanism.scss'

export function LockMechanismTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const values = service.values

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    if ('LockTargetState' in service.values) {
      void service.getCharacteristic!('LockTargetState').setValue!(service.values.LockTargetState ? 0 : 1)
    } else if ('On' in service.values) {
      void service.getCharacteristic!('On').setValue!(!service.values.On)
    }
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    if ('LockTargetState' in service.values) {
      openModal(LockMechanismManage, { service }, { size: 'md', backdrop: 'static' })
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })

  let label = null
  if (values?.LockCurrentState < 2) {
    label = (
      <div className={cx('accessory-label', !values?.LockCurrentState && 'red-text', values?.LockCurrentState && 'grey-text')}>
        {t(values?.LockCurrentState ? 'accessories.control.locked' : 'accessories.control.unlocked')}
        {!values?.LockCurrentState && hasCurrentConsumption(service) && ` · ${currentConsumption(service)}W`}
      </div>
    )
  } else if (values?.LockCurrentState === 2) {
    label = <div className="accessory-label red-text">{t('accessories.control.jammed')}</div>
  } else if (values?.LockCurrentState === 3) {
    label = <div className="accessory-label red-text">{t('accessories.control.unknown')}</div>
  }

  return (
    <div
      ref={pressRef}
      className={cx(
        'accessory-box hb-lock-mechanism',
        (('LockCurrentState' in values && values?.LockCurrentState !== 1) || values?.On === 1) && 'accessory-on',
        (values?.LockCurrentState === 0 || values?.On === 1) && 'unlocked',
        values?.LockCurrentState === 2 && 'jammed',
        values?.LockCurrentState === 3 && 'error',
        readyForControl && 'cursor-pointer',
      )}
      tabIndex={0}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.lock_mechanism')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* shackle, locked */}
            <path
              d="M8 16 C6 -4, 26 -4, 24 16"
              fill="none"
              stroke="#7f7f7f"
              strokeWidth="2"
              className="shackle-locked"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* shackle, unlocked */}
            <path
              d="M8 16 C6 -2, 22 -2, 24 7"
              fill="none"
              stroke="#7f7f7f"
              strokeWidth="2"
              className="shackle-unlocked"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity="0"
            />
            {/* main lock */}
            <rect x="5" y="16" width="22" height="15" rx="3" fill="none" stroke="#7f7f7f" strokeWidth="2" />
            {/* status keyhole */}
            <circle
              cx="16"
              cy="23.5"
              r="3"
              stroke="#7f7f7f"
              strokeWidth="0.5"
              fill="#4caf50"
              fillOpacity="0.5"
              className="keyhole"
            />
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        {label}
      </div>
    </div>
  )
}
