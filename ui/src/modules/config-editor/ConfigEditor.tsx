import type { JsonSchemaEntry } from '@/core/monaco'
import type { ChildBridge } from '@/core/plugins/manage-plugins.interfaces'
import type { Monaco } from '@monaco-editor/react'
import type { editor as MonacoEditorNs } from 'monaco-editor'
import type { KeyboardEvent } from 'react'

import type { HomebridgeConfig } from './config-editor.interfaces'
import type { RestartState } from './restart-scope'

import json5 from 'json5'
import { isEqual } from 'lodash-es'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import { useLoaderData, useSearchParams } from 'react-router'

import { api } from '@/core/api'
import { Confirm } from '@/core/components/confirm/Confirm'
import { RestartChildBridges } from '@/core/components/restart-child-bridges/RestartChildBridges'
import { RestartHomebridge } from '@/core/components/restart-homebridge/RestartHomebridge'
import { MonacoDiffEditor, MonacoEditor } from '@/core/monaco'
import { settingsActions } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { i18n, t } from '@/core/ui/i18n'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { childBridges } from '@/core/utilities/child-bridges'
import { mobileDetect } from '@/core/utilities/mobile-detect'
import { useCanDeactivate } from '@/core/utilities/terminal/can-deactivate'

import { DIFF_MODIFIED_URI, DIFF_ORIGINAL_URI, disposeLeftoverModels, PLAIN_TEXT_STORAGE_KEY } from './config-editor.monaco'
import { ConfigRestore } from './config-restore/ConfigRestore'
import { CONFIG_MODEL_URI, CONFIG_SCHEMA_URI, createConfigSchema } from './config-schema'
import { findConfigProblem } from './config-validation'
import { detectConfigPlatformChanges, determineRestartType } from './restart-scope'

declare global {
  interface Window {
    editor?: any
  }
}

function readPlainTextPreference(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(PLAIN_TEXT_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * The config.json editor: Monaco (or a plain textarea on mobile and for
 * screen-reader users who prefer it), relaxed-JSON parsing, the spec checks
 * that keep a broken config off disk, loading a backup into a diff view, and
 * the restart prompt the save calls for.
 */
const NARROW_QUERY = '(max-width: 767px)'

export function ConfigEditor() {
  const { t: translate } = useTranslation()
  // Read once: the route does not revalidate while the page is open (see
  // `shouldRevalidate` in route.tsx), which is what the Angular resolver did
  const loadedConfig = useLoaderData() as string
  const [searchParams, setSearchParams] = useSearchParams()

  const isMobile = useMemo(() => !!mobileDetect.detect.mobile(), [])
  const flags = useMemo(() => ({
    isDebugModeEnabled: settingsActions.isFeatureEnabled('childBridgeDebugMode'),
    isMatterSupported: settingsActions.isFeatureEnabled('matterSupport'),
    isProtocolExternalsOnlyEnabled: settingsActions.isFeatureEnabled('protocolExternalsOnly'),
    isMatterDisableIpv4Enabled: settingsActions.isFeatureEnabled('matterDisableIpv4'),
    isHapDisableIdentifyingMaterialEnabled: settingsActions.isFeatureEnabled('hapDisableIdentifyingMaterial'),
  }), [])

  // State the template renders from, each mirrored in a ref so the async
  // save / restore chains read the current value, as the Angular signals did
  const [homebridgeConfig, setHomebridgeConfig] = useState(loadedConfig)
  const configRef = useRef(loadedConfig)
  const [originalConfig, setOriginalConfig] = useState('')
  const originalRef = useRef('')
  const [saveInProgress, setSaveInProgress] = useState(false)
  const savingRef = useRef(false)
  // Lets screen-reader users opt into a plain <textarea> instead of the Monaco
  // editor, which has well-known SR-support gaps. Persisted in localStorage so
  // the choice survives reloads.
  const [preferPlainTextEditor, setPreferPlainTextEditor] = useState(readPlainTextPreference)
  const preferPlainRef = useRef(preferPlainTextEditor)
  const [renderSideBySide, setRenderSideBySide] = useState(false)

  const monacoEditorRef = useRef<MonacoEditorNs.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const editorDecorationsRef = useRef<string[]>([])
  const restartStateRef = useRef<RestartState>({
    latestSavedConfig: JSON.parse(loadedConfig) as HomebridgeConfig,
    hbPendingRestart: false,
    childBridgesToRestart: [],
  })
  const restoreActionHandledRef = useRef(false)

  const writeConfig = (value: string) => {
    configRef.current = value
    setHomebridgeConfig(value)
  }
  const writeOriginalConfig = (value: string) => {
    originalRef.current = value
    setOriginalConfig(value)
  }
  const writeSaveInProgress = (value: boolean) => {
    savingRef.current = value
    setSaveInProgress(value)
  }

  /**
   * True when Monaco is the active editing surface. In plain-text mode (or
   * on mobile) the <textarea> drives `homebridgeConfig` directly and any
   * retained Monaco reference points at a hidden/disposed editor whose model
   * is stale — it must not be read from or written to.
   */
  const isMonacoActive = () => !isMobile && !preferPlainRef.current && !!monacoEditorRef.current

  const schemaEntry = useMemo<JsonSchemaEntry>(() => ({
    uri: CONFIG_SCHEMA_URI,
    fileMatch: [CONFIG_MODEL_URI],
    schema: createConfigSchema(i18n.t, flags),
  }), [flags])

  // A phone-width window: the minimap would take a quarter of the editor
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW_QUERY).matches ?? false)
  useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY)
    if (!query) {
      return undefined
    }
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const editorOptions = useMemo(() => ({
    renderSideBySide,
    renderIndicators: true,
    ignoreTrimWhitespace: false,
    glyphMargin: true,
    // The rest of the minimap defaults (DEFAULT_EDITOR_OPTIONS) are restated: the option is replaced whole
    minimap: { enabled: !narrow, showSlider: 'mouseover' as const, scale: 2 },
  }), [renderSideBySide, narrow])

  useEffect(() => {
    // Page title - using "JSON Config" from menu
    settingsActions.setPageTitle(t('menu.config_json_editor'))

    const content = document.querySelector<HTMLElement>('.content')
    if (content) {
      content.style.height = '100%'
    }

    // Capture viewport events
    let lastHeight = window.innerHeight
    const visualViewPortChanged = () => {
      if (lastHeight < window.visualViewport!.height) {
        (document.activeElement as HTMLElement | null)?.blur()
      }

      if (window.visualViewport!.height < window.innerHeight) {
        // Keyboard may have opened
        mobileDetect.enableTouchMove()
        lastHeight = window.visualViewport!.height
      } else if (window.visualViewport!.height === window.innerHeight) {
        // Keyboard is closed
        mobileDetect.disableTouchMove()
        lastHeight = window.visualViewport!.height
      }
    }
    if (window.visualViewport && !isMobile) {
      window.visualViewport.addEventListener('resize', visualViewPortChanged, true)
      mobileDetect.disableTouchMove()
    }

    return () => {
      content?.style.removeProperty('height')
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', visualViewPortChanged, true)
        mobileDetect.enableTouchMove()
      }
      window.editor = undefined
      monacoEditorRef.current = null
      // The editors dispose their own models on unmount. A model left behind
      // anyway would make the next visit build a second one at the same uri,
      // and Monaco can then fail to attach the JSON schema to it - so sweep up
      // after them once they are gone
      // eslint-disable-next-line react/web-api-no-leaked-timeout -- runs after the unmount on purpose
      setTimeout(disposeLeftoverModels, 0)
    }
  }, [isMobile])

  // `?action=restore` (from the settings page) opens the backup list straight away
  useEffect(() => {
    const action = searchParams.get('action')
    if (!action || restoreActionHandledRef.current) {
      return
    }
    restoreActionHandledRef.current = true
    if (action === 'restore') {
      void onRestore(true)
    }
    // Clear the query parameters so that we don't keep showing the same action
    setSearchParams({}, { replace: true })
    // eslint-disable-next-line react/exhaustive-deps -- once, on arrival
  }, [])

  const onEditorMount = (editor: MonacoEditorNs.IStandaloneCodeEditor, monaco: Monaco) => {
    window.editor = editor
    monacoEditorRef.current = editor
    monacoRef.current = monaco
    // The model may outlive an earlier visit, so its content is set rather than defaulted
    const model = editor.getModel()
    if (model) {
      model.setValue(configRef.current)
    }
  }

  const onDiffEditorMount = (diffEditor: MonacoEditorNs.IStandaloneDiffEditor, monaco: Monaco) => {
    monacoEditorRef.current = diffEditor.getModifiedEditor()
    monacoRef.current = monaco
    window.editor = diffEditor
  }

  const setPlainTextEditor = (enabled: boolean): void => {
    if (!!enabled === preferPlainRef.current) {
      return
    }

    // When switching to plain text, carry any unsaved Monaco edits into
    // `homebridgeConfig` first — the textarea renders from it, and Monaco
    // edits are otherwise only synced into it on save.
    if (enabled && isMonacoActive()) {
      try {
        const value = monacoEditorRef.current!.getModel()?.getValue()
        if (typeof value === 'string') {
          writeConfig(value)
        }
      } catch (error) {
        console.error('Failed to read monaco editor value:', error)
      }
    }

    preferPlainRef.current = !!enabled
    setPreferPlainTextEditor(!!enabled)
    try {
      localStorage.setItem(PLAIN_TEXT_STORAGE_KEY, enabled ? 'true' : 'false')
    } catch {
      // localStorage can be unavailable (private mode, quota); silent fall back to in-memory
    }

    // When switching back to Monaco, push the latest config into the model
    // so the textarea's edits aren't lost.
    if (!enabled) {
      setTimeout(() => {
        try {
          if (monacoEditorRef.current && configRef.current) {
            monacoEditorRef.current.getModel()?.setValue(configRef.current)
            monacoEditorRef.current.focus()
          }
        } catch (error) {
          console.error('Failed to refocus monaco editor:', error)
        }
      }, 0)
    }
  }

  const clearDecorations = () => {
    if (monacoEditorRef.current) {
      editorDecorationsRef.current = monacoEditorRef.current.deltaDecorations(editorDecorationsRef.current, [])
    }
  }

  /**
   * Highlight the rows of an offending platform / accessory entry.
   * @param block - the entry, as JSON
   */
  const highlightOffendingArrayItem = (block: string) => {
    if (!isMonacoActive()) {
      return
    }

    // Figure out which lines the offending block spans, add leading space as per formatting rules
    const formatted = JSON.stringify(JSON.parse(block), null, 4).split('\n').map(x => `        ${x}`).join('\n')

    requestAnimationFrame(() => {
      const editor = monacoEditorRef.current
      const model = editor?.getModel()
      if (!editor || !model) {
        return
      }
      const matches = model.findMatches(formatted, false, false, false, null, false)

      if (matches.length) {
        editorDecorationsRef.current = editor.deltaDecorations(editorDecorationsRef.current, [
          { range: matches[0].range, options: { isWholeLine: true, linesDecorationsClassName: 'hb-monaco-editor-line-error' } },
        ])
      }
    })
  }

  const parseConfigFromEditor = () => {
    try {
      return JSON.parse(configRef.current)
    } catch {
      const config = json5.parse(configRef.current)
      writeConfig(JSON.stringify(config, null, 4))
      if (isMonacoActive()) {
        monacoEditorRef.current!.getModel()!.setValue(configRef.current)
      }
      return config
    }
  }

  const performFullRestart = async (restartService: boolean) => {
    // If restartService is true, set the flag to do a full service restart
    if (restartService) {
      await api.put('/platform-tools/hb-service/set-full-service-restart-flag', {})
    }

    const ref = openModal(RestartHomebridge, {}, {
      size: 'lg',
      backdrop: 'static',
    })

    const state = restartStateRef.current
    try {
      await ref.result
      state.hbPendingRestart = false
      state.childBridgesToRestart = []
    } catch {
      // Declined: the config is on disk either way, so the restart is still owed
      state.hbPendingRestart = true
    }
  }

  const performChildBridgeRestart = async () => {
    const state = restartStateRef.current
    // If there are no child bridges to restart, fall through to full restart
    if (!state.childBridgesToRestart.length) {
      await performFullRestart(false)
      return
    }

    const ref = openModal(RestartChildBridges, { bridges: state.childBridgesToRestart }, {
      size: 'lg',
      backdrop: 'static',
    })

    // If the user dismisses the modal, the child bridges are still pending a restart
    try {
      await ref.result
      state.childBridgesToRestart = []
    } catch { /* modal dismissed */ }
  }

  const detectSavesChangesForRestart = async (affectedBridges?: ChildBridge[]) => {
    const state = restartStateRef.current
    const restartType = await determineRestartType(state, configRef.current, {
      affectedBridges,
      getChildBridges: () => childBridges.getAll(),
      onNothingChanged: () => toast.info(t('config.no_restart'), t('config.config_saved')),
    })

    if (restartType === 'full') {
      // A change to the UI's own `config` platform entry needs a full service restart
      await performFullRestart(detectConfigPlatformChanges(state.latestSavedConfig, configRef.current))
    } else if (restartType === 'child') {
      await performChildBridgeRestart()
    }

    state.latestSavedConfig = JSON.parse(configRef.current)
  }

  const saveConfig = async (config: HomebridgeConfig) => {
    try {
      const response = await api.post<{ config: HomebridgeConfig, affectedBridges: ChildBridge[] }>(
        '/config-editor?include=restart-info',
        config,
      )
      writeConfig(JSON.stringify(response.config, null, 4))
      // Push the server-normalised text into the Monaco model so the
      // editor's view matches the canonical saved state. Without this,
      // any whitespace / key-order normalisation the server applied
      // makes determineRestartType think the editor still differs from
      // the saved config, surfacing phantom restart prompts after a
      // no-op save. (Plain-text mode renders from `homebridgeConfig`
      // directly, so only an active Monaco needs the push.)
      if (isMonacoActive()) {
        monacoEditorRef.current!.getModel()?.setValue(configRef.current)
      }
      // The server returns the affected bridges inline, so no follow-up
      // /status/homebridge/child-bridges call is needed for the restart targets
      await detectSavesChangesForRestart(response.affectedBridges)
    } catch (error) {
      console.error(error)
      toast.error(t('config.failed_to_save_config'), t('toast.title_error'))
    }
  }

  const onSave = async () => {
    if (savingRef.current) {
      return
    }

    // Hide decorations
    if (isMonacoActive()) {
      clearDecorations()
    }

    writeSaveInProgress(true)
    // Verify homebridgeConfig contains valid json
    try {
      // Get the value from the editor. Only consult Monaco when it is the
      // active surface — in plain-text mode the textarea has already kept
      // `homebridgeConfig` in sync, and reading the retained Monaco model
      // here would clobber those edits with its stale content.
      if (isMonacoActive()) {
        const editor = monacoEditorRef.current!
        // Format the document
        await editor.getAction('editor.action.formatDocument')?.run()

        // Check for issues, specifically block saving if there are any duplicate keys
        const issues = monacoRef.current?.editor.getModelMarkers({ owner: 'json' }) ?? []

        for (const issue of issues) {
          if (issue.message === 'Duplicate object key') {
            writeSaveInProgress(false)
            toast.error(t('config.config_invalid_json'), t('toast.title_error'))
            return
          }
        }

        // Set the value
        writeConfig(editor.getModel()!.getValue())
      }

      // Get the config from the editor
      const config = parseConfigFromEditor()

      // Ensure it's formatted so errors can be easily spotted
      writeConfig(JSON.stringify(config, null, 4))

      // Basic validation of homebridge config spec
      const problem = findConfigProblem(config)
      if (problem) {
        toast.error(t(problem.key, problem.params), t('toast.title_error'))
        if (problem.offendingBlock !== undefined) {
          highlightOffendingArrayItem(problem.offendingBlock)
        }
      } else {
        await saveConfig(config)
        writeOriginalConfig('')
      }
    } catch (error) {
      console.error(error)
      toast.error(t('config.config_invalid_json'), t('toast.title_error'))
    }
    writeSaveInProgress(false)
  }

  async function onRestore(fromSettings = false): Promise<void> {
    const ref = openModal(ConfigRestore, {
      currentConfig: configRef.current,
      fromSettings,
    }, {
      size: 'lg',
      backdrop: 'static',
    })

    let backupId: string
    try {
      backupId = await ref.result
    } catch {
      // Modal dismissed, do nothing
      return
    }

    try {
      if (!originalRef.current) {
        writeOriginalConfig(configRef.current)
      }

      const json = await api.get(`/config-editor/backups/${backupId}`)
      toast.info(t('config.restore.confirm'), t('config.title_backup_loaded'))

      // The diff editor takes this as its modified side
      writeConfig(JSON.stringify(json, null, 4))
      clearDecorations()
    } catch (error: unknown) {
      console.error(error)
      const errorMessage = (error as { error?: { message?: string } })?.error?.message || t('backup.load_error')
      toast.error(errorMessage, t('toast.title_error'))
    }
  }

  const onCancelRestore = () => {
    window.editor = undefined
    writeConfig(originalRef.current)
    writeOriginalConfig('')
    // Back to the default view
    setRenderSideBySide(false)
    void onRestore()
  }

  const toggleSideBySide = () => setRenderSideBySide(value => !value)

  const confirmDiscardChanges = (): Promise<boolean> => {
    const ref = openModal(Confirm, {
      title: t('config.label_unsaved_changes'),
      message: t('config.message_unsaved_changes'),
      confirmButtonLabel: t('form.button_discard'),
      confirmButtonClass: 'btn-danger',
      faIconClass: 'fas fa-triangle-exclamation orange-text',
    }, {
      size: 'lg',
      backdrop: 'static',
    })
    return ref.result.then(() => true, () => false)
  }

  useCanDeactivate(() => {
    const { latestSavedConfig } = restartStateRef.current
    if (!latestSavedConfig) {
      return true
    }
    // Read from whichever editing surface is active: the textarea keeps
    // `homebridgeConfig` in sync as the user types, so only an active
    // Monaco holds edits the state hasn't seen yet.
    const rawValue = isMonacoActive()
      ? monacoEditorRef.current!.getModel()!.getValue()
      : configRef.current
    let editorValue: HomebridgeConfig
    try {
      editorValue = json5.parse(rawValue)
    } catch {
      // Invalid JSON in the editor — definitely an unsaved state worth warning about.
      return confirmDiscardChanges()
    }
    if (isEqual(editorValue, latestSavedConfig)) {
      return true
    }
    return confirmDiscardChanges()
  })

  const onEditorKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void onSave()
    }
  }

  const editorWrapperProps = {
    className: 'flex-grow-1 h-100 w-100 mt-3 mb-0',
    onKeyDown: onEditorKeyDown,
  }

  const showPlainText = preferPlainTextEditor || isMobile
  const sideBySideLabel = translate(renderSideBySide ? 'config.restore.view_inline' : 'config.restore.view_side_by_side')

  return (
    <div className="flex-column d-flex align-items-stretch h-100">
      <div className="row">
        <div className="col-6 hb-config-editor-title">
          <h3 className="primary-text m-0">{translate('menu.config_json_editor')}</h3>
        </div>
        <div className="col-6 text-end hb-config-editor-actions">
          <Dropdown align="end" className="d-none d-sm-inline-block me-2">
            <HoverTooltip text={translate('config.editor_mode')} placement="bottom">
              <Dropdown.Toggle
                as="button"
                id="hb-editor-mode-toggle"
                type="button"
                className="btn btn-elegant my-0"
                aria-label={translate('config.editor_mode')}
              >
                <i aria-hidden="true" className="far fa-pen-to-square"></i>
              </Dropdown.Toggle>
            </HoverTooltip>
            <Dropdown.Menu role="menu" aria-label={translate('config.editor_mode')} aria-labelledby="hb-editor-mode-toggle">
              <Dropdown.Item
                as="button"
                type="button"
                role="menuitemradio"
                active={!preferPlainTextEditor}
                aria-checked={!preferPlainTextEditor}
                onClick={() => setPlainTextEditor(false)}
              >
                <span className="hb-editor-mode-check">
                  {!preferPlainTextEditor && <i aria-hidden="true" className="fas fa-check primary-text"></i>}
                </span>
                {translate('config.editor_mode_default')}
              </Dropdown.Item>
              <Dropdown.Item
                as="button"
                type="button"
                role="menuitemradio"
                active={preferPlainTextEditor}
                aria-checked={preferPlainTextEditor}
                onClick={() => setPlainTextEditor(true)}
              >
                <span className="hb-editor-mode-check">
                  {preferPlainTextEditor && <i aria-hidden="true" className="fas fa-check primary-text"></i>}
                </span>
                {translate('config.editor_mode_plain')}
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown>
          {originalConfig
            ? (
                <HoverTooltip text={translate('form.button_cancel')} placement="bottom">
                  <button
                    type="button"
                    className="btn btn-danger waves-effect my-0 me-2"
                    disabled={saveInProgress}
                    aria-label={translate('form.button_cancel')}
                    onClick={onCancelRestore}
                  >
                    <i aria-hidden="true" className="fas fa-times"></i>
                  </button>
                </HoverTooltip>
              )
            : (
                <HoverTooltip text={translate('form.button_restore')} placement="bottom">
                  <button
                    type="button"
                    className="btn btn-elegant waves-effect my-0 me-2"
                    aria-label={translate('form.button_restore')}
                    onClick={() => void onRestore()}
                  >
                    <i aria-hidden="true" className="fas fa-history"></i>
                  </button>
                </HoverTooltip>
              )}
          {!isMobile && originalConfig && (
            <HoverTooltip text={sideBySideLabel} placement="bottom">
              <button
                type="button"
                className="btn btn-elegant waves-effect my-0 me-2"
                aria-label={sideBySideLabel}
                onClick={toggleSideBySide}
              >
                <i aria-hidden="true" className={renderSideBySide ? 'fas fa-bars' : 'fas fa-columns'}></i>
              </button>
            </HoverTooltip>
          )}
          <HoverTooltip text={translate('form.button_save')} placement="bottom">
            <button
              type="button"
              className="btn btn-elegant waves-effect my-0 me-0"
              disabled={saveInProgress}
              aria-label={translate('form.button_save')}
              onClick={() => void onSave()}
            >
              {saveInProgress
                ? <i aria-hidden="true" className="fas fa-circle-notch fa-spin"></i>
                : <i aria-hidden="true" className="fas fa-floppy-disk"></i>}
            </button>
          </HoverTooltip>
        </div>
      </div>

      {!showPlainText && !originalConfig && (
        <MonacoEditor
          language="json"
          path={CONFIG_MODEL_URI}
          defaultValue={homebridgeConfig}
          options={editorOptions}
          jsonSchema={schemaEntry}
          wrapperProps={editorWrapperProps}
          onMount={onEditorMount}
        />
      )}
      {!showPlainText && originalConfig && (
        <MonacoDiffEditor
          language="json"
          original={originalConfig}
          modified={homebridgeConfig || '{}'}
          originalModelPath={DIFF_ORIGINAL_URI}
          modifiedModelPath={DIFF_MODIFIED_URI}
          options={editorOptions}
          wrapperProps={editorWrapperProps}
          onMount={onDiffEditorMount}
        />
      )}
      {showPlainText && (
        <textarea
          wrap="off"
          className="hb-plain-text-editor align-self-end h-100 w-100 my-3"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={translate('menu.config_json_editor')}
          value={homebridgeConfig}
          onChange={event => writeConfig(event.target.value)}
        >
        </textarea>
      )}
    </div>
  )
}
