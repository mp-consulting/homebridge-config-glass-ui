import type { AiPluginConfigResult } from '@/core/ai/ai.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { FormEvent } from 'react'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isAbortError, runAiStream } from '@/core/ai/ai-stream'
import { AiMarkdown } from '@/core/ai/AiMarkdown'
import { MonacoDiffEditor } from '@/core/monaco'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'

export interface ConfigCopilotResult {
  /** The generated config block. */
  config: Record<string, unknown>
  /** The modified side of the diff the user approved. */
  modified: string
}

export interface ConfigCopilotProps extends ModalComponentProps<ConfigCopilotResult> {
  /** The plugin, when the copilot was opened for one. */
  pluginName?: string
  /** Shown in the title. */
  pluginLabel?: string
  /** Plugins to choose from when no `pluginName` is given (the config editor). */
  pluginChoices?: Array<{ name: string, label: string }>
  /** The block as currently edited; the saved one is used when left out. */
  current?: Record<string, unknown>
  /** The two sides of the diff for a generated block. Default: the block before and after. */
  buildDiff?: (result: AiPluginConfigResult, pluginName: string) => { original: string, modified: string }
}

function defaultDiff(result: AiPluginConfigResult) {
  return {
    original: JSON.stringify(result.current ?? {}, null, 4),
    modified: JSON.stringify(result.config, null, 4),
  }
}

/** Added and removed lines, for the diff header. */
function lineStats(original: string, modified: string): { added: number, removed: number } {
  const before = new Map<string, number>()
  for (const line of original.split('\n')) {
    before.set(line, (before.get(line) ?? 0) + 1)
  }
  let added = 0
  for (const line of modified.split('\n')) {
    const count = before.get(line) ?? 0
    if (count > 0) {
      before.set(line, count - 1)
    } else {
      added++
    }
  }
  const removed = [...before.values()].reduce((sum, n) => sum + n, 0)
  return { added, removed }
}

/**
 * Config Copilot: describe the settings in plain words, review the block the
 * Assistant writes (valid against the plugin's schema, secrets kept) in a
 * Monaco diff, then Apply - the caller saves it through the usual config save,
 * which keeps a backup - or Reject and rephrase.
 */
export function ConfigCopilot({ activeModal, pluginName, pluginLabel, pluginChoices, current, buildDiff }: ConfigCopilotProps) {
  const { t } = useTranslation()
  const [chosen, setChosen] = useState(pluginName ?? pluginChoices?.[0]?.name ?? '')
  const [request, setRequest] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AiPluginConfigResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const requestRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const diff = useMemo(() => (result ? (buildDiff ?? defaultDiff)(result, chosen) : null), [result, buildDiff, chosen])
  const stats = useMemo(() => (diff ? lineStats(diff.original, diff.modified) : null), [diff])

  const generate = (event: FormEvent) => {
    event.preventDefault()
    if (!request.trim() || !chosen || running) {
      return
    }
    const abort = new AbortController()
    abortRef.current = abort
    setRunning(true)
    setError('')
    setResult(null)
    runAiStream<AiPluginConfigResult>('plugin-config', { pluginName: chosen, request: request.trim(), ...(current ? { current } : {}) }, { signal: abort.signal })
      .then(setResult, (err: unknown) => {
        if (!isAbortError(err)) {
          setError((err as Error).message)
        }
      })
      .finally(() => setRunning(false))
  }

  const reject = () => {
    setResult(null)
    requestAnimationFrame(() => requestRef.current?.focus())
  }

  const apply = () => {
    if (result && diff) {
      activeModal.close({ config: result.config, modified: diff.modified })
    }
  }

  const title = pluginLabel ? t('ai.copilot.title_for', { plugin: pluginLabel }) : t('ai.copilot.title')

  return (
    <div className="modal-content hb-ai-copilot">
      <ModalHeader title={title} titleId="ai-copilot-title" closeDisabled={running} onClose={() => activeModal.dismiss('Dismiss')}>
        <span className="mp-ai-badge ms-2 me-auto">{t('ai.badge')}</span>
      </ModalHeader>
      <div className="modal-body">
        <form onSubmit={generate}>
          {!pluginName && pluginChoices && (
            <div className="mb-3">
              <label htmlFor="ai-copilot-plugin" className="form-label">{t('ai.copilot.plugin')}</label>
              <select id="ai-copilot-plugin" className="form-select" value={chosen} disabled={running} onChange={event => setChosen(event.target.value)}>
                {pluginChoices.map(choice => <option key={choice.name} value={choice.name}>{choice.label}</option>)}
              </select>
            </div>
          )}
          <label htmlFor="ai-copilot-request" className="form-label">{t('ai.copilot.describe')}</label>
          <textarea
            ref={requestRef}
            id="ai-copilot-request"
            className="form-control mb-2"
            rows={3}
            maxLength={4000}
            value={request}
            placeholder={t('ai.copilot.placeholder')}
            disabled={running}
            onChange={event => setRequest(event.target.value)}
          />
          <div className="d-flex align-items-center gap-2">
            <button type="submit" className="mp-ai-button" aria-busy={running || undefined} disabled={running || !request.trim() || !chosen}>
              <i className="fas fa-wand-magic-sparkles mp-ai-icon" aria-hidden="true"></i>
              {t('ai.copilot.generate')}
            </button>
            {running && <span className="mp-ai-thinking" role="status">{t('ai.thinking')}</span>}
          </div>
        </form>
        {error && <p className="mp-ai-error" role="alert">{error}</p>}

        {result && diff && (
          <div className={cx('mp-ai-diff mt-3')} role="region" aria-labelledby="ai-copilot-diff-title">
            <div className="mp-ai-diff-header">
              <span id="ai-copilot-diff-title" className="mp-ai-diff-title">{t('ai.copilot.review')}</span>
              {stats && (
                <span className="mp-ai-diff-stats">
                  <span className="mp-ai-diff-stat-add" aria-label={t('ai.copilot.lines_added', { n: stats.added })}>{`+${stats.added}`}</span>
                  <span className="mp-ai-diff-stat-del" aria-label={t('ai.copilot.lines_removed', { n: stats.removed })}>{`-${stats.removed}`}</span>
                </span>
              )}
            </div>
            {result.explanation && <AiMarkdown className="px-3 pt-2 small" text={result.explanation} />}
            <div className="hb-ai-copilot-diff">
              <MonacoDiffEditor
                language="json"
                original={diff.original}
                modified={diff.modified}
                originalModelPath="inmemory://ai-copilot/original.json"
                modifiedModelPath="inmemory://ai-copilot/modified.json"
                options={{ readOnly: true, originalEditable: false, renderSideBySide: false }}
                height="320px"
              />
            </div>
            <div className="mp-ai-diff-actions">
              <span className="mp-ai-diff-status">{t('ai.copilot.apply_note')}</span>
              <button type="button" className="btn btn-elegant m-0" onClick={reject}>{t('ai.copilot.reject')}</button>
              <button type="button" className="btn btn-primary m-0" onClick={apply}>{t('ai.copilot.apply')}</button>
            </div>
          </div>
        )}
      </div>
      <ModalFooter>
        <button type="button" className="btn btn-elegant" disabled={running} onClick={() => activeModal.dismiss('Dismiss')}>
          {t('form.button_close')}
        </button>
        <span className="small grey-text">{t('ai.disclaimer')}</span>
      </ModalFooter>
    </div>
  )
}
