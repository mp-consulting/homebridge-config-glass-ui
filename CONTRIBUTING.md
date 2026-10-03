# Contributing

Pull requests are welcome.

The server is written in [TypeScript](https://www.typescriptlang.org/) with [Nest.js](https://nestjs.com/). The browser UI is a [React](https://react.dev/) app built with [Vite](https://vite.dev/) in `ui/`.

## Getting set up

> [!NOTE]
> A Raspberry Pi does not have enough memory or CPU to build the UI. Develop on a desktop machine.

```sh
git clone https://github.com/mp-consulting/homebridge-config-glass-ui.git
cd homebridge-config-glass-ui
npm install && npm install --prefix ui
npm run build
```

## Watching for changes

```sh
npm run watch
```

This starts the Vite dev server on port `4200` and the backend on port `8581`. Open `http://localhost:4200`; the page reloads when you change the code.

## Running tests

```sh
npm test          # server e2e suite
npm run test:ui   # UI unit tests
npm run lint
```

## Translations

`ui/src/i18n/en.json` is the source of truth. Add new keys there, then run `npm run lang-sync` to copy them to the other languages.
