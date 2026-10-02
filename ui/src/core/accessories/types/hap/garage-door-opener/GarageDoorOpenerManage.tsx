import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cx } from '@/core/accessories/types/hap/hap-tile'
import { ManageHeader } from '@/core/accessories/types/hap/manage-parts'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'

export function GarageDoorOpenerManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()
  const lastMovingDirectionRef = useRef<number | undefined>(undefined)

  /**
   * When stopped, resolve to the reverse direction target:
   * Was Closing (3) -> target Open (0), Was Opening (2) -> target Close (1)
   */
  const resolveTargetState = (currentState: number): number => {
    if (currentState === 2 || currentState === 3) {
      lastMovingDirectionRef.current = currentState
    }
    if (currentState === 4 && lastMovingDirectionRef.current !== undefined) {
      return lastMovingDirectionRef.current === 3 ? 0 : 1
    }
    return currentState
  }

  const [targetState, setTargetState] = useState<number>(() => resolveTargetState(initialService.values.CurrentDoorState))

  const m = useManageAccessory(initialService, {
    activeModal,
    onUpdate: service => setTargetState(resolveTargetState(service.values.CurrentDoorState)),
  })

  const onTargetState = (value: number, event: MouseEvent) => {
    void m.service.getCharacteristic!('TargetDoorState')!.setValue!(value)
    m.blurTarget(event)
  }

  const service = m.service
  const stateLabel: Record<number, string> = {
    0: t('accessories.control.open'),
    1: t('accessories.control.closed'),
    2: `${t('accessories.control.opening')}...`,
    3: `${t('accessories.control.closing')}...`,
    4: t('accessories.control.stopped'),
  }

  const button = (value: number, label: string) => (
    <button
      type="button"
      className="btn mb-0 mx-0 p-3 btn-control"
      aria-pressed={targetState === value}
      onClick={event => onTargetState(value, event)}
    >
      <div className="float-start primary-text" aria-hidden="true">
        <i className={cx('fas fa-xl', targetState === value && 'fa-check-circle', targetState !== value && 'fa-blank')}></i>
      </div>
      {label}
      <div className="float-end" aria-hidden="true"><i className="fas fa-xl fa-blank"></i></div>
    </button>
  )

  return (
    <div className="modal-content">
      <ManageHeader title={service.customName || service.serviceName} onClose={m.dismissModal} />
      <div className="modal-body text-center px-5">
        <div className="d-flex justify-content-center mb-4 p-0">
          <div className="mb-0 mx-0 p-3 btn-read w-100" role="status" aria-live="polite" aria-atomic="true">
            {stateLabel[service.values?.CurrentDoorState]}
            {service.values?.ObstructionDetected && ` (${t('accessories.control.obstructed')})`}
          </div>
        </div>
        <div
          className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
          role="group"
          aria-label={t('accessories.control.state_control')}
        >
          {button(0, t('accessories.control.open'))}
          {button(1, t('accessories.control.close'))}
        </div>
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
