import type { ComponentType } from 'react'

import { createContext, use } from 'react'

/** The inputs every formworks widget takes */
export interface WidgetProps {
  layoutNode: any
  layoutIndex: number[]
  dataIndex: number[]
}

export type Widget = ComponentType<WidgetProps>

export interface JsfContextValue {
  /** The vendored JsonSchemaFormService instance */
  jsf: any
  /**
   * Re-render the whole form, like Angular's change detection after an
   * event or a `markForCheck()`.
   */
  refresh: () => void
  /** Changes on every refresh, so context consumers re-render */
  tick: number
}

export const JsfContext = createContext<JsfContextValue | null>(null)

export function useJsfContext(): JsfContextValue {
  const value = use(JsfContext)
  if (!value) {
    throw new Error('schema-form widgets must be rendered inside <JsonSchemaForm>')
  }
  return value
}
