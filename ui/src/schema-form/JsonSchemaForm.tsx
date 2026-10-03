/**
 * The React counterpart of formworks' `<json-schema-form>` component: owns
 * the vendored engine (`JsonSchemaFormController` + `JsonSchemaFormService`)
 * and renders its layout with the Bootstrap 5 widget set.
 *
 * Re-rendering follows Angular's change detection loosely but safely: the
 * whole form re-renders after any widget event, any form status change and
 * every (debounced) data change. The widgets read the engine's mutable state
 * during render, as the Angular templates did.
 */
import { startTransition, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { installFixArrays } from './engine/fix-arrays'
import { FrameworkLibrary, JsonSchemaFormController } from './engine/json-schema-form.controller'
import { cssFrameworkCfgBootstrap5 } from './widgets/bootstrap5-config'
import { Bootstrap5Framework } from './widgets/Bootstrap5Framework'
import { JsfContext } from './widgets/context'
import { RootWidget } from './widgets/RootWidget'
import { WidgetLibraryService } from './widgets/widget-library'

import './widgets/custom-elements'
import './schema-form.scss'

export interface JsonSchemaFormProps {
  schema?: any
  layout?: any
  data?: any
  options?: any
  form?: any
  UISchema?: any
  language?: string
  /** The jsfPatch directive's `fixArrays` layout repair */
  fixArrays?: boolean
  className?: string
  /** formworks' `(onChanges)`: live, unvalidated form data */
  onChanges?: (data: any) => void
  /** formworks' `(isValid)` */
  onIsValid?: (isValid: boolean) => void
  /** formworks' `(validationErrors)` */
  onValidationErrors?: (errors: any) => void
}

const INPUT_NAMES = ['schema', 'layout', 'data', 'options', 'form', 'UISchema', 'language'] as const

export function JsonSchemaForm(props: JsonSchemaFormProps) {
  const [tick, setTick] = useState(0)
  const [activated, setActivated] = useState(false)
  const refreshQueuedRef = useRef(false)
  const unmountedRef = useRef(false)
  // Coalesce refresh requests into one render, and never update state while
  // React is rendering (widgets call into the engine during render).
  //
  // The re-render is a transition: every keystroke asks for one (the input
  // event, the status change it causes, and the debounced data change after
  // it), and on a big form a whole-form render takes long enough to make
  // typing lag. As a transition it is interruptible - a keystroke arriving
  // mid-render is handled first and the render starts over with the newer
  // state, so a burst of typing renders once when it pauses. The DOM inputs
  // are uncontrolled (written by the form-control binding), so what is typed
  // never waits on this render.
  const refresh = useCallback(() => {
    if (refreshQueuedRef.current) {
      return
    }
    refreshQueuedRef.current = true
    queueMicrotask(() => {
      refreshQueuedRef.current = false
      if (!unmountedRef.current) {
        // Runs in a microtask, not during the effect that may have queued it
        // eslint-disable-next-line react/set-state-in-effect
        startTransition(() => setTick(t => t + 1))
      }
    })
  }, [])

  const propsRef = useRef(props)
  propsRef.current = props

  const controllerRef = useRef<any>(null)
  if (controllerRef.current === null) {
    const widgetLibrary = new WidgetLibraryService()
    const framework = { name: cssFrameworkCfgBootstrap5.name, text: cssFrameworkCfgBootstrap5.text, framework: Bootstrap5Framework, config: cssFrameworkCfgBootstrap5 }
    const controller: any = new JsonSchemaFormController(new FrameworkLibrary(framework, widgetLibrary), widgetLibrary, {
      onChanges: (data: any) => propsRef.current.onChanges?.(data),
      isValid: (isValid: boolean) => propsRef.current.onIsValid?.(isValid),
      validationErrors: (errors: any) => propsRef.current.onValidationErrors?.(errors),
      markForCheck: () => refresh(),
      activated: () => refresh(),
    })
    installFixArrays(controller.jsf, () => !!propsRef.current.fixArrays)
    controllerRef.current = controller
  }
  const controller = controllerRef.current

  // ngOnChanges / ngOnInit: hand the inputs to the engine. On the first pass
  // Angular runs `updateForm()` twice (ngOnChanges, then ngOnInit), which
  // initialises the form twice - the second time from the data the first one
  // already emitted. That is reproduced so the output matches.
  const lastInputsRef = useRef<Record<string, unknown> | null>(null)
  const { schema, layout, data, options, form, UISchema, language } = props
  useLayoutEffect(() => {
    const inputs: Record<string, unknown> = { schema, layout, data, options, form, UISchema, language, framework: 'bootstrap-5' }
    const previous = lastInputsRef.current
    if (previous && INPUT_NAMES.every(name => previous[name] === inputs[name])) {
      return
    }
    lastInputsRef.current = inputs
    controller.setInputs(inputs)
    if (!previous) {
      controller.updateForm()
      controller.updateForm()
      // Render the built form before the browser paints

      setActivated(true)
    } else {
      controller.updateForm()
    }
    refresh()
  }, [controller, refresh, schema, layout, data, options, form, UISchema, language])

  // RootComponent re-renders on every (debounced) data change, which is when
  // conditions are re-evaluated against the new data
  useLayoutEffect(() => {
    const subscription = controller.jsf.dataChanges.subscribe(() => refresh())
    return () => subscription.unsubscribe()
  }, [controller, refresh])

  // Deferred so React StrictMode's simulated unmount (development only) does
  // not tear the engine down for good.
  useLayoutEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      queueMicrotask(() => {
        if (unmountedRef.current) {
          controller.destroy()
        }
      })
    }
  }, [controller])

  const contextValue = useMemo(() => ({ jsf: controller.jsf, refresh, tick }), [controller, refresh, tick])
  const jsf = controller.jsf

  return (
    <json-schema-form framework="bootstrap-5" className={props.className}>
      <form
        autoComplete={jsf?.formOptions?.autocomplete ? 'on' : 'off'}
        className="json-schema-form ng-untouched ng-pristine ng-valid"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          controller.submitForm()
        }}
      >
        <JsfContext value={contextValue}>
          {activated && jsf.formGroup && <RootWidget layout={jsf.layout} />}
        </JsfContext>
      </form>
    </json-schema-form>
  )
}
