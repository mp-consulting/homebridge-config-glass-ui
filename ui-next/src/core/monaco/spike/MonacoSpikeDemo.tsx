// TEMPORARY (Phase 0, spike B). Rendered from App.tsx behind `?spike=monaco`.
// Delete once the config editor is ported.
import type { editor } from 'monaco-editor'

import type { JsonSchemaEntry } from '../json-schemas'

import { useMemo, useState } from 'react'

import { useMonacoTheme } from '../monaco-theme'
import { MonacoDiffEditor, MonacoEditor } from '../MonacoEditor'

const MODEL_URI = 'a://homebridge/config.json'

// A cut-down version of the schema the Angular config editor registers.
const CONFIG_SCHEMA: JsonSchemaEntry = {
  uri: 'http://homebridge/config.json',
  fileMatch: [MODEL_URI],
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['bridge'],
    properties: {
      bridge: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'username', 'port', 'pin'],
        properties: {
          name: { type: 'string', minLength: 1 },
          username: { type: 'string', pattern: '^([A-Fa-f0-9]{2}:){5}[A-Fa-f0-9]{2}$' },
          port: { type: 'integer', minimum: 1025, maximum: 65534 },
          pin: { type: 'string', pattern: '^\\d{3}-\\d{2}-\\d{3}$' },
        },
      },
      accessories: { type: 'array', items: { type: 'object' } },
      platforms: { type: 'array', items: { type: 'object' } },
    },
  },
}

const SAMPLE_CONFIG = JSON.stringify({
  bridge: {
    name: 'Homebridge',
    username: '0E:12:34:56:78:9A',
    port: 'not-a-port',
    pin: '031-45-154',
  },
  accessories: [],
  platforms: [{ platform: 'config' }],
}, null, 4)

export function MonacoSpikeDemo() {
  const [diff, setDiff] = useState(false)
  const [markers, setMarkers] = useState<editor.IMarker[]>([])
  const theme = useMonacoTheme()
  const options = useMemo(() => ({ glyphMargin: true }), [])

  return (
    <div className="container-fluid py-3 d-flex flex-column" style={{ height: '100vh' }}>
      <div className="d-flex gap-2 align-items-center mb-2">
        <h1 className="h5 m-0">Spike B: Monaco</h1>
        <button type="button" className="btn btn-sm btn-secondary" data-testid="toggle-dark" onClick={() => document.body.classList.toggle('dark-mode')}>
          Toggle dark-mode (
          {theme}
          )
        </button>
        <button type="button" className="btn btn-sm btn-secondary" data-testid="toggle-diff" onClick={() => setDiff(x => !x)}>
          {diff ? 'Editor' : 'Diff editor'}
        </button>
      </div>
      <div className="flex-grow-1 border" style={{ minHeight: 300 }}>
        {diff
          ? (
              <MonacoDiffEditor
                language="json"
                original="{}"
                modified={SAMPLE_CONFIG}
                modifiedModelPath={MODEL_URI}
                jsonSchema={CONFIG_SCHEMA}
                options={options}
              />
            )
          : (
              <MonacoEditor
                language="json"
                path={MODEL_URI}
                defaultValue={SAMPLE_CONFIG}
                jsonSchema={CONFIG_SCHEMA}
                options={options}
                onValidate={setMarkers}
              />
            )}
      </div>
      <ul className="small mt-2 mb-0" data-testid="markers">
        {markers.map(m => (
          <li key={`${m.startLineNumber}:${m.startColumn}:${m.message}`}>
            {`L${m.startLineNumber}: ${m.message}`}
          </li>
        ))}
      </ul>
    </div>
  )
}
