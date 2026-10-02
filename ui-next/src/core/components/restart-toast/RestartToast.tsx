import type { ToastComponentProps } from '@/core/ui/toast'

import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { ToastFrame } from '@/core/ui/ToastContainer'

/**
 * Accessible "restart required" toast.
 *
 * ngx-toastr's built-in toast already announces its message (role="alert") and
 * ships an accessible close button, but it has no custom keyboard-operable
 * action. This component adds a real, focusable "Restart Homebridge" button so
 * keyboard and screen-reader users can trigger the restart, plus the built-in
 * close button to dismiss without restarting. Clicking elsewhere on the toast
 * does nothing — the action is the explicit button.
 *
 * The message text is passed as the toast message and the restart action label
 * as the toast title, so both are already translated by the caller. Raised by
 * `settingsActions.showRestartToast()` once the shell has registered it with
 * `settingsActions.setRestartToastComponent(RestartToast)`.
 */
export function RestartToast({ toast }: ToastComponentProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const restart = () => {
    void navigate('/restart')
    toast.remove()
  }

  return (
    <ToastFrame toast={toast}>
      <button
        type="button"
        className="toast-close-button"
        aria-label={t('form.button_close')}
        onClick={toast.remove}
      >
        <span aria-hidden="true">&times;</span>
      </button>
      <div role="alert" className="toast-message">{toast.message}</div>
      <button type="button" className="hb-restart-toast-action" onClick={restart}>
        {toast.title}
        <span aria-hidden="true"> &rarr;</span>
      </button>
    </ToastFrame>
  )
}
