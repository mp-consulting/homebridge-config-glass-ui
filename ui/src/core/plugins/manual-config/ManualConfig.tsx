import type { ManualConfigEditor, ManualConfigMonaco } from '@/core/plugins/manual-config/manual-config.controller'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { PluginModalData } from '@/core/ui/modal-data'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { Markdown } from '@/core/components/markdown/Markdown'
import { MonacoEditor } from '@/core/monaco'
import { interpolateMd } from '@/core/pipes/interpolate-md'
import { cls } from '@/core/plugins/class-names'
import { managePlugins } from '@/core/plugins/manage-plugins'
import { ManualConfigController } from '@/core/plugins/manual-config/manual-config.controller'
import { useSettingsStore } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { i18n } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { childBridges } from '@/core/utilities/child-bridges'
import { mobileDetect } from '@/core/utilities/mobile-detect'

import './manual-config.scss'

export type ManualConfigProps = PluginModalData & ModalComponentProps

const EDITOR_OPTIONS = { language: 'json' }
const EDITOR_WRAPPER_PROPS = { className: 'flex-grow-1 h-100 w-100 mb-0 pb-0' }

function validityLabel(valid: boolean, strict: boolean): string {
  return valid ? 'form.label_valid' : strict ? 'form.label_invalid_strict' : 'form.label_invalid'
}

/** Edit a plugin's config blocks as raw JSON (json5), validated against its schema. */
export function ManualConfig({ activeModal, plugin, schema, editorContext }: ManualConfigProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [ctrl] = useState(() => {
    const { env } = useSettingsStore.getState()
    const flags = env.featureFlags ?? {}
    return new ManualConfigController({
      api,
      toastError: (message, title) => toast.error(message, title),
      t: i18n.t.bind(i18n),
      close: () => activeModal.close(),
      navigate: path => void navigate(path),
      bridgeSettings: (p, justInstalled) => managePlugins.bridgeSettings(p, justInstalled),
      openCorrectRestartModalWithBridges: bridges => childBridges.openCorrectRestartModalWithBridges(bridges),
      isMobile: () => Boolean(mobileDetect.detect.mobile()),
      featureFlags: {
        childBridgeDebugMode: Boolean(flags.childBridgeDebugMode),
        matterSupport: Boolean(flags.matterSupport),
        protocolExternalsOnly: Boolean(flags.protocolExternalsOnly),
        matterDisableIpv4: Boolean(flags.matterDisableIpv4),
        hapDisableIdentifyingMaterial: Boolean(flags.hapDisableIdentifyingMaterial),
      },
      recommendChildBridges: () => Boolean(useSettingsStore.getState().env.recommendChildBridges),
    }, plugin, schema, editorContext)
  })
  useSyncExternalStore(ctrl.subscribe, ctrl.getVersion)

  useEffect(() => {
    ctrl.init()
    return () => ctrl.destroy()
  }, [ctrl])

  const { pluginType, pluginAlias } = ctrl
  // Registered while an editor is mounted (Angular's setupSchemaValidation on editor init)
  const jsonSchema = useMemo(
    () => (pluginType ? ctrl.buildSchema() : null),
    // buildSchema reads the alias and type off the (mutable) controller
    // eslint-disable-next-line react/exhaustive-deps
    [ctrl, pluginType, pluginAlias],
  )

  const strict = ctrl.strictValidation
  const blockCount = ctrl.pluginConfig.length

  return (
    <div className="modal-content hb-manual-config">
      <div className="modal-header">
        <h5 className="modal-title">
          {plugin?.displayName || plugin?.name}
          {' - '}
          {pluginType}
        </h5>
        <button
          type="button"
          className="btn-close"
          data-bs-dismiss="modal"
          aria-label={t('form.button_close')}
          disabled={ctrl.saveInProgress}
          onClick={() => activeModal.close()}
        >
        </button>
      </div>
      <div className="modal-body pb-0">
        {ctrl.loading && (
          <div className="text-center primary-text my-5 w-100">
            <i className="fas fa-circle-notch fa-spin icon-xl" aria-hidden="true"></i>
          </div>
        )}
        {!ctrl.loading && !ctrl.canConfigure && (
          <div className="alert alert-warning mb-0">
            {t('plugins.settings.message_manual_config_required')}
            {' '}
            {t('plugins.settings.message_consult_documentation')}
          </div>
        )}
        {schema?.headerDisplay && <Markdown className="plugin-md" data={interpolateMd(schema.headerDisplay)} />}

        {/* MULTIPLE CONFIG BLOCKS */}
        {!ctrl.loading && ctrl.canConfigure && (
          <>
            {/* ngbAccordion [closeOthers]="true" */}
            <div className="accordion">
              {ctrl.pluginConfig.map((block, index) => {
                const id = `configBlock.${index}`
                const open = ctrl.show === id
                const valid = ctrl.formBlocksValid[index]
                return (
                  // eslint-disable-next-line react/no-array-index-key -- blocks have no id; Angular tracked by object identity
                  <div key={index} className="card accordion-item" id={id}>
                    <div className="card-header accordion-header">
                      <div className="d-flex align-items-center justify-content-between">
                        <h5 className="m-0 py-2 ps-1">{(block.name as string) || pluginAlias}</h5>
                        <div>
                          {(!schema?.singular || blockCount > 1) && (
                            <>
                              {open && (
                                <HoverTooltip text={t('form.button_delete')}>
                                  <button type="button" className="btn btn-danger m-0 ms-2" onClick={() => ctrl.removeBlock(index)}>
                                    <i className="fas fa-trash-can" aria-hidden="true"></i>
                                  </button>
                                </HoverTooltip>
                              )}
                              <HoverTooltip text={t('form.button_edit')}>
                                <button
                                  type="button"
                                  className={cls('btn btn-primary m-0 ms-2 me-2', !open && 'collapsed')}
                                  id={`${id}-toggle`}
                                  aria-controls={`${id}-collapse`}
                                  aria-expanded={open}
                                  onClick={() => ctrl.editBlock(index)}
                                >
                                  <i className="far fa-pen-to-square" aria-hidden="true"></i>
                                </button>
                              </HoverTooltip>
                            </>
                          )}
                          {!schema?.singular && (
                            <HoverTooltip text={t(validityLabel(valid, strict))} placement="left">
                              <i
                                className={cls(
                                  'fas fa-xl',
                                  valid && 'fa-circle-check green-text',
                                  !valid && 'fa-circle-exclamation',
                                  strict && !valid && 'red-text',
                                  !strict && !valid && 'orange-text',
                                )}
                              >
                              </i>
                            </HoverTooltip>
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      className={cls('accordion-collapse collapse', open && 'show')}
                      id={`${id}-collapse`}
                      role="region"
                      aria-labelledby={`${id}-toggle`}
                    >
                      <div className="accordion-body card-body p-0 editor-body">
                        {/* Only the open block has an editor: the others are hidden, and Angular's all showed the same block */}
                        {open && (
                          <BlockEditor ctrl={ctrl} jsonSchema={jsonSchema} />
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {schema?.footerDisplay && (
              <div className="mt-3">
                <Markdown className="plugin-md" data={interpolateMd(schema.footerDisplay)} />
              </div>
            )}
          </>
        )}
      </div>
      <div className="modal-footer justify-content-between">
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            disabled={ctrl.saveInProgress}
            onClick={() => activeModal.close()}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end d-flex align-items-center justify-content-end">
          {ctrl.canConfigure
            ? (
                <>
                  {schema?.singular
                    ? (
                        <HoverTooltip text={t(validityLabel(ctrl.formIsValid, strict))}>
                          <i
                            className={cls(
                              'fas fa-xl me-2',
                              ctrl.formIsValid && 'fa-circle-check green-text',
                              !ctrl.formIsValid && 'fa-circle-exclamation',
                              strict && !ctrl.formIsValid && 'red-text',
                              !strict && !ctrl.formIsValid && 'orange-text',
                            )}
                          >
                          </i>
                        </HoverTooltip>
                      )
                    : (
                        <button type="button" className="btn btn-elegant me-2" data-bs-dismiss="modal" onClick={() => ctrl.addBlock()}>
                          <i className="fas fa-plus" aria-hidden="true"></i>
                        </button>
                      )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-bs-dismiss="modal"
                    disabled={ctrl.saveInProgress || (!ctrl.formIsValid && strict)}
                    onClick={() => void ctrl.save()}
                  >
                    {!ctrl.saveInProgress
                      ? t('form.button_save')
                      : <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>}
                  </button>
                </>
              )
            : (
                <button className="btn btn-primary" type="button" onClick={() => ctrl.openFullConfigEditor()}>
                  {t('plugins.settings.label_open_config_editor')}
                </button>
              )}
        </div>
      </div>
    </div>
  )
}

/** The Monaco editor of the open block; hands itself to the controller while mounted. */
function BlockEditor({ ctrl, jsonSchema }: { ctrl: ManualConfigController, jsonSchema: ReturnType<ManualConfigController['buildSchema']> | null }) {
  useEffect(() => () => ctrl.detachEditor(), [ctrl])
  return (
    <MonacoEditor
      options={EDITOR_OPTIONS}
      language="json"
      wrapperProps={EDITOR_WRAPPER_PROPS}
      jsonSchema={jsonSchema}
      onMount={(editor, monaco) => void ctrl.onEditorInit(editor as unknown as ManualConfigEditor, monaco as unknown as ManualConfigMonaco)}
    />
  )
}
