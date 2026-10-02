import type { ReactNode } from 'react'

import { useTranslation } from 'react-i18next'

import { useSettingsStore } from '@/core/settings'
import { CONTROL_WRAP, FieldSaveIndicator, INNER_BLOCK, INNER_FLEX, SaveIndicator, SectionShell, SettingRow, SwitchControl } from '@/modules/settings/sections/rows'
import { useDisabled, useField, useItemHidden, useSaving, useSettingsPage } from '@/modules/settings/settings-page.context'
import { fontSizes, fontWeights } from '@/modules/settings/settings-page.store'

const LANGUAGES: Array<[string, string]> = [
  ['en', 'English (en)'],
  ['bg', 'Bulgarian (bg)'],
  ['ca', 'Catalan (ca)'],
  ['zh-CN', 'Chinese - Simplified (zh-CN)'],
  ['zh-TW', 'Chinese - Traditional (zh-TW)'],
  ['cs', 'Czech (cs)'],
  ['fi', 'Finnish (fi)'],
  ['fr', 'French (fr)'],
  ['de', 'German (de)'],
  ['hu', 'Hungarian (hu)'],
  ['id', 'Indonesian (id)'],
  ['he', 'Hebrew (he)'],
  ['it', 'Italian (it)'],
  ['ja', 'Japanese (ja)'],
  ['ko', 'Korean (ko)'],
  ['mk', 'Macedonian (mk)'],
  ['nl', 'Dutch (nl)'],
  ['no', 'Norwegian (no)'],
  ['pl', 'Polish (pl)'],
  ['pt', 'Portuguese (Portugal)'],
  ['pt-BR', 'Portuguese (Brazil)'],
  ['ru', 'Russian (ru)'],
  ['sl', 'Slovenian (sl)'],
  ['es', 'Spanish (es)'],
  ['sv', 'Swedish (sv)'],
  ['th', 'Thai (th)'],
  ['tr', 'Turkish (tr)'],
  ['uk', 'Ukrainian (uk)'],
  ['vi', 'Vietnamese (vi)'],
]

const THEMES: Array<[string, string]> = [
  ['orange', 'settings.display.orange'],
  ['red', 'settings.display.red'],
  ['pink', 'settings.display.pink'],
  ['purple', 'settings.display.purple'],
  ['deep-purple', 'settings.display.deep_purple'],
  ['indigo', 'settings.display.indigo'],
  ['blue', 'settings.display.blue'],
  ['blue-grey', 'settings.display.bluegrey'],
  ['cyan', 'settings.display.cyan'],
  ['green', 'settings.display.green'],
  ['teal', 'settings.display.teal'],
  ['grey', 'settings.display.grey'],
  ['brown', 'settings.display.brown'],
]

/** A select bound to a string field. */
function StringSelect({ field, className, label, children }: { field: 'uiLang' | 'uiTheme' | 'uiLight' | 'uiMenu' | 'uiTemp', className: string, label?: string, children: ReactNode }) {
  const [value, change] = useField(field)
  return (
    <select className={className} value={value ?? ''} aria-label={label} onChange={event => change(event.target.value)}>
      {children}
    </select>
  )
}

/** DISPLAY SETTINGS: language, theme, lighting, glass, menu, units, terminal look, wallpaper. */
export function DisplaySection() {
  const { t } = useTranslation()
  const page = useSettingsPage()
  const [fontSize, changeFontSize] = useField('uiTerminalFontSize')
  const [fontWeight, changeFontWeight] = useField('uiTerminalFontWeight')
  const [terminalLighting, changeTerminalLighting] = useField('uiTerminalLightingMode')
  const terminalLightingDisabled = useDisabled('uiTerminalLightingMode')
  const fontSizeSaving = useSaving('uiTerminalFontSize')
  const fontWeightSaving = useSaving('uiTerminalFontWeight')
  const terminalLightingSaving = useSaving('uiTerminalLightingMode')
  const actualLightingMode = useSettingsStore(state => state.actualLightingMode)
  const fontSizeHidden = useItemHidden('setting-terminal-font-size')
  const fontWeightHidden = useItemHidden('setting-terminal-font-weight')
  const lightingModeHidden = useItemHidden('setting-terminal-lighting-mode')
  const terminalHidden = !(!fontSizeHidden || !fontWeightHidden || !lightingModeHidden)

  // Only allow light theme when in light mode
  const terminalThemes = actualLightingMode === 'light' ? ['light', 'dark'] : ['dark']
  // Disable terminal theme dropdown when in dark mode (since terminal must be dark)
  const isTerminalLightingModeDisabled = actualLightingMode === 'dark'

  return (
    <SectionShell section="display" fieldsId="fieldsDisplay" title="settings.general.title_display">
      <SettingRow item="setting-lang">
        <div className={INNER_BLOCK}>
          {t('settings.display.lang')}
          <div className={CONTROL_WRAP}>
            <StringSelect field="uiLang" className="custom-select resp-select order-1 order-md-2">
              <option value="auto">{t('form.select.auto')}</option>
              {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </StringSelect>
            <FieldSaveIndicator saving="uiLang" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-theme">
        <div className={INNER_BLOCK}>
          {t('settings.display.theme')}
          <div className={CONTROL_WRAP}>
            <StringSelect field="uiTheme" className="custom-select resp-select order-1 order-md-2">
              {THEMES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </StringSelect>
            <FieldSaveIndicator saving="uiTheme" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-lighting">
        <div className={INNER_BLOCK}>
          {t('settings.display.lighting_mode')}
          <div className={CONTROL_WRAP}>
            <StringSelect field="uiLight" className="custom-select resp-select order-1 order-md-2">
              <option value="auto">{t('form.select.auto')}</option>
              <option value="light">{t('settings.display.light')}</option>
              <option value="dark">{t('settings.display.dark')}</option>
            </StringSelect>
            <FieldSaveIndicator saving="uiLight" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-glass">
        <div className={INNER_FLEX}>
          <span>
            {t('settings.display.glass_mode')}
            <br />
            <small className="grey-text pe-2">{t('settings.display.glass_mode_desc')}</small>
          </span>
          <SwitchControl field="uiGlass" id="uiGlassMode" label={t('settings.display.glass_mode')} />
        </div>
      </SettingRow>
      <SettingRow item="setting-menu">
        <div className={INNER_BLOCK}>
          {t('settings.display.menu_mode')}
          <div className={CONTROL_WRAP}>
            <StringSelect field="uiMenu" className="custom-select resp-select order-1 order-md-2">
              <option value="default">{t('settings.display.menu_default')}</option>
              <option value="freeze">{t('settings.display.menu_freeze')}</option>
            </StringSelect>
            <FieldSaveIndicator saving="uiMenu" />
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-temp">
        <div className={INNER_BLOCK}>
          {t('settings.display.temp_units')}
          <div className={CONTROL_WRAP}>
            <StringSelect field="uiTemp" className="custom-select resp-select order-1 order-md-2">
              <option value="c">{t('settings.display.temp_units.c')}</option>
              <option value="f">{t('settings.display.temp_units.f')}</option>
            </StringSelect>
            <FieldSaveIndicator saving="uiTemp" />
          </div>
        </div>
      </SettingRow>
      <SettingRow hidden={terminalHidden}>
        <div className={INNER_BLOCK}>
          <span>
            {t('settings.terminal.theme')}
            <br />
            <small className="grey-text pe-2">{t('settings.terminal.theme_desc')}</small>
          </span>
          <div className={CONTROL_WRAP}>
            <SaveIndicator show={fontSizeSaving || fontWeightSaving || terminalLightingSaving} />
            <div className="d-flex gap-2 order-1 order-md-2 resp-select-width">
              <div className="d-flex flex-column flex-fill">
                <select
                  className="custom-select w-100"
                  value={fontSize ?? ''}
                  aria-label={t('settings.terminal.font_size')}
                  onChange={event => changeFontSize(Number(event.target.value))}
                >
                  {fontSizes.map(size => <option key={size} value={size}>{size}</option>)}
                </select>
              </div>
              <div className="d-flex flex-column flex-fill">
                <select
                  className="custom-select w-100"
                  value={fontWeight ?? ''}
                  aria-label={t('settings.terminal.font_weight')}
                  onChange={event => changeFontWeight(event.target.value)}
                >
                  {fontWeights.map(weight => <option key={weight} value={weight}>{weight}</option>)}
                </select>
              </div>
              <div className="d-flex flex-column flex-fill">
                <select
                  className={`custom-select terminal-theme-select w-100${isTerminalLightingModeDisabled ? ' disabled-no-interaction' : ''}`}
                  value={terminalLighting ?? ''}
                  disabled={terminalLightingDisabled}
                  aria-label={t('settings.display.lighting_mode')}
                  onChange={event => changeTerminalLighting(event.target.value)}
                >
                  {terminalThemes.map(theme => <option key={theme} value={theme}>{theme === 'light' ? 'Light' : 'Dark'}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>
      </SettingRow>
      <SettingRow item="setting-wallpaper">
        <div className={INNER_FLEX}>
          <span className="pe-2">{t('settings.display.wallpaper')}</span>
          <button
            type="button"
            className="btn btn-primary waves-effect m-0 ms-3 py-1 min-w-50"
            aria-label={t('settings.display.wallpaper')}
            onClick={() => page.openWallpaperModal()}
          >
            <i aria-hidden="true" className="fas fa-arrow-right"></i>
          </button>
        </div>
      </SettingRow>
    </SectionShell>
  )
}
