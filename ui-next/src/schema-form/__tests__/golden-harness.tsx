/**
 * Replays a golden recording (see __corpus__/README.md, and the Angular
 * recorder in ui/src/app/core/components/schema-form/schema-form.golden-recorder.spec.ts)
 * against the React `<SchemaForm>`. The DOM queries, step operations, uuid
 * scrubbing and visibility rules mirror the recorder's exactly.
 */
import fs from 'node:fs'
import path from 'node:path'

import { act, cleanup, render } from '@testing-library/react'
import { isEqual } from 'lodash-es'

import { SchemaForm } from '../SchemaForm'

export type Step
  = | { op: 'type', index: number, value: string | number }
    | { op: 'toggle', index: number }
    | { op: 'select', index: number, value: string }
    | { op: 'radio', index: number }
    | { op: 'add', index: number }
    | { op: 'remove', index: number, list?: number, item?: number }

export interface Snapshot {
  data: any
  isValid: boolean | null
  controls: Record<'text' | 'number' | 'textarea' | 'checkbox' | 'radio' | 'select' | 'add' | 'remove', number>
  labels: string[]
}

export interface Golden {
  plugin: string
  version: string
  initialData: any
  steps?: Step[]
  snapshots?: Snapshot[]
  error?: string
}

export interface Mismatch {
  snapshot: number
  /** The step that led to this snapshot (undefined for the initial render) */
  step?: Step
  field: 'data' | 'isValid' | 'controls' | 'labels' | 'replay'
  expected: unknown
  actual: unknown
}

/** The recorder's settle time; `GOLDEN_SETTLE_MS` overrides it for goldens recorded with a longer one */
const SETTLE_MS = Number(process.env.GOLDEN_SETTLE_MS || 120)
const TEXT_TYPES = new Set(['text', 'email', 'url', 'password'])
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const ADD_SELECTOR = 'add-reference-widget button'
const REMOVE_SELECTOR = 'button.btn-close'

/** `npm test --prefix ui-next` runs from ui-next/; also accept the repo root */
function findCorpusDir() {
  let dir = process.cwd()
  for (;;) {
    for (const candidate of [path.join(dir, 'src/schema-form/__corpus__'), path.join(dir, 'ui-next/src/schema-form/__corpus__')]) {
      if (fs.existsSync(path.join(candidate, 'README.md'))) {
        return candidate
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      return path.join(process.cwd(), 'src/schema-form/__corpus__')
    }
    dir = parent
  }
}

export const corpusDir = findCorpusDir()

export function schemaFileName(plugin: string) {
  return `${plugin.replace(/\//g, '__')}.json`
}

/** Goldens that have a matching schema file (both folders may still be filling up) */
export function loadCorpus(): { golden: Golden, schemaFile: any }[] {
  // `GOLDEN_DIR` points at an alternative set of recordings (same format)
  const goldensDir = process.env.GOLDEN_DIR || path.join(corpusDir, 'goldens')
  const schemasDir = path.join(corpusDir, 'schemas')
  if (!fs.existsSync(goldensDir) || !fs.existsSync(schemasDir)) {
    return []
  }
  return fs.readdirSync(goldensDir)
    .filter(file => file.endsWith('.json') && fs.existsSync(path.join(schemasDir, file)))
    .sort()
    .flatMap((file) => {
      try {
        return [{
          golden: JSON.parse(fs.readFileSync(path.join(goldensDir, file), 'utf8')) as Golden,
          schemaFile: JSON.parse(fs.readFileSync(path.join(schemasDir, file), 'utf8')),
        }]
      } catch {
        // A file the recorder is still writing
        return []
      }
    })
}

export function scrubUuids(value: any): any {
  if (typeof value === 'string') {
    return value.replace(UUID_RE, '<uuid>')
  }
  if (Array.isArray(value)) {
    return value.map(scrubUuids)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = scrubUuids(v)
    }
    return out
  }
  return value
}

/**
 * The recorder ran with Angular's component styles in the document, so a
 * tab panel's `.ngf-hidden` was `display: none`. jsdom does not load the
 * React port's stylesheet, so the rules that affect visibility are added here.
 */
const VISIBILITY_CSS = 'tabs-widget .ngf-hidden { display: none; } .btn-close > span:first-child { display: none; }'

export function installVisibilityStyles() {
  const style = document.createElement('style')
  style.textContent = VISIBILITY_CSS
  document.head.appendChild(style)
  return () => style.remove()
}

function isVisible(el: Element, root: Element): boolean {
  for (let node: Element | null = el; node && node !== root.parentElement; node = node.parentElement) {
    const h = node as HTMLElement
    if (h.hidden || h.style?.display === 'none' || getComputedStyle(h).display === 'none') {
      return false
    }
  }
  return true
}

function textLikeControls(root: HTMLElement): (HTMLInputElement | HTMLTextAreaElement)[] {
  return Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    .filter(el => el.tagName === 'TEXTAREA' || TEXT_TYPES.has(el.type) || el.type === 'number')
}

const checkboxes = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
const radios = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLInputElement>('input[type=radio]'))
const selects = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLSelectElement>('select'))
const addButtons = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>(ADD_SELECTOR))
const removeButtons = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>(REMOVE_SELECTOR))

/** The remove button of widget `item` in the form's `list`th widget container (the recorder's `removeTarget`) */
function removeButtonOf(root: HTMLElement, list: number, item: number): HTMLButtonElement | undefined {
  const containers = [...new Set(Array.from(root.querySelectorAll('select-framework-widget'), widget => widget.parentElement!))]
  const widget = Array.from(containers[list]?.children ?? []).filter(child => child.tagName === 'SELECT-FRAMEWORK-WIDGET')[item]
  return removeButtons(root).find(button => button.closest('select-framework-widget') === widget)
}

function countControls(root: HTMLElement): Snapshot['controls'] {
  const textLike = textLikeControls(root)
  return {
    text: textLike.filter(el => el.tagName === 'INPUT' && TEXT_TYPES.has(el.type)).length,
    number: textLike.filter(el => el.tagName === 'INPUT' && el.type === 'number').length,
    textarea: textLike.filter(el => el.tagName === 'TEXTAREA').length,
    checkbox: checkboxes(root).length,
    radio: radios(root).length,
    select: selects(root).length,
    add: addButtons(root).length,
    remove: removeButtons(root).length,
  }
}

function visibleLabels(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('label, legend'))
    .filter(el => isVisible(el, root))
    .map(el => (el.textContent ?? '').trim().replace(/\s*\*$/, '').trim())
}

function applyStep(root: HTMLElement, step: Step) {
  switch (step.op) {
    case 'type': {
      const el = textLikeControls(root)[step.index]
      el.value = String(step.value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      break
    }
    case 'toggle':
      checkboxes(root)[step.index].click()
      break
    case 'radio':
      radios(root)[step.index].click()
      break
    case 'select': {
      const el = selects(root)[step.index]
      el.value = step.value
      el.dispatchEvent(new Event('change', { bubbles: true }))
      break
    }
    case 'add':
      addButtons(root)[step.index].click()
      break
    case 'remove':
      removeButtons(root)[step.index].click()
      break
  }
}

/**
 * The recorder's settle (detectChanges, 120 ms, detectChanges). React only
 * flushes renders when an `act()` scope ends, so time passes in short scopes,
 * the way a browser renders between timers.
 */
async function settle() {
  const end = Date.now() + SETTLE_MS
  do {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, Math.min(5, Math.max(0, end - Date.now()))))
    })
  } while (Date.now() < end)
}

/** Replay one golden and return every difference found */
function valueAt(value: any, path: string[]): any {
  let current = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = current[key]
  }
  return current
}

/** The paths (leaf-most) where two JSON values differ */
function diffPaths(a: any, b: any, path: string[] = []): string[][] {
  if (isEqual(a, b)) {
    return []
  }
  const bothObjects = a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)
  if (!bothObjects || (Array.isArray(a) && a.length !== b.length)) {
    return [path]
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].flatMap(key => diffPaths(a[key], b[key], [...path, key]))
}

/**
 * Was this difference only a matter of timing? The recorder snapshots 120 ms
 * after each step, which on big schemas is before ng-formworks' own cascade
 * (debounced validation -> condition re-render -> widget init/destroy ->
 * debounced validation...) has settled. When the value one side shows at
 * snapshot i is what the other side shows one snapshot later, the two forms
 * did the same thing at a different speed.
 */
function isTimingDifference(field: Exclude<Mismatch['field'], 'replay'>, index: number, expected: Snapshot[], actual: Snapshot[]) {
  const sameAt = (x: any, y: any) => {
    if (field !== 'data') {
      return isEqual(x, y)
    }
    const paths = diffPaths(expected[index].data, actual[index].data)
    return paths.length > 0 && paths.every(path => isEqual(valueAt(x, path), valueAt(y, path)))
  }
  // Angular was slower: it shows React's value at the next snapshot
  if (index + 1 < expected.length && sameAt(expected[index + 1][field], actual[index][field])) {
    return true
  }
  // React was slower: it shows Angular's value at the next snapshot
  if (index + 1 < actual.length && sameAt(actual[index + 1][field], expected[index][field])) {
    return true
  }
  return false
}

export interface ReplayResult {
  /** Differences that point at a behaviour difference */
  mismatches: Mismatch[]
  /** Differences explained by timing or by a known Angular rendering quirk */
  tolerated: (Mismatch & { reason: 'timing' | 'angular-late-remove-button' })[]
}

/** Replay one golden and return every difference found */
export async function replayGolden(golden: Golden, schemaFile: any): Promise<ReplayResult> {
  const mismatches: Mismatch[] = []
  const tolerated: ReplayResult['tolerated'] = []
  let lastData: any
  let hasData = false
  let lastValid: boolean | null = null

  const configSchema = {
    schema: schemaFile.schema,
    layout: schemaFile.layout,
    form: schemaFile.form,
    uiSchema: schemaFile.uiSchema,
    fixArrays: schemaFile.fixArrays,
  }

  const result = render(
    <SchemaForm
      configSchema={configSchema}
      data={structuredClone(golden.initialData ?? {})}
      lang="en"
      onDataChange={(value) => {
        lastData = value
        hasData = true
      }}
      onValidChange={(value) => {
        lastValid = value
      }}
    />,
  )
  const root = result.container as HTMLElement

  const snapshot = (): Snapshot => ({
    data: hasData ? scrubUuids(JSON.parse(JSON.stringify(lastData ?? null))) : null,
    isValid: lastValid,
    controls: countControls(root),
    labels: visibleLabels(root),
  })

  const expected = golden.snapshots!
  const actual: Snapshot[] = []
  const steps = golden.steps ?? []
  const stepOf = (index: number) => (index > 0 ? steps[index - 1] : undefined)

  try {
    await settle()
    actual.push(snapshot())

    // A remove step clicks the button of the array item the recorder removed
    // (`list`/`item`), not the nth button: ng-formworks renders the remove
    // button of an array's initial items late (see
    // `angular-late-remove-button`), so the raw indexes point at different
    // items here. Goldens without a target follow the recorder's policy: the
    // remove buttons that appeared with the items it added, last first.
    let removeBefore: Set<HTMLButtonElement> | null = null
    let appeared: HTMLButtonElement[] | null = null
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      try {
        if (step.op === 'add' && !removeBefore) {
          removeBefore = new Set(removeButtons(root))
        }
        let target: Step = step
        if (step.op === 'remove' && step.list !== undefined && step.item !== undefined) {
          const index = removeButtons(root).indexOf(removeButtonOf(root, step.list, step.item)!)
          target = { op: 'remove', index: index === -1 ? step.index : index }
        } else if (step.op === 'remove') {
          appeared ??= removeButtons(root).filter(b => !removeBefore?.has(b)).slice(0, 3).reverse()
          let button = appeared.shift()
          while (button && !button.isConnected) {
            button = appeared.shift()
          }
          const index = button ? removeButtons(root).indexOf(button) : -1
          target = { op: 'remove', index: index === -1 ? step.index : index }
        }
        await act(async () => {
          applyStep(root, target)
        })
      } catch (error) {
        mismatches.push({ snapshot: i + 1, step, field: 'replay', expected: 'step applied', actual: String(error) })
        break
      }
      await settle()
      actual.push(snapshot())
    }
  } finally {
    cleanup()
  }

  for (let index = 0; index < actual.length; index++) {
    for (const field of ['data', 'isValid', 'controls', 'labels'] as const) {
      if (isEqual(expected[index][field], actual[index][field])) {
        continue
      }
      const mismatch: Mismatch = { snapshot: index, step: stepOf(index), field, expected: expected[index][field], actual: actual[index][field] }
      if (field === 'controls') {
        const e = expected[index].controls
        const a = actual[index].controls
        const onlyRemove = Object.keys(e).every(key => key === 'remove' || e[key as keyof typeof e] === a[key as keyof typeof a])
        if (onlyRemove && a.remove > e.remove) {
          tolerated.push({ ...mismatch, reason: 'angular-late-remove-button' })
          continue
        }
      }
      if (isTimingDifference(field, index, expected, actual)) {
        tolerated.push({ ...mismatch, reason: 'timing' })
        continue
      }
      mismatches.push(mismatch)
    }
  }
  return { mismatches, tolerated }
}
