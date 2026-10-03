import type { CustomPluginsViewState } from '@/core/plugins/custom-plugins/custom-plugins.controller'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { CustomPluginsModalData } from '@/core/ui/modal-data'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { CustomPluginsController } from '@/core/plugins/custom-plugins/custom-plugins.controller'
import { useSettingsStore } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { ModalFooter } from '@/core/ui/ModalParts'
import { cx } from '@/core/utilities/cx'
import { SchemaForm } from '@/schema-form'

import './custom-plugins.scss'

export type CustomPluginsProps = CustomPluginsModalData & ModalComponentProps

/**
 * A plugin's own settings page, in an iframe, talking to the app over the
 * plugin-ui-utils postMessage protocol (CustomPluginsComponent). The protocol
 * lives in `CustomPluginsController`; this renders its state.
 */
export function CustomPlugins({ activeModal, plugin, schema, pluginConfig }: CustomPluginsProps) {
  const { t } = useTranslation()
  const lang = useSettingsStore(state => state.env.lang)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // The config blocks are shared, and edited in place, by every controller
  // this modal gets (StrictMode mounts it twice in development)
  const [blocks] = useState<Record<string, unknown>[]>(() => pluginConfig ?? [])
  const [controller, setController] = useState<CustomPluginsController | null>(null)
  const [view, setView] = useState<CustomPluginsViewState | null>(null)

  useEffect(() => {
    // One controller per mount: it owns a namespace reference, a window
    // listener and the asset session, all released in destroy()
    const instance = new CustomPluginsController({
      plugin,
      schema,
      pluginConfig: blocks,
      activeModal,
      getIframe: () => iframeRef.current,
    })
    const unsubscribe = instance.subscribe(() => setView(instance.getState()))
    instance.start()
    // The controller is an external resource taken here, so its handle and
    // first state are published from the effect on purpose
    // eslint-disable-next-line react/set-state-in-effect
    setController(instance)
    // eslint-disable-next-line react/set-state-in-effect
    setView(instance.getState())
    return () => {
      unsubscribe()
      instance.destroy()
    }
    // One plugin per modal
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  const state = view ?? {
    loading: true,
    saveInProgress: false,
    pluginSpinner: false,
    saveButtonDisabled: false,
    uiLoaded: false,
    showSchemaForm: false,
    formId: undefined,
    formSchema: undefined,
    formData: undefined,
    formSubmitButtonLabel: undefined,
    formCancelButtonLabel: undefined,
    formValid: true,
    formIsValid: true,
    isFirstSave: blocks.length === 0,
    firstBlock: blocks[0],
  } satisfies CustomPluginsViewState

  const strictValidation = !!schema?.strictValidation

  const dismissModal = () => void controller?.dismissModal()

  return (
    <div className="modal-content hb-custom-plugins">
      <div className="modal-header">
        <h5 className="modal-title">{plugin?.displayName || plugin?.name}</h5>
        <button
          type="button"
          className="btn-close"
          aria-label={t('form.button_close')}
          disabled={state.saveInProgress}
          onClick={dismissModal}
        >
        </button>
      </div>
      <div className="modal-body pb-0 modal-body-min-height">
        {state.loading && (
          <div className="text-center primary-text my-5 w-100">
            <InlineSpinner className="icon-xl" />
          </div>
        )}

        {/*
          The sandbox is part of the plugin-ui-utils contract: plugin pages rely on each of these.

          ⚠️ Accepted risk: `allow-same-origin` + `allow-scripts` on a page served from the UI's own
          origin means a plugin's settings page is not isolated from the UI - it can script this
          window, read its DOM and call the api as the signed-in admin. That is the long-standing
          trust model (installing a plugin already runs its code on the server, as the Homebridge
          user), and dropping `allow-same-origin` breaks custom UIs outright:
          - the plugin's own scripts, styles and images load with the `hb-plugin-ui` asset-session
            cookie (SameSite=Strict, plugins-settings-ui.controller.ts); an opaque-origin frame's
            subresource requests are cross-site, so the cookie is never sent and every asset 401s
          - plugin pages commonly use localStorage/sessionStorage, which throw in an opaque origin
          - the message channel is origin-pinned both ways (custom-plugins.controller.ts posts to
            environment.api.origin and only accepts events from it), and an opaque frame is "null"
          - the theme and glass styles are applied through iframe.contentDocument (settings.store.ts)
          Isolating plugin UIs needs a separate origin for them, not a sandbox flag. See CHANGELOG.
        */}
        <iframe
          ref={iframeRef}
          width="100%"
          height="1px;"
          className="plugin-iframe"
          // eslint-disable-next-line react/dom-no-unsafe-iframe-sandbox
          sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-forms"
          title={t('plugins.button_settings')}
          aria-label={t('plugins.button_settings')}
        >
        </iframe>

        {/* blocks[0] is read live: the plugin page can add or replace it */}
        {state.uiLoaded && blocks.length > 0 && schema?.singular && state.showSchemaForm && (
          <div className="card card-body">
            <SchemaForm
              configSchema={schema}
              data={blocks[0]}
              lang={lang ?? undefined}
              onDataChange={data => controller?.setFirstBlock(data)}
              onDataChanged={data => controller?.schemaFormUpdatedSubject.next(data)}
              onValidChange={isValid => controller?.onIsValid(isValid)}
            />
          </div>
        )}
        {state.formId && (
          <div className="card card-body">
            <SchemaForm
              configSchema={state.formSchema}
              data={state.formData}
              lang={lang ?? undefined}
              onDataChange={data => controller?.setState({ formData: data })}
              onDataChanged={data => controller?.formUpdatedSubject.next(data)}
              onValidChange={isValid => controller?.formValidEvent(isValid)}
            />
            <div className="text-end custom-form-action-buttons">
              {state.formCancelButtonLabel && (
                <button className="btn btn-elegant" type="button" onClick={() => controller?.formActionSubject.next('cancel')}>
                  {state.formCancelButtonLabel}
                </button>
              )}
              {state.formSubmitButtonLabel && (
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={!state.formValid}
                  onClick={() => controller?.formActionSubject.next('submit')}
                >
                  {state.formSubmitButtonLabel}
                </button>
              )}
            </div>
          </div>
        )}
        {state.pluginSpinner && (
          <div className="loading-overlay text-center primary-text d-flex align-items-center justify-content-center">
            <InlineSpinner className="icon-xl" />
          </div>
        )}
      </div>
      <ModalFooter>
        <div className="text-start">
          <button type="button" className="btn btn-elegant" disabled={state.saveInProgress} onClick={dismissModal}>
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end d-flex align-items-center justify-content-end">
          {!state.saveButtonDisabled && (
            <HoverTooltip
              text={t(state.formIsValid ? 'form.label_valid' : strictValidation ? 'form.label_invalid_strict' : 'form.label_invalid')}
            >
              <i
                className={cx(
                  'fas fa-xl me-2',
                  state.formIsValid && 'fa-circle-check green-text',
                  !state.formIsValid && 'fa-circle-exclamation',
                  strictValidation && !state.formIsValid && 'red-text',
                  !strictValidation && !state.formIsValid && 'orange-text',
                )}
                role="img"
                aria-label={t(state.formIsValid ? 'form.label_valid' : strictValidation ? 'form.label_invalid_strict' : 'form.label_invalid')}
              >
              </i>
            </HoverTooltip>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={state.saveInProgress || state.saveButtonDisabled}
            onClick={() => void controller?.savePluginConfig(true)}
          >
            {!state.saveInProgress
              ? t('form.button_save')
              : <InlineSpinner />}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
