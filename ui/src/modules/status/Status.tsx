import type { StatusStoreApi } from './status.store'

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'

import { useAuthStore } from '@/core/auth'
import { Spinner } from '@/core/components/spinner/Spinner'
import { settingsActions } from '@/core/settings'
import { HoverTooltip } from '@/core/ui/HoverTooltip'
import { useCanDeactivate } from '@/core/utilities/terminal'
import { ws } from '@/core/ws'

import { DashboardGrid } from './DashboardGrid'
import { createStatusStore } from './status.store'

import './status.scss'

export interface StatusProps {
  /** For specs: a prepared store instead of a fresh one. */
  store?: StatusStoreApi
}

/** The reorder listbox shown in place of the grid in keyboard reorder mode. */
function ReorderList({ store }: { store: StatusStoreApi }) {
  const { t } = useTranslation()
  const dashboard = useStore(store, s => s.dashboard)
  const selected = useStore(store, s => s.selectedReorderComponent)
  const showReorderHelp = useStore(store, s => s.showReorderHelp)
  const actions = store.getState()
  const components = dashboard
    .map(x => x?.component)
    .filter((c): c is string => typeof c === 'string' && c.length > 0)

  return (
    <div className="col-12 mb-3">
      <div className="text-center mb-2">
        <span className="badge badge-beta">{t('common.labels.beta')}</span>
      </div>
      <ul className="list-group list-group-box" role="listbox" aria-label={t('status.reorder.listbox_label')}>
        {components.map((component, index) => (
          <li
            key={component}
            className="list-group-item d-flex justify-content-between align-items-center"
            role="option"
            id={`reorder-item-${component}`}
            tabIndex={component === selected ? 0 : -1}
            aria-selected={component === selected}
            aria-label={actions.getReorderItemAriaLabel(component)}
            aria-describedby={showReorderHelp && component === selected ? 'reorder-instructions' : undefined}
            onFocus={() => actions.setSelectedReorderComponent(component)}
            onKeyDown={event => actions.onReorderKeydown(event)}
          >
            <span className="pe-2" aria-hidden="true">{actions.getWidgetDisplayName(component)}</span>
            <span className="btn-group reorder-controls" role="group" aria-hidden="true">
              <button
                type="button"
                className="btn btn-primary waves-effect py-1"
                tabIndex={-1}
                disabled={index === 0}
                onClick={() => actions.moveComponent(component, -1)}
              >
                <i className="fas fa-chevron-up" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                className="btn btn-primary waves-effect py-1"
                tabIndex={-1}
                disabled={index === components.length - 1}
                onClick={() => actions.moveComponent(component, 1)}
              >
                <i className="fas fa-chevron-down" aria-hidden="true"></i>
              </button>
            </span>
          </li>
        ))}
      </ul>
      <span id="reorder-instructions" className="visually-hidden">{t('status.reorder.help')}</span>
    </div>
  )
}

/**
 * The status page: a grid of widgets whose layout is loaded from and saved to
 * the server over the `status` socket, with layout editing, a keyboard reorder
 * mode, and the show / hide and per-widget settings modals.
 */
export function Status({ store: givenStore }: StatusProps = {}) {
  const { t } = useTranslation()
  const [store] = useState(() => givenStore ?? createStatusStore())
  const isAdmin = useAuthStore(s => !!s.user?.admin)

  const consoleStatus = useStore(store, s => s.consoleStatus)
  const dashboardLength = useStore(store, s => s.dashboard.length)
  const isUnlocked = useStore(store, s => s.isUnlocked)
  const reorderMode = useStore(store, s => s.reorderMode)
  const page = useStore(store, s => s.page)
  const actionLiveMessage = useStore(store, s => s.actionLiveMessage)
  const [currentYear] = useState(() => new Date().getFullYear())
  const actions = store.getState()

  useEffect(() => {
    // Status page should only show instance name
    settingsActions.setPageTitle()
  }, [])

  useEffect(() => {
    const io = ws.connectToNamespace('status')
    const disconnect = store.getState().connect(io)
    return () => {
      disconnect()
      io.end?.()
    }
  }, [store])

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        store.getState().onEscapeKey()
      }
    }
    // Any terminal widget may need to warn before the tab closes
    const onBeforeUnload = (event: BeforeUnloadEvent) => store.getState().onBeforeUnload(event)
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('keydown', onKeydown)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [store])

  useCanDeactivate(() => store.getState().canDeactivate())

  const showEditButtons = isUnlocked || page.showWidgetConfigure

  return (
    <div className="hb-status">
      <div className="visually-hidden" role="status" aria-atomic="true">{actionLiveMessage}</div>
      <div className="row mb-3">
        <div className="col-6">
          <h3 className="primary-text m-0">{t('menu.label_status')}</h3>
        </div>
        {consoleStatus === 'up' && isAdmin && (
          <div className="col-6 text-end">
            <div className="btn-group" role="group">
              {showEditButtons && (
                <HoverTooltip text={t('status.widget.show_hide')} placement="bottom">
                  <button
                    type="button"
                    className="btn btn-elegant my-0"
                    disabled={reorderMode}
                    aria-label={t('status.widget.show_hide')}
                    onClick={() => void actions.addWidget()}
                  >
                    <i className="fas fa-eye-low-vision" aria-hidden="true"></i>
                  </button>
                </HoverTooltip>
              )}
              {(showEditButtons || reorderMode) && (
                <HoverTooltip text={t(reorderMode ? 'status.reorder.exit_button' : 'status.reorder.enter_button')} placement="bottom">
                  <button
                    id="reorder-toggle-button"
                    type="button"
                    className="btn btn-elegant my-0"
                    aria-label={t(reorderMode ? 'status.reorder.exit_button' : 'status.reorder.enter_button_label')}
                    aria-pressed={reorderMode}
                    onClick={() => actions.toggleReorderMode()}
                  >
                    <i aria-hidden="true" className={`fas fa-arrow-down-up-across-line${reorderMode ? ' primary-text' : ''}`}></i>
                  </button>
                </HoverTooltip>
              )}
            </div>
            <HoverTooltip text={t(isUnlocked ? 'status.layout.done' : 'status.layout.edit')} placement="bottom">
              <button
                type="button"
                className={`btn btn-elegant my-0 ms-2 d-none d-sm-inline-flex layout-edit-toggle${isUnlocked ? ' active' : ''}`}
                aria-label={t(isUnlocked ? 'status.layout.done' : 'status.layout.edit')}
                aria-pressed={isUnlocked}
                onClick={() => actions.toggleLayoutEditing()}
              >
                <i aria-hidden="true" className={isUnlocked ? 'fas fa-check' : 'fas fa-table-cells-large'}></i>
              </button>
            </HoverTooltip>
          </div>
        )}
      </div>
      {isUnlocked && !reorderMode && (
        <div className="layout-edit-bar d-none d-sm-flex" role="status">
          <i className="fas fa-up-down-left-right" aria-hidden="true"></i>
          <span className="layout-edit-hint">{t('status.layout.editing_hint')}</span>
          <button type="button" className="btn btn-elegant btn-sm ms-auto" onClick={() => actions.cancelLayoutEditing()}>
            {t('form.button_cancel')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => actions.lockLayout()}>
            {t('status.layout.done')}
          </button>
        </div>
      )}
      <div className="status-container d-flex flex-column mt-0">
        {consoleStatus === 'down' && <Spinner />}
        <div className="row flex-column flex-grow-1">
          {dashboardLength > 0 && (
            <>
              {reorderMode && isAdmin && <ReorderList store={store} />}
              <DashboardGrid store={store} hidden={consoleStatus === 'down' || reorderMode} />
            </>
          )}
        </div>
        <div className="row mb-auto">
          <div className="col-md-12 text-center px-4 pt-1 pt-lg-2 pb-3 pb-lg-2 grey-text">
            <small>
              &copy;
              {' '}
              {currentYear}
              {' '}
              &middot;
              {' '}
              <a className="grey-text" target="_blank" rel="noopener noreferrer" href="https://github.com/homebridge/homebridge">
                Homebridge
              </a>
              {' '}
              &middot;
              {' '}
              <a className="grey-text" target="_blank" rel="noopener noreferrer" href="https://github.com/mp-consulting/homebridge-config-glass-ui">
                Homebridge Glass UI
              </a>
              {' '}
              &middot;
              {' '}
              <button type="button" className="icon-button-reset grey-text" aria-label={t('status.credits.title')} onClick={() => actions.openCreditsModal()}>
                <i className="fas fa-heart" aria-hidden="true"></i>
              </button>
            </small>
          </div>
        </div>
      </div>
    </div>
  )
}
