import type { WebPushState } from '@/core/pwa/web-push'

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { formatDatePattern } from '@/core/pipes/date-pattern'
import { pushUnavailableReason, subscriptionId, webPush } from '@/core/pwa/web-push'
import { toast } from '@/core/ui/toast'
import { toastApiError } from '@/core/utilities/http-error'

const UNAVAILABLE_KEYS = {
  'insecure': 'settings.notifications.browser_insecure',
  'unsupported': 'settings.notifications.browser_unsupported',
  'ios-not-installed': 'settings.notifications.browser_ios',
} as const

/**
 * The Browser channel's part under its switch: turn notifications on or off
 * for this device, send it a test, and the other subscribed devices (each can
 * be removed). The channel switch itself decides whether events are sent.
 */
export function BrowserPushSettings({ deps = { unavailable: pushUnavailableReason } }: { deps?: { unavailable: typeof pushUnavailableReason } }) {
  const { t } = useTranslation()
  const [unavailable] = useState(() => deps.unavailable())
  const [state, setState] = useState<WebPushState | null>(null)
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [thisId, setThisId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setState(await webPush.getState())
      if (!unavailable) {
        const current = (await webPush.currentSubscription())?.endpoint ?? null
        setEndpoint(current)
        setThisId(current ? await subscriptionId(current) : null)
      }
    } catch (error) {
      console.error(error)
    }
  }, [unavailable])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    try {
      await work()
    } catch (error) {
      console.error(error)
      toastApiError(error)
    }
    setBusy(null)
    await load()
  }

  const enable = () => run('enable', async () => {
    if (!state) {
      return
    }
    if (!await webPush.subscribeThisDevice(state.publicKey)) {
      toast.warning(t('settings.notifications.browser_denied'), t('toast.title_warning'))
    }
  })

  const disable = () => run('disable', () => webPush.unsubscribeThisDevice())

  const test = () => run('test', async () => {
    const result = await webPush.sendTest(endpoint ?? undefined)
    if (result.ok) {
      toast.success(t('settings.notifications.test_sent', { channel: t('settings.notifications.browser') }), t('toast.title_success'))
    } else {
      toast.error(`${t('settings.notifications.browser')}: ${result.error ?? ''}`, t('toast.title_error'))
    }
  })

  const remove = (id: string) => run(`remove-${id}`, async () => {
    await webPush.removeDevice(id)
  })

  if (!state) {
    return <div className="mt-2"><InlineSpinner /></div>
  }
  const subscribedHere = Boolean(endpoint && thisId && state.subscriptions.some(sub => sub.id === thisId))

  return (
    <div className="mt-2 hb-browser-push">
      {unavailable
        ? <p className="small grey-text mb-2" role="status">{t(UNAVAILABLE_KEYS[unavailable])}</p>
        : (
            <div className="d-flex flex-wrap align-items-center mb-2">
              {subscribedHere
                ? (
                    <button type="button" className="btn btn-sm btn-elegant my-0 me-2" disabled={busy !== null} onClick={() => void disable()}>
                      {busy === 'disable' ? <InlineSpinner /> : t('settings.notifications.browser_disable_here')}
                    </button>
                  )
                : (
                    <button type="button" className="btn btn-sm btn-primary my-0 me-2" disabled={busy !== null} onClick={() => void enable()}>
                      {busy === 'enable' ? <InlineSpinner /> : t('settings.notifications.browser_enable_here')}
                    </button>
                  )}
              {subscribedHere && (
                <button type="button" className="btn btn-sm btn-elegant my-0" disabled={busy !== null} onClick={() => void test()}>
                  {busy === 'test' ? <InlineSpinner /> : t('settings.notifications.browser_test_here')}
                </button>
              )}
            </div>
          )}
      <small className="d-block grey-text mb-1">{t('settings.notifications.browser_devices', { count: state.subscriptions.length })}</small>
      {state.subscriptions.length > 0 && (
        <ul className="list-unstyled mb-0 small">
          {state.subscriptions.map(sub => (
            <li key={sub.id} className="d-flex align-items-center justify-content-between py-1">
              <span>
                {sub.label}
                <span className="grey-text ms-2">{formatDatePattern(sub.createdAt, 'yyyy-MM-dd')}</span>
                {sub.id === thisId && <span className="badge bg-secondary ms-2">{t('settings.notifications.browser_this_device')}</span>}
              </span>
              <button
                type="button"
                className="btn btn-link btn-sm p-0 m-0 red-text"
                aria-label={t('settings.notifications.browser_remove', { device: sub.label })}
                disabled={busy !== null}
                onClick={() => void remove(sub.id)}
              >
                <i className="fas fa-trash" aria-hidden="true"></i>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
