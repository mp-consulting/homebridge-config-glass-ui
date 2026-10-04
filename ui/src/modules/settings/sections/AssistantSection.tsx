import type { AiBudget, AiProviderName, AiSettingsUpdate, AiStatus, AiTestResult, AiUsagePeriod } from '@/core/ai/ai.interfaces'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AI_PROVIDERS } from '@/core/ai/ai.interfaces'
import { aiActions, useAiStore } from '@/core/ai/ai.store'
import { AiButton } from '@/core/ai/AiButton'
import { api } from '@/core/api'
import { toastApiError } from '@/core/utilities/http-error'
import { McpServerSettings } from '@/modules/settings/sections/McpServerSettings'
import { CONTROL_WRAP, INNER_BLOCK, INNER_FLEX, SaveIndicator, SectionShell, SettingRow } from '@/modules/settings/sections/rows'

const INPUT = 'form-control custom-input resp-input order-1 order-md-2'

const PROVIDER_LABELS: Record<AiProviderName, string> = {
  'anthropic': 'Anthropic (Claude)',
  'openai': 'OpenAI',
  'gemini': 'Google Gemini',
  'openai-compatible': 'OpenAI-compatible (Ollama, LM Studio)',
}

const tokensOf = (period: AiUsagePeriod | undefined) => (period ? period.inputTokens + period.outputTokens : 0)

/** One budget limit: saved on blur, empty for none. */
function BudgetInput({ field, label, budget, step, disabled, saving, onSave }: {
  field: keyof AiBudget
  label: string
  budget: AiBudget | undefined
  step: number
  disabled: boolean
  saving: boolean
  onSave: (field: keyof AiBudget, value: number | null) => void
}) {
  const stored = budget?.[field] ?? null
  const [value, setValue] = useState(stored === null ? '' : String(stored))
  const [synced, setSynced] = useState(stored)
  if (stored !== synced) {
    setSynced(stored)
    setValue(stored === null ? '' : String(stored))
  }
  const id = `aiBudget-${field}`
  return (
    <div className="d-flex align-items-center gap-2 mb-1">
      <label htmlFor={id} className="mb-0 small grey-text text-nowrap">{label}</label>
      <input
        id={id}
        type="number"
        className="form-control custom-input font-monospace text-end-input"
        min={0}
        step={step}
        value={value}
        disabled={disabled}
        onChange={event => setValue(event.target.value)}
        onBlur={() => {
          const parsed = value.trim() === '' ? null : Number(value)
          if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
            return
          }
          const next = parsed === 0 ? null : parsed
          if (next !== stored) {
            onSave(field, next)
          }
        }}
      />
      <SaveIndicator show={saving} />
    </div>
  )
}

/**
 * ASSISTANT: the `HomebridgeAiKit` block of config.json - provider, model,
 * API key (write-only: the server only says whether one is stored), base URL
 * for a local server, the output cap, a connection test and the usage so far,
 * then the kit's HTTP MCP server.
 * Each control saves when it settles, like the rest of the page.
 */
export function AssistantSection() {
  const { t } = useTranslation()
  const status = useAiStore(state => state.status)
  const settings = status?.settings
  const [model, setModel] = useState(settings?.model ?? '')
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? '')
  const [maxTokens, setMaxTokens] = useState(settings?.maxOutputTokens ? String(settings.maxOutputTokens) : '')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<AiTestResult | null>(null)

  useEffect(() => {
    void aiActions.loadStatus()
  }, [])

  // Follow what the server stored (after a load or a save)
  const [synced, setSynced] = useState(settings)
  if (settings !== synced) {
    setSynced(settings)
    if (settings) {
      setModel(settings.model)
      setBaseUrl(settings.baseUrl)
      setMaxTokens(settings.maxOutputTokens ? String(settings.maxOutputTokens) : '')
    }
  }

  const save = async (field: string, update: AiSettingsUpdate) => {
    setSaving(field)
    try {
      aiActions.setStatus(await api.put<AiStatus>('/ai/settings', update))
      setTest(null)
      return true
    } catch (error) {
      toastApiError(error)
      return false
    } finally {
      setSaving(null)
    }
  }

  const saveKey = async () => {
    if (apiKey.trim() && await save('apiKey', { apiKey: apiKey.trim() })) {
      setApiKey('')
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await api.post<AiTestResult>('/ai/test', {}))
      void aiActions.loadStatus()
    } catch (error: any) {
      setTest({ ok: false, message: error?.error?.message ?? error?.message })
    } finally {
      setTesting(false)
    }
  }

  const provider = settings?.provider ?? 'anthropic'
  const enabled = settings?.enabled ?? false
  const usage = status?.usage.total
  const { today, thisMonth, budget } = status?.usage ?? {}
  const ofBudget = (limit: number | null | undefined, format: (n: number) => string) =>
    limit ? ` ${t('ai.settings.usage_of_budget', { budget: format(limit) })}` : ''
  const usd = (n: number) => `$${n.toFixed(2)}`
  const saveBudget = (field: keyof AiBudget, value: number | null) => void save(`budget-${field}`, { budget: { [field]: value } })

  const reasonKey: Record<NonNullable<AiStatus['reason']>, string> = {
    'not-configured': 'ai.settings.reason_not_configured',
    'disabled': 'ai.settings.reason_disabled',
    'missing-api-key': 'ai.settings.reason_missing_api_key',
    'invalid-config': 'ai.settings.reason_invalid',
  }

  return (
    <SectionShell section="assistant" fieldsId="fieldsAssistant" title="ai.settings.title" description="ai.settings.desc">
      <SettingRow item="setting-ai-enabled">
        <div className={INNER_FLEX}>
          <span>
            {t('ai.settings.enabled')}
            <br />
            <small className="grey-text pe-2">
              {status?.enabled ? t('ai.settings.status_on', { provider: PROVIDER_LABELS[status.provider!] ?? status.provider, model: status.model }) : t(reasonKey[status?.reason ?? 'not-configured'])}
              {settings?.error && ` ${settings.error}`}
            </small>
          </span>
          <div className="d-flex align-items-center">
            <div className="order-1 order-md-2">
              <input
                type="checkbox"
                className="rendux-input"
                id="aiEnabled"
                checked={enabled}
                disabled={!settings || saving !== null}
                aria-label={t('ai.settings.enabled')}
                onChange={event => void save('enabled', { enabled: event.target.checked })}
              />
              <label htmlFor="aiEnabled" className="rendux-label ms-3 min-w-50"></label>
            </div>
            <SaveIndicator show={saving === 'enabled'} />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-ai-provider">
        <div className={INNER_BLOCK}>
          <label htmlFor="aiProvider">{t('ai.settings.provider')}</label>
          <div className={CONTROL_WRAP}>
            <select
              id="aiProvider"
              className="form-select order-1 order-md-2"
              value={provider}
              disabled={!settings || saving !== null}
              onChange={event => void save('provider', { provider: event.target.value as AiProviderName, model: '' })}
            >
              {AI_PROVIDERS.map(name => <option key={name} value={name}>{PROVIDER_LABELS[name]}</option>)}
            </select>
            <SaveIndicator show={saving === 'provider'} />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-ai-model">
        <div className={INNER_BLOCK}>
          <span>
            <label htmlFor="aiModel">{t('ai.settings.model')}</label>
            <br />
            <small className="grey-text pe-2">{t('ai.settings.model_desc')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <input
              id="aiModel"
              type="text"
              className={`${INPUT} font-monospace`}
              value={model}
              maxLength={200}
              placeholder={settings?.defaultModels?.[provider] ?? ''}
              disabled={!settings}
              onChange={event => setModel(event.target.value)}
              onBlur={() => model !== settings?.model && void save('model', { model })}
            />
            <SaveIndicator show={saving === 'model'} />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-ai-key">
        <div className={INNER_BLOCK}>
          <span>
            <label htmlFor="aiApiKey">{t('ai.settings.api_key')}</label>
            <br />
            <small className="grey-text pe-2">
              {settings?.hasApiKey ? t('ai.settings.api_key_stored') : t('ai.settings.api_key_desc')}
            </small>
          </span>
          <div className={CONTROL_WRAP}>
            <input
              id="aiApiKey"
              type="password"
              className={`${INPUT} font-monospace`}
              value={apiKey}
              maxLength={1000}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={settings?.hasApiKey ? '••••••••' : ''}
              disabled={!settings}
              onChange={event => setApiKey(event.target.value)}
              onBlur={() => void saveKey()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void saveKey()
                }
              }}
            />
            {settings?.hasApiKey && (
              <button
                type="button"
                className="btn btn-elegant btn-sm ms-2 order-3 text-nowrap"
                disabled={saving !== null}
                onClick={() => void save('apiKey', { clearApiKey: true })}
              >
                {t('ai.settings.api_key_remove')}
              </button>
            )}
            <SaveIndicator show={saving === 'apiKey'} />
          </div>
        </div>
      </SettingRow>
      {provider === 'openai-compatible' && (
        <SettingRow item="setting-ai-base-url">
          <div className={INNER_BLOCK}>
            <span>
              <label htmlFor="aiBaseUrl">{t('ai.settings.base_url')}</label>
              <br />
              <small className="grey-text pe-2">{t('ai.settings.base_url_desc')}</small>
            </span>
            <div className={CONTROL_WRAP}>
              <input
                id="aiBaseUrl"
                type="url"
                className={`${INPUT} font-monospace`}
                value={baseUrl}
                maxLength={500}
                placeholder="http://127.0.0.1:11434/v1"
                onChange={event => setBaseUrl(event.target.value)}
                onBlur={() => baseUrl !== settings?.baseUrl && void save('baseUrl', { baseUrl })}
              />
              <SaveIndicator show={saving === 'baseUrl'} />
            </div>
          </div>
        </SettingRow>
      )}
      <SettingRow item="setting-ai-max-tokens">
        <div className={INNER_BLOCK}>
          <span>
            <label htmlFor="aiMaxTokens">{t('ai.settings.max_tokens')}</label>
            <br />
            <small className="grey-text pe-2">{t('ai.settings.max_tokens_desc')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <input
              id="aiMaxTokens"
              type="number"
              className={`${INPUT} font-monospace`}
              value={maxTokens}
              min={64}
              max={64000}
              step={64}
              placeholder="2048"
              disabled={!settings}
              onChange={event => setMaxTokens(event.target.value)}
              onBlur={() => {
                const value = Number.parseInt(maxTokens, 10)
                if (Number.isInteger(value) && value >= 64 && value <= 64000 && value !== settings?.maxOutputTokens) {
                  void save('maxOutputTokens', { maxOutputTokens: value })
                }
              }}
            />
            <SaveIndicator show={saving === 'maxOutputTokens'} />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-ai-test">
        <div className={INNER_FLEX}>
          <span>
            {t('ai.settings.test')}
            <br />
            <small className="grey-text pe-2" role="status" aria-live="polite">
              {test?.ok && t('ai.settings.test_ok', { model: test.model, ms: test.latencyMs })}
              {test && !test.ok && <span className="red-text">{t('ai.settings.test_failed', { message: test.message ?? '' })}</span>}
              {!test && t('ai.settings.test_desc')}
            </small>
          </span>
          <AiButton label={testing ? t('ai.thinking') : t('ai.settings.test_button')} busy={testing} disabled={testing || !settings?.configured} onClick={() => void runTest()} />
        </div>
      </SettingRow>
      <SettingRow item="setting-ai-usage">
        <div className={INNER_FLEX}>
          <span>
            {t('ai.settings.usage')}
            <br />
            <small className="grey-text pe-2">{t('ai.settings.usage_desc')}</small>
          </span>
          <span className="text-end small font-monospace" data-testid="ai-usage">
            {t('ai.settings.usage_calls', { n: usage?.calls ?? 0 })}
            <br />
            {t('ai.settings.usage_tokens', { input: (usage?.inputTokens ?? 0).toLocaleString(), output: (usage?.outputTokens ?? 0).toLocaleString() })}
            {usage?.costUsd != null && usage.costUsd > 0 && (
              <>
                <br />
                {t('ai.settings.usage_cost', { cost: usage.costUsd.toFixed(4) })}
              </>
            )}
          </span>
        </div>
      </SettingRow>
      {today && thisMonth && (
        <SettingRow item="setting-ai-usage-period">
          <div className={INNER_FLEX}>
            <span>
              {t('ai.settings.usage_period')}
              <br />
              <small className="grey-text pe-2">{t('ai.settings.usage_period_desc')}</small>
            </span>
            <span className="text-end small font-monospace" data-testid="ai-usage-period">
              {t('ai.settings.usage_today', { tokens: tokensOf(today).toLocaleString() })}
              {ofBudget(budget?.dailyTokens, n => n.toLocaleString())}
              {today.costUsd > 0 && ` · ${usd(today.costUsd)}${ofBudget(budget?.dailyUsd, usd)}`}
              <br />
              {t('ai.settings.usage_month', { tokens: tokensOf(thisMonth).toLocaleString() })}
              {ofBudget(budget?.monthlyTokens, n => n.toLocaleString())}
              {thisMonth.costUsd > 0 && ` · ${usd(thisMonth.costUsd)}${ofBudget(budget?.monthlyUsd, usd)}`}
            </span>
          </div>
        </SettingRow>
      )}
      {settings && (
        <SettingRow item="setting-ai-budget">
          <div className={INNER_BLOCK}>
            <span>
              {t('ai.settings.budget')}
              <br />
              <small className="grey-text pe-2">{t('ai.settings.budget_desc')}</small>
            </span>
            <div className="my-3 my-md-0 ps-0 ps-md-5" data-testid="ai-budget">
              <BudgetInput field="dailyTokens" label={t('ai.settings.budget_daily_tokens')} budget={budget} step={1000} disabled={saving !== null} saving={saving === 'budget-dailyTokens'} onSave={saveBudget} />
              <BudgetInput field="monthlyTokens" label={t('ai.settings.budget_monthly_tokens')} budget={budget} step={1000} disabled={saving !== null} saving={saving === 'budget-monthlyTokens'} onSave={saveBudget} />
              <BudgetInput field="dailyUsd" label={t('ai.settings.budget_daily_usd')} budget={budget} step={0.01} disabled={saving !== null} saving={saving === 'budget-dailyUsd'} onSave={saveBudget} />
              <BudgetInput field="monthlyUsd" label={t('ai.settings.budget_monthly_usd')} budget={budget} step={0.01} disabled={saving !== null} saving={saving === 'budget-monthlyUsd'} onSave={saveBudget} />
            </div>
          </div>
        </SettingRow>
      )}
      <McpServerSettings />
    </SectionShell>
  )
}
