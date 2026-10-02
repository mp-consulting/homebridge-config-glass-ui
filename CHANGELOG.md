# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0-beta.0] - Unreleased

The browser UI is rewritten in React (from Angular). Pages, themes, glass mode, dark mode, translations, saved dashboard and accessory layouts, and plugin custom settings UIs all carry over unchanged: the new UI keeps the old markup, so it looks and behaves the same. This is a major version because plugin custom UIs run inside a new host page, even though the three tested (Ring, Camera FFmpeg, UniFi Protect) work as before.

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
