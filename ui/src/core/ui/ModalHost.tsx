import type { ModalView } from '@/core/ui/modal'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { ActiveModalContext, ModalDismissReasons, stack } from '@/core/ui/modal'
import { cx } from '@/core/utilities/cx'

const FOCUSABLE_ELEMENTS_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function getFocusableBoundaryElements(element: HTMLElement): [HTMLElement | undefined, HTMLElement | undefined] {
  const list = [...element.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR)].filter(el => el.tabIndex !== -1)
  return [list[0], list.at(-1)]
}

/** The transition time of an element, as ng-bootstrap reads it. */
function transitionMs(element: HTMLElement): number {
  const { transitionDelay, transitionDuration, transitionProperty } = window.getComputedStyle(element)
  if (transitionProperty === 'none') {
    return 0
  }
  const ms = (Number.parseFloat(transitionDelay) + Number.parseFloat(transitionDuration)) * 1000
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Run `done` once the element's transition has finished: at once without
 * animation or a transition, else on transitionend or a just-in-case timer.
 * Returns a cancel function.
 */
function afterTransition(element: HTMLElement | null, animation: boolean | undefined, done: () => void): () => void {
  const ms = element && animation ? transitionMs(element) : 0
  if (!element || ms <= 0) {
    done()
    return () => {}
  }
  let finished = false
  let timer: ReturnType<typeof setTimeout> | undefined
  function cancel() {
    finished = true
    element!.removeEventListener('transitionend', onEnd)
    clearTimeout(timer)
  }
  function finish() {
    if (!finished) {
      cancel()
      done()
    }
  }
  function onEnd(event: TransitionEvent) {
    if (event.target === element) {
      finish()
    }
  }
  element.addEventListener('transitionend', onEnd)
  timer = setTimeout(finish, ms + 5)
  return cancel
}

const ariaHiddenValues = new Map<Element, string | null>()

function revertAriaHidden() {
  ariaHiddenValues.forEach((value, element) => {
    if (value) {
      element.setAttribute('aria-hidden', value)
    } else {
      element.removeAttribute('aria-hidden')
    }
  })
  ariaHiddenValues.clear()
}

/** Hide every sibling of the element, and of each of its ancestors, from screen readers. */
function setAriaHidden(element: Element) {
  const parent = element.parentElement
  if (parent && element !== document.body) {
    for (const sibling of parent.children) {
      if (sibling !== element && sibling.nodeName !== 'SCRIPT') {
        if (!ariaHiddenValues.has(sibling)) {
          ariaHiddenValues.set(sibling, sibling.getAttribute('aria-hidden'))
        }
        sibling.setAttribute('aria-hidden', 'true')
      }
    }
    setAriaHidden(parent)
  }
}

/**
 * The id of the dialog's `.modal-title` (the first one, giving it a generated
 * id when it has none), kept up to date as the modal's content changes, so the
 * dialog is named after its visible title without every caller passing
 * `ariaLabelledBy`.
 */
function useTitleId(ref: { current: HTMLElement | null }, fallbackId: string, explicitId: string | undefined): string | undefined {
  const [titleId, setTitleId] = useState<string | undefined>(explicitId)
  useLayoutEffect(() => {
    const el = ref.current
    if (explicitId || !el) {
      return
    }
    const read = () => {
      const title = el.querySelector<HTMLElement>('.modal-title')
      if (title && !title.id) {
        title.id = fallbackId
      }
      // eslint-disable-next-line react/set-state-in-effect -- the title is only in the DOM once the modal content has rendered
      setTitleId(title?.id || undefined)
    }

    read()
    if (typeof MutationObserver === 'undefined') {
      return
    }
    const observer = new MutationObserver(read)
    observer.observe(el, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [ref, fallbackId, explicitId])
  return explicitId ?? titleId
}

/**
 * Whether the element should carry `show`: added right after mount (after a
 * reflow, so the fade runs from the un-shown state), removed when closing.
 */
function useShown(ref: { current: HTMLElement | null }, animation: boolean | undefined, closing: boolean): boolean {
  const [mounted, setMounted] = useState(false)
  useLayoutEffect(() => {
    if (animation && ref.current) {
      void ref.current.offsetHeight
    }
    // eslint-disable-next-line react/set-state-in-effect -- the CSS transition needs the first render without `show`
    setMounted(true)
  }, [animation, ref])
  return mounted && !closing
}

function ModalBackdrop({ view }: { view: ModalView }) {
  const { options } = view
  const backdropRef = useRef<HTMLDivElement>(null)
  const shown = useShown(backdropRef, options.animation, view.closing)
  const show = !options.animation || shown
  const className = cx('modal-backdrop', options.backdropClass, options.animation ? 'fade' : '', show ? 'show' : '')
  return <div ref={backdropRef} className={className} style={{ zIndex: 1055 }} />
}

function ModalWindow({ view, isTop }: { view: ModalView, isTop: boolean }) {
  const { options, entry, closing } = view
  const windowRef = useRef<HTMLDivElement>(null)
  const preventCloseRef = useRef(false)
  const pressedInDialogRef = useRef(false)
  const lastFocusedRef = useRef<Element | null>(null)
  const [bumping, setBumping] = useState(false)
  const shown = useShown(windowRef, options.animation, closing)
  const generatedTitleId = useId()
  const labelledBy = useTitleId(windowRef, generatedTitleId, options.ariaLabelledBy)

  // Move focus in
  useLayoutEffect(() => {
    const el = windowRef.current!
    if (!el.contains(document.activeElement)) {
      const autoFocusable = el.querySelector<HTMLElement>('[ngbAutofocus], [data-autofocus]')
      const [firstFocusable] = getFocusableBoundaryElements(el)
      ;(autoFocusable || firstFocusable || el).focus()
    }
  }, [])

  // Animate out, then leave the stack
  useEffect(() => {
    if (!closing) {
      return
    }
    return afterTransition(windowRef.current, entry.options.animation, () => entry.remove())
  }, [closing, entry])

  // Only the top modal hides the rest of the page
  useEffect(() => {
    if (!isTop || closing || !windowRef.current) {
      return
    }
    revertAriaHidden()
    setAriaHidden(windowRef.current)
    return () => revertAriaHidden()
  }, [isTop, closing])

  const bump = () => {
    if (options.backdrop !== 'static') {
      return
    }
    setBumping(true)
    // The bump's own transition decides how long the class stays
    requestAnimationFrame(() => afterTransition(windowRef.current, options.animation, () => setBumping(false)))
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (closing) {
      return
    }
    if (event.key === 'Escape') {
      if (options.keyboard) {
        const native = event.nativeEvent
        // A frame later, so a widget inside that handles Escape itself (and
        // prevents the default) keeps the modal open
        requestAnimationFrame(() => {
          if (!native.defaultPrevented) {
            entry.dismiss(ModalDismissReasons.ESC)
          }
        })
      } else if (options.backdrop === 'static') {
        bump()
      }
      return
    }
    // The focus trap
    if (event.key === 'Tab' && isTop) {
      const el = windowRef.current!
      const [first, last] = getFocusableBoundaryElements(el)
      const focused = lastFocusedRef.current
      if ((focused === first || focused === el) && event.shiftKey) {
        last?.focus()
        event.preventDefault()
      }
      if (focused === last && !event.shiftKey) {
        first?.focus()
        event.preventDefault()
      }
    }
  }

  // Pressed inside the dialog and released on the backdrop (selecting text,
  // say): not a backdrop click
  const onWindowMouseUp = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (pressedInDialogRef.current && event.target === windowRef.current) {
      preventCloseRef.current = true
    }
    pressedInDialogRef.current = false
  }

  const onWindowClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!closing && event.target === windowRef.current) {
      if (options.backdrop === 'static') {
        bump()
      } else if (options.backdrop === true && !preventCloseRef.current) {
        entry.dismiss(ModalDismissReasons.BACKDROP_CLICK)
      }
    }
    preventCloseRef.current = false
  }

  const fullscreenClass = options.fullscreen === true
    ? 'modal-fullscreen'
    : typeof options.fullscreen === 'string' ? `modal-fullscreen-${options.fullscreen}-down` : ''

  const windowClassName = cx(
    'modal d-block',
    options.windowClass,
    options.animation ? 'fade' : '',
    shown ? 'show' : '',
    bumping ? 'modal-static' : '',
  )

  const dialogClassName = cx(
    'modal-dialog',
    options.size ? `modal-${options.size}` : '',
    options.centered ? 'modal-dialog-centered' : '',
    fullscreenClass,
    options.scrollable ? 'modal-dialog-scrollable' : '',
    options.modalDialogClass,
  )

  return (
    <div
      ref={windowRef}
      className={windowClassName}
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={options.ariaDescribedBy}
      role={options.role}
      onKeyDown={onKeyDown}
      onClick={onWindowClick}
      onMouseUp={onWindowMouseUp}
      onFocus={(event) => {
        lastFocusedRef.current = event.target
      }}
    >
      <div
        className={dialogClassName}
        role="document"
        onMouseDown={() => {
          preventCloseRef.current = false
          pressedInDialogRef.current = true
        }}
      >
        <div className="modal-content">
          <ActiveModalContext value={entry.activeModal}>
            {entry.render(entry.activeModal)}
          </ActiveModalContext>
        </div>
      </div>
    </div>
  )
}

/**
 * Renders the open modals into `<body>`. Mount once, inside the router (modal
 * components navigate).
 */
export function ModalHost() {
  const views = useSyncExternalStore(stack.subscribe, stack.getSnapshot, stack.getSnapshot)

  useEffect(() => stack.attachHost(), [])

  if (!views.length || typeof document === 'undefined') {
    return null
  }

  const topId = views.filter(view => !view.closing).at(-1)?.entry.id

  return createPortal(
    views.map(view => (
      <ModalPair key={view.entry.id} view={view} isTop={view.entry.id === topId} />
    )),
    document.body,
  )
}

function ModalPair({ view, isTop }: { view: ModalView, isTop: boolean }) {
  return (
    <>
      {view.options.backdrop !== false && <ModalBackdrop view={view} />}
      <ModalWindow view={view} isTop={isTop} />
    </>
  )
}
