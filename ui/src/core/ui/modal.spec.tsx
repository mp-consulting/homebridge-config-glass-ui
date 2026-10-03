import type { ModalComponentProps } from '@/core/ui/modal'

import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dismissAllModals, hasOpenModals, ModalDismissReasons, openModal, resetModals, useActiveModal } from '@/core/ui/modal'
import { ModalHost } from '@/core/ui/ModalHost'
import { ModalHeader } from '@/core/ui/ModalParts'

function Dialog({ activeModal, label = 'Hello' }: ModalComponentProps<string> & { label?: string }) {
  return (
    <div className="modal-content">
      <div className="modal-body">
        <span className="label">{label}</span>
        <input className="first" />
        <button type="button" className="ok" onClick={() => activeModal.close('yes')}>OK</button>
        <button type="button" className="cancel" onClick={() => activeModal.dismiss('Dismiss')}>Cancel</button>
      </div>
    </div>
  )
}

function HookDialog(_props: ModalComponentProps) {
  const activeModal = useActiveModal()
  return <button type="button" className="hook-close" onClick={() => activeModal.close(42)}>close</button>
}

/** Flush the microtask that tidies the page after the last modal. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const windows = () => [...document.querySelectorAll<HTMLElement>('body > .modal')]
const backdrops = () => [...document.querySelectorAll<HTMLElement>('body > .modal-backdrop')]

describe('modal', () => {
  beforeEach(() => {
    render(<div id="page"><button type="button" id="opener">open</button></div>)
    render(<ModalHost />)
  })

  afterEach(() => {
    act(() => resetModals())
  })

  describe('the markup', () => {
    it('renders the ng-bootstrap window, dialog and content around the component', () => {
      act(() => {
        openModal(Dialog, { label: 'Hi' }, { size: 'lg', backdrop: 'static' })
      })

      const [win] = windows()
      expect(win.className).toContain('modal d-block fade show')
      expect(win.getAttribute('role')).toBe('dialog')
      expect(win.getAttribute('aria-modal')).toBe('true')
      expect(win.getAttribute('tabindex')).toBe('-1')
      const dialog = win.querySelector(':scope > .modal-dialog')!
      expect(dialog.className).toBe('modal-dialog modal-lg')
      expect(dialog.getAttribute('role')).toBe('document')
      expect(dialog.querySelector(':scope > .modal-content > .modal-content .label')?.textContent).toBe('Hi')
    })

    it('puts a backdrop behind it, above the page', () => {
      act(() => {
        openModal(Dialog, {})
      })

      const [backdrop] = backdrops()
      expect(backdrop.className).toBe('modal-backdrop fade show')
      expect(backdrop.style.zIndex).toBe('1055')
    })

    it('has no backdrop with backdrop: false', () => {
      act(() => {
        openModal(Dialog, {}, { backdrop: false })
      })

      expect(backdrops()).toHaveLength(0)
    })

    it('applies the window, dialog and layout options', () => {
      act(() => {
        openModal(Dialog, {}, { windowClass: 'wide', centered: true, scrollable: true, fullscreen: 'md', modalDialogClass: 'x' })
      })

      const [win] = windows()
      expect(win.classList).toContain('wide')
      expect(win.querySelector('.modal-dialog')?.className).toBe('modal-dialog modal-dialog-centered modal-fullscreen-md-down modal-dialog-scrollable x')
    })

    it('is named after the title of its ModalHeader', () => {
      function Titled({ activeModal }: ModalComponentProps) {
        return (
          <div className="modal-content">
            <ModalHeader title="My title" onClose={() => activeModal.dismiss()} />
          </div>
        )
      }
      act(() => {
        openModal(Titled, {})
      })

      const [win] = windows()
      const title = win.querySelector('.modal-title')!
      expect(title.id).not.toBe('')
      expect(win.getAttribute('aria-labelledby')).toBe(title.id)
      // One dialog: the component's own .modal-content is not another one
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    })

    it('names the dialog after a hand-written .modal-title too, and prefers ariaLabelledBy', () => {
      function Plain() {
        return <div className="modal-content"><h5 className="modal-title">Plain</h5></div>
      }
      act(() => {
        openModal(Plain, {})
        openModal(Plain, {}, { ariaLabelledBy: 'given' })
      })

      const [first, second] = windows()
      const title = first.querySelector('.modal-title')!
      expect(title.id).not.toBe('')
      expect(first.getAttribute('aria-labelledby')).toBe(title.id)
      expect(second.getAttribute('aria-labelledby')).toBe('given')
    })

    it('marks the body while a modal is open', async () => {
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(Dialog, {})
      })
      expect(document.body.classList).toContain('modal-open')
      expect(document.body.style.overflow).toBe('hidden')

      act(() => ref.close())
      await flush()

      expect(document.body.classList).not.toContain('modal-open')
      expect(document.body.style.overflow).toBe('')
      expect(windows()).toHaveLength(0)
      expect(backdrops()).toHaveLength(0)
    })
  })

  describe('the result', () => {
    // Every caller branches on whether the dialog resolved or rejected:
    // getting that the wrong way round turns a cancel into a confirmation
    it('resolves with what the component closed with', async () => {
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(Dialog, {})
      })

      fireEvent.click(document.querySelector('.ok')!)

      await expect(ref.result).resolves.toBe('yes')
    })

    it('rejects with the reason it was dismissed with', async () => {
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(Dialog, {})
      })

      fireEvent.click(document.querySelector('.cancel')!)

      await expect(ref.result).rejects.toBe('Dismiss')
    })

    it('gives the component its modal through useActiveModal too', async () => {
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(HookDialog, {})
      })

      fireEvent.click(document.querySelector('.hook-close')!)

      await expect(ref.result).resolves.toBe(42)
    })

    it('settles only once', async () => {
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(Dialog, {})
      })

      act(() => {
        ref.close('first')
        ref.dismiss('second')
      })

      await expect(ref.result).resolves.toBe('first')
    })

    it('can be kept open by beforeDismiss', async () => {
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(Dialog, {}, { beforeDismiss: () => false })
      })

      act(() => ref.dismiss('x'))

      expect(windows()).toHaveLength(1)
    })

    it('dismisses them all with dismissAllModals', async () => {
      let a!: ReturnType<typeof openModal>
      let b!: ReturnType<typeof openModal>
      act(() => {
        a = openModal(Dialog, {})
        b = openModal(Dialog, {})
      })
      expect(hasOpenModals()).toBe(true)

      act(() => dismissAllModals('all'))

      await expect(a.result).rejects.toBe('all')
      await expect(b.result).rejects.toBe('all')
      expect(hasOpenModals()).toBe(false)
    })
  })

  describe('the keyboard', () => {
    beforeEach(() => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        cb(0)
        return 0
      })
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('dismisses on Escape', async () => {
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(Dialog, {})
      })

      fireEvent.keyDown(windows()[0], { key: 'Escape' })

      await expect(ref.result).rejects.toBe(ModalDismissReasons.ESC)
    })

    it('ignores Escape with keyboard: false, and bumps a static backdrop', () => {
      act(() => {
        openModal(Dialog, {}, { keyboard: false, backdrop: 'static' })
      })

      fireEvent.keyDown(windows()[0], { key: 'Escape' })

      expect(windows()).toHaveLength(1)
    })

    it('leaves the modal open when something inside handled Escape itself', () => {
      act(() => {
        openModal(Dialog, {})
      })
      const input = document.querySelector('.first')!
      input.addEventListener('keydown', event => event.preventDefault())

      fireEvent.keyDown(input, { key: 'Escape' })

      expect(windows()).toHaveLength(1)
    })
  })

  describe('the backdrop', () => {
    it('dismisses on a click on the backdrop', async () => {
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(Dialog, {})
      })

      fireEvent.click(windows()[0])

      await expect(ref.result).rejects.toBe(ModalDismissReasons.BACKDROP_CLICK)
    })

    it('does not dismiss on a click inside the dialog', () => {
      act(() => {
        openModal(Dialog, {})
      })

      fireEvent.click(document.querySelector('.label')!)

      expect(windows()).toHaveLength(1)
    })

    it('stays open with a static backdrop, and bumps instead', () => {
      act(() => {
        openModal(Dialog, {}, { backdrop: 'static' })
      })

      fireEvent.click(windows()[0])

      expect(windows()).toHaveLength(1)
      expect(windows()[0].classList).toContain('modal-static')
    })

    it('does not dismiss a press that started inside the dialog', () => {
      // Selecting text in an input and releasing over the backdrop
      act(() => {
        openModal(Dialog, {})
      })

      fireEvent.mouseDown(document.querySelector('.first')!)
      fireEvent.mouseUp(windows()[0])
      fireEvent.click(windows()[0])

      expect(windows()).toHaveLength(1)
    })
  })

  describe('focus', () => {
    it('moves focus to the first focusable element', () => {
      act(() => {
        openModal(Dialog, {})
      })

      expect(document.activeElement).toBe(document.querySelector('.first'))
    })

    it('prefers an element marked for autofocus', () => {
      function Marked(_props: ModalComponentProps) {
        return (
          <div>
            <input className="a" />
            <input className="b" data-autofocus="" />
          </div>
        )
      }
      act(() => {
        openModal(Marked, {})
      })

      expect(document.activeElement).toBe(document.querySelector('.b'))
    })

    it('gives focus back to where it was on close', async () => {
      vi.useFakeTimers()
      const opener = document.getElementById('opener')!
      opener.focus()
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(Dialog, {})
      })

      act(() => ref.close())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })

      expect(document.activeElement).toBe(opener)
      vi.useRealTimers()
    })

    it('wraps Tab from the last element back to the first', () => {
      act(() => {
        openModal(Dialog, {})
      })
      const cancel = document.querySelector<HTMLElement>('.cancel')!
      act(() => cancel.focus())

      fireEvent.keyDown(cancel, { key: 'Tab' })

      expect(document.activeElement).toBe(document.querySelector('.first'))
    })

    it('wraps Shift+Tab from the first element to the last', () => {
      act(() => {
        openModal(Dialog, {})
      })
      const first = document.querySelector<HTMLElement>('.first')!
      act(() => {
        document.body.focus()
        first.focus()
      })

      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })

      expect(document.activeElement).toBe(document.querySelector('.cancel'))
    })

    it('hides the rest of the page from screen readers while open', async () => {
      let ref!: ReturnType<typeof openModal>
      act(() => {
        ref = openModal(Dialog, {})
      })

      const page = document.getElementById('page')!.parentElement!
      expect(page.getAttribute('aria-hidden')).toBe('true')
      expect(windows()[0].getAttribute('aria-hidden')).toBeNull()

      act(() => ref.close())
      await flush()

      expect(page.getAttribute('aria-hidden')).toBeNull()
    })
  })

  it('stacks a second modal on top of the first', async () => {
    let first!: ReturnType<typeof openModal>
    act(() => {
      first = openModal(Dialog, { label: 'one' })
      openModal(Dialog, { label: 'two' })
    })

    expect(windows().map(w => w.querySelector('.label')?.textContent)).toEqual(['one', 'two'])
    // The lower one is hidden from screen readers while the top one is open
    expect(windows()[0].getAttribute('aria-hidden')).toBe('true')

    act(() => first.close())
    await flush()
    expect(windows().map(w => w.querySelector('.label')?.textContent)).toEqual(['two'])
    expect(document.body.classList).toContain('modal-open')
  })
})
