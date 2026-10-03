import type { MouseEvent, ReactNode } from 'react'

import { ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'

/**
 * The shell every HAP manage modal renders: the `.modal-content` box, a
 * `.modal-header` with the accessory name and a close button, the modal's
 * body (`children`) and the empty `.modal-footer` the Angular template kept.
 */
export function ManageModal({ title, onClose, className, children }: {
  title: string | undefined
  onClose: () => void
  /** Extra classes for the `.modal-content` box. */
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('modal-content', className)}>
      <ModalHeader title={title} onClose={onClose} />
      {children}
      <div className="modal-footer"></div>
    </div>
  )
}

/**
 * One option of a `.btn-group-vertical` mode picker: a check-circle on the
 * left when selected, a blank icon on the right to keep the label centred.
 */
export function ModeButton({ selected, onClick, children }: {
  selected: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
}) {
  return (
    <button type="button" className="btn mb-0 mx-0 p-3 btn-control" onClick={onClick}>
      <div className="float-start primary-text">
        <i className={cx('fas fa-xl', selected && 'fa-check-circle', !selected && 'fa-blank')}></i>
      </div>
      {children}
      <div className="float-end"><i className="fas fa-xl fa-blank"></i></div>
    </button>
  )
}
