/**
 * Subsets the Font Awesome web fonts down to only the icons referenced in the
 * UI source, then overwrites the fonts inside the installed
 * `@fortawesome/fontawesome-free` package so the UI build bundles the
 * smaller files.
 *
 * It also writes `ui/src/scss/generated/_fa-icons.scss`, which narrows Font
 * Awesome's `$icons` / `$brand-icons` maps to the icons whose glyphs are in the
 * subset fonts, so the stylesheet carries a few hundred `.fa-<name>` rules
 * instead of ~2,000. Every name sharing a code point with a used icon is kept
 * (aliases such as `fa-home` / `fa-house`), so every class that has a glyph to
 * show still has its rule; a class without one rendered nothing visible before
 * either. Nothing else in the Font Awesome SCSS or in any template/component is
 * changed.
 *
 * The partial is committed, so `vite` dev works from a fresh clone without a
 * build first; `prebuild` regenerates it, and a changed icon set shows up as a
 * diff of that file. After adding an icon in dev, run this script (or a build).
 *
 * Runs automatically via the `prebuild` script in `ui/package.json`. It reads
 * the source fonts and writes the subset back to the same files; a fresh
 * `npm install` always restores the full fonts before this runs again.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const uiSrc = resolve(__dirname, '..', 'ui', 'src')
const uiRequire = createRequire(resolve(__dirname, '..', 'ui', 'package.json'))

// pathToFileURL: dynamic import() rejects bare Windows paths (e.g. `D:\...`).
const { fontawesomeSubset } = await import(
  pathToFileURL(uiRequire.resolve('fontawesome-subset')).href,
)
const faDir = dirname(uiRequire.resolve('@fortawesome/fontawesome-free/package.json'))
const faWebfontsDir = resolve(faDir, 'webfonts')
const iconsPartial = resolve(uiSrc, 'scss', 'generated', '_fa-icons.scss')

// Font Awesome utility / sizing / animation / layout classes — not glyphs.
const NON_GLYPH = new Set([
  'fw',
  'sm',
  'xs',
  'lg',
  'xl',
  '2xs',
  '2xl',
  '1x',
  '2x',
  '3x',
  '4x',
  '5x',
  '6x',
  '7x',
  '8x',
  '9x',
  '10x',
  'spin',
  'pulse',
  'spin-pulse',
  'spin-reverse',
  'beat',
  'fade',
  'beat-fade',
  'bounce',
  'shake',
  'flip',
  'border',
  'pull-left',
  'pull-right',
  'inverse',
  'stack',
  'stack-1x',
  'stack-2x',
  'li',
  'rotate-90',
  'rotate-180',
  'rotate-270',
  'rotate-by',
  'flip-horizontal',
  'flip-vertical',
  'flip-both',
  'sr-only',
  'sr-only-focusable',
  'solid',
  'regular',
  'brands',
  'classic',
  'sharp',
  'blank',
])

async function collectIconNames(dir, found) {
  for (const entry of await readdir(dir)) {
    const full = resolve(dir, entry)
    if ((await stat(full)).isDirectory()) {
      await collectIconNames(full, found)
      continue
    }
    // Specs mention font files and icons that never reach the shipped UI.
    if (!/\.(?:html|tsx?)$/.test(entry) || /\.(?:spec|test)\.tsx?$/.test(entry)) {
      continue
    }
    const content = await readFile(full, 'utf8')
    for (const match of content.matchAll(/\bfa-([a-z0-9]+(?:-[a-z0-9]+)*)/g)) {
      const name = match[1]
      if (!NON_GLYPH.has(name)) {
        found.add(name)
      }
    }
  }
}

function fileSize(path) {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

const icons = new Set()
await collectIconNames(uiSrc, icons)
const names = [...icons].sort()

/**
 * The icon maps of Font Awesome's `_variables.scss`: name -> `$var-<name>`, in
 * file order, plus the code point of every `$var-`.
 */
function readIconMaps() {
  const source = readFileSync(resolve(faDir, 'scss', '_variables.scss'), 'utf8')
  const codePoints = new Map()
  for (const match of source.matchAll(/^\$(var-[\w-]+):([^;]+);/gm)) {
    codePoints.set(match[1], match[2].trim())
  }
  const map = (name) => {
    const block = source.match(new RegExp(`^\\$${name}\\s*:\\s*\\(([\\s\\S]*?)^\\);`, 'm'))
    if (!block) {
      throw new Error(`[fa-subset] no $${name} map in @fortawesome/fontawesome-free/scss/_variables.scss`)
    }
    return [...block[1].matchAll(/^ *"([^"]+)": *\$(var-[\w-]+),?$/gm)].map(m => ({ name: m[1], variable: m[2] }))
  }
  return { codePoints, icons: map('icons'), brandIcons: map('brand-icons') }
}

/**
 * Write the partial that narrows the icon maps to the used glyphs. With no
 * icon referenced (the fonts are then kept whole) the maps are left alone.
 */
function writeIconsPartial(used) {
  const { codePoints, icons: allIcons, brandIcons } = readIconMaps()
  const narrow = (entries) => {
    const usedCodePoints = new Set(entries.filter(e => used.has(e.name)).map(e => codePoints.get(e.variable)))
    return entries.filter(e => usedCodePoints.has(codePoints.get(e.variable)))
  }
  const mapOf = (variable, entries) => [
    `fa-vars.$${variable}: (`,
    ...entries.map(e => `  '${e.name}': fa-vars.$${e.variable},`),
    ');',
  ].join('\n')

  const header = [
    '// Generated by scripts/fontawesome-subset.mjs (run by the ui `prebuild`) - do not edit.',
    '// Narrows Font Awesome\'s icon maps to the icons the UI references, so only',
    '// their `.fa-<name>` rules reach the stylesheet. Committed so `vite` dev',
    '// works without a build; re-run the script after adding an icon.',
    '@use \'@fortawesome/fontawesome-free/scss/variables\' as fa-vars;',
    '',
  ]
  const body = used.size
    ? [mapOf('icons', narrow(allIcons)), '', mapOf('brand-icons', narrow(brandIcons)), '']
    : ['// No icon referenced: the full maps are kept.', '']
  const content = [...header, ...body].join('\n')

  mkdirSync(dirname(iconsPartial), { recursive: true })
  const previous = existsSync(iconsPartial) ? readFileSync(iconsPartial, 'utf8') : null
  if (previous !== content) {
    writeFileSync(iconsPartial, content)
  }
  const kept = used.size ? narrow(allIcons).length + narrow(brandIcons).length : allIcons.length + brandIcons.length
  console.log(`[fa-subset] icon rules: ${kept} of ${allIcons.length + brandIcons.length}${previous === content ? ' (unchanged)' : ''}`)
}

writeIconsPartial(new Set(names))

// `--css-only` regenerates the partial without touching the fonts (quick, for dev)
if (process.argv.includes('--css-only')) {
  process.exit(0)
}

const fonts = ['fa-solid-900.woff2', 'fa-regular-400.woff2', 'fa-brands-400.woff2']

// fontawesome-subset reads its source fonts from the same webfonts folder it
// writes the subset into, so after one build those files only hold the icons
// that were used then: an icon added later could never come back, and showed
// as an empty box until the package was reinstalled. Keep a pristine copy the
// first time this runs after an install (a reinstall replaces the package
// folder, copy included) and always subset from that copy.
const pristineDir = resolve(faWebfontsDir, '.pristine')
if (!existsSync(pristineDir)) {
  mkdirSync(pristineDir)
  for (const f of fonts) {
    copyFileSync(resolve(faWebfontsDir, f), resolve(pristineDir, f))
  }
}
for (const f of fonts) {
  copyFileSync(resolve(pristineDir, f), resolve(faWebfontsDir, f))
}

const before = Object.fromEntries(
  fonts.map(f => [f, fileSize(resolve(faWebfontsDir, f))]),
)

// Feed the same name list to every family; fontawesome-subset only emits an
// icon into a family's font if that family actually contains it, and silently
// skips the rest — so over-inclusion is safe and guarantees no missing glyph.
// A font subset to zero glyphs fails to decode ("cmap: No subtables") and
// blanks every icon, so keep the full fonts until the UI references some.
if (names.length === 0) {
  console.log(`[fa-subset] no icon names referenced in ui/src — keeping the full fonts`)
  process.exit(0)
}

await fontawesomeSubset(
  { solid: names, regular: names, brands: names },
  faWebfontsDir,
)

const kib = n => `${(n / 1024).toFixed(1)} KiB`
console.log(`[fa-subset] ${names.length} icon names referenced in ui/src`)
for (const f of fonts) {
  const b = before[f]
  const a = fileSize(resolve(faWebfontsDir, f))
  console.log(`[fa-subset] ${f}: ${kib(b)} -> ${kib(a)}`)
}
