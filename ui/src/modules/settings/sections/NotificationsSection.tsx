import type { ChannelName, ChannelResult, NotificationEvent, NotificationSettings } from '@/modules/settings/notifications/notifications'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { toast } from '@/core/ui/toast'
import { toastApiError } from '@/core/utilities/http-error'
import { CHANNEL_FIELDS, loadNotificationSettings, NOTIFICATION_EVENTS, saveNotificationSettings, sendTestNotification } from '@/modules/settings/notifications/notifications'
import { INNER_FLEX, SectionShell, SettingRow } from '@/modules/settings/sections/rows'

const EVENT_LABELS: Record<NotificationEvent, string> = {
  homebridgeDown: 'settings.notifications.event_homebridge_down',
  homebridgeUp: 'settings.notifications.event_homebridge_up',
  childBridgeCrashLoop: 'settings.notifications.event_crash_loop',
  updatesAvailable: 'settings.notifications.event_updates',
  backupFailed: 'settings.notifications.event_backup_failed',
}

// Product names stay as they are; only the webhook is translated
const CHANNEL_NAMES: Record<Exclude<ChannelName, 'webhook'>, string> = {
  ntfy: 'ntfy',
  pushover: 'Pushover',
  telegram: 'Telegram',
}

/**
 * NOTIFICATIONS: the channels (webhook, ntfy, Pushover, Telegram) and the
 * events sent to them. Unlike the rest of the page it saves on a button,
 * so a half-typed token is never sent; stored secrets come back as
 * `********` and are kept unless replaced.
 */
export function NotificationsSection() {
  const { t } = useTranslation()
  const channelTitle = (channel: ChannelName) => (channel === 'webhook' ? t('settings.notifications.webhook') : CHANNEL_NAMES[channel])
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    loadNotificationSettings().then(
      (value) => {
        if (active) {
          setSettings(value)
        }
      },
      (error) => {
        console.error(error)
        toastApiError(error)
      },
    )
    return () => {
      active = false
    }
  }, [])

  const setChannel = (channel: ChannelName, field: string, value: string | boolean) => {
    setSettings(current => current && ({
      ...current,
      channels: { ...current.channels, [channel]: { ...current.channels[channel], [field]: value } },
    }))
    setDirty(true)
  }

  const setEvent = (event: NotificationEvent, value: boolean) => {
    setSettings(current => current && ({ ...current, events: { ...current.events, [event]: value } }))
    setDirty(true)
  }

  const save = async () => {
    if (!settings) {
      return
    }
    setBusy('save')
    try {
      setSettings(await saveNotificationSettings(settings))
      setDirty(false)
      toast.success(t('config.config_saved'), t('toast.title_success'))
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
    setBusy(null)
  }

  const test = async (channel?: ChannelName) => {
    setBusy(channel ?? 'test')
    try {
      const results: ChannelResult[] = await sendTestNotification(channel)
      for (const result of results) {
        if (result.ok) {
          toast.success(t('settings.notifications.test_sent', { channel: channelTitle(result.channel) }), t('toast.title_success'))
        } else {
          toast.error(`${channelTitle(result.channel)}: ${result.error ?? ''}`, t('toast.title_error'))
        }
      }
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
    setBusy(null)
  }

  return (
    <SectionShell section="notifications" fieldsId="fieldsNotifications" title="settings.notifications.title" description="settings.notifications.desc">
      {!settings
        ? (
            <li className="list-group-item text-center"><InlineSpinner /></li>
          )
        : (
            <>
              {CHANNEL_FIELDS.map(({ channel, fields }) => (
                <SettingRow key={channel} item={`setting-notifications-${channel}`}>
                  <div className="setting-row-inner">
                    <div className={INNER_FLEX}>
                      <span>
                        {channelTitle(channel)}
                      </span>
                      <div className="d-flex align-items-center">
                        <button
                          type="button"
                          className="btn btn-sm btn-elegant my-0 me-3"
                          disabled={busy !== null || dirty || !settings.channels[channel].enabled}
                          title={dirty ? t('settings.notifications.save_first') : undefined}
                          onClick={() => void test(channel)}
                        >
                          {busy === channel ? <InlineSpinner /> : t('settings.notifications.send_test')}
                        </button>
                        <input
                          type="checkbox"
                          className="rendux-input"
                          id={`notifications-${channel}-enabled`}
                          checked={settings.channels[channel].enabled}
                          aria-label={`${channelTitle(channel)} ${t('common.labels.enabled')}`}
                          onChange={event => setChannel(channel, 'enabled', event.target.checked)}
                        />
                        <label htmlFor={`notifications-${channel}-enabled`} className="rendux-label ms-3 min-w-50"></label>
                      </div>
                    </div>
                    {settings.channels[channel].enabled && (
                      <div className="row g-2 mt-1">
                        {fields.map(field => (
                          <div key={field.name} className="col-12 col-md-6">
                            <label htmlFor={`notifications-${channel}-${field.name}`} className="small grey-text mb-1">{t(field.label)}</label>
                            <input
                              id={`notifications-${channel}-${field.name}`}
                              type={field.secret ? 'password' : 'text'}
                              autoComplete="off"
                              spellCheck={false}
                              className="form-control custom-input"
                              placeholder={field.placeholder}
                              value={(settings.channels[channel] as unknown as Record<string, string>)[field.name] ?? ''}
                              onChange={event => setChannel(channel, field.name, event.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </SettingRow>
              ))}
              <SettingRow item="setting-notifications-events">
                <div className="setting-row-inner">
                  <span>{t('settings.notifications.events')}</span>
                  <div className="d-flex flex-wrap mt-2">
                    {NOTIFICATION_EVENTS.map(event => (
                      <div key={event} className="form-check me-4">
                        <input
                          id={`notifications-event-${event}`}
                          type="checkbox"
                          className="form-check-input"
                          checked={settings.events[event]}
                          onChange={change => setEvent(event, change.target.checked)}
                        />
                        <label htmlFor={`notifications-event-${event}`} className="form-check-label">{t(EVENT_LABELS[event])}</label>
                      </div>
                    ))}
                  </div>
                </div>
              </SettingRow>
              <li className="list-group-item d-flex justify-content-end">
                <button type="button" className="btn btn-primary my-0" disabled={!dirty || busy !== null} onClick={() => void save()}>
                  {busy === 'save' ? <InlineSpinner /> : t('form.button_save')}
                </button>
              </li>
            </>
          )}
    </SectionShell>
  )
}
