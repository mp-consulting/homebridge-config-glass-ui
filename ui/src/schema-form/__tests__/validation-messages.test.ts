import { describe, expect, it } from 'vitest'

import { JsonValidators } from '../engine/json.validators'
import {
  deValidationMessages,
  enValidationMessages,
  esValidationMessages,
  frValidationMessages,
  itValidationMessages,
  ptValidationMessages,
  zhValidationMessages,
} from '../engine/validation-messages'

// The vendored engine is untyped (@ts-nocheck); call it the way the form does
const V = JsonValidators as any

const locales = {
  de: deValidationMessages,
  en: enValidationMessages,
  es: esValidationMessages,
  fr: frValidationMessages,
  it: itValidationMessages,
  pt: ptValidationMessages,
  zh: zhValidationMessages,
} as Record<string, Record<string, string | ((error: any) => string)>>

const control = (value: unknown) => ({ value }) as any

/**
 * One real error object per message key, produced by the validator itself,
 * so a placeholder that names a field the validator does not return shows up.
 */
const errorsByKey: Record<string, Record<string, unknown>> = {
  minLength: V.minLength(5)(control('abc')).minLength,
  maxLength: V.maxLength(2)(control('abc')).maxLength,
  pattern: V.pattern('^\\d+$')(control('abc')).pattern,
  minimum: V.minimum(5)(control(1)).minimum,
  exclusiveMinimum: { exclusiveMinimumValue: 5, currentValue: 5 },
  maximum: V.maximum(5)(control(9)).maximum,
  exclusiveMaximum: V.exclusiveMaximum(5)(control(5)).exclusiveMaximum,
  minProperties: V.minProperties(3)(control({ a: 1 })).minProperties,
  maxProperties: V.maxProperties(1)(control({ a: 1, b: 2 })).maxProperties,
  minItems: V.minItems(3)(control([1])).minItems,
  maxItems: V.maxItems(1)(control([1, 2])).maxItems,
}

/** What json-schema-form.service does with a string message */
function interpolate(message: string, error: Record<string, unknown>) {
  return Object.keys(error).reduce((text, key) => text.replace(new RegExp(`{{${key}}}`, 'g'), String(error[key])), message)
}

describe('validation messages', () => {
  it('every locale has the same keys as English', () => {
    const english = Object.keys(enValidationMessages).sort()
    for (const [code, messages] of Object.entries(locales)) {
      expect(Object.keys(messages).sort(), code).toEqual(english)
    }
  })

  it('has no message for type, const, enum or dependencies', () => {
    for (const key of ['type', 'const', 'enum', 'dependencies']) {
      expect(enValidationMessages).not.toHaveProperty(key)
    }
  })

  // BUG (vendored from @ng-formworks/core): the French maxItems message uses
  // {{minimumItems}}, which a maxItems error never has, so the user sees the
  // raw placeholder.
  const knownBroken = new Set(['fr.maxItems'])

  const placeholderCases = Object.keys(locales).flatMap(code => Object.keys(errorsByKey).map(key => [code, key] as const))

  it.each(placeholderCases.filter(([code, key]) => !knownBroken.has(`${code}.${key}`)))(
    '%s.%s fills every placeholder from the validator\'s own error fields',
    (code, key) => {
      const message = locales[code][key]
      expect(typeof message).toBe('string')
      expect(interpolate(message as string, errorsByKey[key])).not.toMatch(/\{\{.*?\}\}/)
    },
  )

  it.fails('fr.maxItems fills its placeholders', () => {
    expect(interpolate(frValidationMessages.maxItems as string, errorsByKey.maxItems)).not.toMatch(/\{\{.*?\}\}/)
  })

  describe.each(Object.entries(locales))('%s', (_code, messages) => {
    it('has a non-empty static message for required and uniqueItems', () => {
      expect(messages.required).toEqual(expect.any(String))
      expect(messages.required).not.toBe('')
      expect(messages.uniqueItems).toEqual(expect.any(String))
    })

    it('describes every known format, and falls back for unknown ones', () => {
      const format = messages.format as (error: any) => string
      const formats = ['date', 'time', 'date-time', 'email', 'hostname', 'ipv4', 'ipv6', 'url', 'uuid', 'color', 'json-pointer', 'relative-json-pointer', 'regex', 'duration']
      const texts = formats.map(requiredFormat => format({ requiredFormat }))
      // One distinct text per format
      expect(new Set(texts).size).toBe(formats.length)
      const fallback = format({ requiredFormat: 'made-up-format' })
      expect(fallback).toContain('made-up-format')
      expect(texts).not.toContain(fallback)
    })

    it('multipleOf talks about decimal places for powers of ten below 1', () => {
      const multipleOf = messages.multipleOf as (error: any) => string
      expect(multipleOf({ multipleOfValue: 0.01 })).toContain('2')
      expect(multipleOf({ multipleOfValue: 0.01 })).not.toContain('0.01')
      expect(multipleOf({ multipleOfValue: 5 })).toContain('5')
    })
  })

  it('english texts read as expected', () => {
    expect(interpolate(enValidationMessages.minLength as string, errorsByKey.minLength))
      .toBe('Must be 5 characters or longer (current length: 3)')
    expect(interpolate(enValidationMessages.maxItems as string, errorsByKey.maxItems))
      .toBe('Must have 1 or fewer items (current items: 2)')
    expect(interpolate(enValidationMessages.pattern as string, errorsByKey.pattern))
      .toBe('Must match pattern: ^\\d+$')
    const multipleOf = enValidationMessages.multipleOf as (error: any) => string
    expect(multipleOf({ multipleOfValue: 0.1 })).toBe('Must have 1 or fewer decimal places.')
    expect(multipleOf({ multipleOfValue: 0.01 })).toBe('Must have 2 or fewer decimal places.')
    expect(multipleOf({ multipleOfValue: 3 })).toBe('Must be a multiple of 3.')
    const format = enValidationMessages.format as (error: any) => string
    expect(format({ requiredFormat: 'ipv4' })).toBe('Must be an IPv4 address, like "127.0.0.1"')
    expect(format({ requiredFormat: 'uri' })).toBe('Must be a correctly formatted uri')
  })
})
