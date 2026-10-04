/**
 * Untranslated keys report.
 *
 * `npm run lang-sync` copies every new English string into the other locales, so a
 * missing translation looks like a translated one. This lists, per locale, the keys
 * whose value is still exactly the English value.
 *
 * Not reported:
 * - values with no letters once `{{ placeholders }}` are removed (`{{ min }} – {{ max }}`);
 * - values, keys and per-locale keys in scripts/i18n-allowlist.json (brand names and
 *   words that are the same in that language).
 *
 * Usage:
 *   npm run i18n:report                     # one summary line per locale
 *   npm run i18n:report -- --keys           # also list the keys
 *   npm run i18n:report -- --locale fr      # only French (implies --keys)
 *   npm run i18n:report -- --json           # machine-readable { locale: [keys] }
 *   npm run i18n:report -- --since origin/main
 *       only keys added to en.json since that git ref (what a pull request adds)
 *
 * It never fails: it is a report for translators, printed on CI.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const i18nDir = resolve(root, 'ui/src/i18n')

interface Allowlist {
  values?: string[]
  keys?: string[]
  locales?: Record<string, string[]>
}

type Strings = Record<string, string>

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

/** True when the string has no letters outside its `{{ placeholders }}` */
function hasNoWords(value: string): boolean {
  return !/\p{L}/u.test(value.replace(/\{\{[^}]*\}\}/g, ''))
}

function untranslatedKeys(en: Strings, locale: Strings, allowed: Set<string>, allowedValues: Set<string>, onlyKeys?: Set<string>): string[] {
  return Object.keys(en).filter(key =>
    (!onlyKeys || onlyKeys.has(key))
    && locale[key] === en[key]
    && !allowed.has(key)
    && !allowedValues.has(en[key])
    && !hasNoWords(en[key]),
  )
}

/** The en.json keys added since a git ref (empty when the ref or file is unknown there) */
function keysAddedSince(ref: string, en: Strings): Set<string> {
  let before: Strings = {}
  try {
    before = JSON.parse(execFileSync('git', ['show', `${ref}:ui/src/i18n/en.json`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch {
    console.warn(`Could not read ui/src/i18n/en.json at ${ref}; reporting every key.`)
    return new Set(Object.keys(en))
  }
  return new Set(Object.keys(en).filter(key => !Object.hasOwn(before, key)))
}

function main() {
  const args = process.argv.slice(2)
  const option = (name: string) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }
  const onlyLocale = option('--locale')
  const since = option('--since')
  const json = args.includes('--json')
  const listKeys = args.includes('--keys') || !!onlyLocale

  const en = readJson<Strings>(resolve(i18nDir, 'en.json'))
  const allowlist = readJson<Allowlist>(resolve(root, 'scripts/i18n-allowlist.json'))
  const allowedValues = new Set(allowlist.values ?? [])
  const onlyKeys = since ? keysAddedSince(since, en) : undefined

  const locales = readdirSync(i18nDir)
    .filter(file => file.endsWith('.json') && file !== 'en.json')
    .map(file => file.replace(/\.json$/, ''))
    .filter(locale => !onlyLocale || locale === onlyLocale)
    .sort()

  if (onlyLocale && !locales.length) {
    console.error(`No locale ${onlyLocale} in ui/src/i18n.`)
    return
  }

  const report: Record<string, string[]> = {}
  for (const locale of locales) {
    const strings = readJson<Strings>(resolve(i18nDir, `${locale}.json`))
    const allowed = new Set([...(allowlist.keys ?? []), ...(allowlist.locales?.[locale] ?? [])])
    report[locale] = untranslatedKeys(en, strings, allowed, allowedValues, onlyKeys)
  }

  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  const total = onlyKeys ? onlyKeys.size : Object.keys(en).length
  console.log(since
    ? `Keys added since ${since} that are still in English (${total} new keys):`
    : `Keys still in English, per locale (out of ${total}):`)
  const width = Math.max(...locales.map(locale => locale.length))
  for (const locale of locales) {
    const count = report[locale].length
    const percent = total ? Math.round((100 * (total - count)) / total) : 100
    console.log(`  ${locale.padEnd(width)}  ${String(count).padStart(5)} untranslated  (${percent}% translated)`)
    if (listKeys) {
      for (const key of report[locale]) {
        console.log(`      ${key}: ${JSON.stringify(en[key])}`)
      }
    }
  }
  if (!listKeys) {
    console.log('\nList the keys with --keys, or --locale <code> for one language.')
  }
}

main()
