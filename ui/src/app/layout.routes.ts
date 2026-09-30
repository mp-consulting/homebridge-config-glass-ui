import { Routes } from '@angular/router'
import { CategoryScale, Filler, LinearScale, LineController, LineElement, PointElement } from 'chart.js'
import { provideCharts } from 'ng2-charts'

import { adminGuard } from '@/app/core/auth/guards/admin.guard'
import { authGuard } from '@/app/core/auth/guards/auth.guard'
import { logsGuard } from '@/app/core/auth/guards/logs.guard'
import { configEditorResolver } from '@/app/modules/config-editor/config-editor.resolver'
import { usersResolver } from '@/app/modules/users/users.resolver'

// Status widgets only use filled line charts with hidden axes/legend/tooltips,
// so register just the chart.js components they need instead of the full default set.
const chartRegisterables = [
  LineController,
  LineElement,
  PointElement,
  Filler,
  LinearScale,
  CategoryScale,
]

/*
 * The status and restart modules should not be lazy loaded
 * to ensure restarts after an update go smoothly
 */

/**
 * Everything behind sign-in, loaded lazily from `app.routes.ts` so the
 * libraries only these pages use stay out of the initial bundle that /login
 * downloads.
 *
 * Route-level `providers` reach every component under the layout, and any
 * modal opened with one of their injectors - but not a modal a root service
 * opens with the root injector. Those have to bring their own providers (see
 * provideUiLibraries).
 */
export const LAYOUT_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('@/app/shared/layout/layout.component').then(m => m.LayoutComponent),
    providers: [
      provideCharts({ registerables: chartRegisterables }),
    ],
    children: [
      {
        path: '',
        loadComponent: () => import('@/app/modules/status/status.component').then(m => m.StatusComponent),
        canDeactivate: [(component: any) => component.canDeactivate ? component.canDeactivate() : true],
      },
      {
        path: 'restart',
        loadComponent: () => import('@/app/modules/restart/restart.component').then(m => m.RestartComponent),
        canActivate: [adminGuard],
      },
      {
        path: 'plugins',
        loadComponent: () => import('@/app/modules/plugins/plugins.component').then(m => m.PluginsComponent),
        canActivate: [authGuard],
        canDeactivate: [(component: any, _currentRoute: any, _currentState: any, nextState?: any) => component.canDeactivate ? component.canDeactivate(nextState?.url) : true],
      },
      {
        path: 'config',
        loadComponent: () => import('@/app/modules/config-editor/config-editor.component').then(m => m.ConfigEditorComponent),
        canActivate: [adminGuard],
        canDeactivate: [(component: any) => component.canDeactivate ? component.canDeactivate() : true],
        resolve: {
          config: configEditorResolver,
        },
      },
      {
        path: 'accessories',
        loadComponent: () => import('@/app/modules/accessories/accessories.component').then(m => m.AccessoriesComponent),
        canActivate: [authGuard],
      },
      {
        path: 'logs',
        loadComponent: () => import('@/app/modules/logs/logs.component').then(m => m.LogsComponent),
        canActivate: [logsGuard],
        canDeactivate: [(component: any, _currentRoute: any, _currentState: any, nextState?: any) => component.canDeactivate ? component.canDeactivate(nextState?.url) : true],
      },
      {
        path: 'users',
        loadComponent: () => import('@/app/modules/users/users.component').then(m => m.UsersComponent),
        canActivate: [adminGuard],
        resolve: {
          homebridgeUsers: usersResolver,
        },
      },
      {
        path: 'settings',
        loadComponent: () => import('@/app/modules/settings/settings.component').then(m => m.SettingsComponent),
        canActivate: [adminGuard],
      },
      {
        path: 'support',
        loadComponent: () => import('@/app/modules/support/support.component').then(m => m.SupportComponent),
        canActivate: [authGuard],
      },
      {
        path: 'power-options',
        loadComponent: () => import('@/app/modules/power-options/power-options.component').then(m => m.PowerOptionsComponent),
        canActivate: [adminGuard],
      },
      {
        path: 'platform-tools',
        loadChildren: () => import('@/app/modules/platform-tools/platform-tools.routes').then(m => m.PLATFORM_TOOLS_ROUTES),
        canActivate: [adminGuard],
      },
    ],
  },
]
