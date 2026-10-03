import type { MouseEvent, ReactNode } from 'react'

import { ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'

/** The `.modal-header` every HAP manage modal opens with: the accessory name and a close button. */
export function ManageHeader({ title, onClose }: { title: string | undefined, onClose: () => void }) {
  return <ModalHeader title={title} onClose={onClose} />
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
