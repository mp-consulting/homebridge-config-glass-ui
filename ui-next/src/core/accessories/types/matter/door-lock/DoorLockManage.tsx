import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'
import type { MouseEvent } from 'react'

import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { DoorLockState } from '@/core/accessories/types/matter/matter-device.constants'
import { getDoorLockState, setDoorLockState } from '@/core/accessories/types/matter/matter-device.utils'
import { MatterManageHeader, ModeButton } from '@/core/accessories/types/matter/matter-manage'
import { useStateRef } from '@/core/accessories/types/matter/use-state-ref'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'

/** The Matter door lock modal (Angular `DoorLockManageComponent`). */
export function DoorLockManage({ service: initial, activeModal }: AccessoryManageModalProps) {
  const { t } = useTranslation()
  const serviceRef = useRef<ServiceTypeX>(initial)
  const [targetMode, setTargetModeState, targetModeRef] = useStateRef(() => getDoorLockState(initial))

  const manage = useManageAccessory(initial, {
    activeModal,
    onUpdate: (service) => {
      serviceRef.current = service
      setTargetModeState(getDoorLockState(service))
    },
  })
  const { service, showGenericErrorToast, blurTarget } = manage

  const setTargetMode = async (value: number, event: MouseEvent) => {
    const previousMode = targetModeRef.current

    try {
      setTargetModeState(value)

      const locked = value === DoorLockState.Locked
      await setDoorLockState(serviceRef.current, locked)

      blurTarget(event)
    } catch (error) {
      showGenericErrorToast(error)
      // Revert to previous state on error
      setTargetModeState(previousMode)
    }
  }

  if (!manage.ready) {
    return null
  }

  return (
    <div className="modal-content">
      <MatterManageHeader service={service} onDismiss={manage.dismissModal} />
      <div className="modal-body text-center px-5">
        <div
          className="btn-group-vertical d-flex justify-content-center p-0"
          role="group"
          aria-label={t('accessories.control.mode_control')}
        >
          <ModeButton selected={targetMode === 1} onClick={event => void setTargetMode(1, event)}>
            {t('accessories.control.lock')}
          </ModeButton>
          <ModeButton selected={targetMode === 2} onClick={event => void setTargetMode(2, event)}>
            {t('accessories.control.unlock')}
          </ModeButton>
        </div>
      </div>
      <div className="modal-footer"></div>
    </div>
  )
}
