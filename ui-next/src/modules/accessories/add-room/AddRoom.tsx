import type { ModalComponentProps } from '@/core/ui/modal'
import type { AddRoomModalData, AddRoomResult } from '@/modules/accessories/modal-data-tokens'
import type { FormEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RequiredIndicator } from '@/core/components/required-indicator/RequiredIndicator'
import { isRoomNameValid } from '@/modules/accessories/room-name'

export type AddRoomProps = AddRoomModalData & ModalComponentProps<AddRoomResult>

export function AddRoom({ activeModal, existingRooms }: AddRoomProps) {
  const { t } = useTranslation()

  // If there are no existing rooms (edge case), this must be the default room
  const noExistingRooms = existingRooms.length === 0
  const [roomName, setRoomName] = useState('')
  const [touched, setTouched] = useState(false)
  const [isDefault, setIsDefault] = useState(noExistingRooms)

  const invalid = !isRoomNameValid(roomName, existingRooms)

  const dismissModal = () => activeModal.dismiss('Dismiss')

  const closeModal = (event?: FormEvent) => {
    event?.preventDefault()
    if (invalid) {
      return
    }
    activeModal.close({
      name: roomName.trim() || '',
      isDefault: isDefault || false,
    })
  }

  return (
    <div className="modal-content">
      <form onSubmit={closeModal}>
        <div className="modal-header">
          <h5 className="modal-title">{t('accessories.button_add_room')}</h5>
          <button
            type="button"
            className="btn-close"
            data-bs-dismiss="modal"
            aria-hidden="true"
            tabIndex={-1}
            onClick={dismissModal}
          >
          </button>
        </div>
        <div className="modal-body">
          <div className="text-center mb-4">
            <i className="fas fa-folder-plus primary-text icon-xl"></i>
          </div>
          <ul className="list-group list-group-box mb-0">
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <span className="mb-2 mb-md-0 w-100 w-md-50" aria-hidden="true">
                {t('accessories.room_name')}
                <RequiredIndicator />
              </span>
              <div className="text-start text-md-end w-100 w-md-50">
                <input
                  id="form-name"
                  autoComplete="off"
                  type="text"
                  className={touched && invalid ? 'form-control custom-input is-invalid' : 'form-control custom-input'}
                  aria-label={t('accessories.room_name')}
                  value={roomName}
                  onChange={event => setRoomName(event.target.value)}
                  onBlur={() => setTouched(true)}
                />
              </div>
            </li>
            <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
              <span className="text-start flex-grow-1 me-3">
                {t('accessories.control.default_room')}
                <RequiredIndicator />
              </span>
              <div className="text-end grey-text d-flex align-items-center">
                <input
                  id="form-default"
                  type="checkbox"
                  className="rendux-input mb-0"
                  aria-label={t('accessories.control.default_room')}
                  checked={isDefault}
                  disabled={noExistingRooms}
                  onChange={event => setIsDefault(event.target.checked)}
                  onKeyUp={(event) => {
                    if (event.key === 'Enter') {
                      closeModal()
                    }
                  }}
                />
                <label htmlFor="form-default" className="rendux-label ms-3"></label>
              </div>
            </li>
          </ul>
        </div>
        <div className="modal-footer justify-content-between">
          <div className="text-start">
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          </div>
          <div className="text-center"></div>
          <div className="text-end">
            <button type="submit" className="btn btn-primary" data-bs-dismiss="modal" disabled={invalid}>
              {t('form.button_save')}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
