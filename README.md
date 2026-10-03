# Homebridge Glass UI

[![npm version](https://badge.fury.io/js/@mp-consulting%2Fhomebridge-config-glass-ui.svg)](https://badge.fury.io/js/@mp-consulting%2Fhomebridge-config-glass-ui)
[![CI](https://github.com/mp-consulting/homebridge-config-glass-ui/actions/workflows/build.yml/badge.svg)](https://github.com/mp-consulting/homebridge-config-glass-ui/actions/workflows/build.yml)

A web interface for managing, configuring and controlling [Homebridge](https://homebridge.io), with a liquid glass design.

![Status](screenshots/status.png)

## Features

- **Liquid glass design** in light and dark mode, tinted by the theme colour you pick
- Install, configure, update and remove Homebridge plugins
- Visual settings forms for plugins that ship a config schema
- Edit `config.json` with syntax checking, validation and automatic backups
- A customisable widget dashboard for monitoring your server
- Live Homebridge logs and a web terminal
- View and control your accessories from any browser
- Run plugins as child bridges
- Back up and restore your whole Homebridge instance
- `hb-service`, a command that installs Homebridge as a service on Linux, macOS, FreeBSD and Windows

## Installation

Install it from the Plugins screen of your current Homebridge web interface, or with npm:

```sh
npm install -g --allow-scripts=@homebridge/node-pty-prebuilt-multiarch @mp-consulting/homebridge-config-glass-ui
```

npm 12 and later skip dependency install scripts unless they are allowed. `--allow-scripts` lets the terminal's native module install; without it the built-in terminal won't work.

To run Homebridge and the UI as a system service:

```sh
sudo hb-service install
```

The UI then listens on port `8581`, for example `http://localhost:8581`. The default username and password are both `admin`.

> [!NOTE]
> Homebridge Glass UI replaces your existing Homebridge web interface. It uses the same `config` platform block in `config.json` and the same `hb-service` command, so uninstall the other interface first.

### Synology DSM package

The Homebridge package for Synology bundles the official web interface, and its launcher starts the UI from that package's folder (`homebridge-config-ui-x`) rather than through `hb-service`. Replace the bundled interface and point that folder name at Glass UI. Run these as the `homebridge` user, from the package's shell:

```sh
npm uninstall -g homebridge-config-ui-x
npm install -g --allow-scripts=@homebridge/node-pty-prebuilt-multiarch @mp-consulting/homebridge-config-glass-ui
ln -s @mp-consulting/homebridge-config-glass-ui /var/packages/homebridge/target/app/lib/node_modules/homebridge-config-ui-x
```

Then restart Homebridge from Package Center. Without the link, the package no longer starts Homebridge at all.

- An update of the Homebridge package can reinstall the official interface over the link. If it does, run the three commands again.
- To go back, remove the link and run `npm install -g homebridge-config-ui-x`.

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
