import type { ServiceTypeX } from '@/core/accessories/accessories.interfaces'

/**
 * The inputs linked to a television, by the name they were given (or "Input
 * n" for an unnamed one), in the order they were linked.
 * @param service - the television service
 */
export function televisionInputs(service: ServiceTypeX): { identifier: number, name: string }[] {
  const inputs: { identifier: number, name: string }[] = []
  if (service.linkedServices) {
    for (const [, inputService] of Object.entries(service.linkedServices)) {
      if (inputService.type === 'InputSource') {
        inputs.push({
          identifier: inputService.values.Identifier,
          name: inputService.values.ConfiguredName || `Input ${inputService.values.Identifier}`,
        })
      }
    }
  }
  return inputs
}
