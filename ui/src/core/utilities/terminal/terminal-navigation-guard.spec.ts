import type { FakeOpenModal } from '@/testing'

import { describe, expect, it, vi } from 'vitest'

import { fakeOpenModal } from '@/testing'

import { TerminalNavigationGuard } from './terminal-navigation-guard'

/**
 * Leaving the terminal page.
 *
 * ⚠️ **All four conditions have to hold before the user is stopped.** Prompting
 * when the session survives navigation anyway (persistence on), or when the user
 * has not typed a thing, is a dialog in the way of nothing — and it appears on
 * every click of the menu.
 */
describe('leaving the terminal', () => {
  function ConfirmStub() {
    return null
  }

  let modal: FakeOpenModal

  /**
   * Build the guard.
   * @param options - the state to test
   * @param options.persistence - whether the session survives navigation
   * @param options.hideWarning - whether the user turned the warning off
   * @param options.active - whether a session is open
   * @param options.typed - whether the user has typed in it
   */
  function create(options: { persistence?: boolean, hideWarning?: boolean, active?: boolean, typed?: boolean } = {}) {
    modal = fakeOpenModal()
    return new TerminalNavigationGuard({
      terminal: {
        hasActiveSession: vi.fn(() => options.active ?? true),
        hasUserTypedInSession: vi.fn(() => options.typed ?? true),
      },
      getTerminalSettings: () => ({ persistence: options.persistence ?? false, hideWarning: options.hideWarning ?? false }),
      confirm: async (data) => {
        const ref = modal.openModal(ConfirmStub, data, { size: 'lg', backdrop: 'static' })
        try {
          await ref.result
          return true
        } catch {
          return false
        }
      },
      t: key => key,
    })
  }

  describe('navigating away inside the app', () => {
    it('asks first when a session is open and has been used', async () => {
      const pending = create().canDeactivate()
      await Promise.resolve()

      expect(modal.lastOpened()!.component).toBe(ConfirmStub)
      expect(modal.propsFor()).toMatchObject({
        title: 'platform.terminal.terminate_title',
        message: 'platform.terminal.terminate_message_1',
        message2: 'platform.terminal.terminate_message_2',
        message3: 'common.phrases.are_you_sure',
        confirmButtonLabel: 'form.button_continue',
        confirmButtonClass: 'btn-primary',
      })

      modal.lastOpened()!.ref.close()
      expect(await pending).toBe(true)
    })

    it('keeps the user on the page when they change their mind', async () => {
      const pending = create().canDeactivate()
      await Promise.resolve()
      modal.lastOpened()!.ref.dismiss()

      expect(await pending).toBe(false)
    })

    it('says nothing when the session survives navigation anyway', async () => {
      expect(await create({ persistence: true }).canDeactivate()).toBe(true)
      expect(modal.opened).toEqual([])
    })

    it('says nothing when the user turned the warning off', async () => {
      expect(await create({ hideWarning: true }).canDeactivate()).toBe(true)
      expect(modal.opened).toEqual([])
    })

    it('says nothing when there is no session open', async () => {
      expect(await create({ active: false }).canDeactivate()).toBe(true)
      expect(modal.opened).toEqual([])
    })

    it('says nothing when the user never typed anything', async () => {
      // Opening the terminal page and walking away should not need a dialog
      expect(await create({ typed: false }).canDeactivate()).toBe(true)
      expect(modal.opened).toEqual([])
    })
  })

  describe('closing the browser tab', () => {
    /** A beforeunload event, as the browser raises it. */
    function unloadEvent() {
      return { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent
    }

    it('warns when a used session would be lost', () => {
      const event = unloadEvent()

      const message = create().handleBeforeUnload(event)

      expect(message).toBe('platform.terminal.terminate_unload')
      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.returnValue).toBe('platform.terminal.terminate_unload')
    })

    it.each([
      ['the session survives anyway', { persistence: true }],
      ['the user turned the warning off', { hideWarning: true }],
      ['there is no session', { active: false }],
      ['nothing was typed', { typed: false }],
    ])('lets the tab close when %s', (_label, options) => {
      const event = unloadEvent()

      expect(create(options).handleBeforeUnload(event)).toBeUndefined()
      expect(event.preventDefault).not.toHaveBeenCalled()
    })
  })
})
