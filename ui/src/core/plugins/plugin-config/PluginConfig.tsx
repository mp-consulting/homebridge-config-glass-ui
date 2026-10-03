import type { ChildBridge, PluginConfigBlock } from '@/core/plugins/manage-plugins.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { PluginModalData } from '@/core/ui/modal-data'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'

import { api } from '@/core/api'
import { Markdown } from '@/core/components/markdown/Markdown'
import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { interpolateMd } from '@/core/pipes/interpolate-md'
import { HomebridgeDeconz } from '@/core/plugins/custom-plugins/homebridge-deconz/HomebridgeDeconz'
import { HomebridgeHue } from '@/core/plugins/custom-plugins/homebridge-hue/HomebridgeHue'
import { managePlugins } from '@/core/plugins/manage-plugins'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toast } from '@/core/ui/toast'
import { childBridges as childBridgesService } from '@/core/utilities/child-bridges'
import { cx } from '@/core/utilities/cx'
import { toastApiError } from '@/core/utilities/http-error'
import { SchemaForm } from '@/schema-form'

import './plugin-config.scss'

export type PluginConfigProps = PluginModalData & ModalComponentProps

/**
 * homebridge-hue's schema declares no shape for its users map, so the keys the
 * user already has are added to it by hand.
 */
function homebridgeHueFix(schema: any, platform: Record<string, unknown>): void {
  schema.schema.properties.users = {
    type: 'object',
    properties: {},
  }

  if (!platform.users || typeof platform.users !== 'object') {
    return
  }

  for (const key of Object.keys(platform.users)) {
    schema.schema.properties.users.properties[key] = {
      type: 'string',
    }
  }
}

/** The schema-driven settings form of a plugin (PluginConfigComponent). */
export function PluginConfig({ activeModal, plugin, schema, editorContext }: PluginConfigProps) {
  const { t } = useTranslation()
  const lang = useSettingsStore(state => state.env.lang)

  const [pluginConfig, setPluginConfig] = useState<PluginConfigBlock[]>([])
  const [show, setShow] = useState('')
  const [saveInProgress, setSaveInProgress] = useState(false)
  const [formBlocksValid, setFormBlocksValid] = useState<{ [key: string]: boolean }>({})
  const [isFirstSave, setIsFirstSave] = useState(false)

  const pluginType: 'platform' | 'accessory' = schema?.pluginType
  const strictValidation: boolean = schema?.strictValidation
  // Recomputed only when a block reports or is removed, as before: a block
  // just added counts as invalid in its own icon but does not block the save
  // until its form has reported
  const [formIsValid, setFormIsValid] = useState(true)

  // The latest blocks, for the async save (the configs are edited in place)
  const blocksRef = useRef(pluginConfig)
  blocksRef.current = pluginConfig
  // The validity map as last written, so several reports in one tick all count
  const validRef = useRef(formBlocksValid)

  function newBlock(): PluginConfigBlock {
    return {
      __uuid__: uuid(),
      name: schema.pluginAlias,
      config: {
        [pluginType]: schema.pluginAlias,
      },
    }
  }

  /** The panel headings follow the name field rather than being fixed at load time. */
  function renameBlocks(blocks: PluginConfigBlock[]): PluginConfigBlock[] {
    return blocks.map(block => ({ ...block, name: block.config.name || block.name }))
  }

  function blockShown(id: string): void {
    setShow(id)
    setPluginConfig(renameBlocks)
  }

  function blockHidden(id: string): void {
    setShow(current => (current === id ? '' : current))
  }

  function addBlock(): void {
    const block = newBlock()
    setPluginConfig(current => renameBlocks([...current, block]))
    // An empty block is usually missing something required, so it starts invalid
    validRef.current = { ...validRef.current, [block.__uuid__]: false }
    setFormBlocksValid(validRef.current)
    setShow(block.__uuid__)
  }

  function removeBlock(id: string): void {
    setPluginConfig(current => current.filter(x => x.__uuid__ !== id))

    // Validity is keyed by block id - keying by index left the remaining
    // entries pointing at the wrong blocks after a middle block was removed
    const updated = { ...validRef.current }
    delete updated[id]
    validRef.current = updated
    setFormBlocksValid(updated)
    setFormIsValid(Object.values(updated).every(x => x))
  }

  function onIsValid(isValid: boolean, id: string): void {
    const updated = { ...validRef.current, [id]: isValid }
    validRef.current = updated
    setFormBlocksValid(updated)
    setFormIsValid(Object.values(updated).every(x => x))
  }

  useEffect(() => {
    if (!schema || !plugin) {
      console.error('PluginConfigComponent: schema or plugin not provided')
      activeModal.dismiss('Missing required data')
      return undefined
    }
    let cancelled = false

    void (async () => {
      try {
        const loaded: any[] = editorContext?.config
          ?? await api.get(`/config-editor/plugin/${encodeURIComponent(plugin.name)}`)
        if (cancelled) {
          return
        }
        const configBlocks: PluginConfigBlock[] = loaded.map((block: Record<string, any>) => ({
          __uuid__: uuid(),
          name: block.name || schema.pluginAlias,
          config: block,
        }))

        if (plugin.name === 'homebridge-hue' && configBlocks.length) {
          homebridgeHueFix(schema, configBlocks[0].config)
        }

        if (!configBlocks.length) {
          setIsFirstSave(true)
          const block = newBlock()
          setPluginConfig([block])
          validRef.current = { [block.__uuid__]: false }
          setFormBlocksValid(validRef.current)
          setShow(block.__uuid__)
        } else {
          setPluginConfig(configBlocks)
          setShow(configBlocks[0].__uuid__)
        }
      } catch (error: any) {
        console.error(error)
        toastApiError(error, 'plugins.config.load_error')
      }
    })()

    return () => {
      cancelled = true
    }
    // Loaded once, for the plugin the modal was opened with
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  async function save(): Promise<void> {
    setSaveInProgress(true)
    const configBlocks = blocksRef.current.map(x => x.config)

    if (!plugin) {
      setSaveInProgress(false)
      return
    }

    try {
      const response = await api.post<{ config: any[], affectedBridges: ChildBridge[] }>(
        `/config-editor/plugin/${encodeURIComponent(plugin.name)}?include=restart-info`,
        configBlocks,
      )
      const newConfig = response.config
      setSaveInProgress(false)
      if (plugin.name === '@mp-consulting/homebridge-config-glass-ui') {
        // Reload app settings if the config was changed for Homebridge Glass UI
        settingsActions.getAppSettings().catch(() => { /* do nothing */ })
      } else {
        // If it is the first time configuring the plugin, then offer to set up a child bridge straight away
        if (isFirstSave && useSettingsStore.getState().env.recommendChildBridges && newConfig[0]?.platform) {
          // Close the modal and open the child bridge setup modal
          activeModal.close()
          void managePlugins.bridgeSettings(plugin, true)
          return
        }
      }

      // Shows the child bridge restart modal if needed, otherwise the full
      // restart homebridge modal. The affected bridges arrive inline on the
      // save response, so there is no follow-up fetch.
      activeModal.close()
      childBridgesService.openCorrectRestartModalWithBridges(response.affectedBridges)
    } catch (error) {
      console.error(error)
      toast.error(t('config.failed_to_save_config'), t('toast.title_error'))
      setSaveInProgress(false)
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const closeModal = () => activeModal.close()

  if (!schema || !plugin) {
    return null
  }

  const validityClass = (valid: boolean | undefined) => cx(
    'fas fa-xl',
    valid === true && 'fa-circle-check green-text',
    valid === false && 'fa-circle-exclamation',
    strictValidation && valid === false && 'red-text',
    !strictValidation && valid === false && 'orange-text',
  )

  const validityLabel = (valid: boolean | undefined) => t(valid
    ? 'form.label_valid'
    : strictValidation ? 'form.label_invalid_strict' : 'form.label_invalid')

  // Read out rather than shown in colour only; nothing to say before the first validation
  const validityA11y = (valid: boolean | undefined) => valid === undefined
    ? { 'aria-hidden': true as const }
    : { 'role': 'img', 'aria-label': validityLabel(valid) }

  const schemaForm = (block: PluginConfigBlock) => (
    <SchemaForm
      configSchema={schema}
      data={block.config}
      lang={lang ?? undefined}
      onDataChange={(data) => {
        // Two-way binding: the form edits the object in place and hands the
        // same one back, but keep whatever it hands back
        block.config = data
      }}
      onValidChange={isValid => onIsValid(isValid, block.__uuid__)}
    />
  )

  return (
    <div className="modal-content hb-plugin-config" aria-labelledby="plugin-config-title">
      <ModalHeader title={plugin.displayName || plugin.name} titleId="plugin-config-title" closeDisabled={saveInProgress} onClose={dismissModal} />
      <div className="modal-body pb-0">
        {schema.headerDisplay && <Markdown className="plugin-md" data={interpolateMd(schema.headerDisplay)} />}

        {/* MULTIPLE CONFIG BLOCKS */}
        {pluginConfig.length > 0 && !schema.singular && (
          <div className="accordion">
            {pluginConfig.map((block) => {
              const expanded = show === block.__uuid__
              const toggleId = `${block.__uuid__}-toggle`
              const collapseId = `${block.__uuid__}-collapse`
              return (
                <div key={block.__uuid__} className="card accordion-item" id={block.__uuid__}>
                  <div className={`card-header accordion-header${expanded ? '' : ' collapsed'}`} role="heading">
                    <div className="d-flex align-items-center justify-content-between">
                      <h5 className="m-0">{block.name}</h5>
                      <div className="d-flex align-items-center">
                        {plugin.name !== '@mp-consulting/homebridge-config-glass-ui' && expanded && (
                          <HoverTooltip text={t('form.button_delete')} placement="left">
                            <button
                              className="btn btn-danger ms-2"
                              type="button"
                              aria-label={`${t('form.button_delete')} ${block.name}`}
                              onClick={() => removeBlock(block.__uuid__)}
                            >
                              <i className="fas fa-trash-can" aria-hidden="true"></i>
                            </button>
                          </HoverTooltip>
                        )}
                        <HoverTooltip text={t('form.button_edit')} placement="left">
                          <button
                            className={`btn btn-primary ms-2 me-2${expanded ? '' : ' collapsed'}`}
                            type="button"
                            id={toggleId}
                            aria-controls={collapseId}
                            aria-expanded={expanded}
                            aria-label={`${t('form.button_edit')} ${block.name}`}
                            onClick={() => (expanded ? blockHidden(block.__uuid__) : blockShown(block.__uuid__))}
                          >
                            <i className="far fa-pen-to-square" aria-hidden="true"></i>
                          </button>
                        </HoverTooltip>
                        <HoverTooltip text={validityLabel(formBlocksValid[block.__uuid__])} placement="left">
                          <i className={validityClass(formBlocksValid[block.__uuid__])} {...validityA11y(formBlocksValid[block.__uuid__])}></i>
                        </HoverTooltip>
                      </div>
                    </div>
                  </div>
                  {/* ngbAccordion destroyed a collapsed panel's content */}
                  {expanded && (
                    <div className="accordion-collapse collapse show" role="region" id={collapseId} aria-labelledby={toggleId}>
                      <div className="card-body accordion-body">
                        {schemaForm(block)}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* SINGLE CONFIG BLOCK ONLY */}
        {pluginConfig.length > 0 && schema.singular && (
          <div className="card card-body">
            {schemaForm(pluginConfig[0])}
            {plugin.name === 'homebridge-deconz' && <HomebridgeDeconz />}
            {plugin.name === 'homebridge-hue' && <HomebridgeHue />}
          </div>
        )}
        {schema.footerDisplay && (
          <div className="mt-3">
            <Markdown className="plugin-md" data={interpolateMd(schema.footerDisplay)} />
          </div>
        )}
      </div>
      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            disabled={saveInProgress}
            onClick={closeModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end d-flex align-items-center justify-content-end">
          {schema.singular
            ? (
                <HoverTooltip text={validityLabel(formIsValid)}>
                  <i className={`${validityClass(formIsValid)} me-2`} {...validityA11y(formIsValid)}></i>
                </HoverTooltip>
              )
            : (
                <button
                  type="button"
                  className="btn btn-elegant me-2"
                  data-dismiss="modal"
                  aria-label={t('plugins.config.add_block')}
                  onClick={addBlock}
                >
                  <i className="fas fa-plus" aria-hidden="true"></i>
                </button>
              )}
          <button
            type="button"
            className="btn btn-primary"
            data-bs-dismiss="modal"
            disabled={saveInProgress || (!formIsValid && strictValidation)}
            onClick={() => void save()}
          >
            {!saveInProgress
              ? <span>{t('form.button_save')}</span>
              : <InlineSpinner />}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
