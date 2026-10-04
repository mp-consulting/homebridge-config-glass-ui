import type { ModalComponentProps } from '@/core/ui/modal'
import type { FormEvent } from 'react'

import type { ApiTokenScope, CreatedApiToken } from './api-tokens.interface'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { fallbackCopyToClipboard } from '@/core/accessories/accessory-info/accessory-info.helpers'
import { api } from '@/core/api'
import { RequiredIndicator } from '@/core/components/required-indicator/RequiredIndicator'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'
import { toastApiError } from '@/core/utilities/http-error'

export type ApiTokenCreateProps = ModalComponentProps

/** The expiry choices, in days; `null` never expires */
const EXPIRY_OPTIONS: Array<{ value: string, days: number | null }> = [
  { value: '30', days: 30 },
  { value: '90', days: 90 },
  { value: '365', days: 365 },
  { value: 'never', days: null },
]

const NAME_MAX_LENGTH = 100

/**
 * Create an API token, then show it once with a copy button. The token is
 * never shown again, so the second step closes (rather than dismisses) the
 * modal and the page re-reads the list either way.
 */
export function ApiTokenCreate({ activeModal }: ApiTokenCreateProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [scope, setScope] = useState<ApiTokenScope>('read')
  const [expiry, setExpiry] = useState('90')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [copied, setCopied] = useState(false)
  const tokenInputRef = useRef<HTMLInputElement>(null)

  const nameInvalid = !name.trim() || name.trim().length > NAME_MAX_LENGTH

  useEffect(() => {
    if (created) {
      tokenInputRef.current?.select()
    }
  }, [created])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (nameInvalid || busy) {
      return
    }
    setBusy(true)
    try {
      const expiresInDays = EXPIRY_OPTIONS.find(x => x.value === expiry)?.days ?? null
      setCreated(await api.post<CreatedApiToken>('/auth/tokens', { name: name.trim(), scope, expiresInDays }))
    } catch (error) {
      toastApiError(error)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!created) {
      return
    }
    try {
      await navigator.clipboard.writeText(created.token)
    } catch {
      fallbackCopyToClipboard(created.token)
    }
    setCopied(true)
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const closeModal = () => activeModal.close(created)

  if (created) {
    return (
      <div className="modal-content api-token-created">
        <ModalHeader title={t('users.api_tokens.title_created')} onClose={closeModal} />
        <div className="modal-body">
          <div className="text-center mb-4">
            <i className="fas fa-key primary-text icon-xl" aria-hidden="true"></i>
          </div>
          <div className="alert alert-warning" role="alert">
            {t('users.api_tokens.created_warning')}
          </div>
          <label htmlFor="api-token-value" className="form-label">{created.name}</label>
          <div className="input-group">
            <input
              ref={tokenInputRef}
              id="api-token-value"
              type="text"
              className="form-control custom-input font-monospace"
              value={created.token}
              readOnly
              onFocus={event => event.target.select()}
            />
            <button
              type="button"
              className="btn btn-primary m-0"
              aria-label={t('common.a11y.copy_to_clipboard')}
              onClick={() => void copy()}
            >
              <i className={cx('fas', copied ? 'fa-check' : 'fa-copy')} aria-hidden="true"></i>
            </button>
          </div>
          {copied && (
            <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
              {t('common.a11y.copied')}
            </span>
          )}
          <p className="small grey-text mt-3 mb-0">{t('users.api_tokens.usage_hint')}</p>
        </div>
        <ModalFooter>
          <div className="text-start"></div>
          <div className="text-center"></div>
          <div className="text-end">
            <button type="button" className="btn btn-primary" onClick={closeModal}>
              {t('users.api_tokens.button_done')}
            </button>
          </div>
        </ModalFooter>
      </div>
    )
  }

  return (
    <div className="modal-content">
      <form noValidate onSubmit={event => void onSubmit(event)}>
        <ModalHeader title={t('users.api_tokens.title_create')} onClose={dismissModal} closeDisabled={busy} />
        <div className="modal-body">
          <div className="text-center mb-4">
            <i className="fas fa-key primary-text icon-xl" aria-hidden="true"></i>
          </div>
          <ul className="list-group list-group-box mb-0">
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="api-token-name" className="mb-2 mb-md-0 w-100 w-md-50">
                {t('users.api_tokens.label_name')}
                <RequiredIndicator />
              </label>
              <div className="text-start text-md-end w-100 w-md-50">
                <input
                  id="api-token-name"
                  type="text"
                  autoComplete="off"
                  maxLength={NAME_MAX_LENGTH}
                  className={cx('form-control custom-input', touched && nameInvalid && 'is-invalid')}
                  value={name}
                  aria-invalid={touched && nameInvalid}
                  onChange={event => setName(event.target.value)}
                  onBlur={() => setTouched(true)}
                />
              </div>
            </li>
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="api-token-scope" className="mb-2 mb-md-0 w-100 w-md-50">
                {t('users.api_tokens.label_scope')}
              </label>
              <div className="text-start text-md-end w-100 w-md-50">
                <select
                  id="api-token-scope"
                  className="form-select"
                  value={scope}
                  onChange={event => setScope(event.target.value as ApiTokenScope)}
                >
                  <option value="read">{t('users.api_tokens.scope_read')}</option>
                  <option value="admin">{t('users.api_tokens.scope_admin')}</option>
                </select>
              </div>
            </li>
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="api-token-expiry" className="mb-2 mb-md-0 w-100 w-md-50">
                {t('users.api_tokens.label_expiry')}
              </label>
              <div className="text-start text-md-end w-100 w-md-50">
                <select
                  id="api-token-expiry"
                  className="form-select"
                  value={expiry}
                  onChange={event => setExpiry(event.target.value)}
                >
                  <option value="30">{t('users.api_tokens.expiry_30_days')}</option>
                  <option value="90">{t('users.api_tokens.expiry_90_days')}</option>
                  <option value="365">{t('users.api_tokens.expiry_365_days')}</option>
                  <option value="never">{t('users.api_tokens.expiry_never')}</option>
                </select>
              </div>
            </li>
          </ul>
          {scope === 'admin' && (
            <p className="small text-warning mt-3 mb-0">{t('users.api_tokens.scope_admin_warning')}</p>
          )}
        </div>
        <ModalFooter>
          <div className="text-start">
            <button type="button" className="btn btn-elegant" data-bs-dismiss="modal" disabled={busy} onClick={dismissModal}>
              {t('form.button_cancel')}
            </button>
          </div>
          <div className="text-center"></div>
          <div className="text-end">
            <button className="btn btn-primary" type="submit" disabled={busy || nameInvalid}>
              {t('users.api_tokens.button_create')}
            </button>
          </div>
        </ModalFooter>
      </form>
    </div>
  )
}
