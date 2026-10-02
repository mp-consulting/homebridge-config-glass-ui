/**
 * Shared testing toolkit for ui-next. Import from `@/testing` in any spec:
 *
 *     import { fakeWs, makeEnv, renderWithProviders } from '@/testing'
 *
 * See README.md for how the fakes replace the core singletons.
 */

export * from './constants'
export * from './fakes/api.fake'
export * from './fakes/auth.fake'
export * from './fakes/browser.fake'
export * from './fakes/cache.fake'
export * from './fakes/modal.fake'
export * from './fakes/settings.fake'
export * from './fakes/terminal.fake'
export * from './fakes/toast.fake'
export * from './fakes/ws.fake'
export * from './fixtures/accessory.fixture'
export * from './fixtures/plugin.fixture'
export * from './render'
