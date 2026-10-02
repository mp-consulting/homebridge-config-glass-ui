/**
 * Bookkeeping for the JSON schemas registered with Monaco's JSON language
 * service.
 *
 * Monaco keeps one global list of schemas (`jsonDefaults.diagnosticsOptions
 * .schemas`), and every editor on the page shares it. The Angular config
 * editor and manual-config modal each added their schema on init and filtered
 * it back out by `uri` on destroy, always with `validate: true` and
 * `allowComments: false`. These helpers do the same against a minimal
 * structural type, so they can be tested without loading Monaco.
 *
 * Unlike the Angular code, adding a schema keeps the others already
 * registered (Angular replaced the whole list), and adding the same `uri`
 * again replaces that entry instead of duplicating it.
 */

export interface JsonSchemaEntry {
  /** Unique id of the schema, e.g. `http://homebridge/config.json`. */
  readonly uri: string
  /** Model URIs (globs) the schema applies to. */
  readonly fileMatch?: string[]
  /** The JSON schema itself. */
  readonly schema?: unknown
}

export interface JsonDiagnosticsOptions {
  readonly validate?: boolean
  readonly allowComments?: boolean
  readonly schemas?: readonly JsonSchemaEntry[]
  readonly [key: string]: unknown
}

/** The part of `monaco.json.jsonDefaults` these helpers use. */
export interface JsonDefaultsLike {
  readonly diagnosticsOptions: JsonDiagnosticsOptions
  setDiagnosticsOptions: (options: any) => void
}

/** The part of the Monaco namespace needed to find `jsonDefaults`. */
export interface MonacoJsonHost {
  json?: { jsonDefaults?: JsonDefaultsLike }
  languages?: { json?: { jsonDefaults?: JsonDefaultsLike } | unknown }
}

/** The options the Angular code always set alongside the schema list. */
export const BASE_DIAGNOSTICS_OPTIONS = {
  validate: true,
  allowComments: false,
} as const

/**
 * Find `jsonDefaults`. Monaco 0.56 moved it to the top-level `monaco.json`
 * namespace; `monaco.languages.json` (what the Angular code used) still works
 * at runtime but is typed as deprecated.
 *
 * @param monaco - the Monaco namespace
 */
export function getJsonDefaults(monaco: MonacoJsonHost): JsonDefaultsLike | undefined {
  if (monaco.json?.jsonDefaults) {
    return monaco.json.jsonDefaults
  }
  const legacy = monaco.languages?.json as { jsonDefaults?: JsonDefaultsLike } | undefined
  return legacy?.jsonDefaults
}

/**
 * Return `schemas` with `entry` added, replacing any entry with the same uri.
 *
 * @param schemas - the current list
 * @param entry - the schema to add
 */
export function upsertSchema(schemas: readonly JsonSchemaEntry[] | undefined, entry: JsonSchemaEntry): JsonSchemaEntry[] {
  return [...(schemas ?? []).filter(x => x.uri !== entry.uri), entry]
}

/**
 * Return `schemas` without the entry for `uri`.
 *
 * @param schemas - the current list
 * @param uri - the uri to remove
 */
export function withoutSchema(schemas: readonly JsonSchemaEntry[] | undefined, uri: string): JsonSchemaEntry[] {
  return (schemas ?? []).filter(x => x.uri !== uri)
}

/**
 * Register (or replace) a schema in Monaco's global JSON diagnostics.
 *
 * @param jsonDefaults - `monaco.json.jsonDefaults`
 * @param entry - the schema to register
 * @returns a function that removes it again
 */
export function registerJsonSchema(jsonDefaults: JsonDefaultsLike, entry: JsonSchemaEntry): () => void {
  jsonDefaults.setDiagnosticsOptions({
    ...jsonDefaults.diagnosticsOptions,
    ...BASE_DIAGNOSTICS_OPTIONS,
    schemas: upsertSchema(jsonDefaults.diagnosticsOptions.schemas, entry),
  })
  let removed = false
  return () => {
    if (removed) {
      return
    }
    removed = true
    // Only remove the entry this call added: a later registration under the
    // same uri (e.g. the modal reopened before this cleanup ran) owns it now.
    const current = jsonDefaults.diagnosticsOptions.schemas?.find(x => x.uri === entry.uri)
    if (current && current !== entry) {
      return
    }
    unregisterJsonSchema(jsonDefaults, entry.uri)
  }
}

/**
 * Remove the schema with `uri` from Monaco's global JSON diagnostics.
 *
 * @param jsonDefaults - `monaco.json.jsonDefaults`
 * @param uri - the schema uri
 */
export function unregisterJsonSchema(jsonDefaults: JsonDefaultsLike, uri: string): void {
  jsonDefaults.setDiagnosticsOptions({
    ...jsonDefaults.diagnosticsOptions,
    ...BASE_DIAGNOSTICS_OPTIONS,
    schemas: withoutSchema(jsonDefaults.diagnosticsOptions.schemas, uri),
  })
}
