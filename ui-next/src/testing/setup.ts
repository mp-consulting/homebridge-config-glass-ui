import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import '@testing-library/jest-dom/vitest'
import '../../../src/global-defaults.ts'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  cleanup()
})
