# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This is a monorepo with two npm packages that ship together as the `@mp-consulting/homebridge-config-glass-ui` plugin:

- **`/` (root)** — Nest.js backend (TypeScript, ESM, Fastify adapter). Compiles to `dist/`. Requires Node `^22.12.0 || ^24.0.0`.
- **`/ui`** — React 19 + Vite frontend (private package). Compiles to `public/` (served as static assets by the backend — `build.outDir` in `ui/vite.config.ts` is `../public`).

The UI package has its own `package.json`, `node_modules`, and tsconfig. **You must `npm install` in both root and `ui/` separately.**

## Common commands

Run from the repo root unless noted.

```sh
# First-time setup
npm install && npm install --prefix ui

# Full build (server + ui)
npm run build               # ~30s; runs build:server then build:ui
npm run build:server        # tsc -p tsconfig.build.json → dist/
npm run build:ui            # tsc + vite build → public/ (prebuild regenerates the Font Awesome subset; postbuild checks the Monaco assets and the 1.6 MB initial-bundle budget)

# Dev (live reload, two processes via concurrently)
npm run watch               # UI dev server on :4200, backend on :8581

# Lint (eslint flat config, antfu base, max-warnings=0; covers both packages)
npm run lint
npm run lint:fix

# Tests — Vitest e2e, ~35s full suite (spec files run in parallel), runs against real Nest module instances
npm run test
npm run test -- test/e2e/auth.e2e-spec.ts          # single file
npm run test -- -t "should reject invalid login"   # single test by name
npm run test-coverage

# UI unit tests (Vitest + React Testing Library, jsdom)
npm run test:ui

# Browser tests (Playwright, real backend on mock storage)
node e2e/build.mjs && npx playwright test -c e2e

# Translation key sync (en.json is the master)
npm run lang-sync
```

## Three entry points to understand

The plugin can be loaded three ways, and each goes through a different bootstrap path. This is unusual and worth knowing before navigating `src/bin/`:

1. **As a Homebridge plugin** (`src/index.ts`) — Homebridge calls `registerPlatform`. The plugin class does almost nothing; it just sets `UIX_CONFIG_PATH`/`UIX_STORAGE_PATH` env vars from the Homebridge API. The actual UI server is launched by Homebridge as a separate child process via `src/bin/fork.ts`, which then loads `main.ts`.
2. **Via `hb-service`** (`src/bin/hb-service.ts`, exposed as the `hb-service` bin) — the supported way to run Homebridge as an OS service on Linux/macOS/Windows/FreeBSD. `hb-service run` forks both Homebridge itself and the UI, manages restarts, and pipes logs. Platform-specific installers live in `src/bin/platforms/{darwin,linux,win32,freebsd}.ts`.
3. **Standalone** (`src/bin/standalone.ts`) — for development or `npm run start`. Just sets `UIX_STORAGE_PATH` then imports `main.js`.

All three eventually call `bootstrap()` in `src/main.ts`, which builds the Nest app on Fastify, registers helmet/multipart/CSP, mounts the SPA at `/`, the API at `/api`, Swagger at `/swagger`, a Socket.io gateway under namespace `app`, and (optionally) advertises the UI over mDNS/Bonjour.

## Backend ↔ Homebridge IPC

The UI doesn't import Homebridge as a library — it talks to the running Homebridge process over Node IPC. The bridge is `src/core/homebridge-ipc/homebridge-ipc.service.ts`, which extends `EventEmitter` and is wired up by `hb-service` after it forks Homebridge (it calls `setHomebridgeProcess()` on the exported `HomebridgeIpcService` from `main.ts`). Events like `childBridgeStatusUpdate` and `serverStatusUpdate` flow through this service to the rest of the app and out via WebSocket gateways.

When standalone or in dev watch mode (`npm run watch`), there's no Homebridge process attached, so IPC-dependent features (child bridge controls, restart, log tail) won't work end-to-end — that's expected.

## Backend module layout

`src/app.module.ts` imports feature modules from `src/modules/` and infrastructure from `src/core/`:

- **`core/`** — cross-cutting: `auth` (JWT + passport, HTTP guards plus WS guards in `guards/`), `config` (loads/parses `config.json`, holds runtime env detection — Docker/Synology/RPi/etc.), `feature-flags`, `fs`, `homebridge-ipc`, `logger`, `matter` (interfaces), `node-pty` (terminal), `scheduler`, `spa` (catch-all filter so non-`/api` routes serve `index.html`), `ssl`.
- **`modules/`** — one folder per feature surface, each with a `*.module.ts`, controller, service, gateway (when WS-enabled), and DTOs. The set is: `accessories`, `backup`, `child-bridges`, `config-editor`, `custom-plugins`, `log`, `platform-tools`, `plugins`, `server`, `setup-wizard`, `status`, `users`.

## Frontend layout

`ui/src/` splits into `app/` (router, root component), `core/` (cross-cutting services, stores and shared components), `modules/` (routed feature areas), `shared/layout/` (layout + sidebar), `schema-form/` and `testing/`:

- **`core/api`** — `api` (fetch wrapper for `/api`, bearer token, the 401 rule). **`core/ws`** — `ws.connectToNamespace(ns)` (socket.io-client, one socket per namespace, per-handle reference counting: every handle must `end()` exactly once) plus `useNamespace` / `useSocketEvent`. **`core/auth`**, **`core/settings`** — Zustand stores (`useAuthStore`/`authActions`, `useSettingsStore`/`settingsActions`); route guards are loaders in `core/auth/guards`.
- **`core/ui`** — i18n (i18next on the flat-key JSON files, `keySeparator: false`), the `toast` facade (ngx-toastr markup) and `openModal` (NgbModal-style: `result` resolves on close, rejects on dismiss). `<ToastContainer/>` and `<ModalHost/>` are mounted inside the router.
- **`modules/`** — mirror the backend feature modules (`config-editor`, `plugins`, `status`, `users`, `platform-tools`, …). Each has a `route.tsx` exporting `Component` (and optionally `loader`, `shouldRevalidate`, `children`) that `app/routes.tsx` lazy-loads. When adding a feature, expect to touch a backend module + its UI counterpart.
- **`schema-form/`** — the plugin settings form: ng-formworks' engine ported to TypeScript on a small forms shim, with React widgets that render the same DOM and classes. `__corpus__/goldens/` are 200 frozen recordings of what the Angular form did with real plugin schemas; `__tests__/SchemaForm.golden*.test.tsx` replays them (run `node scripts/schema-corpus/fetch.mjs --from-manifest` first).
- In dev mode, `ui/src/environments/environment.ts` hard-codes the backend at port `8581` on the current hostname — that's why `npm run watch` runs the backend on 8581.
- Notable UI libs: react-bootstrap + Bootstrap 5, Monaco (`@monaco-editor/react`, AMD assets copied by `vite-plugin-static-copy`) for the config editor, xterm for the terminal, react-grid-layout for the dashboard, dnd-kit for drag and drop, react-chartjs-2.
- **Shared helpers** (use them rather than writing another copy): `toastApiError(err, fallbackKey?)` (`core/utilities/http-error.ts`) for API failures; `ModalHeader` / `ModalFooter` (`core/ui/ModalParts.tsx`); `cx` (`core/utilities/cx.ts`) for class names; `useLatest` (`core/hooks/use-latest.ts`); `debounce` / `useDebouncedCallback` (`core/utilities/debounce.ts`); `createEmitter` (`core/utilities/emitter.ts`) for listener sets; `t` from `core/ui/i18n.ts` outside components (components use `useTranslation()`); formatters in `core/pipes/`. Test fakes live in `src/testing/fakes/`, not next to the code.
- **Page state**: a page with more than local component state gets a per-page Zustand store (`createStore` + selectors, see `modules/status/status.store.ts`, `modules/settings/settings-page.store.ts`). The remaining `*.controller.ts` classes predate that convention; move them to a store when you change them substantially.

## Testing

Tests are e2e, not unit: each spec builds a real Nest `TestingModule` for the module under test, backed by a real storage dir seeded from fixtures in `test/mocks/`. Vitest compiles them with SWC (`unplugin-swc`). Expect ~35s for the full suite.

- **Spec files run in parallel.** Each file gets its own fresh storage dir: set `UIX_STORAGE_PATH` to `testStoragePath` from `test/storage-path.ts` (never a shared path such as `test/.homebridge`, which is what `npm run watch` uses). `test/global-setup.ts` creates the temp root and removes it after the run. A spec must seed everything it reads — it cannot rely on files another spec left behind.
- **Log in once per file.** A login runs a 210,000-iteration PBKDF2 hash (~100ms+), so non-auth specs use `authorization ??= ...` in `beforeEach` to reuse one token.
- **Stay off the network and the real toolchain.** Stub `httpService` calls to registry.npmjs.org / nodejs.org / GitHub and anything that spawns `npm` (e.g. `cleanNpmCache`, `npm --version`) — they are slow, and `npm cache clean --force` wipes the developer's real cache. Use fake timers for timeout paths.

## Key environment variables

These drive runtime behaviour and are set by `hb-service`, the watch script, or the user's environment. Most are read in `src/core/config/config.service.ts`:

- `UIX_CONFIG_PATH`, `UIX_STORAGE_PATH` — Homebridge config + storage roots (required).
- `UIX_BASE_PATH` — plugin install root (where `public/` is served from).
- `UIX_INSECURE_MODE=1` — skip auth (dev/testing).
- `UIX_DEVELOPMENT=1` — verbose logging, dev CORS.
- `UIX_SERVICE_MODE=1` — running under hb-service (enables IPC features).
- `UIX_CUSTOM_PLUGIN_PATH` — extra location to scan for plugins.
- `HOMEBRIDGE_CONFIG_UI=1` (Docker), `HOMEBRIDGE_SYNOLOGY_PACKAGE=1`, `HOMEBRIDGE_APT_PACKAGE=1` — packaging-mode flags that toggle features like terminal access and host shutdown/restart.

`nodemon.json` shows the canonical dev invocation: `UIX_DEVELOPMENT=1 UIX_INSECURE_MODE=1 UIX_SERVICE_MODE=1 HOMEBRIDGE_CONFIG_UI_TERMINAL=1 tsx src/bin/hb-service.ts run --stdout`.

## Things that bite

- **ESM throughout**: both packages have `"type": "module"`. Local imports must use the `.js` extension even from `.ts` source (e.g. `import { Foo } from './foo.js'`). The compiled output is what runs.
- **Two `node_modules`**: if you change a dep in `ui/package.json`, run `npm install --prefix ui` — root `npm install` won't touch it.
- **Built UI is gitignored but shipped on publish**: `public/` is the compiled UI. It is in `.gitignore`, so `npm run build:ui` won't show up in `git status` — don't expect (or try to commit) a `public/` diff. It still reaches the npm package: `prepublishOnly` runs `npm run build` to regenerate it, and `.npmignore` (which npm uses in preference to `.gitignore` because it exists) does not exclude `public/`.
- **Translations**: `ui/src/i18n/en.json` is the source of truth; other locales are synced from it via `npm run lang-sync`. Don't hand-edit non-English files for new keys.
- **Markup is a contract**: the UI keeps the DOM, classes, ids and i18n keys the Angular 1.x templates had (the global SCSS, plugin custom UIs and the e2e selectors depend on them). A component's `.scss` is global, so scope it under the component's root class; a few components keep a box-less or inline root where Angular's host element affected layout.
- **i18n keys are found by substring** (`lang-sync`): write keys out in full rather than building them from parts, or add the built ones to `ignoreKeys` in `scripts/lang-sync.ts`.
- **WebSocket guards only cover `@SubscribeMessage` handlers**: a raw `client.on(...)` listener bound after a guarded message (terminal `stdin`, custom plugin UI `request`, `accessory-control`) is never re-guarded. Run it through `createAuthorizedRunner` / `isWsClientAuthorized` from `src/core/auth/guards/ws-auth.ts`, or a deleted or demoted user keeps that access while the socket stays open. Take the acting user from `client.data.user` (set by the guards), never from the payload. In specs, give fake sockets that state with `authorizeWsClient` from `test/ws-client.ts`.
- **CORS is dev-only**: cross-origin requests are allowed only with `UIX_DEVELOPMENT=1` (the Vite dev server on :4200, or :8080). Production is same-origin.
- **Install-script allow-list**: both `package.json` files have an `allowScripts` block (npm's install-script approval). Approvals are pinned to exact versions, so bumping an approved package (e.g. `esbuild`) makes npm prompt again — re-approve with `npm install-scripts approve <pkg>`.

## Glass mode

The liquid glass look lives in `ui/src/scss/themes/glass.scss` and is scoped under `body.glass-mode`. Each theme mixin in `themes-light.scss` / `themes-dark.scss` exports `--glass-primary`, `--glass-primary-rgb` and `--glass-primary-dark`, which the glass styles read. `settingsActions.setGlassMode()` (`ui/src/core/settings/settings.store.ts`) toggles the body class from the `glassMode` UI setting (default `true`).

## Git conventions

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `perf:`, `style:`
- Do not include co-authored-by lines
- CI runs on Node 22.x, 24.x and 26.x
- npm publish is triggered by GitHub releases (trusted publishing with OIDC provenance)
