# Architecture

How Homebridge Glass UI is put together: the server, the browser UI, and how the Assistant and the MCP server sit on `@mp-consulting/homebridge-ai-kit` and `@mp-consulting/homebridge-ui-kit`. For commands and conventions see [CLAUDE.md](../CLAUDE.md) and [CONTRIBUTING.md](../CONTRIBUTING.md); for what users see, the [README](../README.md).

## Two packages, one plugin

| Package    | Where | What                                                                                            | Builds to |
| ---------- | ----- | ----------------------------------------------------------------------------------------------- | --------- |
| Server     | `/`   | Nest.js 12 on Fastify, TypeScript, ESM. Requires Node `^22.12.0 \|\| ^24.0.0`.                  | `dist/`   |
| Browser UI | `/ui` | React 19 + Vite, react-bootstrap + Bootstrap 5, Zustand stores. Private package, own lock file. | `public/` |

Both ship together as `@mp-consulting/homebridge-config-glass-ui`. The server serves `public/` as static files (brotli/gzip precompressed), the API under `/api`, socket.io namespaces for live data, and Swagger at `/swagger` in development.

## Starting up

There are three ways in, and all of them end in `bootstrap()` in `src/main.ts`:

1. **Homebridge plugin** (`src/index.ts`): Homebridge loads the `config` platform, which only sets `UIX_CONFIG_PATH`/`UIX_STORAGE_PATH`; the UI itself runs as a child process (`src/bin/fork.ts`).
2. **`hb-service`** (`src/bin/hb-service.ts`): runs Homebridge as an OS service, forks Homebridge and the UI, restarts them and pipes logs. Platform installers are in `src/bin/platforms/`.
3. **Standalone** (`src/bin/standalone.ts`): development and `npm run start`.

`bootstrap()` builds the Nest app on Fastify with helmet, multipart and the CSP, mounts the SPA (`core/spa` serves `index.html` for every non-API route), the API, the socket.io gateways and, optionally, mDNS advertising.

The UI does not import Homebridge. It talks to the running Homebridge process over Node IPC (`core/homebridge-ipc`), which `hb-service` wires up after forking; child bridge status, restarts and server status flow through it to the gateways. Without `hb-service` (standalone, `npm run watch`) those features have nothing to talk to.

## Server modules

`src/app.module.ts` imports infrastructure from `src/core/` and features from `src/modules/`.

### Core

| Folder                                          | What it does                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `auth`                                          | JWT sessions (passport), API tokens (`hbg_…`, hashed in `.uix-api-tokens.json`), HTTP guards and the socket guards in `guards/`. |
| `config`                                        | Reads `config.json` and the environment (Docker, Synology, Raspberry Pi…), holds the UI settings.                                |
| `homebridge-ipc`                                | The IPC bridge to the Homebridge process.                                                                                        |
| `scheduler`                                     | One shared scheduler (scheduled backups, config backup cleanup, scene schedules, the daily digest).                              |
| `events`                                        | An in-process event bus for things one module reports and another reacts to (a failed backup, read by the notifications).        |
| `npm`, `node-version`                           | Running npm for plugin jobs; Node.js release data.                                                                               |
| `ssl`, `net`, `spa`, `fs`                       | HTTPS (configured, self-signed or the HTTP fallback), ports, the SPA fallback, file helpers that keep permissions.               |
| `logger`, `node-pty`, `matter`, `feature-flags` | Logging, the web terminal, Matter interfaces, features that depend on the Homebridge version.                                    |

### Feature modules

Each has a `*.module.ts`, a controller, a service, a gateway when it streams, and DTOs (class-validator, so a request that does not match is a `400`).

| Module           | Surface                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `accessories`    | HAP and Matter accessories over the `accessories` socket, layouts, and accessory history (`accessory-history/` in storage).   |
| `ai`             | The Assistant and the MCP server settings (see below).                                                                        |
| `backup`         | Instance backups and restores (`.tar.gz`, `.hbfx`), scheduled backups, the archive safety checks.                             |
| `child-bridges`  | Child bridge status and controls, and their health (uptime, restarts, crash loops).                                           |
| `config-editor`  | `config.json` reads and writes (with the command checks and automatic backups), plugin config blocks, UI settings.            |
| `custom-plugins` | Plugin custom settings UIs: serves their files and relays their requests over the `plugins/settings-ui` socket.               |
| `log`            | The log tail (file, systemd, Docker or a checked custom command).                                                             |
| `notifications`  | Webhook, ntfy, Pushover and Telegram channels (`.uix-notifications.json`), with cooldowns and an hourly cap.                  |
| `platform-tools` | Terminal, Docker and Linux tools, startup settings, hb-service settings.                                                      |
| `plugins`        | The plugin list, npm search, installs, updates and uninstalls (over the `plugins` socket or as REST jobs), compatibility.     |
| `scenes`         | Scenes and their schedules (`scenes.json`).                                                                                   |
| `server`         | Restarts, pairings, cached accessories, network interfaces, the Homebridge name and port.                                     |
| `setup-wizard`   | First-run account creation and restore.                                                                                       |
| `status`         | Dashboard widgets: one shared CPU, memory and network sampler for every client, the dashboard layout (`.uix-dashboard.json`). |
| `update-all`     | Update All, with a journal (`.uix-update-all-journal.json`) so an interrupted run is reported after the restart.              |
| `users`          | Users, passwords, 2FA.                                                                                                        |

Tests are end-to-end per module (`test/e2e/*.e2e-spec.ts`): each spec builds a real Nest testing module on its own storage folder seeded from `test/mocks/`.

## Browser UI

`ui/src/` is organised as:

- **`app/`**: the router (`routes.tsx`, lazy-loaded pages; the base path comes from `<base href>`, so a reverse-proxy subpath works) and the root component.
- **`core/`**: what pages share. `api` (fetch wrapper, bearer token, the 401 rule), `ws` (one socket.io connection per namespace, reference counted), `auth` and `settings` (Zustand stores, route guards as loaders), `ui` (i18n, toasts, `openModal`), `plugins` (the plugin dialogs, custom UI host), `accessories` (HAP and Matter tiles), `ai` (the Assistant), plus components, pipes, hooks and utilities.
- **`modules/`**: one folder per routed page, mirroring the server modules (`status`, `plugins`, `config-editor`, `accessories`, `quick-controls`, `scenes`, `logs`, `users`, `settings`, `child-bridges`, `platform-tools`…). Each exports a route `Component` (and optionally a `loader`). A page with more than local state has its own Zustand store.
- **`shared/layout/`**: the signed-in layout and sidebar.
- **`schema-form/`**: the plugin settings form. Its engine is ng-formworks ported to TypeScript (`engine/`, vendored, with Glass UI changes marked), rendered by React widgets that keep the Angular DOM; `__corpus__/goldens/` replays 200 recordings of what the 1.x form did with real plugin schemas.
- **`scss/`**: Bootstrap, the thirteen themes (`themes-light.scss`, `themes-dark.scss`) and the liquid glass look (`themes/glass.scss`, scoped under `body.glass-mode`).

The markup is a contract: the React port kept the DOM, classes, ids and i18n keys of the Angular 1.x templates, because the global stylesheet, plugin custom UIs and the e2e selectors depend on them.

### Plugin custom UIs

A plugin's own settings page runs in an iframe (`core/plugins/custom-plugins`) and talks to the app over the `@homebridge/plugin-ui-utils` postMessage protocol. When the page loads, the app sends it the theme classes (`glass-ui-<theme>`, `dark-mode`, `glass-mode`, `modal-content`) and copies its stylesheets in (`custom-ui-styles.ts`), so Bootstrap and the glass look apply inside. In glass mode it also sends a mapping for `@mp-consulting/homebridge-ui-kit`: the kit's `--mp-*` tokens take the `--glass-*` values of the current theme and lighting, and `.mp-settings-card` becomes a frosted surface. The mapping only sets `--mp-*` properties and styles `.mp-*` classes, so other plugins see no difference. A kit plugin can opt out of the blur with `--mp-glass-blur: 0px`, or override any token with a more specific selector.

## The Assistant

The Assistant is optional and off by default. Glass UI holds no prompts, providers or tools of its own: everything model-related comes from [`@mp-consulting/homebridge-ai-kit`](https://github.com/mp-consulting/homebridge-ai-kit), imported in one place (`src/modules/ai/ai-kit.ts`).

### Server side (`src/modules/ai`)

| File                           | Role                                                                                                                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai.service.ts`                | Reads the kit's `HomebridgeAiKit` block of `config.json` (`resolveAiConfig`), creates the provider, runs each feature (Log Doctor, Config Copilot, chat, update risk, organiser, daily digest), rate limits per user, counts usage. |
| `ai.controller.ts`             | `/api/ai/*`: status, settings, test, and one route per feature.                                                                                                                                                                     |
| `ai.gateway.ts`                | The `ai` socket namespace: the same features streamed (`ai:chunk`, `ai:progress`, `ai:tool`, `ai:done`, `ai:error`), cancellation, and tool confirmations (`ai:confirm` / `confirm`).                                               |
| `ai-loopback.ts`               | The chat's tools call this server's own API. Over HTTPS that call gets a fetch that trusts only this UI's certificate, pinned by fingerprint; nothing else in the process changes how certificates are checked.                     |
| `ai-logs.ts`, `ai-organize.ts` | Reading the log for Log Doctor and crash loop explanations; batching accessories for the organiser.                                                                                                                                 |
| `ai-mcp.*`                     | Settings of the kit's HTTP MCP server (`mcp.http` in the same block), its client token and the Glass UI API token its tools use.                                                                                                    |

What leaves the machine goes through the kit's redaction first (`redactText`): passwords, tokens and keys become `__REDACTED__`, and come back when a config is returned.

### The chat

1. The palette (`ui/src/core/ai/palette/AssistantPalette.tsx`, Cmd/Ctrl+K) sends the last turns and the page context over the `ai` socket (`runAiStream('chat', …)` in `ai-stream.ts`). The context (`ai-context.ts`) is the router path, the kind of page and, while a plugin's settings dialog is open, the plugin's name; the dialogs register it with `useAssistantPluginContext`.
2. `AiChatDto` checks it (`context.route`, `context.page`, `context.plugin` each against a strict pattern), and `AiService.chat` adds it to the system prompt as a labelled "Page context" block, so it reads as information rather than as instructions.
3. The kit's agent (`runAgent`) answers, calling Homebridge tools through the kit's `HomebridgeClient`, pointed at this server with a five-minute token minted for the signed-in user (`AuthService.mintShortLivedToken`). Every permission check applies as for that user; non-admins get read-only tools; each destructive tool waits for the user's confirmation over the socket (refused after a minute).
4. Events stream back to the palette (text, tool chips, confirmations). The conversation is kept in the browser's local storage, per user (`palette/chat-history.ts`): the current one and the last ten, with New chat and Clear history. Nothing about conversations is stored on the server.

### The MCP server

The HTTP MCP server is not part of Glass UI: the Homebridge AI Kit plugin runs it when it is installed and `mcp.http.enabled` is on. Glass UI only edits its settings (Settings, Assistant, MCP server) and creates the API token (`hbg_…`, named "MCP server", read-only or admin) its tools use to call `/api`. When the MCP server reaches Glass UI over its own HTTPS, the certificate fingerprint is stored with the token so the kit trusts exactly that certificate. API tokens cannot manage tokens, so a leaked MCP token cannot mint a replacement.

### Browser side

- `core/ai/ai.store.ts` holds `/api/ai/status`; every Assistant entry point is hidden while it says off.
- `core/ai/ai-entry.ts` opens the palette, Log Doctor, Config Copilot and the organiser as lazily loaded dialogs.
- `core/ai/AiHost.tsx` loads the status, binds Cmd/Ctrl+K, and shows the page-edge halo while a request runs.
- Styles come from the ui-kit's standalone `dist/ai.css` (tokens and Assistant components, without the kit's Bootstrap overrides); `core/ai/ai.scss` maps its `--mp-*` colours to the glass palette, since the app's dark mode hangs off `body.dark-mode` rather than Bootstrap's `[data-bs-theme]`.

## Tests

| Suite               | Where                                                     | Run                                                          |
| ------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Server              | `test/e2e/` (Vitest, real modules)                        | `npm test`                                                   |
| UI unit             | `ui/src/**/*.spec.ts(x)` (Vitest, jsdom, Testing Library) | `npm run test:ui`                                            |
| Schema-form goldens | `ui/src/schema-form/__tests__/SchemaForm.golden*`         | after `node scripts/schema-corpus/fetch.mjs --from-manifest` |
| Browser             | `e2e/specs/` (Playwright, real backend on mock storage)   | `node e2e/build.mjs && npx playwright test -c e2e`           |
