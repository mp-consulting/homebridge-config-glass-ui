import type { ComponentType } from 'react'
import type { Observable } from 'rxjs'

import { Subject } from 'rxjs'

/**
 * A port of the parts of ngx-toastr the app uses: the same service API
 * (`success/error/info/warning/show/clear/remove`), the same configuration
 * semantics (`maxOpened` + `autoDismiss`, timeouts that pause on hover, the
 * extended timeout on leave) and the same markup, so the vendored toastr
 * styles and the app's overrides in `scss/components/toastr.scss` apply as is:
 *
 *     <div class="overlay-container" aria-live="polite">
 *       <div id="toast-container" class="toast-bottom-right toast-container">
 *         <div class="toast-success ngx-toastr toast-in" style="--animation-…">…</div>
 */

export type DisableTimeOut = boolean | 'timeOut' | 'extendedTimeOut'

export interface ToastComponentProps {
  toast: ToastController
}

/** The per-toast options (ngx-toastr `IndividualConfig`). */
export interface ToastOptions {
  closeButton: boolean
  disableTimeOut: DisableTimeOut
  timeOut: number
  extendedTimeOut: number
  enableHtml: boolean
  progressBar: boolean
  progressAnimation: 'decreasing' | 'increasing'
  toastClass: string
  positionClass: string
  titleClass: string
  messageClass: string
  easing: string
  easeTime: number
  tapToDismiss: boolean
  /** A component to render instead of the default `AppToast`. It renders `<ToastFrame>` as its root. */
  toastComponent?: ComponentType<ToastComponentProps>
  /** Opaque data for a custom `toastComponent`. */
  payload?: unknown
}

/** The service-wide options (ngx-toastr `GlobalConfig`). */
export interface ToastGlobalConfig extends ToastOptions {
  maxOpened: number
  autoDismiss: boolean
  newestOnTop: boolean
  preventDuplicates: boolean
  countDuplicates: boolean
  resetTimeoutOnDuplicate: boolean
  includeTitleDuplicates: boolean
  iconClasses: { error: string, info: string, success: string, warning: string }
}

export type ToastOverrides = Partial<ToastOptions>

export type ToastState = 'inactive' | 'active' | 'removed'

/** What a raised toast hands back (ngx-toastr `ActiveToast`). */
export interface ActiveToast {
  toastId: number
  title: string
  message: string
  toastRef: ToastRef
  onShown: Observable<void>
  onHidden: Observable<void>
  onTap: Observable<void>
  onAction: Observable<unknown>
}

/** The link between the service and one rendered toast (ngx-toastr `ToastRef`). */
export class ToastRef {
  public duplicatesCount = 0
  /** Set once the toast may start showing; it waits while `maxOpened` toasts are on screen. */
  public activated = false
  public readonly afterClosed$ = new Subject<void>()
  public readonly activate$ = new Subject<void>()
  public readonly manualClose$ = new Subject<void>()
  public readonly resetTimeout$ = new Subject<void>()
  public readonly countDuplicate$ = new Subject<number>()
  private closed = false

  constructor(private readonly detach: () => void) {}

  /** Ask the toast to animate out and remove itself. */
  public manualClose(): void {
    this.manualClose$.next()
  }

  /** Remove the toast at once. */
  public close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.detach()
    this.afterClosed$.next()
    this.afterClosed$.complete()
    this.manualClose$.complete()
    this.activate$.complete()
    this.resetTimeout$.complete()
    this.countDuplicate$.complete()
  }

  public activate(): void {
    if (this.activated) {
      return
    }
    this.activated = true
    this.activate$.next()
    this.activate$.complete()
  }

  public onDuplicate(resetTimeout: boolean, countDuplicate: boolean): void {
    if (resetTimeout) {
      this.resetTimeout$.next()
    }
    if (countDuplicate) {
      this.countDuplicate$.next(++this.duplicatesCount)
    }
  }
}

/** Everything a toast component is built from (ngx-toastr `ToastPackage`). */
export interface ToastPackage {
  toastId: number
  config: ToastOptions
  message: string | null | undefined
  title: string | null | undefined
  toastType: string
  toastRef: ToastRef
  tap$: Subject<void>
  action$: Subject<unknown>
}

const DEFAULT_CONFIG: ToastGlobalConfig = {
  maxOpened: 0,
  autoDismiss: false,
  newestOnTop: true,
  preventDuplicates: false,
  countDuplicates: false,
  resetTimeoutOnDuplicate: false,
  includeTitleDuplicates: false,
  iconClasses: {
    error: 'toast-error',
    info: 'toast-info',
    success: 'toast-success',
    warning: 'toast-warning',
  },
  closeButton: false,
  disableTimeOut: false,
  timeOut: 5000,
  extendedTimeOut: 1000,
  enableHtml: false,
  progressBar: false,
  toastClass: 'ngx-toastr',
  positionClass: 'toast-top-right',
  titleClass: 'toast-title',
  messageClass: 'toast-message',
  easing: 'ease-in',
  easeTime: 300,
  tapToDismiss: true,
  progressAnimation: 'decreasing',
}

/** The app's toastr configuration (was `provideToastr` in `ui-libraries.providers.ts`). */
export const APP_TOAST_CONFIG: Partial<ToastGlobalConfig> = {
  autoDismiss: true,
  newestOnTop: false,
  closeButton: true,
  // A failing plugin can raise a toast per accessory; without a cap they
  // cover the page
  maxOpened: 2,
  positionClass: 'toast-bottom-right',
}

interface ToastEntry {
  toastId: number
  title: string
  message: string
  toastRef: ToastRef
  pkg: ToastPackage
  active: ActiveToast
}

/** The toast service (ngx-toastr `ToastrService`). Use the `toast` instance. */
export class ToastService {
  public readonly toastrConfig: ToastGlobalConfig
  private currentlyActive = 0
  private toasts: ToastEntry[] = []
  private index = 0
  private listeners = new Set<() => void>()
  private attached: ToastPackage[] = []
  private positions: string[] = []

  constructor(config: Partial<ToastGlobalConfig> = {}) {
    this.toastrConfig = {
      ...DEFAULT_CONFIG,
      ...config,
      iconClasses: { ...DEFAULT_CONFIG.iconClasses, ...config.iconClasses },
    }
  }

  public show(message?: string, title?: string, override: ToastOverrides = {}, type = ''): ActiveToast {
    return this.buildNotification(type, message, title, this.applyConfig(override))
  }

  public success(message?: string, title?: string, override: ToastOverrides = {}): ActiveToast {
    return this.buildNotification(this.toastrConfig.iconClasses.success || '', message, title, this.applyConfig(override))
  }

  public error(message?: string, title?: string, override: ToastOverrides = {}): ActiveToast {
    return this.buildNotification(this.toastrConfig.iconClasses.error || '', message, title, this.applyConfig(override))
  }

  public info(message?: string, title?: string, override: ToastOverrides = {}): ActiveToast {
    return this.buildNotification(this.toastrConfig.iconClasses.info || '', message, title, this.applyConfig(override))
  }

  public warning(message?: string, title?: string, override: ToastOverrides = {}): ActiveToast {
    return this.buildNotification(this.toastrConfig.iconClasses.warning || '', message, title, this.applyConfig(override))
  }

  /** Animate out all toasts, or the one with this id. */
  public clear(toastId?: number): void {
    for (const toast of this.toasts.slice()) {
      if (toastId !== undefined) {
        if (toast.toastId === toastId) {
          toast.toastRef.manualClose()
          return
        }
      } else {
        toast.toastRef.manualClose()
      }
    }
  }

  /** Remove a toast at once, and let the next waiting one in. */
  public remove(toastId: number): boolean {
    const index = this.toasts.findIndex(toast => toast.toastId === toastId)
    if (index === -1) {
      return false
    }
    const [found] = this.toasts.splice(index, 1)
    found.toastRef.close()
    this.currentlyActive = this.currentlyActive - 1
    if (!this.toastrConfig.maxOpened || !this.toasts.length) {
      return false
    }
    if (this.currentlyActive < this.toastrConfig.maxOpened && this.toasts[this.currentlyActive]) {
      const next = this.toasts[this.currentlyActive].toastRef
      if (!next.activated) {
        this.currentlyActive = this.currentlyActive + 1
        next.activate()
      }
    }
    return true
  }

  /**
   * Drop every toast without animating, and forget the positions used. For
   * tests, which share the one module-level service.
   */
  public reset(): void {
    for (const toast of this.toasts.slice()) {
      toast.toastRef.close()
    }
    this.toasts = []
    this.attached = []
    this.positions = []
    this.currentlyActive = 0
    this.emit()
  }

  // ----- for <ToastContainer/> -----

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getSnapshot = (): ToastPackage[] => this.attached

  /** The position panes, in the order they were first used. */
  public getPositions(): string[] {
    return this.positions
  }

  private emit(): void {
    this.listeners.forEach(listener => listener())
  }

  private applyConfig(override: ToastOverrides): ToastOptions {
    return { ...this.toastrConfig, ...override }
  }

  private findDuplicate(title = '', message = '', resetOnDuplicate: boolean, countDuplicates: boolean): ToastEntry | null {
    const { includeTitleDuplicates } = this.toastrConfig
    for (const toast of this.toasts) {
      const hasDuplicateTitle = includeTitleDuplicates && toast.title === title
      if ((!includeTitleDuplicates || hasDuplicateTitle) && toast.message === message) {
        toast.toastRef.onDuplicate(resetOnDuplicate, countDuplicates)
        return toast
      }
    }
    return null
  }

  private buildNotification(toastType: string, message: string | undefined, title: string | undefined, config: ToastOptions): ActiveToast {
    const duplicate = this.findDuplicate(
      title,
      message,
      this.toastrConfig.resetTimeoutOnDuplicate && config.timeOut > 0,
      this.toastrConfig.countDuplicates,
    )
    if (((this.toastrConfig.includeTitleDuplicates && title) || message) && this.toastrConfig.preventDuplicates && duplicate !== null) {
      return duplicate.active
    }

    // Over the cap: the new toast waits, and with autoDismiss the oldest makes
    // room for it
    let keepInactive = false
    if (this.toastrConfig.maxOpened && this.currentlyActive >= this.toastrConfig.maxOpened) {
      keepInactive = true
      if (this.toastrConfig.autoDismiss) {
        this.clear(this.toasts[0].toastId)
      }
    }

    if (!this.positions.includes(config.positionClass)) {
      this.positions = [...this.positions, config.positionClass]
    }

    this.index = this.index + 1
    const toastId = this.index
    // The message is sanitised where it is rendered (AppToast), not here
    const toastRef = new ToastRef(() => {
      this.attached = this.attached.filter(pkg => pkg.toastId !== toastId)
      this.emit()
    })
    const pkg: ToastPackage = {
      toastId,
      config,
      message,
      title,
      toastType,
      toastRef,
      tap$: new Subject<void>(),
      action$: new Subject<unknown>(),
    }
    this.attached = this.toastrConfig.newestOnTop ? [pkg, ...this.attached] : [...this.attached, pkg]

    const active: ActiveToast = {
      toastId,
      title: title || '',
      message: message || '',
      toastRef,
      onShown: toastRef.activate$.asObservable(),
      onHidden: toastRef.afterClosed$.asObservable(),
      onTap: pkg.tap$.asObservable(),
      onAction: pkg.action$.asObservable(),
    }
    const entry: ToastEntry = { toastId, title: title || '', message: message || '', toastRef, pkg, active }

    if (!keepInactive) {
      this.currentlyActive = this.currentlyActive + 1
      // Activated on the next tick like ngx-toastr, so a caller can subscribe
      // to `onShown` first
      setTimeout(() => toastRef.activate())
    }
    this.toasts.push(entry)
    this.emit()
    return active
  }
}

/** The app-wide toast service (replaces the injected `ToastrService`). */
export const toast = new ToastService(APP_TOAST_CONFIG)

/** The state and actions a toast component renders from (the ngx-toastr `Toast` base class). */
export interface ToastController {
  toastId: number
  state: ToastState
  options: ToastOptions
  message: string | null | undefined
  title: string | null | undefined
  toastType: string
  duplicatesCount: number
  width: number
  /** Animate out, then remove. */
  remove: () => void
  tapToast: () => void
  stickAround: () => void
  delayedHideToast: () => void
  /** Emit on the toast's `onAction`. */
  triggerAction: (action?: unknown) => void
}
