import type { ModalComponentProps } from '@/core/ui/modal'
import type { AddUserModalData } from '@/core/ui/modal-data'
import type { FormEvent } from 'react'

import type { User } from '../users.interface'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toastApiError } from '@/core/utilities/http-error'

import { validateUserForm } from '../user-form'
import { AdminField, UserField } from '../UserFields'

type TextField = 'username' | 'name' | 'password' | 'passwordConfirm'

export type UsersAddProps = AddUserModalData & ModalComponentProps & { existingUsers: User[] }

/** Add a user. Closes on success; the users page then re-reads the list. */
export function UsersAdd({ activeModal, existingUsers }: UsersAddProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState({ username: '', name: '', password: '', passwordConfirm: '', admin: true })
  const [touched, setTouched] = useState<Partial<Record<TextField, boolean>>>({})

  const { errors, valid } = validateUserForm(value, { existingUsers, passwordRequired: true })
  const invalid = (field: TextField) => Boolean(touched[field] && errors[field])
  const set = (field: keyof typeof value) => (fieldValue: string | boolean) => setValue(current => ({ ...current, [field]: fieldValue }))
  const touch = (field: TextField) => () => setTouched(current => ({ ...current, [field]: true }))

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!valid) {
      return
    }
    try {
      await api.post('/users', value)
      activeModal.close()
    } catch (error) {
      toastApiError(error)
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <form noValidate onSubmit={event => void onSubmit(event)}>
        <ModalHeader title={t('users.title_add_user')} onClose={dismissModal} />
        <div className="modal-body">
          <div className="text-center mb-4">
            <i className="fas fa-user-plus primary-text icon-xl"></i>
          </div>
          <ul className="list-group list-group-box mb-0">
            <UserField
              id="form-username"
              label={t('users.label_username')}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              value={value.username}
              invalid={invalid('username')}
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
              onChange={set('name')}
              onBlur={touch('name')}
            />
            <UserField
              id="form-pass"
              label={t('users.label_password')}
              type="password"
              autoComplete="new-password"
              value={value.password}
              invalid={invalid('password')}
              onChange={set('password')}
              onBlur={touch('password')}
            />
            <UserField
              id="form-pass-confirm"
              label={t('users.label_confirm_password')}
              type="password"
              autoComplete="new-password"
              value={value.passwordConfirm}
              invalid={invalid('passwordConfirm')}
              onChange={set('passwordConfirm')}
              onBlur={touch('passwordConfirm')}
            />
            <AdminField label={t('users.label_admin_user')} checked={value.admin} onChange={set('admin')} />
          </ul>
        </div>
        <ModalFooter>
          <div className="text-start">
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" onClick={dismissModal}>
              {t('form.button_close')}
            </button>
          </div>
          <div className="text-center"></div>
          <div className="text-end">
            <button className="btn btn-primary" type="submit" disabled={!valid}>
              {t('form.button_save')}
            </button>
          </div>
        </ModalFooter>
      </form>
    </div>
  )
}
