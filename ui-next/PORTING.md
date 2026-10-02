# Porting Angular → React (ui-next)

Working notes for the migration in `docs/react-migration-plan.md`. Removed at the cutover.

## Ground rules

- **Port, don't redesign.** Same DOM structure, CSS classes, ids, `data-*`, ARIA, i18n keys and
  texts as the Angular template, so `ui/src/scss` (copied to `src/scss`) applies unchanged and the
  Playwright parity suite can use one set of selectors. Keep behaviour, edge cases and comments
  that explain *why*; drop comments that only describe Angular mechanics.
- **Frozen contracts** (plan §8): backend API paths and payloads, socket namespaces and events,
  local/session storage keys, routes, dashboard/accessory layout formats, body classes,
  the plugin-ui-utils iframe protocol.
- Every Angular `*.spec.ts` for ported code gets a Vitest + RTL counterpart (`*.spec.ts(x)` next to
  the file). Port the cases, not the TestBed plumbing.
- **Component styles**: Angular scoped each component's `.scss` (emulated encapsulation). Copy it
  next to the React component and import it there; it becomes global, so rewrite `:host` to a class
  on the component's root element (`<div className="hb-<component-name>">`, or the existing root
  class) and nest any generic selector (`h5`, `.card`, `.btn`) under that class. `::ng-deep` just
  goes away.
- TypeScript strict, ESM, imports via `@/…` (= `ui-next/src`). No `any` unless the Angular code had it.
- Lint: `npx eslint <paths> < /dev/null` from the repo root (the `< /dev/null` matters).
- Tests: `npx vitest run <paths>` in `ui-next/`. Do not run the `*golden*` suites (slow).
- Do not commit; the lead reviews and commits.

## Layout

```
src/
  app/            App.tsx, router, routes
  core/           cross-cutting (mirrors ui/src/app/core)
    api/          api.ts — fetch wrapper
    auth/         auth store, token store, guards (loaders)
    settings/     settings store
    ws/           ws.ts + hooks
    ui/           toast, modal, i18n helpers
    components/   shared components (confirm, information, spinner, markdown, qrcode, …)
    pipes/        former pipes, as plain functions
    helpers/      html, schema helpers
    utilities/    colour, mobile-detect, ttl-cache, terminal, log, child-bridges, …
    interfaces/   server.interfaces, settings.interfaces, …
  modules/        routed feature areas (mirrors ui/src/app/modules)
  shared/layout/  layout + sidebar
  testing/        setup, renderWithProviders, fakes
```

## Contracts between the core pieces

| Angular | React | Notes |
|---|---|---|
| `ApiService` | `import { api } from '@/core/api'` — `api.get/post/put/patch/delete<T>(path, body?, { params, responseType: 'json'\|'text'\|'blob', headers })` → `Promise<T>` | Path relative to `/api`. Rejects with `ApiError { status, error, message }` (HttpErrorResponse shape). Bearer from the token store; the 401 rule of `auth-error.interceptor`. |
| `AuthService` | `useAuthStore` (Zustand) + `authActions` | `user`, `token`, `isLoggedIn()`, `login`, `logout`, `refresh`… |
| `SettingsService` | `useSettingsStore` + `settingsActions` | `env`, `formAuth`, `theme`, `lang`, … body classes applied by the store. |
| `NotificationService` | `notifications` (tiny event emitter) + `useNotification(event, handler)` | |
| `WsService` | `import { ws } from '@/core/ws'` — `ws.connectToNamespace(ns)` / `ws.getExistingNamespace(ns)` return `IoNamespace { socket, connected: { subscribe(cb) → unsubscribe }, request(resource, payload?) → Promise, end() }` | Exact ref-count semantics of `ws.service.ts`. Hooks: `useNamespace(ns)`, `useSocketEvent(io, event, handler)`. |
| `TranslateService` | `i18n` / `useTranslation()` from `react-i18next` (`@/core/ui/i18n`) | `t('key', params)`; flat keys, `keySeparator: false`. |
| `ToastrService` | `import { toast } from '@/core/ui/toast'` — `toast.success/error/info/warning(message, title?, options?)` | Renders ngx-toastr markup (`#toast-container .ngx-toastr .toast-success …`). `<ToastContainer/>` mounted once in App. |
| `NgbModal.open(C, opts)` | `import { openModal } from '@/core/ui/modal'` — `openModal(Component, props, { size, backdrop, keyboard, centered, fullscreen, windowClass })` → `{ result: Promise, close(v), dismiss(reason) }` | Component receives `activeModal: { close, dismiss }` as a prop. `<ModalHost/>` mounted once in App. Same `.modal-*` markup. A dismissed modal rejects `result` like NgbModal. |
| `@Input()`/`@Output()` | props / `onX` callbacks | |
| signals / computed | `useState`/`useMemo`, or store selectors | |
| RxJS subscriptions | `useEffect` with cleanup | RxJS stays only where the Angular code needs operators (debounce etc.); prefer plain timers. |
| Pipes | functions in `@/core/pipes` | `convertTemp(value, unit)`, `prettify`, `duration`, … |
| Router | `react-router` v8 (`createBrowserRouter`, basename from `<base href>`) | Guards → `loader`s that `redirect()`; `CanDeactivate` → `useBlocker`. |
| `ng-bootstrap` widgets | `react-bootstrap` | Keep the Bootstrap markup/classes the templates produced. |
