import type { FakeApi, FakeOpenModal } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/core/auth'
import { settingsActions } from '@/core/settings'
import { Users } from '@/modules/users/Users'
import { Users2faDisable } from '@/modules/users/users-2fa-disable/Users2faDisable'
import { Users2faEnable } from '@/modules/users/users-2fa-enable/Users2faEnable'
import { UsersAdd } from '@/modules/users/users-add/UsersAdd'
import { UsersEdit } from '@/modules/users/users-edit/UsersEdit'
import { UsersSupport } from '@/modules/users/users-support/UsersSupport'
import { usersLoader } from '@/modules/users/users.loader'
import { fakeApi, fakeOpenModal, makeAuthState, renderWithProviders, toastStub } from '@/testing'

const holder = vi.hoisted(() => ({
  toast: null as ReturnType<typeof toastStub> | null,
  modal: null as FakeOpenModal | null,
}))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return holder.toast
  },
}))
vi.mock('@/core/ui/modal', () => ({
  openModal: (...args: Parameters<FakeOpenModal['openModal']>) => holder.modal!.openModal(...args),
}))

/**
 * The users page.
 *
 * Its own logic is small — the four modals do the work — but two things about it
 * matter: the list has to come from the route loader rather than a fetch on
 * mount, and it has to **re-read the list after every change**. A silent failure
 * there leaves the page showing its pre-change snapshot, so a user who has just
 * been added appears to have vanished.
 */
describe('users', () => {
  let api: FakeApi
  let modal: FakeOpenModal
  let setPageTitle: ReturnType<typeof vi.spyOn>

  const users = [
    { id: 1, name: 'Test Admin', username: 'admin', admin: true, otpActive: false },
    { id: 2, name: 'Second Person', username: 'second', admin: false, otpActive: false },
  ] as any[]

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  /**
   * Build the page.
   * @param options - how to set the page up
   * @param options.resolved - the user list the route loader supplies
   * @param options.arrange - runs on the fresh fakes before the page is created
   */
  async function create(options: { resolved?: any[], arrange?: () => void } = {}) {
    options.arrange?.()
    // `'resolved' in options` rather than `??`, so a case can pass `undefined`
    // on purpose to model a loader that returned nothing
    const resolved = 'resolved' in options ? options.resolved : users
    const view = renderWithProviders(<div />, {
      route: '/unused',
      initialEntries: ['/users'],
      routes: [{ path: '/users', element: <Users />, loader: () => resolved ?? null }],
    })
    await settle()
    return view
  }

  const cards = () => [...document.querySelectorAll('.card')]
  const editButtons = () => screen.getAllByLabelText('form.button_edit')

  beforeEach(() => {
    api = fakeApi()
    holder.toast = toastStub()
    modal = fakeOpenModal()
    holder.modal = modal
    useAuthStore.setState(makeAuthState({ user: { username: 'admin', admin: true } }))
    setPageTitle = vi.spyOn(settingsActions, 'setPageTitle')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('the list', () => {
    it('takes the users from the route rather than fetching them', async () => {
      // The loader has already fetched them, so a second request on mount would
      // just be a duplicate round trip
      await create()

      expect(cards().map(card => card.querySelector('h4')?.textContent)).toEqual(['Test Admin', 'Second Person'])
      expect(api.callsTo('get')).toEqual([])
    })

    it('copes with a route that resolved nothing', async () => {
      await create({ resolved: undefined })

      expect(cards()).toHaveLength(0)
    })

    it('sets the page title', async () => {
      await create()

      expect(setPageTitle).toHaveBeenCalledWith('users.title_users')
    })

    it('marks admins and plain users apart', async () => {
      await create()

      expect(cards().map(card => card.querySelector('h5 i')?.className)).toEqual(['fas fa-user-secret', 'fas fa-user'])
    })

    it('offers 2FA only on admins, and only to the signed-in user', async () => {
      await create({
        resolved: [
          ...users,
          { id: 3, name: 'Other Admin', username: 'other', admin: true, otpActive: true },
        ],
      })

      const setup = screen.getByText('users.setup_2fa') as HTMLButtonElement
      const disableOther = screen.getByText('users.setup_2fa_disable') as HTMLButtonElement
      // One setup button (admin) and one disable button (other, who has it on);
      // the plain user gets neither
      expect(screen.getAllByText(/users\.setup_2fa/)).toHaveLength(2)
      expect(setup.disabled).toBe(false)
      expect(disableOther.disabled).toBe(true)
    })
  })

  describe('adding a user', () => {
    it('tells the modal who already exists, so it can reject a duplicate name', async () => {
      await create()

      fireEvent.click(screen.getByLabelText('users.button_add_user'))

      expect(modal.lastOpened()?.component).toBe(UsersAdd)
      expect(modal.propsFor()?.existingUsers).toEqual(users)
      expect(modal.lastOpened()!.options).toEqual({ size: 'lg', backdrop: 'static' })
    })

    it('re-reads the list once the user has been added', async () => {
      await create({ arrange: () => api.respond('get', '/users', [...users, { id: 3, name: 'Third', username: 'third' }]) })

      fireEvent.click(screen.getByLabelText('users.button_add_user'))
      modal.lastOpened()!.ref.close()
      await settle()

      expect(api.callsTo('get', '/users')).toHaveLength(1)
      expect(cards()).toHaveLength(3)
    })

    it('leaves the list alone when the modal is dismissed', async () => {
      await create()

      fireEvent.click(screen.getByLabelText('users.button_add_user'))
      modal.lastOpened()!.ref.dismiss()
      await settle()

      expect(api.callsTo('get', '/users')).toEqual([])
      expect(cards()).toHaveLength(2)
    })

    it('says so when the list cannot be re-read', async () => {
      // Otherwise the page silently keeps its old snapshot and the new user
      // looks as though they were never created
      await create({ arrange: () => api.fail('get', '/users', new Error('server unavailable')) })

      fireEvent.click(screen.getByLabelText('users.button_add_user'))
      modal.lastOpened()!.ref.close()
      await settle()

      expect(holder.toast!.error).toHaveBeenCalled()
      expect(console.error).toHaveBeenCalled()
      expect(cards()).toHaveLength(2)
    })
  })

  describe('editing a user', () => {
    it('hands the modal the user and everyone else', async () => {
      await create()

      fireEvent.click(editButtons()[1])

      expect(modal.lastOpened()?.component).toBe(UsersEdit)
      expect(modal.propsFor()?.user).toBe(users[1])
      expect(modal.propsFor()?.existingUsers).toEqual(users)
    })

    it('re-reads the list once the edit is saved', async () => {
      await create({ arrange: () => api.respond('get', '/users', users) })

      fireEvent.click(editButtons()[1])
      modal.lastOpened()!.ref.close()
      await settle()

      expect(api.callsTo('get', '/users')).toHaveLength(1)
    })

    it('leaves the list alone when the edit is abandoned', async () => {
      await create()

      fireEvent.click(editButtons()[1])
      modal.lastOpened()!.ref.dismiss()
      await settle()

      expect(api.callsTo('get', '/users')).toEqual([])
    })
  })

  describe('two factor authentication', () => {
    it('opens the setup modal for the chosen user', async () => {
      await create()

      fireEvent.click(screen.getByText('users.setup_2fa'))

      expect(modal.lastOpened()?.component).toBe(Users2faEnable)
      expect(modal.propsFor()?.user).toBe(users[0])
    })

    it('re-reads the list once it has been set up', async () => {
      // The list shows whether each user has 2FA on
      await create({ arrange: () => api.respond('get', '/users', users) })

      fireEvent.click(screen.getByText('users.setup_2fa'))
      modal.lastOpened()!.ref.close()
      await settle()

      expect(api.callsTo('get', '/users')).toHaveLength(1)
    })

    it('opens the disable modal for the chosen user', async () => {
      const withOtp = [{ ...users[0], otpActive: true }, users[1]]
      await create({ resolved: withOtp })

      fireEvent.click(screen.getByText('users.setup_2fa_disable'))

      expect(modal.lastOpened()?.component).toBe(Users2faDisable)
      expect(modal.propsFor()?.user).toBe(withOtp[0])
    })

    it('re-reads the list once it has been switched off', async () => {
      await create({
        resolved: [{ ...users[0], otpActive: true }, users[1]],
        arrange: () => api.respond('get', '/users', users),
      })

      fireEvent.click(screen.getByText('users.setup_2fa_disable'))
      modal.lastOpened()!.ref.close()
      await settle()

      expect(api.callsTo('get', '/users')).toHaveLength(1)
    })

    it('leaves the list alone when setup is abandoned', async () => {
      await create()

      fireEvent.click(screen.getByText('users.setup_2fa'))
      modal.lastOpened()!.ref.dismiss()
      await settle()

      expect(api.callsTo('get', '/users')).toEqual([])
    })
  })

  describe('the support link', () => {
    it('opens the support modal without touching the user list', async () => {
      await create()

      fireEvent.click(screen.getByLabelText('support.title'))

      expect(modal.opened).toHaveLength(1)
      expect(modal.lastOpened()?.component).toBe(UsersSupport)
      expect(api.callsTo('get')).toEqual([])
    })
  })

  describe('the loader', () => {
    it('fetches the list before the page opens', async () => {
      api.respond('get', '/users', users)

      await expect(usersLoader()).resolves.toEqual(users)
    })

    it('goes home with an error when the list cannot be read', async () => {
      api.fail('get', '/users', { status: 500, error: { message: 'boom' } })

      const response = await usersLoader() as Response

      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).toBe('/')
      expect(holder.toast!.at('error')).toHaveLength(1)
    })
  })
})
