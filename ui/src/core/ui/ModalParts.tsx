import type { MouseEventHandler, ReactNode } from 'react'

import { useId } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The `.modal-header` the app's modals open with (the NgbModal template every
 * Angular modal repeated): the title and a Bootstrap close button.
 *
 *     <div class="modal-header">
 *       <h5 class="modal-title" id="…">Title</h5>
 *       <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
 *     </div>
 *
 * The title always has an id (`titleId`, else a generated one): `<ModalHost/>`
 * names the dialog after the `.modal-title` it finds inside it.
 */
export function ModalHeader({ title, onClose, titleId, closeDisabled, children }: {
  title: ReactNode
  onClose: MouseEventHandler<HTMLButtonElement>
  /** The title's id (generated when not given); the dialog is labelled by it. */
  titleId?: string
  /** Disable the close button (while the modal is busy). */
  closeDisabled?: boolean
  /** Extra header content, rendered between the title and the close button. */
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const generatedId = useId()
  return (
    <div className="modal-header">
      <h5 className="modal-title" id={titleId ?? generatedId}>{title}</h5>
      {children}
      <button
        type="button"
        className="btn-close"
        data-bs-dismiss="modal"
        aria-label={t('form.button_close')}
        disabled={closeDisabled}
        onClick={onClose}
      >
      </button>
    </div>
  )
}

/** The `.modal-footer`, its buttons spread apart (`justify-content-between`) unless `justify` says otherwise. */
export function ModalFooter({ justify = 'between', children }: {
  justify?: 'between' | 'center'
  children?: ReactNode
}) {
  return <div className={`modal-footer justify-content-${justify}`}>{children}</div>
}
