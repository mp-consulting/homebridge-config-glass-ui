import type { FormEvent } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { authActions, useAuthStore } from '@/core/auth'
import { useSettingsStore } from '@/core/settings'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { environment } from '@/environments/environment'

import './login.scss'

/** The pages a non-admin may be sent back to after signing in. */
const validNonAdminRoutes = [
  '/accessories',
  '/plugins',
  '/logs',
  '/support',
]

export interface LoginProps {
  /** Where to go once signed in (read from session storage by the route loader). */
  targetRoute?: string
}

/** The sign-in page (LoginComponent), with the 2FA code step. */
export function Login({ targetRoute = '/' }: LoginProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const otpRef = useRef<HTMLInputElement>(null)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [usernameDirty, setUsernameDirty] = useState(false)
  const [passwordDirty, setPasswordDirty] = useState(false)
  // Set on a second 412: the password is fine, the code is not. Cleared as
  // soon as the code changes (Angular's updateValueAndValidity)
  const [otpInvalidCode, setOtpInvalidCode] = useState(false)

  const [invalidCredentials, setInvalidCredentials] = useState(false)
  const [invalid2faCode, setInvalid2faCode] = useState(false)
  const [twoFactorCodeRequired, setTwoFactorCodeRequired] = useState(false)

  // The OTP field is optional until it appears, so its rules only apply then
  const otpInvalid = twoFactorCodeRequired && (otp.length !== 6 || otpInvalidCode)
  const formInvalid = !username || !password || otpInvalid

  const wallpaperHash = useSettingsStore(s => (s.settingsLoaded ? s.env.customWallpaperHash : undefined))
  const backgroundStyle = wallpaperHash
    ? `url('${environment.api.base}/auth/wallpaper/${wallpaperHash}') center/cover`
    : ''

  // Password managers write straight to the DOM without an input event, so the
  // native value is read back shortly after any change
  useEffect(() => {
    const timer = setTimeout(() => {
      const passwordInputValue = passwordRef.current?.value
      if (passwordInputValue && passwordInputValue !== password) {
        setPassword(passwordInputValue)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [username, password, otp])

  useEffect(() => {
    // Skip programmatic focus on touch devices: iOS Safari (and Android Chrome)
    // won't open the keyboard without a user gesture, so focusing here would
    // just show a focus ring without a keyboard — confusing UX.
    const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches
    if (!isTouchDevice) {
      usernameRef.current?.focus()
    }
  }, [])

  // Cleared on unmount: a login that completes (and navigates away) within
  // 100ms would otherwise focus a field that no longer exists
  const focusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(focusTimerRef.current), [])

  const onSubmit = async (event?: FormEvent) => {
    event?.preventDefault()
    setInvalidCredentials(false)
    setInvalid2faCode(false)
    document.getElementById('submit-button')?.blur()

    // Grab the values from the native element as they may be "populated" via autofill.
    let form = { username, password, otp }
    const passwordInputValue = passwordRef.current?.value
    if (passwordInputValue && passwordInputValue !== form.password) {
      form = { ...form, password: passwordInputValue }
      setPassword(passwordInputValue)
    }

    const usernameInputValue = usernameRef.current?.value
    if (usernameInputValue && usernameInputValue !== form.username) {
      form = { ...form, username: usernameInputValue }
      setUsername(usernameInputValue)
    }

    if (twoFactorCodeRequired) {
      const otpInputValue = otpRef.current?.value
      if (otpInputValue && otpInputValue !== form.otp) {
        form = { ...form, otp: otpInputValue }
        setOtp(otpInputValue)
      }
    }

    try {
      await authActions.login(form)

      let target = targetRoute
      if (!useAuthStore.getState().user?.admin && !validNonAdminRoutes.includes(target)) {
        target = '/'
      }
      void navigate(target)
    } catch (error: any) {
      if (error?.status === 412) {
        if (twoFactorCodeRequired) {
          // 2FA already enabled but code was invalid
          setOtpInvalidCode(true)
          setInvalid2faCode(true)
        }

        setTwoFactorCodeRequired(true)
        clearTimeout(focusTimerRef.current)
        focusTimerRef.current = setTimeout(() => {
          document.getElementById('form-ota')?.focus()
        }, 100)
      } else {
        setInvalidCredentials(true)
      }
    }
  }

  const errorBox = (headline: string) => (
    <div className="input-group no-border mb-4" role="alert">
      <div className="input-group-text custom-input">
        <i className="fas fa-exclamation-triangle pink-text fa-lg" aria-hidden="true"></i>
      </div>
      <div className="form-control custom-input">
        <div className="small grey-text fw-semibold">{headline}</div>
        <SafeHtml className="small grey-text" html={t('login.invalid_credentials_2')} />
      </div>
    </div>
  )

  return (
    <div
      className={`login-container gradient d-flex align-items-start justify-content-center${backgroundStyle ? '' : ' anim'}`}
      style={backgroundStyle ? { background: backgroundStyle } : undefined}
    >
      <div className="w-100 login-card d-flex py-4 flex-column">
        <img
          className="homebridge-logo mx-auto my-3"
          src="assets/homebridge-color-round.webp"
          alt="Homebridge Logo"
          height="100"
          width="100"
          fetchPriority="high"
        />
        <form noValidate onSubmit={event => void onSubmit(event)}>
          <h4 className="mb-4 text-center">{t('setup.welcome_to_homebridge')}</h4>
          {!twoFactorCodeRequired
            ? (
                <>
                  <div className="input-group mb-4">
                    <span className="input-group-text custom-input"><i className="fas fa-user primary-text fa-lg" aria-hidden="true"></i></span>
                    <input
                      ref={usernameRef}
                      name="username"
                      type="text"
                      id="form-username"
                      autoComplete="username"
                      autoCapitalize="none"
                      tabIndex={0}
                      className={`form-control custom-input${usernameDirty && !username ? ' is-invalid' : ''}`}
                      required
                      aria-label={t('users.label_username')}
                      placeholder={t('users.label_username')}
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value)
                        setUsernameDirty(true)
                      }}
                    />
                  </div>
                  <div className="input-group mb-4">
                    <span className="input-group-text custom-input"><i className="fas fa-lock primary-text fa-lg" aria-hidden="true"></i></span>
                    <input
                      ref={passwordRef}
                      name="password"
                      type="password"
                      id="form-pass"
                      autoComplete="current-password"
                      tabIndex={0}
                      className={`form-control custom-input${passwordDirty && !password ? ' is-invalid' : ''}`}
                      required
                      aria-label={t('users.label_password')}
                      placeholder={t('users.label_password')}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value)
                        setPasswordDirty(true)
                      }}
                    />
                  </div>
                </>
              )
            : (
                <div className="input-group mb-4">
                  <span className="input-group-text custom-input"><i className="fas fa-key primary-text fa-lg" aria-hidden="true"></i></span>
                  <input
                    ref={otpRef}
                    type="text"
                    id="form-ota"
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    tabIndex={0}
                    className="form-control custom-input"
                    aria-label={t('login.label_2fa_code')}
                    placeholder={t('login.label_2fa_code')}
                    value={otp}
                    onChange={(e) => {
                      setOtp(e.target.value)
                      setOtpInvalidCode(false)
                    }}
                  />
                </div>
              )}
          {invalidCredentials && errorBox(t('login.invalid_credentials'))}
          {invalid2faCode && errorBox(t('login.invalid_code'))}
          <div className="text-center">
            <button tabIndex={0} id="submit-button" className="btn btn-primary mb-2" type="submit" disabled={formInvalid}>
              {t('form.button_continue')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
