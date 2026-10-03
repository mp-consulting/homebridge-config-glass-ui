import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { ManageAccessory } from '@/core/accessories/types/use-manage-accessory'
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react'

import { useCallback, useEffect } from 'react'

import { MatterBrightness, MatterColorTemperature } from '@/core/accessories/types/matter/matter-device.constants'
import { getBrightnessLevel, getColorTemperatureMireds, getOnOffState, levelToPercentage } from '@/core/accessories/types/matter/matter-device.utils'
import { useStateRef } from '@/core/accessories/types/matter/use-state-ref'
import { colour } from '@/core/utilities/colour'

/**
 * The power switch and brightness slider shared by the three dimmable Matter
 * light modals (dimmable, colour temperature, extended colour). In Angular
 * each component carried its own verbatim copy; the rules are the same:
 *
 * - Turning off goes to `onOff`, never to `levelControl` - a level of 0 is
 *   clamped up to `minLevel` by most devices, so the light would stay dimly on.
 * - Turning on writes `levelControl` AND `onOff`: a raw level write does not
 *   run Matter's on/off coupling (only the moveToLevelWithOnOff command does).
 *
 * Split in two because the state has to exist before `useManageAccessory`
 * (whose `onUpdate` syncs it) and the writes need what that hook returns.
 * @param initial - the service the modal was opened with
 */
export function useMatterLightState(initial: ServiceTypeX) {
  const [targetMode, setTargetMode, targetModeRef] = useStateRef(() => getOnOffState(initial))
  const [brightness, setBrightness, brightnessRef] = useStateRef(() => getBrightnessLevel(initial))

  /** `handleAccessoryUpdate()`'s share for the power and brightness. */
  const sync = useCallback((service: ServiceTypeX) => {
    setTargetMode(getOnOffState(service))
    setBrightness(getBrightnessLevel(service))
  }, [setTargetMode, setBrightness])

  return {
    targetMode,
    setTargetMode,
    targetModeRef,
    brightness,
    setBrightness,
    brightnessRef,
    targetBrightness: { value: brightness, min: MatterBrightness.Min, max: MatterBrightness.Max, step: 1 },
    brightnessPercentage: levelToPercentage(brightness),
    sync,
  }
}

export type MatterLightState = ReturnType<typeof useMatterLightState>

/**
 * The writes for {@link useMatterLightState}.
 * @param manage - what `useManageAccessory` returned
 * @param light - the light state
 * @param serviceRef - the newest service object (read when a debounce fires)
 */
export function useMatterLightActions(manage: ManageAccessory, light: MatterLightState, serviceRef: RefObject<ServiceTypeX>) {
  const { debounce, showGenericErrorToast, blurTarget } = manage
  const { setTargetMode, targetModeRef, setBrightness, brightnessRef } = light

  const writeBrightness = useCallback(async () => {
    const service = serviceRef.current
    const previousBrightness = getBrightnessLevel(service)
    try {
      if (brightnessRef.current === MatterBrightness.Min) {
        // Turning off - use onOff cluster
        const cluster = service.getCluster?.('onOff')
        if (!cluster) {
          throw new Error('OnOff cluster not found')
        }
        await cluster.setAttributes({ onOff: false })
      } else {
        // Setting brightness - use levelControl cluster
        const cluster = service.getCluster?.('levelControl')
        if (!cluster) {
          throw new Error('LevelControl cluster not found')
        }
        await cluster.setAttributes({ currentLevel: brightnessRef.current })
        // A raw level write does not run Matter's on/off coupling, so a
        // slider move while off must also set onOff or the light state
        // never reads as on
        if (!getOnOffState(serviceRef.current)) {
          const onOffCluster = serviceRef.current.getCluster?.('onOff')
          if (!onOffCluster) {
            throw new Error('OnOff cluster not found')
          }
          await onOffCluster.setAttributes({ onOff: true })
        }
      }

      // Update local state
      setTargetMode(brightnessRef.current > 0)
    } catch (error) {
      showGenericErrorToast(error)
      // Revert to previous value on error
      setBrightness(previousBrightness)
      setTargetMode(previousBrightness > 0)
    }
  }, [serviceRef, brightnessRef, setTargetMode, setBrightness, showGenericErrorToast])

  /** The brightness slider moved (`ngModelChange`). */
  const onBrightnessChange = useCallback((value: number) => {
    setBrightness(value)
    debounce('brightness', value, () => void writeBrightness(), 300)
  }, [setBrightness, debounce, writeBrightness])

  const setTargetModeAction = useCallback(async (value: boolean, event: MouseEvent | ReactMouseEvent) => {
    const service = serviceRef.current
    const previousMode = targetModeRef.current
    const previousBrightness = brightnessRef.current

    try {
      setTargetMode(value)

      if (value) {
        // Turning on - set brightness to max if currently 0, otherwise keep current
        const targetLevel = brightnessRef.current || MatterBrightness.Max
        setBrightness(targetLevel)
        const cluster = service.getCluster?.('levelControl')
        const onOffCluster = service.getCluster?.('onOff')
        if (!cluster || !onOffCluster) {
          throw new Error(!cluster ? 'LevelControl cluster not found' : 'OnOff cluster not found')
        }
        // Both writes are needed: a raw level write does not run Matter's
        // on/off coupling (only the moveToLevelWithOnOff command does that)
        await cluster.setAttributes({ currentLevel: targetLevel })
        await onOffCluster.setAttributes({ onOff: true })
      } else {
        // Turning off - use onOff cluster instead of levelControl
        const cluster = service.getCluster?.('onOff')
        if (!cluster) {
          throw new Error('OnOff cluster not found')
        }
        await cluster.setAttributes({ onOff: false })
      }

      blurTarget(event)
    } catch (error) {
      showGenericErrorToast(error)
      // Revert to previous state on error
      setTargetMode(previousMode)
      setBrightness(previousBrightness)
    }
  }, [serviceRef, targetModeRef, brightnessRef, setTargetMode, setBrightness, blurTarget, showGenericErrorToast])

  return { onBrightnessChange, setTargetMode: setTargetModeAction }
}

export interface ColorTemperatureTarget {
  /** Kelvin, what the slider shows. */
  value: number
  /** Mireds, what the cluster takes. */
  mired: number
  min: number
  max: number
  step: number
}

/**
 * The colour temperature slider of the colour temperature and extended
 * colour light modals. The cluster is in mireds, the slider in kelvin, so the
 * slider's min and max are the mired range switched round.
 * @param initial - the service the modal was opened with
 * @param enabled - false when the light has no colour temperature: then
 * there is no slider (`targetColorTemperature` is undefined)
 */
export function useMatterColorTemperatureState(initial: ServiceTypeX, enabled = true) {
  const [target, setTarget, targetRef] = useStateRef<ColorTemperatureTarget | undefined>(() => {
    if (!enabled) {
      return undefined
    }
    const currentMired = getColorTemperatureMireds(initial)
    // Here, the min and max are switched because mired and kelvin are inversely related
    return {
      value: colour.miredToKelvin(currentMired),
      mired: currentMired,
      min: colour.miredToKelvin(MatterColorTemperature.MaxMired), // ~2000K
      max: colour.miredToKelvin(MatterColorTemperature.MinMired), // ~6800K
      step: 10,
    }
  })

  const setMired = useCallback((mired: number, value: number = colour.miredToKelvin(mired)) => {
    if (targetRef.current) {
      setTarget({ ...targetRef.current, mired, value })
    }
  }, [setTarget, targetRef])

  /** `handleAccessoryUpdate()`'s share for the colour temperature. */
  const sync = useCallback((service: ServiceTypeX) => {
    setMired(getColorTemperatureMireds(service))
  }, [setMired])

  return { targetColorTemperature: target, setMired, sync }
}

export type MatterColorTemperatureState = ReturnType<typeof useMatterColorTemperatureState>

/**
 * The colour temperature write, and the gradient of its slider.
 * @param manage - what `useManageAccessory` returned
 * @param ct - the colour temperature state
 * @param serviceRef - the newest service object
 */
export function useMatterColorTemperatureActions(manage: ManageAccessory, ct: MatterColorTemperatureState, serviceRef: RefObject<ServiceTypeX>) {
  const { debounce, showGenericErrorToast, applySliderGradient } = manage
  const { setMired, targetColorTemperature } = ct
  const hasSlider = !!targetColorTemperature
  const min = targetColorTemperature?.min
  const max = targetColorTemperature?.max

  useEffect(() => {
    if (hasSlider) {
      const minHsl = colour.kelvinToHsl(min!)
      const maxHsl = colour.kelvinToHsl(max!)
      applySliderGradient(`linear-gradient(to right, ${minHsl}, ${maxHsl})`, '.color-temp-slider .noUi-target')
    }
    // Once, when the slider is set up (loadTargetColorTemperature): none of
    // these change
  }, [hasSlider, min, max, applySliderGradient])

  const write = useCallback(async (miredValue: number) => {
    const previousMired = getColorTemperatureMireds(serviceRef.current)
    try {
      const cluster = serviceRef.current.getCluster?.('colorControl')
      if (!cluster) {
        throw new Error('ColorControl cluster not found')
      }
      await cluster.setAttributes({ colorTemperatureMireds: miredValue })
    } catch (error) {
      showGenericErrorToast(error)
      // Revert to previous value on error
      setMired(previousMired)
    }
  }, [serviceRef, setMired, showGenericErrorToast])

  /** The slider moved, in kelvin. The mired is recorded straight away, so the label does not lag. */
  const onColorTemperatureChange = useCallback((kelvin: number) => {
    const miredValue = colour.kelvinToMired(kelvin)
    setMired(miredValue, kelvin)
    debounce('colorTemperature', miredValue, value => void write(value), 300)
  }, [setMired, debounce, write])

  return { onColorTemperatureChange }
}
