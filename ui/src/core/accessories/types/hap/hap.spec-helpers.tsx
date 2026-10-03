import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { CharacteristicType } from '@homebridge/hap-client'
import type { ComponentType } from 'react'

import { act, fireEvent, render } from '@testing-library/react'
import { vi } from 'vitest'

import { accessories } from '@/core/accessories/accessories'
import { activeModalStub, characteristic, hapService } from '@/testing'

/**
 * Shared plumbing for the HAP tile and manage-modal specs (the Angular specs
 * repeated these in every file).
 */

export type CharSpec = [string, any] | [string, any, Partial<CharacteristicType>]

/**
 * A service carrying exactly the characteristics a case names.
 * @param chars - name / value / optional-overrides tuples
 * @param type - the service type
 */
export function serviceWith(chars: CharSpec[], type?: string): ServiceTypeX {
  return hapService({
    type,
    characteristics: chars.map(([name, value, overrides]) => characteristic(name, value, overrides)),
  })
}

/**
 * Every `setValue` call on a service, in the order they happened (sorted by
 * `invocationCallOrder`, not per characteristic, so "On after Brightness" is
 * asserted for real).
 * @param service - the service
 */
export function writesTo(service: ServiceTypeX) {
  return service.serviceCharacteristics
    .flatMap((char) => {
      const spy = vi.mocked(char.setValue!)
      return spy.mock.calls.map((call, index) => ({
        type: char.type,
        value: call[0],
        order: spy.mock.invocationCallOrder[index],
      }))
    })
    .sort((first, second) => first.order - second.order)
    .map(({ type, value }) => ({ type, value }))
}

/** The tile's root, `.accessory-box`. */
export function tileBox(container: HTMLElement): HTMLElement {
  return container.querySelector('.accessory-box') as HTMLElement
}

/**
 * A short click on a tile, as the long-press hook sees it (mousedown + mouseup).
 * @param container - the render container
 */
export function tap(container: HTMLElement) {
  const box = tileBox(container)
  fireEvent.mouseDown(box, { button: 0 })
  fireEvent.mouseUp(box, { button: 0 })
}

/**
 * A key press on a focused tile, the way a real key arrives: keydown then keyup.
 * @param container - the render container
 * @param key - the `KeyboardEvent.key`
 * @param init - modifiers (`{ shiftKey: true }`, …)
 */
export function pressKey(container: HTMLElement, key: string, init: Partial<Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>> = {}) {
  const box = tileBox(container)
  fireEvent.keyDown(box, { key, ...init })
  fireEvent.keyUp(box, { key, ...init })
}

/**
 * A long press on a tile. Needs fake timers.
 * @param container - the render container
 */
export async function longPress(container: HTMLElement) {
  const box = tileBox(container)
  fireEvent.mouseDown(box, { button: 0 })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400)
  })
  fireEvent.mouseUp(box, { button: 0 })
}

/**
 * Render a tile.
 * @param Tile - the tile component
 * @param service - the service it shows
 * @param readyForControl - whether the bridge accepts writes
 * @param extra - any other props (the climate tiles' `type`)
 */
export function renderTile(Tile: ComponentType<any>, service: ServiceTypeX, readyForControl = true, extra: Record<string, unknown> = {}) {
  const result = render(<Tile service={service} readyForControl={readyForControl} {...extra} />)
  return {
    ...result,
    box: () => tileBox(result.container),
    tap: () => tap(result.container),
    press: (key: string, init?: Partial<Pick<KeyboardEvent, 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>>) => pressKey(result.container, key, init),
    setService: (next: ServiceTypeX) => result.rerender(<Tile service={next} readyForControl={readyForControl} {...extra} />),
    longPress: () => longPress(result.container),
  }
}

/** The noUiSlider API on the slider inside `selector` (or the first one). */
export function sliderApi(container: HTMLElement, selector = '') {
  const target = container.querySelector(`${selector} .noUi-target`.trim()) as (HTMLElement & {
    noUiSlider: { get: () => string, set: (v: number) => void, options: { range: { min: number, max: number }, step: number } }
  }) | null
  return target?.noUiSlider
}

/**
 * Move a slider to a value, as the user would.
 * @param container - the render container
 * @param selector - a selector for the slider's wrapper
 * @param value - the value to move to
 */
export function slideTo(container: HTMLElement, selector: string, value: number) {
  act(() => {
    sliderApi(container, selector)!.set(value)
  })
}

/** Run the manage modals' 500ms debounce. */
export async function flushDebounce(ms = 500) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/**
 * Render a manage modal with the real accessories singleton holding just
 * this service, so `pushUpdate` can drive a live update.
 * @param Manage - the manage component
 * @param service - the service it manages
 * @param extra - any extra props
 */
export function renderManage<P extends object>(Manage: ComponentType<P>, service: ServiceTypeX, extra: Record<string, unknown> = {}) {
  accessories.accessories = { services: [service] }
  const activeModal = { ...activeModalStub(), update: vi.fn() }
  const props = { service, activeModal, ...extra } as unknown as P
  const result = render(<Manage {...props} />)
  return {
    ...result,
    activeModal,
    /**
     * Swap in a new service object (or the same, mutated) and emit a live update.
     * @param next - the updated service
     */
    pushUpdate: (next: ServiceTypeX = service) => {
      accessories.accessories = { services: [next] }
      act(() => {
        accessories.accessoryData.emit({})
      })
    },
  }
}

/**
 * Click a button by its text.
 * @param container - where to look
 * @param text - the button's (trimmed) text, a translation key in specs
 */
export function clickButton(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
  if (!button) {
    throw new Error(`no button "${text}"`)
  }
  fireEvent.click(button)
  return button
}

/** Whether a button (found by text) shows the check-circle "selected" icon. */
export function isChecked(container: HTMLElement, text: string): boolean {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.trim() === text)
  return !!button?.querySelector('.fa-check-circle')
}
