/* eslint-disable react/dom-no-dangerously-set-innerhtml */
/**
 * Port of @ng-formworks/cssframework 21.7.0's CssFrameworkComponent (as
 * patched by ui/patches/@ng-formworks+cssframework+21.7.0.patch: no space
 * before the required asterisk, arrays keep their legend title), wrapped by
 * the Bootstrap 5 framework component. It decorates every widget with the
 * form-group / list-group classes, the label, the help block and the array
 * item's remove button.
 *
 * Copyright (c) 2014-2016 David Schnell-Davis 2018 Hamza Hamidi 2023 Zaheer M
 * (MIT License, see engine/json-schema-form.service.ts).
 */
import type { WidgetProps } from './context'
import type { WidgetCtx } from './hooks'

import { cloneDeep, isEmpty } from 'lodash-es'
import { useEffect, useLayoutEffect, useRef } from 'react'

import { addClasses, inArray } from '../engine/utility.functions'
import { cssFrameworkCfgBootstrap5, cssFrameworkDefaultStyling } from './bootstrap5-config'
import { useJsfContext } from './context'
import { guard, useDeleteButtonName, useWidgetCtx } from './hooks'
import { cx, safeHtml } from './html'
import { SelectWidgetWidget } from './SelectWidgetWidget'

const INPUT_WIDGETS = [
  'button',
  'checkbox',
  'checkboxes-inline',
  'checkboxes',
  'color',
  'date',
  'datetime-local',
  'datetime',
  'email',
  'file',
  'hidden',
  'image',
  'integer',
  'month',
  'number',
  'password',
  'radio',
  'radiobuttons',
  'radios-inline',
  'radios',
  'range',
  'reset',
  'search',
  'select',
  'submit',
  'tel',
  'text',
  'textarea',
  'time',
  'url',
  'week',
]

const NO_EARLY_TITLE_UPDATE = [
  '$ref',
  'advancedfieldset',
  'authfieldset',
  'button',
  'card',
  'checkbox',
  'expansion-panel',
  'help',
  'message',
  'msg',
  'section',
  'submit',
  'tabarray',
  'tabs',
]

interface CssFrameworkCtx extends WidgetCtx {
  widgetStyles: Record<string, any>
  theme: string
  widgetLayoutNode: any
  widgetOptions: any
  parentArray: any
  isOrderable: boolean
  isDynamicTitle: boolean
  dynamicTitle: any
  frameworkInitialized: boolean
}

function applyCssClasses(ctx: CssFrameworkCtx, type: string, widgetOptions: any, styleOptions: any) {
  let cssClasses = ctx.widgetStyles[type]
  if (!cssClasses || isEmpty(cssClasses)) {
    cssClasses = ctx.widgetStyles.default
  }
  Object.keys(cssClasses).forEach((catName) => {
    const classList = cssClasses[catName]
    if (classList.length) {
      widgetOptions[catName] = addClasses(widgetOptions[catName], classList)
    }
    if (styleOptions) {
      widgetOptions[catName] = addClasses(widgetOptions[catName], styleOptions)
    }
  })
}

function setTitle(ctx: CssFrameworkCtx, jsf: any) {
  switch (ctx.layoutNode().type) {
    case 'button':
    case 'checkbox':
    case 'section':
    case 'help':
    case 'msg':
    case 'submit':
    case 'message':
    case 'tabarray':
    case 'tabs':
    case '$ref':
      return null
    case 'advancedfieldset':
      ctx.widgetOptions.expandable = true
      ctx.widgetOptions.title = 'Advanced options'
      return null
    case 'authfieldset':
      ctx.widgetOptions.expandable = true
      ctx.widgetOptions.title = 'Authentication settings'
      return null
    case 'fieldset':
      ctx.widgetOptions.title = ctx.options.title
      return null
    case 'array':
      ctx.widgetOptions.title = ctx.options.title
      return null
    default:
      ctx.widgetOptions.title = null
      return jsf.setItemTitle(ctx)
  }
}

function updateTitle(ctx: CssFrameworkCtx, jsf: any) {
  const dataIndex = ctx.dataIndex()
  ctx.dynamicTitle = jsf.parseText(ctx.options?.title, jsf.getFormControlValue(ctx), jsf.getFormControlGroup(ctx)?.value, dataIndex[dataIndex.length - 1])
}

function updateHelpBlock(ctx: CssFrameworkCtx, jsf: any, status: string) {
  ctx.options.helpBlock = status === 'INVALID'
    && ctx.options.enableErrorState && ctx.formControl.errors
    && (ctx.formControl.dirty || ctx.options.feedbackOnRender)
    ? jsf.formatErrors(ctx.formControl.errors, ctx.options.validationMessages)
    : ctx.options.description || ctx.options.help || null
}

function initializeFramework(ctx: CssFrameworkCtx, jsf: any) {
  const layoutNode = ctx.layoutNode()
  if (!layoutNode) {
    return
  }
  ctx.options = cloneDeep(layoutNode.options)
  ctx.widgetLayoutNode = {
    ...layoutNode,
    options: cloneDeep(layoutNode.options),
  }
  ctx.widgetOptions = ctx.widgetLayoutNode.options
  ctx.formControl = jsf.getFormControl(ctx)
  ctx.options.isInputWidget = inArray(layoutNode.type, INPUT_WIDGETS)
  ctx.isDynamicTitle = ctx.options?.title && /\{\{.+?\}\}/.test(ctx.options.title)
  ctx.dynamicTitle = ctx.options?.title
  if (!NO_EARLY_TITLE_UPDATE.includes(layoutNode.type)
    && /\{\{.+?\}\}/.test(ctx.widgetOptions.title || '')) {
    updateTitle(ctx, jsf)
  }
  ctx.options.title = setTitle(ctx, jsf)
  if (ctx.widgetOptions.title) {
    ctx.dynamicTitle = ''
  }
  ctx.options.htmlClass = addClasses(ctx.options.htmlClass, `schema-form-${layoutNode.type}`)
  if (layoutNode.type === 'array') {
    ctx.options.htmlClass = addClasses(ctx.options.htmlClass, ctx.widgetStyles.__array__.htmlClass)
  } else if (layoutNode.arrayItem && layoutNode.type !== '$ref') {
    ctx.options.htmlClass = addClasses(ctx.options.htmlClass, ctx.widgetStyles.__array_item_nonref__.htmlClass)
  } else {
    ctx.options.htmlClass = addClasses(ctx.options.htmlClass, ctx.widgetStyles.__form_group__.htmlClass)
  }
  ctx.widgetOptions.htmlClass = ''
  ctx.options.labelHtmlClass = addClasses(ctx.options.labelHtmlClass, ctx.widgetStyles.__control_label__.labelHtmlClass)
  ctx.widgetOptions.activeClass = addClasses(ctx.widgetOptions.activeClass, ctx.widgetStyles.__active__.activeClass)
  ctx.options.fieldAddonLeft = ctx.options.fieldAddonLeft || ctx.options.prepend
  ctx.options.fieldAddonRight = ctx.options.fieldAddonRight || ctx.options.append
  // Add asterisk to titles if required
  if (ctx.options.title && layoutNode.type !== 'tab'
    && !ctx.options.notitle && ctx.options.required
    && !ctx.options.title.includes('*')) {
    const requiredAsteriskClass = ctx.widgetStyles.__required_asterisk__ || 'text-danger'
    ctx.options.title += `<strong class="${requiredAsteriskClass}">*</strong>`
  }
  if (layoutNode.type === 'optionfieldset') {
    ctx.options.messageLocation = 'top'
  }
  // Set miscelaneous styles and settings for each control type
  applyCssClasses(ctx, layoutNode.type, ctx.widgetOptions, ctx.options.style)
  if (ctx.formControl) {
    updateHelpBlock(ctx, jsf, ctx.formControl.status)
  }
  updateTitle(ctx, jsf)
  ctx.frameworkInitialized = true
}

function showRemoveButton(ctx: CssFrameworkCtx) {
  const layoutNode = ctx.layoutNode()
  if (!ctx.options.removable || ctx.options.readonly
    || layoutNode.type === '$ref') {
    return false
  }
  if (layoutNode.recursiveReference) {
    return true
  }
  if (!layoutNode.arrayItem || !ctx.parentArray) {
    return false
  }
  // If array length <= minItems, don't allow removing any items
  return ctx.parentArray.items.length - 1 <= ctx.parentArray.options.minItems
    ? false
    // For removable list items, allow removing any item
    : layoutNode.arrayItemType === 'list'
      ? true
      // For removable tuple items, only allow removing last item in list
      : ctx.layoutIndex()[ctx.layoutIndex().length - 1] === ctx.parentArray.items.length - 2
}

function RemoveButton({ className, screenReaderClass, onClick }: { className: string, screenReaderClass: string, onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  useDeleteButtonName(ref)
  return (
    <button ref={ref} className={cx(className)} type="button" onClick={onClick}>
      <span aria-hidden="true">&times;</span>
      <span className={cx(screenReaderClass)}>Close</span>
    </button>
  )
}

export function CssFramework(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx<CssFrameworkCtx>(props, (ctx) => {
    ctx.frameworkInitialized = false
    ctx.formControl = null
    ctx.parentArray = null
    ctx.isOrderable = false
    ctx.dynamicTitle = null
    ctx.widgetStyles = Object.assign({ ...cssFrameworkDefaultStyling }, cssFrameworkCfgBootstrap5.widgetstyles)
    ctx.theme = ctx.widgetStyles.__themes__[0].name
    // ngOnInit
    initializeFramework(ctx, jsf)
    const layoutNode = ctx.layoutNode()
    if (layoutNode.arrayItem && layoutNode.type !== '$ref') {
      ctx.parentArray = jsf.getParentNode(ctx)
      if (ctx.parentArray) {
        ctx.isOrderable = layoutNode.arrayItemType === 'list'
          && !ctx.options.readonly && ctx.parentArray.options.orderable
      }
    }
  })

  // Angular runs initializeFramework() a second time in ngOnInit, after the
  // child widget has been created and initialised (the theme subscription's
  // detectChanges() renders it first). Doing the same here picks up what the
  // children changed meanwhile - e.g. a title template that reads a control
  // the child replaced - and hands the widget a fresh layout-node copy.
  useLayoutEffect(() => {
    if (ctx.secondInit) {
      return
    }
    ctx.secondInit = true
    initializeFramework(ctx, jsf)
    refresh()
  }, [ctx, jsf, refresh])

  // The help block follows the control's status (an error once it is dirty)
  const formControl = ctx.formControl
  useEffect(() => {
    if (!formControl) {
      return
    }
    const subscription = formControl.statusChanges.subscribe((status: string) => updateHelpBlock(ctx, jsf, status))
    return () => subscription.unsubscribe()
  }, [ctx, jsf, formControl])

  // ngOnChanges: a dynamic (`{{ }}`) title is re-evaluated when the inputs change
  const inputsKey = `${props.layoutIndex?.join(',')}|${props.dataIndex?.join(',')}`
  const lastInputsRef = useRef(inputsKey)
  if (lastInputsRef.current !== inputsKey) {
    lastInputsRef.current = inputsKey
    if (ctx.isDynamicTitle) {
      updateTitle(ctx, jsf)
    }
  }

  const { options, widgetStyles, formControl: control } = ctx
  const layoutNode = props.layoutNode
  const feedbackShown = control?.dirty || options?.feedbackOnRender
  const helpBlock = options?.helpBlock
    ? <p className={cx(widgetStyles.__help_block__)} dangerouslySetInnerHTML={safeHtml(options.helpBlock)} />
    : null

  return (
    <css-framework>
      <div
        data-bs-theme={ctx.theme}
        data-theme={ctx.theme}
        className={cx(options?.htmlClass || '', {
          'has-feedback': options?.feedback && options?.isInputWidget && feedbackShown,
          'has-error': options?.enableErrorState && control?.errors && feedbackShown,
          'has-success': options?.enableSuccessState && !control?.errors && feedbackShown,
        })}
      >
        {showRemoveButton(ctx) && (
          <RemoveButton
            className={widgetStyles.__remove_item__}
            screenReaderClass={widgetStyles.__screen_reader__}
            onClick={guard(() => {
              jsf.removeItem(ctx)
              refresh()
            })}
          />
        )}
        {options?.messageLocation === 'top' && layoutNode?.type !== 'array' && <div>{helpBlock}</div>}
        {options?.title && layoutNode?.type !== 'tab' && (
          <label
            htmlFor={`control${layoutNode?._id}`}
            className={cx(options?.labelHtmlClass || '', { 'sr-only': options?.notitle })}
            dangerouslySetInnerHTML={safeHtml(ctx.dynamicTitle)}
          />
        )}
        {layoutNode?.type === 'submit' && jsf?.formOptions?.fieldsRequired && (
          <p>
            <strong className={cx(widgetStyles.__required_asterisk__)}>*</strong>
            {' '}
            = required fields
          </p>
        )}
        <div className={cx({ 'input-group': options?.fieldAddonLeft || options?.fieldAddonRight })}>
          {options?.fieldAddonLeft && (
            <span className={cx(widgetStyles.__field_addon_left__)} dangerouslySetInnerHTML={safeHtml(options.fieldAddonLeft)} />
          )}
          <SelectWidgetWidget layoutNode={ctx.widgetLayoutNode} dataIndex={props.dataIndex} layoutIndex={props.layoutIndex} />
          {options?.fieldAddonRight && (
            <span className={cx(widgetStyles.__field_addon_right__)} dangerouslySetInnerHTML={safeHtml(options.fieldAddonRight)} />
          )}
        </div>
        {options?.feedback && options?.isInputWidget
          && !options?.fieldAddonRight && !layoutNode.arrayItem
          && feedbackShown && (
          <span
            className={cx('form-control-feedback glyphicon', {
              'glyphicon-ok': options?.enableSuccessState && !control?.errors,
              'glyphicon-remove': options?.enableErrorState && control?.errors,
            })}
            aria-hidden="true"
          />
        )}
        {options?.messageLocation !== 'top' && layoutNode?.type !== 'array' && <div>{helpBlock}</div>}
      </div>
    </css-framework>
  )
}
