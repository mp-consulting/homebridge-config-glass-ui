import type { ComparisonOperator, ControllableAccessory, ControllableCharacteristic, SceneAutomationInfo, SceneCondition, SceneTrigger, SceneValue } from './scenes'

import { useTranslation } from 'react-i18next'

import { formatDate } from '@/core/pipes/date'

import { COMPARISON_OPERATORS, OPERATOR_SYMBOLS, parseSceneValue } from './scenes'

/** A value input for a characteristic's format. */
function ValueInput({ characteristic, value, onChange }: { characteristic?: ControllableCharacteristic, value: SceneValue | undefined, onChange: (value: SceneValue) => void }) {
  const { t } = useTranslation()
  if (characteristic?.format === 'bool') {
    return (
      <select className="custom-select" aria-label={t('scenes.value')} value={String(value === true || value === 1)} onChange={event => onChange(event.target.value === 'true')}>
        <option value="true">{t('scenes.on')}</option>
        <option value="false">{t('scenes.off')}</option>
      </select>
    )
  }
  return (
    <input
      className="form-control custom-input w-auto"
      aria-label={t('scenes.value')}
      type={characteristic && characteristic.format !== 'string' ? 'number' : 'text'}
      value={String(value ?? '')}
      onChange={event => onChange(parseSceneValue(event.target.value, characteristic?.format ?? 'string'))}
    />
  )
}

/** Accessory and characteristic pickers over the readable characteristics. */
function CharacteristicPicker({ accessories, uniqueId, characteristicType, onChange }: {
  accessories: ControllableAccessory[]
  uniqueId: string
  characteristicType: string
  onChange: (uniqueId: string, characteristicType: string) => void
}) {
  const { t } = useTranslation()
  const accessory = accessories.find(item => item.uniqueId === uniqueId)
  return (
    <>
      <select className="custom-select flex-grow-1" aria-label={t('scenes.accessory')} value={uniqueId} onChange={event => onChange(event.target.value, accessories.find(a => a.uniqueId === event.target.value)?.characteristics[0]?.type ?? '')}>
        {!accessory && <option value={uniqueId}>{t('scenes.missing_accessory')}</option>}
        {accessories.map(item => <option key={item.uniqueId} value={item.uniqueId}>{item.name}</option>)}
      </select>
      <select className="custom-select" aria-label={t('scenes.characteristic')} value={characteristicType} onChange={event => onChange(uniqueId, event.target.value)}>
        {!accessory?.characteristics.some(c => c.type === characteristicType) && <option value={characteristicType}>{characteristicType}</option>}
        {accessory?.characteristics.map(c => <option key={c.type} value={c.type}>{c.description}</option>)}
      </select>
    </>
  )
}

function characteristicIn(accessories: ControllableAccessory[], uniqueId: string, type: string) {
  return accessories.find(item => item.uniqueId === uniqueId)?.characteristics.find(c => c.type === type)
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button type="button" className="btn btn-sm btn-danger m-0" aria-label={t('form.button_delete')} onClick={onClick}>
      <i className="fas fa-trash" aria-hidden="true"></i>
    </button>
  )
}

/**
 * The scene's triggers: cron schedules, sunrise / sunset with an offset (for
 * the weather widget's location), and characteristic changes.
 */
export function TriggersEditor({ triggers, onChange, accessories, info }: {
  triggers: SceneTrigger[]
  onChange: (triggers: SceneTrigger[]) => void
  accessories: ControllableAccessory[]
  info: SceneAutomationInfo | null
}) {
  const { t } = useTranslation()
  const update = (index: number, next: SceneTrigger) => onChange(triggers.map((item, i) => (i === index ? next : item)))
  const changeType = (index: number, type: SceneTrigger['type']) => {
    const enabled = triggers[index].enabled
    if (type === 'cron') {
      update(index, { type, cron: '', enabled })
    } else if (type === 'sun') {
      update(index, { type, event: 'sunset', offsetMinutes: 0, enabled })
    } else {
      const accessory = accessories[0]
      update(index, { type, uniqueId: accessory?.uniqueId ?? '', characteristicType: accessory?.characteristics[0]?.type ?? '', operator: 'changes', enabled })
    }
  }

  const usesSun = triggers.some(trigger => trigger.type === 'sun')
  const usesCharacteristic = triggers.some(trigger => trigger.type === 'characteristic')

  return (
    <>
      <h6>{t('scenes.triggers')}</h6>
      <p className="small grey-text mb-2">{t('scenes.triggers_help')}</p>
      {usesSun && info && (
        <p className="small mb-2" data-testid="scene-sun-info">
          {info.location
            ? t('scenes.sun_location', {
                place: info.location.name ?? `${info.location.lat.toFixed(2)}, ${info.location.lon.toFixed(2)}`,
                sunrise: info.nextSunrise ? formatDate(info.nextSunrise, 'shortTime') : '—',
                sunset: info.nextSunset ? formatDate(info.nextSunset, 'shortTime') : '—',
              })
            : <span className="orange-text">{t('scenes.sun_no_location')}</span>}
        </p>
      )}
      {usesCharacteristic && info && !info.characteristicTriggers && (
        <p className="small orange-text mb-2" data-testid="scene-insecure-info">{t('scenes.characteristic_needs_insecure')}</p>
      )}
      <ul className="list-group list-group-box mb-2">
        {triggers.map((trigger, index) => (
          // eslint-disable-next-line react/no-array-index-key -- rows have no identity of their own
          <li key={index} className="list-group-item d-flex flex-wrap align-items-center gap-2" data-testid="scene-trigger">
            <select className="custom-select w-auto" aria-label={t('scenes.trigger_type')} value={trigger.type} onChange={event => changeType(index, event.target.value as SceneTrigger['type'])}>
              <option value="cron">{t('scenes.trigger_cron')}</option>
              <option value="sun">{t('scenes.trigger_sun')}</option>
              <option value="characteristic">{t('scenes.trigger_characteristic')}</option>
            </select>
            {trigger.type === 'cron' && (
              <input
                className="form-control custom-input font-monospace flex-grow-1 w-auto"
                aria-label={t('scenes.cron')}
                placeholder="0 19 * * *"
                value={trigger.cron}
                onChange={event => update(index, { ...trigger, cron: event.target.value })}
              />
            )}
            {trigger.type === 'sun' && (
              <>
                <select className="custom-select w-auto" aria-label={t('scenes.sun_event')} value={trigger.event} onChange={event => update(index, { ...trigger, event: event.target.value as 'sunrise' | 'sunset' })}>
                  <option value="sunrise">{t('scenes.sunrise')}</option>
                  <option value="sunset">{t('scenes.sunset')}</option>
                </select>
                <input
                  type="number"
                  min={-720}
                  max={720}
                  className="form-control custom-input w-auto"
                  aria-label={t('scenes.offset')}
                  value={trigger.offsetMinutes}
                  onChange={event => update(index, { ...trigger, offsetMinutes: Math.trunc(Number(event.target.value) || 0) })}
                />
                <span className="small grey-text">{t('scenes.offset_unit')}</span>
              </>
            )}
            {trigger.type === 'characteristic' && (
              <>
                <CharacteristicPicker
                  accessories={accessories}
                  uniqueId={trigger.uniqueId}
                  characteristicType={trigger.characteristicType}
                  onChange={(uniqueId, characteristicType) => update(index, { ...trigger, uniqueId, characteristicType, value: undefined, operator: 'changes' })}
                />
                <select
                  className="custom-select w-auto"
                  aria-label={t('scenes.operator')}
                  value={trigger.operator}
                  onChange={(event) => {
                    const operator = event.target.value as 'changes' | ComparisonOperator
                    const characteristic = characteristicIn(accessories, trigger.uniqueId, trigger.characteristicType)
                    update(index, { ...trigger, operator, value: operator === 'changes' ? undefined : trigger.value ?? (characteristic?.format === 'bool' ? true : 0) })
                  }}
                >
                  <option value="changes">{t('scenes.operator_changes')}</option>
                  {COMPARISON_OPERATORS.map(op => <option key={op} value={op}>{t('scenes.operator_becomes', { symbol: OPERATOR_SYMBOLS[op] })}</option>)}
                </select>
                {trigger.operator !== 'changes' && (
                  <ValueInput characteristic={characteristicIn(accessories, trigger.uniqueId, trigger.characteristicType)} value={trigger.value} onChange={value => update(index, { ...trigger, value })} />
                )}
              </>
            )}
            <div className="form-check form-switch m-0">
              <input
                className="form-check-input"
                type="checkbox"
                aria-label={t('common.labels.enabled')}
                checked={trigger.enabled}
                onChange={event => update(index, { ...trigger, enabled: event.target.checked })}
              />
            </div>
            <DeleteButton onClick={() => onChange(triggers.filter((_, i) => i !== index))} />
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm btn-elegant mb-3" onClick={() => onChange([...triggers, { type: 'cron', cron: '', enabled: true }])}>
        <i className="fas fa-plus me-1" aria-hidden="true"></i>
        {t('scenes.add_trigger')}
      </button>
    </>
  )
}

/** The conditions an automatic run checks first: a time window, a characteristic value. */
export function ConditionsEditor({ conditions, onChange, accessories }: {
  conditions: SceneCondition[]
  onChange: (conditions: SceneCondition[]) => void
  accessories: ControllableAccessory[]
}) {
  const { t } = useTranslation()
  const update = (index: number, next: SceneCondition) => onChange(conditions.map((item, i) => (i === index ? next : item)))
  const timeOptions = (value: string) => (
    <>
      <option value="sunrise">{t('scenes.sunrise')}</option>
      <option value="sunset">{t('scenes.sunset')}</option>
      <option value={value === 'sunrise' || value === 'sunset' ? '00:00' : value}>{t('scenes.time_of_day')}</option>
    </>
  )
  const timeField = (condition: Extract<SceneCondition, { type: 'time' }>, index: number, field: 'after' | 'before') => {
    const value = condition[field]
    const isSun = value === 'sunrise' || value === 'sunset'
    return (
      <>
        <select className="custom-select w-auto" aria-label={t(field === 'after' ? 'scenes.from' : 'scenes.until')} value={isSun ? value : (value || '00:00')} onChange={event => update(index, { ...condition, [field]: event.target.value })}>
          {timeOptions(value)}
        </select>
        {!isSun && (
          <input
            type="time"
            className="form-control custom-input w-auto"
            aria-label={t(field === 'after' ? 'scenes.from_time' : 'scenes.until_time')}
            value={value}
            onChange={event => update(index, { ...condition, [field]: event.target.value })}
          />
        )}
      </>
    )
  }

  return (
    <>
      <h6>{t('scenes.conditions')}</h6>
      <p className="small grey-text mb-2">{t('scenes.conditions_help')}</p>
      <ul className="list-group list-group-box mb-2">
        {conditions.map((condition, index) => (
          // eslint-disable-next-line react/no-array-index-key -- rows have no identity of their own
          <li key={index} className="list-group-item d-flex flex-wrap align-items-center gap-2" data-testid="scene-condition">
            {condition.type === 'time'
              ? (
                  <>
                    <span className="small">{t('scenes.between')}</span>
                    {timeField(condition, index, 'after')}
                    <span className="small">{t('scenes.and')}</span>
                    {timeField(condition, index, 'before')}
                  </>
                )
              : (
                  <>
                    <CharacteristicPicker
                      accessories={accessories}
                      uniqueId={condition.uniqueId}
                      characteristicType={condition.characteristicType}
                      onChange={(uniqueId, characteristicType) => update(index, { ...condition, uniqueId, characteristicType })}
                    />
                    <select className="custom-select w-auto" aria-label={t('scenes.operator')} value={condition.operator} onChange={event => update(index, { ...condition, operator: event.target.value as ComparisonOperator })}>
                      {COMPARISON_OPERATORS.map(op => <option key={op} value={op}>{OPERATOR_SYMBOLS[op]}</option>)}
                    </select>
                    <ValueInput characteristic={characteristicIn(accessories, condition.uniqueId, condition.characteristicType)} value={condition.value} onChange={value => update(index, { ...condition, value })} />
                  </>
                )}
            <DeleteButton onClick={() => onChange(conditions.filter((_, i) => i !== index))} />
          </li>
        ))}
      </ul>
      <div className="d-flex gap-2">
        <button type="button" className="btn btn-sm btn-elegant m-0" onClick={() => onChange([...conditions, { type: 'time', after: 'sunset', before: '23:00' }])}>
          <i className="fas fa-plus me-1" aria-hidden="true"></i>
          {t('scenes.add_time_condition')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-elegant m-0"
          disabled={!accessories.length}
          onClick={() => {
            const accessory = accessories[0]
            const characteristic = accessory?.characteristics[0]
            if (accessory && characteristic) {
              onChange([...conditions, { type: 'characteristic', uniqueId: accessory.uniqueId, characteristicType: characteristic.type, operator: 'eq', value: characteristic.format === 'bool' ? true : 0 }])
            }
          }}
        >
          <i className="fas fa-plus me-1" aria-hidden="true"></i>
          {t('scenes.add_value_condition')}
        </button>
      </div>
    </>
  )
}
