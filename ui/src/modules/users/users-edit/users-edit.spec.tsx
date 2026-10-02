import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authActions, useAuthStore } from '@/core/auth'
import { matchPassword } from '@/modules/users/user-form'
import { UsersEdit } from '@/modules/users/users-edit/UsersEdit'
import { fakeApi, makeAuthState, renderWithProviders, toastStub } from '@/testing'

const holder = vi.hoisted(() => ({ toast: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return holder.toast
  },
}))

describe('usersEdit', () => {
  describe('matchPassword', () => {
    it('passes when the two fields agree', () => {
      const result = matchPassword('correct horse', 'correct horse')

      expect(result.group).toBeNull()
      expect(result.confirm).toBeNull()
    })

    it('fails the group and the confirmation field when they differ', () => {
      const result = matchPassword('correct horse', 'battery staple')

      expect(result.group).toEqual({ matchPassword: true })
      expect(result.confirm).toEqual({ matchPassword: true })
    })

    it('keeps an error another validator already set', () => {
      // The regression this guards: overwriting errors wholesale would clear
      // `required`, so an empty confirmation box would look valid
      expect(matchPassword('correct horse', '', { required: true }).confirm).toEqual({ required: true, matchPassword: true })
    })

    it('clears only its own error once the fields agree', () => {
      const result = matchPassword('correct horse', 'correct horse', { required: true, matchPassword: true })

      expect(result.group).toBeNull()
      expect(result.confirm).toEqual({ required: true })
    })

    it('clears the errors entirely when nothing else is wrong', () => {
      expect(matchPassword('correct horse', 'correct horse', { matchPassword: true }).confirm).toBeNull()
    })

    it('treats two empty fields as matching', () => {
      expect(matchPassword('', '').group).toBeNull()
    })
  })

  /**
   * Editing and deleting a user.
   *
   * ⚠️ **Two safety rails matter here.** The last admin cannot be demoted or
   * deleted, or nobody can administer the box again; and renaming *yourself* has to
   * sign you out, because the token in your browser names a user that no longer
   * exists.
   */
  describe('editing a user', () => {
    let api: FakeApi
    let logout: ReturnType<typeof vi.spyOn>
    let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }

    /**
     * Open the modal on a user.
     * @param options - how to set it up
     * @param options.user - the user being edited
     * @param options.existingUsers - everyone on the box
     * @param options.signedInAs - the username of the signed-in user
     */
    function open(options: { user?: any, existingUsers?: any[], signedInAs?: string } = {}) {
      const user = options.user ?? { id: 2, username: 'someone', name: 'Someone', admin: false }
      useAuthStore.setState(makeAuthState({ user: { username: options.signedInAs ?? 'admin', admin: true } }))
      return renderWithProviders(
        <UsersEdit
          activeModal={activeModal}
          user={user}
          existingUsers={options.existingUsers ?? [{ id: 1, username: 'admin', name: 'Admin', admin: true }, user]}
        />,
      )
    }

    const input = (id: string) => document.getElementById(id) as HTMLInputElement
    const type = (id: string, value: string) => fireEvent.change(input(id), { target: { value } })
    const deleteToggle = () => screen.getByLabelText('users.button_delete_user') as HTMLButtonElement
    const submit = async () => {
      fireEvent.submit(document.querySelector('form')!)
      await act(async () => {
        for (let tick = 0; tick < 10; tick += 1) {
          await Promise.resolve()
        }
      })
    }

    beforeEach(() => {
      api = fakeApi()
      holder.toast = toastStub()
      activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
      logout = vi.spyOn(authActions, 'logout').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('starts from the user as they are', () => {
      open({ user: { id: 2, username: 'someone', name: 'Someone', admin: true } })

      expect(input('form-username').value).toBe('someone')
      expect(input('form-name').value).toBe('Someone')
      expect(input('isAdmin').checked).toBe(true)
      // Unchanged, so there is nothing to save
      expect((screen.getByText('form.button_save') as HTMLButtonElement).disabled).toBe(true)
    })

    it('saves the changes to that user', async () => {
      open()
      type('form-name', 'Someone Else')

      await submit()

      expect(api.lastCall('patch', '/users/2')?.body).toEqual({ username: 'someone', name: 'Someone Else', password: '', passwordConfirm: '', admin: false })
      expect(activeModal.close).toHaveBeenCalled()
    })

    it('stays open and says so when the save fails', async () => {
      open()
      api.fail('patch', '/users/2', { error: { message: 'Username already taken' } })
      type('form-username', 'taken')

      await submit()

      expect(activeModal.close).not.toHaveBeenCalled()
      expect(holder.toast!.error).toHaveBeenCalledWith('Username already taken', 'toast.title_error')
    })

    it('signs you out when you rename yourself', async () => {
      // ⚠️ The token names the old username, so every request after this would fail
      open({
        user: { id: 1, username: 'admin', name: 'Admin', admin: true },
        signedInAs: 'admin',
      })
      type('form-username', 'administrator')

      await submit()

      expect(logout).toHaveBeenCalled()
    })

    it('leaves you signed in when you only change your own name', async () => {
      open({
        user: { id: 1, username: 'admin', name: 'Admin', admin: true },
        signedInAs: 'admin',
      })
      type('form-name', 'The Admin')

      await submit()

      expect(logout).not.toHaveBeenCalled()
    })

    it('leaves you signed in when you rename somebody else', async () => {
      open({ signedInAs: 'admin' })
      type('form-username', 'renamed')

      await submit()

      expect(logout).not.toHaveBeenCalled()
    })

    it('deletes the user in delete mode', async () => {
      open()
      fireEvent.click(deleteToggle())

      await submit()

      expect(api.lastCall('delete', '/users/2')).toBeDefined()
      expect(api.callsTo('patch')).toEqual([])
      expect(activeModal.close).toHaveBeenCalled()
    })

    it('says so when the delete fails', async () => {
      open()
      api.fail('delete', '/users/2', new Error('server unavailable'))
      fireEvent.click(deleteToggle())

      await submit()

      expect(activeModal.close).not.toHaveBeenCalled()
      expect(holder.toast!.error).toHaveBeenCalled()
    })

    it('locks the form while delete is armed', () => {
      // Nothing on it can be saved from that state, so an editable form would be
      // misleading
      open()

      fireEvent.click(deleteToggle())

      expect(['form-username', 'form-name', 'form-pass', 'isAdmin'].map(id => input(id).disabled)).toEqual([true, true, true, true])
      expect(screen.getByText('common.phrases.are_you_sure')).toBeInTheDocument()
      expect(screen.getByText('form.button_delete').className).toBe('btn btn-danger')
    })

    it('unlocks it again when delete is disarmed', () => {
      open()

      fireEvent.click(deleteToggle())
      fireEvent.click(deleteToggle())

      expect(['form-username', 'form-name', 'form-pass', 'isAdmin'].map(id => input(id).disabled)).toEqual([false, false, false, false])
    })

    it('takes the focus off the button it was pressed on', () => {
      // Otherwise the outline sits on a button whose meaning has just changed
      open()
      deleteToggle().focus()

      fireEvent.click(deleteToggle())

      expect(document.activeElement).not.toBe(deleteToggle())
    })

    it('asks for the confirmation only once a new password is typed', () => {
      open()
      expect(input('form-pass-confirm')).toBeNull()

      type('form-pass', 'newsecret')

      expect(input('form-pass-confirm')).not.toBeNull()
    })

    describe('the last administrator', () => {
      const onlyAdmin = { id: 1, username: 'admin', name: 'Admin', admin: true }

      it('cannot be demoted', () => {
        open({ user: onlyAdmin, existingUsers: [onlyAdmin], signedInAs: 'someone' })

        expect(input('isAdmin').disabled).toBe(true)
      })

      it('cannot be deleted', () => {
        open({ user: onlyAdmin, existingUsers: [onlyAdmin], signedInAs: 'someone' })

        expect(deleteToggle().disabled).toBe(true)
      })

      it('can be demoted while another admin exists', () => {
        const other = { id: 2, username: 'second', name: 'Second', admin: true }
        open({ user: onlyAdmin, existingUsers: [onlyAdmin, other], signedInAs: 'someone' })

        expect(input('isAdmin').disabled).toBe(false)
        expect(deleteToggle().disabled).toBe(false)
      })

      it('is not treated as the last admin when the user is not an admin', () => {
        open({ user: { id: 2, username: 'someone', admin: false }, existingUsers: [] })

        expect(input('isAdmin').disabled).toBe(false)
      })
    })

    describe('who cannot delete whom', () => {
      it('you cannot delete yourself', () => {
        // You would be signing yourself out of a box you may be the only admin of
        open({
          user: { id: 1, username: 'admin', name: 'Admin', admin: true },
          existingUsers: [
            { id: 1, username: 'admin', admin: true },
            { id: 2, username: 'second', admin: true },
          ],
          signedInAs: 'admin',
        })

        expect(deleteToggle().disabled).toBe(true)
      })

      it('you can delete somebody else', () => {
        open({ signedInAs: 'admin' })

        expect(deleteToggle().disabled).toBe(false)
      })
    })

    describe('a duplicate username', () => {
      it('is refused', () => {
        open()

        type('form-username', 'admin')
        fireEvent.blur(input('form-username'))

        expect(input('form-username').classList).toContain('is-invalid')
      })

      it('does not count the user own name against them', () => {
        open()

        type('form-username', 'someone')
        fireEvent.blur(input('form-username'))

        expect(input('form-username').classList).not.toContain('is-invalid')
      })
    })

    it('closes without saving when dismissed', () => {
      open()

      fireEvent.click(screen.getByText('form.button_close'))

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
      expect(api.calls).toEqual([])
    })
  })
})
