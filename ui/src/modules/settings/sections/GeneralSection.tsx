import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { CONTROL_WRAP, FieldSaveIndicator, INNER_FLEX, SectionShell, SettingRow, TextInput } from '@/modules/settings/sections/rows'
import { useInvalid, useSettingsPage } from '@/modules/settings/settings-page.context'

/** GENERAL SETTINGS: the instance name, backups, user accounts. */
export function GeneralSection() {
  const { t } = useTranslation()
  const page = useSettingsPage()
  const hbNameIsInvalid = useInvalid('hbName')

  return (
    <SectionShell section="general" fieldsId="fieldsGeneral" title="settings.general.title_general">
      <SettingRow item="setting-name">
        <div className="setting-row-inner d-block d-md-flex justify-content-between align-items-center">
          <span>{t('settings.name')}</span>
          <div className={CONTROL_WRAP}>
            <TextInput
              field="hbName"
              className={`form-control custom-input resp-input order-1 order-md-2${hbNameIsInvalid ? ' is-invalid' : ''}`}
              aria-label={t('settings.name')}
            />
            <FieldSaveIndicator saving="hbName" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-backup">
        <div className={INNER_FLEX}>
          <span className="pe-2" aria-hidden="true">{t('backup.title_backup')}</span>
          <button
            type="button"
            className="btn btn-primary waves-effect m-0 ms-3 py-1 min-w-50"
            aria-label={t('backup.title_backup')}
            onClick={() => page.openBackupModal()}
          >
            <i aria-hidden="true" className="fas fa-arrow-right"></i>
          </button>
        </div>
      </SettingRow>
      <SettingRow item="setting-restore">
        <div className={INNER_FLEX}>
          <span className="pe-2" aria-hidden="true">{t('config.restore.title')}</span>
          <button
            type="button"
            className="btn btn-primary waves-effect m-0 ms-3 py-1 min-w-50"
            aria-label={t('config.restore.title')}
            onClick={() => page.openConfigBackup()}
          >
            <i aria-hidden="true" className="fas fa-arrow-right"></i>
          </button>
        </div>
      </SettingRow>
      <SettingRow item="setting-users">
        <div className={INNER_FLEX}>
          <span className="pe-2" aria-hidden="true">{t('menu.tooltip_user_accounts')}</span>
          <Link
            className="btn btn-primary waves-effect m-0 ms-3 py-1 min-w-50"
            to="/users"
            aria-label={t('menu.tooltip_user_accounts')}
          >
            <i aria-hidden="true" className="fas fa-arrow-right"></i>
          </Link>
        </div>
      </SettingRow>
    </SectionShell>
  )
}
