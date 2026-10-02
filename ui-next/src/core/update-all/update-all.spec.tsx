import type { ActiveModal } from '@/core/ui/modal'
import type { UpdateAllJournal, UpdateAllPlan, UpdateAllPlanItem } from '@/core/update-all/update-all.interfaces'
import type { UpdateAllView } from '@/core/update-all/update-all.view'
import type { FakeApi, FakeIoNamespace, FakeOpenModal, FakeTerminals, FakeWs } from '@/testing'
import type { Mock } from 'vitest'

import { act, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildRows, displayStatus, emptyPlan, restartPlan, rowLine } from '@/core/update-all/update-all.view'
import { UpdateAllItemRow } from '@/core/update-all/UpdateAllItemRow'
import { UpdateAllModal } from '@/core/update-all/UpdateAllModal'
import { fakeApi, fakeOpenModal, fakeTerminals, fakeWs, renderWithProviders, toastStub } from '@/testing'

const fakes = vi.hoisted(() => ({
  ws: null as FakeWs | null,
  toast: null as ReturnType<typeof toastStub> | null,
  modal: null as FakeOpenModal | null,
}))

vi.mock('@/core/ws', () => ({
  get ws() {
    return fakes.ws
  },
}))
vi.mock('@/core/ui/toast', () => ({
  get toast() {
    return fakes.toast
  },
}))
vi.mock('@/core/ui/modal', () => ({
  get openModal() {
    return fakes.modal!.openModal
  },
}))
// Never load the real xterm; the modal is handed `fakeTerminals().factory`
vi.mock('@/core/utilities/terminal/terminal.factory', () => ({ xtermFactory: {} }))

/**
 * The Update All feature: one modal that carries the plan, the run and the
 * summary. The Angular spec read the component's signals; this one reads what
 * they render, and tests the derived values (`update-all.view.ts`) directly
 * where the rendered text cannot show them - specs see keys, not the values
 * interpolated into them.
 */
describe('update all', () => {
  let api: FakeApi
  let xterm: FakeTerminals
  let activeModal: { [K in keyof ActiveModal]: Mock<ActiveModal[K]> }

  async function settle() {
    await act(async () => {
      for (let tick = 0; tick < 12; tick += 1) {
        await Promise.resolve()
      }
    })
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(console.error).mockClear()
    fakes.toast = toastStub()
    fakes.modal = fakeOpenModal()
    fakes.ws = fakeWs()
    activeModal = { close: vi.fn(), dismiss: vi.fn(), update: vi.fn() }
    xterm = fakeTerminals()
  })

  function render() {
    return renderWithProviders(
      <UpdateAllModal activeModal={activeModal} terminals={xterm.factory} />,
      { routes: [{ path: '/restart', element: <div data-testid="restart-page" /> }] },
    )
  }

  type Rendered = ReturnType<typeof render>

  /** Which phase the modal is showing, read off the footer (each phase has its own buttons) */
  function phaseOf(view: Rendered): string {
    const { container } = view
    if (container.querySelector('.modal-body .py-4 .fa-spin')) {
      return 'loading'
    }
    if (container.querySelector('.modal-footer .text-end .btn-primary')) {
      return 'plan'
    }
    if (container.querySelector('.modal-footer .text-center .btn-elegant')) {
      return 'progress'
    }
    if (container.querySelector('.modal-footer .text-center .btn-primary')) {
      return 'summary'
    }
    return 'unknown'
  }

  const rowItems = (view: Rendered) => [...view.container.querySelectorAll('.modal-body > ul.list-group > .list-group-item')]
  const toggle = (view: Rendered, name: string) => view.container.querySelector<HTMLInputElement>(`#update-all-item-${CSS.escape(name)}`)
  const statusOf = (view: Rendered, index: number) => rowItems(view)[index]?.querySelector('[role="img"]')?.getAttribute('aria-label') ?? null
  const restartLine = (view: Rendered) => view.container.querySelectorAll('.modal-body > ul')[0]?.querySelectorAll('li')[2]?.textContent
  const updateButton = (view: Rendered) => view.container.querySelector<HTMLButtonElement>('.modal-footer .text-end .btn-primary')!
  const location = (view: Rendered) => `${view.router.state.location.pathname}${view.router.state.location.search}`

  describe('the plan modal', () => {
    function planItem(overrides: Partial<UpdateAllPlanItem> = {}): UpdateAllPlanItem {
      const item: UpdateAllPlanItem = {
        type: 'plugin',
        name: 'homebridge-example',
        from: '1.0.0',
        to: '1.1.0',
        ...overrides,
      }
      // Mirror the server: it stamps every includable item with the widest
      // thing updating it restarts, and the client only folds those
      item.restartImpact ??= item.type === 'plugin'
        ? (item.childBridgeUsernames?.length ? 'child-bridges' : 'homebridge')
        : item.type
      return item
    }

    function makePlan(overrides: Partial<UpdateAllPlan> = {}): UpdateAllPlan {
      return { items: [], needsReview: [], skipped: [], ...overrides }
    }

    function makeView(overrides: Partial<UpdateAllView> = {}): UpdateAllView {
      return { phase: 'plan', plan: emptyPlan(), journal: null, unticked: new Set(), restartingBridges: [], restartedBridges: [], ...overrides }
    }

    /**
     * Open the plan modal.
     * @param options - how to set it up
     * @param options.plan - what the server answers with for the plan
     * @param options.arrange - runs on the fresh fakes before the modal is built
     */
    async function open(options: { plan?: UpdateAllPlan, arrange?: (fakes: { api: FakeApi }) => void } = {}) {
      api = fakeApi()
      api.respond('get', '/update-all/plan', options.plan ?? makePlan({ items: [planItem()] }))
      api.respond('post', '/update-all/start', {})
      options.arrange?.({ api })

      const view = render()
      await settle()
      return view
    }

    it('loads the plan and stops showing the loading state', async () => {
      const view = await open({ plan: makePlan({ items: [planItem(), planItem({ name: 'homebridge-other' })] }) })

      expect(phaseOf(view)).toBe('plan')
      expect(rowItems(view)).toHaveLength(2)
      expect(toggle(view, 'homebridge-example')!.checked).toBe(true)
      expect(toggle(view, 'homebridge-other')!.checked).toBe(true)
      expect(updateButton(view).textContent).toContain('update_all.button_update_many')
    })

    it('reports a failed plan lookup and closes itself', async () => {
      // Nothing can be confirmed without a plan, so staying open would offer an
      // empty list with no explanation
      const view = await open({ arrange: ({ api }) => api.fail('get', '/update-all/plan', new Error('nope')) })

      expect(fakes.toast!.error).toHaveBeenCalledWith(expect.anything(), 'toast.title_error')
      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
      expect(phaseOf(view)).toBe('loading')
    })

    it('unticks and reticks an item', async () => {
      const view = await open({ plan: makePlan({ items: [planItem(), planItem({ name: 'homebridge-other' })] }) })

      fireEvent.click(toggle(view, 'homebridge-example')!)

      expect(toggle(view, 'homebridge-example')!.checked).toBe(false)
      expect(updateButton(view).textContent).toContain('update_all.button_update_one')

      fireEvent.click(toggle(view, 'homebridge-example')!)

      expect(toggle(view, 'homebridge-example')!.checked).toBe(true)
      expect(updateButton(view).textContent).toContain('update_all.button_update_many')
    })

    it('reports whether anything was skipped', async () => {
      const view = await open({ plan: makePlan({ items: [planItem()] }) })

      expect(view.container.querySelector('[aria-controls="update-all-skipped"]')).toBeNull()
    })

    it('lists the skipped items behind their toggle, with the reason', async () => {
      const view = await open({
        plan: makePlan({ items: [planItem()], skipped: [{ ...planItem({ name: 'homebridge-hidden' }), reason: 'hidden' }] }),
      })
      const button = view.container.querySelector('[aria-controls="update-all-skipped"]')!
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(view.container.querySelector('#update-all-skipped')).toBeNull()

      fireEvent.click(button)

      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(button.querySelector('.fa-chevron-down')!.classList).toContain('fa-rotate-180')
      expect(view.container.querySelector('#update-all-skipped')!.textContent).toContain('update_all.reason_hidden')
    })

    /**
     * Majors are shown in the main list rather than a section of their own, so
     * they are seen without going looking - but they can never be part of a
     * run, so they carry a toggle that is off and cannot be turned on.
     */
    it('shows a major update in the list, unselectable and saying why', async () => {
      const plan = makePlan({
        items: [planItem()],
        needsReview: [{ ...planItem({ name: 'homebridge-major' }), reason: 'major' }],
      })
      const view = await open({ plan })

      expect(toggle(view, 'homebridge-major')!.disabled).toBe(true)
      expect(rowItems(view)[1].textContent).toContain('update_all.line_major')

      // and it is not counted as something the run would update
      expect(updateButton(view).textContent).toContain('update_all.button_update_one')
      expect(restartLine(view)).toBe('update_all.restart_homebridge')
      expect(restartPlan(makeView({ plan }))).toEqual({ ui: false, homebridge: true, childBridgeCount: 0 })
    })

    it('leaves the ordinary rows selectable, and says what will happen to them', async () => {
      const view = await open({ plan: makePlan({ items: [planItem()] }) })

      expect(toggle(view, 'homebridge-example')!.disabled).toBe(false)
      expect(rowItems(view)[0].textContent).toContain('update_all.line_planned')
    })

    /**
     * The third line follows the row through the run, so the row keeps its
     * height from the plan to the summary and the reason for a failure sits
     * with the item it belongs to rather than in a list at the bottom.
     */
    it('says what is happening to a row at each point in its life', () => {
      const plan = makePlan({ items: [planItem({ name: 'homebridge-a', displayName: 'Plugin A' })] })
      const lineFor = (view: UpdateAllView) => rowLine(view, buildRows(view)[0])

      // the planned line is the only one that names the versions, since the row has no version line of its own
      expect(lineFor(makeView({ plan }))).toEqual({
        key: 'update_all.line_planned',
        params: { plugin: 'Plugin A', from: '1.0.0', to: '1.1.0' },
      })

      expect(lineFor(makeView({ plan, unticked: new Set(['homebridge-a']) }))).toEqual({ key: 'update_all.line_excluded', params: { plugin: 'Plugin A' } })

      const journal = (status: 'running' | 'failed' | 'ok', reason?: string): UpdateAllJournal => ({
        schemaVersion: 1,
        runId: 'r1',
        startedAt: '2026-08-19T10:00:00.000Z',
        items: [{ ...planItem({ name: 'homebridge-a', displayName: 'Plugin A' }), status, reason }],
        restart: { homebridge: 'pending', ui: 'pending' },
      })
      expect(lineFor(makeView({ plan, phase: 'progress', journal: journal('running') }))).toEqual({ key: 'update_all.line_running', params: { plugin: 'Plugin A', to: '1.1.0' } })
      expect(lineFor(makeView({ plan, phase: 'progress', journal: journal('failed', 'npm exploded') }))).toEqual({
        key: 'update_all.line_failed',
        params: { plugin: 'Plugin A', reason: 'npm exploded' },
      })
      expect(lineFor(makeView({ plan, phase: 'progress', journal: journal('ok') }))).toEqual({ key: 'update_all.line_ok', params: { plugin: 'Plugin A', to: '1.1.0' } })
    })

    // Every reason the run writes ends in a full stop, and so does the string
    it('does not end a failure line with two full stops', () => {
      const view = makeView({
        phase: 'progress',
        plan: makePlan({ items: [planItem({ name: 'homebridge-a', displayName: 'Plugin A' })] }),
        journal: {
          schemaVersion: 1,
          runId: 'r1',
          startedAt: '2026-08-19T10:00:00.000Z',
          items: [{ ...planItem({ name: 'homebridge-a', displayName: 'Plugin A' }), status: 'skipped', reason: 'Run cancelled by the user.' }],
          restart: { homebridge: 'pending', ui: 'pending' },
        },
      })

      expect(rowLine(view, buildRows(view)[0])).toEqual({
        key: 'update_all.line_skipped',
        params: { plugin: 'Plugin A', reason: 'Run cancelled by the user' },
      })
    })

    /**
     * The point of moving majors into the main list is what the user sees: one
     * table, with the major's toggle off and unusable and the reason under its
     * versions.
     */
    it('draws the major in the same table, with a dead toggle and its reason', async () => {
      const view = await open({
        plan: makePlan({
          items: [planItem({ name: 'homebridge-normal', displayName: 'Normal' })],
          needsReview: [{ ...planItem({ name: 'homebridge-major', displayName: 'Major' }), reason: 'major' }],
        }),
      })

      const rows = view.container.querySelectorAll('.list-group-item')
      expect(rows).toHaveLength(2)

      const normalToggle = toggle(view, 'homebridge-normal')!
      expect(normalToggle.disabled).toBe(false)
      expect(normalToggle.checked).toBe(true)

      const majorToggle = toggle(view, 'homebridge-major')!
      expect(majorToggle.disabled).toBe(true)
      expect(majorToggle.checked).toBe(false)
      expect(majorToggle.getAttribute('aria-label')).toBe('Major: update_all.status_excluded')

      // the reason sits inside the major's own row, not in a section elsewhere
      expect(rows[1].textContent).toContain('update_all.line_major')
      expect(rows[0].textContent).not.toContain('update_all.line_major')
    })

    /**
     * ⚠️ The bug this pins is movement, not wording. The restart line used to
     * vanish when the last item was unticked, so the list lost a bullet and
     * everything below it jumped up under the user's cursor.
     */
    it('keeps the summary the same height when everything is unticked', async () => {
      const view = await open({ plan: makePlan({ items: [planItem({ name: 'homebridge-a' })] }) })

      // the first list in the body is the summary, the second is the plugin rows
      const bullets = () => view.container.querySelectorAll('.modal-body > ul')[0].querySelectorAll('li').length
      const before = bullets()

      fireEvent.click(toggle(view, 'homebridge-a')!)

      expect(bullets()).toBe(before)
      expect(view.container.textContent).toContain('update_all.restart_none')
    })

    /**
     * ⚠️ The three restart scopes contain each other. The UI restarting itself
     * ends the process hosting it, which in a service install is also
     * Homebridge's parent - so Homebridge returns too, and with it every child
     * bridge. Naming the smaller ones alongside would promise restarts that are
     * really just part of the big one.
     */
    it('names only the widest restart when the ui is updating', async () => {
      const view = await open({
        plan: makePlan({
          items: [
            planItem({ type: 'ui', name: '@mp-consulting/homebridge-config-glass-ui' }),
            planItem({ name: 'homebridge-on-a-bridge', childBridgeUsernames: ['AA:BB:CC:DD:EE:FF'] }),
          ],
        }),
      })

      const summary = view.container.querySelectorAll('.modal-body > ul')[0]
      expect(summary.querySelectorAll('li')).toHaveLength(3)
      expect(summary.textContent).toContain('update_all.restart_homebridge_and_ui')
      expect(summary.textContent).not.toContain('update_all.restart_child_bridges')
    })

    it('names the child bridges when only they are restarting', async () => {
      const view = await open({
        plan: makePlan({
          items: [planItem({ name: 'homebridge-on-a-bridge', childBridgeUsernames: ['AA:BB:CC:DD:EE:FF'] })],
        }),
      })

      const summary = view.container.querySelectorAll('.modal-body > ul')[0]
      expect(summary.querySelectorAll('li')).toHaveLength(3)
      expect(summary.textContent).toContain('update_all.restart_child_bridges_one')
    })

    /**
     * The footer keeps one shape through the plan phase. A run of nothing but
     * major updates has no selectable rows, and the button used to vanish -
     * leaving Close alone and no sign of why the run could not start.
     */
    it('keeps the update button in place, disabled, when nothing can be selected', async () => {
      const view = await open({
        plan: makePlan({
          items: [],
          needsReview: [{ ...planItem({ name: 'homebridge-major' }), reason: 'major' }],
        }),
      })

      const button = view.container.querySelector<HTMLButtonElement>('.modal-footer .btn-primary')
      expect(button).toBeTruthy()
      expect(button!.disabled).toBe(true)
    })

    describe('the restart plan it previews', () => {
      it('counts one homebridge restart and no child bridges when homebridge itself is updating', async () => {
        // A homebridge restart takes every child bridge with it, so counting
        // them as well would promise the user more restarts than happen
        const plan = makePlan({
          items: [
            planItem({ type: 'homebridge', name: 'homebridge' }),
            planItem({ name: 'homebridge-child', childBridgeUsernames: ['AA:BB:CC:DD:EE:FF'] }),
          ],
        })
        const view = await open({ plan })

        expect(restartLine(view)).toBe('update_all.restart_homebridge')
        expect(restartPlan(makeView({ plan }))).toEqual({ ui: false, homebridge: true, childBridgeCount: 0 })
      })

      it('treats a plugin on the main bridge as a homebridge restart', async () => {
        const plan = makePlan({ items: [planItem({ childBridgeUsernames: [] })] })
        const view = await open({ plan })

        expect(restartLine(view)).toBe('update_all.restart_homebridge')
        expect(restartPlan(makeView({ plan }))).toEqual({ ui: false, homebridge: true, childBridgeCount: 0 })
      })

      it('counts each child bridge once when only child-bridged plugins are updating', async () => {
        // Two plugins sharing a child bridge is one restart, not two
        const plan = makePlan({
          items: [
            planItem({ name: 'homebridge-a', childBridgeUsernames: ['AA:BB:CC:DD:EE:FF'] }),
            planItem({ name: 'homebridge-b', childBridgeUsernames: ['AA:BB:CC:DD:EE:FF', '11:22:33:44:55:66'] }),
          ],
        })
        const view = await open({ plan })

        expect(restartLine(view)).toBe('update_all.restart_child_bridges')
        expect(restartPlan(makeView({ plan }))).toEqual({ ui: false, homebridge: false, childBridgeCount: 2 })
      })

      it('flags the ui restart independently of the homebridge one', async () => {
        const plan = makePlan({ items: [planItem({ type: 'ui', name: '@mp-consulting/homebridge-config-glass-ui', childBridgeUsernames: ['AA:BB:CC:DD:EE:FF'] })] })
        const view = await open({ plan })

        // Bridges behind an item with a wider impact are covered by that wider
        // restart, so they no longer count separately (and the count is never
        // rendered when the ui flag is set - the widest bullet wins)
        expect(restartLine(view)).toBe('update_all.restart_homebridge_and_ui')
        expect(restartPlan(makeView({ plan }))).toEqual({ ui: true, homebridge: false, childBridgeCount: 0 })
      })

      it('follows the ticks rather than the whole plan', async () => {
        const plan = makePlan({
          items: [
            planItem({ type: 'homebridge', name: 'homebridge' }),
            planItem({ name: 'homebridge-child', childBridgeUsernames: ['AA:BB:CC:DD:EE:FF'] }),
          ],
        })
        const view = await open({ plan })

        fireEvent.click(toggle(view, 'homebridge')!)

        expect(restartLine(view)).toBe('update_all.restart_child_bridges_one')
        expect(restartPlan(makeView({ plan, unticked: new Set(['homebridge']) }))).toEqual({ ui: false, homebridge: false, childBridgeCount: 1 })
      })
    })

    describe('confirming', () => {
      it('sends only the ticked items, as name and target version', async () => {
        // The server re-validates against a fresh plan, so the modal echoes the
        // plan's `to` rather than choosing a version itself
        const view = await open({
          plan: makePlan({ items: [planItem(), planItem({ name: 'homebridge-other', to: '2.0.0' })] }),
        })
        fireEvent.click(toggle(view, 'homebridge-example')!)

        fireEvent.click(updateButton(view))
        await settle()

        expect(api.lastCall('post', '/update-all/start')?.body).toEqual({
          items: [{ name: 'homebridge-other', to: '2.0.0' }],
        })
      })

      it('keeps the rows and the description on screen, so nothing moves under the cursor', async () => {
        const view = await open({
          plan: makePlan({ items: [planItem(), planItem({ name: 'homebridge-other' })] }),
        })
        const names = () => rowItems(view).map(x => x.textContent)
        const before = names()

        fireEvent.click(updateButton(view))
        await settle()

        // No spinner in between and no empty list: the same rows carry straight
        // on, and the description above them stays put
        expect(phaseOf(view)).not.toBe('loading')
        expect(rowItems(view)).toHaveLength(2)
        expect(names().map(x => x?.split('update_all.')[0])).toEqual(before.map(x => x?.split('update_all.')[0]))
        expect(view.container.textContent).toContain('update_all.description_2')
      })

      it('keeps an unticked row in place, marked as not part of the run', async () => {
        const view = await open({
          plan: makePlan({ items: [planItem(), planItem({ name: 'homebridge-other' })] }),
        })
        fireEvent.click(toggle(view, 'homebridge-example')!)

        fireEvent.click(updateButton(view))
        await settle()

        // It stays where it was rather than vanishing from under the user - the
        // row keeps its (now disabled) toggle instead of taking a status
        const rows = rowItems(view)
        expect(rows.map(x => x.textContent?.split('update_all.')[0])).toEqual(['homebridge-example', 'homebridge-other'])
        expect(toggle(view, 'homebridge-example')!.disabled).toBe(true)
        expect(rows[0].textContent).toContain('update_all.line_excluded')
        expect(toggle(view, 'homebridge-other')).toBeNull()
        expect(statusOf(view, 1)).not.toBeNull()
      })

      it('leaves an excluded row out of the restart it predicts', async () => {
        const view = await open({
          plan: makePlan({
            items: [
              planItem({ name: 'homebridge-main' }),
              planItem({ name: 'homebridge-bridged', childBridgeUsernames: ['AA:BB'] }),
            ],
          }),
        })
        // The only main-bridge plugin is unticked, so nothing calls for a full restart
        fireEvent.click(toggle(view, 'homebridge-main')!)

        fireEvent.click(updateButton(view))
        await settle()

        expect(restartLine(view)).toBe('update_all.restart_child_bridges_one')
      })

      it('carries on into the run in place, without opening a second modal', async () => {
        const view = await open()

        fireEvent.click(updateButton(view))
        await settle()

        // The rows the user was just looking at stay exactly where they are -
        // only their right-hand cell changes, from a toggle to a status
        expect(activeModal.close).not.toHaveBeenCalled()
        expect(fakes.modal!.lastOpened()).toBeUndefined()
        expect(phaseOf(view)).not.toBe('plan')
      })

      it('does nothing when everything has been unticked', async () => {
        const view = await open()
        fireEvent.click(toggle(view, 'homebridge-example')!)

        expect(updateButton(view).disabled).toBe(true)
        fireEvent.click(updateButton(view))
        await settle()

        expect(api.callsTo('post', '/update-all/start')).toHaveLength(0)
        expect(fakes.modal!.opened).toHaveLength(0)
      })

      it('starts one run however many times the button is pressed', async () => {
        // Two runs at once would have npm fighting itself over node_modules
        const view = await open()
        const button = updateButton(view)

        fireEvent.click(button)
        fireEvent.click(button)
        fireEvent.click(button)
        await settle()

        expect(api.callsTo('post', '/update-all/start')).toHaveLength(1)
      })

      it('reports a failed start and lets the user try again', async () => {
        const view = await open({ arrange: ({ api }) => api.fail('post', '/update-all/start', new Error('nope')) })

        fireEvent.click(updateButton(view))
        await settle()

        expect(fakes.toast!.error).toHaveBeenCalledWith(expect.anything(), 'toast.title_error')
        expect(updateButton(view).disabled).toBe(false)
        expect(updateButton(view).querySelector('.fa-spin')).toBeNull()
        expect(activeModal.close).not.toHaveBeenCalled()
        expect(fakes.modal!.opened).toHaveLength(0)
      })
    })

    it('dismisses when closed', async () => {
      const view = await open()

      fireEvent.click(view.container.querySelector('.modal-footer .text-start .btn-elegant')!)

      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
    })
  })

  describe('the progress modal', () => {
    let io: FakeIoNamespace

    function makeJournal(overrides: Partial<UpdateAllJournal> = {}): UpdateAllJournal {
      return {
        schemaVersion: 1,
        runId: 'run-1',
        startedAt: '2026-08-19T10:00:00.000Z',
        items: [
          { type: 'plugin', name: 'homebridge-example', from: '1.0.0', to: '1.1.0', status: 'planned' },
          { type: 'plugin', name: 'homebridge-other', from: '2.0.0', to: '2.1.0', status: 'planned' },
        ],
        restart: { homebridge: 'pending', ui: 'pending' },
        ...overrides,
      }
    }

    /**
     * Open the progress modal.
     * @param options - how to set it up
     * @param options.active - whether the server says a run is still going
     * @param options.journal - the journal in the subscribe snapshot
     * @param options.arrange - runs on the fresh fakes before the modal is built
     */
    async function open(options: {
      active?: boolean
      journal?: UpdateAllJournal | null
      arrange?: (fakes: { api: FakeApi, io: FakeIoNamespace }) => void
    } = {}) {
      api = fakeApi()
      io = fakes.ws!.namespace('update-all')

      const journal = options.journal === undefined ? makeJournal() : options.journal
      io.socket.respondTo('subscribe', { active: options.active ?? true, journal })
      api.respond('get', '/update-all/journal', journal)
      api.respond('post', '/update-all/cancel', {})
      // The run is entered the only way the app can: plan, confirm, start.
      // The plan mirrors the journal's items so the rows line up either way.
      api.respond('get', '/update-all/plan', {
        items: [
          { type: 'plugin', name: 'homebridge-example', displayName: 'Example', from: '1.0.0', to: '1.1.0' },
          { type: 'plugin', name: 'homebridge-other', displayName: 'Other', from: '2.0.0', to: '2.1.0' },
        ],
        needsReview: [],
        skipped: [],
      })
      api.respond('post', '/update-all/start', {})
      options.arrange?.({ api, io })

      const view = render()
      await settle()
      // Confirm the plan - the only door into the run
      fireEvent.click(updateButton(view))
      await settle()
      return view
    }

    const fire = async (event: string, ...args: any[]) => {
      act(() => io.socket.fire(event, ...args))
      await settle()
    }

    const reconnect = async () => {
      act(() => io.markConnected())
      await settle()
    }

    it('subscribes to the run and shows its progress', async () => {
      const view = await open({ active: true })

      expect(fakes.ws!.connectToNamespace).toHaveBeenCalledWith('update-all')
      expect(io.requests.map(request => request.resource)).toEqual(['subscribe'])
      expect(phaseOf(view)).toBe('progress')
      expect(statusOf(view, 0)).toBe('update_all.status_planned')
      expect(statusOf(view, 1)).toBe('update_all.status_planned')
    })

    it('opens a terminal for the npm output', async () => {
      const view = await open({ active: true })

      expect(xterm.terminals).toHaveLength(1)
      expect(xterm.terminals[0].open).toHaveBeenCalledWith(view.container.querySelector('#update-all-log-output'))
      expect(xterm.terminals[0].options).toMatchObject({ disableStdin: true })
      expect(xterm.fits[0].fit).toHaveBeenCalled()
    })

    it('goes straight to the summary when the run has already finished', async () => {
      // The subscribe snapshot can say the run is over (it raced to completion
      // before the ws attach) - the modal must settle as the summary, not spin
      const view = await open({ active: false })

      expect(phaseOf(view)).toBe('summary')
      expect(xterm.terminals).toHaveLength(0)
    })

    it('re-reads the journal from disk for the summary', async () => {
      // The snapshot's copy predates the restart outcomes
      const finished = makeJournal({ finishedAt: '2026-08-19T10:05:00.000Z', restart: { homebridge: 'done', ui: 'scheduled' } })
      const view = await open({
        active: false,
        arrange: ({ api }) => api.respond('get', '/update-all/journal', finished),
      })

      expect(view.container.textContent).toContain('update_all.summary_restart_homebridge_done')
      expect(view.container.textContent).toContain('update_all.summary_restart_ui')
    })

    /**
     * ⚠️ The hand-over only belongs to a run this modal watched finish. The
     * journal records what a run ASKED for - "a UI restart was scheduled" - and
     * never that it happened, so a snapshot that turns out to be already over
     * must go to the summary rather than bounce the user to the restart page.
     *
     * `uiRestarting` is the half that matters on the live path: it tells the
     * restart page the UI is going down too, so it shows that row as pending
     * rather than ticked.
     */
    it('hands over to the restart page when it watches the run finish', async () => {
      const finished = makeJournal({ finishedAt: '2026-08-19T10:05:00.000Z', restart: { homebridge: 'done', ui: 'scheduled' } })
      const view = await open({
        active: true,
        arrange: ({ api }) => api.respond('get', '/update-all/journal', finished),
      })
      expect(phaseOf(view)).toBe('progress')

      await fire('run-complete')

      expect(activeModal.close).toHaveBeenCalledWith('handover')
      expect(location(view)).toBe('/restart?restarting=true&uiRestarting=true')
    })

    it('shows the summary instead when the run was already over on arrival', async () => {
      const finished = makeJournal({ finishedAt: '2026-08-19T10:05:00.000Z', restart: { homebridge: 'done', ui: 'scheduled' } })
      const view = await open({
        active: false,
        arrange: ({ api }) => api.respond('get', '/update-all/journal', finished),
      })

      expect(phaseOf(view)).toBe('summary')
      expect(location(view)).toBe('/')
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('stays on the summary when the homebridge restart failed', async () => {
      // Regression: 'failed' used to count as "restart under way" and handed
      // over to /restart, where the never-restarted process answers 'ok' and
      // a success toast appears - the summary's failed line is the honest path
      const finished = makeJournal({ finishedAt: '2026-08-19T10:05:00.000Z', restart: { homebridge: 'failed', ui: 'not-needed' } })
      const view = await open({
        active: true,
        arrange: ({ api }) => api.respond('get', '/update-all/journal', finished),
      })

      await fire('run-complete')

      expect(phaseOf(view)).toBe('summary')
      expect(view.container.textContent).toContain('update_all.summary_restart_homebridge_failed')
      expect(location(view)).toBe('/')
      expect(activeModal.close).not.toHaveBeenCalled()
    })

    it('ignores a reconnect snapshot for a different run after settling', async () => {
      // Regression: the journal file holds the LATEST run only, so a reconnect
      // while another admin's run is active used to drag this modal's summary
      // back into 'progress' rendering a run this user never confirmed
      const view = await open({ active: false })
      expect(phaseOf(view)).toBe('summary')

      io.socket.respondTo('subscribe', { active: true, journal: makeJournal({ runId: 'run-2', restart: { homebridge: 'failed', ui: 'pending' } }) })
      await reconnect()

      expect(phaseOf(view)).toBe('summary')
      // run-2's journal never replaced run-1's
      expect(view.container.textContent).not.toContain('update_all.summary_restart_homebridge_failed')
    })

    it('does not restart the child-bridge watch on a reconnect', async () => {
      // Regression: a reconnect re-ran showSummary, which re-armed
      // watchChildBridges - resetting rows to 'restarting', stacking listeners
      // on the shared child-bridges socket and orphaning the 15s timer
      const finished = makeJournal({
        finishedAt: '2026-08-19T10:05:00.000Z',
        restart: { homebridge: 'not-needed', ui: 'not-needed', childBridges: 'done' },
        items: [{ type: 'plugin', name: 'homebridge-example', from: '1.0.0', to: '1.1.0', status: 'ok', childBridgeUsernames: ['0E:AA:BB:CC:DD:EE'] }],
      })
      await open({ active: false, journal: finished })
      const watchCalls = () => fakes.ws!.connectToNamespace.mock.calls.filter(call => call[0] === 'child-bridges').length
      expect(watchCalls()).toBe(1)

      await reconnect()

      expect(watchCalls()).toBe(1)
    })

    it('follows the restarted child bridges back in place of the status', async () => {
      const finished = makeJournal({
        finishedAt: '2026-08-19T10:05:00.000Z',
        restart: { homebridge: 'not-needed', ui: 'not-needed', childBridges: 'done' },
        items: [{ type: 'plugin', name: 'homebridge-example', from: '1.0.0', to: '1.1.0', status: 'ok', childBridgeUsernames: ['0E:AA:BB:CC:DD:EE'] }],
      })
      const view = await open({ active: false, journal: finished })
      const child = fakes.ws!.namespace('child-bridges')

      expect(child.socket.payloadsFor('monitor-child-bridge-status')).toHaveLength(1)
      expect(statusOf(view, 0)).toBe('status.services.label_restarting')
      // the summary does not repeat what the rows are already saying
      expect(view.container.textContent).not.toContain('update_all.summary_restart_child_bridges_done')

      act(() => child.socket.fire('child-bridge-status-update', { username: '0E:AA:BB:CC:DD:EE', status: 'ok' }))

      expect(statusOf(view, 0)).toBe('update_all.status_restarted')
    })

    it('stays put when nothing the run did needs a restart', async () => {
      const finished = makeJournal({ finishedAt: '2026-08-19T10:05:00.000Z', restart: { homebridge: 'not-needed', ui: 'not-needed' } })
      const view = await open({
        active: false,
        arrange: ({ api }) => api.respond('get', '/update-all/journal', finished),
      })

      expect(location(view)).toBe('/')
    })

    it('still shows the summary when the journal cannot be re-read', async () => {
      const view = await open({
        active: false,
        arrange: ({ api }) => api.fail('get', '/update-all/journal', new Error('nope')),
      })

      expect(phaseOf(view)).toBe('summary')
    })

    it('reports a failed subscribe and closes itself', async () => {
      const view = await open({
        arrange: ({ io }) => io.socket.respondTo('subscribe', { error: 'nope' }),
      })

      expect(fakes.toast!.error).toHaveBeenCalledWith(expect.anything(), 'toast.title_error')
      expect(activeModal.dismiss).toHaveBeenCalledWith('Dismiss')
      // The plan had already moved this to progress before the subscribe failed
      expect(phaseOf(view)).toBe('progress')
    })

    describe('live events', () => {
      it('marks an item running when it starts', async () => {
        const view = await open()

        await fire('item-start', { name: 'homebridge-example' })

        expect(statusOf(view, 0)).toBe('update_all.status_running')
        expect(statusOf(view, 1)).toBe('update_all.status_planned')
      })

      it('records the result an item finished with', async () => {
        const view = await open()

        await fire('item-result', { name: 'homebridge-other', status: 'failed' })

        expect(statusOf(view, 1)).toBe('update_all.status_failed')
      })

      it('ignores item events that arrive before the journal', async () => {
        const view = await open({ journal: null, active: true })

        await fire('item-start', { name: 'homebridge-example' })

        // still the plan's own rows, untouched
        expect(statusOf(view, 0)).toBe('update_all.status_planned')
      })

      it('writes npm output into the terminal', async () => {
        await open({ active: true })

        await fire('stdout', { name: 'homebridge-example', data: 'added 1 package\r\n' })

        expect(xterm.terminals[0].written).toEqual(['added 1 package\r\n'])
      })

      it('shows the summary when the run completes', async () => {
        const view = await open({ active: true })
        expect(phaseOf(view)).toBe('progress')

        await fire('run-complete')

        expect(phaseOf(view)).toBe('summary')
      })

      it('says so while the server is away, and recovers on reconnect', async () => {
        // The server goes down while the UI updates itself - appearing frozen
        // would read as a hung update
        const view = await open({ active: true })

        await fire('disconnect')

        expect(view.container.textContent).toContain('update_all.reconnecting')

        await reconnect()

        expect(view.container.textContent).not.toContain('update_all.reconnecting')
        // The fresh server-side socket has to be re-registered, or the rest of
        // the run streams into nothing
        expect(io.requests.map(request => request.resource)).toEqual(['subscribe', 'subscribe'])
      })
    })

    describe('cancelling', () => {
      const stopButton = (view: Rendered) => view.container.querySelector<HTMLButtonElement>('.modal-footer .text-center .btn-elegant')!

      it('asks the server to stop and says so', async () => {
        const view = await open({ active: true })

        fireEvent.click(stopButton(view))
        await settle()

        expect(api.callsTo('post', '/update-all/cancel')).toHaveLength(1)
        expect(stopButton(view).disabled).toBe(true)
        expect(view.container.textContent).toContain('update_all.stopping')
      })

      it('reports a failed cancel and lets the user ask again', async () => {
        const view = await open({
          active: true,
          arrange: ({ api }) => api.fail('post', '/update-all/cancel', new Error('nope')),
        })

        fireEvent.click(stopButton(view))
        await settle()

        expect(fakes.toast!.error).toHaveBeenCalledWith(expect.anything(), 'toast.title_error')
        expect(stopButton(view).disabled).toBe(false)
        expect(view.container.textContent).not.toContain('update_all.stopping')
      })
    })

    describe('what a row shows', () => {
      it('reads an unfinished item as incomplete in the summary', async () => {
        // A spinner in the summary would look alive for ever - these mean the
        // run died mid-item, e.g. a power cut during the ui update
        const journal = makeJournal()
        journal.items[0].status = 'running'
        const view = await open({ active: false, journal })

        expect(statusOf(view, 0)).toBe('update_all.status_incomplete')
        expect(statusOf(view, 1)).toBe('update_all.status_incomplete')
        expect(displayStatus({ phase: 'summary' }, 'running')).toBe('incomplete')
        expect(displayStatus({ phase: 'summary' }, 'planned')).toBe('incomplete')
      })

      it('leaves finished statuses alone in the summary', async () => {
        const journal = makeJournal({
          items: [
            { type: 'plugin', name: 'homebridge-example', from: '1.0.0', to: '1.1.0', status: 'ok' },
            { type: 'plugin', name: 'homebridge-other', from: '2.0.0', to: '2.1.0', status: 'failed' },
          ],
        })
        const view = await open({ active: false, journal })

        expect(statusOf(view, 0)).toBe('update_all.status_ok')
        expect(statusOf(view, 1)).toBe('update_all.status_failed')
        expect(displayStatus({ phase: 'summary' }, 'ok')).toBe('ok')
        expect(displayStatus({ phase: 'summary' }, 'failed')).toBe('failed')
        expect(displayStatus({ phase: 'summary' }, 'skipped')).toBe('skipped')
      })

      it('keeps a running item running while the run is live', async () => {
        const journal = makeJournal()
        journal.items[0].status = 'running'
        const view = await open({ active: true, journal })

        expect(statusOf(view, 0)).toBe('update_all.status_running')
      })
    })

    describe('closing', () => {
      it('closes without telling the server anything', async () => {
        // The journal is the record of the run; there is no acknowledgement
        // round-trip any more because nothing reopens the summary later
        const view = await open({ active: false })

        fireEvent.click(view.container.querySelector('.modal-footer .text-center .btn-primary')!)

        expect(api.callsTo('post', '/update-all/journal/ack')).toEqual([])
        expect(activeModal.close).toHaveBeenCalledWith('done')
      })
    })

    describe('teardown', () => {
      it('detaches its own listeners without touching the shared socket', async () => {
        // The namespace socket is cached and shared, so removeAllListeners()
        // would silently break whatever else is listening on it
        const view = await open({ active: true })
        expect(io.socket.handlers('item-start')).toHaveLength(1)

        view.unmount()

        expect(io.socket.handlers('item-start')).toHaveLength(0)
        expect(io.socket.handlers('stdout')).toHaveLength(0)
        expect(io.socket.removeAllListeners).not.toHaveBeenCalled()
      })

      it('disposes the terminal and ends the namespace', async () => {
        const view = await open({ active: true })

        view.unmount()

        expect(xterm.terminals[0].dispose).toHaveBeenCalled()
        expect(io.end).toHaveBeenCalled()
      })

      it('stops listening for reconnects', async () => {
        const view = await open({ active: true })

        view.unmount()
        io.markConnected()
        await settle()

        // One from the original connect, and none after teardown
        expect(io.requests).toHaveLength(1)
      })
    })
  })

  describe('the item row', () => {
    it('falls back to the Homebridge icon when there is none or it fails to load', () => {
      const { container, rerender } = renderWithProviders(<UpdateAllItemRow displayName="Plugin A" note="a note" />)
      const img = () => container.querySelector('img')!

      expect(img().getAttribute('src')).toBe('assets/hb-icon.png')
      expect(container.querySelector('small.grey-text')!.textContent).toBe('a note')

      rerender(<UpdateAllItemRow displayName="Plugin A" icon="https://example.com/broken.png" />)
      fireEvent.error(img())

      expect(img().getAttribute('src')).toBe('assets/hb-icon.png')
      expect(container.querySelector('small')).toBeNull()
    })
  })
})
