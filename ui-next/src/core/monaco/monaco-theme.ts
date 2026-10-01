import { useSyncExternalStore } from 'react'

export type LightingMode = 'light' | 'dark'

/**
 * The Monaco theme for a lighting mode. The Angular editors picked
 * `vs-dark` / `vs-light` from `SettingsService.actualLightingMode`; Monaco has
 * no `vs-light` theme and fell back to `vs`, so `vs` is used directly.
 *
 * @param mode - the app's effective lighting mode
 */
export function monacoThemeFor(mode: LightingMode): 'vs' | 'vs-dark' {
  return mode === 'dark' ? 'vs-dark' : 'vs'
}

/**
 * The effective lighting mode as the app shows it. `SettingsService.setTheme`
 * adds `dark-mode` to `<body>` exactly when `actualLightingMode` is `dark`, so
 * the body class is the source of truth until the settings store is ported.
 *
 * @param doc - the document to inspect
 */
export function lightingModeFromBody(doc: Document = document): LightingMode {
  return doc.body?.classList.contains('dark-mode') ? 'dark' : 'light'
}

function subscribeBodyClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/**
 * The Monaco theme that matches the app, updated live when the body class
 * changes (Angular only read it on init; following changes is free here).
 */
export function useMonacoTheme(): 'vs' | 'vs-dark' {
  const mode = useSyncExternalStore(subscribeBodyClass, () => lightingModeFromBody(), () => 'light' as const)
  return monacoThemeFor(mode)
}
