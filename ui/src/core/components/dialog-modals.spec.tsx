import type { ActiveModal } from '@/core/ui/modal'

import { fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Confirm } from '@/core/components/confirm/Confirm'
import { Information } from '@/core/components/information/Information'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { renderWithProviders } from '@/testing'

import '@/testing/i18n'

/**
 * The plain dialogs. Individually they do almost nothing, but between them they
 * are opened from dozens of places, and every caller branches on whether the
 * dialog resolved or rejected: `close()` means the user agreed, a dismissal
 * means they backed out. Getting that the wrong way round turns a cancel into
 * a confirmation.
 */
describe('dialog modals', () => {
  function activeModalStub() {
    return {
      close: vi.fn<ActiveModal['close']>(),
      dismiss: vi.fn<ActiveModal['dismiss']>(),
      update: vi.fn<ActiveModal['update']>(),
    }
  }

  describe('information', () => {
    it('reports a dismissal when the user closes it', () => {
      const activeModal = activeModalStub()
      const { container } = renderWithProviders(<Information activeModal={activeModal} title="Heads up" message="Something happened" />)

      fireEvent.click(container.querySelector('.modal-footer .btn-elegant')!)

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('dismisses from the header cross too', () => {
      const activeModal = activeModalStub()
      const { container } = renderWithProviders(<Information activeModal={activeModal} title="Heads up" />)

      fireEvent.click(container.querySelector('.btn-close')!)

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })

    it('puts the close button in the middle without a call to action, and on the left with one', () => {
      const { container, unmount } = renderWithProviders(<Information activeModal={activeModalStub()} title="t" />)
      expect(container.querySelector('.modal-footer .text-center .btn-elegant')).not.toBeNull()
      unmount()

      const withCta = renderWithProviders(<Information activeModal={activeModalStub()} title="t" ctaButtonLink="https://homebridge.io" ctaButtonLabel="Read more" />)
      expect(withCta.container.querySelector('.modal-footer .text-start .btn-elegant')).not.toBeNull()
      const cta = withCta.container.querySelector<HTMLAnchorElement>('.modal-footer .text-end a')!
      expect(cta.getAttribute('href')).toBe('https://homebridge.io')
      expect(cta.getAttribute('rel')).toBe('noopener noreferrer')
      expect(cta.textContent).toContain('Read more')
    })

    it('renders its markdown part as markdown', () => {
      const { container } = renderWithProviders(<Information activeModal={activeModalStub()} title="t" markdownMessage2="**bold**" />)

      expect(container.querySelector('.alert .plugin-md strong')?.textContent).toBe('bold')
    })

    it('sanitises the html it is given, as [innerHTML] did', () => {
      const { container } = renderWithProviders(<Information activeModal={activeModalStub()} title="t" subtitle="<b>sub</b>" message={'<img src=x onerror="alert(1)">'} />)

      expect(container.querySelector('h5.mb-3 b')?.textContent).toBe('sub')
      expect(container.innerHTML).not.toContain('onerror')
    })
  })

  describe('confirm', () => {
    const data = { title: 'Are you sure?', message: 'This cannot be undone', confirmButtonLabel: 'Yes' }

    it('resolves when the user agrees', () => {
      const activeModal = activeModalStub()
      const { getByText } = renderWithProviders(<Confirm activeModal={activeModal} {...data} />)

      fireEvent.click(getByText('Yes'))

      expect(activeModal.close).toHaveBeenCalled()
      expect(activeModal.dismiss).not.toHaveBeenCalled()
    })

    it('rejects when the user backs out', () => {
      const activeModal = activeModalStub()
      const { getByText } = renderWithProviders(<Confirm activeModal={activeModal} {...data} />)

      fireEvent.click(getByText('form.button_cancel'))

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('shows the words the caller asked for', () => {
      const { container } = renderWithProviders(<Confirm activeModal={activeModalStub()} {...data} message2="<b>second</b>" />)

      expect(container.querySelector('#confirm-modal-title')?.textContent).toBe('Are you sure?')
      expect(container.querySelector('.modal-body p')?.textContent).toBe('This cannot be undone')
      expect(container.querySelector('.modal-body p.mt-2 b')?.textContent).toBe('second')
      expect(container.querySelector('.text-end .btn')?.className).toBe('btn btn-primary')
    })

    it('uses the button class and icon the caller asked for', () => {
      const { container } = renderWithProviders(<Confirm activeModal={activeModalStub()} {...data} confirmButtonClass="btn-danger" faIconClass="fa-trash" />)

      expect(container.querySelector('.text-end .btn')?.className).toBe('btn btn-danger')
      expect(container.querySelector('.modal-body i')?.className).toBe('fas fa-trash mb-3 icon-xl')
    })

    it('offers no confirm button without a label', () => {
      const { container } = renderWithProviders(<Confirm activeModal={activeModalStub()} title="t" message="m" />)

      expect(container.querySelector('.text-end .btn')).toBeNull()
    })
  })

  describe('restartHomebridge', () => {
    it('sends the user to the restart page and closes', () => {
      const activeModal = activeModalStub()
      const { getByText, router } = renderWithProviders(<RestartHomebridge activeModal={activeModal} />)

      fireEvent.click(getByText('menu.tooltip_restart'))

      expect(router.state.location.pathname).toBe('/restart')
      expect(activeModal.close).toHaveBeenCalled()
    })

    it('leaves homebridge alone when the user declines', () => {
      const activeModal = activeModalStub()
      const { container, router } = renderWithProviders(<RestartHomebridge activeModal={activeModal} />)

      fireEvent.click(container.querySelector('.modal-footer .btn-elegant')!)

      // Declining must not restart anything - the caller decides what to do
      expect(router.state.location.pathname).toBe('/')
      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })
  })
})
