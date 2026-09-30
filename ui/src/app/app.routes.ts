import { Routes } from '@angular/router'

import { authGuard } from '@/app/core/auth/guards/auth.guard'
import { loginGuard } from '@/app/core/auth/guards/login.guard'
import { setupWizardGuard } from '@/app/core/auth/guards/setup-wizard.guard'

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('@/app/modules/login/login.component').then(m => m.LoginComponent),
    canActivate: [loginGuard],
  },
  {
    path: 'setup',
    loadComponent: () => import('@/app/modules/setup-wizard/setup-wizard.component').then(m => m.SetupWizardComponent),
    canActivate: [setupWizardGuard],
  },
  {
    path: '',
    loadChildren: () => import('@/app/layout.routes').then(m => m.LAYOUT_ROUTES),
    canActivate: [authGuard],
  },
  {
    path: '**',
    pathMatch: 'full',
    redirectTo: '/',
  },
]
