import { useTranslation } from 'react-i18next'

import { cx } from '@/core/utilities/cx'
import { CONTROL_WRAP, FieldSaveIndicator, INNER_BLOCK, INNER_FLEX, NumberInput, SectionShell, SettingRow, SwitchControl } from '@/modules/settings/sections/rows'
import { useField, useInvalid, useSettingsPageState } from '@/modules/settings/settings-page.context'

const MONO_INPUT = 'form-control custom-input resp-input order-1 order-md-2 font-monospace'

/** LOGGING & TERMINAL SETTINGS: log size and truncation, the persistent terminal. */
export function TerminalSection() {
  const { t } = useTranslation()
  const enableTerminalAccess = useSettingsPageState(state => state.flags.enableTerminalAccess)
  const [hbLogSize] = useField('hbLogSize')
  const [persistence] = useField('uiTerminalPersistence')
  const hbLogSizeIsInvalid = useInvalid('hbLogSize')
  const hbLogTruncateIsInvalid = useInvalid('hbLogTruncate')
  const bufferSizeIsInvalid = useInvalid('uiTerminalBufferSize')

  return (
    <SectionShell section="terminal" fieldsId="fieldsTerminal" title="settings.network.title_terminal">
      <SettingRow item="setting-terminal-log-max">
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.terminal.log_max')}
            <br />
            <small className="grey-text pe-2">{t('settings.terminal.log_max_desc')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <NumberInput
              field="hbLogSize"
              className={cx(MONO_INPUT, hbLogSizeIsInvalid && 'is-invalid')}
              min="-1"
              placeholder="1000000"
              aria-label={t('settings.terminal.log_max')}
            />
            <FieldSaveIndicator saving="hbLogSize" />
          </div>
        </div>
      </SettingRow>
      {hbLogSize! > 0 && (
        <SettingRow item="setting-terminal-log-truncate">
          <div className={INNER_BLOCK}>
            <span>
              {t('settings.terminal.log_truncate')}
              <br />
              <small className="grey-text pe-2">{t('settings.terminal.log_truncate_desc')}</small>
            </span>
            <div className={CONTROL_WRAP}>
              <NumberInput
                field="hbLogTruncate"
                className={cx(MONO_INPUT, hbLogTruncateIsInvalid && 'is-invalid')}
                min="0"
                placeholder="200000"
                aria-label={t('settings.terminal.log_truncate')}
              />
              <FieldSaveIndicator saving="hbLogTruncate" />
            </div>
          </div>
        </SettingRow>
      )}
      {enableTerminalAccess && (
        <>
          <SettingRow item="setting-terminal-persistence">
            <div className={INNER_FLEX}>
              <span>
                {t('settings.terminal.persistence')}
                <br />
                <small className="grey-text pe-2">{t('settings.terminal.persistence_help')}</small>
              </span>
              <SwitchControl field="uiTerminalPersistence" id="terminalPersistence" label={t('settings.terminal.persistence')} />
            </div>
          </SettingRow>
          {!persistence
            ? (
                <SettingRow item="setting-terminal-warning">
                  <div className={INNER_FLEX}>
                    <span>
                      {t('settings.terminal.warning')}
                      <br />
                      <small className="grey-text pe-2">{t('settings.terminal.warning_help')}</small>
                    </span>
                    <SwitchControl field="uiTerminalHideWarning" id="terminalHideWarning" label={t('settings.terminal.warning')} />
                  </div>
                </SettingRow>
              )
            : (
                <SettingRow item="setting-terminal-buffer">
                  <div className={INNER_BLOCK}>
                    <div className="d-flex flex-column">
                      <span>{t('settings.terminal.buffer_size')}</span>
                      <div className="small grey-text">{t('settings.terminal.buffer_size_help')}</div>
                    </div>
                    <div className={CONTROL_WRAP}>
                      <NumberInput
                        field="uiTerminalBufferSize"
                        className={cx(MONO_INPUT, bufferSizeIsInvalid && 'is-invalid')}
                        min="10000"
                        max="100000"
                        step="10000"
                        aria-label={t('settings.terminal.buffer_size')}
                      />
                      <FieldSaveIndicator saving="uiTerminalBufferSize" />
                    </div>
                  </div>
                </SettingRow>
              )}
        </>
      )}
    </SectionShell>
  )
}
