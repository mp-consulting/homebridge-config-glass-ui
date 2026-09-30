import { importProvidersFrom } from '@angular/core'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import { NgxMonacoEditorConfig, provideMonacoEditor } from 'ngx-monaco-editor-v2'
import { provideToastr } from 'ngx-toastr'

import { AppToastComponent } from '@/app/core/components/app-toast/app-toast.component'
import { onMonacoLoad } from '@/app/core/ui/monaco-editor.service'

const monacoBaseUrl = './assets/monaco/min/vs'

const monacoConfig: NgxMonacoEditorConfig = {
  baseUrl: monacoBaseUrl,
  defaultOptions: {
    'automaticLayout': true,
    'copyWithSyntaxHighlighting': true,
    'ignoreTrimWhitespace': false,
    'scrollBeyondLastLine': false,
    'quickSuggestions': true,
    'parameterHints': true,
    'formatOnType': true,
    'formatOnPaste': true,
    'folding': true,
    'bracketPairColorization.enabled': true,
    'minimap': {
      enabled: true,
      showSlider: 'mouseover',
      scale: 2,
    },
    'smoothScrolling': true,
    'cursorSmoothCaretAnimation': 'on',
    'stickyScroll': {
      enabled: true,
    },
    'renderWhitespace': 'boundary',
    'tabCompletion': 'on',
    'unicodeHighlight': {
      ambiguousCharacters: true,
      invisibleCharacters: true,
    },
    'suggest': {
      showWords: true,
      showSnippets: true,
      preview: true,
    },
  },
  onMonacoLoad: () => {
    onMonacoLoad()
  },
}

/**
 * Provides UI library configurations:
 * - Bootstrap components (NgbModule)
 * - Toast notifications
 * - Monaco Editor
 *
 * ⚠️ Only what the login page needs belongs here - everything registered at
 * bootstrap lands in the initial bundle. The heavy libraries are provided
 * where they are used instead:
 * - Chart.js: on the signed-in layout route (`layout.routes.ts`)
 * - Drag and drop: `DragulaService` is `providedIn: 'root'`, and the two
 *   sortable views import `DragulaModule` themselves
 * - JSON Schema Form: the plugin settings modals import
 *   `Bootstrap5FrameworkModule`, so they carry the form framework into
 *   whatever injector opens them (root services open them, so a route-level
 *   provider would not reach them)
 */
export function provideUiLibraries() {
  return [
    importProvidersFrom(NgbModule),
    provideToastr({
      autoDismiss: true,
      newestOnTop: false,
      closeButton: true,
      maxOpened: 2,
      positionClass: 'toast-bottom-right',
      toastComponent: AppToastComponent,
    }),
    provideMonacoEditor(monacoConfig),
  ]
}
