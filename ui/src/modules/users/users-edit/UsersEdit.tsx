import type { ModalComponentProps } from '@/core/ui/modal'
import type { UserModalData } from '@/core/ui/modal-data'
import type { FormEvent, MouseEvent } from 'react'

import type { User } from '../users.interface'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { authActions, useAuthStore } from '@/core/auth'
import { RequiredIndicator } from '@/core/components/required-indicator/RequiredIndicator'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toastApiError } from '@/core/utilities/http-error'

import { validateUserForm } from '../user-form'
import { AdminField, UserField } from '../UserFields'

type TextField = 'username' | 'name' | 'password' | 'passwordConfirm'

export type UsersEditProps = UserModalData & ModalComponentProps & { user: User, existingUsers?: User[] }

/**
 * Edit or delete a user.
 *
 * ⚠️ Two safety rails: the last admin cannot be demoted or deleted, or nobody
 * can administer the box again; and renaming *yourself* signs you out, because
 * the token in your browser names a user that no longer exists.
 */
export function UsersEdit({ activeModal, user, existingUsers = [] }: UsersEditProps) {
  const { t } = useTranslation()
  const signedInAs = useAuthStore(state => state.user.username)

  // Fixed for the life of the modal, like the Angular ngOnInit
  const [initialFormValue] = useState(() => ({
    username: user?.username ?? '',
    name: user?.name ?? '',
    password: '',
    passwordConfirm: '',
    admin: user?.admin ?? true,
  }))
  const [isCurrentUser] = useState(() => signedInAs === user?.username)
  const [value, setValue] = useState(initialFormValue)
  const [touched, setTouched] = useState<Partial<Record<TextField, boolean>>>({})
  const [deleteMode, setDeleteMode] = useState(false)

  // Check if this user is an admin and there are no other admins
  const isLastAdmin = Boolean(user?.admin) && existingUsers.filter(existing => existing.admin).length <= 1
  // Cannot delete if it's the current user or the last admin
  const canDelete = !isCurrentUser && !isLastAdmin

  const { errors, valid: fieldsValid } = validateUserForm(value, { existingUsers, ownId: user?.id, passwordRequired: false })
  // A disabled form is not valid (Angular's DISABLED status), so it cannot be saved
  const valid = fieldsValid && !deleteMode
  const invalid = (field: TextField) => Boolean(touched[field] && errors[field])
  const set = (field: keyof typeof value) => (fieldValue: string | boolean) => setValue(current => ({ ...current, [field]: fieldValue }))
  const touch = (field: TextField) => () => setTouched(current => ({ ...current, [field]: true }))

  const isFormUnchanged = () => {
    // A password is never read back, so typing one always counts as a change
    if (value.password) {
      return false
    }
    return JSON.stringify(value) === JSON.stringify(initialFormValue)
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!user) {
      return
    }

    // Handle deletion
    if (deleteMode) {
      try {
        await api.delete(`/users/${user.id}`)
        activeModal.close()
      } catch (error) {
        console.error(error)
        toastApiError(error)
      }
      return
    }

    if (!valid || isFormUnchanged()) {
      return
    }

    // The admin control is disabled for the last admin (it cannot be demoted),
    // and a disabled control stays out of the request body, so the server is
    // never asked to make that change
    const { admin, ...rest } = value
    const body: Partial<User> = isLastAdmin ? rest : { ...rest, admin }

    // Handle update
    try {
      await api.patch(`/users/${user.id}`, body)
      activeModal.close()
      if (isCurrentUser && body.username !== useAuthStore.getState().user.username) {
        authActions.logout()
      }
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
  }

  const toggleDeleteMode = (event: MouseEvent<HTMLButtonElement>) => {
    // The form is locked while delete is armed: nothing on it can be saved
    // from that state. The last admin's switch stays locked either way.
    setDeleteMode(current => !current)
    // Remove focus from the button
    event.currentTarget.blur()
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <form noValidate onSubmit={event => void onSubmit(event)}>
        <ModalHeader title={t('users.title_edit_user')} onClose={dismissModal} />
        <div className="modal-body">
          <div className="text-center mb-4">
            <i className="fas fa-user-pen primary-text icon-xl"></i>
          </div>
          <ul className={`list-group list-group-box${deleteMode ? ' opacity-muted mb-4' : ' mb-0'}`}>
            <UserField
              id="form-username"
              label={t('users.label_username')}
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              value={value.username}
              invalid={invalid('username')}
              disabled={deleteMode}
              onChange={set('username')}
              onBlur={touch('username')}
            />
            <UserField
              id="form-name"
              label={t('users.label_full_name')}
              type="text"
              autoComplete="name"
              value={value.name}
              invalid={invalid('name')}
              disabled={deleteMode}
              onChange={set('name')}
              onBlur={touch('name')}
            />
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="form-pass" className="mb-2 mb-md-0 w-100 w-md-50">
                {t('users.label_new_password')}
                {value.password && (
                  <>
                    {' '}
                    <RequiredIndicator />
                  </>
                )}
              </label>
              <div className="text-start text-md-end w-100 w-md-50">
                <input
                  type="password"
                  autoComplete="new-password"
                  id="form-pass"
                  className={`form-control custom-input${invalid('password') ? ' is-invalid' : ''}`}
                  aria-label={t('users.label_new_password')}
                  value={value.password}
                  disabled={deleteMode}
                  onChange={event => set('password')(event.target.value)}
                  onBlur={touch('password')}
                />
              </div>
            </li>
            {value.password && (
              <UserField
                id="form-pass-confirm"
                label={t('users.label_confirm_password')}
                type="password"
                autoComplete="new-password"
                value={value.passwordConfirm}
                invalid={invalid('passwordConfirm')}
                disabled={deleteMode}
                onChange={set('passwordConfirm')}
                onBlur={touch('passwordConfirm')}
              />
            )}
            <AdminField
              label={t('users.label_admin_user')}
              checked={value.admin}
              // Can't demote the last admin
              disabled={deleteMode || isLastAdmin}
              onChange={set('admin')}
            />
          </ul>
          {deleteMode && (
            <div className="alert alert-warning mb-0">
              <div className="text-center">{t('common.phrases.are_you_sure')}</div>
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
              disabled={!canDelete}
              aria-label={t('users.button_delete_user')}
              onClick={toggleDeleteMode}
            >
              <i className={deleteMode ? 'fas fa-undo' : 'fas fa-trash'}></i>
            </button>
            <button
              type="submit"
              className={`btn ${deleteMode ? 'btn-danger' : 'btn-primary'}`}
              disabled={!deleteMode && (!valid || isFormUnchanged())}
            >
              {t(deleteMode ? 'form.button_delete' : 'form.button_save')}
            </button>
          </div>
        </ModalFooter>
      </form>
    </div>
  )
}
