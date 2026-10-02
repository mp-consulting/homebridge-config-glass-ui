import type { IoNamespace } from '@/core/ws'
import type { ChangeEvent, FormEvent } from 'react'

import type { CreateUserValues } from './create-user-form'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@/core/api'
import { authActions, setStoredToken, useAuthStore } from '@/core/auth'
import { RE_ANSI_FULL, RE_NEWLINE, RE_SPINNER } from '@/core/regex.constants'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { toast } from '@/core/ui/toast'
import { toToastMessage } from '@/core/utilities/http-error'
import { ws } from '@/core/ws'
import { environment } from '@/environments/environment'

import { validateCreateUser } from './create-user-form'

import './setup-wizard.scss'

export type SetupWizardStep = 'welcome' | 'create-account' | 'setup-complete' | 'restore-backup' | 'restoring' | 'restarting' | 'restore-complete'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** The first-run wizard (SetupWizardComponent): create the first user, or restore a backup. */
export function SetupWizard() {
  const { t } = useTranslation()

  const [step, setStep] = useState<SetupWizardStep>('welcome')
  const [progress, setProgress] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | undefined>(undefined)
  const [restoreUploading, setRestoreUploading] = useState(false)

  const [values, setValues] = useState<CreateUserValues>({ username: '', password: '', passwordConfirm: '' })
  const [dirty, setDirty] = useState<Record<keyof CreateUserValues, boolean>>({ username: false, password: false, passwordConfirm: false })
  const errors = validateCreateUser(values)
  const formInvalid = !!(errors.username || errors.password || errors.passwordConfirm || errors.form)

  const wallpaperHash = useSettingsStore(s => (s.settingsLoaded ? s.env.customWallpaperHash : undefined))
  const backgroundStyle = wallpaperHash
    ? `url('${environment.api.base}/auth/wallpaper/${wallpaperHash}') center/cover`
    : undefined

  const mountedRef = useRef(true)
  const ioRef = useRef<IoNamespace | null>(null)
  const stdoutHandlerRef = useRef<((data: string) => void) | undefined>(undefined)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const detachStdout = () => {
    if (ioRef.current && stdoutHandlerRef.current) {
      ioRef.current.socket.off('stdout', stdoutHandlerRef.current)
      stdoutHandlerRef.current = undefined
    }
  }

  useEffect(() => {
    document.title = t('setup_wizard_page_title')
  }, [t])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearInterval(pollTimerRef.current)
      // The backup namespace is cached and `end()` keeps its listeners, so a
      // wizard torn down mid-restore must still detach its stdout listener
      detachStdout()
    }
  }, [])

  const onClickGettingStarted = () => {
    setStep('create-account')
    setProgress(50)
  }

  const onClickRestoreBackup = () => {
    setStep('restore-backup')
    setProgress(20)
  }

  const onClickCancelRestore = () => {
    setSelectedFile(undefined)
    setStep('welcome')
    setProgress(1)
  }

  const setField = (field: keyof CreateUserValues) => (e: ChangeEvent<HTMLInputElement>) => {
    setValues(current => ({ ...current, [field]: e.target.value }))
    setDirty(current => ({ ...current, [field]: true }))
  }

  const createFirstUser = async (event?: FormEvent) => {
    event?.preventDefault()
    setLoading(true)
    setProgress(75)

    const payload: Record<string, string> = { ...values, name: values.username }

    try {
      await api.post('/setup-wizard/create-first-user', payload)
      settingsActions.setEnvItem('setupWizardComplete', true)
      setProgress(100)
      setLoading(false)
      await authActions.login({
        username: payload.username,
        password: payload.password,
      })
      setStep('setup-complete')
    } catch (error: any) {
      setLoading(false)
      setProgress(50)
      console.error(error)
      toast.error(toToastMessage(error), t('toast.title_error'))
    }
  }

  const handleRestoreFileInput = (event: ChangeEvent<HTMLInputElement> | { target: HTMLInputElement }) => {
    const input = event.target
    const files = input.files
    if (files?.length) {
      const file = files[0]
      // Reject up front if the picked archive is larger than the server-side
      // multipart limit — otherwise the user sits through a long upload that
      // the backend tar-extract endpoint will refuse anyway.
      if (file.size > globalThis.backup.maxBackupSize) {
        input.value = ''
        setSelectedFile(undefined)
        setProgress(20)
        toast.error(
          t('backup.backup_exceeds_max_size', {
            maxBackupSizeText: globalThis.backup.maxBackupSizeText,
            size: `${(file.size / (1024 * 1024)).toFixed(1)}MB`,
          }),
          t('toast.title_error'),
        )
        return
      }
      setSelectedFile(file)
      setProgress(40)
    } else {
      setSelectedFile(undefined)
      setProgress(20)
    }
  }

  const onRestoreBackupClick = async () => {
    setRestoreUploading(true)
    setStep('restoring')
    setProgress(60)
    // Looked up when written to: the box renders with the 'restoring' step
    const outputBox = () => document.getElementById('output')
    try {
      // Get and set a temporary access token.
      //
      // ⚠️ `setStoredToken` is what makes the rest of this flow work. Both
      // `POST /backup/restore` and `PUT /backup/restart` are behind the auth and
      // admin guards, and the Authorization header comes from the in-memory
      // token store. It must never go to localStorage.
      const authorization = await api.get('/setup-wizard/get-setup-wizard-token')
      setStoredToken(authorization.access_token)
      useAuthStore.setState({ token: authorization.access_token })
      setProgress(65)

      // upload archive
      const formData: FormData = new FormData()
      formData.append('restoreArchive', selectedFile!, selectedFile!.name)
      await api.post('/backup/restore', formData)
      setProgress(70)

      // start restore
      const io = ws.connectToNamespace('backup')
      ioRef.current = io
      let spinnerElement: HTMLDivElement | null = null
      detachStdout()
      stdoutHandlerRef.current = (data: string) => {
        const box = outputBox()
        if (!box) {
          return
        }
        const lines = data.split(RE_NEWLINE)
        lines.forEach((line: string) => {
          if (!line) {
            return
          }
          const cleanLine = line.replace(RE_ANSI_FULL, '').trim()
          if (!cleanLine) {
            return
          }
          const isSpinner = RE_SPINNER.test(cleanLine)
          if (isSpinner) {
            if (!spinnerElement) {
              spinnerElement = document.createElement('div')
              box.appendChild(spinnerElement)
            }
            spinnerElement.textContent = cleanLine
          } else {
            if (spinnerElement) {
              spinnerElement.remove()
              spinnerElement = null
            }
            const lineElement = document.createElement('div')
            lineElement.textContent = cleanLine
            if (line.includes('[0;31m')) {
              lineElement.classList.add('red-text')
            } else if (line.includes('[0;32m')) {
              lineElement.classList.add('green-text')
            } else if (line.includes('[0;33m')) {
              lineElement.classList.add('orange-text')
            } else if (line.includes('[0;36m')) {
              lineElement.classList.add('cyan-text')
            }
            box.appendChild(lineElement)
          }
          box.scrollTop = box.scrollHeight
        })
      }
      io.socket.on('stdout', stdoutHandlerRef.current)
      setProgress(75)
      await io.request('do-restore')
      setProgress(80)
      await api.put('/backup/restart', {})
      setStep('restarting')
      setProgress(85)

      // Remove tokens: this one is an admin token on a box that has just had a
      // different user database restored onto it
      setStoredToken(null)
      useAuthStore.setState({ token: null })

      // show final message in the terminal box
      const box = outputBox()
      if (box) {
        const restoreMessage = document.createElement('div')
        restoreMessage.classList.add('orange-text')
        restoreMessage.textContent = 'Starting Homebridge, please wait...'
        box.appendChild(restoreMessage)
        box.scrollTop = box.scrollHeight
      }

      // wait at least 15 seconds
      await delay(3000)
      setProgress(88)
      await delay(3000)
      setProgress(91)
      await delay(3000)
      setProgress(94)
      await delay(3000)
      setProgress(97)
      await delay(3000)
      setProgress(99)

      if (mountedRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = setInterval(async () => {
          try {
            await api.get('/auth/settings')
            clearInterval(pollTimerRef.current)
            setProgress(100)
            setRestoreUploading(false)
            setStep('restore-complete')
          } catch {
            // not up yet
          }
        }, 1000)
      }
    } catch (error: any) {
      console.error(error)
      setRestoreUploading(false)
      setProgress(20)
      setStep('restore-backup')
      toast.error(toToastMessage(error), t('toast.title_error'))
    } finally {
      if (ioRef.current) {
        detachStdout()
        ioRef.current.end?.()
        ioRef.current = null
      }
    }
  }

  const fieldClass = (field: keyof CreateUserValues, validClass = true) => {
    const fieldErrors = errors[field]
    let className = 'form-control custom-input'
    if (dirty[field] && validClass && !fieldErrors) {
      className += ' is-valid'
    }
    if (dirty[field] && fieldErrors) {
      className += ' is-invalid'
    }
    return className
  }

  const isRestoreStep = step === 'restoring' || step === 'restarting' || step === 'restore-complete'

  return (
    <div
      className={`setup-container gradient d-flex align-items-start justify-content-center${backgroundStyle ? '' : ' anim'}`}
      style={backgroundStyle ? { background: backgroundStyle } : undefined}
    >
      <div className="w-100 setup-card d-flex py-4 flex-column">
        <img
          className="homebridge-logo mx-auto my-3"
          src="assets/homebridge-color-round.webp"
          alt="Homebridge Logo"
          height="100"
          width="100"
          fetchPriority="high"
        />
        <div className="progress w-100 my-4">
          <div
            className={`progress-bar progress-bar-striped bg-success${loading || restoreUploading ? ' progress-bar-animated' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ width: `${progress}%` }}
            aria-valuenow={progress}
          >
          </div>
        </div>
        {step === 'welcome' && (
          <div className="w-100 d-flex flex-column align-items-center mb-2">
            <h4 className="mb-3 text-center">{t('setup.welcome_to_homebridge')}</h4>
            <SafeHtml className="mb-4 small grey-text text-center" html={t('setup.intro')} />
            <button type="button" className="btn btn-lg btn-primary mb-4" onClick={onClickGettingStarted}>
              {t('setup.button_get_started')}
            </button>
            <button type="button" className="btn btn-link grey-text p-0" onClick={onClickRestoreBackup}>
              {t('setup_wizard_restore')}
            </button>
          </div>
        )}
        {step === 'create-account' && (
          <div className="w-100 d-flex flex-column align-items-center mb-2">
            <h4 className="mb-3 text-center">{t('setup.create_account')}</h4>
            <div className="mb-4 small grey-text text-center">{t('setup_wizard_create_info')}</div>
            <div className="w-100">
              <form noValidate onSubmit={event => void createFirstUser(event)}>
                <div className="input-group mb-4">
                  <span className="input-group-text custom-input"><i className="fas fa-user primary-text fa-lg" aria-hidden="true"></i></span>
                  <input
                    type="text"
                    id="form-username"
                    autoComplete="username"
                    autoCapitalize="none"
                    tabIndex={0}
                    className={fieldClass('username')}
                    required
                    readOnly={loading}
                    placeholder={t('users.label_username')}
                    value={values.username}
                    onChange={setField('username')}
                  />
                </div>
                <div className="input-group mb-4">
                  <span className="input-group-text custom-input"><i className="fas fa-lock primary-text fa-lg" aria-hidden="true"></i></span>
                  <input
                    type="password"
                    id="form-pass"
                    autoComplete="new-password"
                    tabIndex={0}
                    className={fieldClass('password')}
                    required
                    readOnly={loading}
                    placeholder={t('users.label_password')}
                    value={values.password}
                    onChange={setField('password')}
                  />
                </div>
                <div className="input-group mb-4">
                  <span className="input-group-text custom-input"><i className="fas fa-lock primary-text fa-lg" aria-hidden="true"></i></span>
                  <input
                    type="password"
                    id="form-pass-confirm"
                    autoComplete="new-password"
                    tabIndex={0}
                    className={fieldClass('passwordConfirm')}
                    required
                    readOnly={loading}
                    placeholder={t('users.label_confirm_password')}
                    value={values.passwordConfirm}
                    onChange={setField('passwordConfirm')}
                  />
                </div>
                <div className="mt-3 w-100 d-flex justify-content-between">
                  <button type="button" className="btn btn-elegant ms-0" disabled={restoreUploading} onClick={onClickCancelRestore}>
                    {t('form.button_back')}
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={formInvalid || loading}>
                    {t('form.button_continue')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        {step === 'restore-backup' && (
          <div className="w-100 d-flex flex-column align-items-center mb-2">
            <h4 className="mb-3 text-center">{t('setup_wizard_restore')}</h4>
            <div className="mb-4 small grey-text text-center">{t('backup.restore_help_one')}</div>
            <input
              type="file"
              className="form-control custom-input mb-3"
              id="restoreFileUpload"
              accept="application/gzip, .gz"
              onChange={handleRestoreFileInput}
            />
            <div className="mt-3 w-100 d-flex justify-content-between">
              <button type="button" className="btn btn-elegant ms-0" disabled={restoreUploading} onClick={onClickCancelRestore}>
                {t('form.button_back')}
              </button>
              <button
                type="button"
                className="btn btn-primary me-0"
                disabled={restoreUploading || !selectedFile}
                onClick={() => void onRestoreBackupClick()}
              >
                {restoreUploading
                  ? (
                      <>
                        <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>
                        {' '}
                        {t('backup.label_uploading')}
                      </>
                    )
                  : t('form.button_continue')}
              </button>
            </div>
          </div>
        )}
        {isRestoreStep && (
          <div className="w-100 d-flex flex-column align-items-center mb-2">
            <h4 className="mb-3 text-center">
              {step === 'restoring' && t('setup_wizard_restoring')}
              {step === 'restarting' && t('setup_wizard_starting')}
              {step === 'restore-complete' && t('setup_wizard_complete')}
            </h4>
            <div id="output" className="font-monospace small alert alert-info w-100 text-start mt-1 mb-0"></div>
            {step === 'restore-complete' && (
              <a className="btn btn-lg btn-primary mt-4" href="/login">{t('form.button_continue')}</a>
            )}
          </div>
        )}
        {step === 'setup-complete' && (
          <div className="w-100 d-flex flex-column align-items-center mb-2">
            <h4 className="mb-3">{t('setup_wizard_complete_title')}</h4>
            <div className="mb-4 small grey-text text-center">{t('setup_wizard_completed')}</div>
            <a className="btn btn-lg btn-primary" href="/">{t('form.button_continue')}</a>
          </div>
        )}
      </div>
    </div>
  )
}
