#!/usr/bin/env node
/* eslint-disable no-console -- a command-line report */
// Groups the golden parity failures by root cause, from the reports the golden
// suite writes to $TMPDIR/schema-form-golden-report.<shard>.json.
//
//   node src/schema-form/__tests__/golden-categories.mjs [--list]
//
// A plugin's category is the field (and op) of its FIRST diverging snapshot;
// later mismatches usually follow from it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = os.tmpdir()
const report = {}
for (const file of fs.readdirSync(dir).filter(f => /^schema-form-golden-report\.\d+\.json$/.test(f))) {
  Object.assign(report, JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
}

const status = {}
const categories = {}
const tolerated = {}
for (const [plugin, entry] of Object.entries(report)) {
  status[entry.status] = (status[entry.status] ?? 0) + 1
  for (const t of entry.tolerated ?? []) {
    const key = `${t.reason}:${t.field}`
    tolerated[key] = (tolerated[key] ?? 0) + 1
  }
  if (!entry.mismatches?.length) {
    continue
  }
  const first = entry.mismatches[0]
  let field = first.field
  if (field === 'controls') {
    const changed = Object.keys(first.expected).filter(k => first.expected[k] !== first.actual[k])
    field = `controls.${changed.join('+')}`
  }
  const key = `${field} @ ${first.snapshot === 0 ? 'init' : first.step?.op}`
  ;(categories[key] ??= []).push(plugin)
}

console.log('status', status)
console.log('tolerated', tolerated)
console.log('\ncategory (first diverging snapshot)'.padEnd(46), 'count')
for (const [key, plugins] of Object.entries(categories).sort((a, b) => b[1].length - a[1].length)) {
  console.log(key.padEnd(45), String(plugins.length).padStart(5))
  if (process.argv.includes('--list')) {
    for (const plugin of plugins) {
      console.log(`    ${plugin}`)
    }
  }
}
