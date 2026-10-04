import type { ModalComponentProps } from '@/core/ui/modal'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toastApiError } from '@/core/utilities/http-error'

export interface AuditEntry {
  at: string
  action: string
  actor: { username: string, via: 'session' | 'api-token' | 'service' | 'system', tokenId?: string }
  ok: boolean
  target?: string
  details?: Record<string, unknown>
  error?: string
  ip?: string
}

export interface AuditPage {
  entries: AuditEntry[]
  total: number
  page: number
  limit: number
}

const PAGE_SIZE = 25

/** `GET /api/audit`, newest first, a page at a time, optionally narrowed to an action. */
export function AuditLogModal({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [data, setData] = useState<AuditPage | null>(null)
  // The query the shown data (or error) answers: loading until it matches
  const query = `${page}|${action}`
  const [settled, setSettled] = useState<string | null>(null)
  const loading = settled !== query

  useEffect(() => {
    const controller = new AbortController()
    api.get<AuditPage>('/audit', { params: { page, limit: PAGE_SIZE, action: action || undefined }, signal: controller.signal })
      .then(setData)
      .catch((error) => {
        if (!controller.signal.aborted) {
          toastApiError(error)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSettled(`${page}|${action}`)
        }
      })
    return () => controller.abort()
  }, [page, action])

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))
  const close = () => activeModal.close()

  return (
    <div className="modal-content hb-audit-log">
      <ModalHeader title={t('settings.audit.title')} onClose={close} />
      <div className="modal-body">
        <div className="mb-3">
          <label htmlFor="audit-action-filter" className="form-label small grey-text">{t('settings.audit.filter_action')}</label>
          <select
            id="audit-action-filter"
            className="form-select custom-input"
            value={action}
            onChange={(event) => {
              setAction(event.target.value)
              setPage(1)
            }}
          >
            <option value="">{t('settings.audit.filter_all')}</option>
            <option value="assistant">assistant</option>
            <option value="api-token">api-token</option>
            <option value="config">config</option>
            <option value="plugin">plugin</option>
            <option value="homebridge">homebridge</option>
            <option value="child-bridge">child-bridge</option>
            <option value="backup">backup</option>
            <option value="user">user</option>
          </select>
        </div>
        {!loading && data && data.entries.length === 0 && (
          <p className="grey-text text-center my-4" data-testid="audit-empty">{t('settings.audit.empty')}</p>
        )}
        {data && data.entries.length > 0 && (
          <div className="table-responsive">
            <table className="table table-sm small mb-0" data-testid="audit-table">
              <thead>
                <tr>
                  <th scope="col">{t('settings.audit.col_time')}</th>
                  <th scope="col">{t('settings.audit.col_user')}</th>
                  <th scope="col">{t('settings.audit.col_action')}</th>
                  <th scope="col">{t('settings.audit.col_target')}</th>
                  <th scope="col">{t('settings.audit.col_result')}</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map(entry => (
                  <tr key={`${entry.at}|${entry.action}|${entry.actor.username}|${entry.target ?? ''}`}>
                    <td className="text-nowrap">{new Date(entry.at).toLocaleString()}</td>
                    <td>
                      {entry.actor.username}
                      {entry.actor.via === 'api-token' && <small className="grey-text">{` (${t('settings.audit.via_token')})`}</small>}
                    </td>
                    <td className="font-monospace">{entry.action}</td>
                    <td className="text-break">{entry.target ?? ''}</td>
                    <td title={entry.error}>
                      {entry.ok
                        ? <span className="green-text">{t('settings.audit.ok')}</span>
                        : <span className="red-text">{t('settings.audit.failed')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ModalFooter>
        <span className="small grey-text">{t('settings.audit.page', { page, pages })}</span>
        <div>
          <button type="button" className="btn btn-elegant" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>
            {t('settings.audit.previous')}
          </button>
          <button type="button" className="btn btn-primary" disabled={loading || page >= pages} onClick={() => setPage(page + 1)}>
            {t('settings.audit.next')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
