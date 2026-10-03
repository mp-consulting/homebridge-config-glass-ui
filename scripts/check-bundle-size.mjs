/**
 * Fails when the UI's initial download grows past its budget: the scripts,
 * module preloads and stylesheets index.html loads before the first render
 * (what /login costs). Lazy route chunks don't count.
 *
 *   node scripts/check-bundle-size.mjs [public dir] [--budget 1600]   (kB)
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const budgetIndex = args.indexOf('--budget')
const budgetKb = budgetIndex === -1 ? 1600 : Number(args[budgetIndex + 1])
const publicDir = resolve(repoRoot, args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--budget') ?? 'public')

const html = readFileSync(resolve(publicDir, 'index.html'), 'utf8')
const files = new Set()
for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
  files.add(src)
}
for (const [tag] of html.matchAll(/<link[^>]*>/g)) {
  if (/rel="(?:modulepreload|stylesheet)"/.test(tag)) {
    files.add(tag.match(/href="([^"]+)"/)[1])
  }
}

let total = 0
for (const file of files) {
  const size = statSync(resolve(publicDir, file.replace(/^\.?\//, ''))).size
  total += size
  console.warn(`${(size / 1024).toFixed(1).padStart(8)} kB  ${file}`)
}
const totalKb = total / 1024
console.warn(`${totalKb.toFixed(1).padStart(8)} kB  initial total (budget ${budgetKb} kB)`)
if (totalKb > budgetKb) {
  console.error(`[bundle] initial download is over budget by ${(totalKb - budgetKb).toFixed(1)} kB`)
  process.exitCode = 1
}
