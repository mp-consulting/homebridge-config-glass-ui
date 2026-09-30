import type { TestProject } from 'vitest/node'

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { remove } from 'fs-extra'

/**
 * Create the root directory that holds each spec file's private storage
 * directory (see `test/storage-path.ts`) and remove it after the run.
 *
 * Specs never touch `test/.homebridge`, which is the directory a developer's
 * `npm run watch` runs against, so running the suite leaves the dev auth file,
 * secrets and other live state alone.
 */

let storageRoot: string | undefined

export async function setup(project: TestProject): Promise<void> {
  // realpath: macOS tmpdir() is under the /var -> /private/var symlink, and the
  // services compare against resolved paths
  storageRoot = realpathSync(mkdtempSync(join(tmpdir(), 'uix-test-storage-')))
  project.provide('testStorageRoot', storageRoot)
}

export async function teardown(): Promise<void> {
  if (storageRoot) {
    await remove(storageRoot)
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    testStorageRoot: string
  }
}
