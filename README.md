# Homebridge Glass UI

[![npm version](https://badge.fury.io/js/@mp-consulting%2Fhomebridge-config-glass-ui.svg)](https://badge.fury.io/js/@mp-consulting%2Fhomebridge-config-glass-ui)
[![CI](https://github.com/mp-consulting/homebridge-config-glass-ui/actions/workflows/build.yml/badge.svg)](https://github.com/mp-consulting/homebridge-config-glass-ui/actions/workflows/build.yml)

A web interface for managing, configuring and controlling [Homebridge](https://homebridge.io), with a liquid glass design.

![Status](screenshots/status.png)

## Features

- **Liquid glass design** in light and dark mode, tinted by the theme colour you pick
- Install, configure, update and remove Homebridge plugins, with a check of which plugins would not support a Node.js or Homebridge upgrade
- Visual settings forms for plugins that ship a config schema
- Edit `config.json` with syntax checking, validation and automatic backups you can compare with the current config
- A customisable widget dashboard for monitoring your server (network traffic in bits or bytes, sent and received charted separately)
- Live Homebridge logs and a web terminal
- View and control your accessories from any browser
- Run plugins as child bridges
- Back up and restore your whole Homebridge instance
- `hb-service`, a command that installs Homebridge as a service on Linux, macOS, FreeBSD and Windows

## Installation

One command replaces your current Homebridge web interface with Glass UI. Run it from the Homebridge shell: the terminal in your current web interface, `hb-shell` on the Synology, Debian and Raspberry Pi packages, or `docker exec -it <container> hb-shell` with Docker:

```sh
npx @mp-consulting/homebridge-config-glass-ui
```

It removes the official interface (`homebridge-config-ui-x`), installs Glass UI in its place and, on the Synology, Debian, Raspberry Pi and Docker packages, links the folder those packages start the interface from to Glass UI. If anything fails, it puts the official interface back. Then restart Homebridge (Package Center on a Synology, `sudo hb-service restart` elsewhere, or restart the container). Your login, settings, plugins and accessories carry over: Glass UI uses the same `config` platform block and the same `hb-service` command.

Run the same command again to update, or after an update of the Homebridge package or a new container has brought the official interface back. To go back to the official interface:

```sh
npx @mp-consulting/homebridge-config-glass-ui revert
```

Add `@next` to the package name for the current beta (`npx @mp-consulting/homebridge-config-glass-ui@next`).

### Updating

Once Glass UI is installed, update it like a plugin: **Plugins**, then **Update** on the Homebridge Glass UI card (or Update All). When the update finishes the interface restarts on its own and the page reloads on the new version.

Updating from 2.0.0-beta.3 or earlier still runs that version's update code, which does not restart the interface afterwards. If the version on the home page has not changed once the update is done, use **Restart** from the power menu once.

### New installs

On a machine without Homebridge, install it with npm and set it up as a system service:

```sh
npm install -g --allow-scripts=@homebridge/node-pty-prebuilt-multiarch @mp-consulting/homebridge-config-glass-ui
sudo hb-service install
```

npm 12 and later skip dependency install scripts unless they are allowed. `--allow-scripts` lets the terminal's native module install; without it the built-in terminal won't work.

The UI then listens on port `8581`, for example `http://localhost:8581`. The default username and password are both `admin`.

### Installing by hand

What the command does on the Synology package, as the `homebridge` user in `hb-shell` (the Debian, Raspberry Pi and Docker packages use `/opt/homebridge` instead of `/var/packages/homebridge/target/app`):

```sh
npm uninstall -g homebridge-config-ui-x
npm install -g --allow-scripts=@homebridge/node-pty-prebuilt-multiarch @mp-consulting/homebridge-config-glass-ui
ln -s @mp-consulting/homebridge-config-glass-ui /var/packages/homebridge/target/app/lib/node_modules/homebridge-config-ui-x
```

The packages start the interface from that `homebridge-config-ui-x` folder rather than through `hb-service`; without the link they no longer start Homebridge at all.

## Configuration

Settings live in the `config` platform block of `config.json`. They can all be changed from the **Settings** screen.

```json
{
  "platform": "config",
  "name": "Homebridge Glass UI",
  "port": 8581,
  "theme": "deep-purple",
  "lightingMode": "auto",
  "glassMode": true
}
```

| Option         | Default       | Description                                             |
| -------------- | ------------- | ------------------------------------------------------- |
| `theme`        | `deep-purple` | Accent colour. It also tints the glass background.      |
| `lightingMode` | `auto`        | `auto` follows the browser, or force `light` or `dark`. |
| `glassMode`    | `true`        | Set to `false` to switch back to flat, opaque surfaces. |

## Screens

### Plugins

![Plugins](screenshots/plugins.png)

### Plugin settings

![Plugin settings](screenshots/darkmode-alexa-settings.png)

### Accessories

![Accessories](screenshots/accessories.png)

### Config editor

![Config](screenshots/config.png)

### Logs

![Logs](screenshots/logs.png)

## Development

```bash
git clone https://github.com/mp-consulting/homebridge-config-glass-ui.git
cd homebridge-config-glass-ui

# The server and the UI are two npm packages
npm install && npm install --prefix ui

# Build server + UI
npm run build

# Live reload: UI on :4200, backend on :8581
npm run watch

# Tests and lint
npm test
npm run test:ui
npm run lint
```

## License

MIT. See the [LICENSE](LICENSE) file for details.

## Credits

- [Homebridge](https://homebridge.io/)
- [HAP-NodeJS](https://github.com/homebridge/HAP-NodeJS)
