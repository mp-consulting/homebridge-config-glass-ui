/**
 * The data/validity bookkeeping of the Angular `SchemaFormComponent`
 * (ui/src/app/core/components/schema-form/schema-form.component.ts), kept
 * framework-free so the exact rules can be tested on their own:
 *
 * - the form hands back a rebuilt object on every change; it is merged INTO
 *   the caller's object (keys the form dropped are deleted) and that same
 *   reference is emitted, so the caller's own references stay valid;
 * - `_bridge` (the child bridge block, injected as a hidden sub-schema) is
 *   preserved verbatim - the form's copy would drop its nested HAP/Matter
 *   state - and never invented when the caller did not have one;
 * - a new `data` reference resets the form, an in-place edit does not, and a
 *   swap arriving while the form's own change is settling (one microtask) is
 *   ignored;
 * - validity is debounced by 50 ms and only reported when it changes.
 */

/**
 * The options the Angular component passed to formworks. Each one changes
 * every plugin's form: the modal supplies its own save button, the app must
 * not fetch assets from the internet, and empty fields must not be written
 * back into config.json.
 */
export const SCHEMA_FORM_OPTIONS = Object.freeze({
  addSubmit: false,
  loadExternalAssets: false,
  returnEmptyFields: false,
  setSchemaDefaults: true,
  autocomplete: false,
})

export const AVAILABLE_FORM_LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'zh']

/** The form only ships base languages; anything else falls back to English */
export function resolveFormLanguage(lang: string | null | undefined): string {
  const userLanguage = lang?.split('-')[0]
  if (userLanguage && AVAILABLE_FORM_LANGUAGES.includes(userLanguage)) {
    return userLanguage
  }
  return 'en'
}

export interface SchemaFormOutputs {
  dataChange?: (data: any) => void
  dataChanged?: (data: any) => void
  isValid?: (isValid: boolean) => void
}

export class SchemaFormState {
  /** What the form renders (formworks' `data` input) */
  currentData: any = null

  private lastValidState: boolean | undefined = undefined
  private validationTimeout: ReturnType<typeof setTimeout> | null = null
  private lastDataReference: any = null
  private processingInternalChange = false
  private input: any = undefined

  constructor(private readonly outputs: () => SchemaFormOutputs) {}

  /**
   * The `data` input was (re)assigned. Returns true when the form must be
   * given a different object.
   */
  setDataInput(newData: any): boolean {
    this.input = newData

    // Skip update if we're processing a change from the form itself.
    // Track the reference even on this branch so the next external
    // input change is compared against what the input actually is now.
    if (this.processingInternalChange) {
      this.lastDataReference = newData
      return false
    }

    // Only update if the reference has changed, not just the content
    if (this.lastDataReference !== newData) {
      this.lastDataReference = newData
      this.currentData = newData
      return true
    }
    return false
  }

  /** formworks' `(onChanges)` */
  onChanges(data: any) {
    // Set flag to prevent the data input from replacing currentData
    this.processingInternalChange = true

    const currentDataObj = this.input
    const outputs = this.outputs()

    if (currentDataObj && typeof currentDataObj === 'object' && typeof data === 'object') {
      const preservedBridge = currentDataObj._bridge

      // Update existing object in-place (preserves external references)
      for (const key of Object.keys(currentDataObj)) {
        if (!(key in data)) {
          delete currentDataObj[key]
        }
      }
      Object.assign(currentDataObj, data)

      if (preservedBridge === undefined) {
        delete currentDataObj._bridge
      } else {
        currentDataObj._bridge = preservedBridge
      }

      // Emit the SAME reference we just updated
      outputs.dataChange?.(currentDataObj)
      outputs.dataChanged?.(currentDataObj)
    } else {
      // Fallback: just emit the new data if we can't update in-place
      outputs.dataChange?.(data)
      outputs.dataChanged?.(data)
    }

    // Clear flag after a microtask to allow external changes again
    queueMicrotask(() => {
      this.processingInternalChange = false
    })
  }

  /** formworks' `(isValid)`, debounced */
  validChange(isValid: boolean) {
    if (this.validationTimeout) {
      clearTimeout(this.validationTimeout)
    }

    this.validationTimeout = setTimeout(() => {
      this.validationTimeout = null
      if (this.lastValidState !== isValid) {
        this.lastValidState = isValid
        this.outputs().isValid?.(isValid)
      }
    }, 50)
  }

  destroy() {
    if (this.validationTimeout) {
      clearTimeout(this.validationTimeout)
      this.validationTimeout = null
    }
  }
}
