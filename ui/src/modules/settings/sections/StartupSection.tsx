import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { SafeHtml } from '@/core/ui/SafeHtml'
import { CONTROL_WRAP, FieldSaveIndicator, INNER_BLOCK, INNER_FLEX, SectionShell, SettingRow, SwitchControl, TextInput } from '@/modules/settings/sections/rows'
import { useField, useItemHidden, useSettingsPage, useSettingsPageState } from '@/modules/settings/settings-page.context'
import { linkCron, linkDebug } from '@/modules/settings/settings-page.store'

const MONO_INPUT = 'form-control custom-input resp-input order-1 order-md-2 font-monospace'

/** A text field with its label, description and save indicator. */
function TextRow({ item, field, label, desc, placeholder, inputClassName = MONO_INPUT, wrapClassName = CONTROL_WRAP }: {
  item: string
  field: 'hbPackage' | 'hbLinuxShutdown' | 'hbLinuxRestart' | 'uiTempFile'
  label: string
  desc: string
  placeholder: string
  inputClassName?: string
  wrapClassName?: string
}) {
  return (
    <SettingRow item={item}>
      <div className={INNER_BLOCK}>
        <span>
          {label}
          <br />
          <small className="grey-text pe-2">{desc}</small>
        </span>
        <div className={wrapClassName}>
          <TextInput field={field} className={inputClassName} placeholder={placeholder} aria-label={label} />
          <FieldSaveIndicator saving={field} />
        </div>
      </div>
    </SettingRow>
  )
}

/** STARTUP/ENV OPTIONS: the hb-service flags and environment, scheduled restart, paths. */
export function StartupSection() {
  const { t } = useTranslation()
  const page = useSettingsPage()
  const debugFieldDesc = useSettingsPageState(state => state.debugFieldDesc)
  const platform = useSettingsPageState(state => state.flags.platform)
  const runningOnRaspberryPi = useSettingsPageState(state => state.flags.runningOnRaspberryPi)
  const runningInDocker = useSettingsPageState(state => state.flags.runningInDocker)
  const enableTerminalAccess = useSettingsPageState(state => state.flags.enableTerminalAccess)
  const [hbInsecure] = useField('hbInsecure')
  const securityControlHidden = useItemHidden('setting-security-control')

  return (
    <SectionShell section="startup" fieldsId="fieldsStartup" title="settings.title_startup_options" ulClassName="list-group list-group-box mb-4 mx-0">
      <SettingRow item="setting-debug">
        <div className={INNER_FLEX}>
          <span>
            {t('settings.startup.debug')}
            {' '}
            <code>-D</code>
            <br />
            <small className="grey-text pe-2">{t(debugFieldDesc)}</small>
          </span>
          <SwitchControl field="hbDebug" id="homebridgeDebugMode" label={t('settings.startup.debug')} />
        </div>
      </SettingRow>
      <SettingRow item="setting-keep">
        <div className={INNER_FLEX}>
          <span>
            {t('settings.startup.keep_accessories')}
            {' '}
            <code>-K</code>
            <br />
            <small className="grey-text pe-2">{t('settings.startup.keep_accessories_desc')}</small>
          </span>
          <SwitchControl field="hbKeep" id="homebridgeKeepOrphans" label={t('settings.startup.keep_accessories')} />
        </div>
      </SettingRow>
      <SettingRow item="setting-insecure">
        <div className={INNER_FLEX}>
          <span>
            {t('settings.startup.insecure')}
            {' '}
            <code>-I</code>
            <br />
            <small className="grey-text pe-2">{t('settings.startup.insecure_desc')}</small>
          </span>
          <SwitchControl field="hbInsecure" id="homebridgeInsecureMode" label={t('settings.startup.insecure')} />
        </div>
      </SettingRow>
      <SettingRow hidden={!(!securityControlHidden && hbInsecure)}>
        <div className={INNER_FLEX}>
          <span className="pe-2">
            {t('settings.security.ui_control')}
            <br />
            <small className="grey-text pe-2">{t('settings.security.ui_control_desc')}</small>
          </span>
          <button
            type="button"
            className="btn btn-primary waves-effect m-0 ms-3 py-1 min-w-50"
            aria-label={t('settings.security.ui_control')}
            onClick={() => void page.accessoryUiControl()}
          >
            <i aria-hidden="true" className="fas fa-arrow-right"></i>
          </button>
        </div>
      </SettingRow>
      <SettingRow item="setting-scheduled-restart">
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.startup.scheduled_restart')}
            <br />
            <small className="grey-text pe-2">
              <SafeHtml as="span" html={t('settings.startup.scheduled_restart_desc', { link: linkCron(t('settings.link_crontab_guru')) })} />
              {' '}
              {t('settings.startup.scheduled_restart_desc_2')}
            </small>
          </span>
          <div className="my-3 my-md-0 ps-0 ps-md-5 w-auto d-flex flex-column align-items-end">
            <div className="d-flex align-items-center w-100">
              <TextInput
                field="scheduledRestartCron"
                className={MONO_INPUT}
                placeholder="mm hh dd MM ww"
                maxLength={30}
                aria-label={t('settings.startup.scheduled_restart')}
                style={{ letterSpacing: '0.15em', textAlign: 'center' }}
              />
              <FieldSaveIndicator saving="scheduledRestartCron" />
            </div>
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-metrics-startup">
        <div className={INNER_FLEX}>
          <span>
            {t('settings.startup.metrics')}
            <br />
            <small className="grey-text pe-2">{t('settings.startup.metrics_desc')}</small>
          </span>
          <SwitchControl field="uiMetrics" id="homebridgeMetrics" label={t('settings.startup.metrics')} />
        </div>
      </SettingRow>
      <TextRow
        item="setting-package-path"
        field="hbPackage"
        label={t('settings.network.hb_package')}
        desc={t('settings.network.hb_package_desc')}
        placeholder="/usr/local/lib/node_modules/homebridge"
      />
      {platform === 'linux' && (
        <>
          <TextRow
            item="setting-linux-shutdown"
            field="hbLinuxShutdown"
            label={t('settings.linux.shutdown')}
            desc={t('settings.linux.shutdown_desc')}
            placeholder="shutdown"
          />
          <TextRow
            item="setting-linux-restart"
            field="hbLinuxRestart"
            label={t('settings.linux.restart')}
            desc={t('settings.linux.restart_desc')}
            placeholder="reboot"
            inputClassName="form-control custom-input resp-input order-1 order-md-2"
            wrapClassName={`${CONTROL_WRAP} font-monospace`}
          />
          {runningOnRaspberryPi && (
            <TextRow
              item="setting-linux-temp"
              field="uiTempFile"
              label={t('settings.linux.temp')}
              desc={t('settings.linux.temp_desc')}
              placeholder="/sys/class/thermal/thermal_zone0/temp"
            />
          )}
        </>
      )}
      <SettingRow item="setting-env-debug-manual">
        <div className={INNER_BLOCK}>
          <span>
            <span className="font-monospace">DEBUG</span>
            <br />
            <SafeHtml as="small" className="grey-text pe-2" html={t('settings.service.debug_tooltip', { link: linkDebug(t('settings.link_debug_values')) })} />
          </span>
          <div className={CONTROL_WRAP}>
            <TextInput field="hbEnvDebug" aria-label="DEBUG" className={MONO_INPUT} placeholder="HAP-NodeJS:Advertiser,HAP-NodeJS:Service" />
            <FieldSaveIndicator saving="hbEnvDebug" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-env-node">
        <div className={INNER_BLOCK}>
          <span>
            <span className="font-monospace">NODE_OPTIONS</span>
            <br />
            <small className="grey-text pe-2">{t('settings.service.node_tooltip')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <TextInput field="hbEnvNode" aria-label="NODE_OPTIONS" className={MONO_INPUT} placeholder="--max-old-space-size=512 --max-http-header-size=8192" />
            <FieldSaveIndicator saving="hbEnvNode" />
          </div>
        </div>
      </SettingRow>
      {runningInDocker && enableTerminalAccess && (
        <SettingRow item="setting-docker-startup">
          <div className={INNER_FLEX}>
            <span>
              {t('menu.docker.startup_script')}
              <br />
              <small className="grey-text pe-2">{t('platform.docker.script_help')}</small>
            </span>
            <Link
              className="btn btn-primary waves-effect m-0 ms-3 py-1 min-w-50"
              to="/platform-tools/docker/startup-script"
              aria-label={t('menu.docker.startup_script')}
            >
              <i aria-hidden="true" className="fas fa-arrow-right"></i>
            </Link>
          </div>
        </SettingRow>
      )}
    </SectionShell>
  )
}
