import type { HapManageProps, HapTileProps } from '@/core/accessories/types/hap/hap-tile'
import type { ComponentType, ReactNode } from 'react'

import { useTranslation } from 'react-i18next'

import { tileLabel } from '@/core/accessories/types/hap/hap-tile'
import { mediaHasControls, mediaIsOn, mediaToggle } from '@/core/accessories/types/hap/media.utils'
import { openModal } from '@/core/ui/modal'
import { useLongPress } from '@/core/ui/use-long-press'
import { cx } from '@/core/utilities/cx'

export interface MediaTileProps extends HapTileProps {
  /** The root class (`hb-speaker`, …), for the component styles. */
  className: string
  /** The manage modal this tile opens. */
  manage: ComponentType<HapManageProps>
  /** The translation key of the icon's label. */
  ariaKey: string
  /** The label for one with nothing more specific to say. */
  fallbackKey: string
  /** The speaker marks a muted accessory with `.muted`; the other two do not. */
  markMuted?: boolean
  children: ReactNode
}

/**
 * The speaker, microphone and doorbell tiles: the same component three times
 * over in Angular, apart from the icon, two labels and the modal they open.
 */
export function MediaTile({ service, readyForControl = false, className, manage, ariaKey, fallbackKey, markMuted = false, children }: MediaTileProps) {
  const { t } = useTranslation()
  const values = service.values

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    mediaToggle(service)
  }

  const onLongClick = () => {
    if (!readyForControl) {
      return
    }
    if (mediaHasControls(service)) {
      openModal(manage, { service }, { size: 'md', backdrop: 'static' })
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick })

  let label
  let stateText
  if ('CurrentMediaState' in values) {
    const state: Record<number, string> = {
      0: 'accessories.control.playing',
      1: 'accessories.control.paused',
      2: 'accessories.control.stopped',
    }
    stateText = [
      state[values?.CurrentMediaState] && t(state[values?.CurrentMediaState]),
      'Mute' in values && values?.Mute ? t('accessories.control.mute') : 'Volume' in values && `${values?.Volume}%`,
    ].filter(Boolean).join(', ')
    label = (
      <div className="accessory-label grey-text">
        {state[values?.CurrentMediaState] && t(state[values?.CurrentMediaState])}
        {'Mute' in values && values?.Mute
          ? ` · ${t('accessories.control.mute')}`
          : 'Volume' in values && ` · ${values?.Volume}%`}
      </div>
    )
  } else if ('Active' in values && !values?.Active) {
    stateText = t('accessories.control.off')
    label = <div className="accessory-label grey-text">{t('accessories.control.off')}</div>
  } else if ('Mute' in values && values?.Mute) {
    stateText = t('accessories.control.mute')
    label = <div className="accessory-label grey-text">{t('accessories.control.mute')}</div>
  } else if ('Volume' in values) {
    stateText = `${values?.Volume}%`
    label = <div className="accessory-label grey-text">{`${values?.Volume}%`}</div>
  } else if (['Speaker', 'SmartSpeaker'].includes(service.customType || service.type)) {
    stateText = t('accessories.control.on')
    label = <div className="accessory-label grey-text">{t('accessories.control.on')}</div>
  } else {
    stateText = t(fallbackKey)
    label = <div className="accessory-label grey-text">{t(fallbackKey)}</div>
  }
  const on = mediaIsOn(service)
  const srText = tileLabel(service.customName || service.serviceName, t(ariaKey), stateText)

  return (
    <div
      ref={pressRef}
      className={cx(
        'accessory-box',
        className,
        on && 'accessory-on',
        'CurrentMediaState' in values && values?.CurrentMediaState === 1 && 'paused',
        markMuted && 'Mute' in values && values?.Mute && 'muted',
        readyForControl && 'cursor-pointer',
      )}
      role="switch"
      tabIndex={0}
      aria-checked={!!on}
      aria-label={srText}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t(ariaKey)}>
          {children}
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        {label}
      </div>
    </div>
  )
}
