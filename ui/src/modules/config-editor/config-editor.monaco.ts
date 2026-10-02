import { getMonaco } from '@/core/monaco'

import { CONFIG_MODEL_URI } from './config-schema'

/** Where the plain-text preference is kept (frozen storage key). */
export const PLAIN_TEXT_STORAGE_KEY = 'hb_config_editor_plaintext'

/** The models the diff editor builds (the uris ngx-monaco-editor gave them). */
export const DIFF_ORIGINAL_URI = 'file:///original.json'
export const DIFF_MODIFIED_URI = 'file:///modified.json'

/** Dispose whatever models the editors left at the uris this page uses. */
export function disposeLeftoverModels(): void {
  try {
    const monaco = getMonaco()
    if (!monaco) {
      return
    }
    for (const uri of [DIFF_ORIGINAL_URI, DIFF_MODIFIED_URI, CONFIG_MODEL_URI]) {
      const model = monaco.editor.getModel(monaco.Uri.parse(uri))
      if (model && !model.isDisposed()) {
        model.dispose()
      }
    }
  } catch { /* no problem disposing */ }
}
