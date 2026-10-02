import { describe, expect, it } from 'vitest'

import { serviceToTranslationString } from '@/core/pipes/service-to-translation-string'

describe('serviceToTranslationString', () => {
  it.each([
    ['Switch', 'accessories.core.switch'],
    ['Lightbulb', 'accessories.core.lightbulb'],
    ['HeaterCooler', 'accessories.core.heater_cooler'],
    ['SecuritySystem', 'accessories.core.security_system'],
    ['HumidifierDehumidifier', 'accessories.core.humidifier_dehumidifier'],
  ])('turns %s into %s', (value, expected) => {
    expect(serviceToTranslationString(value)).toBe(expected)
  })

  it('sends SmartSpeaker to the Speaker label, which is the only special case', () => {
    // There is no dedicated SmartSpeaker translation, so it reuses Speaker
    expect(serviceToTranslationString('SmartSpeaker')).toBe('accessories.core.speaker')
    expect(serviceToTranslationString('Speaker')).toBe('accessories.core.speaker')
  })

  it('passes empty and non-string values straight through', () => {
    expect(serviceToTranslationString('')).toBe('')
    expect(serviceToTranslationString(null as any)).toBeNull()
    expect(serviceToTranslationString(undefined as any)).toBeUndefined()
  })
})
