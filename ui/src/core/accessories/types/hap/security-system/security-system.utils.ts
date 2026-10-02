import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

/**
 * Whether the system is on its way to another mode. Not while triggered (4):
 * the transition indicators would be misleading then.
 */
export function securityTransition(service: ServiceTypeX): { isArming: boolean, isDisarming: boolean } {
  const current = service.values?.SecuritySystemCurrentState
  const target = service.values?.SecuritySystemTargetState
  return {
    isArming: current !== target && target !== 3 && current !== 4,
    isDisarming: current !== target && target === 3 && current !== 4,
  }
}
