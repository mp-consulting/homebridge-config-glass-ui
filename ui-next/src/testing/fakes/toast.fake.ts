import type { Mock } from 'vitest'

import { vi } from 'vitest'

export type ToastLevel = 'error' | 'info' | 'success' | 'warning'

export interface ShownToast {
  level: ToastLevel
  message?: string
  title?: string
  options?: Record<string, any>
  toastId: number
}

type RaiseToast = (message?: string, title?: string, options?: Record<string, any>) => ShownToast

export interface FakeToast {
  success: Mock<RaiseToast>
  error: Mock<RaiseToast>
  warning: Mock<RaiseToast>
  info: Mock<RaiseToast>
  clear: Mock<(toastId?: number) => void>
  remove: Mock<(toastId: number) => void>

  /** Every toast raised, in order. */
  shown: ShownToast[]

  /**
   * The toasts raised at one level.
   * @param level - success, error, warning or info
   */
  at: (level: ToastLevel) => ShownToast[]

  /** The most recent toast, or undefined. */
  last: () => ShownToast | undefined
}

/**
 * A stand-in for the `toast` facade of `@/core/ui/toast` (ToastrService in
 * the Angular app):
 *
 *     vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))
 *
 * `options` is recorded as given, so a spec can reach any callback the code
 * under test passed in it.
 */
export function toastStub(): FakeToast {
  const shown: ShownToast[] = []
  let nextId = 1

  const raise = (level: ToastLevel) => vi.fn((message?: string, title?: string, options?: Record<string, any>) => {
    const toast: ShownToast = { level, message, title, options, toastId: nextId++ }
    shown.push(toast)
    return toast
  })

  return {
    shown,
    success: raise('success'),
    error: raise('error'),
    warning: raise('warning'),
    info: raise('info'),
    clear: vi.fn(),
    remove: vi.fn(),
    at: (level: ToastLevel) => shown.filter(toast => toast.level === level),
    last: () => shown.at(-1),
  }
}
