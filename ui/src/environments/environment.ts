import packageJson from '../../../package.json'

// One file for both modes (replaces Angular's fileReplacements). In dev the UI
// runs on :4200 and talks to the backend on :8581 of the same host.

function apiBaseFromBaseHref(): string {
  const baseHref = document.querySelector('base')?.getAttribute('href') || '/'
  return baseHref.endsWith('/') ? `${baseHref}api` : `${baseHref}/api`
}

const devHost = window.location.hostname
const devBackend = `http://${devHost}:8581`

export const environment = import.meta.env.DEV
  ? {
      serverTarget: packageJson.version,
      production: false,
      api: {
        base: `${devBackend}/api`,
        socket: devBackend,
        origin: devBackend,
      },
      apiCredentials: 'include' as const,
      owm: {
        appid: 'fec67b55f7f74deaa28df89ba6a60821',
      },
    }
  : {
      serverTarget: packageJson.version,
      production: true,
      api: {
        base: apiBaseFromBaseHref(),
        socket: `${window.location.protocol === 'http:' ? 'ws://' : 'wss://'}${window.location.host}`,
        origin: window.location.origin,
      },
      apiCredentials: 'same-origin' as const,
      owm: {
        appid: 'fec67b55f7f74deaa28df89ba6a60821',
      },
    }
