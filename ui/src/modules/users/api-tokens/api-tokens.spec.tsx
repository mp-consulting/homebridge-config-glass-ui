import type { FakeApi, FakeOpenModal } from '@/testing'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Confirm } from '@/core/components/confirm/Confirm'
import { ApiTokenCreate } from '@/modules/users/api-tokens/ApiTokenCreate'
import { ApiTokens } from '@/modules/users/api-tokens/ApiTokens'
import { activeModalStub, apiError, fakeApi, fakeOpenModal, renderWithProviders, toastStub } from '@/testing'

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

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) {
      await Promise.resolve()
    }
  })
}

const DAY = 24 * 60 * 60 * 1000

/**
 * The API tokens section of the users page: list, create (the token is shown
 * once), revoke.
 */
describe('api tokens', () => {
  let api: FakeApi
  let modal: FakeOpenModal

  const tokens = [
    {
      id: 'a',
      name: 'Assistant',
      scope: 'read',
      createdAt: new Date(Date.now() - DAY).toISOString(),
      expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
      lastUsedAt: null,
    },
    {
      id: 'b',
      name: 'Old script',
      scope: 'admin',
      createdAt: new Date(Date.now() - 100 * DAY).toISOString(),
      expiresAt: new Date(Date.now() - DAY).toISOString(),
      lastUsedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    },
    {
      id: 'c',
      name: 'Forever',
      scope: 'admin',
      createdAt: new Date(Date.now() - DAY).toISOString(),
      expiresAt: null,
      lastUsedAt: null,
    },
  ]

  beforeEach(() => {
    api = fakeApi()
    holder.toast = toastStub()
    modal = fakeOpenModal()
    holder.modal = modal
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('the section', () => {
    async function create() {
      const view = renderWithProviders(<ApiTokens />)
      await settle()
      return view
    }

    const rows = () => [...document.querySelectorAll('.api-tokens tbody tr')]

    it('lists the tokens from the server', async () => {
      api.respond('get', '/auth/tokens', tokens)

      await create()

      expect(api.callsTo('get', '/auth/tokens')).toHaveLength(1)
      expect(rows().map(row => row.querySelector('td')?.textContent)).toEqual(['Assistant', 'Old script', 'Forever'])
      expect(screen.getByRole('region', { name: 'users.api_tokens.title' })).toBeTruthy()
    })

    it('shows the scope, and expired and never-expiring tokens', async () => {
      api.respond('get', '/auth/tokens', tokens)

      await create()

      const [assistant, old, forever] = rows()
      expect(assistant.textContent).toContain('users.api_tokens.scope_read')
      expect(assistant.textContent).toContain('users.api_tokens.never_used')
      expect(old.textContent).toContain('users.api_tokens.scope_admin')
      expect(old.textContent).toContain('users.api_tokens.expired')
      expect(old.classList.contains('text-muted')).toBe(true)
      expect(forever.textContent).toContain('users.api_tokens.expiry_never')
    })

    it('says when there are none', async () => {
      api.respond('get', '/auth/tokens', [])

      await create()

      expect(screen.getByText('users.api_tokens.empty')).toBeTruthy()
      expect(rows()).toHaveLength(0)
    })

    it('toasts a failed load', async () => {
      api.fail('get', '/auth/tokens', apiError('nope', 500))

      await create()

      expect(holder.toast!.shown.map(x => x.level)).toContain('error')
      expect(screen.getByText('users.api_tokens.empty')).toBeTruthy()
    })

    it('opens the create modal and re-reads the list once a token was created', async () => {
      api.respond('get', '/auth/tokens', [])
      await create()

      fireEvent.click(screen.getByLabelText('users.api_tokens.button_create'))
      expect(modal.lastOpened()?.component).toBe(ApiTokenCreate)

      api.respond('get', '/auth/tokens', tokens)
      modal.lastOpened()!.ref.close()
      await settle()

      expect(api.callsTo('get', '/auth/tokens')).toHaveLength(2)
      expect(rows()).toHaveLength(3)
    })

    it('does not re-read the list when creation is cancelled', async () => {
      api.respond('get', '/auth/tokens', [])
      await create()

      fireEvent.click(screen.getByLabelText('users.api_tokens.button_create'))
      modal.lastOpened()!.ref.dismiss('Dismiss')
      await settle()

      expect(api.callsTo('get', '/auth/tokens')).toHaveLength(1)
    })

    it('revokes a token after confirmation', async () => {
      api.respond('get', '/auth/tokens', tokens)
      await create()

      // The first row's button (Assistant); the test i18n shows keys, not names
      fireEvent.click(screen.getAllByLabelText('users.api_tokens.revoke_label')[0])
      const confirm = modal.lastOpened()!
      expect(confirm.component).toBe(Confirm)
      expect(confirm.props?.confirmButtonClass).toBe('btn-danger')

      api.respond('get', '/auth/tokens', tokens.slice(1))
      confirm.ref.close()
      await settle()

      expect(api.callsTo('delete', '/auth/tokens/a')).toHaveLength(1)
      expect(holder.toast!.shown.map(x => x.level)).toEqual(['success'])
      expect(rows()).toHaveLength(2)
    })

    it('leaves the token alone when the confirmation is dismissed', async () => {
      api.respond('get', '/auth/tokens', tokens)
      await create()

      fireEvent.click(screen.getAllByLabelText(/users\.api_tokens\.revoke_label/)[0])
      modal.lastOpened()!.ref.dismiss('Dismiss')
      await settle()

      expect(api.callsTo('delete')).toEqual([])
    })
  })

  describe('the create modal', () => {
    let activeModal: ReturnType<typeof activeModalStub>

    beforeEach(() => {
      activeModal = activeModalStub()
    })

    function open() {
      return renderWithProviders(<ApiTokenCreate activeModal={activeModal as any} />)
    }

    const createButton = () => screen.getByText('users.api_tokens.button_create') as HTMLButtonElement
    const submit = async () => {
      fireEvent.submit(document.querySelector('form')!)
      await settle()
    }

    it('needs a name', async () => {
      open()

      expect(createButton().disabled).toBe(true)
      fireEvent.blur(document.getElementById('api-token-name')!)
      expect(document.getElementById('api-token-name')!.classList.contains('is-invalid')).toBe(true)

      fireEvent.change(document.getElementById('api-token-name')!, { target: { value: '   ' } })
      expect(createButton().disabled).toBe(true)
      await submit()
      expect(api.callsTo('post')).toEqual([])
    })

    it('labels every field', () => {
      open()

      expect(screen.getByLabelText(/users\.api_tokens\.label_name/)).toBeTruthy()
      expect(screen.getByLabelText('users.api_tokens.label_scope')).toBeTruthy()
      expect(screen.getByLabelText('users.api_tokens.label_expiry')).toBeTruthy()
    })

    it('sends a read-only token expiring in 90 days by default', async () => {
      api.respond('post', '/auth/tokens', { id: 'n', name: 'CI', scope: 'read', token: 'hbg_secret', createdAt: '', expiresAt: null })
      open()

      fireEvent.change(document.getElementById('api-token-name')!, { target: { value: '  CI  ' } })
      await submit()

      expect(api.lastCall('post', '/auth/tokens')?.body).toEqual({ name: 'CI', scope: 'read', expiresInDays: 90 })
    })

    it('sends the chosen scope and a token that never expires', async () => {
      api.respond('post', '/auth/tokens', { id: 'n', name: 'CI', scope: 'admin', token: 'hbg_secret', createdAt: '', expiresAt: null })
      open()

      fireEvent.change(document.getElementById('api-token-name')!, { target: { value: 'CI' } })
      fireEvent.change(document.getElementById('api-token-scope')!, { target: { value: 'admin' } })
      expect(screen.getByText('users.api_tokens.scope_admin_warning')).toBeTruthy()
      fireEvent.change(document.getElementById('api-token-expiry')!, { target: { value: 'never' } })
      await submit()

      expect(api.lastCall('post', '/auth/tokens')?.body).toEqual({ name: 'CI', scope: 'admin', expiresInDays: null })
    })

    it('shows the token once, with a copy button, and closes with it', async () => {
      const created = { id: 'n', name: 'CI', scope: 'read', token: 'hbg_secret', createdAt: '', expiresAt: null }
      api.respond('post', '/auth/tokens', created)
      const writeText = vi.fn(async () => {})
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      open()

      fireEvent.change(document.getElementById('api-token-name')!, { target: { value: 'CI' } })
      await submit()

      expect((document.getElementById('api-token-value') as HTMLInputElement).value).toBe('hbg_secret')
      expect(screen.getByText('users.api_tokens.created_warning')).toBeTruthy()
      expect(activeModal.close).not.toHaveBeenCalled()

      fireEvent.click(screen.getByLabelText('common.a11y.copy_to_clipboard'))
      await settle()
      expect(writeText).toHaveBeenCalledWith('hbg_secret')
      expect(screen.getByRole('status').textContent).toBe('common.a11y.copied')

      fireEvent.click(screen.getByText('users.api_tokens.button_done'))
      expect(activeModal.close).toHaveBeenCalledWith(created)
      expect(activeModal.dismiss).not.toHaveBeenCalled()
    })

    it('stays on the form and toasts when creation fails', async () => {
      api.fail('post', '/auth/tokens', apiError('bad', 400))
      open()

      fireEvent.change(document.getElementById('api-token-name')!, { target: { value: 'CI' } })
      await submit()

      expect(holder.toast!.shown.map(x => x.level)).toContain('error')
      expect(document.getElementById('api-token-value')).toBeNull()
      expect(createButton().disabled).toBe(false)
    })

    it('dismisses on cancel', () => {
      open()

      fireEvent.click(screen.getByText('form.button_cancel'))

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })
  })
})
