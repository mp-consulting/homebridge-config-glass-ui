/**
 * End-to-end suite: the UI built by e2e/build.mjs, served from the real
 * backend by e2e/serve.mjs on fresh mock storage.
 *
 *   node e2e/build.mjs && npx playwright test -c e2e
 *   node e2e/install-plugins.mjs      (once, for the custom settings UI spec)
 *
 * Until 2.0 the same specs also ran against the Angular UI, as the parity
 * check for the React port.
 */

import { defineConfig, devices } from '@playwright/test'

const PORT = 18581

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node e2e/serve.mjs --port ${PORT}`,
    cwd: '..',
    url: `http://localhost:${PORT}/api/auth/settings`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
