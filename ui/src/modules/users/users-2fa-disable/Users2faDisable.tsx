import type { ModalComponentProps } from '@/core/ui/modal'
import type { UserModalData } from '@/core/ui/modal-data'

import type { User } from '../users.interface'

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { authActions } from '@/core/auth'
import { RequiredIndicator } from '@/core/components/required-indicator/RequiredIndicator'
import { notifications } from '@/core/notifications'
import { i18n } from '@/core/ui/i18n'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'

import './users-2fa-disable.scss'

export type Users2faDisableProps = Partial<UserModalData> & ModalComponentProps & { user?: User }

/** Turn two factor authentication off; needs the current password. */
export function Users2faDisable({ activeModal }: Users2faDisableProps) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const [invalidCredentials, setInvalidCredentials] = useState(false)

  // Validators.required
  const passwordInvalid = !password

  const disable2fa = async () => {
    setInvalidCredentials(false)
    try {
      await api.post('/users/otp/deactivate', { password })

      activeModal.close()
      toast.success(i18n.t('users.setup_2fa_disable_success'), i18n.t('toast.title_success'))

      // Clear the legacy OTP notification immediately
      notifications.set('legacyOtpDetected', false)

      // Force a token refresh to get updated user data without otpLegacySecret flag
      try {
        await authActions.refreshSession('profile-update')
      } catch (err) {
        // Silently fail - the stale flag will be cleared on next login
        console.error('Failed to refresh session after disabling 2FA:', err)
      }
    } catch {
      // Turning two factor off is a security downgrade, so a wrong password
      // must not be left in the box for a second casual press of the button
      setPassword('')
      setInvalidCredentials(true)
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content modal-content-min-h">
      <ModalHeader title={t('users.setup_2fa_disable')} onClose={dismissModal} />
      <div className="modal-body">
        <div className="text-center mb-3">
          <i className="fas fa-key primary-text icon-xl"></i>
        </div>
        <ul className="mb-3">
          <li>{t('users.setup_2fa_disable_current_password')}</li>
        </ul>
        <ul className="list-group list-group-box mb-0">
          <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
            <label htmlFor="disable-2fa-password" className="mb-2 mb-md-0 w-100 w-md-50">
              {t('users.label_password')}
              <RequiredIndicator />
            </label>
            <div className="text-start text-md-end w-100 w-md-50">
              <input
                id="disable-2fa-password"
                className={`form-control custom-input${touched && passwordInvalid ? ' is-invalid' : ''}`}
                type="password"
                autoComplete="current-password"
                placeholder={t('users.label_password')}
                value={password}
                onChange={event => setPassword(event.target.value)}
                onBlur={() => setTouched(true)}
              />
            </div>
          </li>
        </ul>
        {invalidCredentials && !password && (
          // <ngb-alert type="error" class="mt-3 mb-0" [dismissible]="false">
          <div role="alert" className="mt-3 mb-0 alert show alert-error fade">
            <p className="mb-0">{t('login.invalid_password')}</p>
          </div>
        )}
      </div>
      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button
            type="button"
            className="btn btn-danger"
            data-bs-dismiss="modal"
            disabled={passwordInvalid}
            onClick={() => void disable2fa()}
          >
            {t('form.button_continue')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
