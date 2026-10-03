import type { MatterTileProps } from '@/core/accessories/types/matter/matter-tile'

import { useTranslation } from 'react-i18next'

import { DoorLockManage } from '@/core/accessories/types/matter/door-lock/DoorLockManage'
import { getDoorLockState, toggleDoorLock } from '@/core/accessories/types/matter/matter-device.utils'
import { openManageModal, tileName } from '@/core/accessories/types/matter/matter-tile'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './door-lock.scss'

/** The Matter door lock tile (Angular `MatterDoorLockComponent`). */
export function MatterDoorLockTile({ service, readyForControl = false }: MatterTileProps) {
  const { t } = useTranslation()

  const state = getDoorLockState(service)
  const isLocked = state === 1
  const stateText = state === 1
    ? t('accessories.control.locked')
    : state === 2
      ? t('accessories.control.unlocked')
      : state === 0
        ? t('accessories.control.jammed')
        : ''

  const srBaseName = (service.customName || service.serviceName || service.displayName || '').trim()
  const srType = t('accessories.core.lock_mechanism')
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  const srText = stateText
    ? `${srBaseName + (includeType ? `, ${srType}` : '')}, ${stateText}`
    : `${srBaseName + (includeType ? `, ${srType}` : '')}`

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    void toggleDoorLock(service)
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    openManageModal(DoorLockManage, service)
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })

  return (
    <div
      ref={pressRef}
      className={cx(
        'accessory-box hb-matter-door-lock',
        state !== 1 && 'accessory-on',
        state === 2 && 'unlocked',
        state === 0 && 'jammed',
        readyForControl && 'cursor-pointer',
      )}
      role="switch"
      tabIndex={0}
      aria-checked={isLocked}
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
        <div className="accessory-label mt-auto" aria-hidden="true">
          {tileName(service)}
        </div>
        {state === 1
          ? <div className="accessory-label grey-text" aria-hidden="true">{t('accessories.control.locked')}</div>
          : state === 2
            ? <div className="accessory-label red-text" aria-hidden="true">{t('accessories.control.unlocked')}</div>
            : state === 0
              ? <div className="accessory-label red-text" aria-hidden="true">{t('accessories.control.jammed')}</div>
              : null}
      </div>
    </div>
  )
}
