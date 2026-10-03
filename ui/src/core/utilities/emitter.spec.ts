import { describe, expect, it, vi } from 'vitest'

import { createEmitter } from '@/core/utilities/emitter'

describe('createEmitter', () => {
  it('calls each listener until it unsubscribes', () => {
    const emitter = createEmitter<number>()
    const listener = vi.fn()
    const off = emitter.subscribe(listener)

    emitter.emit(1)
    off()
    emitter.emit(2)

    expect(listener.mock.calls).toEqual([[1]])
  })

  it('lets a listener unsubscribe another while being called', () => {
    const emitter = createEmitter()
    const second = vi.fn()
    let offSecond = () => {}
    emitter.subscribe(() => offSecond())
    offSecond = emitter.subscribe(second)

    emitter.emit()
    emitter.emit()

    expect(second).toHaveBeenCalledTimes(1)
  })

  it('drops every listener on clear', () => {
    const emitter = createEmitter()
    const listener = vi.fn()
    emitter.subscribe(listener)

    emitter.clear()
    emitter.emit()

    expect(listener).not.toHaveBeenCalled()
  })
})
