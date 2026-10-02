# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0-beta.0] - Unreleased

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
- The manual config editor shows one editor for the open config block, instead of one per block.

### Changed

- On the dashboard, dropping a widget onto another moves the other one aside instead of swapping the two.
- The terminal font size is saved as a number in the UI config (it was a string).
- The initial download is slightly smaller (1.1 MB, from 1.18 MB).

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
