import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'

import { inject } from 'vitest'

/**
 * A fresh storage directory for the current spec file.
 *
 * Spec files run in parallel, and every one of them seeds auth.json,
 * .uix-secrets, config.json, plugins, ... into its UIX_STORAGE_PATH. Giving each
 * file its own directory keeps them from clobbering each other. The directories
 * live under a root created (and removed) by `test/global-setup.ts`.
 */
export const testStoragePath = mkdtempSync(join(inject('testStorageRoot'), 'storage-'))
