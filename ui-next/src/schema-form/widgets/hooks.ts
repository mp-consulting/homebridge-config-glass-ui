// Widgets keep formworks' mutable "component instance" (`ctx`) model: the
// vendored engine reads and writes `ctx.options`, `ctx.formControl`,
// `ctx.controlValue`... directly, exactly as it did on the Angular components.
// The ctx lives in a ref and is read during render on purpose.
import type { RefObject } from 'react'

import type { WidgetProps } from './context'

import { useEffect, useLayoutEffect, useRef } from 'react'

import { labelBasicControl, labelDeleteButton } from './a11y'
import { useJsfContext } from './context'

/**
 * Run an event handler the way Angular's ErrorHandler would: an exception
 * from the engine (a schema it cannot handle) is logged and the form keeps
 * working, instead of escaping as an uncaught error.
 */
export function guard<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args)
    } catch (error) {
      console.error('ERROR', error)
    }
  }
}

export interface WidgetCtx {
  layoutNode: () => any
  layoutIndex: () => number[]
  dataIndex: () => number[]
  options?: any
  formControl?: any
  boundControl?: boolean
  controlName?: string | null
  controlValue?: any
  controlDisabled?: boolean
  [key: string]: any
}

/**
 * The widget's formworks "component instance". `init` is its `ngOnInit`: it
 * runs once, during the first render (Angular runs ngOnInit top-down before
 * the children are created, which is the order render gives us too).
 */
export function useWidgetCtx<T extends WidgetCtx = WidgetCtx>(props: WidgetProps, init?: (ctx: T) => void): T {
  const propsRef = useRef(props)
  propsRef.current = props
  const ref = useRef<T | null>(null)
  if (ref.current === null) {
    const ctx = {
      layoutNode: () => propsRef.current.layoutNode,
      layoutIndex: () => propsRef.current.layoutIndex,
      dataIndex: () => propsRef.current.dataIndex,
    } as T
    ref.current = ctx
    init?.(ctx)
  }
  return ref.current
}

/**
 * `ngOnDestroy`. Deferred by a microtask and skipped if the component was
 * mounted again in the meantime, so React StrictMode's simulated unmount in
 * development does not wipe values (several widgets null their control on
 * destroy, as formworks does).
 */
export function useOnDestroy(fn: () => void) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      queueMicrotask(() => {
        if (!mountedRef.current) {
          fnRef.current()
        }
      })
    }
  }, [])
}

/**
 * An Angular property binding (`[checked]="expr"`, `[value]="expr"`): the
 * DOM property is written when the expression's value changes, and left
 * alone otherwise - so a user's own interaction is not overwritten on every
 * render, which a React controlled input would do.
 */
export function useDomProperty(ref: RefObject<HTMLElement | null>, property: string, value: unknown, enabled = true) {
  useLayoutEffect(() => {
    if (enabled && ref.current) {
      (ref.current as any)[property] = value
    }
  }, [ref, property, value, enabled])
}

export type AccessorKind = 'default' | 'checkbox' | 'select'

export interface SelectOptionMap {
  /** option id (as used in the option's value attribute) -> ngValue */
  map: Map<string, any>
}

/** Angular's `_buildValueString` for `<option [ngValue]>` */
export function buildOptionValueString(id: string | null, value: any): string {
  if (id == null) {
    return `${value}`
  }
  if (value && typeof value === 'object') {
    value = 'Object'
  }
  return `${id}: ${value}`.slice(0, 50)
}

/**
 * `[formControl]` on an element: Angular's FormControlDirective plus the
 * value accessor the element gets (DefaultValueAccessor, CheckboxControlValueAccessor
 * or SelectControlValueAccessor with `[ngValue]` options).
 */
export function useFormControlBinding(
  ref: RefObject<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>,
  control: any,
  kind: AccessorKind,
  selectOptions?: SelectOptionMap,
) {
  const { refresh } = useJsfContext()
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const optionsRef = useRef(selectOptions)
  optionsRef.current = selectOptions

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !control) {
      return
    }
    const findOptionId = (value: any) => {
      for (const [id, optionValue] of optionsRef.current?.map ?? []) {
        if (Object.is(optionValue, value)) {
          return id
        }
      }
      return null
    }
    const writeValue = (value: any) => {
      if (kind === 'checkbox') {
        (el as HTMLInputElement).checked = value
      } else if (kind === 'select') {
        el.value = buildOptionValueString(findOptionId(value), value)
      } else {
        el.value = value ?? ''
      }
    }
    const readValue = () => {
      if (kind === 'checkbox') {
        return (el as HTMLInputElement).checked
      }
      if (kind === 'select') {
        const id = el.value.split(':')[0]
        const map = optionsRef.current?.map
        return map?.has(id) ? map.get(id) : el.value
      }
      return el.value
    }

    writeValue(control.value)
    el.disabled = !!control.disabled
    const unregisterChange = control.registerOnChange((value: any) => writeValue(value))
    const unregisterDisabled = control.registerOnDisabledChange((isDisabled: boolean) => {
      el.disabled = isDisabled
    })
    const onViewChange = guard(() => {
      control.markAsDirty()
      control.setValue(readValue(), { emitModelToViewChange: false })
      refreshRef.current()
    })
    const onBlur = guard(() => {
      control.markAsTouched()
      refreshRef.current()
    })
    const eventName = kind === 'default' ? 'input' : 'change'
    el.addEventListener(eventName, onViewChange)
    el.addEventListener('blur', onBlur)
    return () => {
      unregisterChange()
      unregisterDisabled()
      el.removeEventListener(eventName, onViewChange)
      el.removeEventListener('blur', onBlur)
    }
  }, [ref, control, kind])
}

/** NgControlStatus' host classes */
export function ngStatusClasses(control: any): Record<string, boolean> {
  if (!control) {
    return {}
  }
  return {
    'ng-untouched': control.untouched,
    'ng-touched': control.touched,
    'ng-pristine': control.pristine,
    'ng-dirty': control.dirty,
    'ng-valid': control.valid,
    'ng-invalid': control.invalid,
    'ng-pending': control.pending,
  }
}

function formRoot(el: HTMLElement): Document | Element {
  return el.closest('form') ?? el.ownerDocument
}

/** Give a text field / select / textarea its label as an accessible name */
export function useBasicControlName(ref: RefObject<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>) {
  useLayoutEffect(() => {
    if (ref.current) {
      labelBasicControl(ref.current, formRoot(ref.current))
    }
  })
}

/** Name an array item's delete button after the item */
export function useDeleteButtonName(ref: RefObject<HTMLButtonElement | null>) {
  useLayoutEffect(() => {
    if (ref.current) {
      labelDeleteButton(ref.current, (ref.current.closest('form') as HTMLElement | null) ?? ref.current.ownerDocument.body)
    }
  })
}
