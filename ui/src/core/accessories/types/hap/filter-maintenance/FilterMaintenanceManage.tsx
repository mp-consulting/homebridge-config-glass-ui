import type { HapManageProps } from '@/core/accessories/types/hap/hap-tile'
import type { MouseEvent } from 'react'

import { useTranslation } from 'react-i18next'

import { ManageHeader } from '@/core/accessories/types/hap/manage-parts'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'

export function FilterMaintenanceManage({ service: initialService, activeModal }: HapManageProps) {
  const { t } = useTranslation()
  // The level is read off the newest service on every live update
  const m = useManageAccessory(initialService, {
    activeModal,
    onSetup: () => m.applySliderGradient('linear-gradient(to right, #d32f2f, #e69533, #42d672, #42d672)'),
  })

  // 1 is the only value HAP accepts for ResetFilterIndication
  const resetFilterLife = (event: MouseEvent) => {
    void m.service.getCharacteristic!('ResetFilterIndication')!.setValue!(1)
    m.blurTarget(event)
  }

  const service = m.service

  return (
    <div className="modal-content">
      <ManageHeader title={service.customName || service.serviceName} onClose={m.dismissModal} />
      <div className="modal-body text-center px-5">
        <h6 className="mb-4">
          {t('accessories.control.filter_level')}
          {': '}
          {service.values?.FilterLifeLevel}
          %
        </h6>
        <Slider min={0} max={100} step={1} disabled value={service.values?.FilterLifeLevel} />
        <div
          className="btn-group-vertical d-flex justify-content-center mt-5 mb-0 p-0"
          role="group"
          aria-label={t('accessories.core.filter_maintenance')}
        >
          <button type="button" className="btn mb-0 mx-0 p-3 btn-control" onClick={resetFilterLife}>
            {t('form.button_reset')}
          </button>
        </div>
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
