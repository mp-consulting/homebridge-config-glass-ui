import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { setStoredToken } from '@/core/auth/token-store'
import { resetModals } from '@/core/ui/modal'
import { installBrowserStubs, resetBrowserStubs } from '@/testing/fakes/browser.fake'

import '@testing-library/jest-dom/vitest'
import '../../../src/global-defaults.ts'
// Specs see translation keys, as the Angular specs did (see testing/i18n.ts)
import '@/testing/i18n'

installBrowserStubs()

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  setStoredToken(null)
  document.body.className = ''
  document.body.removeAttribute('style')
  resetBrowserStubs()
})

afterEach(() => {
  cleanup()
  resetModals()
})
