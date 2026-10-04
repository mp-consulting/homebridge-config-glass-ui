import type { AiOrganizationSuggestion } from '@/core/ai/ai.interfaces'
import type { OrganizerAccessory, OrganizerChanges, OrganizerItem } from '@/core/ai/organizer/organizer'
import type { ModalComponentProps } from '@/core/ui/modal'

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { suggestionItems } from '@/core/ai/organizer/organizer'
import { api } from '@/core/api'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'

export interface SmartOrganizerProps extends ModalComponentProps<OrganizerChanges> {
  accessories: OrganizerAccessory[]
  rooms: string[]
}

/**
 * Smart organiser: the Assistant suggests rooms and clearer names for the
 * accessories; the user ticks the ones to keep, and the caller applies them
 * through the accessories layout (room moves, custom names).
 */
export function SmartOrganizer({ activeModal, accessories, rooms }: SmartOrganizerProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [suggestion, setSuggestion] = useState<AiOrganizationSuggestion | null>(null)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const items = useMemo(() => (suggestion ? suggestionItems(suggestion, accessories) : []), [suggestion, accessories])
  const names = useMemo(() => new Map(accessories.map(a => [a.uniqueId, a.name])), [accessories])

  useEffect(() => {
    let live = true
    api.post<AiOrganizationSuggestion>('/ai/organize', {
      accessories: accessories.map(({ uniqueId, name, type, manufacturer, model, room }) => ({ uniqueId, serviceName: name, type, manufacturer, model, room })),
      rooms,
    }).then((result) => {
      if (live) {
        setSuggestion(result)
        setSelected(new Set(suggestionItems(result, accessories).map(i => i.key)))
      }
    }, (err: any) => {
      if (live) {
        setError(err?.error?.message ?? err?.message ?? t('ai.organizer.failed'))
      }
    }).finally(() => {
      if (live) {
        setLoading(false)
      }
    })
    return () => {
      live = false
    }
    // Asked once, when the modal opens
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  const toggle = (key: string) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    return next
  })

  const apply = () => {
    const chosen = items.filter(i => selected.has(i.key))
    activeModal.close({
      moves: chosen.filter(i => i.kind === 'move').map(i => ({ uniqueId: i.uniqueId, room: i.value })),
      renames: chosen.filter(i => i.kind === 'rename').map(i => ({ uniqueId: i.uniqueId, name: i.value })),
    })
  }

  const moves = items.filter(i => i.kind === 'move')
  const renames = items.filter(i => i.kind === 'rename')

  const checkbox = (item: OrganizerItem, label: string) => (
    <li key={item.key} className="list-group-item">
      <div className="form-check">
        <input id={`ai-org-${item.key}`} type="checkbox" className="form-check-input" checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
        <label htmlFor={`ai-org-${item.key}`} className="form-check-label">
          {label}
          {item.reason && <small className="d-block grey-text">{item.reason}</small>}
        </label>
      </div>
    </li>
  )

  return (
    <div className="modal-content hb-ai-organizer">
      <ModalHeader title={t('ai.organizer.title')} titleId="ai-organizer-title" onClose={() => activeModal.dismiss('Dismiss')}>
        <span className="mp-ai-badge ms-2 me-auto">{t('ai.badge')}</span>
      </ModalHeader>
      <div className="modal-body" aria-busy={loading}>
        {loading && <p className="mp-ai-thinking" role="status">{t('ai.organizer.thinking')}</p>}
        {error && <p className="mp-ai-error" role="alert">{error}</p>}
        {!loading && suggestion && !items.length && <p>{t('ai.organizer.nothing')}</p>}
        {moves.length > 0 && (
          <>
            <h6 className="mt-2">{t('ai.organizer.rooms')}</h6>
            <ul className="list-group mb-3">
              {moves.map(item => checkbox(item, t('ai.organizer.move', { name: names.get(item.uniqueId) ?? item.uniqueId, from: item.from, room: item.value })))}
            </ul>
          </>
        )}
        {renames.length > 0 && (
          <>
            <h6 className="mt-2">{t('ai.organizer.renames')}</h6>
            <ul className="list-group mb-3">
              {renames.map(item => checkbox(item, t('ai.organizer.rename', { from: item.from, name: item.value })))}
            </ul>
          </>
        )}
        {suggestion && suggestion.orphans.length > 0 && (
          <>
            <h6 className="mt-2">{t('ai.organizer.orphans')}</h6>
            <ul className="small mb-0">
              {suggestion.orphans.map(orphan => (
                <li key={orphan.uniqueId}>
                  <strong>{names.get(orphan.uniqueId) ?? orphan.uniqueId}</strong>
                  {': '}
                  {orphan.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <ModalFooter>
        <button type="button" className="btn btn-elegant" onClick={() => activeModal.dismiss('Dismiss')}>
          {t('form.button_cancel')}
        </button>
        <button type="button" className="btn btn-primary" disabled={!selected.size || loading} onClick={apply}>
          {t('ai.organizer.apply', { n: selected.size })}
        </button>
      </ModalFooter>
    </div>
  )
}
