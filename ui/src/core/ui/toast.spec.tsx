import type { ToastComponentProps } from '@/core/ui/toast'

import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@/core/ui/toast'
import { ToastContainer, ToastFrame } from '@/core/ui/ToastContainer'

/** Let the toasts activate (ngx-toastr activates them on the next tick). */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function toastEls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('#toast-container > [toast-component]')]
}

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    render(<ToastContainer />)
  })

  afterEach(() => {
    act(() => toast.reset())
    vi.useRealTimers()
  })

  describe('the configuration', () => {
    it('shows them with the app toast component unless told otherwise', async () => {
      // The app has its own toast markup (no duplicate aria-label). Nothing is
      // configured, so the container falls back to AppToast
      expect(toast.toastrConfig.toastComponent).toBeUndefined()
      act(() => {
        toast.info('x')
      })
      await tick()

      expect(document.querySelector('.toast-close-button')?.getAttribute('aria-label')).toBe('form.button_close')
    })

    it('keeps at most two on screen at once', () => {
      expect(toast.toastrConfig.maxOpened).toBe(2)
      expect(toast.toastrConfig.autoDismiss).toBe(true)
    })

    it('stacks them oldest first in the bottom right', () => {
      expect(toast.toastrConfig.positionClass).toBe('toast-bottom-right')
      expect(toast.toastrConfig.newestOnTop).toBe(false)
      expect(toast.toastrConfig.closeButton).toBe(true)
    })
  })

  describe('the markup', () => {
    it('renders the ngx-toastr overlay, pane and toast classes', async () => {
      act(() => {
        toast.success('Plugin installed', 'Success')
      })
      await tick()

      const overlay = document.querySelector('.overlay-container')!
      expect(overlay.getAttribute('aria-live')).toBe('polite')
      const pane = overlay.querySelector('#toast-container')!
      expect(pane.classList).toContain('toast-bottom-right')
      expect(pane.classList).toContain('toast-container')
      const [el] = toastEls()
      expect(el.className).toContain('toast-success ngx-toastr')
      expect(el.style.getPropertyValue('--animation-duration')).toBe('300ms')
    })

    it('uses the type class of each level', async () => {
      act(() => {
        toast.error('a')
        toast.warning('b')
      })
      await tick()

      expect(toastEls().map(el => el.classList.contains('toast-error') || el.classList.contains('toast-warning'))).toEqual([true, true])
    })

    it('announces the message through a live region', async () => {
      // `role="alert"` is what actually makes a screen reader read the toast
      act(() => {
        toast.success('Plugin installed')
      })
      await tick()

      expect(document.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Plugin installed')
    })

    it('does not label the message as well as announcing it', async () => {
      // ngx-toastr's own template adds an aria-label duplicating the visible
      // text, which made VoiceOver read every toast three times
      act(() => {
        toast.success('Plugin installed', 'Success')
      })
      await tick()

      expect(document.querySelector('[role="alert"]')?.getAttribute('aria-label')).toBeNull()
      expect(document.querySelector('.toast-title')?.getAttribute('aria-label')).toBeNull()
    })

    it('keeps the close button labelled, since it has no visible text', async () => {
      act(() => {
        toast.success('Plugin installed')
      })
      await tick()

      expect(document.querySelector('.toast-close-button')?.getAttribute('aria-label')).toBe('form.button_close')
      expect(document.querySelector('.toast-close-button span')?.getAttribute('aria-hidden')).toBe('true')
    })

    it('shows the title when there is one', async () => {
      act(() => {
        toast.success('Plugin installed', 'Success')
      })
      await tick()

      expect(document.querySelector('.toast-title')?.textContent?.trim()).toBe('Success')
    })

    it('renders the message as text unless html is enabled', async () => {
      act(() => {
        toast.info('<b>bold</b>')
        toast.info('<b>bold</b><img src=x onerror="alert(1)">', undefined, { enableHtml: true })
      })
      await tick()

      const [plain, html] = [...document.querySelectorAll('[role="alert"]')]
      expect(plain.querySelector('b')).toBeNull()
      expect(html.querySelector('b')?.textContent).toBe('bold')
      expect(html.innerHTML).not.toContain('onerror')
    })
  })

  describe('the timing', () => {
    it('hides the toast while it waits to activate', () => {
      act(() => {
        toast.info('x')
      })

      expect(toastEls()[0].style.display).toBe('none')
    })

    it('fades out after the timeout and is gone after the fade', async () => {
      const hidden = vi.fn()
      act(() => {
        toast.info('x', undefined, { onHidden: hidden })
      })
      await tick()

      await tick(5000)
      expect(toastEls()[0].classList).toContain('toast-out')
      expect(hidden).not.toHaveBeenCalled()

      await tick(300)
      expect(toastEls()).toHaveLength(0)
      expect(hidden).toHaveBeenCalledTimes(1)
    })

    it('stays while the pointer is over it, and leaves the extended timeout after', async () => {
      act(() => {
        toast.info('x')
      })
      await tick()

      fireEvent.mouseEnter(toastEls()[0])
      await tick(10000)
      expect(toastEls()[0].classList).not.toContain('toast-out')

      fireEvent.mouseLeave(toastEls()[0])
      await tick(1000)
      expect(toastEls()[0].classList).toContain('toast-out')
    })

    it('never times out with disableTimeOut', async () => {
      act(() => {
        toast.info('x', undefined, { disableTimeOut: true })
      })
      await tick(60000)

      expect(toastEls()).toHaveLength(1)
    })

    it('dismisses on tap', async () => {
      act(() => {
        toast.info('x')
      })
      await tick()

      fireEvent.click(toastEls()[0])
      await tick(300)

      expect(toastEls()).toHaveLength(0)
    })

    it('dismisses from the close button', async () => {
      act(() => {
        toast.info('x', undefined, { tapToDismiss: false })
      })
      await tick()

      fireEvent.click(document.querySelector('.toast-close-button')!)
      await tick(300)

      expect(toastEls()).toHaveLength(0)
    })
  })

  describe('the cap', () => {
    it('dismisses the oldest to make room for a third', async () => {
      act(() => {
        toast.info('first', undefined, { disableTimeOut: true })
        toast.info('second', undefined, { disableTimeOut: true })
      })
      await tick()

      act(() => {
        toast.info('third', undefined, { disableTimeOut: true })
      })
      await tick()
      expect(toastEls()[0].classList).toContain('toast-out')
      expect(toastEls()[2].style.display).toBe('none')

      await tick(300)
      const els = toastEls()
      expect(els.map(el => el.textContent)).toEqual([expect.stringContaining('second'), expect.stringContaining('third')])
      expect(els[1].style.display).toBe('')
    })
  })

  describe('clear', () => {
    it('removes just the toast with that id', async () => {
      let id = 0
      act(() => {
        id = toast.info('a', undefined, { disableTimeOut: true }).toastId
        toast.info('b', undefined, { disableTimeOut: true })
      })
      await tick()

      act(() => toast.clear(id))
      await tick(300)

      expect(toastEls().map(el => el.textContent)).toEqual([expect.stringContaining('b')])
    })

    it('removes all of them without an id', async () => {
      act(() => {
        toast.info('a', undefined, { disableTimeOut: true })
        toast.info('b', undefined, { disableTimeOut: true })
      })
      await tick()

      act(() => toast.clear())
      await tick(300)

      expect(toastEls()).toHaveLength(0)
    })
  })

  describe('a custom toast component', () => {
    function Custom({ toast: t }: ToastComponentProps) {
      return (
        <ToastFrame toast={t}>
          <div role="alert">{t.message}</div>
          <button type="button" className="custom-action" onClick={() => t.triggerAction('go')}>{t.title}</button>
          <button type="button" className="custom-close" onClick={t.remove}>x</button>
        </ToastFrame>
      )
    }

    it('renders it in place of the default one, with the toast classes', async () => {
      act(() => {
        toast.info('Changes need a restart', 'Restart', { toastComponent: Custom, toastClass: 'ngx-toastr hb-custom' })
      })
      await tick()

      const [el] = toastEls()
      expect(el.className).toContain('toast-info ngx-toastr hb-custom')
      expect(el.querySelector('.custom-action')?.textContent).toBe('Restart')
      expect(el.querySelector('.toast-close-button')).toBeNull()
    })

    it('is not dismissed by a tap when it does not ask for it', async () => {
      act(() => {
        toast.info('m', 't', { toastComponent: Custom, disableTimeOut: true })
      })
      await tick()

      fireEvent.click(toastEls()[0])
      await tick(300)

      expect(toastEls()).toHaveLength(1)
    })

    it('reports its actions and removes itself', async () => {
      const action = vi.fn()
      act(() => {
        toast.info('m', 't', { toastComponent: Custom, disableTimeOut: true, onAction: action })
      })
      await tick()

      fireEvent.click(document.querySelector('.custom-action')!)
      expect(action).toHaveBeenCalledWith('go')

      fireEvent.click(document.querySelector('.custom-close')!)
      await tick(300)
      expect(toastEls()).toHaveLength(0)
    })
  })
})
