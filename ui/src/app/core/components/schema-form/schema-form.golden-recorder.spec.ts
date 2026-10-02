import type { ComponentFixture } from '@angular/core/testing'

import { ErrorHandler, importProvidersFrom } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { Bootstrap5FrameworkModule } from '@ng-formworks/bootstrap5'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { SchemaFormComponent } from '@/app/core/components/schema-form/schema-form.component'
import { makeSettings } from '@/testing'
import { provideFakes, provideTestTranslate } from '@/testing/providers'

/**
 * Records the golden corpus for the React port of the schema form.
 *
 * NOT a regular test: it is skipped unless `RECORD_SCHEMA_GOLDENS=1`. It
 * renders every schema in `ui-next/src/schema-form/__corpus__/schemas/`
 * through the real `SchemaFormComponent` (real ng-formworks, real Bootstrap 5
 * framework, real `jsfPatch` directive), drives it with the deterministic
 * step policy from the corpus README, and writes `goldens/<plugin>.json`.
 * The README is the contract with the React replayer - keep both in sync.
 *
 *     node scripts/schema-corpus/fetch.mjs --from-manifest
 *     RECORD_SCHEMA_GOLDENS=1 npm test --prefix ui -- --include src/app/core/components/schema-form/schema-form.golden-recorder.spec.ts
 *
 * `RECORD_SCHEMA_GOLDENS_ONLY=<substring>` limits the run to matching plugins.
 *
 * The spec is bundled by the Angular builder for a browser target, so Node's
 * `fs`/`path` are reached through `process.getBuiltinModule` rather than
 * imports the bundler would try to resolve.
 */

type Step
  = | { op: 'type', index: number, value: string | number }
    | { op: 'toggle', index: number }
    | { op: 'select', index: number, value: string }
    | { op: 'radio', index: number }
    | { op: 'add', index: number }
    // `list` and `item` say which array item the button removes: the array's
    // position among the form's `.cdk-drop-list`s and the item's among that
    // list's `.cdk-drag` children. A replayer clicks that item's button rather
    // than the nth one: ng-formworks shows the remove button of an array's
    // initial items only once the array changes, so the nth button differs.
    | { op: 'remove', index: number, list?: number, item?: number }

interface Snapshot {
  data: any
  isValid: boolean | null
  controls: Record<'text' | 'number' | 'textarea' | 'checkbox' | 'radio' | 'select' | 'add' | 'remove', number>
  labels: string[]
}

const proc = (globalThis as any).process
const RECORD = proc?.env?.RECORD_SCHEMA_GOLDENS === '1'

const MAX_STEPS = 12
/** Minimum wait after a step: the contract's 100 ms (50 ms isValid debounce plus microtasks) with margin */
const SETTLE_MS = 120
/** Then wait for every pending app timer to run, and no emission for this long */
const QUIET_MS = 60
/** Give up waiting (a plugin form with a long-lived interval would never drain) */
const SETTLE_MAX_MS = 10_000
const TEXT_TYPES = new Set(['text', 'email', 'url', 'password'])
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

const ADD_SELECTOR = 'add-reference-widget button'
const REMOVE_SELECTOR = 'button.btn-close'

interface CorpusFs {
  fs: typeof import('node:fs')
  path: typeof import('node:path')
  corpusDir: string
}

function corpusFs(): CorpusFs {
  const fs = proc.getBuiltinModule('node:fs') as typeof import('node:fs')
  const path = proc.getBuiltinModule('node:path') as typeof import('node:path')

  // `npm test --prefix ui` runs from ui/, but walk up so any cwd inside the repo works
  let dir: string = proc.cwd()
  for (;;) {
    const candidate = path.join(dir, 'ui-next/src/schema-form/__corpus__')
    if (fs.existsSync(path.join(candidate, 'manifest.json'))) {
      return { fs, path, corpusDir: candidate }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error('Could not find ui-next/src/schema-form/__corpus__/manifest.json above the cwd')
    }
    dir = parent
  }
}

/** Straight to stdout: the test builder hides console output of passing tests */
function note(message: string) {
  proc.stdout.write(`[golden] ${message}\n`)
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n')[0]
}

function schemaFileName(plugin: string) {
  return `${plugin.replace(/\//g, '__')}.json`
}

function scrubUuids(value: any): any {
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

/** Not inside an element with display:none or the hidden attribute */
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

/** Which array item a remove button belongs to (see the `remove` step) */
function removeTarget(root: HTMLElement, button: HTMLButtonElement): { list?: number, item?: number } {
  const item = button.closest('.cdk-drag')
  const list = item?.parentElement
  if (!item || !list?.classList.contains('cdk-drop-list')) {
    return {}
  }
  return {
    list: Array.from(root.querySelectorAll('.cdk-drop-list')).indexOf(list),
    item: Array.from(list.children).filter(child => child.classList.contains('cdk-drag')).indexOf(item),
  }
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

interface Recording {
  steps: Step[]
  snapshots: Snapshot[]
  /** Set when the form threw on the step after the last recorded one */
  stepError?: unknown
  /** Non-fatal errors the app would have logged */
  loggedErrors?: unknown[]
}

class StepFailed extends Error {
  constructor(public override cause: unknown, public recording: Recording) {
    super('step failed')
  }
}

/**
 * Errors the app would only log, not die on: those routed to the ErrorHandler
 * (event handlers, e.g. a remove button calling a missing `removeAt`) and
 * those thrown from ng-formworks' own timers (e.g. TabsComponent.ngOnInit run
 * by a deferred change detection), which would otherwise be uncaught
 * exceptions failing the whole run. In the browser the form keeps working
 * after both, so the recorder notes them and carries on. Only a synchronous
 * throw while rendering (error golden) or while applying a step (golden cut
 * short before that step) is treated as fatal.
 */
const errorSink: unknown[] = []

/**
 * Timers the app has scheduled and not yet run (or cleared). Settling waits
 * for this to drain: one step can start a chain of timers - an item removal
 * destroys widgets, each of which writes `null` from a setTimeout, which
 * restarts ng-formworks' 50 ms valueChanges debounce (an rxjs setInterval) -
 * and on a big form each link costs a slow change detection, so any fixed
 * wait was too short somewhere and recordings came out flaky.
 */
const pendingTimers = new Set<unknown>()

/** Where each pending timer was created, reported when a form never settles */
const timerOrigins = new Map<unknown, string>()
const callerStack = () => new Error('origin').stack?.split('\n').slice(3, 8).join(' <- ')

/** The real setTimeout, for the recorder's own waits (not tracked) */
let rawSetTimeout: typeof setTimeout = setTimeout

function installTimerCapture(): () => void {
  const g = globalThis as any
  const originals = {
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    setInterval: g.setInterval,
    clearInterval: g.clearInterval,
    queueMicrotask: g.queueMicrotask,
  }
  rawSetTimeout = originals.setTimeout

  const guard = (fn: unknown, onRun?: () => void) => typeof fn !== 'function'
    ? fn
    : function (this: unknown, ...args: unknown[]) {
      onRun?.()
      try {
        return fn.apply(this, args)
      } catch (error) {
        errorSink.push(error)
      }
    }

  g.setTimeout = (fn: unknown, ...rest: unknown[]) => {
    const timer: { id?: unknown } = {}
    timer.id = originals.setTimeout(guard(fn, () => pendingTimers.delete(timer.id)), ...rest)
    pendingTimers.add(timer.id)
    timerOrigins.set(timer.id, `timeout ${rest[0]} ${callerStack()}`)
    return timer.id
  }
  g.clearTimeout = (id: unknown) => {
    pendingTimers.delete(id)
    return originals.clearTimeout(id)
  }
  g.setInterval = (fn: unknown, ...rest: unknown[]) => {
    const id = originals.setInterval(guard(fn), ...rest)
    pendingTimers.add(id)
    timerOrigins.set(id, `interval ${rest[0]} ${callerStack()}`)
    return id
  }
  g.clearInterval = (id: unknown) => {
    pendingTimers.delete(id)
    return originals.clearInterval(id)
  }
  g.queueMicrotask = (fn: unknown) => originals.queueMicrotask(guard(fn))

  return () => {
    Object.assign(g, originals)
    rawSetTimeout = originals.setTimeout
  }
}

async function record(schemaFile: any): Promise<Recording> {
  errorSink.length = 0
  pendingTimers.clear()
  timerOrigins.clear()
  let settleTimeouts = 0

  TestBed.resetTestingModule()
  TestBed.configureTestingModule({
    imports: [SchemaFormComponent],
    providers: [
      provideTestTranslate(),
      provideFakes({ settings: makeSettings({ env: { lang: 'en' } }) }),
      importProvidersFrom(Bootstrap5FrameworkModule),
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => errorSink.push(error) } },
    ],
    rethrowApplicationErrors: false,
  })

  const fixture: ComponentFixture<SchemaFormComponent> = TestBed.createComponent(SchemaFormComponent)
  const component = fixture.componentInstance
  const root: HTMLElement = fixture.nativeElement

  // DOM mutations are deliberately not counted: the jsfPatch directive's
  // observer rewrites a11y attributes on every pass and never goes quiet
  let lastActivity = performance.now()

  let lastData: any
  let hasData = false
  let lastValid: boolean | null = null
  component.dataChange.subscribe((value) => {
    lastData = value
    hasData = true
    lastActivity = performance.now()
  })
  component.isValid.subscribe((value) => {
    lastValid = value
    lastActivity = performance.now()
  })

  const sleep = (ms: number) => new Promise(resolve => rawSetTimeout(resolve, ms))

  const settle = async () => {
    const start = performance.now()
    fixture.detectChanges()
    await sleep(SETTLE_MS)
    for (;;) {
      fixture.detectChanges()
      await fixture.whenStable()
      const now = performance.now()
      if (pendingTimers.size === 0 && now - lastActivity >= QUIET_MS) {
        break
      }
      if (now - start >= SETTLE_MAX_MS) {
        settleTimeouts++
        for (const id of pendingTimers) {
          note(String(timerOrigins.get(id)))
        }
        break
      }
      await sleep(20)
    }
  }

  const snapshot = (): Snapshot => ({
    // The component emits the same (mutated) object every time, so copy it now
    data: hasData ? scrubUuids(JSON.parse(JSON.stringify(lastData ?? null))) : null,
    isValid: lastValid,
    controls: countControls(root),
    labels: visibleLabels(root),
  })

  try {
    fixture.componentRef.setInput('configSchema', {
      schema: schemaFile.schema,
      layout: schemaFile.layout,
      form: schemaFile.form,
      uiSchema: schemaFile.uiSchema,
      fixArrays: schemaFile.fixArrays,
    })
    fixture.componentRef.setInput('data', {})
    await settle()

    const steps: Step[] = []
    const snapshots: Snapshot[] = [snapshot()]

    const run = async (step: Step) => {
      if (steps.length >= MAX_STEPS) {
        return
      }
      try {
        lastActivity = performance.now()
        applyStep(root, step)
        await settle()
      } catch (error) {
        // The form threw while handling this step: keep the steps that worked
        // and stop, since whatever comes next starts from a broken form
        throw new StepFailed(error, { steps, snapshots })
      }
      steps.push(step)
      snapshots.push(snapshot())
    }

    // 1. "golden" into the first text control, 7 into the first number control
    const textIndex = textLikeControls(root).findIndex(el => el.tagName === 'INPUT' && TEXT_TYPES.has(el.type))
    if (textIndex !== -1) {
      await run({ op: 'type', index: textIndex, value: 'golden' })
    }
    const numberIndex = textLikeControls(root).findIndex(el => el.tagName === 'INPUT' && el.type === 'number')
    if (numberIndex !== -1) {
      await run({ op: 'type', index: numberIndex, value: 7 })
    }

    // 2. toggle each checkbox once (first 4), re-querying since a toggle can reveal more
    for (let i = 0; i < 4; i++) {
      if (i < checkboxes(root).length) {
        await run({ op: 'toggle', index: i })
      }
    }

    // 3. the second option of each select (first 2)
    for (let i = 0; i < 2; i++) {
      const select = selects(root)[i]
      if (select && select.options.length >= 2) {
        await run({ op: 'select', index: i, value: select.options[1].value })
      }
    }

    // 4. each add button once (first 3)
    const removeBefore = new Set(removeButtons(root))
    for (let i = 0; i < 3; i++) {
      if (i < addButtons(root).length) {
        await run({ op: 'add', index: i })
      }
    }

    // 5. each remove button that appeared (first 3), last first so earlier
    //    indexes stay put; one removed along with its parent item is skipped
    const appeared = removeButtons(root).filter(b => !removeBefore.has(b)).slice(0, 3).reverse()
    for (const button of appeared) {
      const index = removeButtons(root).indexOf(button)
      if (index !== -1) {
        await run({ op: 'remove', index, ...removeTarget(root, button) })
      }
    }

    if (settleTimeouts) {
      note(`${settleTimeouts} settle(s) gave up after ${SETTLE_MAX_MS} ms with ${pendingTimers.size} timer(s) pending`)
    }
    return { steps, snapshots, loggedErrors: [...errorSink] }
  } catch (error) {
    if (error instanceof StepFailed) {
      return { ...error.recording, stepError: error.cause, loggedErrors: [...errorSink] }
    }
    throw error
  } finally {
    fixture.destroy()
  }
}

describe.skipIf(!RECORD)('schema-form golden recorder', () => {
  const corpus = RECORD ? corpusFs() : undefined
  const manifest: { plugin: string, version: string }[] = corpus
    ? JSON.parse(corpus.fs.readFileSync(corpus.path.join(corpus.corpusDir, 'manifest.json'), 'utf8'))
    : []

  let restoreTimers: (() => void) | undefined

  beforeAll(() => {
    restoreTimers = installTimerCapture()
  })

  afterAll(() => {
    restoreTimers?.()
  })

  // Optional substring filter, handy when debugging a single plugin.
  // RECORD_SCHEMA_GOLDENS_PLUGIN records exactly one plugin: formworks leaks
  // state between forms in one process, so scripts/schema-corpus/record.mjs
  // runs every plugin in its own process.
  const only: string | undefined = proc?.env?.RECORD_SCHEMA_GOLDENS_ONLY
  const exact: string | undefined = proc?.env?.RECORD_SCHEMA_GOLDENS_PLUGIN
  const selected = manifest.filter(m => exact ? m.plugin === exact : !only || m.plugin.includes(only))

  for (const { plugin, version } of selected) {
    it(`records ${plugin}@${version}`, async () => {
      const { fs, path, corpusDir } = corpus!
      const schemaFile = JSON.parse(fs.readFileSync(path.join(corpusDir, 'schemas', schemaFileName(plugin)), 'utf8'))

      let golden: Record<string, any>
      try {
        const { steps, snapshots, stepError, loggedErrors = [] } = await record(schemaFile)
        golden = { plugin, version, initialData: {}, steps, snapshots }
        if (loggedErrors.length) {
          const unique = [...new Set(loggedErrors.map(errorMessage))]
          note(`${plugin}: ${loggedErrors.length} logged error(s): ${unique.join(' | ')}`)
        }
        if (stepError) {
          note(`${plugin}: stopped after ${steps.length} steps: ${errorMessage(stepError)}`)
        }
      } catch (error) {
        golden = { plugin, version, initialData: {}, error: errorMessage(error) }
        note(`${plugin}: render failed: ${golden.error}`)
      }

      fs.mkdirSync(path.join(corpusDir, 'goldens'), { recursive: true })
      fs.writeFileSync(path.join(corpusDir, 'goldens', schemaFileName(plugin)), `${JSON.stringify(golden, null, 2)}\n`)
      expect(golden.plugin).toBe(plugin)
    }, 900_000) // big schemas (~900 controls) or settles that all hit SETTLE_MAX_MS take minutes
  }
})
