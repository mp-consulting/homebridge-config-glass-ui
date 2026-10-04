import type { ModalComponentProps } from '@/core/ui/modal'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { formatDate } from '@/core/pipes/date'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { toastApiError } from '@/core/utilities/http-error'

type DestinationName = 'webdav' | 's3'

interface DestinationResult {
  destination: DestinationName
  ok: boolean
  error?: string
  removed?: number
}

/** `GET /backup/destinations`: secrets read as `********`. */
export interface BackupDestinations {
  keepLocal: number | null
  webdav: { enabled: boolean, url: string, username: string, password: string, keep: number }
  s3: { enabled: boolean, endpoint: string, region: string, bucket: string, prefix: string, accessKeyId: string, secretAccessKey: string, forcePathStyle: boolean, keep: number }
  lastRun: { at: string, fileName: string, results: DestinationResult[] } | null
}

interface Field {
  name: string
  label: string
  type?: 'text' | 'password' | 'number' | 'checkbox'
  placeholder?: string
}

const FIELDS: Record<DestinationName, Field[]> = {
  webdav: [
    { name: 'url', label: 'backup.offsite.webdav_url', placeholder: 'https://cloud.example.com/remote.php/dav/files/me/homebridge/' },
    { name: 'username', label: 'backup.offsite.username' },
    { name: 'password', label: 'backup.offsite.password', type: 'password' },
    { name: 'keep', label: 'backup.offsite.keep', type: 'number' },
  ],
  s3: [
    { name: 'endpoint', label: 'backup.offsite.s3_endpoint', placeholder: 'https://s3.eu-west-1.amazonaws.com' },
    { name: 'region', label: 'backup.offsite.s3_region', placeholder: 'us-east-1' },
    { name: 'bucket', label: 'backup.offsite.s3_bucket' },
    { name: 'prefix', label: 'backup.offsite.s3_prefix', placeholder: 'homebridge/' },
    { name: 'accessKeyId', label: 'backup.offsite.s3_access_key' },
    { name: 'secretAccessKey', label: 'backup.offsite.s3_secret_key', type: 'password' },
    { name: 'keep', label: 'backup.offsite.keep', type: 'number' },
    { name: 'forcePathStyle', label: 'backup.offsite.s3_path_style', type: 'checkbox' },
  ],
}

const TITLES: Record<DestinationName, string> = { webdav: 'WebDAV', s3: 'S3' }

/**
 * Off-site backups: copy each scheduled backup to WebDAV and/or an
 * S3-compatible bucket, how many copies each keeps, and how many are kept
 * locally. Saves on a button, so a half-typed secret is never sent.
 */
export function OffsiteBackups({ activeModal }: ModalComponentProps) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<BackupDestinations | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    api.get<BackupDestinations>('/backup/destinations').then(
      (value) => {
        if (active) {
          setSettings(value)
        }
      },
      (error) => {
        console.error(error)
        toastApiError(error)
      },
    )
    return () => {
      active = false
    }
  }, [])

  if (!settings) {
    return (
      <div className="modal-content">
        <ModalHeader title={t('backup.offsite.title')} onClose={() => activeModal.dismiss('Dismiss')} />
        <div className="modal-body text-center"><InlineSpinner /></div>
      </div>
    )
  }

  const set = (destination: DestinationName, field: string, value: unknown) => {
    setSettings({ ...settings, [destination]: { ...settings[destination], [field]: value } })
    setDirty(true)
  }

  const payload = () => ({ keepLocal: settings.keepLocal, webdav: settings.webdav, s3: settings.s3 })

  const save = async () => {
    setBusy('save')
    try {
      setSettings(await api.put<BackupDestinations>('/backup/destinations', payload()))
      setDirty(false)
      toast.success(t('config.config_saved'), t('toast.title_success'))
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
    setBusy(null)
  }

  const test = async (destination: DestinationName) => {
    setBusy(destination)
    try {
      const result = await api.post<DestinationResult>('/backup/destinations/test', { destination, settings: settings[destination] })
      if (result.ok) {
        toast.success(t('backup.offsite.test_ok', { destination: TITLES[destination] }), t('toast.title_success'))
      } else {
        toast.error(`${TITLES[destination]}: ${result.error ?? ''}`, t('toast.title_error'))
      }
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
    setBusy(null)
  }

  const keepLocalByCount = settings.keepLocal !== null

  return (
    <div className="modal-content hb-offsite-backups">
      <ModalHeader title={t('backup.offsite.title')} closeDisabled={busy !== null} onClose={() => activeModal.dismiss('Dismiss')} />
      <div className="modal-body">
        <p className="grey-text small">{t('backup.offsite.desc')}</p>

        <h6 className="mt-3">{t('backup.offsite.local')}</h6>
        <div className="form-check">
          <input
            id="offsite-keep-days"
            type="radio"
            className="form-check-input"
            checked={!keepLocalByCount}
            onChange={() => {
              setSettings({ ...settings, keepLocal: null })
              setDirty(true)
            }}
          />
          <label htmlFor="offsite-keep-days" className="form-check-label">{t('backup.offsite.keep_days')}</label>
        </div>
        <div className="form-check d-flex align-items-center flex-wrap">
          <input
            id="offsite-keep-count"
            type="radio"
            className="form-check-input me-2"
            checked={keepLocalByCount}
            onChange={() => {
              setSettings({ ...settings, keepLocal: 7 })
              setDirty(true)
            }}
          />
          <label htmlFor="offsite-keep-count" className="form-check-label me-2">{t('backup.offsite.keep_count')}</label>
          {keepLocalByCount && (
            <input
              type="number"
              min={1}
              max={365}
              className="form-control custom-input w-auto"
              aria-label={t('backup.offsite.keep_count')}
              value={settings.keepLocal ?? ''}
              onChange={(event) => {
                setSettings({ ...settings, keepLocal: Number(event.target.value) || 1 })
                setDirty(true)
              }}
            />
          )}
        </div>

        {(['webdav', 's3'] as const).map(destination => (
          <div key={destination} className="mt-4" data-destination={destination}>
            <div className="d-flex align-items-center justify-content-between">
              <h6 className="mb-0">{TITLES[destination]}</h6>
              <div className="d-flex align-items-center">
                <button
                  type="button"
                  className="btn btn-sm btn-elegant my-0 me-3"
                  disabled={busy !== null || !settings[destination].enabled}
                  onClick={() => void test(destination)}
                >
                  {busy === destination ? <InlineSpinner /> : t('backup.offsite.test')}
                </button>
                <input
                  type="checkbox"
                  className="rendux-input"
                  id={`offsite-${destination}-enabled`}
                  checked={settings[destination].enabled}
                  aria-label={`${TITLES[destination]} ${t('common.labels.enabled')}`}
                  onChange={event => set(destination, 'enabled', event.target.checked)}
                />
                <label htmlFor={`offsite-${destination}-enabled`} className="rendux-label ms-3 min-w-50"></label>
              </div>
            </div>
            {settings[destination].enabled && (
              <div className="row g-2 mt-1">
                {FIELDS[destination].map((field) => {
                  const id = `offsite-${destination}-${field.name}`
                  const value = (settings[destination] as unknown as Record<string, unknown>)[field.name]
                  if (field.type === 'checkbox') {
                    return (
                      <div key={field.name} className="col-12 form-check ms-1">
                        <input id={id} type="checkbox" className="form-check-input" checked={value === true} onChange={event => set(destination, field.name, event.target.checked)} />
                        <label htmlFor={id} className="form-check-label small">{t(field.label)}</label>
                      </div>
                    )
                  }
                  return (
                    <div key={field.name} className="col-12 col-md-6">
                      <label htmlFor={id} className="small grey-text mb-1">{t(field.label)}</label>
                      <input
                        id={id}
                        type={field.type ?? 'text'}
                        min={field.type === 'number' ? 1 : undefined}
                        max={field.type === 'number' ? 365 : undefined}
                        autoComplete="off"
                        spellCheck={false}
                        className="form-control custom-input"
                        placeholder={field.placeholder}
                        value={String(value ?? '')}
                        onChange={event => set(destination, field.name, field.type === 'number' ? Number(event.target.value) || 1 : event.target.value)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        {settings.lastRun && (
          <div className="mt-4 small" data-testid="offsite-last-run">
            <span className="grey-text">{t('backup.offsite.last_run', { date: formatDate(settings.lastRun.at, 'medium') })}</span>
            <ul className="list-unstyled mb-0">
              {settings.lastRun.results.map(result => (
                <li key={result.destination} className={result.ok ? 'green-text' : 'red-text'}>
                  <i className={result.ok ? 'fas fa-check me-1' : 'fas fa-xmark me-1'} aria-hidden="true"></i>
                  {TITLES[result.destination]}
                  {result.error && `: ${result.error}`}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="grey-text small mt-3 mb-0">{t('backup.offsite.notify_hint')}</p>
      </div>
      <ModalFooter>
        <button type="button" className="btn btn-elegant" disabled={busy !== null} onClick={() => activeModal.dismiss('Dismiss')}>
          {t('form.button_close')}
        </button>
        <button type="button" className="btn btn-primary" disabled={!dirty || busy !== null} onClick={() => void save()}>
          {busy === 'save' ? <InlineSpinner /> : t('form.button_save')}
        </button>
      </ModalFooter>
    </div>
  )
}
