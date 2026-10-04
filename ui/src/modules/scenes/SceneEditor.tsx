import type { ModalComponentProps } from '@/core/ui/modal'

import type { ControllableAccessory, Scene, SceneAction, SceneInput, SceneSchedule } from './scenes'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InlineSpinner } from '@/core/components/spinner/InlineSpinner'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { toastApiError } from '@/core/utilities/http-error'

import { loadControllableAccessories, parseSceneValue, scenesApi } from './scenes'

export interface SceneEditorProps extends ModalComponentProps<Scene> {
  /** The scene to edit; a new one when absent. */
  scene?: Scene
}

/** Add or edit a scene: its name, the values it sets and when it runs. Closes with the saved scene. */
export function SceneEditor({ activeModal, scene }: SceneEditorProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(scene?.name ?? '')
  const [actions, setActions] = useState<SceneAction[]>(scene?.actions ?? [])
  const [schedules, setSchedules] = useState<SceneSchedule[]>(scene?.schedules ?? [])
  const [accessories, setAccessories] = useState<ControllableAccessory[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    loadControllableAccessories().then(
      (list) => {
        if (active) {
          setAccessories(list)
        }
      },
      (error) => {
        console.error(error)
        if (active) {
          setAccessories([])
        }
      },
    )
    return () => {
      active = false
    }
  }, [])

  const characteristicOf = (action: SceneAction) => accessories
    ?.find(item => item.uniqueId === action.uniqueId)
    ?.characteristics
    .find(c => c.type === action.characteristicType)

  const updateAction = (index: number, patch: Partial<SceneAction>) => {
    setActions(current => current.map((action, i) => (i === index ? { ...action, ...patch } : action)))
  }

  const addAction = () => {
    const accessory = accessories?.[0]
    const characteristic = accessory?.characteristics[0]
    if (accessory && characteristic) {
      setActions(current => [...current, { uniqueId: accessory.uniqueId, characteristicType: characteristic.type, value: parseSceneValue(characteristic.format === 'bool' ? 'true' : String(characteristic.minValue ?? 0), characteristic.format) }])
    }
  }

  const chooseAccessory = (index: number, uniqueId: string) => {
    const characteristic = accessories?.find(item => item.uniqueId === uniqueId)?.characteristics[0]
    if (characteristic) {
      updateAction(index, { uniqueId, characteristicType: characteristic.type, value: parseSceneValue(characteristic.format === 'bool' ? 'true' : String(characteristic.minValue ?? 0), characteristic.format) })
    }
  }

  const chooseCharacteristic = (index: number, type: string) => {
    const characteristic = accessories?.find(item => item.uniqueId === actions[index].uniqueId)?.characteristics.find(c => c.type === type)
    if (characteristic) {
      updateAction(index, { characteristicType: type, value: parseSceneValue(characteristic.format === 'bool' ? 'true' : String(characteristic.minValue ?? 0), characteristic.format) })
    }
  }

  const save = async () => {
    const input: SceneInput = { name: name.trim(), actions, schedules }
    setSaving(true)
    try {
      activeModal.close(scene ? await scenesApi.update(scene.id, input) : await scenesApi.create(input))
    } catch (error) {
      console.error(error)
      toastApiError(error)
      setSaving(false)
    }
  }

  const valid = name.trim().length > 0 && actions.length > 0 && schedules.every(schedule => schedule.cron.trim())

  return (
    <div className="modal-content hb-scene-editor">
      <ModalHeader title={t(scene ? 'scenes.edit' : 'scenes.add')} onClose={() => activeModal.dismiss('Dismiss')} />
      <div className="modal-body">
        <div className="mb-3">
          <label htmlFor="scene-name" className="form-label">{t('scenes.name')}</label>
          <input id="scene-name" className="form-control custom-input" maxLength={64} value={name} onChange={event => setName(event.target.value)} />
        </div>

        <h6>{t('scenes.actions')}</h6>
        {!accessories
          ? <div className="text-center"><InlineSpinner /></div>
          : (
              <ul className="list-group list-group-box mb-2">
                {actions.length === 0 && <li className="list-group-item grey-text text-center">{t('scenes.no_actions')}</li>}
                {actions.map((action, index) => {
                  const characteristic = characteristicOf(action)
                  const accessory = accessories.find(item => item.uniqueId === action.uniqueId)
                  return (
                    // eslint-disable-next-line react/no-array-index-key -- rows have no identity of their own
                    <li key={index} className="list-group-item d-flex flex-wrap align-items-center gap-2" data-testid="scene-action">
                      <select
                        className="custom-select flex-grow-1"
                        aria-label={t('scenes.accessory')}
                        value={action.uniqueId}
                        onChange={event => chooseAccessory(index, event.target.value)}
                      >
                        {!accessory && <option value={action.uniqueId}>{t('scenes.missing_accessory')}</option>}
                        {accessories.map(item => <option key={item.uniqueId} value={item.uniqueId}>{item.name}</option>)}
                      </select>
                      <select
                        className="custom-select"
                        aria-label={t('scenes.characteristic')}
                        value={action.characteristicType}
                        onChange={event => chooseCharacteristic(index, event.target.value)}
                      >
                        {!characteristic && <option value={action.characteristicType}>{action.characteristicType}</option>}
                        {accessory?.characteristics.map(c => <option key={c.type} value={c.type}>{c.description}</option>)}
                      </select>
                      {characteristic?.format === 'bool'
                        ? (
                            <select className="custom-select" aria-label={t('scenes.value')} value={String(action.value)} onChange={event => updateAction(index, { value: event.target.value === 'true' })}>
                              <option value="true">{t('scenes.on')}</option>
                              <option value="false">{t('scenes.off')}</option>
                            </select>
                          )
                        : (
                            <input
                              className="form-control custom-input w-auto"
                              aria-label={t('scenes.value')}
                              type={characteristic && characteristic.format !== 'string' ? 'number' : 'text'}
                              min={characteristic?.minValue}
                              max={characteristic?.maxValue}
                              step={characteristic?.minStep}
                              value={String(action.value)}
                              onChange={event => updateAction(index, { value: parseSceneValue(event.target.value, characteristic?.format ?? 'string') })}
                            />
                          )}
                      <button type="button" className="btn btn-sm btn-danger m-0" aria-label={t('form.button_delete')} onClick={() => setActions(current => current.filter((_, i) => i !== index))}>
                        <i className="fas fa-trash" aria-hidden="true"></i>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
        <button type="button" className="btn btn-sm btn-elegant mb-3" disabled={!accessories?.length} onClick={addAction}>
          <i className="fas fa-plus me-1" aria-hidden="true"></i>
          {t('scenes.add_action')}
        </button>

        <h6>{t('scenes.schedules')}</h6>
        <p className="small grey-text mb-2">{t('scenes.schedules_help')}</p>
        <ul className="list-group list-group-box mb-2">
          {schedules.map((schedule, index) => (
            // eslint-disable-next-line react/no-array-index-key -- rows have no identity of their own
            <li key={index} className="list-group-item d-flex align-items-center gap-2" data-testid="scene-schedule">
              <input
                className="form-control custom-input font-monospace"
                aria-label={t('scenes.cron')}
                placeholder="0 19 * * *"
                value={schedule.cron}
                onChange={event => setSchedules(current => current.map((item, i) => (i === index ? { ...item, cron: event.target.value } : item)))}
              />
              <div className="form-check form-switch m-0">
                <input
                  className="form-check-input"
                  type="checkbox"
                  aria-label={t('common.labels.enabled')}
                  checked={schedule.enabled}
                  onChange={event => setSchedules(current => current.map((item, i) => (i === index ? { ...item, enabled: event.target.checked } : item)))}
                />
              </div>
              <button type="button" className="btn btn-sm btn-danger m-0" aria-label={t('form.button_delete')} onClick={() => setSchedules(current => current.filter((_, i) => i !== index))}>
                <i className="fas fa-trash" aria-hidden="true"></i>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-sm btn-elegant" onClick={() => setSchedules(current => [...current, { cron: '', enabled: true }])}>
          <i className="fas fa-plus me-1" aria-hidden="true"></i>
          {t('scenes.add_schedule')}
        </button>
      </div>
      <ModalFooter>
        <div className="text-start">
          <button type="button" className="btn btn-elegant" onClick={() => activeModal.dismiss('Dismiss')}>{t('form.button_close')}</button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button type="button" className="btn btn-primary" disabled={!valid || saving} onClick={() => void save()}>
            {saving ? <InlineSpinner /> : t('form.button_save')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
