import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { toast } from '@/core/ui/toast'
import { toastApiError } from '@/core/utilities/http-error'
import { SectionShell, SettingRow } from '@/modules/settings/sections/rows'

interface Instance {
  name: string
  url: string
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

/**
 * INSTANCES: the other Homebridge UIs (Glass UI or config-ui-x) the menu's
 * switcher offers. Only names and URLs are kept: switching navigates there,
 * and that instance asks for its own sign-in.
 */
export function InstancesSection() {
  const { t } = useTranslation()
  const stored = useSettingsStore(state => state.env.instances)
  const [instances, setInstances] = useState<Instance[]>(() => (stored ?? []).map(instance => ({ ...instance })))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  const update = (index: number, patch: Partial<Instance>) => {
    setInstances(current => current.map((instance, i) => (i === index ? { ...instance, ...patch } : instance)))
    setDirty(true)
  }

  const valid = instances.every(instance => instance.name.trim() && isHttpUrl(instance.url.trim()))

  const save = async () => {
    setSaving(true)
    try {
      const saved = await api.put<Instance[]>('/config-editor/ui/instances', instances.map(instance => ({ name: instance.name.trim(), url: instance.url.trim() })))
      settingsActions.setEnvItem('instances', saved)
      setInstances(saved.map(instance => ({ ...instance })))
      setDirty(false)
      toast.success(t('config.config_saved'), t('toast.title_success'))
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
    setSaving(false)
  }

  return (
    <SectionShell section="instances" fieldsId="fieldsInstances" title="instances.title" description="instances.desc">
      <SettingRow item="setting-instances">
        <div className="setting-row-inner">
          {instances.length === 0 && <p className="grey-text mb-2">{t('instances.none')}</p>}
          {instances.map((instance, index) => (
            // eslint-disable-next-line react/no-array-index-key -- rows have no identity of their own
            <div key={index} className="d-flex flex-wrap gap-2 mb-2" data-testid="instance-row">
              <input
                className="form-control custom-input flex-grow-1 w-auto"
                aria-label={t('instances.name')}
                placeholder={t('instances.name')}
                maxLength={64}
                value={instance.name}
                onChange={event => update(index, { name: event.target.value })}
              />
              <input
                className="form-control custom-input flex-grow-1 w-auto"
                aria-label={t('instances.url')}
                placeholder="https://homebridge.local:8581"
                type="url"
                value={instance.url}
                aria-invalid={instance.url && !isHttpUrl(instance.url.trim()) ? true : undefined}
                onChange={event => update(index, { url: event.target.value })}
              />
              <button
                type="button"
                className="btn btn-danger m-0"
                aria-label={t('form.button_delete')}
                onClick={() => {
                  setInstances(current => current.filter((_, i) => i !== index))
                  setDirty(true)
                }}
              >
                <i className="fas fa-trash" aria-hidden="true"></i>
              </button>
            </div>
          ))}
          <div className="d-flex justify-content-between">
            <button
              type="button"
              className="btn btn-elegant m-0"
              disabled={instances.length >= 20}
              onClick={() => {
                setInstances(current => [...current, { name: '', url: '' }])
                setDirty(true)
              }}
            >
              <i className="fas fa-plus me-1" aria-hidden="true"></i>
              {t('instances.add')}
            </button>
            <button type="button" className="btn btn-primary m-0" disabled={!dirty || !valid || saving} onClick={() => void save()}>
              {saving ? <InlineSpinner /> : t('form.button_save')}
            </button>
          </div>
        </div>
      </SettingRow>
    </SectionShell>
  )
}
