import type { ComponentType, ReactNode } from 'react'

import { createContext, createElement, use } from 'react'

/**
 * A port of the parts of NgbModal the app uses: `openModal()` here, rendered
 * by `<ModalHost/>` (`ModalHost.tsx`) with ng-bootstrap's markup, so
 * Bootstrap's and the theme's modal styles apply unchanged:
 *
 *     <div class="modal-backdrop fade show" style="z-index: 1055"></div>
 *     <div class="modal d-block fade show {windowClass}" role="dialog" tabindex="-1" aria-modal="true">
 *       <div class="modal-dialog modal-{size} …" role="document">
 *         <div class="modal-content">{the component}</div>
 *
 * (The app's modal components render their own `.modal-content` root, so it
 * is nested in ng-bootstrap's one, exactly as before.)
 *
 * Behaviour kept from ng-bootstrap: `result` resolves on `close()` and rejects
 * on `dismiss()`; Escape dismisses unless `keyboard: false`; a click on the
 * backdrop dismisses unless `backdrop: 'static'` (which plays the "bump"
 * animation instead); a press inside the dialog released outside it does not
 * dismiss; focus moves into the modal, is trapped there, and goes back to
 * where it was on close; everything else on the page is aria-hidden while a
 * modal is open; `body.modal-open` and the scrollbar compensation.
 */

/** Why a modal was dismissed by ng-bootstrap itself (`ModalDismissReasons`). */
export enum ModalDismissReasons {
  BACKDROP_CLICK = 0,
  ESC = 1,
}

export interface ModalOptions {
  animation?: boolean
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  /** `true` (click dismisses), `false` (no backdrop) or `'static'`. */
  backdrop?: boolean | 'static'
  backdropClass?: string
  /** Return false (or a promise of false) to keep the modal open on dismiss. */
  beforeDismiss?: () => boolean | Promise<boolean>
  centered?: boolean
  /** `true`, or a breakpoint (`'md'`) for `modal-fullscreen-md-down`. */
  fullscreen?: boolean | string
  keyboard?: boolean
  modalDialogClass?: string
  role?: string
  scrollable?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl' | string
  windowClass?: string
}

/** What a modal component gets to end itself (`NgbActiveModal`). */
export interface ActiveModal<R = any> {
  close: (result?: R) => void
  dismiss: (reason?: unknown) => void
  update: (options: ModalOptions) => void
}

/** What `openModal` hands back (`NgbModalRef`). */
export interface ModalRef<R = any> extends ActiveModal<R> {
  /** Resolves with the `close()` result, rejects with the `dismiss()` reason. */
  result: Promise<R>
  /** Resolves once the modal has left the DOM. */
  hidden: Promise<void>
}

/** The props a component opened with `openModal` receives on top of its own. */
export interface ModalComponentProps<R = any> {
  activeModal: ActiveModal<R>
}

const DEFAULT_OPTIONS: ModalOptions = {
  animation: true,
  backdrop: true,
  fullscreen: false,
  keyboard: true,
  role: 'dialog',
}

class ModalStack {
  private views: ModalView[] = []
  private listeners = new Set<() => void>()
  private hosts = 0
  private nextId = 0
  private scrollBarRestore: (() => void) | null = null

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public getSnapshot = (): ModalView[] => this.views

  public hasHost(): boolean {
    return this.hosts > 0
  }

  /** Register a mounted `<ModalHost/>`; returns its unregister. */
  public attachHost(): () => void {
    this.hosts += 1
    return () => {
      this.hosts -= 1
    }
  }

  public open<R>(render: (activeModal: ActiveModal<R>) => ReactNode, options: ModalOptions): ModalEntry<R> {
    this.hideScrollBar()
    const entry = new ModalEntry<R>(++this.nextId, render, options)
    this.set([...this.views, { entry, options: entry.options, closing: false }])
    if (this.views.length === 1) {
      document.body.classList.add('modal-open')
    }
    return entry
  }

  public changed(entry: ModalEntry): void {
    this.set(this.views.map(view => (view.entry === entry ? { entry, options: entry.options, closing: !entry.open } : view)))
  }

  public remove(entry: ModalEntry): void {
    if (this.views.some(view => view.entry === entry)) {
      this.set(this.views.filter(view => view.entry !== entry))
    }
    // The last modal out puts the page back
    void Promise.resolve().then(() => {
      if (!this.views.length) {
        document.body.classList.remove('modal-open')
        this.restoreScrollBar()
      }
    })
  }

  public dismissAll(reason?: unknown): void {
    this.views.filter(view => !view.closing).forEach(view => view.entry.dismiss(reason))
  }

  public hasOpenModals(): boolean {
    return this.views.some(view => !view.closing)
  }

  public reset(): void {
    const all = this.views
    this.views = []
    for (const view of all) {
      view.entry.dismiss('reset')
      view.entry.remove()
    }
    document.body.classList.remove('modal-open')
    this.restoreScrollBar()
    this.emit()
  }

  private set(views: ModalView[]): void {
    this.views = views
    this.emit()
  }

  private emit(): void {
    this.listeners.forEach(listener => listener())
  }

  private hideScrollBar(): void {
    if (this.scrollBarRestore) {
      return
    }
    const scrollbarWidth = Math.abs(window.innerWidth - document.documentElement.clientWidth)
    const bodyStyle = document.body.style
    const { overflow, paddingRight } = bodyStyle
    if (scrollbarWidth > 0) {
      const actualPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0
      bodyStyle.paddingRight = `${actualPadding + scrollbarWidth}px`
    }
    bodyStyle.overflow = 'hidden'
    this.scrollBarRestore = () => {
      if (scrollbarWidth > 0) {
        bodyStyle.paddingRight = paddingRight
      }
      bodyStyle.overflow = overflow
    }
  }

  private restoreScrollBar(): void {
    const restore = this.scrollBarRestore
    this.scrollBarRestore = null
    restore?.()
  }
}

/** The open modals. `<ModalHost/>` renders it; use the functions below instead. */
export const stack = new ModalStack()

/** One open modal, for `<ModalHost/>`. */
export class ModalEntry<R = any> implements ModalRef<R> {
  public readonly result: Promise<R>
  public readonly hidden: Promise<void>
  /** The element that had focus when the modal was opened, to give it back. */
  public readonly elWithFocus: Element | null
  public options: ModalOptions
  private isOpen = true
  private resolveResult!: (value: R) => void
  private rejectResult!: (reason: unknown) => void
  private resolveHidden!: () => void

  constructor(
    public readonly id: number,
    public readonly render: (activeModal: ActiveModal<R>) => ReactNode,
    options: ModalOptions,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.elWithFocus = typeof document === 'undefined' ? null : document.activeElement
    this.result = new Promise<R>((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })
    // A dismissal nobody listens for is not an error
    this.result.then(null, () => {})
    this.hidden = new Promise<void>((resolve) => {
      this.resolveHidden = resolve
    })
  }

  /** What the component itself gets: the same three actions, bound. */
  public readonly activeModal: ActiveModal<R> = {
    close: result => this.close(result),
    dismiss: reason => this.dismiss(reason),
    update: options => this.update(options),
  }

  public get open(): boolean {
    return this.isOpen
  }

  public close = (result?: R): void => {
    if (!this.isOpen) {
      return
    }
    this.resolveResult(result as R)
    this.removeElements()
  }

  public dismiss = (reason?: unknown): void => {
    if (!this.isOpen) {
      return
    }
    const before = this.options.beforeDismiss
    if (!before) {
      this.doDismiss(reason)
      return
    }
    const outcome = before()
    if (outcome instanceof Promise) {
      outcome.then((value) => {
        if (value !== false) {
          this.doDismiss(reason)
        }
      }, () => {})
    } else if (outcome !== false) {
      this.doDismiss(reason)
    }
  }

  public update = (options: ModalOptions): void => {
    this.options = { ...this.options, ...options }
    stack.changed(this)
  }

  /** Take the modal out of the stack, once it has animated out. */
  public remove(): void {
    stack.remove(this)
    this.resolveHidden()
  }

  private doDismiss(reason: unknown): void {
    if (!this.isOpen) {
      return
    }
    this.rejectResult(reason)
    this.removeElements()
  }

  private removeElements(): void {
    this.isOpen = false
    restoreFocus(this.elWithFocus)
    if (!stack.hasHost()) {
      // Nothing is rendering it, so there is nothing to animate out
      this.remove()
      return
    }
    stack.changed(this)
  }
}

/** What `<ModalHost/>` renders from: one item per modal, replaced on every change. */
export interface ModalView {
  entry: ModalEntry
  options: ModalOptions
  closing: boolean
}

function restoreFocus(elWithFocus: Element | null): void {
  const el = elWithFocus as HTMLElement | null
  const target = el && typeof el.focus === 'function' && document.body.contains(el) ? el : document.body
  setTimeout(() => target.focus())
}

/**
 * Open a component in a modal (`NgbModal.open`). The component gets
 * `activeModal` as a prop, and `useActiveModal()` works anywhere inside it.
 * @param Component - the modal's content; it renders the `.modal-content` root itself
 * @param props - its props, other than `activeModal`
 * @param options - the NgbModal options
 */
export function openModal<P extends ModalComponentProps, R = any>(
  Component: ComponentType<P>,
  props: Omit<P, 'activeModal'>,
  options: ModalOptions = {},
): ModalRef<R> {
  const entry = stack.open<R>(activeModal => createElement(Component, { ...props, activeModal } as P), options)
  return { result: entry.result, hidden: entry.hidden, close: entry.close, dismiss: entry.dismiss, update: entry.update }
}

/** Dismiss every open modal (`NgbModal.dismissAll`). */
export function dismissAllModals(reason?: unknown): void {
  stack.dismissAll(reason)
}

/** Whether a modal is open (`NgbModal.hasOpenModals`). */
export function hasOpenModals(): boolean {
  return stack.hasOpenModals()
}

/** Close every modal at once and reset the page, for tests. */
export function resetModals(): void {
  stack.reset()
}

/** The modal a component is rendered in. Provided by `<ModalHost/>`. */
export const ActiveModalContext = createContext<ActiveModal | null>(null)

/** The modal this component was opened in (`inject(NgbActiveModal)`). */
export function useActiveModal<R = any>(): ActiveModal<R> {
  const activeModal = use(ActiveModalContext)
  if (!activeModal) {
    throw new Error('useActiveModal() must be used inside a component opened with openModal()')
  }
  return activeModal
}
