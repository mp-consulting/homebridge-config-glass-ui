/**
 * Register the service worker (`static/sw.js`, served next to index.html) in
 * production builds on a secure origin. It caches the UI's static files only;
 * the API and websocket always go to the network.
 * @param env - what decides it (for specs)
 * @param env.production - a production build
 * @param env.navigator - the browser's navigator
 * @param env.secure - a secure context (https or localhost)
 */
export async function registerServiceWorker(env: { production: boolean, navigator: Navigator, secure: boolean } = {
  production: import.meta.env.PROD,
  navigator: window.navigator,
  secure: window.isSecureContext,
}): Promise<boolean> {
  if (!env.production || !env.secure || !('serviceWorker' in env.navigator)) {
    return false
  }
  try {
    // Relative, so it also works behind a reverse proxy sub path
    await env.navigator.serviceWorker.register('./sw.js', { scope: './' })
    return true
  } catch (error) {
    console.warn('Service worker registration failed:', error)
    return false
  }
}
