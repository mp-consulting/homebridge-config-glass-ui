/* eslint-disable react/dom-no-dangerously-set-innerhtml */
/**
 * Ports of formworks' InputComponent, NumberComponent and TextareaComponent
 * (@ng-formworks/core 21.7.0). Same markup and classes; the Angular
 * `[formControl]` binding is `useFormControlBinding`.
 *
 * Copyright (c) 2014-2016 David Schnell-Davis 2018 Hamza Hamidi 2023 Zaheer M
 * (MIT License, see engine/json-schema-form.service.ts).
 */
import type { WidgetProps } from './context'

import { useRef } from 'react'

import { cx } from '@/core/utilities/cx'

import { useJsfContext } from './context'
import { guard, ngStatusClasses, useBasicControlName, useDomProperty, useFormControlBinding, useOnDestroy, useWidgetCtx } from './hooks'
import { attr, safeHtml } from './html'

/** ElementAttributeDirective: `x-inputAttributes`, truthy values only */
function inputAttributes(options: any): Record<string, string> {
  const attributes = options?.['x-inputAttributes']
  const result: Record<string, string> = {}
  if (attributes && typeof attributes === 'object') {
    for (const [name, value] of Object.entries(attributes)) {
      if (value) {
        result[name] = String(value)
      }
    }
  }
  return result
}

function WidgetLabel({ options, layoutNode }: { options: any, layoutNode: any }) {
  if (!options?.title) {
    return null
  }
  return (
    <label
      htmlFor={`control${layoutNode?._id}`}
      className={cx(options?.labelHtmlClass || '')}
      style={{ display: options?.notitle ? 'none' : undefined }}
      dangerouslySetInnerHTML={safeHtml(options?.title)}
    />
  )
}

function useStandardControl(props: WidgetProps, kind: 'input' | 'number' | 'textarea') {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.controlDisabled = false
    ctx.boundControl = false
    ctx.options = ctx.layoutNode().options || {}
    jsf.initializeControl(ctx)
    if (kind === 'number' && ctx.layoutNode().dataType === 'integer') {
      ctx.allowDecimal = false
    }
  })
  // "needed to be done in timeout for when dynamic/condition based titles
  // depend on the formControls value but the formControl is also destroyed"
  useOnDestroy(() => {
    setTimeout(() => {
      jsf.updateValue(ctx, null)
    })
  })
  const onInput = guard((event: { target: EventTarget | null }) => {
    jsf.updateValue(ctx, (event.target as HTMLInputElement).value)
    refresh()
  })
  return { ctx, onInput }
}

export function InputWidget(props: WidgetProps) {
  const { ctx, onInput } = useStandardControl(props, 'input')
  const ref = useRef<HTMLInputElement>(null)
  const bound = !!ctx.boundControl
  useFormControlBinding(ref, bound ? ctx.formControl : null, 'default')
  useDomProperty(ref, 'value', ctx.controlValue, !bound)
  useBasicControlName(ref)
  const { options } = ctx
  const layoutNode = props.layoutNode
  const id = `control${layoutNode?._id}`
  return (
    <input-widget>
      <div className={cx(options?.htmlClass || '')}>
        <WidgetLabel options={options} layoutNode={layoutNode} />
        <input
          key={bound ? 'bound' : 'unbound'}
          ref={ref}
          aria-describedby={`${id}Status`}
          list={`${id}Autocomplete`}
          maxLength={attr(options?.maxLength) as any}
          minLength={attr(options?.minLength) as any}
          pattern={attr(options?.pattern)}
          placeholder={attr(options?.placeholder)}
          required={options?.required != null}
          className={cx(options?.fieldHtmlClass || '', bound && ngStatusClasses(ctx.formControl))}
          disabled={bound ? undefined : ctx.controlDisabled}
          id={id}
          name={ctx.controlName ?? undefined}
          readOnly={!!options?.readonly}
          type={layoutNode?.type}
          onInput={bound ? undefined : onInput}
          {...inputAttributes(options)}
        />
        {options?.typeahead?.source && (
          <datalist id={`${id}Autocomplete`}>
            {options.typeahead.source.map((word: any, i: number) => (
              // eslint-disable-next-line react/no-array-index-key
              <option key={i} value={word} />
            ))}
          </datalist>
        )}
      </div>
    </input-widget>
  )
}

export function NumberWidget(props: WidgetProps) {
  const { ctx, onInput } = useStandardControl(props, 'number')
  const ref = useRef<HTMLInputElement>(null)
  const bound = !!ctx.boundControl
  useFormControlBinding(ref, bound ? ctx.formControl : null, 'default')
  useDomProperty(ref, 'value', ctx.controlValue, !bound)
  useBasicControlName(ref)
  const { options } = ctx
  const layoutNode = props.layoutNode
  const id = `control${layoutNode?._id}`
  return (
    <number-widget>
      <div className={cx(options?.htmlClass || '')}>
        <WidgetLabel options={options} layoutNode={layoutNode} />
        <input
          key={bound ? 'bound' : 'unbound'}
          ref={ref}
          aria-describedby={`${id}Status`}
          max={attr(options?.maximum)}
          min={attr(options?.minimum)}
          placeholder={attr(options?.placeholder)}
          required={options?.required != null}
          step={String(options?.multipleOf || options?.step || 'any')}
          className={cx(options?.fieldHtmlClass || '', bound && ngStatusClasses(ctx.formControl))}
          disabled={bound ? undefined : ctx.controlDisabled}
          id={id}
          name={ctx.controlName ?? undefined}
          readOnly={!!options?.readonly}
          title=""
          type={layoutNode?.type === 'range' ? 'range' : 'number'}
          onInput={bound ? undefined : onInput}
          {...inputAttributes(options)}
        />
        {layoutNode?.type === 'range' && <span dangerouslySetInnerHTML={safeHtml(ctx.controlValue)} />}
      </div>
    </number-widget>
  )
}

export function TextareaWidget(props: WidgetProps) {
  const { ctx, onInput } = useStandardControl(props, 'textarea')
  const ref = useRef<HTMLTextAreaElement>(null)
  const bound = !!ctx.boundControl
  useFormControlBinding(ref, bound ? ctx.formControl : null, 'default')
  useDomProperty(ref, 'value', ctx.controlValue, !bound)
  useBasicControlName(ref)
  const { options } = ctx
  const layoutNode = props.layoutNode
  const id = `control${layoutNode?._id}`
  return (
    <textarea-widget>
      <div className={cx(options?.htmlClass || '')}>
        <WidgetLabel options={options} layoutNode={layoutNode} />
        <textarea
          key={bound ? 'bound' : 'unbound'}
          ref={ref}
          aria-describedby={`${id}Status`}
          maxLength={attr(options?.maxLength) as any}
          minLength={attr(options?.minLength) as any}
          {...{ pattern: attr(options?.pattern) }}
          placeholder={attr(options?.placeholder)}
          readOnly={!!options?.readonly}
          required={options?.required != null}
          className={cx(options?.fieldHtmlClass || '', bound && ngStatusClasses(ctx.formControl))}
          disabled={bound ? undefined : ctx.controlDisabled}
          id={id}
          name={ctx.controlName ?? undefined}
          onInput={bound ? undefined : onInput}
        />
      </div>
    </textarea-widget>
  )
}

export { WidgetLabel }
