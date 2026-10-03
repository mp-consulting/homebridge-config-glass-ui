import type { ModalComponentProps } from '@/core/ui/modal'
import type { UserModalData } from '@/core/ui/modal-data'

import type { User } from '../users.interface'

import dayjs from 'dayjs'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { QrCode } from '@/core/components/qrcode/QrCode'
import { RequiredIndicator } from '@/core/components/required-indicator/RequiredIndicator'
import { i18n } from '@/core/ui/i18n'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'

import './users-2fa-enable.scss'

interface OtpSetupResponse {
  otpauth: string
  timestamp: string
}

export type Users2faEnableProps = UserModalData & ModalComponentProps & { user: User }

/**
 * A time-based code is derived from the clock, so if the server's clock is out
 * by more than a few seconds every code the user's app produces is rejected.
 * @param timestamp - the server's clock
 * @returns the drift in ms, or null when it is within five seconds either way
 */
function timeDiff(timestamp: string): number | null {
  const diffMs = dayjs(timestamp).diff(new Date(), 'millisecond')
  return diffMs < -5000 || diffMs > 5000 ? diffMs : null
}

/**
 * Set up two factor authentication. Rather than let the user set it up against
 * a drifting server clock and then be locked out, the modal refuses to show the
 * QR code at all and explains the drift instead.
 */
export function Users2faEnable({ activeModal }: Users2faEnableProps) {
  const { t } = useTranslation()
  const [timeDiffError, setTimeDiffError] = useState<number | null>(null)
  const [otpString, setOtpString] = useState<string | undefined>(undefined)
  const [otpSecret, setOtpSecret] = useState<string | undefined>(undefined)
  const [secretCopied, setSecretCopied] = useState(false)
  const [code, setCode] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)

  // Requested once per modal, even though StrictMode runs the effect twice
  const setupRef = useRef<Promise<OtpSetupResponse> | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Validators.required + minLength(6) + maxLength(6)
  const codeInvalid = code.length !== 6

  useEffect(() => {
    let disposed = false
    setupRef.current ??= api.post<OtpSetupResponse>('/users/otp/setup', {})
    setupRef.current.then((data) => {
      if (disposed) {
        return
      }
      const diff = timeDiff(data.timestamp)
      setTimeDiffError(diff)
      if (!diff) {
        setOtpString(data.otpauth)
        setOtpSecret((new URL(data.otpauth)).searchParams.get('secret') || '')
      }
    }).catch((error: unknown) => {
      if (disposed) {
        return
      }
      activeModal.dismiss()
      console.error(error)
      toast.error(i18n.t('users.setup_2fa_enable_error'), i18n.t('toast.title_error'))
    })
    return () => {
      disposed = true
    }
  }, [activeModal])

  useEffect(() => () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const enable2fa = async () => {
    try {
      await api.post('/users/otp/activate', { code })
      activeModal.close()
    } catch (error) {
      console.error(error)
      toast.error(i18n.t('users.setup_2fa_activate_error'), i18n.t('toast.title_error'))
    }
  }

  const copySecretToClipboard = async () => {
    if (!otpSecret) {
      return
    }
    await navigator.clipboard.writeText(otpSecret)
    setSecretCopied(true)

    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current)
    }

    copyTimeoutRef.current = setTimeout(setSecretCopied, 3000, false)
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  const closeButton = (
    <button
      type="button"
      className="btn btn-elegant"
      data-bs-dismiss="modal"
      aria-label={t('form.button_close')}
      onClick={dismissModal}
    >
      {t('form.button_close')}
    </button>
  )

  return (
    <div className="modal-content setup2fa">
      <ModalHeader title={t('users.setup_2fa')} onClose={dismissModal} />
      <div className="modal-body">
        <div className="text-center mb-3">
          <i className="fas fa-key primary-text icon-xl" aria-hidden="true"></i>
        </div>
        <ul className="mb-3">
          <li>{t('users.setup_2fa_warning')}</li>
          {!timeDiffError && <li>{t('users.setup_2fa_scan_qr_code')}</li>}
        </ul>
        {timeDiffError
          ? (
              // <ngb-alert type="error" [dismissible]="false">
              <div role="alert" className="mb-0 alert show alert-error fade">
                <p className="fw-bold mb-1">{t('users.setup_2fa_cannot_setup_2fa')}</p>
                <p className="mb-0">{t('users.setup_2fa_server_time_out', { timeDiffError })}</p>
              </div>
            )
          : (
              <ul className="list-group list-group-box mb-0">
                <li className="list-group-item text-center">
                  <div className="text-center w-100 d-flex justify-content-center my-2">
                    <div className="mx-auto qrcode-size">
                      <QrCode data={otpString ?? ''} />
                    </div>
                  </div>
                  {otpSecret && (
                    <div className="grey-text small mt-0 mb-1">
                      {t('users.setup_2fa_scan_qr_manual')}
                      <br />
                      {otpSecret}
                      <button
                        type="button"
                        className="btn btn-link p-0 ms-1 text-primary align-baseline"
                        aria-label={t('common.a11y.copy_to_clipboard')}
                        onClick={() => void copySecretToClipboard()}
                      >
                        {secretCopied
                          ? <i className="fas fa-check green-text" aria-hidden="true"></i>
                          : <i className="fas fa-copy" aria-hidden="true"></i>}
                      </button>
                      {secretCopied && (
                        <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
                          {t('common.a11y.copied')}
                        </span>
                      )}
                    </div>
                  )}
                </li>
                <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
                  <label htmlFor="enable-2fa-code" className="mb-2 mb-md-0 w-100 w-md-50">
                    {t('users.setup_2fa_enter_code')}
                    <RequiredIndicator />
                  </label>
                  <div className="text-start text-md-end w-100 w-md-50">
                    <input
                      id="enable-2fa-code"
                      type="text"
                      className={`form-control custom-input${codeTouched && codeInvalid ? ' is-invalid' : ''}`}
                      placeholder="eg. 123456"
                      autoComplete="one-time-code"
                      autoCapitalize="none"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={code}
                      onChange={event => setCode(event.target.value)}
                      onBlur={() => setCodeTouched(true)}
                    />
                  </div>
                </li>
              </ul>
            )}
      </div>
      <ModalFooter>
        <div className="text-start">
          {!timeDiffError && closeButton}
        </div>
        <div className="text-center">
          {timeDiffError ? closeButton : null}
        </div>
        <div className="text-end">
          {!timeDiffError && (
            <button
              type="button"
              className="btn btn-primary"
              data-bs-dismiss="modal"
              disabled={codeInvalid}
              onClick={() => void enable2fa()}
            >
              {t('form.button_continue')}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
