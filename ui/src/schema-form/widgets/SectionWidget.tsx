/* eslint-disable react/dom-no-dangerously-set-innerhtml */
/**
 * Port of formworks' SectionComponent (@ng-formworks/core 21.7.0): the
 * container for `section`, `div`, `fieldset`, `array`, `tab`... layout nodes,
 * including the expandable (collapsible) variant.
 *
 * The jsfPatch directive's disclosure fixes are built in: a visually hidden
 * proxy `<button>` with the title, `aria-expanded` and `aria-controls` comes
 * first in the container, the clickable legend is hidden from the
 * accessibility tree and the container gets `role="presentation"`.
 *
 * Copyright (c) 2014-2016 David Schnell-Davis 2018 Hamza Hamidi 2023 Zaheer M
 * (MIT License, see engine/json-schema-form.service.ts).
 */
import type { WidgetProps } from './context'

import { useEffect, useState } from 'react'

import { cleanSectionTitle } from './a11y'
import { useJsfContext } from './context'
import { useWidgetCtx } from './hooks'
import { cx, htmlToText, safeHtml } from './html'
import { RootWidget } from './RootWidget'

const FIELDSET_TYPES = ['fieldset', 'array', 'tab', 'advancedfieldset', 'authfieldset', 'optionfieldset', 'selectfieldset']

function randomId(prefix: string) {
  return `${prefix}${Math.random().toString(36).slice(2)}`
}

export function SectionWidget(props: WidgetProps) {
  const { jsf, refresh } = useJsfContext()
  const ctx = useWidgetCtx(props, (ctx) => {
    jsf.initializeControl(ctx)
    ctx.options = ctx.layoutNode().options || {}
    ctx.containerType = FIELDSET_TYPES.includes(ctx.layoutNode().type) ? 'fieldset' : 'div'
    ctx.titleContext = jsf.getItemTitleContext(ctx)
  })
  const [expanded, setExpanded] = useState<boolean>(() => typeof ctx.options.expanded === 'boolean'
    ? ctx.options.expanded
    : !ctx.options.expandable)
  const [bodyId] = useState(() => randomId(ctx.containerType === 'div' ? 'jsf_section_' : 'jsf_collapse_'))

  useEffect(() => {
    const subscription = jsf.dataChanges.subscribe(() => {
      ctx.titleContext = jsf.getItemTitleContext(ctx)
      refresh()
    })
    return () => subscription.unsubscribe()
  }, [ctx, jsf, refresh])

  const { options } = ctx
  const layoutNode = props.layoutNode

  const toggleExpanded = () => {
    if (options.expandable) {
      setExpanded(value => !value)
    }
  }

  const getFlexAttribute = (attribute: string): any => {
    const flexActive = layoutNode.type === 'flex'
      || !!options.displayFlex
      || options.display === 'flex'
    if (attribute !== 'flex' && !flexActive) {
      return null
    }
    switch (attribute) {
      case 'is-flex':
        return flexActive
      case 'display':
        return flexActive ? 'flex' : 'initial'
      case 'flex-direction':
      case 'flex-wrap': {
        const index = ['flex-direction', 'flex-wrap'].indexOf(attribute)
        return (options['flex-flow'] || '').split(/\s+/)[index]
          || options[attribute] || ['column', 'nowrap'][index]
      }
      case 'justify-content':
      case 'align-items':
      case 'align-content':
        return options[attribute]
    }
    return undefined
  }

  const titleHtml = options.notitle
    ? ''
    : jsf.parseText(options.title, ctx.titleContext.value, ctx.titleContext.values, ctx.titleContext.key)
  const titleText = options.notitle ? '' : cleanSectionTitle(htmlToText(titleHtml).trim())
  const containerClass = cx(options?.htmlClass || '', {
    expandable: options?.expandable && !expanded,
    expanded: options?.expandable && expanded,
  })
  const flexDirection = getFlexAttribute('flex-direction')
  const isFieldset = ctx.containerType === 'fieldset'
  // The div variant only gets a proxy when it is expandable
  const hasProxy = !!titleText && (isFieldset || !!options?.expandable)

  const body = (
    <RootWidget
      dataIndex={props.dataIndex}
      layout={layoutNode.items}
      layoutIndex={props.layoutIndex}
      isFlexItem={getFlexAttribute('is-flex')}
      isOrderable={options?.orderable}
      className={cx({
        'form-flex-column': flexDirection === 'column',
        'form-flex-row': flexDirection === 'row',
      })}
      style={{
        alignContent: getFlexAttribute('align-content') ?? undefined,
        alignItems: getFlexAttribute('align-items') ?? undefined,
        display: !expanded ? 'none' : (getFlexAttribute('display') ?? undefined),
        flexDirection: flexDirection ?? undefined,
        flexWrap: getFlexAttribute('flex-wrap') ?? undefined,
        justifyContent: getFlexAttribute('justify-content') ?? undefined,
      }}
      id={hasProxy && !isFieldset ? bodyId : undefined}
    />
  )

  const proxy = hasProxy && (
    <button
      type="button"
      className={isFieldset ? 'jsf-fieldset-proxy visually-hidden-focusable' : 'jsf-section-proxy visually-hidden-focusable'}
      role="button"
      tabIndex={0}
      aria-label={titleText}
      aria-expanded={expanded ? 'true' : 'false'}
      aria-controls={isFieldset ? undefined : bodyId}
      onClick={(event) => {
        event.preventDefault()
        toggleExpanded()
      }}
    >
      {titleText}
    </button>
  )

  const description = options?.description && (
    <p className={cx('help-block', options?.labelHelpBlockClass || '')} dangerouslySetInnerHTML={safeHtml(options?.description)} />
  )

  return (
    <section-widget>
      {!isFieldset && (
        <div className={containerClass} role={hasProxy ? 'presentation' : undefined}>
          {proxy}
          {!options.notitle && (
            <label
              className={cx('legend', options?.labelHtmlClass || '')}
              aria-hidden={hasProxy ? 'true' : undefined}
              dangerouslySetInnerHTML={safeHtml(titleHtml)}
              onClick={toggleExpanded}
            />
          )}
          {body}
        </div>
      )}
      {isFieldset && (
        <fieldset className={containerClass} disabled={!!options?.readonly} role={hasProxy ? 'presentation' : undefined}>
          {proxy}
          {!options.notitle && (
            <legend
              className={cx('legend', options?.labelHtmlClass || '')}
              aria-hidden={hasProxy ? 'true' : undefined}
              dangerouslySetInnerHTML={safeHtml(titleHtml)}
              onClick={toggleExpanded}
            />
          )}
          {options?.messageLocation !== 'bottom' && <div>{description}</div>}
          {body}
          {options?.messageLocation === 'bottom' && <div>{description}</div>}
        </fieldset>
      )}
    </section-widget>
  )
}
