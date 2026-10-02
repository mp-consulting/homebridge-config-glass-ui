import { useTranslation } from 'react-i18next'

import { ModalRow, SectionShell } from '@/modules/settings/sections/rows'
import { useSettingsPage } from '@/modules/settings/settings-page.context'
import { titleCase } from '@/modules/settings/title-case'

/** RESET SETTINGS: unpairing one bridge, or resetting them all. */
export function ResetSection() {
  const { t } = useTranslation()
  const page = useSettingsPage()

  return (
    <SectionShell section="reset" fieldsId="fieldsReset" title="reset.bridges.title" description="reset.bridges.desc">
      <ModalRow
        item="setting-reset-bridge-ind"
        title={t('reset.bridge_ind.title')}
        desc={t('reset.bridge_ind.desc')}
        label={t('reset.bridge_ind.title')}
        onClick={() => page.unpairAccessory()}
      />
      <ModalRow
        item="setting-reset-bridge-all"
        title={titleCase(t('reset.bridge_all.title'))}
        desc={t('reset.bridge_all.desc')}
        label={t('reset.bridge_all.title')}
        onClick={() => page.resetHomebridgeState()}
      />
    </SectionShell>
  )
}
