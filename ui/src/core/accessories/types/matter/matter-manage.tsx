import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { MouseEvent, ReactNode } from 'react'

import { useTranslation } from 'react-i18next'

import { tileName } from '@/core/accessories/types/matter/matter-tile'
import { ModalHeader } from '@/core/ui/ModalParts'

/**
 * The `.modal-header` every Matter manage modal opens with: the accessory's
 * name and a close button.
 */
export function MatterManageHeader({ service, onDismiss }: { service: ServiceTypeX, onDismiss: () => void }) {
  return <ModalHeader title={tileName(service)} onClose={onDismiss} />
}

/**
 * One row of a `.btn-group-vertical` mode picker: a check on the selected one,
 * a blank icon on the others, and a blank icon on the right to keep the label
 * centred.
 */
export function ModeButton({ selected, onClick, className, children }: {
  selected: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  /** Extra classes for the button. */
  className?: string
  children: ReactNode
}) {
  return (
    <button type="button" className={`btn mb-0 mx-0 p-3 btn-control${className ? ` ${className}` : ''}`} onClick={onClick}>
      <div className="float-start primary-text">
        <i className={`fas fa-xl ${selected ? 'fa-check-circle' : 'fa-blank'}`}></i>
      </div>
      {children}
      <div className="float-end"><i className="fas fa-xl fa-blank"></i></div>
    </button>
  )
}

/** The Off / On picker of the light modals. */
export function LightModeButtons({ targetMode, setTargetMode }: {
  targetMode: boolean
  setTargetMode: (value: boolean, event: MouseEvent) => void
}) {
  const { t } = useTranslation()
  return (
    <div
      className="btn-group-vertical d-flex justify-content-center mb-0 p-0"
      role="group"
      aria-label={t('accessories.control.mode_control')}
    >
      <ModeButton selected={!targetMode} onClick={event => setTargetMode(false, event)}>
        {t('accessories.control.off')}
      </ModeButton>
      <ModeButton selected={targetMode} onClick={event => setTargetMode(true, event)}>
        {t('accessories.control.on')}
      </ModeButton>
    </div>
  )
}
