import type { JsonDefaultsLike, JsonDiagnosticsOptions, JsonSchemaEntry } from './json-schemas'

import { describe, expect, it } from 'vitest'

import { getJsonDefaults, registerJsonSchema, unregisterJsonSchema, upsertSchema, withoutSchema } from './json-schemas'

function fakeJsonDefaults(initial: JsonDiagnosticsOptions = {}) {
  const calls: JsonDiagnosticsOptions[] = []
  const defaults: JsonDefaultsLike = {
    diagnosticsOptions: initial,
    setDiagnosticsOptions(options) {
      calls.push(options)
      ;(defaults as { diagnosticsOptions: JsonDiagnosticsOptions }).diagnosticsOptions = options
    },
  }
  return { defaults, calls }
}

const configSchema: JsonSchemaEntry = { uri: 'http://homebridge/config.json', fileMatch: ['a://homebridge/config.json'], schema: { type: 'object' } }
const pluginSchema: JsonSchemaEntry = { uri: 'http://plugin/Foo/config.json', fileMatch: ['*'], schema: { type: 'object' } }

describe('upsertSchema / withoutSchema', () => {
  it('appends a new schema and replaces one with the same uri', () => {
    const replaced = { ...configSchema, schema: { type: 'array' } }
    expect(upsertSchema(undefined, configSchema)).toEqual([configSchema])
    expect(upsertSchema([configSchema, pluginSchema], replaced)).toEqual([pluginSchema, replaced])
  })

  it('removes by uri only', () => {
    expect(withoutSchema([configSchema, pluginSchema], configSchema.uri)).toEqual([pluginSchema])
    expect(withoutSchema(undefined, configSchema.uri)).toEqual([])
  })
})

describe('registerJsonSchema', () => {
  it('sets validate/allowComments like the Angular editors and keeps other schemas', () => {
    const { defaults, calls } = fakeJsonDefaults({ schemas: [pluginSchema], enableSchemaRequest: false })
    registerJsonSchema(defaults, configSchema)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      enableSchemaRequest: false,
      validate: true,
      allowComments: false,
      schemas: [pluginSchema, configSchema],
    })
  })

  it('removes only its own entry on dispose, once', () => {
    const { defaults, calls } = fakeJsonDefaults()
    registerJsonSchema(defaults, pluginSchema)
    const dispose = registerJsonSchema(defaults, configSchema)
    dispose()
    dispose()
    expect(defaults.diagnosticsOptions.schemas).toEqual([pluginSchema])
    expect(calls).toHaveLength(3)
  })

  it('does not remove a newer registration under the same uri (StrictMode / reopen order)', () => {
    const { defaults } = fakeJsonDefaults()
    const disposeFirst = registerJsonSchema(defaults, configSchema)
    const second = { ...configSchema, schema: { type: 'object', required: ['bridge'] } }
    const disposeSecond = registerJsonSchema(defaults, second)
    disposeFirst()
    expect(defaults.diagnosticsOptions.schemas).toEqual([second])
    disposeSecond()
    expect(defaults.diagnosticsOptions.schemas).toEqual([])
  })

  it('survives mount → unmount → mount (React StrictMode effects)', () => {
    const { defaults } = fakeJsonDefaults()
    registerJsonSchema(defaults, configSchema)()
    registerJsonSchema(defaults, configSchema)
    expect(defaults.diagnosticsOptions.schemas).toEqual([configSchema])
  })
})

describe('unregisterJsonSchema', () => {
  it('filters the uri out and keeps the base options', () => {
    const { defaults, calls } = fakeJsonDefaults({ schemas: [configSchema, pluginSchema] })
    unregisterJsonSchema(defaults, pluginSchema.uri)
    expect(calls[0]).toEqual({ validate: true, allowComments: false, schemas: [configSchema] })
  })
})

describe('getJsonDefaults', () => {
  it('prefers monaco.json (0.56+) and falls back to monaco.languages.json', () => {
    const modern = fakeJsonDefaults().defaults
    const legacy = fakeJsonDefaults().defaults
    expect(getJsonDefaults({ json: { jsonDefaults: modern }, languages: { json: { jsonDefaults: legacy } } })).toBe(modern)
    expect(getJsonDefaults({ languages: { json: { jsonDefaults: legacy } } })).toBe(legacy)
    expect(getJsonDefaults({})).toBeUndefined()
  })
})
