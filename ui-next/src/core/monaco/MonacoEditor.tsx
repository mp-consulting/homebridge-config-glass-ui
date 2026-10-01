import type { DiffEditorProps, EditorProps } from '@monaco-editor/react'

import type { JsonSchemaEntry } from './json-schemas'

import { DiffEditor, Editor } from '@monaco-editor/react'
import { useEffect, useMemo } from 'react'

import { DEFAULT_DIFF_EDITOR_OPTIONS, DEFAULT_EDITOR_OPTIONS } from './editor-options'
import { configureMonacoLoader, loadMonaco } from './monaco-loader'
import { useMonacoTheme } from './monaco-theme'
import { useJsonSchema } from './use-json-schema'

// Must run before the first <Editor> calls `loader.init()` in its effect.
configureMonacoLoader()

export interface MonacoEditorProps extends EditorProps {
  /** A JSON schema to register while this editor is mounted (memoise it). */
  jsonSchema?: JsonSchemaEntry | null
}

/**
 * `@monaco-editor/react`'s `<Editor>` loading our self-hosted AMD Monaco, with
 * the app's default options merged under `options` and a theme that follows
 * the app's light/dark mode unless `theme` is given.
 */
export function MonacoEditor({ options, theme, jsonSchema, ...rest }: MonacoEditorProps) {
  const appTheme = useMonacoTheme()
  const mergedOptions = useMemo(() => ({ ...DEFAULT_EDITOR_OPTIONS, ...options }), [options])
  useJsonSchema(jsonSchema)
  useEffect(() => {
    // Routes the load through loadMonaco() so onMonacoReady listeners fire.
    loadMonaco().catch(error => console.error('Failed to load Monaco:', error))
  }, [])
  return <Editor {...rest} theme={theme ?? appTheme} options={mergedOptions} />
}

export interface MonacoDiffEditorProps extends DiffEditorProps {
  /** A JSON schema to register while this editor is mounted (memoise it). */
  jsonSchema?: JsonSchemaEntry | null
}

/** The diff-editor counterpart of {@link MonacoEditor}. */
export function MonacoDiffEditor({ options, theme, jsonSchema, ...rest }: MonacoDiffEditorProps) {
  const appTheme = useMonacoTheme()
  const mergedOptions = useMemo(() => ({ ...DEFAULT_DIFF_EDITOR_OPTIONS, ...options }), [options])
  useJsonSchema(jsonSchema)
  useEffect(() => {
    loadMonaco().catch(error => console.error('Failed to load Monaco:', error))
  }, [])
  return <DiffEditor {...rest} theme={theme ?? appTheme} options={mergedOptions} />
}
