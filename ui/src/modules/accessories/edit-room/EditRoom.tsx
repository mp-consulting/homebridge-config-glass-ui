import type { ModalComponentProps } from '@/core/ui/modal'
import type { EditRoomModalData, EditRoomResult } from '@/modules/accessories/modal-data-tokens'
import type { FormEvent, MouseEvent } from 'react'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { RequiredIndicator } from '@/core/components/required-indicator/RequiredIndicator'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'
import { deleteTargets, isRoomNameValid } from '@/modules/accessories/room-name'

export type EditRoomProps = EditRoomModalData & ModalComponentProps<EditRoomResult>

export function EditRoom({ activeModal, roomName: initialName, isDefault: initialDefault, existingRooms, currentRoomIndex }: EditRoomProps) {
  const { t } = useTranslation()

  const [roomName, setRoomName] = useState(initialName)
  const [isDefault, setIsDefault] = useState(initialDefault)
  const [touched, setTouched] = useState(false)
  const [deleteMode, setDeleteMode] = useState(false)

  const isOnlyRoom = existingRooms.length === 1
  // Can't uncheck default - must always have exactly one default room
  const defaultLocked = isOnlyRoom || initialDefault
  const invalid = !isRoomNameValid(roomName, existingRooms, currentRoomIndex)
  const isFormUnchanged = roomName === initialName && isDefault === initialDefault
  const { targetRoomName, newDefaultRoomName } = deleteTargets(existingRooms, currentRoomIndex, initialDefault)

  const toggleDeleteMode = (event: MouseEvent<HTMLButtonElement>) => {
    setDeleteMode(!deleteMode)
    // Remove focus from the button
    event.currentTarget.blur()
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  const closeModal = (event?: FormEvent) => {
    event?.preventDefault()
    // In delete mode, we don't need form to be valid
    if (!deleteMode && invalid) {
      return
    }

    if (deleteMode) {
      activeModal.close({ delete: true })
    } else {
      activeModal.close({
        name: roomName.trim() || '',
        isDefault: isDefault || false,
      })
    }
  }

  const listClass = cx('list-group list-group-box', deleteMode && 'opacity-muted', deleteMode ? 'mb-4' : 'mb-0')

  return (
    <div className="modal-content">
      <form onSubmit={closeModal}>
        <ModalHeader title={t('accessories.button_edit_room')} onClose={dismissModal} />
        <div className="modal-body">
          <div className="text-center mb-4">
            <i className="fas fa-pen primary-text icon-xl"></i>
          </div>
          <ul className={listClass}>
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="form-name" className="mb-2 mb-md-0 w-100 w-md-50">
                {t('accessories.room_name')}
                <RequiredIndicator />
              </label>
              <div className="text-start text-md-end w-100 w-md-50">
                <input
                  autoComplete="off"
                  type="text"
                  id="form-name"
                  className={touched && invalid ? 'form-control custom-input is-invalid' : 'form-control custom-input'}
                  value={roomName}
                  disabled={deleteMode}
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
                  type="checkbox"
                  className="rendux-input mb-0"
                  id="form-default"
                  aria-label={t('accessories.control.default_room')}
                  checked={isDefault}
                  disabled={deleteMode || defaultLocked}
                  onChange={event => setIsDefault(event.target.checked)}
                />
                <label htmlFor="form-default" className="rendux-label ms-3"></label>
              </div>
            </li>
          </ul>
          {deleteMode && (
            <div className="alert alert-warning mb-0">
              <div className="text-center">
                {t('common.phrases.are_you_sure')}
                <br />
                <ul className="d-inline-block text-start mb-0">
                  {targetRoomName && <li>{t('accessories.delete_room_move_accessories', { roomName: targetRoomName })}</li>}
                  {initialDefault && newDefaultRoomName && <li>{t('accessories.delete_room_new_default', { roomName: newDefaultRoomName })}</li>}
                </ul>
              </div>
            </div>
          )}
        </div>
        <ModalFooter>
          <div className="text-start">
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          </div>
          <div className="text-center"></div>
          <div className="text-end">
            <button
              type="button"
              className="btn btn-elegant me-2"
              disabled={isOnlyRoom}
              aria-label={t('accessories.button_delete_room')}
              onClick={toggleDeleteMode}
            >
              <i className={deleteMode ? 'fas fa-undo' : 'fas fa-trash'}></i>
            </button>
            <button
              type="submit"
              data-bs-dismiss="modal"
              className={`btn ${deleteMode ? 'btn-danger' : 'btn-primary'}`}
              disabled={!deleteMode && (invalid || isFormUnchanged)}
            >
              {t(deleteMode ? 'form.button_delete' : 'form.button_save')}
            </button>
          </div>
        </ModalFooter>
      </form>
    </div>
  )
}
