import type { FakeToast, MatterServiceFixture } from '@/testing'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { advance, changedElsewhere, moveSlider, renderManage } from '@/core/accessories/types/matter/matter.testing'
import { WindowCoveringManage } from '@/core/accessories/types/matter/window-covering/WindowCoveringManage'
import { toast } from '@/core/ui/toast'
import { matterService } from '@/testing'

vi.mock('@/core/ui/toast', async () => ({ toast: (await import('@/testing')).toastStub() }))

/**
 * The matter window covering modal.
 *
 * ⚠️ **A covering may lift, tilt, or both, and writing a position it has no
 * feature for is refused by the cluster.** The modal therefore shows only the
 * sliders the device actually has — a Venetian blind that only tilts must not be
 * given a lift slider, because every drag of it would fail.
 *
 * ⚠️ **Matter counts a covering the opposite way round from the UI**: 0 is open
 * and 10000 is closed, in hundredths of a percent. Those conversions live in
 * `matter-device.utils.ts` and have their own spec; what is checked here is that
 * this modal reads and writes through them rather than doing its own arithmetic.
 */
describe('windowCoveringManage', () => {
  const toastr = toast as unknown as FakeToast
  let container: HTMLElement

  /**
   * A covering.
   * @param cluster - the windowCovering cluster attributes it reports
   */
  function covering(cluster: Record<string, unknown>): MatterServiceFixture {
    return matterService({ deviceType: 'WindowCovering', clusters: { windowCovering: cluster } })
  }

  /** One that lifts only, half open. */
  const lifting = () => covering({ currentPositionLiftPercent100ths: 5000, targetPositionLiftPercent100ths: 5000 })

  /** One that tilts only, a quarter open. */
  const tilting = () => covering({ currentPositionTiltPercent100ths: 7500, targetPositionTiltPercent100ths: 7500 })

  /** One that does both. */
  const both = () => covering({
    currentPositionLiftPercent100ths: 2000,
    targetPositionLiftPercent100ths: 2000,
    currentPositionTiltPercent100ths: 6000,
    targetPositionTiltPercent100ths: 6000,
  })

  function create(service: MatterServiceFixture) {
    container = renderManage(WindowCoveringManage, service).container
  }

  function heading(key: string) {
    return Array.from(container.querySelectorAll('h6')).find(h6 => h6.textContent!.startsWith(`${key}:`))
  }

  /** The value shown under a heading (`target: 50%` → 50). */
  function shown(key: string): number | undefined {
    const text = heading(key)?.textContent
    return text === undefined ? undefined : Number(/(-?\d+)%$/.exec(text)![1])
  }

  /** The slider right after a heading. */
  function sliderAfter(key: string) {
    const host = heading(key)!.nextElementSibling as HTMLElement
    return host.querySelector('.noUi-target') as HTMLElement & { noUiSlider: { get: () => string, set: (v: number) => void, options: { range: unknown, step: number } } }
  }

  /** Move a slider through the 500ms debounce. */
  async function slide(key: string, ...values: number[]) {
    for (const value of values) {
      const target = sliderAfter(key)
      moveSlider(target.parentElement!, value)
    }
    await advance(500)
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
    toastr.error.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('which sliders it offers', () => {
    it('offers only the lift slider to a covering that lifts', () => {
      create(lifting())

      expect(heading('accessories.control.target')).toBeDefined()
      expect(heading('accessories.control.tilt_target')).toBeUndefined()
    })

    it('offers only the tilt slider to a covering that tilts', () => {
      // A Venetian blind. A lift slider here would be refused on every drag
      create(tilting())

      expect(heading('accessories.control.target')).toBeUndefined()
      expect(heading('accessories.control.tilt_target')).toBeDefined()
    })

    it('offers both to a covering that does both', () => {
      create(both())

      expect(heading('accessories.control.target')).toBeDefined()
      expect(heading('accessories.control.tilt_target')).toBeDefined()
    })

    it('falls back to a lift slider when the device reports neither', () => {
      // Rather than an empty modal with nothing in it at all
      create(covering({}))

      expect(heading('accessories.control.target')).toBeDefined()
    })
  })

  describe('what it starts on', () => {
    it('reads the lift position the covering is at', () => {
      // 5000 hundredths closed is 50% open
      create(lifting())

      expect(shown('accessories.control.target')).toBe(50)
      expect(Number(sliderAfter('accessories.control.target').noUiSlider.get())).toBe(50)
      expect(shown('accessories.control.current')).toBe(50)
    })

    it('reads the tilt position the covering is at', () => {
      create(tilting())

      expect(shown('accessories.control.tilt_target')).toBe(25)
      expect(shown('accessories.control.tilt_current')).toBe(25)
    })

    it('gives both sliders the full range', () => {
      create(both())

      for (const key of ['accessories.control.target', 'accessories.control.tilt_target']) {
        expect(sliderAfter(key).noUiSlider.options).toMatchObject({ range: { min: 0, max: 100 }, step: 1 })
      }
    })

    it('summarises a lifting covering by its lift', () => {
      create(both())

      expect(container.querySelector('.btn-read')!.textContent).toBe('accessories.control.open 80%')
    })

    it('summarises a tilt-only covering by its tilt', () => {
      // The same value the tile shows, so the two cannot disagree
      create(tilting())

      expect(container.querySelector('.btn-read')!.textContent).toBe('accessories.control.open 25%')
    })
  })

  describe('moving the covering', () => {
    it('writes a new lift position to the lift attribute', async () => {
      const service = lifting()
      create(service)

      await slide('accessories.control.target', 75)

      expect(service.writes).toEqual([
        { cluster: 'windowCovering', attributes: { targetPositionLiftPercent100ths: 2500 } },
      ])
    })

    it('writes a new tilt position to the tilt attribute', async () => {
      // ⚠️ A tilt written to the lift attribute is the classic mistake here, and
      // it moves the whole blind instead of the slats
      const service = tilting()
      create(service)

      await slide('accessories.control.tilt_target', 100)

      expect(service.writes).toEqual([
        { cluster: 'windowCovering', attributes: { targetPositionTiltPercent100ths: 0 } },
      ])
    })

    it('sends one write for a slider dragged across several values', async () => {
      // The debounce is what stops a drag becoming twenty writes
      const service = lifting()
      create(service)

      await slide('accessories.control.target', 60, 70, 80)

      expect(service.writes).toHaveLength(1)
      expect(service.writes[0].attributes).toEqual({ targetPositionLiftPercent100ths: 2000 })
    })

    it('puts the lift slider back when the write is refused', async () => {
      // Otherwise the slider sits at a position the covering is not in
      const service = lifting()
      service.failWrites('windowCovering', new Error('device unreachable'))
      create(service)

      await slide('accessories.control.target', 90)

      expect(shown('accessories.control.target')).toBe(50)
      expect(Number(sliderAfter('accessories.control.target').noUiSlider.get())).toBe(50)
      expect(toastr.error).toHaveBeenCalled()
    })

    it('puts the tilt slider back when the write is refused', async () => {
      const service = tilting()
      service.failWrites('windowCovering', new Error('device unreachable'))
      create(service)

      await slide('accessories.control.tilt_target', 90)

      expect(shown('accessories.control.tilt_target')).toBe(25)
      expect(toastr.error).toHaveBeenCalled()
    })
  })

  describe('when the covering moves by itself', () => {
    it('follows the lift position', () => {
      // Someone pulled the cord, or another app moved it
      const service = lifting()
      create(service)

      ;(service.clusters!.windowCovering as Record<string, unknown>).currentPositionLiftPercent100ths = 1000
      changedElsewhere(service)

      expect(shown('accessories.control.target')).toBe(90)
    })

    it('follows the tilt position', () => {
      const service = tilting()
      create(service)

      ;(service.clusters!.windowCovering as Record<string, unknown>).currentPositionTiltPercent100ths = 0
      changedElsewhere(service)

      expect(shown('accessories.control.tilt_target')).toBe(100)
    })
  })
})
