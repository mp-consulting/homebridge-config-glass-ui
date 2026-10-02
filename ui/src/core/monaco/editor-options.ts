import type { editor } from 'monaco-editor'

/**
 * The default options every editor got through ngx-monaco-editor-v2's
 * `defaultOptions` (ui/src/app/core/providers/ui-libraries.providers.ts).
 * ngx merged them under each editor's own options, and the wrappers here do
 * the same.
 *
 * One change: Angular passed `'bracketPairColorization.enabled': true` as a
 * dotted key, which Monaco does not read. It is written as the nested option
 * here. The effect is the same, since Monaco enables it by default.
 */
export const DEFAULT_EDITOR_OPTIONS = {
  automaticLayout: true,
  copyWithSyntaxHighlighting: true,
  scrollBeyondLastLine: false,
  quickSuggestions: true,
  parameterHints: { enabled: true },
  formatOnType: true,
  formatOnPaste: true,
  folding: true,
  bracketPairColorization: { enabled: true },
  minimap: {
    enabled: true,
    showSlider: 'mouseover',
    scale: 2,
  },
  smoothScrolling: true,
  cursorSmoothCaretAnimation: 'on',
  stickyScroll: {
    enabled: true,
  },
  renderWhitespace: 'boundary',
  tabCompletion: 'on',
  unicodeHighlight: {
    ambiguousCharacters: true,
    invisibleCharacters: true,
  },
  suggest: {
    showWords: true,
    showSnippets: true,
    preview: true,
  },
} satisfies editor.IStandaloneEditorConstructionOptions

/** Diff-editor-only default (it was in the same Angular `defaultOptions`). */
export const DEFAULT_DIFF_EDITOR_OPTIONS = {
  ...DEFAULT_EDITOR_OPTIONS,
  ignoreTrimWhitespace: false,
} satisfies editor.IDiffEditorConstructionOptions
