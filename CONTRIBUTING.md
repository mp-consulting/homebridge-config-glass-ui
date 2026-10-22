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

### Browser tests

The Playwright suite runs the built UI against the real backend on fresh mock storage. The backend reports a fixed, made-up host and stays off the network (`e2e/fixed-host.ts`), so results do not depend on your machine.

```sh
node e2e/build.mjs                 # build the UI the suite serves
node e2e/install-plugins.mjs       # once: real plugins with a custom settings UI
E2E_OTP_USER=1 npx playwright test -c e2e --grep-invert visual   # everything but the screenshots
```

### Visual tests

`e2e/specs/visual.spec.ts` compares screenshots of the main pages (also dark, flat, Hebrew and mobile) with stored baselines. Baselines are per platform. The Linux ones in `e2e/specs/visual.spec.ts-snapshots/*-linux.png` are committed, and CI compares against them strictly inside the `mcr.microsoft.com/playwright` image whose tag matches `@playwright/test`. Fonts and anti-aliasing differ between machines, so they can only be recorded in that image. After an intended visual change, re-record them with Docker and commit the new PNGs:

```sh
docker run --rm --platform linux/amd64 --ipc=host \
  -v "$PWD":/work -v /work/node_modules -v /work/ui/node_modules -v /work/e2e/.run \
  -w /work mcr.microsoft.com/playwright:v1.64.1-noble bash -c \
  'npm ci && npm ci --prefix ui && node e2e/build.mjs && node e2e/install-plugins.mjs \
   && npx playwright test -c e2e visual.spec --update-snapshots'
```

The extra volumes keep the container's Linux `node_modules` and build apart from yours. `--platform linux/amd64` matches the CI runners (Docker Desktop emulates it on Apple silicon). Drop `--update-snapshots` to check without recording. When you bump `@playwright/test`, change the image tag here, in the spec header and in the `visual` job of `.github/workflows/build.yml`, then re-record.

On macOS or Windows the baselines (`-darwin`, `-win32`) are gitignored and only useful locally. Record them before a change and compare after it:

```sh
npx playwright test -c e2e visual.spec --update-snapshots   # before
npx playwright test -c e2e visual.spec                      # after
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
