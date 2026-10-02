import type { HapTileProps } from '@/core/accessories/types/hap/hap-tile'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cx } from '@/core/accessories/types/hap/hap-tile'
import { createAdaptiveLightingSignal, useAdaptiveLighting } from '@/core/accessories/types/hap/lightbulb/adaptive-lighting'
import { getBrightnessLabel, getBulbFill, getOnOffLabel } from '@/core/accessories/types/hap/lightbulb/lightbulb.utils'
import { LightbulbManage } from '@/core/accessories/types/hap/lightbulb/LightbulbManage'
import { openModal } from '@/core/ui/modal'
import { SafeHtml } from '@/core/ui/SafeHtml'
import { useLongPress } from '@/core/ui/use-long-press'

export function LightbulbTile({ service, readyForControl = false }: HapTileProps) {
  const { t } = useTranslation()
  const serviceRef = useRef(service)
  serviceRef.current = service

  // Decided once, as Angular's ngOnInit did
  const [hasAdaptiveLighting] = useState(() => 'CharacteristicValueActiveTransitionCount' in service.values)
  const [adaptiveSignal] = useState(() => createAdaptiveLightingSignal(!!service.values.CharacteristicValueActiveTransitionCount))
  const isAdaptiveLightingEnabled = useAdaptiveLighting(hasAdaptiveLighting ? adaptiveSignal : undefined)
  const [pollingRate, setPollingRate] = useState(30000)

  useEffect(() => {
    if (!hasAdaptiveLighting) {
      return
    }
    const timer = setInterval(() => {
      adaptiveSignal.set(!!serviceRef.current.values.CharacteristicValueActiveTransitionCount)
    }, pollingRate)
    return () => clearInterval(timer)
  }, [hasAdaptiveLighting, adaptiveSignal, pollingRate])

  const adaptive = { has: hasAdaptiveLighting, enabled: isAdaptiveLightingEnabled }

  const onClick = () => {
    if (!readyForControl) {
      return
    }
    const values = service.values

    if ('On' in values) {
      void service.getCharacteristic!('On').setValue!(!values.On)
    } else if ('Active' in values) {
      void service.getCharacteristic!('Active').setValue!(values.Active ? 0 : 1)
    }

    // Set the brightness to max if on 0% when turned on
    if ('Brightness' in values && !values.On && !values.Brightness) {
      values.Brightness = service.getCharacteristic!('Brightness').maxValue
    }
  }

  const onLongClick = async () => {
    if (!readyForControl) {
      return
    }
    const values = service.values

    if ('Brightness' in values || 'Hue' in values || 'Saturation' in values || 'ColorTemperature' in values) {
      const ref = openModal(LightbulbManage, {
        service,
        // Only a bulb with adaptive lighting gets the signal
        adaptiveLighting: hasAdaptiveLighting ? adaptiveSignal : undefined,
      }, {
        size: 'md',
        backdrop: 'static',
      })

      if (hasAdaptiveLighting) {
        // Poll fast (every 3 seconds) while the modal is open, slow again after
        setPollingRate(3000)
        try {
          await ref.result
        } catch {
          // Modal dismissed
        } finally {
          setPollingRate(30000)
        }
      }
    }
  }

  const pressRef = useLongPress<HTMLDivElement>({ onShortClick: onClick, onLongClick: () => void onLongClick() })
  const values = service.values

  return (
    <div
      ref={pressRef}
      className={cx('accessory-box', (values.On || values.Active) && 'accessory-on', readyForControl && 'cursor-pointer')}
      tabIndex={0}
    >
      <div className="d-flex flex-column h-100">
        <div className="accessory-svg" aria-label={t('accessories.core.lightbulb')}>
          <svg width="32px" height="32px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            {/* bulb outline */}
            <path
              stroke="#7f7f7f"
              strokeWidth="1.5"
              d="M8 21c-2.8-2.2-4.5-5.4-4.5-9 0-6.1 5-11 11.5-11S27.5 5.9 27.5 12c0 3.5-1.7 6.7-4.5 8.9-1.2 1-1.8 4.8-3 7.3-.9 2-2.2 2.7-4.5 2.7s-3.6-.7-4.5-2.7c-1.2-2.5-1.8-6.3-3-7.3z"
              fill={getBulbFill(service)}
              fillOpacity={'Brightness' in values ? 0.25 + (values?.Brightness / 100) * 0.5 : 0.75}
            />
            {/* top inner line */}
            <line stroke="#7f7f7f" strokeWidth="1.5" x1="8" y1="21.5" x2="23" y2="21.5" />
            {/* diagonal lines top to bottom */}
            <line stroke="#7f7f7f" strokeWidth="0.75" x1="10" y1="23" x2="21" y2="24" />
            <line stroke="#7f7f7f" strokeWidth="0.75" x1="10" y1="25.5" x2="21" y2="26.5" />
            <line stroke="#7f7f7f" strokeWidth="0.75" x1="11" y1="28" x2="20" y2="29" />
          </svg>
        </div>
        <div className="accessory-label mt-auto">{service.customName || service.serviceName}</div>
        {values?.Brightness
          ? (
              <SafeHtml
                className="accessory-label grey-text"
                html={values?.On ? getBrightnessLabel(service, adaptive) : t('accessories.control.off')}
              />
            )
          : (
              <SafeHtml
                className="accessory-label grey-text"
                html={t(values?.On || values?.Active ? 'accessories.control.on' : 'accessories.control.off') + getOnOffLabel(service, adaptive)}
              />
            )}
      </div>
    </div>
  )
}
