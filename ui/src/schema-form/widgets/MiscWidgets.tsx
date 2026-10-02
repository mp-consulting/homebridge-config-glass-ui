/* eslint-disable react/dom-no-dangerously-set-innerhtml */
/**
 * Ports of formworks' AddReferenceComponent (array "Add" button, patched for
 * `options.buttonText`), ButtonComponent, SubmitComponent, MessageComponent,
 * NoneComponent, FileComponent and TemplateComponent (@ng-formworks/core
 * 21.7.0).
 *
 * Copyright (c) 2014-2016 David Schnell-Davis 2018 Hamza Hamidi 2023 Zaheer M
 * (MIT License, see engine/json-schema-form.service.ts).
 */
import type { WidgetProps } from './context'

import { useEffect } from 'react'

import { hasOwn } from '../engine/utility.functions'
import { useJsfContext } from './context'
import { guard, useOnDestroy, useWidgetCtx } from './hooks'
import { cx, safeHtml } from './html'

export function AddReferenceWidget(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.options = ctx.layoutNode().options || {}
  })
  const { options } = ctx
  const layoutIndex = props.layoutIndex
  const showAddButton = !props.layoutNode.arrayItem
    || layoutIndex[layoutIndex.length - 1] < options.maxItems

  const buttonText = () => {
    const parent = {
      dataIndex: props.dataIndex.slice(0, -1),
      layoutIndex: layoutIndex.slice(0, -1),
      layoutNode: jsf.getParentNode(ctx),
    }
    return parent.layoutNode && (parent.layoutNode.add
      || jsf.setArrayItemTitle(parent, props.layoutNode, ctx.itemCount))
  }

  return (
    <add-reference-widget>
      <section className={cx(options?.htmlClass || '')} {...{ align: 'end' }}>
        {showAddButton && (
          <button
            className={cx(options?.fieldHtmlClass || '')}
            disabled={!!options?.readonly}
            onClick={guard((event) => {
              event.preventDefault()
              jsf.addItem(ctx)
              refresh()
            })}
          >
            {options?.icon && <span className={cx(options?.icon)} />}
            {options?.title && <span dangerouslySetInnerHTML={safeHtml(buttonText())} />}
          </button>
        )}
      </section>
    </add-reference-widget>
  )
}

export function ButtonWidget(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.controlDisabled = false
    ctx.boundControl = false
    ctx.options = ctx.layoutNode().options || {}
    jsf.initializeControl(ctx)
  })
  useOnDestroy(() => {
    jsf.updateValue(ctx, null)
  })
  const { options } = ctx
  const layoutNode = props.layoutNode
  return (
    <button-widget>
      <div className={cx(options?.htmlClass || '')}>
        <button
          {...{ readonly: options?.readonly ? 'readonly' : undefined }}
          aria-describedby={`control${layoutNode?._id}Status`}
          className={cx(options?.fieldHtmlClass || '')}
          disabled={!!ctx.controlDisabled}
          name={ctx.controlName ?? undefined}
          type={layoutNode?.type}
          value={ctx.controlValue ?? ''}
          onClick={guard((event) => {
            if (typeof options.onClick === 'function') {
              options.onClick(event)
            } else {
              jsf.updateValue(ctx, (event.target as HTMLButtonElement).value)
            }
            refresh()
          })}
        >
          {(options?.icon || options?.title) && (
            <span className={cx(options?.icon)} dangerouslySetInnerHTML={safeHtml(options?.title)} />
          )}
        </button>
      </div>
    </button-widget>
  )
}

export function SubmitWidget(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.controlDisabled = false
    ctx.boundControl = false
    ctx.options = ctx.layoutNode().options || {}
    jsf.initializeControl(ctx)
    if (hasOwn(ctx.options, 'disabled')) {
      ctx.controlDisabled = ctx.options.disabled
    } else if (jsf.formOptions.disableInvalidSubmit) {
      ctx.controlDisabled = !jsf.isValid
      ctx.followValidity = true
    }
    ctx.controlValue ??= ctx.options.title
  })
  useEffect(() => {
    if (!ctx.followValidity) {
      return
    }
    const subscription = jsf.isValidChanges.subscribe((isValid: boolean) => {
      ctx.controlDisabled = !isValid
      refresh()
    })
    return () => subscription.unsubscribe()
  }, [ctx, jsf, refresh])
  const updateValue = (event: any) => {
    if (typeof ctx.options.onClick === 'function') {
      ctx.options.onClick(event)
    } else {
      jsf.updateValue(ctx, event.target.value)
    }
  }
  useOnDestroy(() => updateValue({ target: { value: null } }))
  const { options } = ctx
  const layoutNode = props.layoutNode
  const id = `control${layoutNode?._id}`
  return (
    <submit-widget>
      <div className={cx(options?.htmlClass || '')}>
        <input
          aria-describedby={`${id}Status`}
          readOnly={!!options?.readonly}
          required={options?.required != null}
          className={cx(options?.fieldHtmlClass || '')}
          disabled={!!ctx.controlDisabled}
          id={id}
          name={ctx.controlName ?? undefined}
          type={layoutNode?.type}
          value={ctx.controlValue ?? ''}
          onClick={guard((event) => {
            updateValue(event)
            refresh()
          })}
        />
      </div>
    </submit-widget>
  )
}

export function MessageWidget(props: WidgetProps) {
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.options = ctx.layoutNode().options || {}
    ctx.message = ctx.options.help || ctx.options.helpvalue
      || ctx.options.msg || ctx.options.message
  })
  return (
    <message-widget>
      {ctx.message && (
        <span className={cx(ctx.options?.labelHtmlClass || '')} dangerouslySetInnerHTML={safeHtml(ctx.message)} />
      )}
    </message-widget>
  )
}

export function NoneWidget() {
  return <none-widget />
}

export function FileWidget(props: WidgetProps) {
  const { jsf } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.controlDisabled = false
    ctx.boundControl = false
    ctx.options = ctx.layoutNode().options || {}
    jsf.initializeControl(ctx)
  })
  useOnDestroy(() => {
    jsf.updateValue(ctx, null)
  })
  return <file-widget />
}

/**
 * TemplateComponent instantiates an Angular component given in
 * `options.template`. That cannot exist in a plugin's JSON schema, so this
 * renders the empty host only.
 */
export function TemplateWidget() {
  return (
    <template-widget>
      <div />
    </template-widget>
  )
}
