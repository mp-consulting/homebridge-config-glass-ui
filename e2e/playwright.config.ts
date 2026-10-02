/**
 * Parity suite: the same specs run against the Angular UI and the React UI,
 * each built by e2e/build.mjs and served from the real backend by e2e/serve.mjs.
 *
 *   node e2e/build.mjs && npx playwright test -c e2e
 *   npx playwright test -c e2e --project react      (one UI only)
 */

import { defineConfig, devices } from '@playwright/test'

const UIS = [
  { name: 'angular', port: 18581 },
  { name: 'react', port: 18582 },
]

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
  projects: UIS.map(ui => ({
    name: ui.name,
    use: { baseURL: `http://localhost:${ui.port}` },
  })),
  webServer: UIS.map(ui => ({
    command: `node e2e/serve.mjs --ui ${ui.name} --port ${ui.port}`,
    cwd: '..',
    url: `http://localhost:${ui.port}/api/auth/settings`,
    reuseExistingServer: false,
    timeout: 120_000,
  })),
})
