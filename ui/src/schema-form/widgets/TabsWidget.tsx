/**
 * Ports of formworks' TabsComponent and OneOfComponent (@ng-formworks/core
 * 21.7.0). The class expressions are evaluated exactly as in the Angular
 * templates (including their `' ' + undefined` quirks) so the markup matches.
 *
 * Copyright (c) 2014-2016 David Schnell-Davis 2018 Hamza Hamidi 2023 Zaheer M
 * (MIT License, see engine/json-schema-form.service.ts).
 */
import type { WidgetProps } from './context'

import { isEqual as isEqual$2, isObject as isObject$1, pick } from 'lodash-es'
import { useState } from 'react'

import { cx } from '@/core/utilities/cx'

import { path2ControlKey } from '../engine/form-group.functions'
import { JsonPointer } from '../engine/jsonpointer.functions'
import { hasNonNullValue, hasOwn } from '../engine/utility.functions'
import { useJsfContext } from './context'
import { guard, useWidgetCtx } from './hooks'
import { layoutKey } from './keys'
import { SelectFrameworkWidget } from './SelectFrameworkWidget'

export function TabsWidget(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.selectedItem = 0
    ctx.showAddTab = true
    ctx.options = ctx.layoutNode().options || {}
    if (ctx.options.selectedTab) {
      ctx.selectedItem = ctx.options.selectedTab
    }
    ctx.itemCount = ctx.layoutNode().items.length - 1
    updateControl(ctx)
  })
  const [selectedItem, setSelectedItem] = useState<number>(ctx.selectedItem)
  ctx.selectedItem = selectedItem

  function updateControl(c: any) {
    const items = c.layoutNode().items
    const lastItem = items[items.length - 1]
    if (lastItem.type === '$ref'
      && c.itemCount >= (lastItem.options.maxItems || 1000)) {
      c.showAddTab = false
    }
  }

  const select = guard((index: number) => {
    const layoutNode = ctx.layoutNode()
    if (layoutNode.items[index].type === '$ref') {
      ctx.itemCount = layoutNode.items.length
      const item = layoutNode.items[index]
      const layoutIndex = ctx.layoutIndex().concat(index)
      const dataIndex = ctx.dataIndex().concat(index)
      jsf.addItem({
        layoutNode: () => item,
        layoutIndex: () => layoutIndex,
        dataIndex: () => dataIndex,
      })
      updateControl(ctx)
      refresh()
    }
    setSelectedItem(index)
  })

  const { options } = ctx
  const layoutNode = props.layoutNode
  const items: any[] = layoutNode?.items || []
  return (
    <tabs-widget>
      <ul className={cx(options?.labelHtmlClass || '')}>
        {items.map((item: any, i: number) => (
          <li
            key={layoutKey(item)}
            className={cx((options?.itemLabelHtmlClass || '') + (selectedItem === i
              ? (` ${options?.activeClass || ''} ${options?.style?.selected || ''}`)
              : (` ${options?.style?.unselected}`)))}
            role="presentation"
            data-tabs=""
          >
            {(ctx.showAddTab || item.type !== '$ref') && (
              <a
                className={cx(`nav-link${selectedItem === i
                  ? (` ${options?.activeClass} ${options?.style?.selected}`)
                  : (` ${options?.style?.unselected}`)}`)}
                onClick={() => select(i)}
              >
                {options?.tabMode === 'oneOfMode' && (
                  <input
                    type="radio"
                    value={i}
                    name="tabSelection"
                    checked={selectedItem === i}
                    className={cx(options?.widget_radioClass || '')}
                    onChange={() => select(i)}
                  />
                )}
                {jsf.setArrayItemTitle(ctx, item, i)}
              </a>
            )}
          </li>
        ))}
      </ul>
      {items.map((layoutItem: any, i: number) => {
        const frameworkProps = {
          className: cx(`${options?.fieldHtmlClass || ''
          } ${options?.activeClass || ''
          } ${options?.style?.selected || ''}`),
          dataIndex: layoutNode?.dataType === 'array' ? (props.dataIndex || []).concat(i) : props.dataIndex,
          layoutIndex: (props.layoutIndex || []).concat(i),
          layoutNode: layoutItem,
        }
        return (
          // By identity alone, like Angular's `track layoutItem`: keying by index
          // too remounted every tab after a removed one, and a widget's unmount
          // clears its value (formworks' ngOnDestroy)
          <div key={layoutKey(layoutItem)} className={cx(`${(options?.htmlClass || '') + (selectedItem !== i ? ' ngf-hidden' : '')} `)}>
            {options?.tabMode === 'oneOfMode'
              ? selectedItem === i && <SelectFrameworkWidget {...frameworkProps} />
              : <SelectFrameworkWidget {...frameworkProps} />}
          </div>
        )
      })}
    </tabs-widget>
  )
}

function findSelectedTab(ctx: any, jsf: any) {
  let foundInd = -1
  // seach for non null value
  if (ctx.layoutNode().items) {
    ctx.layoutNode().items.forEach((layoutItem: any, ind: number) => {
      const formValue = JsonPointer.get(jsf.formValues, layoutItem.dataPointer)
      if (layoutItem.oneOfPointer) {
        const controlKey = path2ControlKey(layoutItem.oneOfPointer)
        if (hasOwn(jsf.formGroup.controls, controlKey)
          && (formValue || hasNonNullValue(jsf.formGroup.controls[controlKey].value))) {
          foundInd = ind
        }
        // if no exact match found, then search in descendant values
        // to see which one of item matches
        if (foundInd === -1) {
          // find all descendant oneof paths
          const descendantOneOfControlNames = Object.keys(jsf.formGroup.controls).filter((controlName) => {
            return controlName.startsWith(controlKey)
          })
          descendantOneOfControlNames.forEach((controlName) => {
            const parts = controlName.split('$')
            const fieldName = parts[parts.length - 1]
            const controlValue = jsf.formGroup.controls[controlName].value
            const controlSchema = JsonPointer.get(jsf.schema, parts.join('/'))
            const schemaPointer = parts.join('/')
            const dPointer = schemaPointer.replace(/(anyOf|allOf|oneOf|none)\/\d+\//g, '')
              .replace(/(if|then|else|properties)\//g, '')
              .replace(/\/items\//g, '/-/')
            const dVal = JsonPointer.get(jsf.formValues, dPointer)
            let compareVal = dVal
            // compare only values that are in the subschema properties
            if (controlSchema && controlSchema.properties) {
              compareVal = isObject$1(dVal) && hasOwn(dVal, fieldName)
                ? pick((dVal as any)[fieldName], Object.keys(controlSchema.properties))
                : pick(dVal, Object.keys(controlSchema.properties))
            }
            if (isEqual$2(compareVal, controlValue)) {
              foundInd = ind
            }
          })
        }
      }
    })
  }
  return Math.max(foundInd, 0)
}

export function OneOfWidget(props: WidgetProps) {
  const { jsf } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    ctx.controlDisabled = false
    ctx.boundControl = false
    ctx.options = ctx.layoutNode().options || {}
    ctx.options.tabMode = 'oneOfMode'
    ctx.options.selectedTab = findSelectedTab(ctx, jsf)
    jsf.initializeControl(ctx)
  })
  return (
    <one-of-widget>
      <h4>{ctx.options?.description}</h4>
      <TabsWidget layoutNode={props.layoutNode} layoutIndex={props.layoutIndex} dataIndex={props.dataIndex} />
    </one-of-widget>
  )
}
