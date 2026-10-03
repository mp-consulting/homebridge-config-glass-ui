import { useTranslation } from 'react-i18next'

import { linkRaspbianSsl } from '@/core/constants/links'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { cx } from '@/core/utilities/cx'
import { INNER_BLOCK, INNER_FLEX, NumberInput, SaveIndicator, SectionShell, SettingRow, SwitchControl } from '@/modules/settings/sections/rows'
import { useField, useInvalid, useSaving, useSettingsPage, useSettingsPageState } from '@/modules/settings/settings-page.context'

/** One of the three session timeout boxes, with its unit beside it. */
function SessionTimeoutBox({ field, id, max, placeholder, unit }: {
  field: 'uiSessionTimeoutDays' | 'uiSessionTimeoutHours' | 'uiSessionTimeoutMinutes'
  id: string
  max: string
  placeholder: string
  unit: string
}) {
  const invalid = useInvalid(field)
  return (
    <div className="d-flex align-items-center">
      <NumberInput
        field={field}
        className={cx('form-control custom-input font-monospace text-end-input', invalid && 'is-invalid')}
        min="0"
        max={max}
        placeholder={placeholder}
        id={id}
        aria-label={unit}
      />
      <label htmlFor={id} className="ms-1 me-2 mb-0 text-nowrap grey-text small">{unit}</label>
    </div>
  )
}

/** SECURITY SETTINGS: the login, session lifetime and HTTPS. */
export function SecuritySection() {
  const { t } = useTranslation()
  const page = useSettingsPage()
  const [uiAuth] = useField('uiAuth')
  const [uiSslType] = useField('uiSslType')
  const sessionSaving = useSaving('uiSessionTimeout')
  const isPwa = useSettingsPageState(state => state.flags.isPwa)
  const runningOnRaspbianImage = useSettingsPageState(state => state.flags.runningOnRaspbianImage)

  return (
    <SectionShell section="security" fieldsId="fieldsSecurity" title="settings.network.title_security">
      <SettingRow item="setting-security-auth">
        <div className={INNER_FLEX}>
          <span>
            {t('settings.security.auth')}
            <br />
            <small className="grey-text pe-2">{t('settings.security.auth_desc')}</small>
          </span>
          <SwitchControl field="uiAuth" id="uiAuthForm" label={t('settings.security.auth')} />
        </div>
      </SettingRow>
      {uiAuth && (
        <>
          <SettingRow item="setting-session-inactivity">
            <div className={INNER_FLEX}>
              <span>
                {t('settings.startup.session_inactivity_based')}
                <br />
                <small className="grey-text pe-2">{t('settings.startup.session_inactivity_based_desc')}</small>
              </span>
              <SwitchControl
                field="uiSessionTimeoutInactivityBased"
                id="session-inactivity-based"
                label={t('settings.startup.session_inactivity_based')}
                indicatorClassName="fas fa-floppy-disk primary-text fa-xl me-0 me-md-2 ms-2 ms-md-0 save-indicator"
              />
            </div>
          </SettingRow>
          <SettingRow item="setting-security-session">
            <div className={INNER_BLOCK}>
              <span>
                {t('settings.startup.session')}
                <br />
                <small className="grey-text pe-2">{t('settings.startup.session_desc')}</small>
              </span>
              <div className="my-3 my-md-0 ps-0 ps-md-5 w-auto d-flex align-items-center">
                <div className="d-flex align-items-center gap-2 order-md-2">
                  <SessionTimeoutBox field="uiSessionTimeoutDays" id="session-timeout-days" max="365" placeholder="0" unit={t('settings.startup.session_days')} />
                  <SessionTimeoutBox field="uiSessionTimeoutHours" id="session-timeout-hours" max="23" placeholder="8" unit={t('settings.startup.session_hours')} />
                  <SessionTimeoutBox field="uiSessionTimeoutMinutes" id="session-timeout-minutes" max="59" placeholder="0" unit={t('settings.startup.session_minutes')} />
                </div>
                <SaveIndicator
                  show={sessionSaving}
                  className="fas fa-floppy-disk primary-text fa-xl me-0 me-md-2 ms-2 ms-md-0 order-md-1 save-indicator"
                />
              </div>
            </div>
          </SettingRow>
        </>
      )}
      <SettingRow item="setting-security-https">
        <div className={INNER_FLEX}>
          <span className="pe-2">
            {t('settings.security.https_enable')}
            <br />
            <small className="grey-text pe-2">{t('settings.security.https_enable_desc')}</small>
            {runningOnRaspbianImage
              ? (
                  <small className="grey-text pe-2">
                    <SafeHtml as="span" html={t('settings.security.https_raspbian', { link: linkRaspbianSsl(t('settings.link_raspbian_ssl')) })} />
                  </small>
                )
              : (
                  <>
                    <small className="grey-text pe-2">{t('settings.security.https_desc')}</small>
                    {isPwa && (
                      <>
                        <br />
                        <small className="grey-text pe-2">
                          <i aria-hidden="true" className="fas fa-exclamation-triangle red-text"></i>
                          {' '}
                          {t('settings.warning_pwa')}
                        </small>
                      </>
                    )}
                  </>
                )}
          </span>
          <div className="d-flex align-items-center">
            <div className="order-1 order-md-2">
              <input
                type="checkbox"
                className="rendux-input"
                id="httpsEnabled"
                checked={runningOnRaspbianImage || uiSslType !== 'off'}
                disabled={isPwa || runningOnRaspbianImage}
                readOnly
                aria-label={t('settings.security.https_enable')}
                onClick={(event) => {
                  if (!isPwa && !runningOnRaspbianImage) {
                    void page.openSslModal()
                  }
                  event.preventDefault()
                }}
              />
              <label htmlFor="httpsEnabled" className="rendux-label ms-3 min-w-50"></label>
            </div>
          </div>
        </div>
      </SettingRow>
    </SectionShell>
  )
}
