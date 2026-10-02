# `@/testing`

Fakes and helpers for ui-next specs, ported from `ui/src/testing`. Import everything from `@/testing`.

- **`renderWithProviders(ui, { route, initialEntries, routes, i18n })`** renders inside a memory **data** router, so `useBlocker` and loaders work, and inside the `I18nextProvider` of `@/core/ui/i18n`. Any other path renders `<div data-testid="other-route">`. It returns the RTL result plus `router`, so you can call `router.navigate('/x')`.
- **`fakeApi()`** is re-exported from `@/core/api/api.fake`. It spies on the real `api`, so you don't need a `vi.mock`.
- **`fakeWs()` / `fakeIoNamespace()` / `fakeSocket()`** stand in for the `ws` singleton, one namespace, or a raw socket.io socket. `connected.subscribe(cb)` replays the last connect. You can `fire` server events, `respondTo` acks, and read `payloadsFor(event)`. To drive the real ws layer, mock `socket.io-client` so `io()` returns `fakeSocket(false)`.
  ```ts
  import { vi } from 'vitest'

  vi.mock('@/core/ws', async () => ({ ws: (await import('@/testing')).fakeWs() }))
  ```
- **`fakeOpenModal()`** is a drop-in for `@/core/ui/modal`. It records the component, props and options. `ref.close()` resolves `result` and `ref.dismiss()` rejects it.
  ```ts
  import { vi } from 'vitest'

  vi.mock('@/core/ui/modal', async () => ({ ...(await import('@/testing')).fakeOpenModal() }))
  ```
- **`toastStub()`** stands in for the `toast` facade.
- **`fakeTerminals()` / `fakeSaveAs()`** are passed to the terminal services in place of `xtermFactory` / file-saver.
- **`makeEnv()` / `makeSettingsState()` / `makeAuthState()` / `makeUser()`** hold store data. Seed a store with `useSettingsStore.setState(makeSettingsState({ env: { … } }))`.
- **`cacheStub()` / `cachedAccessoriesStub()` / `ttlCacheStub()`** stand in for the caches.
- **`installBrowserStubs()` / `resetBrowserStubs()`** cover the browser APIs jsdom lacks or refuses to run: `matchMedia`, `location.reload`, `scrollTo`, `scrollIntoView`, canvas, `requestAnimationFrame`. `setup.ts` should call them, and the spies are exported (`locationReload`, `windowOpen`, …).

- **`hapService()` / `characteristic()` / `matterService()`** (`fixtures/accessory.fixture.ts`) build accessory services as the accessories page sees them; `matterService().writes` records every cluster write and `failWrites(cluster, error)` makes them reject.

`makeWidget` comes with the dashboard interfaces (Phase 6).
