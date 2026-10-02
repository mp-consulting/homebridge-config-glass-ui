/**
 * The plugin settings form: the React port of the Angular `<app-schema-form>`
 * (ui/src/app/core/components/schema-form/schema-form.component.ts), which
 * wraps formworks' `<json-schema-form>` with the app's options and data rules
 * (see `SchemaFormState`).
 */
import { useLayoutEffect, useRef, useState } from 'react'

import { JsonSchemaForm } from './JsonSchemaForm'
import { resolveFormLanguage, SCHEMA_FORM_OPTIONS, SchemaFormState } from './schema-form-state'

export interface SchemaFormConfig {
  schema?: any
  layout?: any
  form?: any
  uiSchema?: any
  fixArrays?: boolean
}

export interface SchemaFormProps {
  /** `{ schema, layout, form, uiSchema, fixArrays }` as plugin-config passes it */
  configSchema: SchemaFormConfig
  /**
   * The config object. It is updated in place and the same reference is
   * emitted; pass a different object to reset the form.
   */
  data: any
  onDataChange?: (data: any) => void
  /** Alias of `onDataChange` (the Angular component had both outputs) */
  onDataChanged?: (data: any) => void
  /** Debounced by 50 ms, and only called when validity changes */
  onValidChange?: (isValid: boolean) => void
  /** The user's UI language (settings `env.lang`, e.g. `pt-BR`) */
  lang?: string
}

export function SchemaForm({ configSchema, data, onDataChange, onDataChanged, onValidChange, lang }: SchemaFormProps) {
  const outputsRef = useRef({ dataChange: onDataChange, dataChanged: onDataChanged, isValid: onValidChange })
  outputsRef.current = { dataChange: onDataChange, dataChanged: onDataChanged, isValid: onValidChange }

  const stateRef = useRef<SchemaFormState | null>(null)
  if (stateRef.current === null) {
    stateRef.current = new SchemaFormState(() => outputsRef.current)
    stateRef.current.setDataInput(data)
  }
  const state = stateRef.current

  const [currentData, setCurrentData] = useState(() => state.currentData)
  useLayoutEffect(() => {
    if (state.setDataInput(data)) {
      setCurrentData(state.currentData)
    }
  }, [state, data])

  // Deferred, so React StrictMode's simulated unmount (development only)
  // does not drop a pending validity report
  const mountedRef = useRef(false)
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      queueMicrotask(() => {
        if (!mountedRef.current) {
          state.destroy()
        }
      })
    }
  }, [state])

  const language = resolveFormLanguage(lang)

  if (!configSchema?.schema) {
    return null
  }

  return (
    <JsonSchemaForm
      className="ng-bs5-validate"
      fixArrays={!!configSchema.fixArrays}
      options={SCHEMA_FORM_OPTIONS}
      schema={configSchema.schema}
      UISchema={configSchema.uiSchema}
      layout={configSchema.layout}
      form={configSchema.form}
      data={currentData}
      language={language}
      onChanges={data => state.onChanges(data)}
      onIsValid={isValid => state.validChange(isValid)}
    />
  )
}
