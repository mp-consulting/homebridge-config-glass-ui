import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ManageModal, ModeButton } from '@/core/accessories/types/hap/manage-parts'
import { televisionInputs } from '@/core/accessories/types/hap/television/television.utils'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { cx } from '@/core/utilities/cx'

export function TelevisionManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()

  const [hasActive, setHasActive] = useState(() => 'Active' in initialService.values)
  const [sourceList] = useState(() => televisionInputs(initialService))

  const m = useManageAccessory(initialService, {
    activeModal,
    onUpdate: (service) => {
      if ('Active' in service.values) {
        setHasActive(true)
      }
    },
  })

  const setActive = (value: number, event: MouseEvent) => {
    void m.service.getCharacteristic!('Active')!.setValue!(value)
    m.blurTarget(event)
  }

  const setInput = (value: number | string, event: MouseEvent) => {
    void m.service.getCharacteristic!('ActiveIdentifier')!.setValue!(value)
    m.blurTarget(event)
  }

  const service = m.service

  return (
    <ManageModal title={service.customName || service.serviceName} onClose={m.dismissModal}>
      <div className="modal-body text-center px-5">
        {hasActive && (
          <div
            // The static mb-4 gives way to mb-0 when there is no input list below
            className={cx('btn-group-vertical d-flex justify-content-center p-0', sourceList.length ? 'mb-4' : 'mb-0')}
            role="group"
            aria-label={t('accessories.control.mode_control')}
          >
            <ModeButton selected={service.values?.Active === 0} onClick={event => setActive(0, event)}>{t('accessories.control.off')}</ModeButton>
            <ModeButton selected={service.values?.Active === 1} onClick={event => setActive(1, event)}>{t('accessories.control.on')}</ModeButton>
          </div>
        )}
        {!!sourceList.length && (
          <>
            {hasActive && <h6>{t('accessories.control.input')}</h6>}
            <div
              className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
              role="group"
              aria-label={t('accessories.control.input_control')}
            >
              {sourceList.map(source => (
                <ModeButton
                  key={source.identifier}
                  selected={service.values?.ActiveIdentifier === source.identifier}
                  onClick={event => setInput(source.identifier, event)}
                >
                  {source.name}
                </ModeButton>
              ))}
            </div>
          </>
        )}
      </div>
    </ManageModal>
  )
}
