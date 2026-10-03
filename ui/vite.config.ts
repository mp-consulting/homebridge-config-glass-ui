import type { Plugin } from 'vite'

import { realpathSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { searchForWorkspaceRoot } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { defineConfig } from 'vitest/config'

const monacoVs = 'node_modules/monaco-editor/min/vs'

// Same Monaco file set the Angular build copied (ui/angular.json). It is checked
// after the build by scripts/verify-monaco-assets.mjs.
// `stripBase` drops the leading `node_modules/...` segments so the files land
// at the same paths as before.
const vsDest = 'assets/monaco/min/vs'
const monacoTargets = [
  { src: 'node_modules/monaco-editor/LICENSE', dest: 'assets/monaco', rename: { stripBase: 2 } },
  { src: 'node_modules/monaco-editor/ThirdPartyNotices.txt', dest: 'assets/monaco', rename: { stripBase: 2 } },
  ...[
    'editor/**/*',
    'loader.js',
    'nls.messages-loader.js',
    'monaco.contribution*.js',
    'editor-*.js',
    'index-*.js',
    '*.worker-*.js',
    'shell-*.js',
    'editorWorkerHost-*.js',
    'toggleHighContrast-*.js',
    'workers*.js',
    'jsonMode-*.js',
    'main-*.js',
    'lspLanguageFeatures*.js',
    'assets/editor.worker*.js',
    'assets/json.worker*.js',
    'basic-languages/monaco.contribution.js',
  ].map(glob => ({ src: `${monacoVs}/${glob}`, dest: vsDest, rename: { stripBase: 4 } })),
]

// The manifest and bundles are fetched with the refresh cookie, so the tags
// need `crossorigin="use-credentials"` (Angular's `crossOrigin` build option).
function crossOriginUseCredentials(): Plugin {
  return {
    name: 'crossorigin-use-credentials',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: html => html.replace(/\scrossorigin(?:="[^"]*")?(?=[\s>])/g, ' crossorigin="use-credentials"'),
    },
  }
}

export default defineConfig({
  // Relative asset URLs, so the UI also works behind a reverse proxy subpath.
  base: './',
  publicDir: 'static',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/@homebridge/plugin-ui-utils/dist/ui.js*', dest: 'assets/plugin-ui-utils', rename: { stripBase: 4 } },
        ...monacoTargets,
      ],
    }),
    crossOriginUseCredentials(),
  ],
  resolve: {
    alias: {
      '@fa-webfonts': fileURLToPath(new URL('./node_modules/@fortawesome/fontawesome-free/webfonts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        loadPaths: ['./node_modules'],
        silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'if-function'],
      },
    },
  },
  // The backend only allows dev CORS and plugin custom UIs from :4200/:8080
  // (src/core/regex.constants.ts), so the dev server must stay on 4200.
  server: {
    host: '0.0.0.0',
    port: 4200,
    strictPort: true,
    // Plugin custom-UI iframes are served from the backend origin (:8581) and
    // fetch fonts from this dev server with CORS, also over a LAN IP.
    cors: true,
    fs: {
      // The default (the workspace root), plus wherever node_modules really
      // is: a git worktree that symlinks it to the main checkout would
      // otherwise be refused `?inline` imports from it (Slider.tsx)
      allow: [
        searchForWorkspaceRoot(fileURLToPath(new URL('.', import.meta.url))),
        realpathSync(fileURLToPath(new URL('./node_modules', import.meta.url))),
      ],
    },
  },
  // Pre-bundled up front: discovering it on first load makes Vite re-optimise
  // and reload mid-render ("Invalid hook call").
  optimizeDeps: {
    include: ['@monaco-editor/react'],
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testing/setup.ts'],
    isolate: true,
    // Node 25+ ships its own localStorage, which hides jsdom's.
    execArgv: ['--no-experimental-webstorage'],
    coverage: {
      provider: 'v8',
      // Enforced on `--coverage` runs (CI runs one). About two points under
      // the levels measured without the golden corpus; raise them as coverage grows.
      thresholds: {
        statements: 83,
        branches: 72,
        functions: 85,
        lines: 83,
      },
    },
  },
})
