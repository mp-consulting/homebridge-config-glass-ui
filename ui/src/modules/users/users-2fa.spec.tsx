import type { ActiveModal } from '@/core/ui/modal'
import type { FakeApi } from '@/testing'
import type { ReactElement } from 'react'
import type { Mock } from 'vitest'

import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { authActions } from '@/core/auth'
import { notifications } from '@/core/notifications'
import { Users2faDisable } from '@/modules/users/users-2fa-disable/Users2faDisable'
import { Users2faEnable } from '@/modules/users/users-2fa-enable/Users2faEnable'
import { fakeApi, renderWithProviders, toastStub } from '@/testing'

const holder = vi.hoisted(() => ({ toast: null as ReturnType<typeof toastStub> | null }))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return holder.toast
  },
}))

/**
 * Turning two factor authentication on and off.
 *
 * The enable modal has one rule that is not obvious and matters a lot: a
 * time-based code is derived from the clock, so if the server's clock is out by
 * more than a few seconds every code the user's app produces will be rejected.
 * Rather than let them set it up and then be locked out, the modal refuses to
 * show the QR code at all and explains the drift instead.
 */
describe('two factor authentication modals', () => {
  let api: FakeApi
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }
  let writeText: ReturnType<typeof vi.fn>
  let refreshSession: ReturnType<typeof vi.spyOn>

  const otpauth = 'otpauth://totp/Homebridge:admin?secret=JBSWY3DPEHPK3PXP&issuer=Homebridge'
  const user = { id: 1, username: 'admin', name: 'Admin', admin: true, otpActive: false }

  /**
   * A timestamp the given number of milliseconds away from now, as the server
   * would report its own clock.
   * @param offsetMs - how far ahead of the browser the server claims to be
   */
  function serverTime(offsetMs = 0): string {
    return new Date(Date.now() + offsetMs).toISOString()
  }

  async function flush() {
    await act(async () => {
      for (let tick = 0; tick < 10; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  /**
   * Build one of the two modals.
   * @param ui - the modal
   * @param arrange - registers responses before the modal is created, the only
   * window for the enable modal's setup request
   */
  async function open(ui: (props: { activeModal: typeof activeModal }) => ReactElement, arrange?: () => void) {
    arrange?.()
    const view = renderWithProviders(ui({ activeModal }))
    await flush()
    return view
  }

  const enable = () => open(props => <Users2faEnable {...props} user={user} />)
  const disable = () => open(props => <Users2faDisable {...props} user={user} />)
  const codeInput = () => document.getElementById('enable-2fa-code') as HTMLInputElement
  const passwordInput = () => document.getElementById('disable-2fa-password') as HTMLInputElement
  const continueButton = () => screen.getByText('form.button_continue') as HTMLButtonElement
  const copyButton = () => screen.queryByLabelText('common.a11y.copy_to_clipboard') as HTMLButtonElement | null
  const copied = () => screen.queryByText('common.a11y.copied') !== null

  beforeEach(() => {
    api = fakeApi().respond('post', '/users/otp/setup', () => ({ otpauth, timestamp: serverTime() }))
    holder.toast = toastStub()
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    refreshSession = vi.spyOn(authActions, 'refreshSession').mockResolvedValue(undefined)
    notifications.reset()
    // jsdom has no clipboard at all, and the async clipboard API is not
    // writable through a plain assignment
    writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('turning it on', () => {
    it('asks the server for a new secret', async () => {
      await enable()

      expect(api.lastCall('post', '/users/otp/setup')?.body).toEqual({})
      expect(api.callsTo('post', '/users/otp/setup')).toHaveLength(1)
      expect(screen.getByText('users.setup_2fa_scan_qr_code')).toBeInTheDocument()
      expect(document.querySelector('.qrcode-size .qrcode-container')).not.toBeNull()
    })

    it('pulls the shared secret out of the otpauth url', async () => {
      await enable()

      // Shown as text so a user whose authenticator cannot scan a QR code can
      // still type it in
      expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument()
    })

    it('accepts a clock within a few seconds', async () => {
      await open(props => <Users2faEnable {...props} user={user} />, () =>
        api.respond('post', '/users/otp/setup', { otpauth, timestamp: serverTime(2000) }))

      expect(screen.queryByText('users.setup_2fa_cannot_setup_2fa')).toBeNull()
      expect(copyButton()).not.toBeNull()
    })

    it('refuses to set up against a server clock that is ahead', async () => {
      await open(props => <Users2faEnable {...props} user={user} />, () =>
        api.respond('post', '/users/otp/setup', { otpauth, timestamp: serverTime(60_000) }))

      // No QR code and no secret: every code generated from this secret would
      // be rejected, and the user would have locked themselves out
      expect(screen.getByText('users.setup_2fa_cannot_setup_2fa')).toBeInTheDocument()
      expect(document.querySelector('.qrcode-container')).toBeNull()
      expect(screen.queryByText(/JBSWY3DPEHPK3PXP/)).toBeNull()
      // Only the centred close button is left
      expect(screen.queryByText('form.button_continue')).toBeNull()
      expect(document.querySelector('.modal-footer .text-center .btn')?.textContent).toBe('form.button_close')
    })

    it('refuses to set up against a server clock that is behind', async () => {
      await open(props => <Users2faEnable {...props} user={user} />, () =>
        api.respond('post', '/users/otp/setup', { otpauth, timestamp: serverTime(-60_000) }))

      // Drift in either direction breaks the codes, so both signs count
      expect(screen.getByText('users.setup_2fa_cannot_setup_2fa')).toBeInTheDocument()
      expect(document.querySelector('.qrcode-container')).toBeNull()
    })

    it('closes itself when the secret cannot be generated', async () => {
      await open(props => <Users2faEnable {...props} user={user} />, () =>
        api.fail('post', '/users/otp/setup', new Error('otp already active')))

      expect(activeModal.dismiss).toHaveBeenCalledTimes(1)
      expect(holder.toast!.at('error')[0].message).toBe('users.setup_2fa_enable_error')
      expect(screen.queryByText(/JBSWY3DPEHPK3PXP/)).toBeNull()
    })

    it('needs a six digit code before it will activate', async () => {
      await enable()

      fireEvent.change(codeInput(), { target: { value: '123' } })
      expect(continueButton().disabled).toBe(true)

      fireEvent.change(codeInput(), { target: { value: '1234567' } })
      expect(continueButton().disabled).toBe(true)

      fireEvent.change(codeInput(), { target: { value: '123456' } })
      expect(continueButton().disabled).toBe(false)
    })

    it('sends the code to activate and closes', async () => {
      await enable()
      fireEvent.change(codeInput(), { target: { value: '123456' } })

      fireEvent.click(continueButton())
      await flush()

      expect(api.lastCall('post', '/users/otp/activate')?.body).toEqual({ code: '123456' })
      expect(activeModal.close).toHaveBeenCalled()
    })

    it('stays open when the code is wrong', async () => {
      await open(props => <Users2faEnable {...props} user={user} />, () =>
        api.fail('post', '/users/otp/activate', new Error('invalid code')))
      fireEvent.change(codeInput(), { target: { value: '000000' } })

      fireEvent.click(continueButton())
      await flush()

      // The secret is not active yet, so the user has to be able to try again
      // rather than be sent away and have to start over
      expect(activeModal.close).not.toHaveBeenCalled()
      expect(holder.toast!.at('error')[0].message).toBe('users.setup_2fa_activate_error')
    })

    it('copies the secret and says so briefly', async () => {
      vi.useFakeTimers()
      await enable()

      fireEvent.click(copyButton()!)
      await flush()

      expect(writeText).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP')
      expect(copied()).toBe(true)

      await act(() => vi.advanceTimersByTimeAsync(3000))
      expect(copied()).toBe(false)
    })

    it('restarts the copied message on a second press', async () => {
      vi.useFakeTimers()
      await enable()

      fireEvent.click(copyButton()!)
      await flush()
      await act(() => vi.advanceTimersByTimeAsync(2000))
      fireEvent.click(copyButton()!)
      await flush()
      await act(() => vi.advanceTimersByTimeAsync(2000))

      // The first timer is cleared, so the message lasts three seconds from the
      // last press rather than disappearing part way through
      expect(copied()).toBe(true)
    })

    it('offers nothing to copy when there is no secret', async () => {
      await open(props => <Users2faEnable {...props} user={user} />, () =>
        api.respond('post', '/users/otp/setup', { otpauth, timestamp: serverTime(60_000) }))

      expect(copyButton()).toBeNull()
      expect(writeText).not.toHaveBeenCalled()
    })
  })

  describe('turning it off', () => {
    it('sends the password and closes on success', async () => {
      await disable()
      fireEvent.change(passwordInput(), { target: { value: 'correct horse' } })

      fireEvent.click(continueButton())
      await flush()

      expect(api.lastCall('post', '/users/otp/deactivate')?.body).toEqual({ password: 'correct horse' })
      expect(activeModal.close).toHaveBeenCalled()
      expect(holder.toast!.at('success')[0].message).toBe('users.setup_2fa_disable_success')
    })

    it('needs a password', async () => {
      await disable()

      expect(continueButton().disabled).toBe(true)

      fireEvent.change(passwordInput(), { target: { value: 'anything' } })
      expect(continueButton().disabled).toBe(false)
    })

    it('clears the legacy warning it was raised by', async () => {
      await disable()
      notifications.set('legacyOtpDetected', true)
      fireEvent.change(passwordInput(), { target: { value: 'correct horse' } })

      fireEvent.click(continueButton())
      await flush()

      // This modal is how a user acts on the legacy-secret warning, so leaving
      // it up afterwards would tell them to do something already done
      expect(notifications.get('legacyOtpDetected')).toBe(false)
    })

    it('refreshes the session so the token loses the legacy flag', async () => {
      await disable()
      fireEvent.change(passwordInput(), { target: { value: 'correct horse' } })

      fireEvent.click(continueButton())
      await flush()

      expect(refreshSession).toHaveBeenCalledWith('profile-update')
    })

    it('still counts as done when the session refresh fails', async () => {
      refreshSession.mockRejectedValue(new Error('offline'))
      await disable()
      fireEvent.change(passwordInput(), { target: { value: 'correct horse' } })

      fireEvent.click(continueButton())
      await flush()

      // Two factor really is off on the server by now; the stale flag in the
      // token clears itself at the next login
      expect(activeModal.close).toHaveBeenCalled()
      expect(screen.queryByText('login.invalid_password')).toBeNull()
    })

    it('empties the password box when it is rejected', async () => {
      await open(props => <Users2faDisable {...props} user={user} />, () =>
        api.fail('post', '/users/otp/deactivate', new Error('wrong password')))
      fireEvent.change(passwordInput(), { target: { value: 'wrong' } })

      fireEvent.click(continueButton())
      await flush()

      // Turning two factor off is a security downgrade, so a wrong password
      // must not be left in the box for a second casual press of the button
      expect(passwordInput().value).toBe('')
      expect(screen.getByText('login.invalid_password')).toBeInTheDocument()
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('clears the previous failure when trying again', async () => {
      await open(props => <Users2faDisable {...props} user={user} />, () =>
        api.fail('post', '/users/otp/deactivate', new Error('wrong password')))
      fireEvent.change(passwordInput(), { target: { value: 'wrong' } })
      fireEvent.click(continueButton())
      await flush()

      api.respond('post', '/users/otp/deactivate', undefined)
      fireEvent.change(passwordInput(), { target: { value: 'correct horse' } })
      fireEvent.click(continueButton())
      await flush()

      expect(screen.queryByText('login.invalid_password')).toBeNull()
      expect(activeModal.close).toHaveBeenCalled()
    })
  })
})
