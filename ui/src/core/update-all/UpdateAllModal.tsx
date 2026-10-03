import type { ModalComponentProps } from '@/core/ui/modal'
import type { UpdateAllItemStatus, UpdateAllJournal, UpdateAllPlan, UpdateAllSnapshot } from '@/core/update-all/update-all.interfaces'
import type { UpdateAllPhase, UpdateAllView } from '@/core/update-all/update-all.view'
import type { TerminalFactory } from '@/core/utilities/terminal/types'
import type { IoNamespace } from '@/core/ws'
import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import { api } from '@/core/api'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { ModalFooter, ModalHeader } from '@/core/ui/ModalParts'
import {
  buildRows,
  restartPlan as computeRestartPlan,
  selectedCount as computeSelectedCount,
  emptyPlan,
  isSelectable,
  isTicked,
  rowIcon,
  rowLine,
} from '@/core/update-all/update-all.view'
import { UpdateAllItemRow } from '@/core/update-all/UpdateAllItemRow'
import { cx } from '@/core/utilities/cx'
import { toastApiError } from '@/core/utilities/http-error'
import { xtermFactory } from '@/core/utilities/terminal/terminal.factory'
import { ws } from '@/core/ws'

export interface UpdateAllModalProps extends ModalComponentProps {
  /** The xterm factory (Angular's TERMINAL_FACTORY); specs pass `fakeTerminals().factory` */
  terminals?: TerminalFactory
}

type Listener = (...args: any[]) => void

/**
 * State held both for rendering and for the socket handlers. The handlers are
 * registered once and outlive any render, so they read the ref - which the
 * setter updates synchronously, the way an Angular signal read would.
 */
function useSynced<T>(initial: T) {
  const [value, setValue] = useState(initial)
  const ref = useRef(value)
  const set = useCallback((next: T) => {
    ref.current = next
    setValue(next)
  }, [])
  return [value, set, ref] as const
}

/**
 * The Update All modal, across all of its phases. The same list of rows carries
 * the whole run: in `plan` each row has a toggle, and from `progress` onwards
 * the toggle is replaced by that item's status. Keeping one component - and one
 * list - is what lets the rows stay put when the run starts, instead of one
 * modal closing and another opening over it.
 *
 * `plan` fetches the plan, lets the user untick anything, and starts the run.
 * The server re-validates the confirmed list against a fresh plan, so this
 * component never chooses versions - it only echoes the plan's `to` back.
 *
 * From `progress` on it renders the journal's item list live (driven by the
 * `update-all` ws namespace) with the npm output streaming into a terminal
 * pane. When the run finishes it shows the summary. The modal only ever opens
 * from its entry buttons - nothing reopens it after a page load or the UI's
 * self-restart; the journal file remains on disk as the record of the run.
 *
 * Reconnect-safe by design: `connected` fires on every (re)connect and each
 * firing re-sends `subscribe`, so a fresh server-side socket after a UI
 * self-restart is re-registered and the snapshot re-syncs anything missed.
 * Duplicated events are harmless - item statuses are idempotent.
 *
 * Must render inside the router (it hands over to /restart).
 */
export function UpdateAllModal({ activeModal, terminals = xtermFactory }: UpdateAllModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isLightTerminalTheme = useSettingsStore(() => settingsActions.getEffectiveTerminalLightingMode() === 'light')

  const [phase, setPhase, phaseRef] = useSynced<UpdateAllPhase>('loading')

  // ---- plan phase ----
  const [starting, setStarting, startingRef] = useSynced(false)
  const [plan, setPlan, planRef] = useSynced<UpdateAllPlan>(emptyPlan())
  const [showSkipped, setShowSkipped] = useState(false)
  // Names the user has unticked - everything in the plan is ticked by default
  const [unticked, setUnticked, untickedRef] = useSynced<ReadonlySet<string>>(new Set())

  // ---- run phases ----
  const [journal, setJournal, journalRef] = useSynced<UpdateAllJournal | null>(null)
  const [cancelRequested, setCancelRequested] = useState(false)
  const [disconnected, setDisconnected] = useState(false)
  /** Set once a live run's snapshot arrives - the terminal pane is created when progress renders */
  const [terminalWanted, setTerminalWanted] = useState(false)

  /** Child bridges this run restarted, and the ones confirmed back up */
  const [restartingBridges, setRestartingBridges] = useSynced<string[]>([])
  const [restartedBridges, setRestartedBridges, restartedBridgesRef] = useSynced<string[]>([])

  // The latest props and hooks, for the long-lived handlers
  const depsRef = useRef({ activeModal, navigate, t, terminals })
  depsRef.current = { activeModal, navigate, t, terminals }

  // Everything the Angular component kept as private fields
  const stateRef = useRef({
    io: null as IoNamespace | null,
    term: null as Terminal | null,
    fitAddon: null as FitAddon | null,
    connectedUnsub: null as (() => void) | null,
    listenersAttached: false,
    // Kept so teardown can detach exactly our listeners - the namespace
    // socket is cached and shared, so removeAllListeners() is off limits
    socketListeners: [] as Array<[string, Listener]>,
    /**
     * The run this modal started - a later snapshot for a DIFFERENT run (another
     * admin's) must never hijack this modal's view
     */
    runId: null as string | null,
    /**
     * Live events arriving while the subscribe ack (and its journal read) is in
     * flight - they are NEWER than the snapshot, so they replay on top of it
     */
    awaitingSnapshot: false,
    pendingEvents: [] as Array<{ name: string, status: UpdateAllItemStatus }>,
    ioChild: null as IoNamespace | null,
    childListeners: [] as Array<[string, Listener]>,
    childRestartTimer: null as ReturnType<typeof setTimeout> | null,
    planRequested: false,
  })
  const terminalTargetRef = useRef<HTMLDivElement>(null)

  const view: UpdateAllView = { phase, plan, journal, unticked, restartingBridges, restartedBridges }
  const rows = buildRows(view)
  const restartPlan = computeRestartPlan(view)
  const selectedCount = computeSelectedCount(view)
  const hasSkipped = plan.skipped.length > 0
  /** True while this modal is following child bridges back, so the summary does not repeat it */
  const watchingBridges = restartingBridges.length > 0

  /** Fetch the plan and show it for confirmation */
  const loadPlan = async () => {
    try {
      const fetched = await api.get<UpdateAllPlan>('/update-all/plan')
      // Defensive: the template reads `plan.items` directly, so a malformed
      // or empty response must still leave a plan shape behind
      setPlan({
        items: fetched?.items ?? [],
        needsReview: fetched?.needsReview ?? [],
        skipped: fetched?.skipped ?? [],
      })
      setPhase('plan')
    } catch (error) {
      console.error(error)
      toastApiError(error)
      depsRef.current.activeModal.dismiss('Dismiss')
    }
  }

  const toggleItem = (name: string) => {
    const next = new Set(untickedRef.current)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
    }
    setUnticked(next)
  }

  const setItemStatus = (name: string, status: UpdateAllItemStatus) => {
    const current = journalRef.current
    if (!current) {
      return
    }
    setJournal({
      ...current,
      items: current.items.map(x => x.name === name ? { ...x, status } : x),
    })
  }

  /**
   * Follow the restarted child bridges back using the same signal the bridges
   * widget uses - the server's restart call is fire-and-forget, so its journal
   * entry means "requested", and only this event means "actually back".
   */
  const watchChildBridges = (usernames: string[]) => {
    // One watch per modal: a ws reconnect re-runs showSummary(false), and a
    // second pass here would reset the rows to 'restarting', stack listeners
    // on the shared child-bridges socket, and orphan the running 15s timer
    if (stateRef.current.ioChild) {
      return
    }
    setRestartingBridges(usernames)
    const ioChild = ws.connectToNamespace('child-bridges')
    stateRef.current.ioChild = ioChild

    const on = (event: string, handler: Listener) => {
      stateRef.current.childListeners.push([event, handler])
      ioChild.socket.on(event, handler)
    }

    on('child-bridge-status-update', (data: { username?: string, status?: string }) => {
      if (!data?.username || !usernames.includes(data.username)) {
        return
      }
      if (data.status === 'ok' && !restartedBridgesRef.current.includes(data.username)) {
        const done = [...restartedBridgesRef.current, data.username]
        setRestartedBridges(done)
        // Every bridge is back - the give-up timer has nothing left to do
        if (stateRef.current.childRestartTimer && usernames.every(x => done.includes(x))) {
          clearTimeout(stateRef.current.childRestartTimer)
          stateRef.current.childRestartTimer = null
        }
      }
    })

    ioChild.socket.emit('monitor-child-bridge-status')

    // A bridge that never reports back would otherwise spin for ever. The same
    // 15s the bridges widget allows, after which the rows settle as restarted.
    stateRef.current.childRestartTimer = setTimeout(() => {
      setRestartedBridges(usernames)
    }, 15000)
  }

  /**
   * Re-read the journal from disk for the final statuses and restart outcomes.
   *
   * ⚠️ `handOver` is what stops a stale journal bouncing anyone to /restart.
   * The journal records what a run *asked for* - "a UI restart was scheduled" -
   * and never that it happened, so on re-reading there is no way to tell
   * "going down now" from "went down yesterday". Only a run this modal watched
   * finish is handed over; a run that turns out to be already over when the
   * snapshot arrives goes straight to the summary.
   * @param handOver - true only when this modal saw the run complete
   */
  const showSummary = async (handOver: boolean) => {
    let current = journalRef.current
    try {
      const fresh = await api.get<UpdateAllJournal | null>('/update-all/journal')
      if (fresh) {
        current = fresh
        setJournal(fresh)
      }
    } catch (error) {
      console.error(error)
    }

    // Homebridge and/or the UI going down is the restart page's job - it already
    // knows how to wait for both to come back. `restarting` tells it the restart
    // is under way so it does not trigger a second one.
    const restart = current?.restart
    // 'failed' means NO restart happened - handing over would send the user to
    // a restart page that immediately sees the old process answering 'ok' and
    // toasts a success that never occurred. The summary's failed line (asking
    // them to restart manually) is the honest outcome, so stay for it
    const homebridgeRestarting = restart?.homebridge === 'done'
    const uiRestarting = restart?.ui === 'scheduled'
    if (handOver && (homebridgeRestarting || uiRestarting)) {
      // 'handover' tells the opener NOT to refresh - the server is going down
      // right now, and a reload taken mid-restart caches pre-update state
      const { activeModal: modal, navigate: go } = depsRef.current
      modal.close('handover')
      const search = new URLSearchParams({ restarting: 'true', ...(uiRestarting ? { uiRestarting: 'true' } : {}) })
      void go({ pathname: '/restart', search: `?${search}` })
      return
    }

    // Only child bridges restarted, so the modal stays put and follows them
    // back one by one, in place of each plugin's update status.
    if (restart?.childBridges === 'done') {
      const usernames = [...new Set((current?.items ?? [])
        .filter(x => x.status === 'ok')
        .flatMap(x => x.childBridgeUsernames ?? []))]
      if (usernames.length) {
        watchChildBridges(usernames)
      }
    }

    setPhase('summary')
  }

  const subscribeToRun = async () => {
    try {
      stateRef.current.awaitingSnapshot = true
      const snapshot = await stateRef.current.io!.request<UpdateAllSnapshot>('subscribe')

      // The journal file holds the LATEST run only. On a reconnect it can be
      // another admin's newer run - ignore it rather than rendering a run
      // this user never confirmed on top of their own plan rows
      if (stateRef.current.runId && snapshot.journal && snapshot.journal.runId !== stateRef.current.runId) {
        return
      }
      if (snapshot.journal) {
        stateRef.current.runId = snapshot.journal.runId
        setJournal(snapshot.journal)
      }
      // Events the gateway emitted while its snapshot read was in flight were
      // DELIVERED BEFORE this ack (socket order) - they are newer than the
      // snapshot, so apply them on top instead of letting it regress a row
      for (const event of stateRef.current.pendingEvents) {
        setItemStatus(event.name, event.status)
      }

      // Once this modal has settled on its summary, a reconnect must not drag
      // it back to progress or re-run the summary's side effects
      if (phaseRef.current === 'summary') {
        return
      }
      if (snapshot.active) {
        setPhase('progress')
        // the terminal pane only exists once the progress branch has rendered
        setTerminalWanted(true)
      } else {
        // The run was already over when we attached, so any restart it called
        // for has long since happened - show what it did, do not hand over
        await showSummary(false)
      }
    } catch (error) {
      console.error(error)
      toastApiError(error)
      depsRef.current.activeModal.dismiss('Dismiss')
    } finally {
      stateRef.current.awaitingSnapshot = false
      stateRef.current.pendingEvents = []
    }
  }

  const attachSocketListeners = () => {
    if (stateRef.current.listenersAttached) {
      return
    }
    stateRef.current.listenersAttached = true
    const io = stateRef.current.io!

    const on = (event: string, handler: Listener) => {
      stateRef.current.socketListeners.push([event, handler])
      io.socket.on(event, handler)
    }

    const applyOrBuffer = (name: string, status: UpdateAllItemStatus) => {
      if (stateRef.current.awaitingSnapshot) {
        stateRef.current.pendingEvents.push({ name, status })
        return
      }
      setItemStatus(name, status)
    }
    on('item-start', (payload: { name: string }) => applyOrBuffer(payload.name, 'running'))
    on('item-result', (payload: { name: string, status: UpdateAllItemStatus }) => applyOrBuffer(payload.name, payload.status))
    on('stdout', (payload: { name: string, data: string }) => stateRef.current.term?.write(payload.data))
    on('run-complete', () => void showSummary(true))
    // While the UI updates itself the server goes away for a few seconds -
    // say so instead of appearing frozen. The reconnect re-subscribes above.
    on('disconnect', () => setDisconnected(true))
  }

  /** Attach to the run's ws feed once /start has been accepted */
  const enterRun = () => {
    // Deliberately NOT via 'loading': the rows are already on screen and must
    // stay there. `rows` keeps showing the ticked plan items until the
    // journal's own list arrives to replace them.
    setPhase('progress')
    const io = ws.connectToNamespace('update-all')
    stateRef.current.io = io
    stateRef.current.connectedUnsub = io.connected.subscribe(() => {
      setDisconnected(false)
      void subscribeToRun()
    })
    attachSocketListeners()
  }

  /**
   * Start the run and move this same modal on to the progress phase. The rows
   * already on screen stay exactly where they are - only their right-hand cell
   * changes from a toggle to a status.
   */
  const confirm = async () => {
    const currentView = { ...view, plan: planRef.current, unticked: untickedRef.current }
    if (computeSelectedCount(currentView) === 0 || startingRef.current) {
      return
    }
    setStarting(true)
    const items = planRef.current.items.filter(x => isTicked(currentView, x.name)).map(x => ({ name: x.name, to: x.to }))

    try {
      await api.post('/update-all/start', { items })
      enterRun()
    } catch (error) {
      console.error(error)
      toastApiError(error)
      setStarting(false)
    }
  }

  /** Ask the server to stop after the item npm is currently updating */
  const cancelRun = async () => {
    setCancelRequested(true)
    try {
      await api.post('/update-all/cancel', {})
    } catch (error) {
      console.error(error)
      toastApiError(error)
      setCancelRequested(false)
    }
  }

  const dismissModal = () => activeModal.dismiss('Dismiss')
  const closeModal = () => activeModal.close('done')

  useEffect(() => {
    if (!stateRef.current.planRequested) {
      stateRef.current.planRequested = true
      void loadPlan()
    }
    // Once per modal: loadPlan only reads refs and stable setters
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  useEffect(() => {
    const state = stateRef.current
    if (phase !== 'progress' || !terminalWanted || state.term || !terminalTargetRef.current) {
      return
    }
    const { terminals: factory } = depsRef.current
    state.fitAddon = factory.createFitAddon()
    state.term = factory.createTerminal(settingsActions.getTerminalOptions({ disableStdin: true }))
    state.term.loadAddon(state.fitAddon)
    state.term.open(terminalTargetRef.current)
    state.fitAddon.fit()
  }, [phase, terminalWanted])

  useEffect(() => {
    const state = stateRef.current
    return () => {
      state.connectedUnsub?.()
      state.connectedUnsub = null
      for (const [event, handler] of state.socketListeners) {
        state.io?.socket.off(event, handler)
      }
      state.socketListeners = []
      state.listenersAttached = false
      state.term?.dispose()
      state.term = null
      state.io?.end?.()
      state.io = null
      if (state.childRestartTimer) {
        clearTimeout(state.childRestartTimer)
        state.childRestartTimer = null
      }
      for (const [event, handler] of state.childListeners) {
        state.ioChild?.socket.off(event, handler)
      }
      state.childListeners = []
      state.ioChild?.end?.()
      state.ioChild = null
    }
  }, [])

  const restartLine = restartPlan.ui
    ? t('update_all.restart_homebridge_and_ui')
    : restartPlan.homebridge
      ? t('update_all.restart_homebridge')
      : restartPlan.childBridgeCount === 1
        ? t('update_all.restart_child_bridges_one')
        : restartPlan.childBridgeCount > 1
          ? t('update_all.restart_child_bridges', { count: restartPlan.childBridgeCount })
          : t('update_all.restart_none')

  return (
    <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="update-all-modal-title">
      <ModalHeader title={t('update_all.title')} titleId="update-all-modal-title" onClose={closeModal} />
      <div className="modal-body">
        {phase === 'loading'
          ? (
              <div className="text-center py-4">
                <i className="fas fa-lg fa-circle-notch fa-spin primary-text" aria-hidden="true"></i>
              </div>
            )
          : (
              <>
                <div className="text-center mb-3">
                  <i className="fas fa-arrow-alt-circle-up primary-text icon-xl" aria-hidden="true"></i>
                  <div className="mt-3">
                    <span className="badge badge-beta">{t('common.labels.beta')}</span>
                  </div>
                </div>

                {phase === 'plan' && rows.length === 0
                  ? <p className="text-center grey-text my-3">{t('update_all.empty')}</p>
                  : (
                      <>
                        {/*
                          Stays on screen for every phase. Dropping it when the run starts would
                          pull the whole list up under the user's cursor, and the restart line
                          still has something to say - it narrows as items fail or are skipped.
                        */}
                        <ul className="mb-3">
                          <li>{t('update_all.description')}</li>
                          <li>{t('update_all.description_2')}</li>
                          {/*
                            Exactly one line, always, picked by the widest restart the selection
                            calls for. The three scopes contain each other - restarting the UI
                            takes the whole service down with it, which restarts Homebridge,
                            which restarts every child bridge - so only the widest is worth
                            saying, and the list never changes height.
                          */}
                          <li>{restartLine}</li>
                        </ul>

                        {/*
                          One list for every phase. The rows do not move when the run starts -
                          only the right-hand cell changes, from a toggle to that item's status.
                        */}
                        <ul className="list-group list-group-box mb-0" role="status" aria-live="polite">
                          {rows.map((item) => {
                            const line = rowLine(view, item)
                            const icon = rowIcon(view, item)
                            const name = item.displayName || item.name
                            const selectable = isSelectable(view, item)
                            return (
                              <li key={item.name} className="list-group-item d-flex justify-content-between align-items-center flex-row pb-2">
                                <UpdateAllItemRow displayName={name} icon={item.icon} note={t(line.key, line.params)} />
                                {selectable || item.excluded || item.needsReview
                                  ? (
                                      // A row that is not part of the run keeps its toggle, disabled -
                                      // it stays in the list so nothing moves, and the toggle says
                                      // plainly that it is not included. A major jump is never
                                      // selectable at all, and says why under its versions.
                                      <div className="text-end grey-text d-flex align-items-center">
                                        <input
                                          type="checkbox"
                                          className="rendux-input"
                                          id={`update-all-item-${item.name}`}
                                          checked={!item.needsReview && isTicked(view, item.name)}
                                          disabled={!selectable}
                                          aria-label={selectable ? name : `${name}: ${t('update_all.status_excluded')}`}
                                          onChange={() => toggleItem(item.name)}
                                        />
                                        <label className="rendux-label ms-3" htmlFor={`update-all-item-${item.name}`}></label>
                                      </div>
                                    )
                                  : (
                                      <div className="text-end d-flex align-items-center flex-shrink-0">
                                        {/* Icon only: the label is the accessible name and the tooltip */}
                                        <span role="img" aria-label={t(icon.label)} title={t(icon.label)}>
                                          <i aria-hidden="true" className={icon.classes}></i>
                                        </span>
                                      </div>
                                    )}
                              </li>
                            )
                          })}
                        </ul>
                      </>
                    )}

                {phase === 'plan'
                  ? hasSkipped && (
                    <>
                      <button
                        type="button"
                        className="btn btn-link p-0 text-decoration-none primary-text small d-block mt-3"
                        aria-controls="update-all-skipped"
                        aria-expanded={showSkipped}
                        onClick={() => setShowSkipped(!showSkipped)}
                      >
                        <i className={cx('fas fa-chevron-down me-1', showSkipped && 'fa-rotate-180')} aria-hidden="true"></i>
                        {t('update_all.label_skipped', { count: plan.skipped.length })}
                      </button>
                      {showSkipped && (
                        <ul id="update-all-skipped" className="list-group list-group-box mt-2 mb-0">
                          {plan.skipped.map(item => (
                            <li key={item.name} className="list-group-item d-flex align-items-center flex-row pb-2">
                              {/* The same row component as the main list, so the two cannot drift */}
                              <UpdateAllItemRow
                                displayName={item.displayName || item.name}
                                icon={item.icon}
                                note={t(`update_all.reason_${item.reason}`)}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )
                  : (
                      <>
                        {phase === 'progress' && (
                          <>
                            <div
                              id="update-all-log-output"
                              ref={terminalTargetRef}
                              className={cx('mt-3', isLightTerminalTheme ? 'terminal-light-bg' : 'terminal-dark-bg')}
                              aria-hidden="true"
                            >
                            </div>
                            {disconnected && <p className="orange-text small mt-2 mb-0">{t('update_all.reconnecting')}</p>}
                            {cancelRequested && <p className="grey-text small mt-2 mb-0">{t('update_all.stopping')}</p>}
                          </>
                        )}

                        {phase === 'summary' && journal && (
                          <div className="mt-3">
                            {journal.restart.homebridge === 'done' && (
                              <p className="small mb-1">{t('update_all.summary_restart_homebridge_done')}</p>
                            )}
                            {journal.restart.homebridge === 'failed' && (
                              <p className="orange-text small mb-1">{t('update_all.summary_restart_homebridge_failed')}</p>
                            )}
                            {journal.restart.ui === 'scheduled' && (
                              <p className="small mb-1">{t('update_all.summary_restart_ui')}</p>
                            )}
                            {journal.restart.childBridges === 'done' && !watchingBridges && (
                              <p className="small mb-1">{t('update_all.summary_restart_child_bridges_done')}</p>
                            )}
                            {journal.restart.childBridges === 'failed' && (
                              <p className="orange-text small mb-1">{t('update_all.summary_restart_child_bridges_failed')}</p>
                            )}
                          </div>
                        )}
                      </>
                    )}
              </>
            )}
      </div>
      <ModalFooter>
        <div className="text-start">
          {phase === 'plan' && (
            <button
              type="button"
              className="btn btn-elegant"
              data-bs-dismiss="modal"
              aria-label={t('form.button_close')}
              onClick={dismissModal}
            >
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-center">
          {phase === 'progress' && (
            <button type="button" className="btn btn-elegant" disabled={cancelRequested} onClick={() => void cancelRun()}>
              {t('update_all.button_stop')}
            </button>
          )}
          {/* Close is the summary's only button, so it sits centred, not cornered */}
          {phase === 'summary' && (
            <button type="button" className="btn btn-primary" onClick={closeModal}>
              {t('form.button_close')}
            </button>
          )}
        </div>
        <div className="text-end">
          {/*
            Shown for the whole plan phase, disabled when there is nothing to run -
            including when every update is a major, which cannot be selected. The
            footer keeps one shape, and a disabled button says why you cannot go on
            where a missing one says nothing at all.
          */}
          {phase === 'plan' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedCount === 0 || starting}
              onClick={() => void confirm()}
            >
              {starting && <i className="fas fa-circle-notch fa-spin me-1" aria-hidden="true"></i>}
              {selectedCount === 1
                ? t('update_all.button_update_one')
                : t('update_all.button_update_many', { count: selectedCount })}
            </button>
          )}
        </div>
      </ModalFooter>
    </div>
  )
}
