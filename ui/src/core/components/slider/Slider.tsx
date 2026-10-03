import type { API, Options } from 'nouislider'

import { create } from 'nouislider'
import nouisliderCss from 'nouislider/dist/nouislider.min.css?inline'
import { useEffect, useRef } from 'react'

import { cx } from '@/core/utilities/cx'

import './slider.scss'

/**
 * nouislider's stylesheet, loaded with the first slider (the accessory manage
 * modals) rather than with the global styles. It goes in ahead of the app's
 * stylesheets, where `styles.scss` used to import it, so the app's
 * equal-specificity overrides (`.noUi-handle` in base/layout.scss) still win.
 */
function installNouisliderStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('nouislider-styles')) {
    return
  }
  const style = document.createElement('style')
  style.id = 'nouislider-styles'
  style.textContent = nouisliderCss
  document.head.insertBefore(style, document.head.querySelector('link[rel="stylesheet"], style'))
}

installNouisliderStyles()

export type SliderValue = number | number[]

export interface SliderProps {
  min: number
  max: number
  step?: number
  /** The model value. The slider is only created once this is a number (or numbers). */
  value: SliderValue | null | undefined
  /** Called with the new value when the user moves the slider (ngModelChange). */
  onChange?: (value: SliderValue) => void
  disabled?: boolean
  /** Classes for the host element, next to `ng2-nouislider`. */
  className?: string
  /** Any other noUiSlider option, applied when the slider is created. */
  options?: Partial<Options>
}

// ng2-nouislider's DefaultFormatter: two decimals at most, no trailing zeros.
const defaultFormatter = {
  to: (value: number) => String(Number.parseFloat(Number.parseFloat(String(value)).toFixed(2))),
  from: (value: string) => Number.parseFloat(value),
}

function toValues(values: (number | string)[]): SliderValue {
  const v = values.map(value => defaultFormatter.from(String(value)))
  return v.length === 1 ? v[0] : v
}

function isValue(value: SliderValue | null | undefined): value is SliderValue {
  return typeof value === 'number' || Array.isArray(value)
}

/**
 * A noUiSlider, as the `<nouislider [min] [max] [step] [(ngModel)]>` of
 * ng2-nouislider rendered it: a `.ng2-nouislider` host with the slider on an
 * inner div, which carries `disabled="true"` while disabled (the theme's
 * `.noUi-target:not([disabled='true'])` styles and noUiSlider itself read it).
 *
 * `onChange` fires when the user sets or slides to a different value, with the
 * value parsed back to a number.
 */
export function Slider({ min, max, step, value, onChange, disabled, className, options }: SliderProps) {
  const targetRef = useRef<HTMLDivElement>(null)
  const sliderRef = useRef<API | null>(null)
  // The last value the slider reported or was given, to tell real changes apart
  const valueRef = useRef<SliderValue | undefined>(undefined)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const initialRef = useRef({ options })
  const appliedRef = useRef<{ min: number, max: number, step?: number }>({ min, max, step })

  // Created on the first real value, like the ngModel writeValue that created
  // it. Checked on every render; the slider then lives until unmount
  useEffect(() => {
    if (sliderRef.current || !targetRef.current || !isValue(value)) {
      return
    }
    const initial = initialRef.current
    valueRef.current = Array.isArray(value) ? [...value] : value
    appliedRef.current = { min, max, step }
    const slider = create(targetRef.current, {
      ...initial.options,
      start: value,
      step,
      range: { min, max },
      format: defaultFormatter,
    })
    sliderRef.current = slider

    const handler = (values: (number | string)[], handle: number) => {
      const v = toValues(values)
      const current = valueRef.current
      const changed = Array.isArray(v)
        ? !Array.isArray(current) || current[handle] !== v[handle]
        : current !== v
      if (Array.isArray(v) && Array.isArray(current)) {
        current[handle] = v[handle]
      } else {
        valueRef.current = v
      }
      if (changed) {
        onChangeRef.current?.(v)
      }
    }
    slider.on('set', handler)
    slider.on('slide', handler)
  })

  useEffect(() => () => {
    sliderRef.current?.destroy()
    sliderRef.current = null
  }, [])

  useEffect(() => {
    const el = targetRef.current
    if (!el) {
      return
    }
    // As a string: the theme matches `[disabled='true']`, and React would
    // write a bare `disabled` for a boolean
    if (disabled) {
      el.setAttribute('disabled', 'true')
    } else {
      el.removeAttribute('disabled')
    }
  }, [disabled])

  // A new model value from outside. ⚠️ Recorded first, so the 'set' event it
  // causes does not come back out of onChange as if the user had moved it
  // (ng2-nouislider did echo it); a value the range clamps still does.
  useEffect(() => {
    const slider = sliderRef.current
    if (!slider || !isValue(value)) {
      return
    }
    const current = valueRef.current
    if (JSON.stringify(current) === JSON.stringify(value)) {
      return
    }
    valueRef.current = Array.isArray(value) ? [...value] : value
    slider.set(value)
  }, [value])

  useEffect(() => {
    const slider = sliderRef.current
    const applied = appliedRef.current
    if (!slider || (applied.min === min && applied.max === max && applied.step === step)) {
      return
    }
    appliedRef.current = { min, max, step }
    slider.updateOptions({ range: { min, max }, step }, true)
  }, [min, max, step])

  return (
    <div className={cx('ng2-nouislider', className)}>
      <div ref={targetRef} />
    </div>
  )
}
