import type { McpClientSnippets, McpGeneratedToken, McpSettingsUpdate, McpStatus } from '@/core/ai/ai.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { fallbackCopyToClipboard } from '@/core/accessories/accessory-info/accessory-info.helpers'
import { api } from '@/core/api'
import { openModal } from '@/core/ui/modal'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'
import { toastApiError } from '@/core/utilities/http-error'
import { CONTROL_WRAP, INNER_BLOCK, INNER_FLEX, SaveIndicator, SettingRow } from '@/modules/settings/sections/rows'
import { useSettingsPageState } from '@/modules/settings/settings-page.context'

const INPUT = 'form-control custom-input resp-input order-1 order-md-2'
const MODAL_OPTIONS = { size: 'lg', backdrop: 'static' } as const

/** A host name or an IP address, as the server accepts it. */
const RE_HOST = /^(?:[\w-]+(?:\.[\w-]+)*|[\d.]+|[\da-f:.]+)$/i

type Client = keyof McpClientSnippets
type Transport = 'http' | 'stdio'

const CLIENTS: Array<{ key: Client, label: string }> = [
  { key: 'claudeDesktop', label: 'Claude Desktop' },
  { key: 'claudeCode', label: 'Claude Code' },
  { key: 'cursor', label: 'Cursor' },
]

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    fallbackCopyToClipboard(text)
  }
}

/**
 * Whether the server is pointed somewhere other than this UI on this machine
 * (creating the access token fills in the default, so that one does not count).
 */
function customHomebridgeUrl(http: McpStatus['http']) {
  return http.homebridgeUrl !== '' && http.homebridgeUrl !== http.defaultHomebridgeUrl
}

/** The address the browser reached Glass UI at, for the client snippets. */
function origin() {
  return { origin: window.location.origin }
}

/**
 * The client token, shown once after it is generated. Closing it is the only
 * way out: the token cannot be read back later.
 */
export function McpTokenDialog({ activeModal, token }: ModalComponentProps & { token: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const close = () => activeModal.close(true)

  return (
    <div className="modal-content hb-mcp-token-created">
      <ModalHeader title={t('ai.mcp.token_title_created')} onClose={close} />
      <div className="modal-body">
        <div className="text-center mb-4">
          <i className="fas fa-key primary-text icon-xl" aria-hidden="true"></i>
        </div>
        <div className="alert alert-warning" role="alert">
          {t('users.api_tokens.created_warning')}
        </div>
        <label htmlFor="mcp-token-value" className="form-label">{t('ai.mcp.token')}</label>
        <div className="input-group">
          <input
            ref={inputRef}
            id="mcp-token-value"
            type="text"
            className="form-control custom-input font-monospace"
            value={token}
            readOnly
            onFocus={event => event.target.select()}
          />
          <button
            type="button"
            className="btn btn-primary m-0"
            aria-label={t('common.a11y.copy_to_clipboard')}
            onClick={() => void copyText(token).then(() => setCopied(true))}
          >
            <i className={cx('fas', copied ? 'fa-check' : 'fa-copy')} aria-hidden="true"></i>
          </button>
        </div>
        {copied && (
          <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
            {t('common.a11y.copied')}
          </span>
        )}
        <p className="small grey-text mt-3 mb-0">{t('ai.mcp.token_created_hint')}</p>
      </div>
      <ModalFooter>
        <div className="text-start"></div>
        <div className="text-center"></div>
        <div className="text-end">
          <button type="button" className="btn btn-primary" onClick={close}>
            {t('users.api_tokens.button_done')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}

/**
 * The HTTP MCP server (run by the Homebridge AI Kit plugin from the
 * `mcp.http` settings): on/off, address, the token clients send, the Glass UI
 * API token its tools use, and ready-made client configurations. Secrets are
 * write-only: the client token is shown once, when it is generated.
 */
export function McpServerSettings() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [homebridgeUrl, setHomebridgeUrl] = useState('')
  const [customToken, setCustomToken] = useState('')
  const [scope, setScope] = useState<'read' | 'admin'>('read')
  const [saving, setSaving] = useState<string | null>(null)
  const [transport, setTransport] = useState<Transport>('http')
  const [client, setClient] = useState<Client>('claudeDesktop')
  // The token generated in this visit, and snippets with it (never kept beyond)
  const [fresh, setFresh] = useState<{ token: string, snippets: McpClientSnippets } | null>(null)
  const [includeToken, setIncludeToken] = useState(false)
  const [copied, setCopied] = useState(false)
  // The Glass UI address sits under Advanced: closed unless one was set by hand
  const [advanced, setAdvanced] = useState<boolean | null>(null)
  // A settings search that matches it opens it too
  const searchShowsAdvanced = useSettingsPageState(state => state.searchQuery.trim() !== '' && !state.hiddenItems['setting-ai-mcp-url'])

  const apply = (next: McpStatus | undefined) => {
    if (!next?.http) {
      return
    }
    setStatus(next)
    setHost(next.http.host)
    setPort(String(next.http.port))
    setHomebridgeUrl(next.http.homebridgeUrl)
    setAdvanced(open => open ?? customHomebridgeUrl(next.http))
  }

  useEffect(() => {
    api.get<McpStatus>('/ai/mcp', { params: origin() }).then(apply, toastApiError)
  }, [])

  const run = async (field: string, request: () => Promise<McpStatus | undefined>) => {
    setSaving(field)
    try {
      apply(await request())
      return true
    } catch (error) {
      toastApiError(error)
      return false
    } finally {
      setSaving(null)
    }
  }

  const save = (field: string, update: McpSettingsUpdate) => run(field, () => api.put<McpStatus>('/ai/mcp', update, { params: origin() }))

  if (!status) {
    return null
  }
  const http = status.http
  const hostInvalid = !RE_HOST.test(host.trim())
  const portNumber = Number(port)
  const portInvalid = !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535
  const busy = saving !== null
  const showAdvanced = Boolean(advanced) || searchShowsAdvanced

  const generate = async () => {
    setSaving('token')
    try {
      const result = await api.post<McpGeneratedToken>('/ai/mcp/token', {}, { params: origin() })
      apply(result.status)
      setFresh({ token: result.token, snippets: result.snippets })
      setIncludeToken(true)
      setTransport('http')
      await openModal(McpTokenDialog, { token: result.token }, MODAL_OPTIONS).result.catch(() => {})
    } catch (error) {
      toastApiError(error)
    } finally {
      setSaving(null)
    }
  }

  const clearToken = async () => {
    if (await run('token', () => api.delete<McpStatus>('/ai/mcp/token', { params: origin() }))) {
      setFresh(null)
      setIncludeToken(false)
    }
  }

  const saveCustomToken = async () => {
    const token = customToken.trim()
    if (token && await save('customToken', { token })) {
      setCustomToken('')
      setFresh(null)
      setIncludeToken(false)
    }
  }

  const access = http.homebridgeToken
  const accessText = !access.set
    ? t('ai.mcp.access_none')
    : access.exists === false
      ? t('ai.mcp.access_revoked')
      : access.scope === 'admin'
        ? t('ai.mcp.access_admin')
        : access.scope === 'read'
          ? t('ai.mcp.access_read')
          : t('ai.mcp.access_custom')

  const snippets = transport === 'stdio'
    ? status.snippets.stdio
    : includeToken && fresh ? fresh.snippets : status.snippets.http
  const snippet = snippets[client]

  return (
    <>
      <SettingRow item="setting-ai-mcp-enabled">
        <div className={INNER_FLEX}>
          <span>
            <strong>{t('ai.mcp.title')}</strong>
            <br />
            <small className="grey-text pe-2">
              {t('ai.mcp.desc')}
              {status.pluginInstalled === false && <span className="d-block text-warning mt-1" role="note">{t('ai.mcp.plugin_missing')}</span>}
            </small>
          </span>
          <div className="d-flex align-items-center">
            <div className="order-1 order-md-2">
              <input
                type="checkbox"
                className="rendux-input"
                id="aiMcpEnabled"
                checked={http.enabled}
                disabled={busy}
                aria-label={t('ai.mcp.enabled')}
                onChange={event => void save('enabled', { enabled: event.target.checked })}
              />
              <label htmlFor="aiMcpEnabled" className="rendux-label ms-3 min-w-50"></label>
            </div>
            <SaveIndicator show={saving === 'enabled'} />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-ai-mcp-address">
        <div className={INNER_BLOCK}>
          <span>
            <label htmlFor="aiMcpHost">{t('ai.mcp.address')}</label>
            <br />
            <small className="grey-text pe-2">{t('ai.mcp.address_desc')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <input
              id="aiMcpHost"
              type="text"
              className={cx(INPUT, 'font-monospace', hostInvalid && 'is-invalid')}
              value={host}
              maxLength={253}
              placeholder="127.0.0.1"
              aria-label={t('ai.mcp.host')}
              aria-invalid={hostInvalid}
              onChange={event => setHost(event.target.value)}
              onBlur={() => !hostInvalid && host.trim() !== http.host && void save('host', { host: host.trim() })}
            />
            <input
              id="aiMcpPort"
              type="number"
              className={cx('form-control custom-input font-monospace ms-2 order-2 order-md-3 hb-mcp-port', portInvalid && 'is-invalid')}
              value={port}
              min={1}
              max={65535}
              aria-label={t('ai.mcp.port')}
              aria-invalid={portInvalid}
              onChange={event => setPort(event.target.value)}
              onBlur={() => !portInvalid && portNumber !== http.port && void save('port', { port: portNumber })}
            />
            <SaveIndicator show={saving === 'host' || saving === 'port'} />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-ai-mcp-token">
        <div className={INNER_BLOCK}>
          <span>
            <label htmlFor="aiMcpCustomToken">{t('ai.mcp.token')}</label>
            <br />
            <small className="grey-text pe-2" data-testid="mcp-token-state">
              {http.hasToken ? t('ai.mcp.token_set') : t('ai.mcp.token_none')}
            </small>
          </span>
          <div className={CONTROL_WRAP}>
            <input
              id="aiMcpCustomToken"
              type="password"
              className={`${INPUT} font-monospace`}
              value={customToken}
              maxLength={512}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={http.hasToken ? '••••••••' : t('ai.mcp.token_paste')}
              onChange={event => setCustomToken(event.target.value)}
              onBlur={() => void saveCustomToken()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void saveCustomToken()
                }
              }}
            />
            <button type="button" className="btn btn-primary btn-sm ms-2 order-3 text-nowrap" disabled={busy} onClick={() => void generate()}>
              {http.hasToken ? t('ai.mcp.token_regenerate') : t('ai.mcp.token_generate')}
            </button>
            {http.hasToken && (
              <button type="button" className="btn btn-elegant btn-sm ms-2 order-3 text-nowrap" disabled={busy} onClick={() => void clearToken()}>
                {t('ai.mcp.token_clear')}
              </button>
            )}
            <SaveIndicator show={saving === 'token' || saving === 'customToken'} />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-ai-mcp-access">
        <div className={INNER_BLOCK}>
          <span>
            <label htmlFor="aiMcpScope">{t('ai.mcp.access')}</label>
            <br />
            <small className={cx('pe-2', access.exists === false ? 'text-warning' : 'grey-text')} data-testid="mcp-access-state">{accessText}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <select
              id="aiMcpScope"
              className="form-select order-1 order-md-2 hb-mcp-scope"
              value={scope}
              disabled={busy}
              onChange={event => setScope(event.target.value as 'read' | 'admin')}
            >
              <option value="read">{t('users.api_tokens.scope_read')}</option>
              <option value="admin">{t('users.api_tokens.scope_admin')}</option>
            </select>
            <button
              type="button"
              className="btn btn-primary btn-sm ms-2 order-3 text-nowrap"
              disabled={busy}
              onClick={() => void run('access', () => api.post<McpStatus>('/ai/mcp/homebridge-token', { scope }, { params: origin() }))}
            >
              {access.set ? t('ai.mcp.access_replace') : t('ai.mcp.access_create')}
            </button>
            {access.set && (
              <button
                type="button"
                className="btn btn-elegant btn-sm ms-2 order-3 text-nowrap"
                disabled={busy}
                onClick={() => void run('access', () => api.delete<McpStatus>('/ai/mcp/homebridge-token', { params: origin() }))}
              >
                {t('ai.mcp.access_remove')}
              </button>
            )}
            <SaveIndicator show={saving === 'access'} />
          </div>
        </div>
        {scope === 'admin' && <p className="small text-warning mt-2 mb-0">{t('users.api_tokens.scope_admin_warning')}</p>}
      </SettingRow>
      <SettingRow item="setting-ai-mcp-clients">
        <div className="setting-row-inner hb-mcp-clients">
          <span>
            {t('ai.mcp.clients')}
            <br />
            <small className="grey-text pe-2">
              {transport === 'http' ? t('ai.mcp.clients_http_desc', { url: http.url }) : t('ai.mcp.clients_stdio_desc')}
            </small>
          </span>
          <div className="d-flex flex-wrap align-items-center gap-3 my-2">
            <div className="btn-group btn-group-sm" role="group" aria-label={t('ai.mcp.transport')}>
              <button type="button" className={cx('btn', transport === 'http' ? 'btn-primary' : 'btn-elegant')} aria-pressed={transport === 'http'} onClick={() => setTransport('http')}>
                {t('ai.mcp.transport_http')}
              </button>
              <button type="button" className={cx('btn', transport === 'stdio' ? 'btn-primary' : 'btn-elegant')} aria-pressed={transport === 'stdio'} onClick={() => setTransport('stdio')}>
                {t('ai.mcp.transport_stdio')}
              </button>
            </div>
            {transport === 'http' && (
              <div className="form-check mb-0">
                <input
                  id="aiMcpIncludeToken"
                  type="checkbox"
                  className="form-check-input"
                  checked={includeToken && Boolean(fresh)}
                  disabled={!fresh}
                  onChange={event => setIncludeToken(event.target.checked)}
                />
                <label htmlFor="aiMcpIncludeToken" className="form-check-label small">
                  {t('ai.mcp.include_token')}
                  {!fresh && <span className="d-block grey-text">{t('ai.mcp.include_token_unavailable')}</span>}
                </label>
              </div>
            )}
          </div>
          <ul className="nav nav-tabs" role="tablist">
            {CLIENTS.map(entry => (
              <li key={entry.key} className="nav-item" role="presentation">
                <button
                  type="button"
                  role="tab"
                  className={cx('nav-link', client === entry.key && 'active')}
                  aria-selected={client === entry.key}
                  onClick={() => {
                    setClient(entry.key)
                    setCopied(false)
                  }}
                >
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="position-relative">
            <pre className="hb-mcp-snippet font-monospace small p-3 mb-0" role="tabpanel" tabIndex={0} data-testid="mcp-snippet">{snippet}</pre>
            <button
              type="button"
              className="btn btn-elegant btn-sm position-absolute top-0 end-0 m-2"
              aria-label={t('common.a11y.copy_to_clipboard')}
              onClick={() => void copyText(snippet).then(() => setCopied(true))}
            >
              <i className={cx('fas', copied ? 'fa-check' : 'fa-copy')} aria-hidden="true"></i>
            </button>
          </div>
          <p className="small grey-text mt-2 mb-0">{t('ai.mcp.restart_note')}</p>
        </div>
      </SettingRow>
      <SettingRow item="setting-ai-mcp-url">
        <div className="setting-row-inner">
          <button
            type="button"
            className="disclosure-toggle"
            aria-expanded={showAdvanced ? 'true' : 'false'}
            aria-controls="aiMcpAdvanced"
            onClick={() => setAdvanced(!showAdvanced)}
          >
            <i aria-hidden="true" className={cx('fa', showAdvanced ? 'fa-chevron-down' : 'fa-chevron-right')}></i>
            {' '}
            {t('common.labels.advanced')}
          </button>
          <small className="grey-text d-block pe-2">{t('ai.mcp.advanced_desc')}</small>
        </div>
      </SettingRow>
      {showAdvanced && (
        <SettingRow item="setting-ai-mcp-url">
          <div className={INNER_BLOCK} id="aiMcpAdvanced">
            <span>
              <label htmlFor="aiMcpHomebridgeUrl">{t('ai.mcp.homebridge_url')}</label>
              <br />
              <small className="grey-text pe-2">{t('ai.mcp.homebridge_url_desc')}</small>
            </span>
            <div className={CONTROL_WRAP}>
              <input
                id="aiMcpHomebridgeUrl"
                type="url"
                className={`${INPUT} font-monospace`}
                value={homebridgeUrl}
                maxLength={500}
                placeholder={http.defaultHomebridgeUrl}
                onChange={event => setHomebridgeUrl(event.target.value)}
                onBlur={() => homebridgeUrl.trim() !== http.homebridgeUrl && void save('homebridgeUrl', { homebridgeUrl: homebridgeUrl.trim() })}
              />
              <SaveIndicator show={saving === 'homebridgeUrl'} />
            </div>
          </div>
        </SettingRow>
      )}
    </>
  )
}
