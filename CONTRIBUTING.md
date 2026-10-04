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

Because `lang-sync` copies the English text, a missing translation looks like any other string. `npm run i18n:report` lists, per locale, the keys whose value is still exactly the English one:

```sh
npm run i18n:report                         # a count per locale
npm run i18n:report -- --locale fr          # the French keys still in English
npm run i18n:report -- --since origin/main  # only keys added since main
npm run i18n:report -- --json               # { "fr": ["key", ...], ... }
```

Strings with no words (`{{ min }} – {{ max }}`) are skipped. Brand names and other strings that are meant to stay the same go in `scripts/i18n-allowlist.json`: `values` for an English string allowed in every locale, `keys` for a key, `locales` for a key in one language (a word German shares with English, for example).

CI prints the report on every build, and on a pull request also the keys it adds that are still in English. It never fails the build: untranslated strings fall back to English, and most translations come from contributors after a release.
