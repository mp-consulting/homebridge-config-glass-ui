import { act, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RestartToast } from '@/core/components/restart-toast/RestartToast'
import { toast } from '@/core/ui/toast'
import { ToastContainer } from '@/core/ui/ToastContainer'
import { renderWithProviders } from '@/testing'

import '@/testing/i18n'

describe('the restart toast', () => {
  let router: ReturnType<typeof renderWithProviders>['router']

  async function create() {
    router = renderWithProviders(<ToastContainer />).router
    act(() => {
      toast.info('Changes need a restart', 'Restart Homebridge', {
        toastComponent: RestartToast,
        toastClass: 'ngx-toastr hb-restart-toast',
        timeOut: 0,
        tapToDismiss: false,
        disableTimeOut: true,
      })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    return document.querySelector<HTMLElement>('.hb-restart-toast')!
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    act(() => toast.reset())
    vi.useRealTimers()
  })

  it('offers the restart as a real focusable button', async () => {
    // The whole point of this toast over the built-in one: a keyboard user
    // can reach the action
    const host = await create()

    const action = host.querySelector('.hb-restart-toast-action')
    expect(action?.tagName).toBe('BUTTON')
    expect(action?.textContent).toContain('Restart Homebridge')
  })

  it('sends the user to the restart page and closes itself', async () => {
    const host = await create()

    fireEvent.click(host.querySelector('.hb-restart-toast-action')!)

    expect(router.state.location.pathname).toBe('/restart')
    expect(host.classList).toContain('toast-out')
  })

  it('closes without restarting when dismissed', async () => {
    const host = await create()

    fireEvent.click(host.querySelector('.toast-close-button')!)

    expect(host.classList).toContain('toast-out')
    expect(router.state.location.pathname).toBe('/')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(document.querySelector('.hb-restart-toast')).toBeNull()
  })

  it('stays put when the toast itself is clicked', async () => {
    // Only the buttons act; tapping elsewhere does nothing
    const host = await create()

    fireEvent.click(host.querySelector('[role="alert"]')!)

    expect(host.classList).not.toContain('toast-out')
  })

  it('announces the message through a live region', async () => {
    const host = await create()

    expect(host.querySelector('[role="alert"]')?.textContent?.trim()).toBe('Changes need a restart')
  })

  it('labels the close button, which has no visible text', async () => {
    const host = await create()

    expect(host.querySelector('.toast-close-button')?.getAttribute('aria-label')).toBe('form.button_close')
  })
})
