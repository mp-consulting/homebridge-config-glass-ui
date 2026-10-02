import type { ModalComponentProps } from '@/core/ui/modal'
import type { SslKeyCertResponse, SslPfxResponse } from '@/modules/settings/settings.interfaces'
import type { PendingFiles, SslConfig, SslMode } from '@/modules/settings/ssl-settings-modal/ssl-settings'
import type { ChangeEvent, RefObject } from 'react'

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { isSslFormInvalid } from '@/modules/settings/ssl-settings-modal/ssl-settings'

const MODES: Array<{ mode: SslMode, icon: string, label: string, desc: string }> = [
  { mode: 'off', icon: 'fa-ban', label: 'settings.security.ssl_mode_off', desc: 'settings.security.ssl_mode_off_desc' },
  { mode: 'selfsigned', icon: 'fa-shield-alt', label: 'settings.security.ssl_mode_selfsigned', desc: 'settings.security.ssl_mode_selfsigned_desc' },
  { mode: 'keycert', icon: 'fa-key', label: 'settings.security.ssl_mode_keycert', desc: 'settings.security.ssl_mode_keycert_desc' },
  { mode: 'pfx', icon: 'fa-certificate', label: 'settings.security.ssl_mode_pfx', desc: 'settings.security.ssl_mode_pfx_desc' },
]

function initialConfig(): SslConfig {
  const ssl = useSettingsStore.getState().env.ssl
  const keyPath = ssl?.key || ''
  const certPath = ssl?.cert || ''
  const pfxPath = ssl?.pfx || ''
  // Determine current SSL mode
  const mode: SslMode = keyPath || certPath
    ? 'keycert'
    : (pfxPath || ssl?.hasPassphrase) ? 'pfx' : 'off'
  return { mode, hostnames: 'localhost, 127.0.0.1', keyPath, certPath, pfxPath, passphrase: '' }
}

function resetFileInput(input: RefObject<HTMLInputElement | null>): void {
  if (input.current) {
    input.current.value = ''
  }
}

/**
 * Choose how the UI serves HTTPS: off, a self-signed certificate, a key and
 * certificate pair, or a PFX bundle. Closes with the mode now in the config
 * (a self-signed certificate is saved as `keycert`), so the page can update
 * its switch and ask for a restart.
 */
export function SslSettingsModal({ activeModal }: ModalComponentProps<SslMode>) {
  const { t } = useTranslation()
  const [originalConfig] = useState(initialConfig)
  const [config, setConfig] = useState(originalConfig)
  const [pending, setPending] = useState<PendingFiles>({ key: null, cert: null, pfx: null })
  const [isSaving, setIsSaving] = useState(false)
  const keyInputRef = useRef<HTMLInputElement>(null)
  const certInputRef = useRef<HTMLInputElement>(null)
  const pfxInputRef = useRef<HTMLInputElement>(null)

  const update = (changes: Partial<SslConfig>) => setConfig(current => ({ ...current, ...changes }))

  const selectMode = (mode: SslMode) => {
    setConfig(current => ({
      ...current,
      mode,
      // Initialize default hostnames for self-signed mode if empty
      hostnames: mode === 'selfsigned' && !current.hostnames ? 'localhost, 127.0.0.1' : current.hostnames,
    }))
  }

  // Compare current config with original config
  const hasChanges = (Object.keys(originalConfig) as Array<keyof SslConfig>).some(key => config[key] !== originalConfig[key])
    || !!pending.key
    || !!pending.cert
    || !!pending.pfx
  const isUnchanged = !hasChanges
  const isFormInvalid = isSslFormInvalid(config, pending)

  const onFileChange = (which: keyof PendingFiles) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    const file = files && files.length > 0 ? files[0] : null
    setPending(current => ({ ...current, [which]: file }))
  }

  const saveConfiguration = async () => {
    setIsSaving(true)
    try {
      const changes: Record<string, unknown> = {}

      switch (config.mode) {
        case 'off':
          // Clear all SSL settings
          changes['ssl.key'] = ''
          changes['ssl.cert'] = ''
          changes['ssl.pfx'] = ''
          changes['ssl.passphrase'] = ''
          break

        case 'selfsigned': {
          // Generate the self-signed certificate first
          const hostnames = config.hostnames
            .split(',')
            .map(s => s.trim())
            .filter(s => !!s)

          const res = await api.post<SslKeyCertResponse>('/server/ssl/selfsigned/generate', { hostnames, mode: 'keycert' })

          // Update local settings with the generated certificate paths
          if (res?.keyPath) {
            settingsActions.setEnvItem('ssl.key', res.keyPath)
          }
          if (res?.certPath) {
            settingsActions.setEnvItem('ssl.cert', res.certPath)
          }
          // Clear other SSL settings
          settingsActions.setEnvItem('ssl.pfx', '')
          settingsActions.setEnvItem('ssl.passphrase', '')

          // Return 'keycert' mode since that's how it's saved in the config
          // This ensures the toggle shows enabled and reopening the modal shows the correct state
          activeModal.close('keycert')
          return
        }
        case 'keycert': {
          let { keyPath, certPath } = config
          // Upload pending key+cert pair if either was newly selected
          if (pending.key || pending.cert) {
            if (!pending.key || !pending.cert) {
              throw new Error(i18n.t('settings.security.upload_both_files'))
            }
            const formData = new FormData()
            formData.append('uploads', pending.key, pending.key.name)
            formData.append('uploads', pending.cert, pending.cert.name)
            const res = await api.post<SslKeyCertResponse>('/server/ssl/keycert', formData)
            if (res?.keyPath) {
              keyPath = res.keyPath
            }
            if (res?.certPath) {
              certPath = res.certPath
            }
            update({ keyPath, certPath })
            setPending(current => ({ ...current, key: null, cert: null }))
            resetFileInput(keyInputRef)
            resetFileInput(certInputRef)
          }
          // Clear pfx settings
          changes['ssl.pfx'] = ''
          changes['ssl.passphrase'] = ''
          // Set keycert settings
          changes['ssl.key'] = keyPath
          changes['ssl.cert'] = certPath
          break
        }
        case 'pfx': {
          let { pfxPath } = config
          // Upload pending pfx if newly selected
          if (pending.pfx) {
            const formData = new FormData()
            formData.append('upload', pending.pfx, pending.pfx.name)

            // Server-side validation needs the passphrase to decrypt the PFX MAC
            formData.append('passphrase', config.passphrase)
            const res = await api.post<SslPfxResponse>('/server/ssl/pfx', formData)
            if (res?.pfxPath) {
              pfxPath = res.pfxPath
            }
            update({ pfxPath })
            setPending(current => ({ ...current, pfx: null }))
            resetFileInput(pfxInputRef)
          }
          // Clear keycert settings
          changes['ssl.key'] = ''
          changes['ssl.cert'] = ''
          // Set pfx settings
          changes['ssl.pfx'] = pfxPath
          changes['ssl.passphrase'] = config.passphrase
          break
        }
      }

      // Batch every SSL key into a single PATCH so the modal save is one
      // disk write rather than four sequential PUTs.
      if (Object.keys(changes).length > 0) {
        await api.patch('/config-editor/ui', changes)
        for (const [key, value] of Object.entries(changes)) {
          settingsActions.setEnvItem(key, value)
        }
      }

      // Return the selected mode so the parent can update the toggle and show restart notification
      activeModal.close(config.mode)
    } catch (error: any) {
      console.error(error)
      const errorMessage = error?.error?.message || error?.message || t('toast.api_error_generic')
      toast.error(errorMessage, i18n.t('toast.title_error'))
    } finally {
      setIsSaving(false)
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')

  return (
    <div className="modal-content">
      <div className="modal-header">
        <h5 className="modal-title">{t('settings.security.https_configure')}</h5>
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="modal"
          aria-label={t('form.button_close')}
          onClick={dismissModal}
        >
        </button>
      </div>
      <div className="modal-body">
        {/* SSL Mode Selection */}
        <ul
          className="list-group list-group-box mb-0"
          role="radiogroup"
          aria-label={t('settings.security.https_configure')}
        >
          {MODES.map(({ mode, icon, label, desc }) => (
            <li key={mode} className="list-group-item text-start">
              <label className="d-flex align-items-center w-100 mb-0 cursor-pointer">
                <input
                  type="radio"
                  name="sslMode"
                  value={mode}
                  className="visually-hidden"
                  checked={config.mode === mode}
                  aria-label={t(label)}
                  onChange={() => selectMode(mode)}
                />
                <div className="me-3">
                  <i
                    className={`fas ${icon} fa-2x ${config.mode === mode ? 'primary-text' : 'grey-text'}`}
                    aria-hidden="true"
                  >
                  </i>
                </div>
                <div className="flex-grow-1">
                  <div aria-hidden="true">{t(label)}</div>
                  <small className="grey-text">{t(desc)}</small>
                </div>
                {config.mode === mode && <i className="fas fa-check-circle primary-text fa-xl" aria-hidden="true"></i>}
              </label>
            </li>
          ))}
        </ul>

        {/* Configuration Section (shown based on selected mode) */}
        {config.mode === 'selfsigned' && (
          <ul className="list-group list-group-box mt-4 mb-0">
            <li className="list-group-item">
              {t('settings.security.selfsigned_hostnames')}
              <input
                type="text"
                className="form-control font-monospace"
                placeholder="localhost, 127.0.0.1, homebridge.local"
                value={config.hostnames}
                onChange={event => update({ hostnames: event.target.value })}
              />
              <small className="form-text grey-text">{t('settings.security.selfsigned_hostnames_desc')}</small>
            </li>
          </ul>
        )}
        {config.mode === 'keycert' && (
          <ul className="list-group list-group-box mt-4 mb-0">
            <li className="list-group-item">
              {t('settings.security.key')}
              <input ref={keyInputRef} type="file" className="form-control" accept=".pem,.key" onChange={onFileChange('key')} />
              {pending.key
                ? <small className="form-text primary-text font-monospace">{pending.key.name}</small>
                : config.keyPath && <small className="form-text grey-text font-monospace">{config.keyPath}</small>}
            </li>
            <li className="list-group-item">
              {t('settings.security.cert')}
              <input ref={certInputRef} type="file" className="form-control" accept=".pem,.crt" onChange={onFileChange('cert')} />
              {pending.cert
                ? <small className="form-text primary-text font-monospace">{pending.cert.name}</small>
                : config.certPath && <small className="form-text grey-text font-monospace">{config.certPath}</small>}
            </li>
          </ul>
        )}
        {config.mode === 'pfx' && (
          <ul className="list-group list-group-box mt-4 mb-0">
            <li className="list-group-item">
              {t('settings.security.pfx')}
              <input ref={pfxInputRef} type="file" className="form-control" accept=".pfx,.p12" onChange={onFileChange('pfx')} />
              {pending.pfx
                ? <small className="form-text primary-text font-monospace">{pending.pfx.name}</small>
                : config.pfxPath && <small className="form-text grey-text font-monospace">{config.pfxPath}</small>}
            </li>
            <li className="list-group-item">
              {t('settings.security.pass')}
              <input
                type="password"
                className="form-control font-monospace"
                placeholder="••••••••"
                value={config.passphrase}
                onChange={event => update({ passphrase: event.target.value })}
              />
              <small className="form-text grey-text">{t('settings.security.pass_optional')}</small>
            </li>
          </ul>
        )}
      </div>
      <div className="modal-footer justify-content-between">
        <button type="button" className="btn btn-elegant" disabled={isSaving} onClick={dismissModal}>
          {t('form.button_close')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={isSaving || isUnchanged || isFormInvalid}
          onClick={() => void saveConfiguration()}
        >
          {isSaving && <i className="fas fa-spinner fa-spin me-2"></i>}
          {t('form.button_save')}
        </button>
      </div>
    </div>
  )
}
