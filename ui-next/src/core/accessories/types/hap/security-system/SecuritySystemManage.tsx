import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cx } from '@/core/accessories/types/hap/hap-tile'
import { ManageHeader } from '@/core/accessories/types/hap/manage-parts'
import { securityTransition } from '@/core/accessories/types/hap/security-system/security-system.utils'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'

export function SecuritySystemManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()

  const [targetModeValidValues] = useState(() => (initialService.getCharacteristic!('SecuritySystemTargetState')!.validValues as number[] | undefined) ?? [])
  const [targetMode, setTargetMode] = useState<number>(() => initialService.values.SecuritySystemTargetState)

  const m = useManageAccessory(initialService, {
    activeModal,
    onUpdate: service => setTargetMode(service.values.SecuritySystemTargetState),
  })

  const onTargetMode = (value: number, event: MouseEvent) => {
    setTargetMode(value)
    void m.service.getCharacteristic!('SecuritySystemTargetState')!.setValue!(value)
    m.blurTarget(event)
  }

  const service = m.service
  const triggered = service.values?.SecuritySystemCurrentState === 4
  const { isArming, isDisarming } = securityTransition(service)

  let state
  if (triggered) {
    state = t('accessories.control.triggered')
  } else if (isArming) {
    state = `${t('accessories.control.arming')}...`
  } else if (isDisarming) {
    state = `${t('accessories.control.disarming')}...`
  } else if (service.values?.SecuritySystemCurrentState === 3) {
    state = t('accessories.control.off')
  } else {
    state = t('accessories.control.ready')
  }

  const modes: Array<[number, string]> = [
    [3, 'accessories.control.off'],
    [0, 'accessories.control.home'],
    [1, 'accessories.control.away'],
    [2, 'accessories.control.night'],
  ]

  return (
    <div className="modal-content">
      <ManageHeader title={service.customName || service.serviceName} onClose={m.dismissModal} />
      <div className="modal-body text-center px-5">
        <div className="d-flex justify-content-center mb-4 p-0">
          <div className={cx('mb-0 mx-0 p-3 btn-read w-100', triggered && 'text-danger')}>
            {state}
          </div>
        </div>

        <div
          className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
          role="group"
          aria-label={t('accessories.control.mode_control')}
        >
          {modes.filter(([mode]) => targetModeValidValues.includes(mode)).map(([mode, label]) => (
            <button key={mode} type="button" className="btn mb-0 mx-0 p-3 btn-control" onClick={event => onTargetMode(mode, event)}>
              <div className="float-start primary-text">
                <i className={cx('fas fa-xl', targetMode === mode && 'fa-check-circle', targetMode !== mode && 'fa-blank', triggered && 'opacity-muted')}></i>
              </div>
              {t(label)}
              <div className="float-end"><i className="fas fa-xl fa-blank"></i></div>
            </button>
          ))}
        </div>
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
