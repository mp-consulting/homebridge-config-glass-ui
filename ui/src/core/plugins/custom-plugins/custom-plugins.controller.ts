import type { ChildBridge, Plugin } from '@/core/plugins/manage-plugins.interfaces'
import type { ActiveModal } from '@/core/ui/modal'
import type { OwnedIoNamespace } from '@/core/ws'
import type { Subscription } from 'rxjs'

import { Subject } from 'rxjs'
import { debounceTime, skip } from 'rxjs/operators'

import { api } from '@/core/api'
import { cachedAccessoriesCache } from '@/core/caching/cached-accessories-cache'
import { postCustomUiStyles } from '@/core/plugins/custom-ui-styles'
import { managePlugins } from '@/core/plugins/manage-plugins'
import { useSettingsStore } from '@/core/settings'
import { i18n, t } from '@/core/ui/i18n'
import { toast } from '@/core/ui/toast'
import { childBridges } from '@/core/utilities/child-bridges'
import { createEmitter } from '@/core/utilities/emitter'
import { toastApiError, toToastMessage } from '@/core/utilities/http-error'
import { ws } from '@/core/ws'
import { environment } from '@/environments/environment'
import en from '@/i18n/en.json'

/** What the modal renders from. Replaced (never mutated) on every change. */
export interface CustomPluginsViewState {
  loading: boolean
  saveInProgress: boolean
  pluginSpinner: boolean
  saveButtonDisabled: boolean
  uiLoaded: boolean
  showSchemaForm: boolean
  formId: string | undefined
  formSchema: any
  formData: any
  formSubmitButtonLabel: string | undefined
  formCancelButtonLabel: string | undefined
  formValid: boolean
  formIsValid: boolean
  isFirstSave: boolean
  /** The block the generated form edits; a new object when the plugin replaced it. */
  firstBlock: Record<string, unknown> | undefined
}

export interface CustomPluginsControllerOptions {
  plugin: Plugin
  schema: any
  /** The config blocks; edited in place, as the plugin page and the form share them. */
  pluginConfig: Record<string, unknown>[]
  activeModal: Pick<ActiveModal, 'close' | 'dismiss'>
  /** The iframe the plugin page loads into, once it is rendered. */
  getIframe: () => HTMLIFrameElement | null
}

/**
 * The plugin-ui-utils host: everything CustomPluginsComponent did, minus the
 * template. This is a frozen contract with `@homebridge/plugin-ui-utils`
 * (`ui.js` in the iframe and the server-side helper behind the
 * `plugins/settings-ui` namespace): the action names, payload shapes,
 * response envelope (`{ action: 'response', requestId, success, data }`),
 * stream envelope, target origins and debounce timings are kept exactly.
 *
 * One controller lives for one mount of the modal: `start()` on mount,
 * `destroy()` on unmount.
 */
export class CustomPluginsController {
  public readonly plugin: Plugin
  public readonly schema: any
  public readonly pluginConfig: Record<string, unknown>[]
  public readonly pluginAlias: string
  public readonly pluginType: 'platform' | 'accessory'
  public readonly strictValidation: boolean

  private state: CustomPluginsViewState
  private readonly changes = createEmitter()
  private activeModal: Pick<ActiveModal, 'close' | 'dismiss'>
  private getIframe: () => HTMLIFrameElement | null

  private io: OwnedIoNamespace | null = null
  private basePath = ''
  private iframe: HTMLIFrameElement | null = null
  private iframeLoadInProgress = false
  private schemaFormRecentlyRefreshed = false
  private assetSessionRequested = false
  private assetSessionRevoked = false
  private destroyed = false
  private subscriptions: Subscription[] = []
  private unsubscribeConnected: (() => void) | null = null

  public readonly schemaFormUpdatedSubject = new Subject<unknown>()
  public readonly schemaFormRefreshSubject = new Subject<unknown>()
  public readonly formUpdatedSubject = new Subject<unknown>()
  public readonly formActionSubject = new Subject<'cancel' | 'submit'>()

  constructor(options: CustomPluginsControllerOptions) {
    this.plugin = options.plugin
    this.schema = options.schema
    this.pluginConfig = options.pluginConfig
    this.activeModal = options.activeModal
    this.getIframe = options.getIframe
    this.pluginAlias = options.schema?.pluginAlias
    this.pluginType = options.schema?.pluginType
    this.strictValidation = options.schema?.strictValidation
    this.state = {
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
      isFirstSave: this.pluginConfig.length === 0,
      firstBlock: this.pluginConfig[0],
    }
  }

  // ===== The view state =====

  public getState = (): CustomPluginsViewState => this.state

  public subscribe = (listener: () => void): (() => void) => this.changes.subscribe(listener)

  public setState(patch: Partial<CustomPluginsViewState>): void {
    this.state = { ...this.state, ...patch }
    this.changes.emit()
  }

  // ===== Lifecycle =====

  public start(): void {
    if (!this.schema || !this.plugin) {
      console.error('CustomPluginsComponent: schema or plugin not provided')
      this.activeModal.dismiss('Missing required data')
      return
    }

    const io = ws.connectToNamespace('plugins/settings-ui')
    this.io = io
    this.basePath = `/plugins/settings-ui/${encodeURIComponent(this.plugin.name)}`

    // The server-side helper is tied to the socket and dies with it, so the plugin has to be
    // introduced to the server on every connection, not just the first. Subscribing to `connected`
    // covers all three cases with one path — a cache-hit reopen, the initial connect and each
    // reconnect — and it is the only place 'start' is emitted: emitting directly as well would
    // fire it twice on a cache hit (see the WsService doc comment).
    this.unsubscribeConnected = io.connected.subscribe(() => {
      io.socket.emit('start', this.plugin.name)
    })

    // The iframe is only assigned once the socket reports 'ready' (loadUi),
    // and its contentWindow is nulled when the modal is torn down, so guard
    // both dereferences.
    io.socket.on('response', (data: any) => {
      data.action = 'response'
      this.iframe?.contentWindow?.postMessage(data, environment.api.origin)
    })

    io.socket.on('stream', (data: any) => {
      data.action = 'stream'
      this.iframe?.contentWindow?.postMessage(data, environment.api.origin)
    })

    io.socket.on('ready', () => {
      this.setState({ loading: false })
      void this.loadUi()
    })

    this.subscriptions.push(
      this.schemaFormRefreshSubject
        .pipe(debounceTime(250))
        .subscribe(() => this.schemaFormRefresh()),
      this.schemaFormUpdatedSubject
        .pipe(debounceTime(250), skip(1))
        .subscribe(() => this.schemaFormUpdated()),
      this.formUpdatedSubject
        .pipe(debounceTime(100), skip(1))
        .subscribe(data => this.formUpdated(data)),
      this.formActionSubject
        .subscribe(formEvent => this.formActionEvent(formEvent)),
    )

    window.addEventListener('message', this.handleMessage, false)
  }

  public destroy(): void {
    this.destroyed = true
    // Covers every way the modal goes away, including the Escape-key dismissal.
    void this.revokeAssetSession()

    window.removeEventListener('message', this.handleMessage)

    this.unsubscribeConnected?.()

    // Remove socket event listeners before ending the connection. The socket
    // is cached by the ws service and outlives this modal — any listener left
    // behind would post to this instance's destroyed iframe the next time
    // the custom UI is opened (#2873).
    if (this.io?.socket) {
      this.io.socket.removeAllListeners('response')
      this.io.socket.removeAllListeners('stream')
      this.io.socket.removeAllListeners('ready')
    }
    this.io?.end()

    this.subscriptions.forEach(subscription => subscription.unsubscribe())
    this.schemaFormRefreshSubject.complete()
    this.schemaFormUpdatedSubject.complete()
    this.formUpdatedSubject.complete()
    this.formActionSubject.complete()
  }

  // ===== What the template calls =====

  public onIsValid(isValid: boolean): void {
    this.setState({ formIsValid: isValid })
  }

  /** Fired when the custom form changes, with whether it is valid. */
  public formValidEvent(isValid: boolean): void {
    this.setState({ formValid: isValid })
  }

  /** The generated form handed its data back (two-way binding of `pluginConfig[0]`). */
  public setFirstBlock(data: Record<string, unknown>): void {
    this.pluginConfig[0] = data
  }

  public async savePluginConfig(exit = false): Promise<boolean> {
    this.setState({ saveInProgress: true })
    try {
      const response = await api.post<{ config: any[], affectedBridges: ChildBridge[] }>(
        `/config-editor/plugin/${encodeURIComponent(this.plugin.name)}?include=restart-info`,
        this.pluginConfig,
      )
      const newConfig = response.config
      this.setState({ saveInProgress: false })

      if (exit) {
        // If it is the first time configuring the plugin, then offer to set up a child bridge straight away
        if (this.state.isFirstSave && useSettingsStore.getState().env.recommendChildBridges && newConfig[0]?.platform) {
          // Close the modal and open the child bridge setup modal
          await this.revokeAssetSession()
          this.activeModal.close()
          void managePlugins.bridgeSettings(this.plugin, true)
          return true
        }

        // Shows the child bridge restart modal if needed, otherwise the full
        // restart homebridge modal. The affected bridges arrive inline on the
        // save response, so there is no follow-up fetch.
        await this.revokeAssetSession()
        this.activeModal.close()
        childBridges.openCorrectRestartModalWithBridges(response.affectedBridges)
      }
      return true
    } catch (error) {
      console.error(error)
      toastApiError(error, 'config.failed_to_save_config')
      this.setState({ saveInProgress: false })
      return false
    }
  }

  public async dismissModal(): Promise<void> {
    await this.revokeAssetSession()
    this.activeModal.dismiss('Dismiss')
  }

  // ===== The iframe =====

  private async loadUi(): Promise<void> {
    // Each connection brings a freshly spawned helper announcing itself with 'ready', and that
    // helper serves the iframe already on the page. Reassigning the src would reload the plugin UI
    // and throw away whatever the user has typed into it, so it is assigned once per modal.
    if (this.iframe || this.iframeLoadInProgress) {
      return
    }

    const iframe = this.getIframe()
    if (!iframe) {
      return
    }

    this.iframeLoadInProgress = true
    try {
      this.assetSessionRequested = true
      const { ticket } = await api.post<{ ticket: string }>(`${this.basePath}/ticket`, {})
      if (this.destroyed) {
        return
      }
      const url = new URL(`${environment.api.base + this.basePath}/index.html`, location.origin)
      url.searchParams.set('ticket', ticket)
      url.searchParams.set('v', this.plugin.installedVersion)
      this.iframe = iframe
      iframe.src = url.toString()
    } catch (error) {
      console.error('Failed to load custom plugin UI:', error)
      this.setState({ loading: false })
      toast.error(t('plugins.settings.message_ui_offline'), t('toast.title_error'))
    } finally {
      this.iframeLoadInProgress = false
    }
  }

  public handleMessage = (e: MessageEvent): void => {
    if (e.source !== this.iframe?.contentWindow
      || (e.origin !== environment.api.origin && e.origin !== window.origin)) {
      return
    }
    switch (e.data.action) {
      case 'loaded':
        // The theme classes, the parent's stylesheets and inline styles, then
        // the 'ready' the page waits for before showing itself
        postCustomUiStyles(e.source as Window, e.origin)
        break
      case 'request': {
        this.handleRequest(e)
        break
      }
      case 'scrollHeight':
        this.setiFrameHeight(e)
        this.setState({ uiLoaded: true })
        break
      case 'config.get': {
        this.requestResponse(e, this.getConfigBlocks())
        break
      }
      case 'config.save': {
        // Respond only after the save settles, and never with the Promise
        // itself — postMessage structured-clones its payload, and a Promise
        // throws DataCloneError, silently dropping the ack (#2869).
        void this.savePluginConfig().then((success) => {
          if (success) {
            this.requestResponse(e, this.getConfigBlocks())
          } else {
            this.requestResponse(e, { message: t('config.failed_to_save_config') }, false)
          }
        })
        break
      }
      case 'config.update': {
        this.handleUpdateConfig(e, e.data.pluginConfig)
        break
      }
      case 'config.schema': {
        this.requestResponse(e, this.schema)
        break
      }
      case 'cachedAccessories.get': {
        void this.handleGetCachedAccessories(e, 'hap')
        break
      }
      case 'cachedMatterAccessories.get': {
        void this.handleGetCachedAccessories(e, 'matter')
        break
      }
      case 'schema.show': {
        void this.formEnd() // do not show other forms at the same time
        this.setState({ showSchemaForm: true })
        break
      }
      case 'schema.hide': {
        this.setState({ showSchemaForm: false })
        break
      }
      case 'form.create': {
        this.setState({ showSchemaForm: false }) // hide the schema generated form
        void this.formCreate(e.data.formId, e.data.schema, e.data.data, e.data.submitButton, e.data.cancelButton)
        break
      }
      case 'form.end': {
        void this.formEnd()
        break
      }
      case 'user.lightingMode': {
        this.requestResponse(e, useSettingsStore.getState().actualLightingMode)
        break
      }
      case 'i18n.lang': {
        this.requestResponse(e, i18n.language)
        break
      }
      case 'i18n.translations': {
        // English when the current language has no translation file loaded
        // (an unknown user language, a mistyped setting)
        const bundle = i18n.getResourceBundle(i18n.language, 'translation')
        this.requestResponse(e, bundle && Object.keys(bundle).length ? bundle : en)
        break
      }
      case 'close': {
        void this.revokeAssetSession().finally(() => this.activeModal.close())
        break
      }
      case 'toast.success':
        toast.success(e.data.message, e.data.title)
        break
      case 'toast.error':
        toast.error(e.data.message, e.data.title)
        break
      case 'toast.warning':
        toast.warning(e.data.message, e.data.title)
        break
      case 'toast.info':
        toast.info(e.data.message, e.data.title)
        break
      case 'spinner.show':
        this.setState({ pluginSpinner: true })
        break
      case 'spinner.hide':
        this.setState({ pluginSpinner: false })
        break
      case 'button.save.disabled':
        this.setState({ saveButtonDisabled: true })
        break
      case 'button.save.enabled':
        this.setState({ saveButtonDisabled: false })
        break
    }
  }

  private setiFrameHeight(event: MessageEvent): void {
    this.iframe!.style.height = `${(event.data.scrollHeight) + 10}px`
  }

  private handleRequest(event: MessageEvent): void {
    // socket.io flushes its buffered emits before the 'connect' event fires, so a request buffered
    // while the socket is down would reach the fresh server-side socket ahead of the 'start' that
    // gives it a helper, and nothing would answer it. Failing fast instead keeps the plugin UI's
    // promise chain moving and leaves its own retry logic free to recover once the socket is back.
    if (!this.io!.socket.connected) {
      this.requestResponse(event, { message: t('plugins.settings.message_ui_offline') }, false)
      return
    }

    this.io!.socket.emit('request', event.data)
  }

  private handleUpdateConfig(event: MessageEvent, pluginConfig: Array<Record<string, unknown>>): void {
    // Ensure the update contains an array
    if (!Array.isArray(pluginConfig)) {
      toast.error(t('plugins.config.must_be_array'), t('toast.title_error'))
      return this.requestResponse(event, { message: t('plugins.config.must_be_array') }, false)
    }

    // Validate each block in the array
    for (const block of pluginConfig) {
      if (typeof block !== 'object' || Array.isArray(block)) {
        toast.error(t('plugins.config.must_be_array_objects'), t('toast.title_error'))
        return this.requestResponse(event, { message: t('plugins.config.must_be_array_objects') }, false)
      }
    }

    this.updateConfigBlocks(pluginConfig)

    // Give pluginConfig[0] a new reference so the schema form sees a new
    // data input and shows the new values (it ignores the same object
    // mutated in place).
    if (this.pluginConfig[0] && this.state.showSchemaForm) {
      this.pluginConfig[0] = { ...this.pluginConfig[0] }
      this.setState({ firstBlock: this.pluginConfig[0] })
      this.schemaFormRefreshSubject.next(undefined)
    }

    return this.requestResponse(event, this.getConfigBlocks())
  }

  private async revokeAssetSession(): Promise<void> {
    // No ticket asked for, no session to revoke (StrictMode's throwaway first
    // mount, a modal closed before the helper was ready)
    if (this.assetSessionRevoked || !this.assetSessionRequested) {
      return
    }
    try {
      await api.post(`${this.basePath}/session/revoke`, {}, { withCredentials: true })
      this.assetSessionRevoked = true
    } catch (error) {
      // The session also has a short sliding expiry. Closing the modal should
      // not be blocked if the server is already unavailable.
      console.warn('Failed to revoke custom plugin UI asset session:', error)
    }
  }

  private requestResponse(event: MessageEvent, data: unknown, success = true): void {
    (event.source as Window).postMessage({
      action: 'response',
      requestId: event.data.requestId,
      success,
      data,
    }, event.origin)
  }

  private getConfigBlocks(): Array<Record<string, unknown>> {
    return this.pluginConfig
  }

  private updateConfigBlocks(pluginConfig: Record<string, unknown>[]): void {
    // Update blocks in-place: reassigning the array would reset the form
    for (let i = 0; i < pluginConfig.length; i++) {
      const block = pluginConfig[i]
      block[this.pluginType] = this.pluginAlias

      if (this.pluginConfig[i]) {
        Object.assign(this.pluginConfig[i], block)
      } else {
        this.pluginConfig[i] = block
      }
    }

    // Remove any extra blocks that no longer exist
    if (this.pluginConfig.length > pluginConfig.length) {
      this.pluginConfig.length = pluginConfig.length
    }
  }

  /**
   * Called when changes are made to the schema form content
   * These changes are emitted to the custom ui
   */
  private schemaFormUpdated(): void {
    if (!this.iframe || !this.iframe.contentWindow) {
      return
    }

    if (this.schemaFormRecentlyRefreshed) {
      this.schemaFormRecentlyRefreshed = false
      return
    }

    // The form edits pluginConfig in place, so only the iframe needs telling
    this.iframe.contentWindow.postMessage({
      action: 'stream',
      event: 'configChanged',
      data: this.pluginConfig,
    }, environment.api.origin)
  }

  /**
   * Called when changes sent from the custom ui config
   * Updates the schema form with the new values
   */
  private schemaFormRefresh(): void {
    this.schemaFormRecentlyRefreshed = true

    if (this.state.showSchemaForm) {
      // Toggle the form to refresh it, back on in the next microtask
      this.setState({ showSchemaForm: false })
      queueMicrotask(() => {
        this.setState({ showSchemaForm: true })
      })
    }
  }

  /** Create a new other-form */
  private async formCreate(formId: string, schema: unknown, data: unknown, submitButton?: string, cancelButton?: string): Promise<void> {
    // Need to clear out existing forms
    await this.formEnd()

    this.setState({
      formId,
      formSchema: schema,
      formData: data,
      formSubmitButtonLabel: submitButton,
      formCancelButtonLabel: cancelButton,
    })
  }

  /** Removes the current other-form */
  private async formEnd(): Promise<void> {
    if (this.state.formId) {
      this.setState({
        formId: undefined,
        formSchema: undefined,
        formData: undefined,
        formSubmitButtonLabel: undefined,
        formCancelButtonLabel: undefined,
      })
      await new Promise(resolve => setTimeout(resolve))
    }
  }

  /** Called when an other-form type is updated */
  private formUpdated(data: unknown): void {
    this.iframe!.contentWindow!.postMessage({
      action: 'stream',
      event: this.state.formId,
      data: {
        formEvent: 'change',
        formData: data,
      },
    }, environment.api.origin)
  }

  /** Fired when a custom form is canceled or submitted */
  private formActionEvent(formEvent: 'cancel' | 'submit'): void {
    this.iframe!.contentWindow!.postMessage({
      action: 'stream',
      event: this.state.formId,
      data: {
        formEvent,
        formData: this.state.formData,
      },
    }, environment.api.origin)
  }

  /** The cached HAP or Matter accessories of this plugin. */
  private async handleGetCachedAccessories(event: MessageEvent, kind: 'hap' | 'matter'): Promise<void> {
    try {
      const cached = kind === 'hap'
        ? await cachedAccessoriesCache.getHap<{ plugin: string }[]>()
        : await cachedAccessoriesCache.getMatter<{ plugin: string }[]>()
      return this.requestResponse(event, cached.filter(x => x.plugin === this.plugin.name))
    } catch (error) {
      console.error(kind === 'hap' ? 'Failed to get cached accessories:' : 'Failed to get cached Matter accessories:', error)
      toastApiError(error)
      // Answer anyway, so the plugin UI's promise rejects instead of hanging
      return this.requestResponse(event, { message: toToastMessage(error) }, false)
    }
  }
}
