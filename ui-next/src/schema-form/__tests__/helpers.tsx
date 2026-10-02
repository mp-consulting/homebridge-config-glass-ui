import type { SchemaFormConfig } from '../SchemaForm'

import { act, fireEvent, render } from '@testing-library/react'

import { SchemaForm } from '../SchemaForm'

export interface RenderedForm {
  container: HTMLElement
  emitted: any[]
  validity: boolean[]
  rerender: (data: any, configSchema?: SchemaFormConfig) => void
  unmount: () => void
}

/** Render `<SchemaForm>` and record what it emits */
export function renderSchemaForm(configSchema: SchemaFormConfig, data: any, options: { lang?: string } = {}): RenderedForm {
  const emitted: any[] = []
  const validity: boolean[] = []
  const element = (d: any, c: SchemaFormConfig) => (
    <SchemaForm
      configSchema={c}
      data={d}
      lang={options.lang}
      onDataChange={value => emitted.push(value)}
      onValidChange={value => validity.push(value)}
    />
  )
  let currentConfig = configSchema
  const result = render(element(data, configSchema))
  return {
    container: result.container,
    emitted,
    validity,
    rerender: (d: any, c?: SchemaFormConfig) => {
      currentConfig = c ?? currentConfig
      result.rerender(element(d, currentConfig))
    },
    unmount: result.unmount,
  }
}

/**
 * Let the form settle: the 50 ms valueChanges debounce, the 50 ms isValid
 * debounce and microtasks. React only flushes renders when an `act()` scope
 * ends, so time passes in short scopes, the way a browser would render
 * between timers.
 */
export async function settle(ms = 120) {
  const end = Date.now() + ms
  do {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, Math.min(5, Math.max(0, end - Date.now()))))
    })
  } while (Date.now() < end)
}

export async function typeInto(input: Element, value: string) {
  await act(async () => {
    fireEvent.input(input, { target: { value } })
  })
}

export async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element)
  })
}

export async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    fireEvent.change(select, { target: { value } })
  })
}

export function lastEmitted(form: RenderedForm) {
  return form.emitted[form.emitted.length - 1]
}
