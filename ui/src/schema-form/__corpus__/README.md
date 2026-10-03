# Schema-form golden corpus

Regression tests for the schema form (`ui/src/schema-form`) against what the Angular
`@ng-formworks` form of 1.x did with the same plugin schemas. See docs/react-migration-plan.md §4.

The goldens are frozen: they were recorded from the Angular UI before it was removed (one
plugin per process, since ng-formworks leaked state between forms) and can no longer be
re-recorded. A behaviour change that breaks one is either a regression or a deliberate
difference to add to `__tests__/golden-known-differences.json` with its reason.

Run them with `npx vitest run src/schema-form/__tests__/SchemaForm.golden` in `ui/`, after
`node scripts/schema-corpus/fetch.mjs --from-manifest` (repo root) has fetched the schemas.

## Layout

- `manifest.json` (committed): `[{ "plugin": "homebridge-foo", "version": "1.2.3" }]`
  — the pinned plugin versions the corpus is built from.
- `schemas/<plugin>.json` (gitignored, fetched by `scripts/schema-corpus/fetch.mjs`):
  the plugin's `config.schema.json`, unmodified.
- `goldens/<plugin>.json` (committed): what the Angular form did, recorded by its
  `schema-form.golden-recorder.spec.ts` (removed with the Angular UI; see git history).

## Golden file format

```jsonc
{
  "plugin": "homebridge-foo",
  "version": "1.2.3",
  "initialData": {}, // data passed to the form
  "steps": [ // replayed in order by the React test
    { "op": "type", "index": 0, "value": "golden" }, // nth <input type=text|email|url|password|number> / <textarea>, in DOM order
    { "op": "toggle", "index": 2 }, // nth <input type=checkbox>
    { "op": "select", "index": 0, "value": "<option value attr>" }, // nth <select>
    { "op": "radio", "index": 1 }, // nth <input type=radio>
    { "op": "add", "index": 0 }, // nth "add item" button
    { "op": "remove", "index": 0, "list": 2, "item": 1 } // nth remove button; list/item: see below
  ],
  "snapshots": [ // snapshots[0] = after init; snapshots[i+1] = after steps[i]
    {
      "data": {}, // last value emitted on dataChange (uuid-looking strings replaced by "<uuid>")
      "isValid": true,
      "controls": { "text": 1, "number": 0, "textarea": 0, "checkbox": 2, "radio": 0, "select": 1, "add": 1, "remove": 0 },
      "labels": ["Name", "Enabled"] // trimmed textContent of visible <label>/<legend>, DOM order, required "*" stripped
    }
  ]
}
```

Rules shared by recorder and replayer:

- Render through the app's own wrapper (Angular `SchemaFormComponent`, React `<SchemaForm>`),
  with the plugin schema wrapped the way `plugin-config` passes it:
  `{ schema: s.schema, layout: s.layout, form: s.form, uiSchema: s.uiSchema, fixArrays: s.fixArrays }`.
- After each step, wait for the form to settle (≥ 100 ms: the 50 ms `isValid` debounce plus microtasks).
- "Visible" means not inside an element with `display:none`/`hidden`, and not removed by a condition.
- Step policy (recorder, deterministic, max 12 steps): type `"golden"` (or `7` for number) into the first
  text and first number control; toggle each checkbox once (first 4); select the second option of each
  select (first 2); click each add button once (first 3), then each remove button that appeared (first 3).
- A `remove` step also records which array item it removed. The item is the button's nearest
  `select-framework-widget`; `list` is the position of that widget's parent among the parents of every
  `select-framework-widget` in the form (DOM order, each counted once), and `item` the widget's position
  among that parent's `select-framework-widget` children. This covers list arrays (one `.cdk-drag` per
  item) and tab arrays (one tab pane per item) alike. Replay clicks that item's button. `index` alone is
  not enough: ng-formworks shows the remove button of an array's initial items only once the array
  changes, so the nth button differs.
