import type { PluginBridgeStore } from '@/core/plugins/plugin-bridge/plugin-bridge.state'

import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'

import { getScheduledRestartCron } from '@/core/plugins/plugin-bridge/plugin-bridge.schedule'
import { linkCron } from '@/core/plugins/plugin-bridge/plugin-bridge.state'
import { SafeHtml } from '@/core/ui/SafeHtml'

/** The per-bridge scheduled restart (a cron expression), in the advanced options. */
export function PluginBridgeSchedule({ store }: { store: PluginBridgeStore }) {
  const { t } = useTranslation()
  const username: string | undefined = useStore(store, s => s.configBlocks[Number(s.selectedBlock)]._bridge?.username)
  const cron = useStore(store, s => getScheduledRestartCron(s, username))
  const { onScheduledRestartCronChange } = store.getState()

  return (
    <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
      <label htmlFor="bridge-scheduled-restart" className="mb-2 mb-md-0 w-100 w-md-50">
        {t('settings.startup.scheduled_restart')}
        <br />
        <SafeHtml as="small" className="grey-text" html={t('settings.startup.scheduled_restart_desc', { link: linkCron(t('settings.link_crontab_guru')) })} />
      </label>
      <div className="text-start text-md-end w-100 w-md-50 d-flex flex-column align-items-end">
        {/*
          Uncontrolled, like Angular's one-way [value]: the stored value is
          trimmed, and writing it back on every keystroke would eat the space
          the user just typed between two cron fields. Keyed by the bridge so
          switching bridges shows that bridge's schedule.
        */}
        <input
          key={username ?? ''}
          id="bridge-scheduled-restart"
          type="text"
          className="form-control custom-input font-monospace cron-input"
          placeholder="mm hh dd MM ww"
          maxLength={30}
          defaultValue={cron}
          onInput={event => onScheduledRestartCronChange(event.currentTarget.value, username)}
        />
      </div>
    </li>
  )
}
