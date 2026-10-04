import type { ModalRef } from '@/core/ui/modal'

import type { User } from './users.interface'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'

import { api } from '@/core/api'
import { useAuthStore } from '@/core/auth'
import { settingsActions } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { cx } from '@/core/utilities/cx'
import { toastApiError } from '@/core/utilities/http-error'

import { ApiTokens } from './api-tokens/ApiTokens'
import { Users2faDisable } from './users-2fa-disable/Users2faDisable'
import { Users2faEnable } from './users-2fa-enable/Users2faEnable'
import { UsersAdd } from './users-add/UsersAdd'
import { UsersEdit } from './users-edit/UsersEdit'
import { UsersSupport } from './users-support/UsersSupport'

const MODAL_OPTIONS = { size: 'lg', backdrop: 'static' } as const

/** The UI's own accounts, with add / edit / 2FA modals. */
export function Users() {
  const { t } = useTranslation()
  const resolved = useLoaderData() as User[] | undefined
  const username = useAuthStore(state => state.user.username)
  const [homebridgeUsers, setHomebridgeUsers] = useState<User[]>(() => resolved ?? [])

  useEffect(() => {
    // Set page title
    settingsActions.setPageTitle(i18n.t('users.title_users'))
  }, [])

  const reloadUsers = async () => {
    try {
      setHomebridgeUsers(await api.get<User[]>('/users'))
    } catch (error) {
      // Without surfacing the failure, the user list silently stays on its
      // pre-mutation snapshot — the user just added a person who appears to
      // have vanished.
      console.error(error)
      toastApiError(error)
    }
  }

  /** Re-read the list once a modal closes with a change. */
  const reloadOnClose = async (ref: ModalRef) => {
    try {
      await ref.result
      void reloadUsers()
    } catch {
      // Modal dismissed, do nothing
    }
  }

  const openAddNewUser = () => reloadOnClose(openModal(UsersAdd, { existingUsers: homebridgeUsers }, MODAL_OPTIONS))
  const openEditUser = (user: User) => reloadOnClose(openModal(UsersEdit, { user, existingUsers: homebridgeUsers }, MODAL_OPTIONS))
  const setup2fa = (user: User) => reloadOnClose(openModal(Users2faEnable, { user }, MODAL_OPTIONS))
  const disable2fa = (user: User) => reloadOnClose(openModal(Users2faDisable, { user }, MODAL_OPTIONS))
  const openSupport = () => {
    openModal(UsersSupport, {}, MODAL_OPTIONS)
  }

  return (
    <>
      <div className="row mb-3">
        <div className="col-6">
          <h3 className="primary-text m-0">{t('users.title_users')}</h3>
        </div>
        <div className="col-6 text-end">
          <button
            type="button"
            className="btn btn-elegant waves-effect m-0 me-2"
            aria-label={t('users.button_add_user')}
            onClick={() => void openAddNewUser()}
          >
            <i className="fas fa-user-plus" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            className="btn btn-elegant my-0 me-0"
            aria-label={t('support.title')}
            onClick={openSupport}
          >
            <i className="far fa-circle-question" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div className="row">
        {homebridgeUsers.map(user => (
          <div key={user.id} className="col-md-6 mb-4">
            <div className="card card-body">
              <div className="d-flex flex-column">
                <div className="d-flex flex-row mb-3">
                  <span className="me-auto my-0">
                    <h4>{user.name}</h4>
                    <h5 className="small text-truncate grey-text">
                      <i className={cx('fas', user.admin ? 'fa-user-secret' : 'fa-user')} aria-hidden="true"></i>
                      {' '}
                      {user.username}
                    </h5>
                  </span>
                </div>
                <div className="d-flex flex-row justify-content-between">
                  {user.admin
                    ? (user.otpActive
                        ? (
                            <button
                              type="button"
                              className="btn btn-elegant m-0"
                              disabled={user.username !== username}
                              onClick={() => void disable2fa(user)}
                            >
                              {t('users.setup_2fa_disable')}
                            </button>
                          )
                        : (
                            <button
                              type="button"
                              className="btn btn-primary m-0"
                              disabled={user.username !== username}
                              onClick={() => void setup2fa(user)}
                            >
                              {t('users.setup_2fa')}
                            </button>
                          ))
                    : <div></div>}
                  <div>
                    <button
                      type="button"
                      className="btn btn-elegant m-0"
                      aria-label={t('form.button_edit')}
                      onClick={() => void openEditUser(user)}
                    >
                      <i className="fas fa-user-pen" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <ApiTokens />
    </>
  )
}
