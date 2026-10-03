import type { MouseEvent as ReactMouseEvent } from 'react'

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { lt } from 'semver'

import { authActions, useAuthStore } from '@/core/auth'
import { Confirm } from '@/core/components/confirm/Confirm'
import { settingsActions, useSettingsStore } from '@/core/settings'
import { openModal } from '@/core/ui/modal'
import { ws } from '@/core/ws'
import { environment } from '@/environments/environment'
import { Sidebar } from '@/shared/layout/sidebar/Sidebar'

import './layout.scss'

/** The signed-in shell: the side menu and the routed page (LayoutComponent). */
export function Layout() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname

  const [sidebarExpanded] = useState(false)

  // HTTPS is configured but the server fell back to plain HTTP. Only an admin
  // can fix the SSL settings, so only an admin is told.
  const isAdmin = useAuthStore(s => !!s.user?.admin)
  const sslError = useSettingsStore(s => s.env.ssl?.startupError)
  const sslStartupError = isAdmin ? (sslError ?? null) : null

  useEffect(() => {
    const io = ws.connectToNamespace('app')
    let lastReconnectCheck = 0

    const reconnectHandler = () => {
      // Cooldown between checkToken calls. On a rolling restart the socket can
      // flap several times within a few seconds — each flap firing checkToken
      // meant a 401 storm against a backend that's still starting up, and any
      // one of those 401s reloads the page. The loop self-perpetuates after
      // reload because the fresh socket immediately reconnects too. Throttle
      // to once every 5 s.
      const now = Date.now()
      if (now - lastReconnectCheck < 5000) {
        return
      }
      lastReconnectCheck = now
      authActions.checkToken().catch(() => { /* handled by checkToken */ })
    }

    // ⚠️ `reconnect` is a Manager event in socket.io-client 4.x — it is only
    // emitted on `socket.io`, never on the Socket, so a listener on the socket
    // itself never fires.
    io.socket.io.on('reconnect', reconnectHandler)

    return () => {
      // Detach the reconnect handler and release the cached `app` namespace.
      // Without this, logout-then-login would mount a fresh layout that
      // registers a second reconnect listener on top of the old one, so a
      // single reconnect would fire `checkToken` twice.
      io.socket?.io?.off('reconnect', reconnectHandler)
      io.end?.()
    }
  }, [])

  // A server running older code than the page: the service was updated but
  // never restarted
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await settingsActions.whenLoaded()
      const { uiVersion } = useSettingsStore.getState()
      if (cancelled || pathRef.current.endsWith('/restart') || !uiVersion || !lt(uiVersion, environment.serverTarget)) {
        return
      }
      // eslint-disable-next-line no-console
      console.log(`Server restart required. UI Version: ${environment.serverTarget} - Server Version: ${uiVersion} `)
      const ref = openModal(Confirm, {
        title: t('platform.version.service_restart_required'),
        message: t('platform.version.restart_required', {
          serverVersion: uiVersion,
          uiVersion: environment.serverTarget,
        }),
        confirmButtonLabel: t('menu.tooltip_restart'),
        faIconClass: 'fas fa-power-off orange-text',
      }, {
        size: 'lg',
        backdrop: 'static',
        // Block ESC. Letting this modal dismiss silently leaves the user
        // looking at a half-broken UI that the version-mismatch path was about
        // to walk them through.
        keyboard: false,
      })

      try {
        await ref.result
        void navigate('/restart')
      } catch {
        // Modal dismissed, do nothing
      }
    })()
    return () => {
      cancelled = true
    }
    // Once per shell, like ngOnInit
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  // A hash link would go through the router: move focus to the page instead
  const skipToContent = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    document.getElementById('main-content')?.focus()
  }

  return (
    <div className="hb-layout">
      <a className="skip-link" href="#main-content" onClick={skipToContent}>{t('layout.skip_to_content')}</a>
      <Sidebar initialIsExpanded={sidebarExpanded} />
      <main id="main-content" tabIndex={-1} className={`content px-3 p-md-4${sidebarExpanded ? ' sidebarExpanded' : ''}`}>
        {sslStartupError && (
          <div className="alert alert-warning" role="alert">
            <i className="fas fa-fw fa-triangle-exclamation me-1"></i>
            {t('layout.ssl_fallback_warning', { reason: sslStartupError })}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}
