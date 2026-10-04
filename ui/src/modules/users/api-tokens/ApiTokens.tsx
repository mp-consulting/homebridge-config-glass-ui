import type { ApiToken } from './api-tokens.interface'

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { Confirm } from '@/core/components/confirm/Confirm'
import { formatDate } from '@/core/pipes/date'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { cx } from '@/core/utilities/cx'
import { toastApiError } from '@/core/utilities/http-error'

import { ApiTokenCreate } from './ApiTokenCreate'

const MODAL_OPTIONS = { size: 'lg', backdrop: 'static' } as const

function isExpired(token: ApiToken): boolean {
  return token.expiresAt !== null && Date.parse(token.expiresAt) <= Date.now()
}

/**
 * API tokens (`hbg_…`) for scripts and the Assistant's MCP server: list,
 * create (shown once) and revoke. Shown on the users page, which only
 * administrators can open.
 */
export function ApiTokens() {
  const { t } = useTranslation()
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)

  const reload = useCallback(async () => {
    try {
      setTokens(await api.get<ApiToken[]>('/auth/tokens'))
    } catch (error) {
      console.error(error)
      toastApiError(error)
      setTokens(current => current ?? [])
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const openCreate = async () => {
    try {
      await openModal(ApiTokenCreate, {}, MODAL_OPTIONS).result
      void reload()
    } catch {
      // Dismissed before a token was created
    }
  }

  const revoke = async (token: ApiToken) => {
    try {
      await openModal(Confirm, {
        title: t('users.api_tokens.title_revoke'),
        message: t('users.api_tokens.revoke_confirm', { name: token.name }),
        confirmButtonLabel: t('users.api_tokens.button_revoke'),
        confirmButtonClass: 'btn-danger',
        faIconClass: 'fa-key primary-text',
      }, MODAL_OPTIONS).result
    } catch {
      return
    }
    try {
      await api.delete(`/auth/tokens/${encodeURIComponent(token.id)}`)
      toast.success(t('users.api_tokens.revoked', { name: token.name }), t('toast.title_success'))
    } catch (error) {
      toastApiError(error)
    }
    void reload()
  }

  return (
    <section className="api-tokens mt-2" aria-labelledby="api-tokens-title">
      <div className="row mb-3">
        <div className="col-8">
          <h3 id="api-tokens-title" className="primary-text m-0">{t('users.api_tokens.title')}</h3>
          <p className="small grey-text mb-0">{t('users.api_tokens.description')}</p>
        </div>
        <div className="col-4 text-end">
          <button
            type="button"
            className="btn btn-elegant waves-effect m-0"
            aria-label={t('users.api_tokens.button_create')}
            onClick={() => void openCreate()}
          >
            <i className="fas fa-key" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div className="card card-body">
        {tokens === null && (
          <div className="text-center py-2" role="status">
            <span className="spinner-border spinner-border-sm" aria-hidden="true"></span>
            <span className="visually-hidden">{t('common.a11y.loading')}</span>
          </div>
        )}
        {tokens?.length === 0 && (
          <p className="text-center grey-text mb-0">{t('users.api_tokens.empty')}</p>
        )}
        {tokens && tokens.length > 0 && (
          <div className="table-responsive">
            <table className="table table-sm mb-0 align-middle">
              <thead>
                <tr>
                  <th scope="col">{t('users.api_tokens.label_name')}</th>
                  <th scope="col">{t('users.api_tokens.label_scope')}</th>
                  <th scope="col">{t('users.api_tokens.label_created')}</th>
                  <th scope="col">{t('users.api_tokens.label_expires')}</th>
                  <th scope="col">{t('users.api_tokens.label_last_used')}</th>
                  <th scope="col"><span className="visually-hidden">{t('users.api_tokens.button_revoke')}</span></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map(token => (
                  <tr key={token.id} className={cx(isExpired(token) && 'text-muted')}>
                    <td className="text-break">{token.name}</td>
                    <td>
                      <span className={cx('badge', token.scope === 'admin' ? 'bg-warning text-dark' : 'bg-secondary')}>
                        {token.scope === 'admin' ? t('users.api_tokens.scope_admin') : t('users.api_tokens.scope_read')}
                      </span>
                    </td>
                    <td>{formatDate(token.createdAt, 'mediumDate')}</td>
                    <td>
                      {token.expiresAt === null
                        ? t('users.api_tokens.expiry_never')
                        : isExpired(token)
                          ? t('users.api_tokens.expired')
                          : formatDate(token.expiresAt, 'mediumDate')}
                    </td>
                    <td>{token.lastUsedAt ? formatDate(token.lastUsedAt, 'short') : t('users.api_tokens.never_used')}</td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-elegant btn-sm m-0"
                        aria-label={t('users.api_tokens.revoke_label', { name: token.name })}
                        onClick={() => void revoke(token)}
                      >
                        <i className="fas fa-trash" aria-hidden="true"></i>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
