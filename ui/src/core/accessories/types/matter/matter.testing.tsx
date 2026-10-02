import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'
import type { ComponentType } from 'react'

import { act, render } from '@testing-library/react'
import { vi } from 'vitest'

import { accessories } from '@/core/accessories/accessories'
import { activeModalStub } from '@/testing'

/** The noUiSlider API of a rendered `<Slider>`. */
export interface SliderApi {
  get: () => string
  set: (value: number) => void
  options: { range: { min: number, max: number }, step: number }
}

/**
 * The noUiSlider under a selector (the first `.noUi-target` by default).
 * @param container - where to look
 * @param selector - e.g. `.hue-slider .noUi-target`
 */
export function slider(container: HTMLElement, selector = '.noUi-target'): SliderApi {
  const element = container.querySelector(selector) as (HTMLElement & { noUiSlider: SliderApi }) | null
  if (!element) {
    throw new Error(`No slider at ${selector}`)
  }
  return element.noUiSlider
}

/** The slider's value as a number. */
export function sliderValue(container: HTMLElement, selector?: string): number {
  return Number(slider(container, selector).get())
}

/**
 * Move a slider as the user would.
 * @param container - where to look
 * @param value - the new value
 * @param selector - which slider
 */
export function moveSlider(container: HTMLElement, value: number, selector?: string) {
  act(() => {
    slider(container, selector).set(value)
  })
}

/**
 * Render a manage modal with the props `openModal` would give it, against the
 * real accessories service with `service` as its only service.
 * @param Component - the manage modal
 * @param service - the service it was opened with
 */
export function renderManage(Component: ComponentType<AccessoryManageModalProps>, service: ServiceTypeX) {
  accessories.accessories = { services: [service] }
  const activeModal = activeModalStub()
  const result = render(<Component service={service} activeModal={activeModal} />)
  return { ...result, activeModal }
}

/**
 * The accessory changed elsewhere: a live payload with a new service object.
 * @param updated - the new service object
 */
export function changedElsewhere(updated: ServiceTypeX) {
  accessories.accessories.services[0] = updated
  act(() => {
    accessories.accessoryData.next([updated])
  })
}

/** Let fire-and-forget writes settle (fake timers or not). */
export async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve()
    }
  })
}

/** Advance fake timers inside act. */
export async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/**
 * Whether the `n`th button of a mode picker shows as selected.
 * @param button - the button
 */
export function isSelected(button: HTMLElement): boolean {
  return button.querySelector('.float-start i')?.classList.contains('fa-check-circle') ?? false
}
