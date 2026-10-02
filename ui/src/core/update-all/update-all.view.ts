import type { UpdateAllExclusionReason, UpdateAllItemStatus, UpdateAllJournal, UpdateAllJournalItem, UpdateAllPlan } from '@/core/update-all/update-all.interfaces'

/**
 * The derived state of the Update All modal - what were the `computed`s and
 * view methods of the Angular component - as pure functions of the modal's
 * state, so the component and its spec share one implementation.
 */

export type UpdateAllPhase = 'loading' | 'plan' | 'progress' | 'summary'

/** A row on screen: a journal item, or a plan item that is not part of the run */
export interface UpdateAllRow extends UpdateAllJournalItem {
  /** Unticked before the run, so it is shown with a disabled toggle rather than a status */
  excluded?: boolean
  /** A major jump: in the list so it can be seen, but never selectable */
  needsReview?: boolean
  /** Why it needs review, rendered under the versions */
  reviewReason?: UpdateAllExclusionReason
}

/** The modal state every derived value reads from */
export interface UpdateAllView {
  phase: UpdateAllPhase
  plan: UpdateAllPlan
  journal: UpdateAllJournal | null
  /** Names the user has unticked - everything in the plan is ticked by default */
  unticked: ReadonlySet<string>
  /** Child bridges this run restarted, and the ones confirmed back up */
  restartingBridges: string[]
  restartedBridges: string[]
}

export interface UpdateAllRestartPlan {
  ui: boolean
  homebridge: boolean
  childBridgeCount: number
}

export interface UpdateAllRowLine {
  key: string
  params: Record<string, string>
}

export function emptyPlan(): UpdateAllPlan {
  return { items: [], needsReview: [], skipped: [] }
}

export function isTicked(view: UpdateAllView, name: string): boolean {
  return !view.unticked.has(name)
}

export function selectedCount(view: UpdateAllView): number {
  return view.plan.items.filter(x => !view.unticked.has(x.name)).length
}

/**
 * The rows on screen, one shape for every phase: the plan's items while
 * confirming (as `planned`, which is exactly what they are), the journal's
 * items once the run is under way. Keeping one type is what lets the same
 * list carry both, so nothing re-renders when the run starts.
 */
export function buildRows(view: UpdateAllView): UpdateAllRow[] {
  const planItems = view.plan.items

  // Majors sit in the same list rather than a section of their own, so the
  // user can see them without going looking. They are never part of a run,
  // so they carry a disabled toggle in every phase and say why underneath.
  const reviewRows: UpdateAllRow[] = view.plan.needsReview.map(({ reason, ...item }) => ({
    ...item,
    status: 'planned' as const,
    needsReview: true,
    reviewReason: reason,
  }))

  if (view.phase === 'plan') {
    return [...planItems.map(x => ({ ...x, status: 'planned' as const })), ...reviewRows]
  }

  // Once running, the plan's order is what keeps every row where the user last
  // saw it. Unticked items are not in the journal, so they stay as themselves,
  // marked excluded - they keep their (now disabled) toggle instead of a status.
  const byName = new Map((view.journal?.items ?? []).map(x => [x.name, x]))
  return [
    ...planItems.map(x => byName.get(x.name) ?? { ...x, status: 'planned' as const, excluded: view.unticked.has(x.name) }),
    ...reviewRows,
  ]
}

/**
 * What the finale will restart for the CURRENT selection, mirroring its
 * rules: Homebridge itself or any main-bridge plugin -> one Homebridge
 * restart (which covers every child bridge, so none are counted then);
 * otherwise just the child bridges of the selected plugins.
 *
 * ⚠️ The three are nested, widest first: the UI restarting itself ends the
 * process that hosts it, and in a service install that process is also
 * Homebridge's parent - so Homebridge comes back too, and with it every child
 * bridge. The summary line therefore only names the widest one.
 */
export function restartPlan(view: UpdateAllView): UpdateAllRestartPlan {
  // While the run is on, anything already failed or skipped will not restart
  // anything, so the line narrows as the run goes - which is exactly what the
  // finale will do with the same information. Each item's `restartImpact`
  // is computed server-side (the owner of the a-main-bridge-plugin-restarts-
  // Homebridge semantic); this fold is plain containment: ui ⊃ homebridge ⊃
  // child bridges.
  const selected = view.phase === 'plan'
    ? view.plan.items.filter(x => !view.unticked.has(x.name))
    : buildRows(view).filter(x => !x.excluded && !x.needsReview && x.status !== 'failed' && x.status !== 'skipped')
  const ui = selected.some(x => x.restartImpact === 'ui')
  const homebridge = selected.some(x => x.restartImpact === 'homebridge')
  const childBridgeCount = homebridge
    ? 0
    : new Set(selected.flatMap(x => x.restartImpact === 'child-bridges' ? (x.childBridgeUsernames ?? []) : [])).size
  return { ui, homebridge, childBridgeCount }
}

/** Whether this row's toggle can still be changed */
export function isSelectable(view: UpdateAllView, item: UpdateAllRow): boolean {
  return view.phase === 'plan' && !item.needsReview
}

/**
 * What the row should show. In the summary a `running` or `planned` status
 * can only mean the run never finished (the process died mid-run, for
 * example a power cut during the UI's own update) - showing a spinner
 * there would look alive forever, so those read as "did not finish".
 */
export function displayStatus(view: Pick<UpdateAllView, 'phase'>, status: UpdateAllItemStatus): UpdateAllItemStatus | 'incomplete' {
  if (view.phase === 'summary' && (status === 'running' || status === 'planned')) {
    return 'incomplete'
  }
  return status
}

/**
 * What the right-hand slot should show while the child bridges this run
 * touched are coming back. Null for every other row and every other phase,
 * so the normal item status shows instead.
 */
export function restartStatusFor(view: UpdateAllView, item: UpdateAllJournalItem): 'restarting' | 'restarted' | null {
  const usernames = item.childBridgeUsernames
  if (!usernames?.length || item.status !== 'ok') {
    return null
  }
  if (!view.restartingBridges.length && !view.restartedBridges.length) {
    return null
  }
  const done = view.restartedBridges
  return usernames.every(x => done.includes(x)) ? 'restarted' : 'restarting'
}

/**
 * The third line of a row, saying what is happening to that item at this
 * moment - it will be updated, it will not, it is updating, it failed and
 * why, it is done.
 *
 * Every state has a line, deliberately: a row that sometimes has three lines
 * and sometimes two would change height as the run moves, which is the thing
 * this modal works hardest to avoid. A major jump keeps its own reason here
 * instead, since that says both what will happen and why.
 *
 * Returns the i18n key and its values - the template translates it.
 * @param view - the modal state
 * @param item - the row being rendered
 */
export function rowLine(view: UpdateAllView, item: UpdateAllRow): UpdateAllRowLine {
  const plugin = item.displayName || item.name
  // The strings end in a full stop of their own, and a reason may or may not
  // - every one the run writes itself does, an npm error is anyone's guess -
  // so take a trailing one off rather than render "..".
  const reason = item.reason?.replace(/\.\s*$/, '')

  // Its own line rather than a status: it says both what would happen and why
  // it is not on offer, so a "will not be updated" line on top would be noise
  if (item.needsReview) {
    return { key: `update_all.line_${item.reviewReason}`, params: { plugin, from: item.from, to: item.to } }
  }

  // Unticked, whether that is still a choice (plan) or already settled (run)
  if (item.excluded || (view.phase === 'plan' && !isTicked(view, item.name))) {
    return { key: 'update_all.line_excluded', params: { plugin } }
  }

  // The child bridges coming back is the last thing to happen to a row, so it
  // outranks the item's own status, exactly as the icon does
  switch (restartStatusFor(view, item)) {
    case 'restarting':
      return { key: 'update_all.line_restarting', params: { plugin, to: item.to } }
    case 'restarted':
      return { key: 'update_all.line_restarted', params: { plugin, to: item.to } }
  }

  switch (displayStatus(view, item.status)) {
    case 'running':
      return { key: 'update_all.line_running', params: { plugin, to: item.to } }
    case 'ok':
      return { key: 'update_all.line_ok', params: { plugin, to: item.to } }
    case 'failed':
      return reason
        ? { key: 'update_all.line_failed', params: { plugin, reason } }
        : { key: 'update_all.line_failed_plain', params: { plugin } }
    case 'skipped':
      return reason
        ? { key: 'update_all.line_skipped', params: { plugin, reason } }
        : { key: 'update_all.line_skipped_plain', params: { plugin } }
    case 'incomplete':
      return { key: 'update_all.line_incomplete', params: { plugin } }
    default:
      // The only line that names the versions - the row has no separate
      // version line any more, and once a run is under way what matters is
      // what is happening, not what it is moving between
      return { key: 'update_all.line_planned', params: { plugin, from: item.from, to: item.to } }
  }
}

/**
 * The single icon a row shows on the right once the run is under way. The
 * label is not rendered - it is the accessible name and the tooltip, so the
 * rows stay narrow without the state becoming mouse-only.
 *
 * `fa-xl` to match the plugin rows in the Node.js update modal, which show
 * the same ticks and crosses at the same place in a list of the same shape.
 */
export function rowIcon(view: UpdateAllView, item: UpdateAllRow): { classes: string, label: string } {
  switch (restartStatusFor(view, item)) {
    case 'restarting':
      return { classes: 'fas fa-xl fa-circle-notch fa-spin grey-text', label: 'status.services.label_restarting' }
    case 'restarted':
      return { classes: 'fas fa-xl fa-check-circle green-text', label: 'update_all.status_restarted' }
  }

  switch (displayStatus(view, item.status)) {
    case 'running':
      return { classes: 'fas fa-xl fa-circle-notch fa-spin grey-text', label: 'update_all.status_running' }
    case 'ok':
      return { classes: 'fas fa-xl fa-check-circle green-text', label: 'update_all.status_ok' }
    case 'failed':
      return { classes: 'fas fa-xl fa-times-circle red-text', label: 'update_all.status_failed' }
    case 'skipped':
      return { classes: 'fas fa-xl fa-minus-circle grey-text', label: 'update_all.status_skipped' }
    case 'incomplete':
      return { classes: 'fas fa-xl fa-minus-circle grey-text', label: 'update_all.status_incomplete' }
    default:
      return { classes: 'far fa-xl fa-circle grey-text', label: 'update_all.status_planned' }
  }
}
