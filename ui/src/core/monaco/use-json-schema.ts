import type { JsonSchemaEntry, MonacoJsonHost } from './json-schemas'

import { useEffect } from 'react'

import { getJsonDefaults, registerJsonSchema } from './json-schemas'
import { loadMonaco } from './monaco-loader'

/**
 * Register a JSON schema with Monaco while the calling component is mounted,
 * and remove it (by uri) on unmount or when `entry` changes. Replaces the
 * `setDiagnosticsOptions` calls in the Angular config editor (init/destroy)
 * and manual-config modal.
 *
 * Pass a stable (memoised) `entry`: a new object re-registers the schema.
 *
 * @param entry - the schema to register, or a falsy value for none
 */
export function useJsonSchema(entry: JsonSchemaEntry | null | undefined): void {
  useEffect(() => {
    if (!entry) {
      return
    }
    let cancelled = false
    let dispose: (() => void) | undefined
    loadMonaco().then((monaco) => {
      if (cancelled) {
        return
      }
      const jsonDefaults = getJsonDefaults(monaco as unknown as MonacoJsonHost)
      if (jsonDefaults) {
        dispose = registerJsonSchema(jsonDefaults, entry)
      }
    }, (error) => {
      console.error('Failed to load Monaco for JSON schema registration:', error)
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [entry])
}
