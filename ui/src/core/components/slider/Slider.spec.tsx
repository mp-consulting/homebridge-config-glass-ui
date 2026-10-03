import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Slider } from '@/core/components/slider/Slider'

/** The noUiSlider API on a rendered slider. */
function api(container: HTMLElement) {
  return (container.querySelector('.noUi-target') as HTMLElement & { noUiSlider: { get: () => string, set: (v: number) => void, options: { range: unknown, step: number } } }).noUiSlider
}

describe('slider', () => {
  it('renders the ng2-nouislider markup', () => {
    const { container } = render(<Slider min={0} max={100} step={1} value={40} className="mb-1" />)

    const host = container.firstElementChild!
    expect(host.className).toBe('ng2-nouislider mb-1')
    expect(host.firstElementChild?.classList).toContain('noUi-target')
    expect(container.querySelector('.noUi-handle')).not.toBeNull()
  })

  it('starts at the model value, formatted like ng2-nouislider', () => {
    const { container } = render(<Slider min={0} max={100} step={0.001} value={12.3456} />)

    expect(api(container).get()).toBe('12.35')
  })

  it('waits for a value before creating the slider', () => {
    // ngModel hands the accessor null first; the slider is built on the real value
    const { container, rerender } = render(<Slider min={0} max={100} value={null} />)
    expect(container.querySelector('.noUi-target')).toBeNull()

    rerender(<Slider min={0} max={100} value={10} />)

    expect(container.querySelector('.noUi-target')).not.toBeNull()
  })

  it('reports a value the user moves to, as a number', () => {
    const onChange = vi.fn()
    const { container } = render(<Slider min={0} max={100} step={5} value={40} onChange={onChange} />)

    fireEvent.keyDown(container.querySelector('.noUi-handle')!, { key: 'ArrowRight', which: 39, keyCode: 39 })

    expect(onChange).toHaveBeenCalledWith(45)
  })

  it('reports a value set on the slider that differs from the model', () => {
    const onChange = vi.fn()
    const { container } = render(<Slider min={0} max={100} step={1} value={40} onChange={onChange} />)

    api(container).set(60)

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(60)
  })

  it('follows a new model value without reporting it back', () => {
    // An accessory update arriving over the socket must not be sent straight
    // back to the accessory as if the user had moved the slider
    const onChange = vi.fn()
    const { container, rerender } = render(<Slider min={0} max={100} step={1} value={40} onChange={onChange} />)

    rerender(<Slider min={0} max={100} step={1} value={70} onChange={onChange} />)

    expect(api(container).get()).toBe('70')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies a new range and step', () => {
    const { container, rerender } = render(<Slider min={0} max={100} step={1} value={40} />)

    rerender(<Slider min={140} max={500} step={10} value={40} />)

    expect(api(container).options.range).toEqual({ min: 140, max: 500 })
    expect(api(container).options.step).toBe(10)
  })

  it('marks the slider disabled the way the theme looks for it', () => {
    const { container, rerender } = render(<Slider min={0} max={100} value={40} disabled />)
    expect(container.querySelector('.noUi-target')?.getAttribute('disabled')).toBe('true')

    rerender(<Slider min={0} max={100} value={40} />)

    expect(container.querySelector('.noUi-target')?.hasAttribute('disabled')).toBe(false)
  })

  it('tears the slider down on unmount', () => {
    const { container, unmount } = render(<Slider min={0} max={100} value={40} />)
    const target = container.querySelector('.noUi-target') as HTMLElement & { noUiSlider?: unknown }

    unmount()

    expect(target.noUiSlider).toBeUndefined()
  })

  it('brings nouislider\'s stylesheet into the page with the first slider', () => {
    render(<Slider min={0} max={100} value={1} />)

    // (Vitest does not process CSS, so the sheet itself is empty here)
    expect(document.head.querySelector('style#nouislider-styles')).not.toBeNull()
    // Loaded once, however many sliders there are
    render(<Slider min={0} max={100} value={2} />)
    expect(document.querySelectorAll('#nouislider-styles')).toHaveLength(1)
  })
})
