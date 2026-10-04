import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      // Enforced on `--coverage` runs (CI runs one). The measured levels
      // rounded down (76.6 / 72.8 / 81.2 / 76.5 on macOS, Node 24); raise them
      // as coverage grows.
      thresholds: {
        statements: 76,
        branches: 72,
        functions: 81,
        lines: 76,
      },
    },
    // Each spec file gets its own storage directory (test/storage-path.ts)
    // under a temp root created by the global setup, so files run in parallel
    globalSetup: ['./test/global-setup.ts'],
    include: ['test/**/*.e2e-spec.ts'],
  },
  plugins: [
    // This is required to build the test files with SWC
    swc.vite({
      // Explicitly set the module type to avoid inheriting this value from a `.swcrc` config file
      module: {
        type: 'es6',
      },
    }),
  ],
})
