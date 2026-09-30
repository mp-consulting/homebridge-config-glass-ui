import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
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
