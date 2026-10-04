# Upgrading to Glass UI 2.0

Two paths lead here: from the official Homebridge interface, `homebridge-config-ui-x`, and from Glass UI 1.x. Both keep your Homebridge as it is: the same `config.json`, the same users, the same paired accessories. This page lists what carries over, what is new, and what behaves differently. The [CHANGELOG](../CHANGELOG.md) has every detail.

## From homebridge-config-ui-x

### How

Run this from the Homebridge shell (the terminal in your current web interface, `hb-shell` on the Synology, Debian and Raspberry Pi packages, or `docker exec -it <container> hb-shell` with Docker), then restart Homebridge:

```sh
npx @mp-consulting/homebridge-config-glass-ui
```

It removes `homebridge-config-ui-x`, installs Glass UI in its place and, on the packages that start the interface from the `homebridge-config-ui-x` folder, links that folder to Glass UI. If anything fails it puts the official interface back. To go back later:

```sh
npx @mp-consulting/homebridge-config-glass-ui revert
```

A Homebridge package update or a new container can bring the official interface back; run the install command again. See [Installing by hand](../README.md#installing-by-hand) for the manual steps.

### What carries over

Glass UI reads and writes the same files as the official interface, in the same Homebridge storage folder:

| What                                       | Where                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| UI settings (port, theme, HTTPS, log, …)   | The `config` platform block of `config.json`                                           |
| Users, passwords, 2FA                      | `auth.json`                                                                            |
| Session signing secret                     | `.uix-secrets` (existing sessions stay signed in)                                      |
| Pairings, cached accessories               | `persist/`, `accessories/` (Homebridge's own; untouched)                               |
| Dashboard layout                           | `.uix-dashboard.json`                                                                  |
| Instance backups and `config.json` backups | `backups/instance-backups/` (or your scheduled backup path), `backups/config-backups/` |
| hb-service startup settings                | `.uix-hb-service-homebridge-startup.json`, the `hb-service` command                    |
| Plugin custom settings UIs                 | Unchanged: plugins keep their `homebridge-ui` folder                                   |

Backups made by either interface restore in the other. One exception: Glass UI backups leave out `.uix-secrets` and the hb-service startup settings (a restored instance keeps its own), and a restore refuses those files even when an older archive contains them.

### What Glass UI adds

These live in files of their own, which the official interface ignores (and leaves alone if you go back):

| Feature                                                                                                                 | Stored in                                    |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| The liquid glass look, light and dark (`glassMode`)                                                                     | `config` block                               |
| Scenes and schedules                                                                                                    | `scenes.json`                                |
| Accessory history charts                                                                                                | `accessory-history/`                         |
| Notifications (webhook, ntfy, Pushover, Telegram)                                                                       | `.uix-notifications.json`                    |
| API tokens for scripts and the MCP server                                                                               | `.uix-api-tokens.json` (hashes only)         |
| Update All journal (reports a run cut short by a restart)                                                               | `.uix-update-all-journal.json`               |
| The Assistant and the MCP server settings (optional, off)                                                               | The `HomebridgeAiKit` block of `config.json` |
| Child Bridge Health, Quick Controls, instance switcher, installable app, plugin compatibility check, config backup diff | UI settings and existing data                |

### What behaves differently

Glass UI is stricter in a few places. If something you relied on stops working, it is probably one of these:

- **Pairing codes are for administrators only**, for the main bridge and child bridges (HomeKit PIN, setup code, Matter codes). Other users see the pairing status, not the code.
- **Only administrators change the dashboard layout**, which every user shares.
- **No cross-origin API access in production.** The API and its sockets only accept the UI's own origin; the dev servers on ports 4200/8080 are allowed only with `UIX_DEVELOPMENT=1`. Use an [API token](../README.md#api-access) for scripts.
- **`/swagger` is served only in development** (`UIX_DEVELOPMENT=1`), and before sign-in `GET /api/auth/settings` returns only what the login page needs.
- **A custom log command** (`log.method: "custom"`) is allowed only when terminal access is on, or when it is `tail`, `journalctl`, `cat`, `docker logs` or `podman logs` with plain arguments. **`log.path`** cannot point at the UI's secrets (`.uix-secrets`, `auth.json`, `config.json`, `persist/`, `ssl-certs/`, backups).
- **`NODE_OPTIONS`** in the startup settings and in a child bridge's `_bridge.env` may not load code, open a debugger or read files (`--require`, `--import`, `--loader`, `--inspect`…); such values are refused on save and ignored if already there.
- **The `wallpaper` setting** only accepts a wallpaper uploaded from the settings page.
- **The Docker startup script** is read and saved only when terminal access is on.
- **New installs show the Homebridge log to administrators only** (`restrictLogsToAdmins`); existing installs keep their setting.
- **Sign-in is rate limited** per address and per username, and **sockets close** when their session expires or their user loses access (deleted, demoted, password changed).
- **`hb-service install` no longer grants `SETENV` in sudoers**; an existing entry is replaced.
- **Backup archives are written readable by the service user only** (`0600`), since they still contain password hashes, pairing keys and plugin credentials.

## From Glass UI 1.x

2.0 rewrites the browser UI in React (from Angular). Pages, themes, glass mode, dark mode, translations, saved dashboard and accessory layouts and plugin custom settings UIs carry over; nothing in the storage folder needs migrating.

### How

Update it like a plugin: **Plugins**, then **Update** on the Homebridge Glass UI card (or Update All). The 2.0 betas are on the `next` tag: `npx @mp-consulting/homebridge-config-glass-ui@next`.

Updating from 2.0.0-beta.3 or earlier still runs that version's update code, which does not restart the interface afterwards: if the version on the home page has not changed once the update is done, use **Restart** from the power menu once.

### New since 1.x

- Scenes and schedules, accessory history charts, notifications, Child Bridge Health with crash loop detection, Quick Controls and an installable app, a switcher between Homebridge instances.
- API tokens and plugin jobs over REST (`POST /api/plugins/install`, `/update`, `/uninstall`, `GET /api/plugins/jobs/:jobId`).
- A plugin compatibility check before a Node.js or Homebridge upgrade, and a diff of a config backup against the current config.
- The optional Assistant (Log Doctor, Config Copilot, a chat with tools, update risk, room suggestions, a daily digest) and the MCP server settings, on [`@mp-consulting/homebridge-ai-kit`](https://github.com/mp-consulting/homebridge-ai-kit).
- One-command install and revert (`npx @mp-consulting/homebridge-config-glass-ui`).

### Breaking changes

- **Plugin custom settings UIs run in a new host page.** The messages, classes and styles they receive are the same, and the custom UIs tested (Ring, Camera FFmpeg, UniFi Protect) work as before; tell us about one that does not.
- On the dashboard, dropping a widget onto another moves the other one aside instead of swapping them.
- Widgets set to refresh faster than every 10 seconds get fresh values every 10 seconds (one server sample serves every client).
- The terminal font size is saved as a number in the UI settings (it was a string).
- homebridge-switchbot: hiding a device no longer saves `false` for that device's other hidden switches (they are off either way).
- Everything listed under [What behaves differently](#what-behaves-differently) above applies to 1.x users too where 1.x still behaved like the official interface (most of the security changes arrived in 2.0).
