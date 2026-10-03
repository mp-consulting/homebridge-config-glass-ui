import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getWindowCoveringOpenPercentage,
  getWindowCoveringPercentage,
  getWindowCoveringTiltPercentage,
  hasWindowCoveringLift,
  hasWindowCoveringTilt,
  setWindowCoveringPosition,
  setWindowCoveringTiltPosition,
} from '@/core/accessories/types/matter/matter-device.utils'
import { MatterManageModal } from '@/core/accessories/types/matter/matter-manage'
import { useStateRef } from '@/core/accessories/types/matter/use-state-ref'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { Slider } from '@/core/components/slider/Slider'

const RANGE = { min: 0, max: 100, step: 1 }

/**
 * A covering may lift, tilt, or do both, so the modal shows only the sliders
 * the device actually has - writing a position it has no feature for is
 * rejected by the cluster.
 * @param service - the accessory service
 */
function supportedFeatures(service: ServiceTypeX) {
  const supportsTilt = hasWindowCoveringTilt(service)
  // A covering with neither feature would leave an empty modal, so fall back
  // to the lift slider rather than showing nothing at all
  const supportsLift = hasWindowCoveringLift(service) || !supportsTilt
  return { supportsLift, supportsTilt }
}

function OpenClosedLabels() {
  const { t } = useTranslation()
  return (
    <div className="d-flex justify-content-between align-items-center mt-0 mb-1">
      <span className="grey-text small">{t('accessories.control.closed')}</span>
      <span className="grey-text small">{t('accessories.control.open')}</span>
    </div>
  )
}

/** The Matter window covering modal (Angular `WindowCoveringManageComponent`). */
export function WindowCoveringManage({ service: initial, activeModal }: AccessoryManageModalProps) {
  const { t } = useTranslation()
  const serviceRef = useRef<ServiceTypeX>(initial)
  const [{ supportsLift, supportsTilt }] = useState(() => supportedFeatures(initial))
  const [targetPosition, setTargetPosition, targetPositionRef] = useStateRef(() => getWindowCoveringPercentage(initial))
  const [targetTilt, setTargetTilt, targetTiltRef] = useStateRef(() => getWindowCoveringTiltPercentage(initial))

  const manage = useManageAccessory(initial, {
    activeModal,
    onUpdate: (service) => {
      serviceRef.current = service
      setTargetPosition(getWindowCoveringPercentage(service))
      setTargetTilt(getWindowCoveringTiltPercentage(service))
    },
  })
  const { service, applySliderGradient, debounce, showGenericErrorToast } = manage

  useEffect(() => {
    applySliderGradient('linear-gradient(to right, #242424, #ffd6aa)')
  }, [applySliderGradient])

  const onTargetPositionChange = (value: number) => {
    setTargetPosition(value)
    debounce('position', value, async () => {
      const previousPosition = getWindowCoveringPercentage(serviceRef.current)
      try {
        await setWindowCoveringPosition(serviceRef.current, targetPositionRef.current)
      } catch (error) {
        showGenericErrorToast(error)
        // Revert to previous value on error
        setTargetPosition(previousPosition)
      }
    })
  }

  const onTargetTiltChange = (value: number) => {
    setTargetTilt(value)
    debounce('tilt', value, async () => {
      const previousTilt = getWindowCoveringTiltPercentage(serviceRef.current)
      try {
        await setWindowCoveringTiltPosition(serviceRef.current, targetTiltRef.current)
      } catch (error) {
        showGenericErrorToast(error)
        // Revert to previous value on error
        setTargetTilt(previousTilt)
      }
    })
  }

  if (!manage.ready) {
    return null
  }

  const currentPosition = getWindowCoveringPercentage(service)
  const currentTilt = getWindowCoveringTiltPercentage(service)
  // What the open/closed summary at the top of the modal reports - the same
  // value the tile shows, so the two cannot drift apart
  const summaryPercentage = getWindowCoveringOpenPercentage(service)

  return (
    <MatterManageModal service={service} onDismiss={manage.dismissModal}>
      <div className="modal-body text-center px-5">
        <div className="d-flex justify-content-center mb-0 p-0">
          <div className="mb-0 mx-0 p-3 btn-read w-100">
            {summaryPercentage === 0
              ? t('accessories.control.closed')
              : summaryPercentage === 100
                ? t('accessories.control.open')
                : `${t('accessories.control.open')} ${summaryPercentage}%`}
          </div>
        </div>
        {supportsLift && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.target')}
              :
              {' '}
              {targetPosition}
              %
            </h6>
            <Slider
              className="mb-1"
              min={RANGE.min}
              max={RANGE.max}
              step={RANGE.step}
              value={targetPosition}
              onChange={value => onTargetPositionChange(value as number)}
            />
            <OpenClosedLabels />
            <h6 className="mt-4">
              {t('accessories.control.current')}
              :
              {' '}
              {currentPosition}
              %
            </h6>
            <Slider className="mb-1" min={0} max={100} step={1} disabled value={currentPosition} />
            <OpenClosedLabels />
          </>
        )}
        {supportsTilt && (
          <>
            <h6 className="mt-4">
              {t('accessories.control.tilt_target')}
              :
              {' '}
              {targetTilt}
              %
            </h6>
            <Slider
              className="mb-1"
              min={RANGE.min}
              max={RANGE.max}
              step={RANGE.step}
              value={targetTilt}
              onChange={value => onTargetTiltChange(value as number)}
            />
            <OpenClosedLabels />
            <h6 className="mt-4">
              {t('accessories.control.tilt_current')}
              :
              {' '}
              {currentTilt}
              %
            </h6>
            <Slider className="mb-1" min={0} max={100} step={1} disabled value={currentTilt} />
            <OpenClosedLabels />
          </>
        )}
      </div>
    </MatterManageModal>
  )
}
