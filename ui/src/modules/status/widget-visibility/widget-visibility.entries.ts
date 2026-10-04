import type { TFunction } from 'i18next'

import type { Widget } from '../widgets/widget.types'

import { useAiStore } from '@/core/ai/ai.store'
import { useAuthStore } from '@/core/auth/auth.store'
import { settingsActions, useSettingsStore } from '@/core/settings'

export interface WidgetVisibilityEntry {
  name: string
  component: string
  showOnDesktop: boolean
  showOnMobile: boolean
  cols: number
  rows: number
  mobileOrder: number
  hideOnDesktop: boolean
  hideOnMobile: boolean
  requiresConfig?: boolean
}

/**
 * Every widget this install can show, with its default size and mobile order,
 * and whether it is shown on desktop / mobile in the given dashboard.
 * @param dashboard - the current layout
 * @param t - the translate function
 */
export function visibilityEntries(dashboard: Array<Partial<Widget>>, t: TFunction): WidgetVisibilityEntry[] {
  const env = useSettingsStore.getState().env
  const allWidgets: Array<{ name: string, component: string, hidden?: boolean, cols: number, rows: number, mobileOrder: number, requiresConfig?: boolean }> = [
    { name: t('status.services.updates'), component: 'UpdateInfoWidgetComponent', hidden: false, cols: 10, rows: 3, mobileOrder: 10 },
    { name: t('status.widget.weather.title_weather'), component: 'WeatherWidgetComponent', hidden: false, cols: 3, rows: 5, mobileOrder: 20, requiresConfig: true },
    { name: t('menu.label_accessories'), component: 'AccessoriesWidgetComponent', hidden: !env.enableAccessories, cols: 7, rows: 9, mobileOrder: 30 },
    { name: t('child_bridge.bridges'), component: 'BridgesWidgetComponent', hidden: false, cols: 5, rows: 9, mobileOrder: 35 },
    { name: t('status.cpu.title_cpu'), component: 'CpuWidgetComponent', hidden: false, cols: 5, rows: 3, mobileOrder: 40 },
    { name: t('status.memory.title_memory'), component: 'MemoryWidgetComponent', hidden: false, cols: 5, rows: 3, mobileOrder: 50 },
    { name: t('status.network.title_network'), component: 'NetworkWidgetComponent', hidden: false, cols: 10, rows: 3, mobileOrder: 55 },
    { name: t('status.uptime.title_uptime'), component: 'UptimeWidgetComponent', hidden: false, cols: 5, rows: 3, mobileOrder: 60 },
    { name: t('status.widget.info'), component: 'SystemInfoWidgetComponent', hidden: false, cols: 5, rows: 9, mobileOrder: 70 },
    { name: t('status.widget.add.label_pairing_code'), component: 'HapQrcodeWidgetComponent', hidden: false, cols: 3, rows: 7, mobileOrder: 100 },
    ...settingsActions.isFeatureEnabled('matterSupport')
      ? [{ name: t('status.widget.add.matter_pairing_code'), component: 'MatterQrcodeWidgetComponent', hidden: false, cols: 3, rows: 7, mobileOrder: 105 }]
      : [],
    { name: t('status.widget.homebridge_logs'), component: 'HomebridgeLogsWidgetComponent', hidden: false, cols: 7, rows: 6, mobileOrder: 1000 },
    { name: `Homebridge ${t('menu.docker.terminal')}`, component: 'TerminalWidgetComponent', hidden: !env.enableTerminalAccess, cols: 7, rows: 6, mobileOrder: 1000 },
    { name: t('status.widget.clock'), component: 'ClockWidgetComponent', cols: 5, rows: 3, mobileOrder: 23 },
    // Offered only while the Assistant is on, to an administrator (the digest route is admin-only)
    { name: t('ai.digest.title'), component: 'AssistantDigestWidgetComponent', hidden: !(useAiStore.getState().status?.enabled && useAuthStore.getState().user?.admin), cols: 5, rows: 6, mobileOrder: 15 },
  ]

  return allWidgets
    .filter(x => !x.hidden)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((x) => {
      const dashboardItem = dashboard.find(i => i.component === x.component)
      const hideOnDesktop = dashboardItem ? (dashboardItem.hideOnDesktop ?? false) : true
      const hideOnMobile = dashboardItem ? (dashboardItem.hideOnMobile ?? false) : true
      return {
        name: x.name,
        component: x.component,
        showOnDesktop: !hideOnDesktop,
        showOnMobile: !hideOnMobile,
        cols: x.cols,
        rows: x.rows,
        mobileOrder: x.mobileOrder,
        hideOnDesktop,
        hideOnMobile,
        requiresConfig: x.requiresConfig,
      }
    })
}
