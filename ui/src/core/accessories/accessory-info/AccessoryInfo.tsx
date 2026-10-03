import type {
  CachedAccessoryWithServices,
  PairingInfo,
  ServiceTypeX,
} from '@/core/accessories/accessories.interfaces'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { CharacteristicType } from '@homebridge/hap-client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { buildAccessoryInfo, fallbackCopyToClipboard, getEnumLabel, keyValue } from '@/core/accessories/accessory-info/accessory-info.helpers'
import { convertMired, convertTemp, prettify, serviceToTranslationString } from '@/core/pipes'
import { openModal } from '@/core/ui/modal'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { RemoveIndividualAccessories } from '@/modules/settings/remove-individual-accessories/RemoveIndividualAccessories'

/** What the modal closes with when saved. */
export interface AccessoryInfoResult {
  customName: string | undefined
  customType: string | undefined
  hidden: boolean | undefined
  onDashboard: boolean | undefined
}

export interface AccessoryInfoProps extends ModalComponentProps<AccessoryInfoResult> {
  service: ServiceTypeX
  accessoryCache: CachedAccessoryWithServices[]
  pairingCache: PairingInfo[]
}

function hasDetails(char: CharacteristicType): boolean {
  return 'minStep' in char || 'minValue' in char || 'maxValue' in char || 'validValues' in char
}

/** The value as the characteristic's unit and type format it, plus its enum label. */
function CharacteristicValue({ characteristic }: { characteristic: CharacteristicType }) {
  const { t } = useTranslation()

  let formatted: string | number | boolean
  if (characteristic.unit === 'percentage') {
    formatted = `${characteristic.value}%`
  } else if (characteristic.unit === 'celsius') {
    formatted = `${convertTemp(Number(characteristic.value))}°`
  } else if (characteristic.type === 'ColorTemperature') {
    formatted = convertMired(characteristic.value as number)
  } else {
    formatted = characteristic.value as string | number | boolean
  }

  const label = getEnumLabel(characteristic.type, characteristic.value as string | number | boolean)
  let suffix = ''
  if (label) {
    suffix = ` (${prettify(label)})`
  } else if (characteristic.format === 'bool') {
    suffix = ` (${t(characteristic.value ? 'status.widget.info.yes' : 'status.widget.info.no')})`
  }

  return <>{`${String(formatted ?? '')}${suffix}`}</>
}

interface CharacteristicRowProps {
  characteristic: CharacteristicType
  detailsVisible: boolean
  onToggle: () => void
  /** The main service's rows keep the description on one line; the extra services' rows do not. */
  primary: boolean
}

function CharacteristicRow({ characteristic, detailsVisible, onToggle, primary }: CharacteristicRowProps) {
  return (
    <li className="list-group-item d-flex justify-content-between align-items-left flex-column flex-md-row">
      <span className={primary ? 'me-3' : undefined}>
        {hasDetails(characteristic)
          ? (
              <span
                className={primary ? 'hover-pointer text-nowrap' : 'hover-pointer'}
                role="button"
                tabIndex={0}
                aria-expanded={!!detailsVisible}
                onClick={onToggle}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onToggle()
                  }
                }}
              >
                {characteristic.description}
              </span>
            )
          : primary
            ? <span className="text-nowrap">{characteristic.description}</span>
            : characteristic.description}
        {detailsVisible && (
          <div className="grey-text m-0 p-0 font-monospace">
            {'minStep' in characteristic && <div>{`Step: ${characteristic.minStep}`}</div>}
            {'minValue' in characteristic && <div>{`Min: ${characteristic.minValue}`}</div>}
            {'maxValue' in characteristic && <div>{`Max: ${characteristic.maxValue}`}</div>}
            {'validValues' in characteristic && (
              <div>
                {`Valid: ${(characteristic.validValues ?? []).join(' · ')}`}
              </div>
            )}
          </div>
        )}
        <div className="d-block d-md-none font-monospace grey-text text-break-all">
          {detailsVisible && 'Value: '}
          <CharacteristicValue characteristic={characteristic} />
        </div>
      </span>
      <span className="text-start text-md-end grey-text font-monospace d-none d-md-block align-content-center text-break-all">
        <CharacteristicValue characteristic={characteristic} />
      </span>
    </li>
  )
}

function InfoRow({ label, value, labelClass = 'text-start' }: { label: string, value: unknown, labelClass?: string }) {
  return (
    <li className="list-group-item d-flex justify-content-between align-items-left flex-column flex-md-row">
      <span className={labelClass}>{label}</span>
      <span className="text-start text-md-end grey-text font-monospace">{value as string}</span>
    </li>
  )
}

/** A value with a copy-to-clipboard button that turns into a tick for three seconds. */
function CopyRow({ label, labelClass, value }: { label: string, labelClass: string, value: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Clear the pending reset on close
  useEffect(() => () => clearTimeout(timeoutRef.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Fallback for iOS Safari
      fallbackCopyToClipboard(value)
    }

    setCopied(true)
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setCopied(false)
      timeoutRef.current = undefined
    }, 3000)
  }

  return (
    <li className="list-group-item d-flex justify-content-between align-items-left flex-column flex-md-row">
      <span className={labelClass}>{label}</span>
      <span className="text-start text-md-end grey-text font-monospace d-flex justify-content-between align-items-center ms-md-2">
        <span className="text-break-all">{value}</span>
        <button
          type="button"
          className="btn btn-link p-0 ms-2 text-primary flex-shrink-0 align-baseline"
          aria-label={t('common.a11y.copy_to_clipboard')}
          onClick={() => void copy()}
        >
          {copied
            ? <i className="fas fa-check green-text" aria-hidden="true"></i>
            : <i className="fas fa-copy" aria-hidden="true"></i>}
        </button>
        {copied && (
          <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
            {t('common.a11y.copied')}
          </span>
        )}
      </span>
    </li>
  )
}

/**
 * The accessory info modal — what a long press on any tile opens: rename the
 * accessory, change which tile type it renders as, hide it, or put it on the
 * dashboard, plus everything the accessory reports about itself.
 *
 * Angular edited the live service object in place and put the four editable
 * fields back on dismiss; here they are form state and only leave the modal
 * through `close()`, so a cancelled edit never reaches the tile.
 */
export function AccessoryInfo({ activeModal, service, accessoryCache, pairingCache }: AccessoryInfoProps) {
  const { t } = useTranslation()
  const valid = !!accessoryCache && !!pairingCache && !!service

  const model = useMemo(() => (valid ? buildAccessoryInfo(service, pairingCache, accessoryCache) : null), [valid, service, pairingCache, accessoryCache])
  const original = useMemo(() => ({
    customName: service?.customName,
    customType: model?.initialCustomType,
    hidden: service?.hidden,
    onDashboard: service?.onDashboard,
  }), [service, model])
  const [customName, setCustomName] = useState(original.customName)
  const [customType, setCustomType] = useState(original.customType)
  const [hidden, setHidden] = useState(original.hidden)
  const [onDashboard, setOnDashboard] = useState(original.onDashboard)
  const [isDetailsVisible, setIsDetailsVisible] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!valid) {
      console.error('AccessoryInfo: required data not provided')
      activeModal.dismiss('Missing required data')
    }
  }, [valid, activeModal])

  if (!valid || !model) {
    return null
  }

  const { isMatterAccessory, customTypeList, accessoryInformation, clusterInfo, matchedCachedAccessory, extraServices } = model

  const isDefaultType = (type: string) => (isMatterAccessory ? type === service.deviceType : type === service.type)

  const toggleDetailsVisibility = (char: CharacteristicType) => {
    if (hasDetails(char)) {
      setIsDetailsVisible(current => ({ ...current, [char.uuid]: !current[char.uuid] }))
    }
  }

  const dismissModal = () => {
    activeModal.dismiss('Dismiss')
  }

  const saveModal = () => {
    activeModal.close({ customName, customType, hidden, onDashboard })
  }

  const isFormUnchanged = customName === original.customName
    && customType === original.customType
    && hidden === original.hidden
    && onDashboard === original.onDashboard

  const onHiddenChange = (value: boolean) => {
    setHidden(value)
    if (value) {
      setOnDashboard(false)
    }
  }

  const removeSingleCachedAccessories = () => {
    activeModal.close()
    openModal(RemoveIndividualAccessories, {
      selectedBridge: service.instance.username.replaceAll(':', ''),
      highlightUuid: matchedCachedAccessory?.UUID,
      highlightCacheFile: matchedCachedAccessory?.$cacheFile,
    }, {
      size: 'lg',
      backdrop: 'static',
    })
  }

  const renderCharacteristics = (target: ServiceTypeX, primary: boolean) => target.serviceCharacteristics.map(characteristic => (
    <CharacteristicRow
      key={characteristic.uuid ?? characteristic.iid}
      characteristic={characteristic}
      detailsVisible={!!isDetailsVisible[characteristic.uuid]}
      onToggle={() => toggleDetailsVisibility(characteristic)}
      primary={primary}
    />
  ))

  return (
    <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="accessory-info-modal-title">
      <ModalHeader title={service.customName || service.serviceName} titleId="accessory-info-modal-title" onClose={dismissModal} />
      <div className="modal-body">
        <ul className="list-group list-group-box mb-3">
          <li className="list-group-item text-center grey-text small">
            <SafeHtml as="span" html={t('accessories.only_ui')} />
            <br />
            <SafeHtml as="span" html={t('accessories.only_ui_2')} />
          </li>
          <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
            <label htmlFor="form-name" className="mb-2 mb-md-0 w-100 w-md-50">{t('accessories.custom_name')}</label>
            <div className="text-start text-md-end w-100 w-md-50">
              <input
                type="text"
                id="form-name"
                autoComplete="off"
                className="form-control custom-input"
                value={customName || service.serviceName || ''}
                onChange={event => setCustomName(event.target.value)}
              />
            </div>
          </li>
          {customTypeList.length > 0 && (
            <li className="list-group-item d-flex flex-column flex-md-row align-items-center">
              <label htmlFor="custom-type" className="mb-2 mb-md-0 w-100 w-md-50">{t('accessories.custom_type')}</label>
              <div className="text-start text-md-end w-100 w-md-50">
                <select
                  id="custom-type"
                  className="custom-select"
                  value={customType ?? ''}
                  onChange={event => setCustomType(event.target.value)}
                >
                  {customTypeList.toSorted().map(type => (
                    <option key={type} value={type}>
                      {t(serviceToTranslationString(type))}
                      {isDefaultType(type) && ` (${t('settings.display.menu_default')})`}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          )}
          <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
            <span className="text-start" aria-hidden="true">{t('accessories.hide_this_accessory')}</span>
            <div className="text-end grey-text d-flex align-items-center">
              <input
                type="checkbox"
                className="rendux-input"
                id="hide-accessory"
                aria-label={t('accessories.hide_this_accessory')}
                checked={!!hidden}
                onChange={event => onHiddenChange(event.target.checked)}
              />
              <label htmlFor="hide-accessory" className="rendux-label ms-3" aria-hidden="true"></label>
            </div>
          </li>
          {!hidden && (
            <li className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
              <span className="text-start" aria-hidden="true">{t('accessories.show_on_dashboard')}</span>
              <div className="text-end grey-text d-flex align-items-center">
                <input
                  type="checkbox"
                  className="rendux-input mb-0"
                  id="show-on-dashboard"
                  aria-label={t('accessories.show_on_dashboard')}
                  checked={!!onDashboard}
                  onChange={event => setOnDashboard(event.target.checked)}
                />
                <label htmlFor="show-on-dashboard" className="rendux-label ms-3" aria-hidden="true"></label>
              </div>
            </li>
          )}
        </ul>
        <ul className="list-group list-group-box mb-3">
          <li className="list-group-item">
            <h6 className="mb-0 text-center">{t('accessories.service_info')}</h6>
          </li>
          {isMatterAccessory
            ? clusterInfo.map(cluster => [
                <li key={cluster.name} className="list-group-item">
                  <span className="fw-bold">{prettify(cluster.name)}</span>
                </li>,
                ...keyValue(cluster.attributes).map(attr => (
                  <li
                    key={`${cluster.name}.${attr.key}`}
                    className="list-group-item d-flex justify-content-between align-items-start align-items-md-center flex-column flex-md-row"
                  >
                    <span className="text-start me-2">{prettify(attr.key)}</span>
                    <span className="text-start text-md-end grey-text font-monospace">
                      {typeof attr.value === 'object'
                        ? <small>{JSON.stringify(attr.value, null, 2)}</small>
                        : String(attr.value)}
                    </span>
                  </li>
                )),
              ])
            : (
                <>
                  <InfoRow label={t('accessories.service')} value={service.humanType} />
                  <InfoRow label={t('accessories.name')} value={service.serviceName} />
                  {renderCharacteristics(service, true)}
                </>
              )}
        </ul>
        {extraServices.map(extraService => (
          <ul key={extraService.uniqueId ?? extraService.iid} className="list-group list-group-box mb-3">
            <li className="list-group-item">
              <h6 className="mb-0 text-center">{t('accessories.service_info')}</h6>
            </li>
            <InfoRow label={t('accessories.service')} value={extraService.humanType} />
            <InfoRow label={t('accessories.name')} value={extraService.serviceName} />
            {renderCharacteristics(extraService, false)}
          </ul>
        ))}
        <ul className="list-group list-group-box mb-0">
          <li className="list-group-item">
            <h6 className="mb-0 text-center">{t('accessories.accessory_info')}</h6>
          </li>
          <InfoRow label={t('accessories.protocol')} value={isMatterAccessory ? 'Matter' : 'HAP'} />
          {matchedCachedAccessory && (
            <>
              <InfoRow label={t('accessories.plugin')} value={matchedCachedAccessory.plugin} />
              {matchedCachedAccessory.platform && (
                <InfoRow label={t('child_bridge.config.platform')} value={matchedCachedAccessory.platform} />
              )}
              {matchedCachedAccessory.accessory && (
                <InfoRow label={t('child_bridge.config.accessory')} value={matchedCachedAccessory.accessory} />
              )}
            </>
          )}
          {accessoryInformation.map(information => (
            <InfoRow key={information.key} label={information.key} value={information.value} />
          ))}
          {isMatterAccessory && <InfoRow label="Bridge" value={service.instance.name} />}
          <InfoRow label={t('users.label_username')} value={service.instance.username} />
          {matchedCachedAccessory && <InfoRow label={t('child_bridge.config.name')} value={matchedCachedAccessory.bridge} />}
          {!isMatterAccessory && (
            <>
              <InfoRow label={t('accessories.bridge_ip')} value={service.instance.ipAddress} />
              <InfoRow label={t('accessories.bridge_port')} value={service.instance.port} />
              <CopyRow label="HAP UID" labelClass="text-start align-self-md-center text-nowrap" value={service.uniqueId ?? ''} />
              <InfoRow label="aid" labelClass="text-start font-monospace" value={service.aid} />
              <InfoRow label="iid" labelClass="text-start font-monospace" value={service.iid} />
            </>
          )}
          {matchedCachedAccessory && (
            <>
              <CopyRow label="UUID" labelClass="text-start align-self-md-center font-monospace text-nowrap" value={matchedCachedAccessory.UUID} />
              <li className="list-group-item d-flex justify-content-between align-items-center">
                <span className="text-start" aria-hidden="true">{t('accessories.button_remove')}</span>
                <button
                  type="button"
                  className="btn btn-primary m-0 ms-3 py-1"
                  aria-label={t('accessories.button_remove')}
                  onClick={removeSingleCachedAccessories}
                >
                  <i className="fas fa-arrow-right" aria-hidden="true"></i>
                </button>
              </li>
            </>
          )}
        </ul>
      </div>
      <ModalFooter>
        <div className="text-start">
          <button
            type="button"
            className="btn btn-elegant"
            data-bs-dismiss="modal"
            aria-label={t('form.button_close')}
            onClick={dismissModal}
          >
            {t('form.button_close')}
          </button>
        </div>
        <div className="text-center"></div>
        <div className="text-end">
          <button
            type="button"
            className="btn btn-primary"
            aria-label={t('form.button_save')}
            disabled={isFormUnchanged}
            onClick={saveModal}
          >
            {t('form.button_save')}
          </button>
        </div>
      </ModalFooter>
    </div>
  )
}
