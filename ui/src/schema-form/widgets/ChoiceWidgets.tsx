/* eslint-disable react/dom-no-dangerously-set-innerhtml */
/**
 * Ports of formworks' CheckboxComponent, CheckboxesComponent, RadiosComponent
 * and SelectComponent (@ng-formworks/core 21.7.0, as patched by
 * ui/patches/@ng-formworks+core+21.7.0.patch: `hb-uix-switch` labels with a
 * `hb-uix-slider hb-uix-round` span, checkbox ids, and the select's `'null'`
 * → null fix). The checkbox/radio accessibility fixes of the Angular
 * jsfPatch directive are applied in the markup directly.
 *
 * Copyright (c) 2014-2016 David Schnell-Davis 2018 Hamza Hamidi 2023 Zaheer M
 * (MIT License, see engine/json-schema-form.service.ts).
 */
import type { WidgetProps } from './context'

import { useLayoutEffect, useMemo, useRef } from 'react'

import { cx } from '@/core/utilities/cx'

import { buildTitleMap } from '../engine/layout.functions'
import { isArray } from '../engine/utility.functions'
import { getLabelText } from './a11y'
import { useJsfContext } from './context'
import { buildOptionValueString, guard, ngStatusClasses, useBasicControlName, useDomProperty, useFormControlBinding, useOnDestroy, useWidgetCtx } from './hooks'
import { htmlToText, safeHtml } from './html'
import { WidgetLabel } from './InputWidgets'

/**
 * The jsfPatch treatment of a checkbox/radio wrapped in its label: the input
 * is named after the label text, and a sibling repeating that text is hidden
 * from the accessibility tree (so a switch is not read out twice).
 */
function choiceA11y(labelHtml: unknown) {
  const text = htmlToText(labelHtml)
  const labelText = getLabelText({ textContent: text } as Element)
  if (!labelText) {
    return { input: {}, text: {}, decorative: {} }
  }
  const hidden = { 'aria-hidden': 'true' as const, 'data-jsf-a11y-hidden': 'true' }
  return {
    input: { 'aria-label': labelText, 'data-jsf-a11y-processed': 'true' },
    text: text.trim() === labelText ? hidden : {},
    decorative: hidden,
  }
}

export function CheckboxWidget(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.controlDisabled = false
    ctx.boundControl = false
    ctx.trueValue = true
    ctx.falseValue = false
    ctx.options = ctx.layoutNode().options || {}
    jsf.initializeControl(ctx)
  })
  // The rest of ngOnInit: an unset checkbox is written as `false`
  useLayoutEffect(() => {
    if (ctx.controlValue === null || ctx.controlValue === undefined) {
      ctx.controlValue = false
      jsf.updateValue(ctx, ctx.falseValue)
      refresh()
    }
  }, [ctx, jsf, refresh])
  useOnDestroy(() => {
    jsf.updateValue(ctx, null)
  })
  const ref = useRef<HTMLInputElement>(null)
  const bound = !!ctx.boundControl
  useFormControlBinding(ref, bound ? ctx.formControl : null, 'checkbox')
  const isChecked = jsf.getFormControlValue(ctx) === ctx.trueValue
  useDomProperty(ref, 'checked', isChecked, !bound)

  const { options } = ctx
  const layoutNode = props.layoutNode
  const id = `control${layoutNode?._id}`
  const a11y = choiceA11y(options?.title)
  const className = cx(
    (options?.fieldHtmlClass || '') + (isChecked
      ? (` ${options?.activeClass || ''} ${options?.style?.selected || ''}`)
      : (` ${options?.style?.unselected || ''}`)),
    bound && ngStatusClasses(ctx.formControl),
  )
  return (
    <checkbox-widget>
      <label htmlFor={id} className={cx(options?.itemLabelHtmlClass || 'hb-uix-switch')}>
        <input
          key={bound ? 'bound' : 'unbound'}
          ref={ref}
          aria-describedby={`${id}Status`}
          className={className}
          disabled={bound ? undefined : ctx.controlDisabled}
          id={id}
          name={ctx.controlName ?? undefined}
          readOnly={!!options?.readonly}
          type="checkbox"
          onChange={bound
            ? undefined
            : guard((event) => {
                event.preventDefault()
                jsf.updateValue(ctx, event.target.checked ? ctx.trueValue : ctx.falseValue)
                refresh()
              })}
          {...a11y.input}
        />
        {options?.title && (
          <span
            style={{ display: options?.notitle ? 'none' : undefined }}
            dangerouslySetInnerHTML={safeHtml(options?.title)}
            {...a11y.text}
          />
        )}
        <span className="hb-uix-slider hb-uix-round" {...a11y.decorative} />
      </label>
    </checkbox-widget>
  )
}

function CheckboxItem({ ctx, item, onChange }: { ctx: any, item: any, onChange: (event: any) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useDomProperty(ref, 'checked', !!item.checked)
  const { options } = ctx
  const id = `control${ctx.layoutNode()?._id}/${item.value}`
  const a11y = choiceA11y(item?.name)
  return (
    <label
      htmlFor={id}
      className={cx((options?.itemLabelHtmlClass || 'hb-uix-switch') + (item.checked
        ? (` ${options?.activeClass || ''} ${options?.style?.selected || ''}`)
        : (` ${options?.style?.unselected || 'hb-uix-switch'}`)))}
    >
      <input
        ref={ref}
        type="checkbox"
        required={options?.required != null}
        className={cx(options?.fieldHtmlClass || '')}
        disabled={ctx.controlDisabled}
        id={id}
        name={item?.name}
        readOnly={!!options?.readonly}
        value={item.value}
        onChange={onChange}
        {...a11y.input}
      />
      <span dangerouslySetInnerHTML={safeHtml(item?.name)} {...a11y.text} />
      <span className="hb-uix-slider hb-uix-round" {...a11y.decorative} />
    </label>
  )
}

export function CheckboxesWidget(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.controlDisabled = false
    ctx.boundControl = false
    ctx.checkboxList = []
    ctx.options = ctx.layoutNode().options || {}
    const layoutNode = ctx.layoutNode()
    ctx.layoutOrientation = (layoutNode.type === 'checkboxes-inline'
      || layoutNode.type === 'checkboxbuttons')
      ? 'horizontal'
      : 'vertical'
    jsf.initializeControl(ctx)
    ctx.checkboxList = buildTitleMap(ctx.options.titleMap || ctx.options.enumNames, ctx.options.enum, true)
    if (ctx.boundControl) {
      const formArray = jsf.getFormControl(ctx)
      ctx.checkboxList.forEach((checkboxItem: any) => checkboxItem.checked = formArray.value.includes(checkboxItem.value))
    }
  })
  useOnDestroy(() => {
    ctx.formControl?.reset([])
    ctx.controlValue = null
  })
  const updateValue = guard((event: any) => {
    for (const checkboxItem of ctx.checkboxList) {
      if (event.target.value === checkboxItem.value) {
        checkboxItem.checked = event.target.checked
      }
    }
    if (ctx.boundControl) {
      jsf.updateArrayCheckboxList(ctx, ctx.checkboxList)
    }
    refresh()
  })
  const { options } = ctx
  return (
    <checkboxes-widget>
      {options?.title && (
        <label
          className={cx(options?.labelHtmlClass || '')}
          style={{ display: options?.notitle ? 'none' : undefined }}
          dangerouslySetInnerHTML={safeHtml(options?.title)}
        />
      )}
      {ctx.layoutOrientation === 'horizontal' && (
        <div className={cx(options?.htmlClass || '')}>
          {ctx.checkboxList.map((item: any, i: number) => (
            // eslint-disable-next-line react/no-array-index-key
            <CheckboxItem key={i} ctx={ctx} item={item} onChange={updateValue} />
          ))}
        </div>
      )}
      {ctx.layoutOrientation === 'vertical' && (
        <div>
          {ctx.checkboxList.map((item: any, i: number) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className={cx(options?.htmlClass || '')}>
              <CheckboxItem ctx={ctx} item={item} onChange={updateValue} />
            </div>
          ))}
        </div>
      )}
    </checkboxes-widget>
  )
}

function RadioItem({ ctx, item, onChange }: { ctx: any, item: any, onChange: (event: any) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useDomProperty(ref, 'checked', item?.value === ctx.controlValue)
  const { options } = ctx
  const layoutNode = ctx.layoutNode()
  const id = `control${layoutNode?._id}/${item?.value}`
  const a11y = choiceA11y(item?.name)
  return (
    <label
      htmlFor={id}
      className={cx((options?.itemLabelHtmlClass || '')
        + ((`${ctx.controlValue}` === `${item?.value}`)
          ? (` ${options?.activeClass || ''} ${options?.style?.selected || ''}`)
          : (` ${options?.style?.unselected || 'hb-uix-switch'}`)))}
    >
      <input
        ref={ref}
        type="radio"
        aria-describedby={`control${layoutNode?._id}Status`}
        {...{ readOnly: options?.readonly ? true : undefined }}
        required={options?.required != null}
        className={cx(options?.fieldHtmlClass || '')}
        disabled={ctx.controlDisabled}
        id={id}
        name={ctx.controlName ?? undefined}
        value={item?.value}
        onChange={onChange}
        {...a11y.input}
      />
      <span dangerouslySetInnerHTML={safeHtml(item?.name)} {...a11y.text} />
    </label>
  )
}

export function RadiosWidget(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.controlDisabled = false
    ctx.boundControl = false
    ctx.layoutOrientation = 'vertical'
    ctx.radiosList = []
    ctx.options = ctx.layoutNode().options || {}
    const layoutNode = ctx.layoutNode()
    if (layoutNode.type === 'radios-inline'
      || layoutNode.type === 'radiobuttons') {
      ctx.layoutOrientation = 'horizontal'
    }
    ctx.radiosList = buildTitleMap(ctx.options.titleMap || ctx.options.enumNames, ctx.options.enum, true)
    jsf.initializeControl(ctx)
  })
  useOnDestroy(() => {
    jsf.updateValue(ctx, null)
  })
  const updateValue = guard((event: any) => {
    jsf.updateValue(ctx, event.target.value)
    refresh()
  })
  const { options } = ctx
  const layoutNode = props.layoutNode
  return (
    <radios-widget>
      {options?.title && (
        <label
          htmlFor={`control${layoutNode?._id}`}
          className={cx(options?.labelHtmlClass || '')}
          style={{ display: options?.notitle ? 'none' : undefined }}
          dangerouslySetInnerHTML={safeHtml(options?.title)}
        />
      )}
      {ctx.layoutOrientation === 'horizontal' && (
        <div className={cx(options?.htmlClass || '')}>
          {ctx.radiosList.map((item: any, i: number) => (
            // eslint-disable-next-line react/no-array-index-key
            <RadioItem key={i} ctx={ctx} item={item} onChange={updateValue} />
          ))}
        </div>
      )}
      {ctx.layoutOrientation !== 'horizontal' && (
        <div>
          {ctx.radiosList.map((item: any, i: number) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className={cx(options?.htmlClass || '')}>
              <RadioItem ctx={ctx} item={item} onChange={updateValue} />
            </div>
          ))}
        </div>
      )}
    </radios-widget>
  )
}

interface SelectOptionEntry {
  id: string
  item: any
}

/** `<option [ngValue]>` ids are handed out in creation order, per select */
function useSelectOptions(selectList: any[]) {
  return useMemo(() => {
    const map = new Map<string, any>()
    let counter = 0
    const entries = selectList.map((selectItem: any) => {
      if (!isArray(selectItem?.items)) {
        const id = String(counter++)
        map.set(id, selectItem?.value)
        return { id, item: selectItem }
      }
      return {
        group: selectItem,
        items: selectItem.items.map((subItem: any) => {
          const id = String(counter++)
          map.set(id, subItem?.value)
          return { id, item: subItem } as SelectOptionEntry
        }),
      }
    })
    return { map, entries }
  }, [selectList])
}

function SelectOptions({ entries }: { entries: any[] }) {
  return (
    <>
      {entries.map((entry: any, i: number) => entry.group
        ? (
            // eslint-disable-next-line react/no-array-index-key
            <optgroup key={i} label={entry.group?.group}>
              {entry.items.map(({ id, item }: SelectOptionEntry) => (
                <option key={id} value={buildOptionValueString(id, item?.value)}>{htmlToText(item?.name)}</option>
              ))}
            </optgroup>
          )
        : <option key={entry.id} value={buildOptionValueString(entry.id, entry.item?.value)}>{htmlToText(entry.item?.name)}</option>)}
    </>
  )
}

export function SelectWidget(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.controlDisabled = false
    ctx.boundControl = false
    ctx.options = ctx.layoutNode().options || {}
    ctx.selectList = buildTitleMap(ctx.options.titleMap || ctx.options.enumNames, ctx.options.enum, !!ctx.options.required, !!ctx.options.flatList)
    // the selectListFlatGroup array will be used to update the formArray values
    // while the selectList array will be bound to the form select
    // as either a grouped select or a flat select
    ctx.selectListFlatGroup = buildTitleMap(ctx.options.titleMap || ctx.options.enumNames, ctx.options.enum, !!ctx.options.required, true)
    jsf.initializeControl(ctx)
  })
  const formControl = ctx.formControl
  useLayoutEffect(() => {
    if (!formControl) {
      return
    }
    const subscription = formControl.valueChanges.subscribe((change: any) => {
      if (change === 'null') {
        formControl.setValue(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [formControl])
  useOnDestroy(() => {
    const nullVal = ctx.options.multiple ? [null] : null
    ctx.formControl?.reset(nullVal)
    ctx.controlValue = null
  })
  const updateValue = () => {
    ctx.options.showErrors = true
    if (ctx.options.multiple) {
      if (ctx.controlValue?.includes(null)) {
        ctx.selectListFlatGroup.forEach((selItem: any) => {
          selItem.checked = false
        })
        jsf.updateArrayMultiSelectList(ctx, [])
      } else {
        ctx.selectListFlatGroup.forEach((selItem: any) => {
          selItem.checked = ctx.controlValue?.indexOf(selItem.value) >= 0
        })
        jsf.updateArrayMultiSelectList(ctx, ctx.selectListFlatGroup)
      }
      refresh()
      return
    }
    jsf.updateValue(ctx, ctx.controlValue)
    refresh()
  }

  const { map, entries } = useSelectOptions(ctx.selectList)
  const ref = useRef<HTMLSelectElement>(null)
  const bound = !!ctx.boundControl
  const multiple = !!ctx.options?.multiple
  useFormControlBinding(ref, bound && !multiple ? ctx.formControl : null, 'select', { map })
  useBasicControlName(ref)
  // Unbound / multiple selects: `[selected]` on the options, `[(ngModel)]` for multiple
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || (bound && !multiple)) {
      return
    }
    for (const option of Array.from(el.options)) {
      const value = map.get(option.value.split(':')[0])
      option.selected = multiple && isArray(ctx.controlValue)
        ? ctx.controlValue.includes(value)
        : value === ctx.controlValue
    }
  })

  const { options } = ctx
  const layoutNode = props.layoutNode
  const id = `control${layoutNode?._id}`
  return (
    <select-widget>
      <div className={cx(options?.htmlClass || '')}>
        <WidgetLabel options={options} layoutNode={layoutNode} />
        <select
          key={bound ? (multiple ? 'multiple' : 'bound') : 'unbound'}
          ref={ref}
          aria-describedby={`${id}Status`}
          {...{ readonly: options?.readonly ? 'readonly' : undefined }}
          required={options?.required != null}
          className={cx(options?.fieldHtmlClass || '', bound && !multiple && ngStatusClasses(ctx.formControl))}
          disabled={bound && !multiple ? undefined : ctx.controlDisabled}
          id={id}
          multiple={bound && multiple ? true : undefined}
          name={ctx.controlName ?? undefined}
          onChange={bound && !multiple
            ? undefined
            : guard((event) => {
                // `[(ngModel)]="controlValue"` on the multiple select. The
                // unbound single select has no model binding, so (as in
                // formworks) its updateValue() writes the unchanged controlValue.
                if (multiple) {
                  ctx.controlValue = Array.from(event.target.selectedOptions).map(option => map.has(option.value.split(':')[0]) ? map.get(option.value.split(':')[0]) : option.value)
                }
                updateValue()
              })}
        >
          <SelectOptions entries={entries} />
        </select>
      </div>
    </select-widget>
  )
}
