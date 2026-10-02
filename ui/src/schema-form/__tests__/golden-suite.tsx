import type { Mismatch, ReplayResult } from './golden-harness'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { installVisibilityStyles, loadCorpus, replayGolden } from './golden-harness'
import knownDifferences from './golden-known-differences.json'

export const GOLDEN_SHARDS = 4

interface Entry { status: 'pass' | 'fail' | 'known' | 'skipped', mismatches?: Mismatch[], tolerated?: ReplayResult['tolerated'], reason?: string }

/**
 * Plugins whose replay still differs from the Angular recording, with the
 * reason. They are replayed and reported but not asserted; every other
 * plugin must match. Remove an entry once its plugin matches.
 */
const KNOWN: Record<string, string> = knownDifferences

/**
 * Parity with the Angular form: replays every golden recording in
 * __corpus__/goldens/ that has its schema in __corpus__/schemas/ (see the
 * README there) and compares each snapshot - emitted data, validity, control
 * counts and visible labels. Split into shards so vitest runs them in
 * parallel.
 *
 * Skips when the corpus has not been fetched/recorded. Env:
 * - `GOLDEN_ONLY=<substring>[,<substring>...]` limits the run to matching plugins;
 * - a JSON report per shard is written to `$TMPDIR/schema-form-golden-report.<shard>.json`.
 */
export function defineGoldenSuite(shard: number) {
  const only = process.env.GOLDEN_ONLY?.split(',').filter(Boolean)
  const corpus = loadCorpus()
    .filter((_, i) => i % GOLDEN_SHARDS === shard)
    .filter(({ golden }) => !only || only.some(part => golden.plugin.includes(part)))
  const report: Record<string, Entry> = {}

  describe.skipIf(corpus.length === 0)(`schemaForm golden parity (shard ${shard + 1}/${GOLDEN_SHARDS})`, () => {
    let removeStyles: () => void
    beforeAll(() => {
      removeStyles = installVisibilityStyles()
    })
    afterAll(() => {
      removeStyles?.()
      const file = path.join(os.tmpdir(), `schema-form-golden-report.${shard}.json`)
      fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
      const counts = Object.values(report).reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1
        return acc
      }, {})
      console.warn(`[golden] shard ${shard + 1}: ${JSON.stringify(counts)} - report: ${file}`)
    })

    for (const { golden, schemaFile } of corpus) {
      if (golden.error || !golden.snapshots?.length) {
        // The Angular form itself failed on this schema: nothing to compare
        it.skip(`${golden.plugin}@${golden.version} (Angular recording failed: ${golden.error})`, () => {})
        report[golden.plugin] = { status: 'skipped', reason: golden.error }
        continue
      }
      const known = KNOWN[golden.plugin]
      it(`${golden.plugin}@${golden.version}${known ? ' (known difference)' : ''}`, async () => {
        const { mismatches, tolerated } = await replayGolden(golden, schemaFile)
        report[golden.plugin] = mismatches.length
          ? { status: known ? 'known' : 'fail', mismatches, tolerated, reason: known }
          : { status: 'pass', tolerated }
        if (!known) {
          expect(mismatches).toEqual([])
        }
      }, 300_000)
    }
  })
}
