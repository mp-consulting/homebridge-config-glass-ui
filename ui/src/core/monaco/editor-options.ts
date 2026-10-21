import type { editor } from 'monaco-editor'

/** A finger rather than a mouse, read once when the editors are first loaded. */
function coarsePointer(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false)
}

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
  // iOS zooms the page into a focused field under 16px, and Monaco types into
  // a hidden textarea at the editor's font size. Only touch screens get the
  // bigger text; elsewhere Monaco keeps its own default (12px on a Mac, 14px
  // otherwise).
  ...(coarsePointer() ? { fontSize: 16 } : {}),
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
