# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- **API tokens.** Administrators can create long-lived tokens (`hbg_…`) under **Users**, **API Tokens**, for scripts and the Assistant's MCP server: `GET/POST /api/auth/tokens` and `DELETE /api/auth/tokens/:id`. A token is shown once and stored only as a hash (`.uix-api-tokens.json`). `Authorization: Bearer hbg_…` works on the REST API and in the socket.io handshake; a `read` token is a non-admin user limited to `GET`/`HEAD` (and cannot control accessories over the socket), an `admin` token is an administrator. Expired and revoked tokens are refused, and open sockets using a revoked token are closed.
- **Plugin jobs over REST.** `POST /api/plugins/install`, `/update` and `/uninstall` (`{ name, version? }`) start the same install/update/uninstall the Plugins page runs and answer `202 { jobId }`; `GET /api/plugins/jobs/:jobId` reports the job's status and npm output (the latest 64 KiB, without colour codes). Jobs are kept in memory for an hour after they finish. Administrators only.
- `AuthService.mintShortLivedToken(user, ttlSeconds = 300)` signs a short-lived session token for a user, for the Assistant to call the API on that user's behalf.
- **Assistant** (optional, off until an administrator enables it under **Settings**, **Assistant**), built on `@mp-consulting/homebridge-ai-kit` with Anthropic, OpenAI, Gemini or an OpenAI-compatible server:
  - **Log Doctor**: a **Diagnose** button on the Logs page and in the logs widget streams an explanation of the recent log into a side drawer.
  - **Config Copilot**: describe a plugin's settings in plain words (plugin settings, or the config editor); the schema-valid block is shown as a Monaco diff and **Apply** saves it through the usual save, which keeps a backup.
  - **Assistant chat**: Cmd/Ctrl+K or the menu entry. Its tools run with the signed-in user's own five-minute token, so their permissions apply; non-admins get read-only tools, and destructive tools ask for confirmation (denied after a minute without an answer). A halo glows around the page while it works.
  - **Update risk briefing** in the plugin update dialog and Update All, **Suggest rooms & names** on the Accessories page, and a **Daily Digest** dashboard widget.
  - Settings edit the `HomebridgeAiKit` block of `config.json`; the API key is write-only. Secrets are redacted before anything reaches the provider. Every Assistant entry point is hidden while it is off.
  - API: `GET /api/ai/status`, `PUT /api/ai/settings`, `POST /api/ai/test`, `/diagnose-logs`, `/plugin-config`, `/chat`, `/update-risk`, `/organize`, `GET /api/ai/digest`, and the socket.io namespace `ai` for streaming and confirmations. `409` while the Assistant is off, `429` past 20 requests a minute per user.

### Changed

- `@mp-consulting/homebridge-ai-kit` (server) and `@mp-consulting/homebridge-ui-kit` (UI, its `ai.css`) are `file:` dependencies on local checkouts while they are unpublished. **Before release they must become semver ranges: `^2.0.0` for ai-kit and `^1.2.0` for ui-kit.**
- **Switch between Homebridge instances.** Settings > Instances keeps a list of your other Homebridge interfaces (Glass UI or the official one) by name and address, and a switcher under the logo in the menu opens the one you pick. Nothing is proxied and no credentials are shared: the other instance asks for its own sign-in. Only http(s) addresses without a username or password are accepted, and the list is only sent to signed-in users. API: `PUT /api/config-editor/ui/instances` (admin); the list is in `instances` of the UI config.
- **Install Glass UI on your home screen.** The UI is now an installable web app: the manifest has separate regular and maskable icons, a scope, and shortcuts to Quick Controls and Logs, and a service worker (`sw.js`, registered in production builds on HTTPS or localhost) caches the UI's own static files so it opens fast. It never caches the API, the websocket, plugin settings pages or anything sent with a credential header. A new **Quick Controls** page (`/quick`, in the menu on phones) shows just your favourite accessories, the ones marked Show on Dashboard, grouped by room.
- **Scenes and schedules.** A new Scenes page runs a named list of accessory values (for example lamp on, brightness 40 %, fan off) in one click, and administrators can add, edit and delete scenes and give them cron schedules (the same scheduler the scheduled restarts and backups use). Scenes are stored in `scenes.json` in the storage directory. Each value is set the same way the Accessories page sets it, so a bridge in the accessory control blacklist is not controlled by a scene either; a value that cannot be set is reported and the rest still run. API: `GET /api/scenes`, `POST /api/scenes/:id/run` (any user, like accessory control), `POST /api/scenes`, `PUT`/`DELETE /api/scenes/:id` (admin).
- **Accessory history.** Temperature, humidity, light level, battery, air quality and power/energy readings of every HAP accessory are recorded as they change (at most one point a minute per characteristic) into one JSON-lines file per day under `accessory-history/` in the storage directory, kept for 7 days by default. Settings > Accessories has the switch and the number of days. A new Accessory History dashboard widget charts one characteristic over 6 hours to a week, and the accessory info modal shows a 24-hour sparkline for each recorded value. API: `GET /api/accessories/:uniqueId/history?hours=&type=&maxPoints=`. Recording needs Homebridge in insecure mode, like the Accessories page. The history folder is left out of backups.
- **Notifications.** Settings has a Notifications section for a webhook (JSON POST), ntfy (server, topic, optional token), Pushover (user key and app token) and Telegram (bot token and chat id), each with a Send test button. Pick which events are sent: Homebridge down (after a minute, so restarts stay quiet) and back up, a child bridge crash loop, updates available (checked every six hours, each set once) and a failed scheduled backup. Sending is rate limited (the same event at most every 15 minutes, 12 notifications an hour). Tokens are stored owner-only in `.uix-notifications.json` in the storage directory, are never sent back to the browser (they read as `********`), and the log viewer cannot read that file. API: `GET`/`PUT /api/notifications/settings`, `POST /api/notifications/test` (admin).
- **Child Bridge Health page.** A new admin page (sidebar: Child Bridge Health) lists every child bridge with its status, uptime, restart count and crash count, and flags a crash loop (3 unrequested crashes within 10 minutes) on the bridge and at the top of the page. Process memory is shown on Linux. Stops and restarts from the UI, and Homebridge itself restarting, are not counted as crashes. Also served at `GET /api/status/homebridge/child-bridges/health` (admin).
- **Plugin compatibility check before upgrading Node.js or Homebridge.** `GET /api/plugins/compatibility?node=<version>&homebridge=<version>` (admin) lists the installed plugins whose `engines.node` / `engines.homebridge` range would not accept the target version, and those that state no range. The Homebridge update dialog lists those plugins before you confirm, and the Node.js update dialog warns how many plugins do not support the new version.
- **Compare a config backup with the current config.** The config editor's backup list has a Compare button that opens a read-only Monaco diff of that automatic backup (left) against the current config (right), side by side or inline, with Copy to Editor to restore it from there.
- **Network widget units and directions.** The network widget's settings now choose bits or bytes per second, and the rates scale to the unit that fits (b/s up to Gb/s, or B/s up to GB/s). Received and sent traffic are charted separately, received above the axis and sent mirrored below it.

## [2.0.0-beta.4] - 2026-10-03

### Fixed

- **Updating Glass UI no longer leaves the old version running.** The update dialog could stay on the terminal with no status once the update finished, and the server then kept running the previous version until it was restarted by hand (so the home page still showed it). The server now restarts itself after updating the UI, even if the browser has gone away, and the dialog moves to the restart page when the connection drops during the update.
- **Update All restarts the UI when a newer one is installed but not yet running**, instead of restarting only Homebridge.
- Any request whose connection drops before the server answers now fails instead of waiting forever.

The update to this version still runs the previous version's code: if the home page shows the old version afterwards, use Restart once. Updates after this one restart on their own.

## [2.0.0-beta.3] - 2026-10-03

### Security

- **Dependencies:** fastify 5.12.5 and Nest 12.1.2 fix an authentication bypass through malformed URLs and a middleware bypass. `node-forge` (an advisory with no fix) is gone: the self-signed certificate is now made with Node's own crypto.
- **Sign-in floods are capped per address.** One address that keeps failing gets a `429` after 20 failures in 15 minutes whichever usernames it tries, and at most two password checks run at once, so a burst of guesses can no longer stall the server on a Raspberry Pi.
- **The setup wizard stays closed** when `auth.json` exists but cannot be read or parsed (only a missing file opens it), and its token now only works for the wizard's own restore steps.
- **Child bridge `NODE_OPTIONS` are checked.** A plugin block's `_bridge.env.NODE_OPTIONS` gets the same rules as the service's own: unsafe values are refused on save and removed from restored backups.
- **Log commands cannot read the UI's secrets** (`.uix-secrets`, `auth.json` and the like), as `log.path` already could not.
- **New installs show the Homebridge log to administrators only** (`restrictLogsToAdmins`). Existing installs keep their setting.
- **`hb-service install` no longer grants `SETENV` in sudoers**, which let a caller pass `NODE_OPTIONS` or `APT_CONFIG` to commands run as root. An existing entry is replaced. Plugin installs with `sudo` now pass npm's settings as options instead.
- Uploaded SSL keys and certificates are saved readable by the owner only (0600, in a 0700 folder).
- Forms in the page can only submit to the UI itself (`form-action 'self'`), and plugin release notes, changelogs and settings-form text can no longer contain forms, inputs or inline styles. Links that open a new tab do so without access to the UI.
- The WebSocket no longer accepts a sign-in token in its URL, where proxies would log it.
- Messages from plugin settings pages are checked before they are acted on.

### Fixed

- **Plugin menus and tooltips are readable on mobile.** In glass mode the ⋮ menu of a plugin card let the next card's text show through when the browser did not blur it (notably iOS Safari).
- **Plugin install, update and Update All show their output on a black terminal** in glass mode, instead of a see-through pane.
- Uploading an SSL key and certificate, or a PFX file, no longer hangs.
- A corrupt, mismatched or expired self-signed certificate is replaced instead of stopping the UI from starting.
- An invalid scheduled restart (cron) is reported in the log instead of silently doing nothing.
- Pressing Enter on a switch, door, garage door or air purifier tile (and several Matter tiles) no longer fires the action twice.
- The uploaded login wallpaper shows in glass mode.
- Plugin settings forms: a satisfied `dependencies` rule no longer marks the form invalid, `uniqueItems` rejects duplicates, `exclusiveMinimum` is no longer inverted, and the French "maximum items" message shows the number.
- Closing a live view (logs, status, terminal, accessories) no longer removes the server's own clean-up for that connection.

### Accessibility

- Every accessory tile has a role, a name and its state for screen readers, and Shift+Enter (or the context-menu key) opens its settings, which used to need a long press.
- Config validity icons and icon-only buttons are named, and the "valid" check stays green in glass mode whatever the theme colour.
- Glass mode follows the system's reduced transparency (opaque surfaces, no blur), reduced motion and high-contrast (forced colours) settings.
- Loading indicators are announced, and the startup script, wallpaper upload and statistics frame are labelled.

### Performance

- CPU, network and default-interface readings no longer run shell commands that block the server every few seconds on Linux.
- Accessory pages and widgets opened together share one load from Homebridge, and installed plugins are scanned once for simultaneous requests.
- Several log viewers share one `tail` or `journalctl` process, and the native log follows the file without polling five times a second.
- The dashboard, plugins, settings and config editor pages load about 80–90 KB (gzipped) less: the terminal loads only where it is used. Accessory settings dialogs and their sliders load when opened.
- In glass mode only the sidebar, header, menus and dialogs are blurred; cards and tiles use a plain translucent fill, which scrolls much more smoothly with many accessories.
- A plugin's child bridge status update re-renders only that plugin's card.

## [2.0.0-beta.2] - 2026-10-03

### Added

- **One-step install:** `npx @mp-consulting/homebridge-config-glass-ui` replaces the official web interface with Glass UI, and `... revert` puts it back (the version it replaced). On the Synology, Debian, Raspberry Pi and Docker packages it also links the folder those packages start the interface from (`homebridge-config-ui-x`) to Glass UI; without that link they no longer started Homebridge after the switch. A plain `npm install -g` also stopped on the official interface's `hb-service` command (`EEXIST`). If Glass UI fails to install, the official interface is put back.

## [2.0.0-beta.1] - 2026-10-03

### Security

- **Child bridge pairing codes are admin-only**, as the main bridge's already were. Non-admin users no longer receive a child bridge's HomeKit or Matter setup code or PIN, from the REST endpoint, the status reply or the live updates.
- **The `wallpaper` setting accepts only an uploaded wallpaper** (`ui-wallpaper.jpg`, `.jpeg`, `.png`, `.webp` or `.gif` in the storage folder). It could be set to any path, which the login page then served without a session (including `.uix-secrets`), and which replacing or removing the wallpaper deleted. Config saves, the settings page and backup restores refuse other values. Uploads take only those five image types. A wallpaper set to another path is no longer shown; upload it again.
- **The Docker startup script needs terminal access.** It runs as root in the container, so it is now read and saved only when terminal access is enabled, and the settings link is hidden otherwise.
- **`log.path` cannot point at the UI's own secrets**: `.uix-secrets`, `auth.json`, `config.json`, `persist/`, `ssl-certs/`, backups and the like are refused on save and when tailing, downloading or truncating the log.
- **Guessing spread across many addresses is slowed.** Besides the per-address limit, a username that collects 50 failed sign-ins from anywhere gets a cooldown that doubles up to 15 minutes. An address that has signed in as that user before is exempt, so an attacker cannot keep the owner out.
- New `ui.trustProxy` setting (addresses or CIDR ranges): behind a reverse proxy, sign-in limits then apply to the real client address instead of the proxy's.
- Non-admin users no longer see the server's file paths, service user, network details, machine serial or install paths.
- The network widget accepts only interface names the system reports.

### Fixed

- A plugin custom UI asking for its cached accessories gets an error back when they cannot be loaded, instead of waiting forever. Plugin log, plugin settings and child bridge errors show the server's message.
- Restart OS, Restart Container and Shut Down ask for confirmation, and their pages no longer act when reached by a reload, the back button or a typed URL.
- Deleting a stored backup, and "Delete all" config backups, ask for confirmation. The backup list shows loading, empty and failed states.
- The weather widget shows an error with a Retry button instead of spinning forever when it cannot load.
- The Restart button after a restore reports a failure instead of doing nothing.

### Accessibility

- Every dialog is named by its title for screen readers.
- The page language follows the UI language.
- Light themes with a pale primary colour (orange, cyan, grey, green, teal, red, pink, blue-grey) use a darker shade for accent text and button backgrounds, to meet WCAG contrast.
- Accessory animations stop when the system asks for reduced motion.
- Accessory tiles no longer announce every sensor reading.
- Labels for the setup wizard, startup, SSL, restore and search fields; tooltips open on keyboard focus; toasts pause while focused; the mobile menu opens with Space and closes with Escape; the current page is marked with `aria-current`; busy buttons keep their name.

### Performance

- Opening the accessories page re-renders only the tiles whose data changed, and the server no longer sends the same accessory list again or reloads once per discovered bridge.
- Plugin installs and updates no longer empty npm's cache first; it is cleaned only to retry an install that failed on a corrupt cache.
- The plugins page loads about 660 KB less up front: the settings form, config editor and other plugin dialogs load when opened.
- The installed-plugin scan checks the npm registry 12 plugins at a time, and plugin search no longer fetches dozens of packages for short search terms.
- Typing in a plugin settings form re-renders it once per burst rather than per key.
- Chart widgets stop polling in a background tab and no longer animate each reading.
- The log viewer keeps at most 2 MB of output and does less work per frame.
- Identical simultaneous requests to Homebridge share one request.

## [2.0.0-beta.0] - 2026-10-03

The browser UI is rewritten in React (from Angular). Pages, themes, glass mode, dark mode, translations, saved dashboard and accessory layouts, and plugin custom settings UIs all carry over unchanged: the new UI keeps the old markup, so it looks and behaves the same. This is a major version because plugin custom UIs run inside a new host page, even though the three tested (Ring, Camera FFmpeg, UniFi Protect) work as before.

### Security

- **Backups no longer contain the JWT signing secret** (`.uix-secrets`) or the hb-service startup options. A restored instance keeps its own secret, so existing sessions and logins keep working; a fresh install makes a new one on first start. Backups still contain `auth.json` (password hashes, so users can be restored), the HomeKit pairing keys in `persist/`, plugin credentials in `config.json` and any SSL key kept in the storage folder, so backup archives are now written readable by the service user only (`0600`) and the `instance-backups` folder is created `0700`.
- **Restoring a backup refuses every file a backup leaves out**: `.uix-secrets`, `.uix-hb-service-homebridge-startup.json`, `startup.sh`, `.docker.env`, `node_modules`, `.npm`, `.git`, `package.json` and the rest of the list, even when an older or hand-made archive contains them. The restored `config.json` goes through the same command checks as a config save; an unsafe restart, shutdown or log command is removed (and logged) and the rest of the restore completes.
- **Custom log command** (`log.method: "custom"`): it runs any program, so it is now allowed only when terminal access is enabled, or when it is `tail`, `journalctl`, `cat`, `docker logs` or `podman logs` (optionally `sudo -n ...`) with plain arguments. Other commands are refused when the config is saved, and refused with an explanation in the log viewer if already in `config.json`.
- On Windows, the log file path is passed to PowerShell out of band instead of inside a quoted string, so a quote in `log.path` can no longer run PowerShell code. A log path containing control characters is refused on save.
- **`NODE_OPTIONS` in the Homebridge startup settings** may no longer use `--require`, `--import`, `--loader`, `--inspect` or other flags that load code, open a debugger or read/write files. They are refused on save, and hb-service ignores them (with a warning) if already in the startup settings file.
- An `.hbfx` backup without a `bridge.username` restores with this instance's username instead of failing.
- **Open sockets end when their user's access does.** Deleting, demoting or changing the password of a user, turning on 2FA, an account-wide logout, or turning on `restrictLogsToAdmins` now disconnects that user's sockets in every namespace at once. Terminal output and the log tail also re-check the user before every send, so a revoked or demoted user stops receiving them even between checks; one viewer of a shared persistent terminal being revoked leaves the others connected.
- **A socket no longer outlives its session.** Sockets were re-checked against the user but never against the token's expiry, so one stayed authorised for as long as it stayed open. A socket is now closed five minutes after its token expires; the UI hands every refreshed token to its open sockets (a `reauth` message, falling back to a reconnect), so a dashboard left open keeps working for as long as the session is refreshed. A local (inactivity) logout ends that browser's sockets.
- **Less is visible before sign-in.** `GET /api/auth/settings` without a session now returns only what the login and setup pages need; the UI version, Homebridge version, platform, port, backup path and feature flags are sent to signed-in users only. The `/swagger` api docs are served only in development (`UIX_DEVELOPMENT=1`), and the support page links to them only then.
- **Accepted risk: plugin custom UIs are not isolated from the UI.** Their iframe keeps `allow-same-origin allow-scripts` on the UI's own origin, so a plugin's settings page can act as the signed-in user. Dropping `allow-same-origin` breaks every custom UI: the plugin's assets load with a SameSite=Strict session cookie an opaque-origin frame never sends, plugin pages use browser storage, the message channel is origin-pinned and the theme is applied through the frame's document. Installing a plugin already runs its code on the server; isolating its UI would need a separate origin.

### Fixed

- **Plugin settings forms open again** from a plugin's card on the Plugins page, and plugin custom UIs that ask for a settings form (such as Ring's login form) show it. The previous UI showed an empty dialog there.
- Cancelling an edit in the child bridge setup, or a rename in an accessory's info dialog, no longer leaves the unsaved change on screen.
- The config editor highlights the invalid entry again when a save is refused.
- Accessory tiles become controllable as soon as Homebridge reports it is ready, without reopening the page.
- Dismissing the Homebridge v2 readiness warning closes the update dialog.
- On a new install, the pairing and cached-accessory lists load (empty) before Homebridge has run once, instead of failing with a server error.
- The manual config editor shows one editor for the open config block, instead of one per block.
- Matter: controlling one part of a multi-part accessory no longer changes its parent's shown state; malformed accessory ids are refused instead of half-parsed; a command that cannot reach Homebridge is reported as such instead of as a timeout.
- Mobile: the closed side menu no longer shows through the glass theme or traps keyboard focus, and the logo no longer covers page titles. Plugin cards no longer clip long names or show a bare "@".

### Accessibility

- Text meets 4.5:1 contrast: dark-mode accent text, light-mode grey text, the pairing status pill and inline code.
- Buttons and links in the glass theme show a focus ring; the login form has labels and announces a failed login; icon-only links and buttons have names; pages have a main landmark and a skip link.
- Touch targets on phones are at least 44 px, and remaining English-only strings are translated.

### Performance

- Static files are served brotli/gzip compressed: the first load is about 214 kB instead of 1.1 MB.
- The CPU, memory and network widgets no longer run shell commands per open tab: one sample serves every client, at the fastest refresh interval a widget asks for.
- Accessory updates re-render only the tile that changed (50 updates on 300 accessories: ~90 ms instead of ~2 s), the dashboard no longer loads the plugin manager up front, the stylesheet is a third smaller, and typing in the plugin search no longer re-renders every card.

### Changed

- On the dashboard, dropping a widget onto another moves the other one aside instead of swapping the two.
- The terminal font size is saved as a number in the UI config (it was a string).
- Widgets set to refresh faster than every 10 seconds get fresh values at that rate; the server samples once for all of them.

### Known differences

- homebridge-switchbot: hiding a device in its settings no longer saves `false` for that device's other (hidden) switches. They are treated as off either way.

## [1.0.0] - 2026-09-30

### Added

- **Liquid glass interface**: a translucent, frosted-glass look for every page. The sidebar floats as a rounded panel, cards and widgets sit on blurred glass over a soft background tinted by the selected theme colour, and header actions are round glass buttons. It works in both light and dark mode and is on by default. Turn it off with **Settings → Display → Glass Mode**, or with `"glassMode": false` in the UI platform config.
- First release of Homebridge Glass UI under `@mp-consulting/homebridge-config-glass-ui`.
- **HTTPS fallback warning**: if HTTPS is configured but the certificate can't be loaded, the UI still starts over plain HTTP so you can fix it, and now shows administrators a warning banner explaining why.

### Changed

These behave differently from homebridge-config-ui-x:

- **Pairing codes are for administrators only.** The HomeKit PIN and setup code, and the Matter pairing codes, are no longer sent to non-admin users. The dashboard QR widgets show the pairing status to everyone, but show the code only to admins.
- **Only administrators can change the dashboard layout**, which is shared by every user.
- **No cross-origin API access in production.** The API and its websockets only accept requests from the UI's own origin. The Angular dev server (ports 4200/8080) is allowed only when `UIX_DEVELOPMENT=1`.

### Security

- An open terminal, custom plugin settings UI or accessory-control session now stops working as soon as its user is deleted, demoted or has their password changed, instead of lasting as long as the browser tab stays open.
- The JWT signing secret, the self-signed certificate's private key, `auth.json` and `config.json` are kept readable by their owner only, and saving a file no longer resets its permissions.
- The self-signed certificate is now a regular server certificate, not a certificate authority, and gets a random serial number, so Firefox accepts a regenerated certificate.
- Login: failed attempts take the same time whether or not the username exists, IPv6 clients are rate-limited per /64 network, current-password checks when changing a password or turning off 2FA are rate-limited, and re-creating a deleted username no longer revives the old account's sessions.
- Backup restore refuses archives that would expand to more than 20× the upload limit, and uploads cut off at the size limit.
- Plugin names and versions are validated on every install, update and restore, so npm can't be pointed at an arbitrary URL or given extra options.
- A crafted device ID can no longer be used to read other files through the pairing API.
- Dependencies updated to fix known vulnerabilities in engine.io, fast-uri, brace-expansion and undici.

### Performance

- The plugin list no longer starts one Node process per plugin at the same time, and no longer blocks the server while it runs npm.
- The installed-plugin scan is cached instead of being repeated on each dashboard load, and toggling an accessory no longer sends one request per accessory service to Homebridge.
- Generating the self-signed certificate no longer freezes the UI.
- Fixed memory and listener leaks when a browser disconnects mid-setup, and on pages and dialogs visited repeatedly in the UI.
