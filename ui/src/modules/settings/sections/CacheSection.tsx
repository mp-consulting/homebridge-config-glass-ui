import { useTranslation } from 'react-i18next'

import { INNER_FLEX, ModalRow, SectionShell, SettingRow, SwitchControl } from '@/modules/settings/sections/rows'
import { useSettingsPage } from '@/modules/settings/settings-page.context'

/** CACHE SETTINGS: accessory control debugging and removing cached accessories. */
export function CacheSection() {
  const { t } = useTranslation()
  const page = useSettingsPage()

  return (
    <SectionShell section="cache" fieldsId="fieldsCache" title="menu.label_accessories" description="settings.cache.desc" ulClassName="list-group list-group-box mb-4 mx-0">
      <SettingRow item="setting-accessory-debug">
        <div className={INNER_FLEX}>
          <span>
            {t('settings.accessory.debug')}
            <br />
            <small className="grey-text pe-2">{t('settings.accessory.debug_desc')}</small>
          </span>
          <SwitchControl field="uiAccDebug" id="accessoryDebug" label={t('settings.accessory.debug')} />
        </div>
      </SettingRow>
      <ModalRow
        item="setting-reset-accessory-ind"
        title={t('reset.accessory_ind.title')}
        desc={t('reset.accessory_ind.desc')}
        label={t('reset.accessory_ind.title')}
        onClick={() => page.removeSingleCachedAccessories()}
      />
      <ModalRow
        item="setting-reset-bridge-accessories"
        title={t('reset.bridge_accessories.title')}
        desc={t('reset.bridge_accessories.desc')}
        label={t('reset.accessory_all.title')}
        onClick={() => page.removeBridgeAccessories()}
      />
      <ModalRow
        item="setting-reset-accessory-all"
        title={t('reset.accessory_all.title')}
        desc={t('reset.accessory_all.desc')}
        label={t('reset.accessory_all.title')}
        onClick={() => page.removeAllCachedAccessories()}
      />
    </SectionShell>
  )
}
