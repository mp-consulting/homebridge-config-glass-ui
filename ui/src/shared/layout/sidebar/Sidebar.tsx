import type { MouseEvent as ReactMouseEvent } from 'react'

import { isStandalonePWA } from 'is-standalone-pwa'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useNavigation } from 'react-router'

import { authActions, useAuthStore } from '@/core/auth'
import { Information } from '@/core/components/information/Information'
import { notifications, useNotification } from '@/core/notifications'
import { useSettingsStore } from '@/core/settings'
import { openModal } from '@/core/ui/modal'
import { toast } from '@/core/ui/toast'
import { handleMenuKeydown } from '@/shared/layout/sidebar/menu-keydown'

import './sidebar.scss'

export interface SidebarProps {
  initialIsExpanded?: boolean
}

const MOBILE_MAX_WIDTH = 768

/** The page behind the menu. Rendered by the layout as the sidebar's sibling. */
function contentElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.content')
}

/** The app's side menu (SidebarComponent). */
export function Sidebar({ initialIsExpanded = false }: SidebarProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const navigation = useNavigation()

  const isAdmin = useAuthStore(s => !!s.user?.admin)
  const settingsFormAuth = useSettingsStore(s => s.formAuth)
  const menuMode = useSettingsStore(s => s.menuMode)
  const enableTerminalAccess = useSettingsStore(s => s.env.enableTerminalAccess)
  const restrictLogsToAdmins = useSettingsStore(s => s.env.restrictLogsToAdmins)
  const canViewLogs = !restrictLogsToAdmins || isAdmin

  // Sticky for the session: once the pi has reported under-voltage, the warning stays
  const [rPiCurrentlyUnderVoltage, setRPiCurrentlyUnderVoltage] = useState(() => !!notifications.get('raspberryPiThrottled')['Under Voltage'])
  const [rPiWasUnderVoltage, setRPiWasUnderVoltage] = useState(() => !!notifications.get('raspberryPiThrottled')['Under-voltage has occurred'])
  useNotification('raspberryPiThrottled', (throttled) => {
    if (throttled['Under Voltage']) {
      setRPiCurrentlyUnderVoltage(true)
    }
    if (throttled['Under-voltage has occurred']) {
      setRPiWasUnderVoltage(true)
    }
  })
  // Null until the settings page says otherwise
  const formAuthEnabled = useNotification('formAuthEnabled')
  const formAuth = formAuthEnabled ?? settingsFormAuth
  const legacyOtpDetected = useNotification('legacyOtpDetected')

  const [isExpanded, setIsExpanded] = useState(initialIsExpanded)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_MAX_WIDTH)
  // The touch (phone) or click (desktop) listeners are chosen once, when the
  // menu is created, and not switched on resize
  const [startedMobile] = useState(() => window.innerWidth < MOBILE_MAX_WIDTH)
  const [isPwa] = useState(() => isStandalonePWA())

  // The listeners read these synchronously, as the Angular signals were read
  const expandedRef = useRef(isExpanded)
  const freezeRef = useRef(false)
  const legacyOtpToastShownRef = useRef(false)

  const sidebarRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)

  const setExpanded = (value: boolean) => {
    expandedRef.current = value
    setIsExpanded(value)
  }
  const openSidebar = () => {
    if (!freezeRef.current) {
      setExpanded(true)
    }
  }
  const closeSidebar = () => {
    if (!freezeRef.current) {
      setExpanded(false)
    }
  }
  const toggleSidebar = () => {
    if (!freezeRef.current) {
      setExpanded(!expandedRef.current)
    }
  }
  // Stable handles for the DOM listeners below
  const actionsRef = useRef({ openSidebar, closeSidebar, toggleSidebar })
  actionsRef.current = { openSidebar, closeSidebar, toggleSidebar }

  // Dim the page behind the open menu and take its pointer events
  useEffect(() => {
    const content = contentElement()
    if (!content) {
      return
    }
    if (isExpanded) {
      content.style.setProperty('opacity', '20%')
      content.style.setProperty('pointer-events', 'none')
      content.style.setProperty('overflow', 'hidden')
    } else {
      content.style.removeProperty('opacity')
      content.style.removeProperty('pointer-events')
      content.style.removeProperty('overflow')
    }
  }, [isExpanded])

  useEffect(() => {
    // Only show the toast once
    if (!legacyOtpDetected || legacyOtpToastShownRef.current) {
      return undefined
    }
    legacyOtpToastShownRef.current = true

    // Delay the toast to avoid overwhelming the user on page load
    let timerPending = true
    const timer = setTimeout(() => {
      timerPending = false
      const warning = toast.warning(
        t('users.toast_legacy_otp_message'),
        t('users.toast_legacy_otp_title'),
        {
          timeOut: 0,
          tapToDismiss: true,
          disableTimeOut: true,
        },
      )
      warning?.onTap?.subscribe(() => {
        void navigate('/users')
      })
    }, 3000)
    return () => {
      // Torn down before it showed: let a remount show it instead
      if (timerPending) {
        clearTimeout(timer)
        legacyOtpToastShownRef.current = false
      }
    }
  }, [legacyOtpDetected, navigate, t])

  // Re-pick the mouse listeners after a resize settles
  const [resizeTick, setResizeTick] = useState(0)
  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        setIsMobile(window.innerWidth < MOBILE_MAX_WIDTH)
        setResizeTick(tick => tick + 1)
      }, 500)
    }
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(resizeTimeout)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // Hover opens the menu on a desktop, unless the user froze it open/closed
  useEffect(() => {
    if (startedMobile && resizeTick === 0) {
      return undefined
    }
    const sidebar = sidebarRef.current
    if (!sidebar || !(isMobile || menuMode !== 'freeze')) {
      return undefined
    }
    const enter = () => actionsRef.current.openSidebar()
    const leave = () => actionsRef.current.closeSidebar()
    sidebar.addEventListener('mouseenter', enter, { passive: false })
    sidebar.addEventListener('mouseleave', leave, { passive: false })
    return () => {
      sidebar.removeEventListener('mouseenter', enter)
      sidebar.removeEventListener('mouseleave', leave)
    }
  }, [isMobile, menuMode, resizeTick, startedMobile])

  // The phone closes on a tap outside the menu, the desktop on a click past the
  // collapsed strip and opens when the pointer reaches the header
  useEffect(() => {
    const sidebar = sidebarRef.current!
    const mobileHeader = headerRef.current!

    if (startedMobile) {
      const touchstartListener = (e: TouchEvent) => {
        const target = e.target as HTMLElement
        if (contentElement()?.contains(target) && expandedRef.current) {
          // Swallowed, or the tap that closes the menu also presses whatever
          // was underneath it
          e.preventDefault()
          actionsRef.current.toggleSidebar()
          return
        }

        if (!sidebar.contains(target) && !mobileHeader.contains(target) && expandedRef.current) {
          e.preventDefault()
          actionsRef.current.closeSidebar()
        }
      }
      document.addEventListener('touchstart', touchstartListener, { passive: false })
      return () => {
        document.removeEventListener('touchstart', touchstartListener)
      }
    }

    const enter = () => actionsRef.current.openSidebar()
    const leave = () => actionsRef.current.closeSidebar()
    mobileHeader.addEventListener('mouseenter', enter, { passive: false })
    mobileHeader.addEventListener('mouseleave', leave, { passive: false })

    const clickListener = (e: MouseEvent) => {
      if (sidebar.contains(e.target as HTMLElement) && e.clientX > 60) {
        actionsRef.current.closeSidebar()
      }
    }
    document.addEventListener('click', clickListener, { passive: false })
    return () => {
      mobileHeader.removeEventListener('mouseenter', enter)
      mobileHeader.removeEventListener('mouseleave', leave)
      document.removeEventListener('click', clickListener)
    }
  }, [startedMobile])

  // Check authentication before navigation: with form auth on, a token that
  // expired while the page sat open would otherwise let the user click into a
  // page that then fails every request
  const pending = navigation.state === 'loading' ? navigation.location : undefined
  useEffect(() => {
    if (!pending || !useSettingsStore.getState().formAuth || pending.pathname === '/login') {
      return
    }
    let cancelled = false
    void authActions.isAuthenticated().then((isAuthenticated) => {
      if (!isAuthenticated && !cancelled) {
        // Store the target route before redirecting
        window.sessionStorage.setItem('target_route', `${pending.pathname}${pending.search}${pending.hash}`)
        void navigate('/login')
      }
    })
    return () => {
      cancelled = true
    }
  }, [pending, navigate])

  // Ensure the menu closes when we navigate, and stays shut briefly so the
  // pointer left where the menu was does not open it again
  const firstLocationRef = useRef(true)
  useEffect(() => {
    if (firstLocationRef.current) {
      firstLocationRef.current = false
      return undefined
    }
    actionsRef.current.closeSidebar()
    freezeRef.current = true
    const timer = setTimeout(() => {
      freezeRef.current = false
    }, 750)
    return () => {
      clearTimeout(timer)
      freezeRef.current = false
    }
  }, [location.key])

  const openUnderVoltageModal = () => {
    openModal(Information, {
      title: t('rpi.throttled.undervoltage_title'),
      message: t(rPiCurrentlyUnderVoltage
        ? 'rpi.throttled.currently_message'
        : 'rpi.throttled.previously_message'),
      ctaButtonLabel: t('form.button_more_info'),
      faIconClass: 'fas fa-bolt yellow-text',
      ctaButtonLink: 'https://pimylifeup.com/raspberry-pi-low-voltage-warning',
    }, {
      size: 'lg',
      backdrop: 'static',
    })
  }

  const isActive = (path: string, exact = false) => exact
    ? location.pathname === path
    : location.pathname === path || location.pathname.startsWith(`${path}/`)

  const linkLabel = (label: string, active: boolean) => label + (active ? `, ${t('menu.current_page')}` : '')

  const navButton = (path: string, label: string, icon: string, exact = false) => {
    const active = isActive(path, exact)
    return (
      <div className="link">
        <button
          type="button"
          className={`link-row${active ? ' active' : ''}`}
          aria-label={linkLabel(label, active)}
          onClick={() => void navigate(path)}
        >
          <div className="icon"><i aria-hidden="true" className={icon}></i></div>
          <div className="title">{label}</div>
        </button>
      </div>
    )
  }

  const goHome = (e: ReactMouseEvent) => {
    e.preventDefault()
    void navigate('/')
  }

  return (
    <>
      <div
        ref={headerRef}
        className="m-header text-end"
        tabIndex={isMobile ? 0 : -1}
        role={isMobile ? 'button' : undefined}
        aria-hidden={isMobile ? undefined : 'true'}
        aria-expanded={isMobile ? (isExpanded ? 'true' : 'false') : undefined}
        aria-controls={isMobile ? 'sidebar' : undefined}
        aria-label={isMobile ? t('menu.sidebar.aria_menu') : undefined}
        onClick={toggleSidebar}
        onKeyDown={handleMenuKeydown}
      >
        <span className="me-2 d-block d-lg-none m-header-label"></span>
        <a tabIndex={-1} aria-hidden="true" href="./" onClick={goHome}>
          <img className="hb-logo-img" src="assets/homebridge-logo.svg" alt="" height="35" width="35" loading="lazy" />
          <span className="glass-logo" aria-hidden="true"></span>
          <div className="hb-logo-text-mobile">Homebridge</div>
        </a>
        <div aria-hidden="true" className={`hamburger-icon${isExpanded ? ' hamburger-icon-cross' : ''}`}>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>

      <div
        ref={sidebarRef}
        className={`sidebar${isExpanded ? ' expanded' : ''}`}
        id="sidebar"
        role={isMobile ? undefined : 'navigation'}
        aria-label={isMobile ? undefined : t('menu.sidebar.aria_menu')}
        // A closed phone menu is off screen: keep its links out of the tab order
        inert={isMobile && !isExpanded}
      >
        <div className="header">
          <a tabIndex={-1} aria-hidden="true" href="./" onClick={goHome}>
            <img className="hb-logo-img" src="assets/homebridge-logo.svg" alt="" height="35" width="35" loading="lazy" />
            <span className="glass-logo" aria-hidden="true"></span>
            <div className="hb-logo-text">Homebridge</div>
          </a>
        </div>
        <div className="link-wrapper">
          {navButton('/', t('menu.label_status'), 'fas fa-house', true)}

          {(rPiWasUnderVoltage || rPiCurrentlyUnderVoltage) && (
            <div className="link">
              <button
                type="button"
                className="link-row"
                aria-label={`${t('rpi.throttled.undervoltage_title')} - ${t('rpi.throttled.undervoltage_description')}`}
                onClick={openUnderVoltageModal}
              >
                <div className="icon"><i aria-hidden="true" className="fas fa-bolt fa-beat yellow-text fa-beat-scale-lg"></i></div>
                <div className="title">{t('rpi.throttled.undervoltage_title')}</div>
              </button>
            </div>
          )}

          {navButton('/plugins', t('menu.label_plugins'), 'fas fa-plug')}
          {navButton('/accessories', t('menu.label_accessories'), 'fas fa-lightbulb')}
          {canViewLogs && navButton('/logs', t('menu.linux.label_logs'), 'fas fa-wave-square')}
          {enableTerminalAccess && isAdmin && navButton('/platform-tools/terminal', t('menu.linux.label_terminal'), 'fas fa-terminal')}
          {isAdmin && navButton('/config', t('menu.config_json_editor'), 'fas fa-code')}
          {isAdmin && navButton('/settings', t('menu.label_settings'), 'fas fa-cog')}
          {navButton('/support', t('support.title'), 'far fa-circle-question')}
          {isAdmin && navButton('/power-options', t('menu.restart.title'), 'fas fa-power-off')}

          {isPwa && (
            <div className="link">
              <button type="button" className="link-row" aria-label={t('menu.reload')} onClick={() => window.location.reload()}>
                <div className="icon"><i aria-hidden="true" className="fas fa-arrows-rotate"></i></div>
                <div className="title">{t('menu.reload')}</div>
              </button>
            </div>
          )}
          {formAuth && (
            <div className="link">
              <button type="button" className="link-row" aria-label={t('menu.tooltip_logout')} onClick={() => authActions.logout()}>
                <div className="icon"><i aria-hidden="true" className="fas fa-right-from-bracket"></i></div>
                <div className="title">{t('menu.tooltip_logout')}</div>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
