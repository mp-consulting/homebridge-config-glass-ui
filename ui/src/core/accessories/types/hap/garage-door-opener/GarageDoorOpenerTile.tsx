import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { GarageDoorOpenerManage } from '@/core/accessories/types/hap/garage-door-opener/GarageDoorOpenerManage'
import { currentConsumption, hasCurrentConsumption } from '@/core/accessories/types/hap/hap-tile'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

import './garage-door-opener.scss'

interface DoorTracking {
  lastDoorState: number | undefined
  lastMovingDirection: number | undefined
  /** The door started moving again after being stopped (the tile animates that differently). */
  fromStopped: boolean
}

function track(previous: DoorTracking, currentState: number | undefined): DoorTracking {
  const wasStopped = previous.lastDoorState === 4
  const moving = currentState === 2 || currentState === 3
  return {
    lastDoorState: currentState,
    lastMovingDirection: moving ? currentState : previous.lastMovingDirection,
    fromStopped: wasStopped && moving,
  }
}

export function GarageDoorOpenerTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const values = service.values
  const cds = values?.CurrentDoorState

  // Follow the door from one state to the next, as the Angular effect did: a
  // stopped door reports neither direction, so the tile remembers which way it
  // was last going (to reverse it) and whether it resumed from a stop
  const [tracking, setTracking] = useState<DoorTracking>(() => track({ lastDoorState: undefined, lastMovingDirection: undefined, fromStopped: false }, cds))
  if (cds !== tracking.lastDoorState) {
    setTracking(track(tracking, cds))
  }

  const hasCDS = 'CurrentDoorState' in values
  const obstructed = !!values?.ObstructionDetected

  const baseStateText = hasCDS
    ? cds === 0
      ? t('accessories.control.open')
      : cds === 1
        ? t('accessories.control.closed')
        : cds === 2
          ? t('accessories.control.opening')
          : cds === 3
            ? t('accessories.control.closing')
            : cds === 4
              ? t('accessories.control.stopped')
              : ''
    : values?.On || values?.Active
      ? t('accessories.control.open')
      : t('accessories.control.closed')
  const stateText = obstructed ? `${baseStateText} (${t('accessories.control.obstructed')})` : baseStateText

  const srBaseName = (service.customName || service.serviceName || '').trim()
  const srType = t('accessories.core.garage_door_opener')
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  const srText = `${srBaseName + (includeType ? `, ${srType}` : '')}, ${stateText}`

  const onClick = () => {
    if (!readyForControl) {
      return
    }

    if ('TargetDoorState' in service.values) {
      const currentState = service.values.CurrentDoorState
      // If Current is Closed, click -> Target is Open
      // If Current is Opening, click -> Target is Close
      // If Current is Open, click -> Target is Closed
      // If Current is Closing, click -> Target is Open
      // If Current is Stopped, reverse the last moving direction
      if (currentState === 4) {
        // Was Closing -> Open, was Opening -> Close
        void service.getCharacteristic!('TargetDoorState').setValue!(tracking.lastMovingDirection === 3 ? 0 : 1)
      } else if (currentState === 1 || currentState === 3) {
        void service.getCharacteristic!('TargetDoorState').setValue!(0)
      } else {
        void service.getCharacteristic!('TargetDoorState').setValue!(1)
      }
    } else if ('On' in service.values) {
      void service.getCharacteristic!('On').setValue!(!service.values.On)
    } else if ('Active' in service.values) {
      void service.getCharacteristic!('Active').setValue!(!service.values.Active)
    }
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    if ('TargetDoorState' in service.values) {
      openModal(GarageDoorOpenerManage, { service }, { size: 'md', backdrop: 'static' })
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })
  const obstructedSuffix = obstructed && ` (${t('accessories.control.obstructed')})`

  let label
  if (hasCDS) {
    switch (cds) {
      case 0:
        label = (
          <div className="accessory-label red-text" aria-hidden="true">
            {t('accessories.control.open')}
            {obstructedSuffix}
          </div>
        )
        break
      case 1:
        label = (
          <div className={cx('accessory-label', !obstructed && 'grey-text', obstructed && 'red-text')} aria-hidden="true">
            {t('accessories.control.closed')}
            {obstructedSuffix}
          </div>
        )
        break
      case 2:
        label = (
          <div className="accessory-label red-text" aria-hidden="true">
            {`${t('accessories.control.opening')}...`}
            {obstructedSuffix}
          </div>
        )
        break
      case 3:
        label = (
          <div className="accessory-label red-text" aria-hidden="true">
            {`${t('accessories.control.closing')}...`}
            {obstructedSuffix}
          </div>
        )
        break
      case 4:
        label = (
          <div className="accessory-label red-text" aria-hidden="true">
            {t('accessories.control.stopped')}
            {obstructedSuffix}
          </div>
        )
        break
    }
  } else if (values?.On || values?.Active) {
    label = (
      <div className="accessory-label red-text" aria-hidden="true">
        {t('accessories.control.open')}
        {hasCurrentConsumption(service) && ` · ${currentConsumption(service)}W`}
      </div>
    )
  } else {
    label = <div className="accessory-label grey-text" aria-hidden="true">{t('accessories.control.closed')}</div>
  }

  return (
    <div
      ref={pressRef}
      className={cx(
        'accessory-box hb-garage-door-opener',
        (values?.ObstructionDetected || [0, 2, 3, 4].includes(cds) || values?.On || values?.Active) && 'accessory-on',
        cds === 2 && 'opening',
        cds === 0 && 'open',
        cds === 3 && 'closing',
        cds === 1 && 'closed',
        cds === 4 && 'stopped',
        tracking.fromStopped && 'from-stopped',
        obstructed && 'obstructed',
        readyForControl && 'cursor-pointer',
      )}
      role="button"
      tabIndex={0}
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
            {/* circle in roof */}
            <circle className="window" cx="15.5" cy="10.25" r="3" fill="#1976d2" fillOpacity="0.5" />
            <circle cx="15.5" cy="10.25" r="3" stroke="#7f7f7f" strokeWidth="0.5" fill="none" />
            {/* left roof line */}
            <line x1="1" y1="12" x2="15" y2="1" stroke="#7f7f7f" strokeWidth="1.5" strokeLinecap="round" />
            {/* right roof line */}
            <line x1="31" y1="12" x2="16" y2="1" stroke="#7f7f7f" strokeWidth="1.5" strokeLinecap="round" />
            {/* roof summit */}
            <circle cx="15.5" cy="1.3" r="0.5" stroke="#7f7f7f" strokeWidth="1.5" />
            {/* side left line */}
            <line x1="3" y1="11" x2="3" y2="31" stroke="#7f7f7f" strokeWidth="1.5" strokeLinecap="round" />
            {/* right side line */}
            <line x1="29" y1="11" x2="29" y2="31" stroke="#7f7f7f" strokeWidth="1.5" strokeLinecap="round" />
            {/* bottom left horizontal line */}
            <line x1="3" y1="31" x2="6" y2="31" stroke="#7f7f7f" strokeWidth="1.5" strokeLinecap="round" />
            {/* bottom right horizontal line */}
            <line x1="26" y1="31" x2="29" y2="31" stroke="#7f7f7f" strokeWidth="1.5" strokeLinecap="round" />
            {/* left garage line */}
            <line x1="6" y1="17" x2="6" y2="31" stroke="#7f7f7f" strokeWidth="1.5" />
            {/* right garage line */}
            <line x1="26" y1="17" x2="26" y2="31" stroke="#7f7f7f" strokeWidth="1.5" />
            {/* garage door lines */}
            <line x1="5.25" y1="17" x2="26.75" y2="17" stroke="#7f7f7f" strokeWidth="1" />
            <line
              className="line line1"
              x1="6.75"
              y1="18"
              x2="25.25"
              y2="18"
              stroke="#1976d2"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
            <line className="line line2" x1="5.25" y1="19" x2="26.75" y2="19" stroke="#7f7f7f" strokeWidth="1" />
            <line
              className="line line3"
              x1="6.75"
              y1="20"
              x2="25.25"
              y2="20"
              stroke="#1976d2"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
            <line className="line line4" x1="5.25" y1="21" x2="26.75" y2="21" stroke="#7f7f7f" strokeWidth="1" />
            <line
              className="line line5"
              x1="6.75"
              y1="22"
              x2="25.25"
              y2="22"
              stroke="#1976d2"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
            <line className="line line6" x1="5.25" y1="23" x2="26.75" y2="23" stroke="#7f7f7f" strokeWidth="1" />
            <line
              className="line line7"
              x1="6.75"
              y1="24"
              x2="25.25"
              y2="24"
              stroke="#1976d2"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
            <line className="line line8" x1="5.25" y1="25" x2="26.75" y2="25" stroke="#7f7f7f" strokeWidth="1" />
            <line
              className="line line9"
              x1="6.75"
              y1="26"
              x2="25.25"
              y2="26"
              stroke="#1976d2"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
            <line className="line line10" x1="5.25" y1="27" x2="26.75" y2="27" stroke="#7f7f7f" strokeWidth="1" />
            <line
              className="line line11"
              x1="6.75"
              y1="28"
              x2="25.25"
              y2="28"
              stroke="#1976d2"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
            <line className="line line12" x1="5.25" y1="29" x2="26.75" y2="29" stroke="#7f7f7f" strokeWidth="1" />
            <line
              className="line line13"
              x1="6.75"
              y1="30"
              x2="25.25"
              y2="30"
              stroke="#1976d2"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
            <line className="line line14" x1="5.25" y1="31" x2="26.75" y2="31" stroke="#7f7f7f" strokeWidth="1" />
          </svg>
        </div>
        <div className="accessory-label mt-auto" aria-hidden="true">{service.customName || service.serviceName}</div>
        {label}
      </div>
    </div>
  )
}
