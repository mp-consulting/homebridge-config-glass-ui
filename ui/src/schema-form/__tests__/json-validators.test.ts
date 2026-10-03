import { describe, expect, it, vi } from 'vitest'

import { jsonSchemaFormatTests, JsonValidators } from '../engine/json.validators'

// The vendored engine is untyped (@ts-nocheck); call it the way the form does
const V = JsonValidators as any

// Validators take a control and an optional `invert` flag (used by `not` and
// `oneOf`), and return null when valid or an error object keyed by validator.
const control = (value: unknown) => ({ value }) as any
const run = (validator: any, value: unknown, invert = false) => validator(control(value), invert)

describe('jsonValidators', () => {
  describe('required', () => {
    it('returns a validator for true / no argument, and a no-op for false', () => {
      expect(run(V.required(), '')).toEqual({ required: true })
      expect(run(V.required(true), null)).toEqual({ required: true })
      expect(run(V.required(true), 0)).toBeNull()
      expect(run(V.required(true), false)).toBeNull()
      expect(V.required(false)).toBe(V.nullValidator)
    })

    it('validates directly when given a control', () => {
      expect(V.required(control(undefined))).toEqual({ required: true })
      expect(V.required(control('x'))).toBeNull()
    })

    it('is always valid when inverted', () => {
      expect(run(V.required(true), '', true)).toBeNull()
    })
  })

  describe('type', () => {
    it.each([
      ['string', 'abc', true],
      ['string', 5, false],
      ['number', 1.5, true],
      ['integer', 2, true],
      ['integer', 2.5, false],
      ['boolean', true, true],
      ['boolean', 'yes', false],
    ])('%s accepts %j: %s', (type, value, valid) => {
      expect(run(V.type(type), value) === null).toBe(valid)
    })

    it('accepts one of several types and reports the mismatch', () => {
      expect(run(V.type(['string', 'number']), 3)).toBeNull()
      expect(run(V.type(['string', 'number']), { a: 1 })).toEqual({ type: { requiredType: ['string', 'number'], currentValue: { a: 1 } } })
    })

    it('skips empty values and a missing type', () => {
      expect(run(V.type('number'), '')).toBeNull()
      expect(V.type(undefined)).toBe(V.nullValidator)
    })

    it('inverts', () => {
      expect(run(V.type('string'), 'abc', true)).not.toBeNull()
      expect(run(V.type('string'), 5, true)).toBeNull()
    })
  })

  describe('enum and const', () => {
    it('matches enum values across string input types', () => {
      const validator = V.enum([1, true, 'a', null, { x: 1 }])
      expect(run(validator, '1')).toBeNull()
      expect(run(validator, 'true')).toBeNull()
      expect(run(validator, 'a')).toBeNull()
      expect(run(validator, { x: 1 })).toBeNull()
      expect(run(validator, 'b')).toEqual({ enum: { allowedValues: [1, true, 'a', null, { x: 1 }], currentValue: 'b' } })
    })

    it('checks every item of an array value', () => {
      expect(run(V.enum(['a', 'b']), ['a', 'b'])).toBeNull()
      expect(run(V.enum(['a', 'b']), ['a', 'c'])).not.toBeNull()
    })

    it('ignores a non-array enum', () => {
      expect(V.enum('a')).toBe(V.nullValidator)
    })

    it('matches const with type conversion', () => {
      expect(run(V.const(5), '5')).toBeNull()
      expect(run(V.const(false), 'false')).toBeNull()
      expect(run(V.const('x'), 'y')).toEqual({ const: { requiredValue: 'x', currentValue: 'y' } })
      expect(V.const(undefined)).toBe(V.nullValidator)
    })
  })

  describe('string length and pattern', () => {
    it('minLength / maxLength report the lengths', () => {
      expect(run(V.minLength(3), 'ab')).toEqual({ minLength: { minimumLength: 3, currentLength: 2 } })
      expect(run(V.minLength(3), 'abc')).toBeNull()
      expect(run(V.minLength(3), '')).toBeNull()
      expect(run(V.maxLength(2), 'abc')).toEqual({ maxLength: { maximumLength: 2, currentLength: 3 } })
      expect(run(V.maxLength(2), 'ab')).toBeNull()
    })

    it('pattern matches partially by default and wholly on request', () => {
      expect(run(V.pattern('b'), 'abc')).toBeNull()
      expect(run(V.pattern('b', true), 'abc')).toEqual({ pattern: { requiredPattern: '^b$', currentValue: 'abc' } })
      expect(run(V.pattern('b', true), 'b')).toBeNull()
    })

    it('pattern accepts a RegExp, uses unicode mode, and falls back for non-unicode patterns', () => {
      expect(run(V.pattern(/^\d+$/), '123')).toBeNull()
      expect(run(V.pattern('^\\p{L}+$'), 'héllo')).toBeNull()
      // `\-` outside a class is invalid in unicode mode, valid without it
      expect(run(V.pattern('^a\\-b$'), 'a-b')).toBeNull()
    })

    it('pattern rejects non-string values', () => {
      expect(run(V.pattern('1'), 1)).not.toBeNull()
    })
  })

  describe('format', () => {
    it.each([
      ['date', '2026-10-03', '03/10/2026'],
      ['time', '16:20:00', '4pm'],
      ['date-time', '2000-03-14T01:59', '2000-03-14'],
      ['email', 'name@example.com', 'name@'],
      ['hostname', 'homebridge.local', '-bad-.local'],
      ['ipv4', '192.168.1.10', '256.1.1.1'],
      ['ipv6', '::1', '12345::'],
      ['uri', 'https://example.com/x', 'not a uri'],
      ['url', 'https://example.com/page.html', 'example.com'],
      ['uuid', '12345678-9abc-def0-1234-56789abcdef0', '1234'],
      ['color', '#ffffff', 'white'],
      ['json-pointer', '/a/b', 'a/b'],
      ['relative-json-pointer', '2/a', '/a'],
      ['duration', 'PT1H30M', 'P'],
    ])('%s accepts %j and rejects %j', (format, valid, invalid) => {
      const validator = V.format(format)
      expect(run(validator, valid)).toBeNull()
      expect(run(validator, invalid)).toEqual({ format: { requiredFormat: format, currentValue: invalid } })
    })

    it('gives the same answer every time for a global regex (color)', () => {
      // jsonSchemaFormatTests.color has the `g` flag: reusing it would carry
      // lastIndex between calls, so format() rebuilds the regex each time
      expect(jsonSchemaFormatTests.color.flags).toContain('g')
      const validator = V.format('color')
      expect([1, 2, 3].map(() => run(validator, '#abc'))).toEqual([null, null, null])
    })

    it('accepts an unknown format with a console error', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(run(V.format('made-up'), 'anything')).toBeNull()
      expect(error).toHaveBeenCalledWith(expect.stringContaining('"made-up" is not a recognized format'))
      error.mockRestore()
    })

    it('skips non-string values that count as empty (a Date has no own keys)', () => {
      expect(run(V.format('date'), new Date())).toBeNull()
      expect(run(V.format('email'), new Date())).toBeNull()
    })

    it('rejects other non-string values', () => {
      expect(run(V.format('email'), 42)).toEqual({ format: { requiredFormat: 'email', currentValue: 42 } })
    })

    it('regex format rejects \\Z', () => {
      expect(run(V.format('regex'), 'abc\\Z')).not.toBeNull()
      expect(run(V.format('regex'), '^abc$')).toBeNull()
    })
  })

  describe('numbers', () => {
    it('minimum / maximum are inclusive', () => {
      expect(run(V.minimum(5), 5)).toBeNull()
      expect(run(V.minimum(5), 4)).toEqual({ minimum: { minimumValue: 5, currentValue: 4 } })
      expect(run(V.maximum(5), 5)).toBeNull()
      expect(run(V.maximum(5), 6)).toEqual({ maximum: { maximumValue: 5, currentValue: 6 } })
    })

    it('exclusiveMaximum excludes the bound', () => {
      expect(run(V.exclusiveMaximum(5), 4)).toBeNull()
      expect(run(V.exclusiveMaximum(5), 5)).toEqual({ exclusiveMaximum: { exclusiveMaximumValue: 5, currentValue: 5 } })
    })

    // BUG (vendored from @ng-formworks/core): exclusiveMinimum tests
    // `value < bound` instead of `value > bound`, so it accepts values below
    // the minimum and rejects values above it.
    it.fails('exclusiveMinimum accepts values above the bound', () => {
      expect(run(V.exclusiveMinimum(5), 6)).toBeNull()
    })

    it.fails('exclusiveMinimum rejects values below the bound', () => {
      expect(run(V.exclusiveMinimum(5), 4)).not.toBeNull()
    })

    it('exclusiveMinimum rejects the bound itself', () => {
      expect(run(V.exclusiveMinimum(5), 5)).not.toBeNull()
    })

    it('multipleOf', () => {
      expect(run(V.multipleOf(5), 15)).toBeNull()
      expect(run(V.multipleOf(5), 16)).toEqual({ multipleOf: { multipleOfValue: 5, currentValue: 16 } })
    })

    it('ignores non-numbers and empty values', () => {
      expect(run(V.minimum(5), 'abc')).toBeNull()
      expect(run(V.maximum(5), '')).toBeNull()
    })

    it('angular-compatible min / max parse strings', () => {
      expect(run(V.min(5), '4')).toEqual({ min: { min: 5, actual: '4' } })
      expect(run(V.min(5), 'abc')).toBeNull()
      expect(run(V.max(5), '6')).toEqual({ max: { max: 5, actual: '6' } })
      expect(run(V.max(5), '5')).toBeNull()
    })
  })

  describe('objects and arrays', () => {
    it('minProperties / maxProperties', () => {
      expect(run(V.minProperties(2), { a: 1 })).toEqual({ minProperties: { minimumProperties: 2, currentProperties: 1 } })
      expect(run(V.minProperties(1), { a: 1 })).toBeNull()
      expect(run(V.maxProperties(1), { a: 1, b: 2 })).toEqual({ maxProperties: { maximumProperties: 1, currentProperties: 2 } })
    })

    it('minItems / maxItems', () => {
      expect(run(V.minItems(2), [1])).toEqual({ minItems: { minimumItems: 2, currentItems: 1 } })
      expect(run(V.maxItems(1), [1, 2])).toEqual({ maxItems: { maximumItems: 1, currentItems: 2 } })
      expect(run(V.maxItems(2), [1, 2])).toBeNull()
    })

    // The errors come back nested under the requiring field twice
    // (forEachCopy keys the result, then each entry is keyed again)
    it('dependencies: an array of fields required when another is present', () => {
      const validator = V.dependencies({ username: ['password'] })
      expect(run(validator, { username: 'u' })).toEqual({ username: { username: { password: { required: true } } } })
    })

    // BUG (vendored from @ng-formworks/core): every dependency that has no
    // error still leaves a `{ <field>: null }` entry, and `isEmpty` does not
    // treat that as empty, so a satisfied (or irrelevant) dependency returns
    // a non-null error object and the control counts as invalid.
    it.fails('dependencies: valid when the required field is present', () => {
      expect(run(V.dependencies({ username: ['password'] }), { username: 'u', password: 'p' })).toBeNull()
    })

    it.fails('dependencies: valid when the requiring field is absent', () => {
      expect(run(V.dependencies({ username: ['password'] }), { other: 1 })).toBeNull()
    })

    it('dependencies: currently returns a null entry when satisfied', () => {
      expect(run(V.dependencies({ username: ['password'] }), { username: 'u', password: 'p' })).toEqual({ username: null })
    })

    it('dependencies: a schema with required fields', () => {
      const validator = V.dependencies({ ssl: { required: ['cert', 'key'] } })
      expect(run(validator, { ssl: true, cert: 'c' })).toEqual({ ssl: { ssl: { key: { required: true } } } })
    })

    it('dependencies: ignores a non-object', () => {
      expect(V.dependencies([])).toBe(V.nullValidator)
      expect(V.dependencies({})).toBe(V.nullValidator)
    })

    it('uniqueItems: valid for distinct items and off when false', () => {
      expect(run(V.uniqueItems(), [1, 2, 3])).toBeNull()
      expect(V.uniqueItems(false)).toBe(V.nullValidator)
    })

    // BUG (vendored from @ng-formworks/core): the duplicate check is
    // `duplicateItems.includes(x)` where `!includes` was meant, so a
    // duplicate is never recorded and uniqueItems always passes.
    it.fails('uniqueItems: rejects duplicates', () => {
      expect(run(V.uniqueItems(), [1, 2, 2])).toEqual({ uniqueItems: { duplicateItems: [2] } })
    })

    it('contains: not implemented, always valid', () => {
      expect(run(V.contains('x'), ['a'])).toBeNull()
      expect(V.contains(false)).toBe(V.nullValidator)
    })
  })

  describe('composition', () => {
    const isString = V.type('string')
    const short = V.maxLength(3)

    it('composeAllOf merges every error', () => {
      const validator = V.composeAllOf([V.minLength(5), V.pattern('^\\d+$')])
      expect(run(validator, 'abc')).toEqual({
        minLength: { minimumLength: 5, currentLength: 3 },
        pattern: { requiredPattern: '^\\d+$', currentValue: 'abc' },
        allOf: true,
      })
      expect(run(validator, '12345')).toBeNull()
    })

    it('composeAnyOf passes when one validator passes', () => {
      const validator = V.composeAnyOf([V.type('number'), short])
      expect(run(validator, 'ab')).toBeNull()
      expect(run(validator, 'abcd')).toMatchObject({ anyOf: true })
    })

    it('composeOneOf passes only when exactly one validator passes', () => {
      const validator = V.composeOneOf([isString, short])
      expect(run(validator, 'abcd')).toBeNull()
      expect(run(validator, 'ab')).toMatchObject({ oneOf: true })
    })

    it('composeNot inverts a validator', () => {
      const validator = V.composeNot(isString)
      expect(run(validator, 5)).toBeNull()
      expect(run(validator, 'abc')).toMatchObject({ not: true })
      expect(run(validator, '')).toBeNull()
    })

    it('compose merges errors without a combinator key', () => {
      expect(run(V.compose([V.minLength(5), short]), 'abcd')).toEqual({ minLength: { minimumLength: 5, currentLength: 4 }, maxLength: { maximumLength: 3, currentLength: 4 } })
    })

    it('returns null for no validators', () => {
      expect(V.composeAllOf(undefined)).toBeNull()
      expect(V.composeAnyOf([undefined])).toBeNull()
      expect(V.composeOneOf([])).toBeNull()
      expect(V.composeNot(undefined)).toBeNull()
      expect(V.compose(null)).toBeNull()
      expect(V.composeAsync(null)).toBeNull()
    })
  })

  describe('angular-compatible extras', () => {
    it('requiredTrue', () => {
      expect(V.requiredTrue(control(true))).toBeNull()
      expect(V.requiredTrue(control('true'))).toEqual({ required: true })
      expect(V.requiredTrue(undefined)).toBe(V.nullValidator)
    })

    it('email', () => {
      expect(V.email(control('a@b.co'))).toBeNull()
      expect(V.email(control('a@'))).toEqual({ email: true })
      expect(V.email(undefined)).toBe(V.nullValidator)
    })
  })
})
