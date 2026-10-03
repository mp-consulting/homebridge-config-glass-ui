import type { User } from '@/modules/users/users.interface'
import type { FakeApi } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authActions, useAuthStore } from '@/core/auth'
import { UsersAdd } from '@/modules/users/users-add/UsersAdd'
import { UsersEdit } from '@/modules/users/users-edit/UsersEdit'
import { activeModalStub, fakeApi, makeAuthState, renderWithProviders, toastStub } from '@/testing'

const holder = vi.hoisted(() => ({ toast: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return holder.toast
  },
}))

/** Type into one field of the open form. */
function type(id: string, value: string) {
  fireEvent.change(document.getElementById(id)!, { target: { value } })
}

/** Let the submit's request settle. */
async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve()
    }
  })
}

/**
 * Adding and editing the UI's own accounts. The interesting rules are the ones
 * that stop an admin locking everybody out: you cannot delete yourself, and
 * you cannot remove the last remaining admin.
 */
describe('user modals', () => {
  let api: FakeApi
  let activeModal: ReturnType<typeof activeModalStub>
  let logout: ReturnType<typeof vi.spyOn>

  const admin: User = { id: 1, username: 'admin', name: 'Admin', admin: true } as User
  const second: User = { id: 2, username: 'partner', name: 'Partner', admin: true } as User
  const viewer: User = { id: 3, username: 'viewer', name: 'Viewer', admin: false } as User

  beforeEach(() => {
    api = fakeApi()
    holder.toast = toastStub()
    activeModal = activeModalStub()
    logout = vi.spyOn(authActions, 'logout').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function signIn(username: string) {
    useAuthStore.setState(makeAuthState({ user: { username } }))
  }

  function openAdd(existingUsers: User[] = [admin]) {
    signIn('admin')
    return renderWithProviders(<UsersAdd activeModal={activeModal as any} existingUsers={existingUsers} />)
  }

  function openEdit(user: User, existingUsers: User[], signedInAs = 'admin') {
    signIn(signedInAs)
    return renderWithProviders(<UsersEdit activeModal={activeModal as any} user={user} existingUsers={existingUsers} />)
  }

  const saveButton = () => screen.getByText('form.button_save') as HTMLButtonElement
  const deleteToggle = () => screen.getByLabelText('users.button_delete_user') as HTMLButtonElement
  const submit = async () => {
    fireEvent.submit(document.querySelector('form')!)
    await settle()
  }
  const isInvalid = (id: string) => {
    fireEvent.blur(document.getElementById(id)!)
    return document.getElementById(id)!.classList.contains('is-invalid')
  }

  function fillAdd(values: { username: string, name: string, password: string, passwordConfirm: string, admin?: boolean }) {
    type('form-username', values.username)
    type('form-name', values.name)
    type('form-pass', values.password)
    type('form-pass-confirm', values.passwordConfirm)
    const adminBox = document.getElementById('isAdmin') as HTMLInputElement
    if (values.admin !== undefined && adminBox.checked !== values.admin) {
      fireEvent.click(adminBox)
    }
  }

  describe('adding a user', () => {
    it('sends the new account to the server', async () => {
      openAdd()
      fillAdd({ username: 'partner', name: 'Partner', password: 'secret', passwordConfirm: 'secret', admin: false })

      await submit()

      expect(api.lastCall('post', '/users')?.body).toMatchObject({ username: 'partner', name: 'Partner', admin: false })
      expect(activeModal.close).toHaveBeenCalled()
    })

    it.each([
      ['the same name', 'admin'],
      ['a different case', 'Admin'],
      ['surrounding spaces', '  admin  '],
    ])('refuses a username that only differs by %s', (_case, username) => {
      openAdd([admin])
      type('form-username', username)

      // The server lower-cases before comparing, so the form has to as well or
      // the user gets a confusing failure after filling everything in
      expect(isInvalid('form-username')).toBe(true)
    })

    it('accepts a username nobody is using', () => {
      openAdd([admin])
      type('form-username', 'partner')

      expect(isInvalid('form-username')).toBe(false)
    })

    it('refuses a password shorter than four characters', () => {
      openAdd()
      type('form-pass', 'abc')

      expect(isInvalid('form-pass')).toBe(true)
    })

    it('refuses a confirmation that does not match', () => {
      openAdd()
      fillAdd({ username: 'partner', name: 'Partner', password: 'secret', passwordConfirm: 'different', admin: true })

      expect(saveButton().disabled).toBe(true)
      expect(isInvalid('form-pass-confirm')).toBe(true)
    })

    it('can be saved once everything is filled in', () => {
      openAdd()
      expect(saveButton().disabled).toBe(true)

      fillAdd({ username: 'partner', name: 'Partner', password: 'secret', passwordConfirm: 'secret' })

      expect(saveButton().disabled).toBe(false)
    })

    it('creates an admin unless told otherwise', () => {
      openAdd()

      expect((document.getElementById('isAdmin') as HTMLInputElement).checked).toBe(true)
    })

    it('keeps the modal open when the server refuses', async () => {
      openAdd()
      api.fail('post', '/users', { error: { message: 'Username already taken' } })
      fillAdd({ username: 'partner', name: 'Partner', password: 'secret', passwordConfirm: 'secret', admin: true })

      await submit()

      // The user needs their typing back to correct it
      expect(activeModal.close).not.toHaveBeenCalled()
      expect(holder.toast!.error).toHaveBeenCalledWith('Username already taken', 'toast.title_error')
      expect((document.getElementById('form-username') as HTMLInputElement).value).toBe('partner')
    })
  })

  describe('who can be deleted', () => {
    it('refuses to delete the account you are signed in as', () => {
      openEdit(admin, [admin, second], 'admin')

      expect(deleteToggle().disabled).toBe(true)
    })

    it('refuses to delete the last admin', () => {
      openEdit(admin, [admin, viewer], 'partner')

      // Deleting them would leave nobody able to administer the install
      expect(deleteToggle().disabled).toBe(true)
      expect((document.getElementById('isAdmin') as HTMLInputElement).disabled).toBe(true)
    })

    it('allows deleting another admin while one remains', () => {
      openEdit(second, [admin, second], 'admin')

      expect(deleteToggle().disabled).toBe(false)
    })

    it('allows deleting a non-admin', () => {
      openEdit(viewer, [admin, viewer], 'admin')

      expect(deleteToggle().disabled).toBe(false)
    })
  })

  describe('deleting a user', () => {
    it('takes two steps', () => {
      openEdit(viewer, [admin, viewer], 'admin')

      expect(screen.queryByText('form.button_delete')).toBeNull()
      expect(screen.queryByText('common.phrases.are_you_sure')).toBeNull()
    })

    it('deletes rather than saves once confirmed', async () => {
      openEdit(viewer, [admin, viewer], 'admin')
      fireEvent.click(deleteToggle())

      await submit()

      expect(api.lastCall('delete', '/users/3')).toBeDefined()
      expect(api.callsTo('patch')).toHaveLength(0)
    })
  })

  describe('editing a user', () => {
    it('saves the changes against that user', async () => {
      openEdit(viewer, [admin, viewer], 'admin')
      type('form-name', 'Renamed')

      await submit()

      expect(api.lastCall('patch', '/users/3')?.body).toMatchObject({ name: 'Renamed' })
    })

    it('signs you out after changing your own username', async () => {
      openEdit(admin, [admin, second], 'admin')
      type('form-username', 'renamed-admin')

      await submit()

      // The token still carries the old username, so the session is stale
      expect(logout).toHaveBeenCalled()
    })

    it('keeps you signed in after changing only your display name', async () => {
      openEdit(admin, [admin, second], 'admin')
      type('form-name', 'The Admin')

      await submit()

      expect(logout).not.toHaveBeenCalled()
    })

    it('lets an admin step down while another admin remains', () => {
      openEdit(admin, [admin, second], 'admin')

      expect((document.getElementById('isAdmin') as HTMLInputElement).disabled).toBe(false)
    })

    it('will not let the last admin step down', async () => {
      openEdit(admin, [admin, viewer], 'admin')

      // Disabling the control also keeps `admin` out of the request body,
      // so the server is never asked to make the change
      expect((document.getElementById('isAdmin') as HTMLInputElement).disabled).toBe(true)
      type('form-name', 'The Admin')
      await submit()
      expect(api.lastCall('patch', '/users/1')?.body).not.toHaveProperty('admin')
    })

    it('has nothing to save when the form is untouched', () => {
      openEdit(viewer, [admin, viewer], 'admin')

      expect(saveButton().disabled).toBe(true)
    })

    it('has something to save once a password is typed', () => {
      openEdit(viewer, [admin, viewer], 'admin')
      type('form-pass', 'newsecret')
      type('form-pass-confirm', 'newsecret')

      // A password is never read back, so it cannot be compared - typing one
      // always counts as a change
      expect(saveButton().disabled).toBe(false)
    })

    it('lets a user keep their own name', () => {
      openEdit(viewer, [admin, viewer], 'admin')
      type('form-username', 'viewer')

      expect(isInvalid('form-username')).toBe(false)
    })

    it('still refuses a name another user already has', () => {
      openEdit(viewer, [admin, viewer], 'admin')
      type('form-username', 'admin')

      expect(isInvalid('form-username')).toBe(true)
    })
  })
})
