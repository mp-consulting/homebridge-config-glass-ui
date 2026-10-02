import type { Mock } from 'vitest'

import { vi } from 'vitest'

export interface FakeModalRef {
  result: Promise<any>
  close: Mock<(value?: any) => void>
  dismiss: Mock<(reason?: any) => void>
}

export interface OpenedModal {
  component: unknown
  props: Record<string, any> | undefined
  options: Record<string, any> | undefined
  ref: FakeModalRef
}

export interface FakeOpenModal {
  /** Drop-in for `openModal(Component, props, options)` from `@/core/ui/modal`. */
  openModal: Mock<(component: unknown, props?: Record<string, any>, options?: Record<string, any>) => FakeModalRef>

  /** Every modal opened, in order. */
  opened: OpenedModal[]

  /** The most recently opened modal, or undefined. */
  lastOpened: () => OpenedModal | undefined

  /**
   * The props a modal was opened with (what Angular passed as modal data).
   * @param index - which opened modal, defaulting to the most recent
   */
  propsFor: (index?: number) => Record<string, any> | undefined
}

/**
 * A stand-in for the `activeModal` prop a modal component receives.
 * Callers branch on whether the result resolved (close) or rejected (dismiss).
 */
export function activeModalStub() {
  return {
    close: vi.fn(),
    dismiss: vi.fn(),
  }
}

/**
 * A controllable modal reference: `close` resolves `result`, `dismiss`
 * rejects it, matching the modal service (and NgbModalRef before it).
 */
export function fakeModalRef(): FakeModalRef {
  let settle: (value: any) => void = () => {}
  let reject: (reason: any) => void = () => {}

  const result = new Promise<any>((resolveFn, rejectFn) => {
    settle = resolveFn
    reject = rejectFn
  })

  // A dismissed modal nobody awaits would otherwise surface as an unhandled
  // rejection and fail an unrelated test
  result.catch(() => {})

  return {
    result,
    close: vi.fn((value?: any) => settle(value)),
    dismiss: vi.fn((reason?: any) => reject(reason)),
  }
}

/**
 * A stand-in for `openModal`, recording what was opened and with what props:
 *
 *     vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
 *     import * as modalModule from '@/core/ui/modal'
 *     const modal = modalModule as unknown as FakeOpenModal
 */
export function fakeOpenModal(): FakeOpenModal {
  const opened: OpenedModal[] = []

  const openModal = vi.fn((component: unknown, props?: Record<string, any>, options?: Record<string, any>) => {
    const ref = fakeModalRef()
    opened.push({ component, props, options, ref })
    return ref
  })

  return {
    openModal,
    opened,
    lastOpened: () => opened.at(-1),
    propsFor: (index?: number) => (index === undefined ? opened.at(-1) : opened[index])?.props,
  }
}
