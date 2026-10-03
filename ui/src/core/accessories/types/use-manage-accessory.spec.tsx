import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { ManageAccessoriesSource, ManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import type { Emitter } from '@/core/utilities/emitter'

import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import { toast } from '@/core/ui/toast'
import { createEmitter } from '@/core/utilities/emitter'
import { activeModalStub, hapService } from '@/testing'

vi.mock('@/core/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

/**
 * Every one of the sixty-odd accessory manage modals uses this hook, so a
 * regression here breaks all of them at once. It is exercised through a tiny
 * local component rather than through one real modal, so the assertions are
 * about the hook and not about whichever device type was picked.
 */
describe('useManageAccessory', () => {
  let activeModal: ReturnType<typeof activeModalStub>
  let accessoryData: Emitter<unknown>
  let source: ManageAccessoriesSource
  let api: ManageAccessory
  let setupCalls: number
  let seenServices: ServiceTypeX[]
  let unmount: () => void

  interface CreateOptions {
    /** Omit either half of the modal data to drive the null-safety path. */
    service?: ServiceTypeX | undefined
    withAccessories?: boolean
  }

  function TestManage({ service, accessories }: { service: ServiceTypeX | undefined, accessories: ManageAccessoriesSource | null }) {
    api = useManageAccessory(service, {
      activeModal,
      accessories,
      onSetup: () => {
        setupCalls += 1
      },
      onUpdate: (updated) => {
        seenServices.push(updated)
      },
    })
    // Two sliders plus one element outside the default selector, so the
    // gradient helper can be shown to paint the right set
    return (
      <>
        <div className="noUi-target first"></div>
        <div className="noUi-target second"></div>
        <div className="other-slider"></div>
      </>
    )
  }

  function create(options: CreateOptions = {}) {
    unmount?.()
    const service = 'service' in options ? options.service : hapService({ uniqueId: 'hap-1' })
    accessoryData = createEmitter<unknown>()
    source = { accessoryData, accessories: { services: service ? [service] : [] } }
    activeModal = activeModalStub()
    setupCalls = 0
    seenServices = []
    const result = render(<TestManage service={service} accessories={(options.withAccessories ?? true) ? source : null} />)
    unmount = result.unmount
    return result
  }

  /** Let the requestAnimationFrame stub, which runs off a timer, fire. */
  function flushFrames(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 20))
  }

  function el(selector: string) {
    return document.querySelector(selector) as HTMLElement
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
    vi.mocked(toast.error).mockClear()
    create()
  })

  afterEach(() => {
    unmount?.()
    vi.useRealTimers()
  })

  describe('initialisation', () => {
    it('takes the service and the accessories service from the modal data', () => {
      expect(api.service.uniqueId).toBe('hap-1')
      expect(api.$accessories).toBe(source)
      expect(api.ready).toBe(true)
    })

    it('runs the child setup exactly once', () => {
      act(() => {
        accessoryData.emit([])
      })
      expect(setupCalls).toBe(1)
    })

    it('dismisses rather than rendering when no service was provided', () => {
      create({ service: undefined })

      expect(activeModal.dismiss).toHaveBeenCalledWith('Missing required data')
      expect(console.error).toHaveBeenCalled()
      expect(setupCalls).toBe(0)
      expect(api.ready).toBe(false)
    })

    it('dismisses rather than rendering when no accessories service was provided', () => {
      create({ withAccessories: false })

      expect(activeModal.dismiss).toHaveBeenCalledWith('Missing required data')
      expect(setupCalls).toBe(0)
    })

    it('dismisses with a reason the caller can tell apart from the close button', () => {
      // The opener branches on the dismiss reason, so the two must differ
      api.dismissModal()

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })
  })

  describe('live accessory updates', () => {
    it('swaps in the newest service object rather than keeping the stale one', () => {
      const replacement = hapService({ uniqueId: 'hap-1', serviceName: 'Renamed' })
      source.accessories.services[0] = replacement

      act(() => {
        accessoryData.emit([replacement])
      })

      expect(api.service).toBe(replacement)
      expect(seenServices).toEqual([replacement])
    })

    it('hands the child the new reference before asking it to update', () => {
      const original = api.service
      const replacement = hapService({ uniqueId: 'hap-1' })
      source.accessories.services[0] = replacement

      act(() => {
        accessoryData.emit([replacement])
      })

      expect(seenServices[0]).not.toBe(original)
      expect(seenServices[0]).toBe(replacement)
    })

    it('keeps the existing service when the accessory has disappeared', () => {
      // A removed accessory must not blank the open modal
      const original = api.service
      source.accessories.services.length = 0

      act(() => {
        accessoryData.emit([])
      })

      expect(api.service).toBe(original)
      expect(seenServices).toHaveLength(1)
    })

    it('stops listening once the modal is destroyed', () => {
      unmount()

      accessoryData.emit([])

      expect(seenServices).toHaveLength(0)
    })
  })

  describe('debounced value changes', () => {
    it('waits half a second by default', () => {
      vi.useFakeTimers()
      const debounced: number[] = []

      api.debounce('value', 1, v => debounced.push(v))
      api.debounce('value', 2, v => debounced.push(v))
      api.debounce('value', 3, v => debounced.push(v))

      vi.advanceTimersByTime(499)
      expect(debounced).toEqual([])

      vi.advanceTimersByTime(1)
      expect(debounced).toEqual([3])
    })

    it('honours a shorter window when the child asks for one', () => {
      vi.useFakeTimers()
      const debounced: number[] = []

      api.debounce('value', 7, v => debounced.push(v), 50)
      vi.advanceTimersByTime(50)

      expect(debounced).toEqual([7])
    })

    it('debounces each key on its own', () => {
      vi.useFakeTimers()
      const debounced: string[] = []

      api.debounce('a', 'a', v => debounced.push(v))
      api.debounce('b', 'b', v => debounced.push(v))
      vi.advanceTimersByTime(500)

      expect(debounced).toEqual(['a', 'b'])
    })

    it('drops a pending value when the modal closes first', () => {
      // Otherwise a slider nudged and then cancelled still writes to the
      // accessory after the modal has gone
      vi.useFakeTimers()
      const debounced: number[] = []

      api.debounce('value', 9, v => debounced.push(v))
      unmount()
      vi.advanceTimersByTime(1000)

      expect(debounced).toEqual([])
    })
  })

  describe('the error toast', () => {
    it('shows the translated generic message for a developer-only error', () => {
      api.showGenericErrorToast(new Error('LevelControl cluster not found'))

      expect(toast.error).toHaveBeenCalledWith('toast.api_error_generic', 'toast.title_error')
      expect(console.error).toHaveBeenCalled()
    })

    it('shows a message the server supplied', () => {
      api.showGenericErrorToast({ error: { message: 'Accessory is not responding' } })

      expect(toast.error).toHaveBeenCalledWith('Accessory is not responding', 'toast.title_error')
    })

    it('logs nothing when called with no error at all', () => {
      api.showGenericErrorToast()

      expect(console.error).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith('toast.api_error_generic', 'toast.title_error')
    })
  })

  describe('slider gradients', () => {
    it('paints every slider on the next frame', async () => {
      api.applySliderGradient('linear-gradient(90deg, red, blue)')

      // Nothing has happened yet - the work is deferred to a frame callback
      expect(el('.noUi-target.first').style.background).toBe('')

      await flushFrames()

      expect(el('.noUi-target.first').style.background).toBe('linear-gradient(90deg, red, blue)')
      expect(el('.noUi-target.second').style.background).toBe('linear-gradient(90deg, red, blue)')
    })

    it('leaves elements outside the selector alone', async () => {
      api.applySliderGradient('linear-gradient(90deg, red, blue)')
      await flushFrames()

      expect(el('.other-slider').style.background).toBe('')
    })

    it('paints only the sliders a child narrowed to', async () => {
      api.applySliderGradient('linear-gradient(90deg, red, blue)', '.noUi-target.second')
      await flushFrames()

      expect(el('.noUi-target.first').style.background).toBe('')
      expect(el('.noUi-target.second').style.background).toBe('linear-gradient(90deg, red, blue)')
    })
  })

  describe('blurring a pressed button', () => {
    it('takes focus off the button that was clicked', () => {
      const button = document.createElement('button')
      document.body.appendChild(button)
      button.focus()
      expect(document.activeElement).toBe(button)

      api.blurTarget({ target: button } as unknown as MouseEvent)

      expect(document.activeElement).not.toBe(button)
      button.remove()
    })
  })
})
