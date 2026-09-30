# Changelog

All notable changes to this project will be documented in this file.

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
