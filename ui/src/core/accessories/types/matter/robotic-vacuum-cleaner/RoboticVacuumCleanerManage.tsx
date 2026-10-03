import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'
import type { MouseEvent } from 'react'

import { useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { RvcOperationalState, RvcRunMode } from '@/core/accessories/types/matter/matter-device.constants'
import {
  getCleanModes,
  getCurrentArea,
  getCurrentCleanMode,
  getSelectedAreas,
  getServiceAreas,
  hasCleanModeCluster,
  hasServiceAreaCluster,
} from '@/core/accessories/types/matter/matter-device.utils'
import { MatterManageModal, ModeButton } from '@/core/accessories/types/matter/matter-manage'
import { useStateRef } from '@/core/accessories/types/matter/use-state-ref'
import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'

import './robotic-vacuum-cleaner-manage.scss'

/**
 * The UI mode for an operational state: Running → Cleaning, Paused → Paused
 * (2, no RvcRunMode equivalent), all others → Stopped.
 * @param service - the accessory service
 */
function modeFromService(service: ServiceTypeX): number {
  // Get current operational state from rvcOperationalState cluster
  const operationalState = (service.clusters?.rvcOperationalState?.operationalState as number) ?? RvcOperationalState.Stopped

  if (operationalState === RvcOperationalState.Running) {
    return RvcRunMode.Cleaning
  }
  if (operationalState === RvcOperationalState.Paused) {
    return 2
  }
  return RvcRunMode.Idle
}

interface CleanModeState {
  hasCleanMode: boolean
  cleanModes: Array<{ label: string, mode: number }>
  currentCleanModeId: number
}

interface ServiceAreaState {
  hasServiceArea: boolean
  areas: Array<{ areaId: number, name: string }>
  selectedAreaIds: number[]
  currentAreaId: number | null
}

/**
 * The clean modes, read again on every update. The lists are only replaced
 * while the device reports the cluster (as the Angular modal kept them).
 */
function cleanModeFromService(service: ServiceTypeX, previous?: CleanModeState): CleanModeState {
  const hasCleanMode = hasCleanModeCluster(service)
  if (!hasCleanMode) {
    return { ...(previous ?? { cleanModes: [], currentCleanModeId: 0 }), hasCleanMode }
  }
  return { hasCleanMode, cleanModes: getCleanModes(service), currentCleanModeId: getCurrentCleanMode(service) }
}

function serviceAreaFromService(service: ServiceTypeX, previous?: ServiceAreaState): ServiceAreaState {
  const hasServiceArea = hasServiceAreaCluster(service)
  if (!hasServiceArea) {
    return { ...(previous ?? { areas: [], selectedAreaIds: [], currentAreaId: null }), hasServiceArea }
  }
  return {
    hasServiceArea,
    areas: getServiceAreas(service),
    selectedAreaIds: getSelectedAreas(service),
    currentAreaId: getCurrentArea(service),
  }
}

/** The Matter robotic vacuum modal (Angular `RoboticVacuumCleanerManageComponent`). */
export function RoboticVacuumCleanerManage({ service: initial, activeModal }: AccessoryManageModalProps) {
  const { t } = useTranslation()
  const serviceRef = useRef<ServiceTypeX>(initial)
  const [currentMode, setCurrentMode, currentModeRef] = useStateRef(() => modeFromService(initial))
  const [cleanMode, setCleanModeState, cleanModeRef] = useStateRef(() => cleanModeFromService(initial))
  const [serviceArea, setServiceArea, serviceAreaRef] = useStateRef(() => serviceAreaFromService(initial))

  const manage = useManageAccessory(initial, {
    activeModal,
    onUpdate: (service) => {
      serviceRef.current = service
      setCurrentMode(modeFromService(service))
      setCleanModeState(cleanModeFromService(service, cleanModeRef.current))
      setServiceArea(serviceAreaFromService(service, serviceAreaRef.current))
    },
  })
  const { service, showGenericErrorToast, blurTarget } = manage

  const setMode = async (mode: number, event: MouseEvent) => {
    // Prevent pausing when stopped
    if (mode === RvcOperationalState.Paused && currentModeRef.current === RvcRunMode.Idle) {
      return
    }

    const previousMode = currentModeRef.current

    try {
      setCurrentMode(mode)

      if (mode === RvcRunMode.Idle) {
        // Stop → Set run mode to Idle
        const runModeCluster = serviceRef.current.getCluster?.('rvcRunMode')
        if (!runModeCluster) {
          throw new Error('RvcRunMode cluster not found')
        }
        await runModeCluster.setAttributes({ currentMode: RvcRunMode.Idle })
      } else if (mode === RvcRunMode.Cleaning) {
        // Cleaning → Set run mode to Cleaning
        const runModeCluster = serviceRef.current.getCluster?.('rvcRunMode')
        if (!runModeCluster) {
          throw new Error('RvcRunMode cluster not found')
        }
        await runModeCluster.setAttributes({ currentMode: RvcRunMode.Cleaning })
      } else if (mode === RvcOperationalState.Paused) {
        // Pause → Use operational state
        const cluster = serviceRef.current.getCluster?.('rvcOperationalState')
        if (!cluster) {
          throw new Error('RvcOperationalState cluster not found')
        }
        await cluster.setAttributes({ operationalState: RvcOperationalState.Paused })
      }

      blurTarget(event)
    } catch (error) {
      showGenericErrorToast(error)
      // Revert to previous state on error
      setCurrentMode(previousMode)
    }
  }

  const setCleanMode = async (mode: number, event: MouseEvent) => {
    const previousMode = cleanModeRef.current.currentCleanModeId

    try {
      setCleanModeState({ ...cleanModeRef.current, currentCleanModeId: mode })

      const cluster = serviceRef.current.getCluster?.('rvcCleanMode')
      if (!cluster) {
        throw new Error('RvcCleanMode cluster not found')
      }
      await cluster.setAttributes({ currentMode: mode })
      blurTarget(event)
    } catch (error) {
      showGenericErrorToast(error)
      setCleanModeState({ ...cleanModeRef.current, currentCleanModeId: previousMode })
    }
  }

  const toggleAreaSelection = async (areaId: number) => {
    const previousSelection = [...serviceAreaRef.current.selectedAreaIds]

    try {
      const selected = serviceAreaRef.current.selectedAreaIds
      const next = selected.includes(areaId)
        ? selected.filter(id => id !== areaId)
        : [...selected, areaId]
      setServiceArea({ ...serviceAreaRef.current, selectedAreaIds: next })

      const cluster = serviceRef.current.getCluster?.('serviceArea')
      if (!cluster) {
        throw new Error('ServiceArea cluster not found')
      }
      await cluster.setAttributes({ selectedAreas: next })
    } catch (error) {
      showGenericErrorToast(error)
      setServiceArea({ ...serviceAreaRef.current, selectedAreaIds: previousSelection })
    }
  }

  if (!manage.ready) {
    return null
  }

  // Can only pause if currently cleaning, not when stopped/idle
  const isPauseDisabled = currentMode === RvcRunMode.Idle

  return (
    <MatterManageModal service={service} onDismiss={manage.dismissModal} className="hb-matter-robotic-vacuum-cleaner-manage">
      <div className="modal-body text-center px-5">
        <div className="d-flex justify-content-center mb-4 p-0">
          <div className="mb-0 mx-0 p-3 btn-read w-100">
            {currentMode === 0
              ? t('accessories.control.stopped')
              : currentMode === 2
                ? t('accessories.control.paused')
                : currentMode === 1
                  ? t('accessories.control.cleaning')
                  : null}
          </div>
        </div>
        <div
          className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
          role="group"
          aria-label={t('accessories.control.mode_control')}
        >
          <ModeButton selected={currentMode === 0} onClick={event => void setMode(0, event)}>
            {t('accessories.control.stop')}
          </ModeButton>
          <ModeButton
            selected={currentMode === 2}
            className={isPauseDisabled ? 'btn-pause-disabled' : undefined}
            onClick={event => void setMode(2, event)}
          >
            {t('accessories.control.pause')}
          </ModeButton>
          <ModeButton selected={currentMode === 1} onClick={event => void setMode(1, event)}>
            {t('accessories.control.clean')}
          </ModeButton>
        </div>

        {cleanMode.hasCleanMode && cleanMode.cleanModes.length > 0 && (
          <>
            <h6 className="mt-4">{t('accessories.control.clean_mode')}</h6>
            <div
              className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
              role="group"
              aria-label={t('accessories.control.clean_mode')}
            >
              {cleanMode.cleanModes.map(mode => (
                <ModeButton
                  key={mode.mode}
                  selected={cleanMode.currentCleanModeId === mode.mode}
                  onClick={event => void setCleanMode(mode.mode, event)}
                >
                  {mode.label}
                </ModeButton>
              ))}
            </div>
          </>
        )}

        {serviceArea.hasServiceArea && serviceArea.areas.length > 0 && (
          <>
            <h6 className="mt-4">{t('accessories.control.service_areas')}</h6>
            <div
              className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
              role="group"
              aria-label={t('accessories.control.service_areas')}
            >
              {serviceArea.areas.map((area) => {
                const selected = serviceArea.selectedAreaIds.includes(area.areaId)
                return (
                  <button key={area.areaId} type="button" className="btn mb-0 mx-0 p-3 btn-control" onClick={() => void toggleAreaSelection(area.areaId)}>
                    <div className="float-start primary-text">
                      <i className={`fas fa-xl ${selected ? 'fa-check-circle' : 'fa-blank'}`}></i>
                    </div>
                    {area.name}
                    <div className="float-end">
                      {serviceArea.currentAreaId === area.areaId
                        ? <span className="badge bg-primary">{t('accessories.control.cleaning')}</span>
                        : <i className="fas fa-xl fa-blank"></i>}
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </MatterManageModal>
  )
}
