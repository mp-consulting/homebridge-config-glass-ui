# Angular → React migration plan

Status: **done 2026-10-02** on `refactor/react-ui` (approved 2026-10-01); all phases implemented, cut over to `ui/`, versioned 2.0.0-beta.0. See §9 · Target: React 19 + Vite · Scope: `ui/` only (the Nest backend stays, with a few small changes)

## 1. What we're migrating

|                                            | Size                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| Angular TS (non-spec)                      | ~39k lines, 300 files                                                     |
| Templates                                  | ~20.6k lines, 187 files                                                   |
| Component SCSS                             | ~3.7k lines (93 files, almost all global-style, 8 `:host`, 1 `::ng-deep`) |
| Global SCSS                                | ~3.7k lines, about 95% framework-agnostic (Bootstrap class names)         |
| Components / pipes / directives / services | 190 / 6 / 2 / 24                                                          |
| Specs                                      | 100 files, ~46k lines, 3,102 `it()` — 88 use TestBed                      |
| i18n                                       | 29 locales, 1,029 flat keys, `{{ x }}` placeholders, no plurals/ICU       |

The Angular code is already modern: standalone everywhere, zoneless, OnPush, signals, new control flow, HTTP returning promises. That helps a lot. Signals map to React state, and there's no NgModule or zone.js to untangle.

Where the code is concentrated:

- `core/accessories`: 18.4k lines, 92 components (57 HAP + 32 Matter tiles/modals). Repetitive, so it suits batch porting.
- `core/plugins`: 9.2k lines. Includes `plugin-bridge` (1,871 TS + 981 HTML), the largest file.
- `modules/settings`: 8.2k lines. `settings.component` alone is 2,715 TS + 2,112 HTML.
- `modules/status`: 6.5k lines. Dashboard with 14 widgets.
- `modules/config-editor`: 2.3k lines (1,729 in one component).

## 2. Target stack and library mapping

| Angular piece                                                                | Replacement                                                                                                                                                                                 | Notes                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@angular/*` core, signals                                                   | React 19 (`useState`/`useMemo`/`useEffect`)                                                                                                                                                 | `computed` → `useMemo`, `effect` → `useEffect`, `viewChild` → `useRef`                                                                                        |
| App-wide services (`providedIn: 'root'`)                                     | **Zustand** stores + plain TS modules                                                                                                                                                       | `SettingsService`, `AuthService`, `NotificationService` become stores. Services with no state become plain modules.                                           |
| `@angular/router`                                                            | **React Router 7** (data router, `createBrowserRouter`)                                                                                                                                     | Guards → `loader`s that `redirect()`. Resolvers → `loader`s. `canDeactivate` → `useBlocker`. `loadComponent` → `lazy`. View transitions → `viewTransition`.   |
| `HttpClient` + `@auth0/angular-jwt` + interceptor                            | `fetch` wrapper in `api.ts` + **jwt-decode**                                                                                                                                                | Bearer header, `credentials: 'include'`, a 401 → logout rule (same URL exclusions), blob responses                                                            |
| RxJS                                                                         | Mostly removed                                                                                                                                                                              | Socket `connected` → event/promise; `request()` → Promise; `debounceTime` → `useDebouncedCallback`; `takeUntilDestroyed` → effect cleanup                     |
| `@ngx-translate/core`                                                        | **i18next + react-i18next**                                                                                                                                                                 | Existing JSON files work unchanged with `keySeparator: false`, `nsSeparator: false` (i18next trims `{{ x }}`). `\| translate` → `t()`.                        |
| Angular date/number pipes + `registerLocaleData` (28 locales)                | `Intl.DateTimeFormat` / `Intl.NumberFormat` (+ dayjs where already used)                                                                                                                    | Delete `registerLocaleData`; keep the `supportedLocales` map                                                                                                  |
| `@ng-bootstrap` (modal, tooltip, alert, dropdown, accordion, nav, typeahead) | **react-bootstrap** (+ a small typeahead, e.g. `react-bootstrap-typeahead` or a `<datalist>`)                                                                                               | Bootstrap 5 CSS and every SCSS override stay as they are                                                                                                      |
| `NgbModal` + 28 `InjectionToken`s + 83 `createEnvironmentInjector` sites     | **Promise-based modal service** `openModal(Component, props, { size, backdrop })` returning `Promise<result>`                                                                               | Tokens become typed props. `NgbActiveModal` → `useActiveModal()` (`close`/`dismiss`). `ref.result` semantics stay the same.                                   |
| `ngx-toastr` (~360 calls, 2 custom toasts)                                   | **react-toastify** behind a `toast` facade with the same `error/success/warning/info/clear` API                                                                                             | Bottom-right, max 2 open. Remap `.toast-*` SCSS.                                                                                                              |
| `@ng-formworks/*` + 3 patches + `jsfPatch`                                   | **Custom React renderer for the Angular Schema Form dialect** — see §4                                                                                                                      | Highest risk                                                                                                                                                  |
| `ngx-monaco-editor-v2`                                                       | **@monaco-editor/react** with `loader.config({ paths: { vs: 'assets/monaco/min/vs' } })`                                                                                                    | Keeps the AMD asset copy and `verify-monaco-assets.mjs`. JSON-schema diagnostics code ports as-is.                                                            |
| `angular-gridster2`                                                          | **react-grid-layout**                                                                                                                                                                       | 20 cols, rowHeight 36, vertical compaction, mobile breakpoint 1023. **Keep the persisted widget keys** (`component` class names) so saved layouts still load. |
| `ng2-dragula`                                                                | **@dnd-kit/sortable**                                                                                                                                                                       | Rooms and nested services, plus the accessories widget. Fixes the index-sync workaround (#2790) for free.                                                     |
| `ng2-nouislider` (49 instances)                                              | Thin `<Slider>` wrapper around **nouislider** itself                                                                                                                                        | Keeps `.noUi-*` SCSS and `applySliderGradient()` unchanged                                                                                                    |
| `ng2-charts`                                                                 | **react-chartjs-2**                                                                                                                                                                         | Same tree-shaken registerables                                                                                                                                |
| `DomSanitizer` in markdown                                                   | **DOMPurify** (add as a direct dependency)                                                                                                                                                  | Required: third-party plugin markdown is rendered                                                                                                             |
| `[longClick]`/`[shortClick]`                                                 | `useLongPress` hook                                                                                                                                                                         | Keep the 350 ms threshold and the iOS replay handling                                                                                                         |
| Pipes                                                                        | Plain functions (`convertTemp`, `convertMired`, `duration`, `prettify`, `interpolateMd`, `serviceToTranslationString`)                                                                      |                                                                                                                                                               |
| `@angular/localize`, `@angular/animations`, `@angular/cdk`                   | Dropped                                                                                                                                                                                     | Not used directly                                                                                                                                             |
| Unchanged                                                                    | xterm, socket.io-client, marked, qrcode, dayjs, semver, json5, lodash-es, file-saver, mobile-detect, is-standalone-pwa, `@homebridge/hap-client` (types), chart.js, bootstrap, Font Awesome |                                                                                                                                                               |

## 3. Build, dev and backend changes

**Vite config (`ui/vite.config.ts`)**

- `build.outDir: '../public'`, `emptyOutDir: true`. Use relative `base: './'` so subpath hosting keeps working; prod already reads `<base href>` at runtime.
- `server: { port: 4200, strictPort: true, host: '0.0.0.0' }`. **This is required:** the backend allows dev CORS and plugin UIs only from ports 4200/8080 (`src/core/regex.constants.ts`).
- `vite-plugin-static-copy`: `@homebridge/plugin-ui-utils/dist/ui.js*` → `assets/plugin-ui-utils/`, and the Monaco `min/vs` globs → `assets/monaco/min/vs/` (same set as `angular.json`).
- A small `transformIndexHtml` plugin to emit `crossorigin="use-credentials"` (Vite emits `crossorigin` = anonymous by default).
- `resolve.alias: { '@': '/src' }`. Import `../src/global-defaults.ts` as today.
- Hashed file names `[name]-[hash].js` must match `RE_HASHED_ASSET` in `src/core/static-assets.ts`. Check this on the first build.
- `fileReplacements` → `import.meta.env.DEV` inside one `environment.ts`. Move the OpenWeatherMap `appid` to `VITE_*` env or keep it hard-coded as today.
- Chunk-load error → reload, via `vite:preloadError`, replacing the router `NavigationError` handler.
- Keep the 1.6 MB initial-bundle budget as a CI size check (e.g. `size-limit` or a small script).

**Scripts and tooling**

- `fontawesome-subset.mjs`, `lang-sync.ts`, `verify-monaco-assets.mjs`: work unchanged. Update the paths in error messages and add `.tsx` to the scanned extensions.
- `apply-patches.mjs` and `ui/patches/`: the `@ng-formworks` patches are deleted.
- ESLint: `@antfu/eslint-config` `angular: true` → `react: true`. Drop the ~85 `angular*` rules, the `@angular-eslint/*` devDeps and the root `overrides` block. Drop the `.angular` ignores.
- Tests: plain Vitest + jsdom + **@testing-library/react**. `vi.mock` works again, so the `SOCKET_FACTORY`/`TERMINAL_FACTORY`/`SAVE_AS` injection tokens become plain imports.
- CI (`build.yml`): no structural change (`npm ci --prefix ui`, lint, build, `test:ui`).

**Backend (small)**

- CSP: keep `'unsafe-inline'` for styles (Vite dev and react-bootstrap inline styles) and update the "Angular injects…" comment. `script-src` needs no change, since the prod `index.html` has no inline script.
- No change to SPA serving, static cache headers or dev ports if Vite stays on 4200.
- Update `CLAUDE.md`, `README.md` and `CONTRIBUTING.md`, and change `.gitignore` (`.angular` → nothing; Vite cache sits under `node_modules`).

**Plugin custom-UI iframe (needs testing)**
`injectDefaultStyles` forwards every parent `<link rel=stylesheet>` and the content of every `<style>`. Angular put component styles in `<style>` tags; a Vite prod build emits `<link>` files instead. The forwarding code already handles both, but theming inside plugin iframes **must be tested** against a few real custom-UI plugins (e.g. homebridge-hue, homebridge-camera-ffmpeg, homebridge-ring).

## 4. The main risk: the plugin settings form

Every plugin with a `config.schema.json` (and every custom UI calling `homebridge.showSchemaForm()` / `createForm()`) renders through `@ng-formworks`. Homebridge schemas use the **Angular Schema Form dialect**: `layout`/`form` arrays, `section`/`fieldset` with `expandable`, `condition.functionBody` JS strings, `notitle`, `titleMap`, nested arrays with `$ref` items. They also use our patched behaviour: ajv-keywords `dynamicDefaults` (uuid) and `uniqueItemProperties`, the regex `u` flag, null-safe condition rewriting, synchronous array data, `buttonText`, and the `hb-uix-switch` checkbox markup.

**react-jsonschema-form does not speak this dialect** (it has no layout arrays and no `functionBody` conditions). A lossy conversion would quietly break third-party plugins.

**Decision: port formworks' logic into React, keeping its behaviour exactly.**

- In `@ng-formworks/core` 21.7.0, the first ~8.4k lines of the bundle are framework-free: utilities, `JsonPointer`, the condition parser and evaluator, `JsonValidators`, the schema/layout builders (`buildLayout`, `buildFormGroupTemplate`, `formatFormData`) and `JsonSchemaFormService`. Their only Angular dependencies are `UntypedFormControl/Group/Array` and `@Injectable`.
- Vendor that code from the **already-patched** installed bundle into `ui-next/src/schema-form/engine/`, so our three patch-package patches are carried in the source. Replace `@angular/forms` with a small framework-free control shim (`value`, `controls`, `valueChanges`, `setValue`/`patchValue`, `push`/`insert`/`removeAt`, `errors`, validators). Keep RxJS inside the engine only.
- Rewrite only the widget layer in React (root, section/fieldset, input, number, checkbox(es), radios, select, textarea, tabs, one-of, add-reference, message/template, buttons) plus the bootstrap5 framework wrapper. The DOM and classes must be identical (`hb-uix-switch`, `list-group-hb`, `help-block`, legends), so the SCSS and plugin expectations still hold. Build the accessibility fixes from `jsfPatch` straight into the widgets.
- Keep the outer contract of `schema-form.component`: `schema`/`layout`/`form`/`data` in; `dataChange`/`isValid` out; the `_bridge` key passed through verbatim; `isValid` debounced by 50 ms.
- The vendored code keeps formworks' MIT licence header.

**De-risking with a corpus:** in phase 0, download the `config.schema.json` of the top ~200 Homebridge plugins from npm (verified first, then by downloads). Build a **golden test harness** that renders each schema with sample data in both the Angular form (headless, recorded once) and the new renderer, then compares the resulting **data model** and the set of visible fields. Ship when the corpus passes.

The golden harness compares **output config JSON** for scripted edits (load, toggle a condition, add/remove/move array items, save). Output must be byte-identical to the Angular renderer's.

## 5. Strategy: build alongside, cut over once

You can't ship half an SPA, so running Angular and React side by side in one bundle isn't worth the complexity. Instead:

1. Work on a long-lived branch `refactor/react-ui`.
2. Build the new app in **`ui-next/`** next to `ui/`. Angular stays buildable, testable and diffable throughout, and each port can be checked against the original.
3. Add `npm run watch:next` (Vite on 4200, same backend) for side-by-side manual checks.
4. At cutover: point `build:ui`/`test:ui`/`watch:ui` at `ui-next`, delete `ui/`, rename `ui-next/` → `ui/`, fix scripts and paths, and release as **2.0.0**. The UI rewrite is a visible change to plugin custom UIs even when everything goes well.

**Testing approach.** Pure-logic specs (~12 files, plus the logic parts of service specs) port almost as-is. The 68 TestBed component specs are behaviour tests (socket events through FakeWs, modal opens, API calls), so **their scenarios become the checklist** for the RTL rewrite. The existing fakes and fixtures in `ui/src/testing/` are mostly framework-neutral and get reused. Add a small **Playwright smoke suite** (login → dashboard → plugins → settings → config editor) against a real backend in `UIX_INSECURE_MODE`. It runs on both UIs, which gives an objective parity check at cutover.

## 6. Phases

Sizes are Angular source lines being replaced (TS+HTML, excluding specs).

### Phase 0 — Spikes and scaffolding (go/no-go gate)

- Scaffold `ui-next/`: Vite, React 19, TS strict, React Router, Zustand, i18next, Vitest+RTL, ESLint `react: true`, static copies, global SCSS imported unchanged.
- **Spike A: schema-form renderer** against the plugin corpus (§4). Decides between the custom renderer and the rjsf fallback.
- **Spike B: Monaco** via `@monaco-editor/react` with the AMD assets, plus `verify-monaco-assets` passing against the Vite output.
- **Spike C: plugin custom-UI iframe** themed correctly from a Vite build.
- Exit: all three spikes green, build output served by the real backend.

### Phase 1 — Foundation (~3k lines)

- Portable modules copied over: token store, regex constants, interfaces, `locales` helpers, html helper, colour, mobile-detect, ttl-cache, schema helpers (`TranslateService` → `TFunction`), global-defaults.
- `api.ts` (fetch + bearer + 401 rule), `auth` store (session bootstrap via `/auth/session`, refresh, inactivity timer, noauth reload budget), `settings` store (retrying `/auth/settings`, themes/glass/dark body classes, iframe mirroring, server-time-offset toast, `setLang`), `notifications` store.
- **`ws.ts` with the exact ref-count semantics**: one socket per namespace, auth callback per reconnect, `connect()` takes a ref, `borrow()` doesn't, the last `release()` emits `end`. Plus `useNamespace(ns)` / `useSocketEvent(ns, event, handler)` hooks that clean up listeners automatically (today consumers must `off` by hand).
- i18n init (all 29 JSONs, fallback `en`, RTL for `he`), pipes → functions, `toast` facade, modal service, `useLongPress`, `<Slider>`, `<Markdown>` (marked + DOMPurify + alerts/emoji post-processing), `<QrCode>`, xterm `useTerminal` + `terminal`/`log` services.
- Test harness: `renderWithProviders`, ported fakes.
- Break the cross-module imports while porting: `BackupService` and `hb-v2-modal` move into `core/`, and the `settings` store stops importing the restart toast component (toast facade instead).

### Phase 2 — Shell and simple pages (~2.5k lines)

Router with all routes, guards as loaders and blockers; layout + sidebar (`app` namespace, PWA, under-voltage, logout, version mismatch); server-unreachable; login (+OTP, wallpaper); setup wizard (incl. restore over the `backup` namespace); restart; power options; support; logs (xterm, live-region a11y patch); platform-tools (terminal, Docker startup script / restart, Linux restart / shutdown); users (+2FA modals).
_Exit: you can log in and use every page that has no schema form, dashboard or accessories._

### Phase 3 — Plugins (~11k lines)

Schema-form renderer, productionised from spike A. `manage-plugins` facade, then `manage-plugin` (live install/update log), `plugin-config`, `custom-plugins` (iframe bridge: the whole postMessage protocol plus the `plugins/settings-ui` namespace and ticket/revoke), `manual-config` (Monaco + per-plugin schema), `plugin-bridge` (split into HAP / Matter / schedule sub-components while porting), the remaining plugin modals, the vendored hue/deconz components, `modules/plugins` (list, search, card) and `update-all`.

### Phase 4 — Config editor and settings (~10.5k lines)

Config editor (Monaco + diff, JSON5, validation, restart-scope detection, backups restore, unsaved-changes blocker). Settings, **split by section** (general, display, startup, network, HAP, Matter, terminal, security, cache, reset) into one component per section with a shared search index, plus its 12 modals and backup/restore.

### Phase 5 — Accessories (~19.7k lines)

`accessories` store (rooms, layout per user, service merging, socket events). Tile switch (71 cases) as a lookup map. `BaseManage` as a `useManageAccessory` hook (debounced writes, slider gradient). Then the 57 HAP and 32 Matter tile/modal components **in batches by family** (lights, climate, covers, security, media, sensors, Matter), each batch with its specs. Last, the rooms page with dnd-kit, layout lock and bridge filter.

### Phase 6 — Status dashboard (~6.5k lines)

react-grid-layout with saved-layout compatibility (same keys, `mobileOrder`, `hideOnMobile`), edit/lock, keyboard reorder mode, widget visibility and widget-control modals. Then the 14 widgets (charts via react-chartjs-2, logs/terminal via `useTerminal`, accessories widget via dnd-kit, update-info with node / hb-v2 modals).

### Phase 7 — Parity and cutover

Playwright smoke suite green on both UIs; schema corpus green; manual pass over themes × light/dark × glass, mobile layout, RTL (`he`), and 3+ real custom-UI plugins; bundle budget met; `lang-sync` reports no keys newly gone unused. Then do the cutover in §5, delete Angular deps / config / patches, update docs, write the CHANGELOG, and release 2.0.0.

## 7. Risks

| Risk                                                                                          | Impact                                         | Mitigation                                                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Schema-form behaviour differs from formworks                                                  | Third-party plugin settings break or lose data | Phase 0 spike, golden corpus, keep the `_bridge` passthrough, test `form.create` from custom UIs |
| Plugin custom-UI iframe theming                                                               | Custom UIs render unstyled                     | Spike C; test real plugins                                                                       |
| Saved dashboard layouts                                                                       | Users' dashboards reset                        | Keep component keys; migrate on load if the grid model differs                                   |
| Monaco AMD loading under Vite                                                                 | Config editor broken                           | Spike B; keep the asset verification script                                                      |
| Lost behaviour in the two monoliths (settings, plugin-bridge)                                 | Settings silently stop being written           | Use the spec scenarios as the checklist; split by section with one PR each                       |
| Spec coverage drops during the rewrite                                                        | Regressions slip through                       | Don't cut over until each module's scenarios are re-covered; Playwright parity suite             |
| Accessibility regressions (much a11y work exists: reorder mode, live regions, jsfPatch fixes) | A11y regresses                                 | Port it deliberately; add `eslint-plugin-jsx-a11y`; run axe in Playwright                        |
| Long-lived branch drifts from `main`                                                          | Painful merge                                  | Freeze UI features on `main` during the migration, or port each UI fix to `ui-next` as it lands  |

## 8. Decisions (approved 2026-10-01)

1. **Schema form:** port formworks' logic, with a new React widget layer (§4).
2. **State:** Zustand for the settings, auth and notifications stores.
3. **`main`:** UI feature freeze for the duration; each bug fix lands in both `ui/` and `ui-next/`.
4. **Version:** 2.0.0, first published as a beta on npm `next`.
5. **Vendored homebridge-hue / homebridge-deconz components:** port them.
6. **Compatibility contracts frozen:** plugin-ui-utils iframe protocol (actions, payloads, timing), forwarded styles and body classes, Bootstrap 5.3.8, flat i18n keys, dashboard layout keys, accessory layout format, local/session storage keys, route paths, `<base href>` subpaths, backend API/sockets, browser targets.
7. **Cutover gate:** Playwright smoke suite green on both UIs, and the top-200 plugin schema corpus producing identical config.

## 9. Outcome (2026-10-02)

- **Cutover done**: Angular `ui/` removed, React app moved from `ui-next/` to `ui/`, Angular tooling, patches and lint rules removed. Build commands are unchanged.
- **Schema form (spike A gate)**: 199 of 200 corpus plugins produce the same data, validity, controls and visible labels as the Angular form at every recorded step. One documented difference (homebridge-switchbot, false defaults of condition-hidden checkboxes) is in `ui/src/schema-form/__tests__/golden-known-differences.json`. The goldens are frozen.
- **Browser parity** (Playwright, before the cutover): every route, the page interactions, and screenshots of 8 pages plus dark, flat, flat-dark, Hebrew and mobile variants matched the Angular UI within 2% of pixels; three real custom-UI plugins (Ring, Camera FFmpeg, UniFi Protect) opened themed. After the cutover `e2e/` runs on the React UI only.
- **Found on the Angular UI** while comparing: the production build threw NG0201 whenever a schema form rendered inside a plugin dialog (plugin card settings, plugin custom UIs calling `createForm`), so the form never showed. The React UI does not have it.
- **Bundle**: 1.1 MB initial download, against Angular's 1.18 MB and the 1.6 MB budget (`scripts/check-bundle-size.mjs` runs after `build:ui`).
- **Tests**: 4.8k UI unit tests (every Angular spec case ported), 869 server tests, 24 browser specs.
- **Still to do by hand**: real Homebridge with accessories (the e2e environment has no running Homebridge, so tiles were covered by unit tests only), Safari/iOS, a reverse proxy subpath, and publishing the beta to npm `next`.
