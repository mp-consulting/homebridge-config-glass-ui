import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { AccessoryManageModalProps } from '@/core/accessories/types/use-manage-accessory'
import type { ModalComponentProps } from '@/core/ui/modal'
import type { ComponentType, KeyboardEvent } from 'react'

import { openModal } from '@/core/ui/modal'

/** The props every Matter tile takes (the Angular `service` / `readyForControl` inputs). */
export interface MatterTileProps {
  service: ServiceTypeX
  readyForControl?: boolean
}

/** The name a tile shows: the user's custom name, else the service or display name. */
export function tileName(service: ServiceTypeX): string | undefined {
  return service.customName || service.serviceName || service.displayName
}

/**
 * The screen-reader text of a tile: `{name}, {type}, {state}`, leaving the
 * type out when the name already says it (a "Kitchen Light" is not read as
 * "Kitchen Light, Light").
 * @param service - the accessory service
 * @param srType - the translated accessory type
 * @param stateText - the state as the tile shows it
 */
export function tileSrText(service: ServiceTypeX, srType: string, stateText: string): string {
  const srBaseName = (service.customName || service.serviceName || service.displayName || '').trim()
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  return `${srBaseName + (includeType ? `, ${srType}` : '')}, ${stateText}`
}

/**
 * `(keydown.enter)` + `(keydown.space)` on a tile.
 * @param handler - what the key does
 */
export function onEnterOrSpace(handler: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      handler()
    }
  }
}

/**
 * Open a tile's manage modal, the way every Matter tile opened it
 * (`size: 'md'`, `backdrop: 'static'`).
 * @param Component - the manage modal
 * @param service - the accessory service
 */
export function openManageModal(Component: ComponentType<AccessoryManageModalProps>, service: ServiceTypeX) {
  // The manage props only need `close`/`dismiss` of the full ActiveModal
  return openModal(Component as ComponentType<AccessoryManageModalProps & ModalComponentProps>, { service }, { size: 'md', backdrop: 'static' })
}

/**
 * `{@link tileSrText}` for the sensor tiles, which name the accessory by its
 * custom or service name only (no display name fallback).
 * @param service - the accessory service
 * @param srType - the translated accessory type
 * @param stateText - the reading as the tile shows it
 */
export function sensorSrText(service: ServiceTypeX, srType: string, stateText: string): string {
  const srBaseName = (service.customName || service.serviceName || '').trim()
  const includeType = !srBaseName.toLowerCase().includes(srType.toLowerCase())
  return `${srBaseName + (includeType ? `, ${srType}` : '')}, ${stateText}`
}
