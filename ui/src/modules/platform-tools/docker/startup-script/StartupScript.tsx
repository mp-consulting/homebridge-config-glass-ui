import type { OnMount } from '@monaco-editor/react'
import type { KeyboardEvent } from 'react'

import type { StartupScriptResponse } from './startup-script.loader'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLoaderData } from 'react-router'

import { api } from '@/core/api'
import { MonacoEditor } from '@/core/monaco'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { toastApiError } from '@/core/utilities/http-error'
import { mobileDetect } from '@/core/utilities/mobile-detect'

type MonacoInstance = Parameters<OnMount>[0]

const editorOptions = { language: 'shell' }

/** The parts of the Monaco editor the page uses. */
type StartupScriptEditor = Pick<MonacoInstance, 'getModel' | 'getAction' | 'dispose'>

/** The Docker container's `startup.sh`, in Monaco (a plain textarea on a phone). */
export function StartupScript() {
  const { t } = useTranslation()
  const data = useLoaderData() as StartupScriptResponse

  const [isMobile] = useState(() => Boolean(mobileDetect.detect.mobile()))
  const [startupScript, setStartupScript] = useState<string>(data.script)
  const [saveInProgress, setSaveInProgress] = useState(false)

  const scriptRef = useRef(startupScript)
  scriptRef.current = startupScript
  const saveInProgressRef = useRef(false)
  const editorRef = useRef<StartupScriptEditor | null>(null)

  useEffect(() => {
    let lastHeight = window.innerHeight

    const visualViewPortChanged = () => {
      const viewport = window.visualViewport!
      if (lastHeight < viewport.height) {
        (document.activeElement as HTMLElement | null)?.blur()
      }

      if (viewport.height < window.innerHeight) {
        // Keyboard may have opened
        mobileDetect.enableTouchMove()
        lastHeight = viewport.height
      } else if (viewport.height === window.innerHeight) {
        // Keyboard is closed
        mobileDetect.disableTouchMove()
        lastHeight = viewport.height
      }
    }

    // Capture viewport events
    const viewport = window.visualViewport
    if (viewport && !isMobile) {
      viewport.addEventListener('resize', visualViewPortChanged, true)
      mobileDetect.disableTouchMove()
    }

    return () => {
      if (viewport) {
        viewport.removeEventListener('resize', visualViewPortChanged, true)
        mobileDetect.enableTouchMove()
      }
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [isMobile])

  const onEditorInit = (editor: StartupScriptEditor) => {
    editorRef.current = editor
    editor.getModel()?.setValue(scriptRef.current)
  }

  const onSave = async () => {
    if (saveInProgressRef.current) {
      return
    }

    saveInProgressRef.current = true
    setSaveInProgress(true)

    let script = scriptRef.current
    // Get the value from the editor
    const editor = editorRef.current
    if (!isMobile && editor) {
      await editor.getAction('editor.action.formatDocument')?.run()
      script = editor.getModel()?.getValue() ?? ''
      setStartupScript(script)
    }

    try {
      // Check startup script is using the correct hashbang
      if (!['#!/bin/sh', '#!/bin/bash'].includes(script.split('\n')[0].trim())) {
        toast.error(i18n.t('platform.docker.must_use_hashbang'), i18n.t('toast.title_error'))
        const updatedScript = `#!/bin/sh\n\n${script}`
        setStartupScript(updatedScript)

        if (!isMobile) {
          editor?.getModel()?.setValue(updatedScript)
        }
        return
      }

      try {
        await api.put('/platform-tools/docker/startup-script', { script })
        toast.success(i18n.t('platform.docker.restart_required'), i18n.t('platform.docker.script_saved'))
      } catch (error) {
        console.error(error)
        toastApiError(error)
      }
    } finally {
      saveInProgressRef.current = false
      setSaveInProgress(false)
    }
  }

  const onEditorKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void onSave()
    }
  }

  return (
    <div className="flex-column d-flex align-items-stretch h-100">
      <div className="row mb-3">
        <div className="col-6">
          <h3 className="primary-text m-0 font-monospace">startup.sh</h3>
        </div>
        <div className="col-6 text-end">
          <button
            type="button"
            className="btn btn-primary waves-effect m-0"
            disabled={saveInProgress}
            aria-label={t('form.button_save')}
            aria-busy={saveInProgress}
            onClick={() => void onSave()}
          >
            {saveInProgress
              ? <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>
              : <i className="fas fa-floppy-disk" aria-hidden="true"></i>}
          </button>
        </div>
      </div>
      {!isMobile
        ? (
            <MonacoEditor
              wrapperProps={{ className: 'flex-grow-1 h-100 w-100 my-2', onKeyDown: onEditorKeyDown }}
              height="100%"
              defaultLanguage="shell"
              defaultValue=""
              options={editorOptions}
              onMount={editor => onEditorInit(editor)}
            />
          )
        : (
            <textarea
              wrap="off"
              className="hb-plain-text-editor align-self-end h-100 w-100 my-2"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
              aria-label={t('menu.docker.startup_script')}
              value={startupScript}
              onChange={event => setStartupScript(event.target.value)}
            >
            </textarea>
          )}
    </div>
  )
}
