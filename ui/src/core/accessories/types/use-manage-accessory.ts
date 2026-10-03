import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'
import type { ActiveModal } from '@/core/ui/modal'
import type { MouseEvent as ReactMouseEvent } from 'react'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { accessories as accessoriesSingleton } from '@/core/accessories/accessories'
import { toastApiError } from '@/core/utilities/http-error'

/**
 * The props every accessory manage modal is opened with
 * (`openModal(XManage, { service })`), on top of `activeModal`.
 */
export interface AccessoryManageModalData {
  service: ServiceTypeX
}

export interface AccessoryManageModalProps extends AccessoryManageModalData {
  activeModal: Pick<ActiveModal, 'close' | 'dismiss'>
}

/** The part of the accessories service the manage modals read. */
export interface ManageAccessoriesSource {
  accessoryData: { subscribe: (listener: (data: unknown) => void) => () => void }
  accessories: { services: ServiceTypeX[] }
}

export interface UseManageAccessoryOptions {
  activeModal: Pick<ActiveModal, 'dismiss'>
  /**
   * `setupComponent()`: runs once, after the modal data was checked. Most
   * modals compute their initial state in `useState` initialisers instead;
   * this is for side effects (slider gradients, …).
   */
  onSetup?: (service: ServiceTypeX) => void
  /**
   * `handleAccessoryUpdate()`: runs on every live accessory payload, with the
   * newest service object already swapped in (the hook's `service` follows).
   */
  onUpdate?: (service: ServiceTypeX) => void
  /** The accessories service. Defaults to the singleton; specs pass a stub (or null). */
  accessories?: ManageAccessoriesSource | null
}

export interface ManageAccessory {
  /** The newest service object (replaced on every live payload). */
  service: ServiceTypeX
  /** False when the modal data was incomplete and the modal is being dismissed. */
  ready: boolean
  $accessories: ManageAccessoriesSource | null
  dismissModal: () => void
  showGenericErrorToast: (error?: unknown) => void
  /**
   * `createDebouncedSubscription` + `subject.next(value)` in one: call it on
   * every change, and `callback` runs `debounceMs` after the last call with
   * the same `key`. Pending calls are dropped when the modal unmounts.
   */
  debounce: <T>(key: string, value: T, callback: (value: T) => void, debounceMs?: number) => void
  applySliderGradient: (gradient: string, selector?: string) => void
  blurTarget: (event: MouseEvent | ReactMouseEvent) => void
}

/**
 * `BaseManageComponent` as a hook: the shared plumbing of the accessory
 * manage modals - modal-data null safety, live service updates, debounced
 * characteristic writes, slider gradients and the generic error toast.
 * @param service - the service the modal was opened with
 * @param options - see UseManageAccessoryOptions
 */
export function useManageAccessory(service: ServiceTypeX | undefined, options: UseManageAccessoryOptions): ManageAccessory {
  const source = options.accessories === undefined ? accessoriesSingleton : options.accessories
  const ready = !!service && !!source

  const [current, setCurrent] = useState<ServiceTypeX | undefined>(service)
  const currentRef = useRef(current)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // Setup once, or dismiss when the modal data is incomplete
  useEffect(() => {
    if (!ready) {
      console.error('useManageAccessory: service or $accessories not provided')
      optionsRef.current.activeModal.dismiss('Missing required data')
      return
    }
    optionsRef.current.onSetup?.(currentRef.current!)
    // Only on mount, like ngOnInit
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  // Live accessory updates
  useEffect(() => {
    if (!ready || !source) {
      return
    }
    return source.accessoryData.subscribe(() => {
      // Find the latest object for this service: the service list holds a
      // fresh object after every payload
      const uniqueId = currentRef.current?.uniqueId
      const updated = source.accessories.services.find(s => s.uniqueId === uniqueId)
      if (updated) {
        currentRef.current = updated
        setCurrent(updated)
      }
      optionsRef.current.onUpdate?.(currentRef.current!)
    })
  }, [ready, source])

  // Drop pending debounced writes when the modal closes, otherwise a slider
  // nudged and then cancelled still writes to the accessory after it has gone
  useEffect(() => {
    const pending = timersRef.current
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer)
      }
      pending.clear()
    }
  }, [])

  const dismissModal = useCallback(() => {
    optionsRef.current.activeModal.dismiss('Dismiss')
  }, [])

  /**
   * Show a translated generic error toast. Manage modals call this from their
   * cluster-write catch blocks instead of a hardcoded English string, so the
   * user sees one consistent translated message. The raw error still goes to
   * `console.error` for debugging.
   */
  const showGenericErrorToast = useCallback((error?: unknown) => {
    if (error !== undefined) {
      console.error(error)
    }
    toastApiError(error)
  }, [])

  const debounce = useCallback(<T>(key: string, value: T, callback: (value: T) => void, debounceMs = 500) => {
    const pending = timersRef.current
    const existing = pending.get(key)
    if (existing !== undefined) {
      clearTimeout(existing)
    }
    pending.set(key, setTimeout(() => {
      pending.delete(key)
      callback(value)
    }, debounceMs))
  }, [])

  /**
   * Apply a gradient background to the slider elements on the next frame.
   * Modals with two sliders pass their own selector so the gradients do not
   * overwrite each other.
   */
  const applySliderGradient = useCallback((gradient: string, selector = '.noUi-target') => {
    requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>(selector).forEach((sliderElement) => {
        sliderElement.style.background = gradient
      })
    })
  }, [])

  const blurTarget = useCallback((event: MouseEvent | ReactMouseEvent) => {
    (event.target as HTMLElement | null)?.blur?.()
  }, [])

  return useMemo(() => ({
    service: current as ServiceTypeX,
    ready,
    $accessories: source,
    dismissModal,
    showGenericErrorToast,
    debounce,
    applySliderGradient,
    blurTarget,
  }), [current, ready, source, dismissModal, showGenericErrorToast, debounce, applySliderGradient, blurTarget])
}
