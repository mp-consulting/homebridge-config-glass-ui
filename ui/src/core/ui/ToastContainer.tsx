import type { ToastComponentProps, ToastController, ToastOptions, ToastPackage, ToastService, ToastState } from '@/core/ui/toast'
import type { CSSProperties, ReactNode } from 'react'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { toast } from '@/core/ui/toast'
import { cx } from '@/core/utilities/cx'

import './toast.scss'

/**
 * A message with `enableHtml`. The sanitiser (DOMPurify) is loaded with the
 * first one rather than with the app shell: html toasts are rare, and plain
 * ones render as text.
 */
function HtmlMessage({ className, html }: { className: string, html: string }) {
  const [clean, setClean] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    import('@/core/ui/sanitize-html')
      .then(({ sanitizeHtml }) => {
        if (live) {
          setClean(sanitizeHtml(html))
        }
      })
      .catch(error => console.error(error))
    return () => {
      live = false
    }
  }, [html])

  // eslint-disable-next-line react/dom-no-dangerously-set-innerhtml -- sanitised by sanitizeHtml(), like Angular's [innerHTML]
  return <div role="alert" className={className} dangerouslySetInnerHTML={{ __html: clean ?? '' }} />
}

/**
 * The default toast (the app's `AppToastComponent`).
 *
 * ngx-toastr's default template gives the message both a role="alert" live
 * region AND an aria-label that duplicates the visible text, so VoiceOver
 * reads each toast three times. This one drops the redundant aria-label (and
 * the title's) but keeps role="alert" on the message — that is what actually
 * drives the announcement, so the toast is now read exactly once.
 */
export function AppToast({ toast }: ToastComponentProps) {
  const { t } = useTranslation()
  const { options, title, message } = toast
  return (
    <ToastFrame toast={toast} onClick={toast.tapToast}>
      {options.closeButton && (
        <button type="button" className="toast-close-button" aria-label={t('form.button_close')} onClick={toast.remove}>
          <span aria-hidden="true">&times;</span>
        </button>
      )}
      {title && (
        <div className={options.titleClass}>
          {title}
          {toast.duplicatesCount ? <span>{`[${toast.duplicatesCount + 1}]`}</span> : null}
        </div>
      )}
      {message && (options.enableHtml
        ? <HtmlMessage className={options.messageClass} html={message} />
        : <div role="alert" className={options.messageClass}>{message}</div>
      )}
      {options.progressBar && (
        <div>
          <div className="toast-progress" style={{ width: `${toast.width}%` }} />
        </div>
      )}
    </ToastFrame>
  )
}

/**
 * The timers and state of one toast, as ngx-toastr's `ToastBase`/`Toast`.
 * @param pkg - the toast being rendered
 * @param service - the service that raised it
 */
function useToastController(pkg: ToastPackage, service: ToastService): ToastController {
  const [state, setState] = useState<ToastState>('inactive')
  const [width, setWidth] = useState(-1)
  const [duplicatesCount, setDuplicatesCount] = useState(0)
  const [options, setOptions] = useState<ToastOptions>(pkg.config)

  // The handlers read and write these synchronously, as the class fields did
  const stateRef = useRef<ToastState>('inactive')
  const optionsRef = useRef<ToastOptions>(pkg.config)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const hideTimeRef = useRef(0)
  const widthRef = useRef(-1)

  const originalTimeout = pkg.config.timeOut

  const updateState = useCallback((next: ToastState) => {
    stateRef.current = next
    setState(next)
  }, [])
  const updateOptions = useCallback((next: ToastOptions) => {
    optionsRef.current = next
    setOptions(next)
  }, [])
  const updateWidth = useCallback((next: number) => {
    widthRef.current = next
    setWidth(next)
  }, [])

  const updateProgress = useCallback(() => {
    const opts = optionsRef.current
    if (widthRef.current === 0 || widthRef.current === 100 || !opts.timeOut) {
      return
    }
    const remaining = hideTimeRef.current - Date.now()
    let next = (remaining / opts.timeOut) * 100
    if (opts.progressAnimation === 'increasing') {
      next = 100 - next
    }
    updateWidth(Math.min(100, Math.max(0, next)))
  }, [updateWidth])

  const remove = useCallback(() => {
    if (stateRef.current === 'removed') {
      return
    }
    clearTimeout(timeoutRef.current)
    updateState('removed')
    timeoutRef.current = setTimeout(() => service.remove(pkg.toastId), +pkg.config.easeTime)
  }, [pkg, service, updateState])

  const activateToast = useCallback(() => {
    const opts = optionsRef.current
    updateState('active')
    if (!(opts.disableTimeOut === true || opts.disableTimeOut === 'timeOut') && opts.timeOut) {
      timeoutRef.current = setTimeout(remove, opts.timeOut)
      hideTimeRef.current = Date.now() + opts.timeOut
      if (opts.progressBar) {
        intervalRef.current = setInterval(updateProgress, 10)
      }
    }
  }, [remove, updateProgress, updateState])

  const resetTimeout = useCallback(() => {
    const opts = optionsRef.current
    clearTimeout(timeoutRef.current)
    clearInterval(intervalRef.current)
    updateState('active')
    updateOptions({ ...opts, timeOut: originalTimeout })
    timeoutRef.current = setTimeout(remove, originalTimeout)
    hideTimeRef.current = Date.now() + (originalTimeout || 0)
    updateWidth(-1)
    if (opts.progressBar) {
      intervalRef.current = setInterval(updateProgress, 10)
    }
  }, [originalTimeout, remove, updateOptions, updateProgress, updateState, updateWidth])

  useEffect(() => {
    const { toastRef } = pkg
    const unbind = toastRef.bind({
      manualClose: remove,
      resetTimeout,
      countDuplicate: setDuplicatesCount,
      activate: activateToast,
    })
    if (toastRef.activated) {
      activateToast()
    }
    return () => {
      unbind()
      clearTimeout(timeoutRef.current)
      clearInterval(intervalRef.current)
    }
    // Runs once per toast: the callbacks only change with the package
  }, [pkg, remove, resetTimeout, activateToast])

  const tapToast = useCallback(() => {
    if (stateRef.current === 'removed') {
      return
    }
    pkg.config.onTap?.()
    if (optionsRef.current.tapToDismiss) {
      remove()
    }
  }, [pkg, remove])

  const stickAround = useCallback(() => {
    if (stateRef.current === 'removed') {
      return
    }
    if (optionsRef.current.disableTimeOut !== 'extendedTimeOut') {
      clearTimeout(timeoutRef.current)
      updateOptions({ ...optionsRef.current, timeOut: 0 })
      hideTimeRef.current = 0
      clearInterval(intervalRef.current)
      updateWidth(0)
    }
  }, [updateOptions, updateWidth])

  const delayedHideToast = useCallback(() => {
    const opts = optionsRef.current
    if (opts.disableTimeOut === true || opts.disableTimeOut === 'extendedTimeOut' || opts.extendedTimeOut === 0 || stateRef.current === 'removed') {
      return
    }
    const extendedTimeOut = opts.extendedTimeOut
    timeoutRef.current = setTimeout(remove, extendedTimeOut)
    updateOptions({ ...opts, timeOut: extendedTimeOut })
    hideTimeRef.current = Date.now() + (extendedTimeOut || 0)
    updateWidth(-1)
    if (opts.progressBar) {
      intervalRef.current = setInterval(updateProgress, 10)
    }
  }, [remove, updateOptions, updateProgress, updateWidth])

  const triggerAction = useCallback((action?: unknown) => pkg.config.onAction?.(action), [pkg])

  return {
    toastId: pkg.toastId,
    state,
    options,
    message: pkg.message,
    title: pkg.title,
    toastType: pkg.toastType,
    duplicatesCount,
    width,
    remove,
    tapToast,
    stickAround,
    delayedHideToast,
    triggerAction,
  }
}

/**
 * The toast's host element — what ngx-toastr's `host` bindings produced. Every
 * toast component renders this as its root. Pass `onClick={toast.tapToast}`
 * for tap-to-dismiss; a toast whose only actions are its buttons leaves it out.
 */
export function ToastFrame({ toast: controller, onClick, children }: { toast: ToastController, onClick?: () => void, children?: ReactNode }) {
  const [entering, setEntering] = useState(true)
  const { options, state } = controller
  const className = cx(
    `${controller.toastType} ${options.toastClass}`,
    entering && state !== 'removed' ? 'toast-in' : '',
    state === 'removed' ? 'toast-out' : '',
  )

  const style = {
    '--animation-easing': options.easing,
    '--animation-duration': `${options.easeTime}ms`,
    'display': state === 'inactive' ? 'none' : undefined,
  } as CSSProperties

  return (
    <div
      toast-component=""
      className={className}
      style={style}
      onMouseEnter={controller.stickAround}
      onMouseLeave={controller.delayedHideToast}
      // A keyboard user reading or reaching for the toast's buttons gets the
      // same pause as a pointer resting on it
      onFocus={controller.stickAround}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          controller.delayedHideToast()
        }
      }}
      onClick={onClick}
      onAnimationEnd={() => setEntering(false)}
    >
      {children}
    </div>
  )
}

function ToastInstance({ pkg, service }: { pkg: ToastPackage, service: ToastService }) {
  const controller = useToastController(pkg, service)
  const Component = pkg.config.toastComponent ?? AppToast
  return <Component toast={controller} />
}

/**
 * Renders the toasts. Mount once, inside the router (toast components such as
 * the restart toast navigate).
 */
export function ToastContainer({ service = toast }: { service?: ToastService }) {
  const toasts = useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot)
  const positions = service.getPositions()
  const byPosition = useMemo(() => {
    const map = new Map<string, ToastPackage[]>()
    for (const pkg of toasts) {
      map.set(pkg.config.positionClass, [...(map.get(pkg.config.positionClass) ?? []), pkg])
    }
    return map
  }, [toasts])

  // ngx-toastr creates the overlay on the first toast and keeps it
  if (!positions.length || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="overlay-container" aria-live="polite">
      {positions.map(position => (
        <div key={position} id="toast-container" className={`${position} toast-container`}>
          {(byPosition.get(position) ?? []).map(pkg => <ToastInstance key={pkg.toastId} pkg={pkg} service={service} />)}
        </div>
      ))}
    </div>,
    document.body,
  )
}
