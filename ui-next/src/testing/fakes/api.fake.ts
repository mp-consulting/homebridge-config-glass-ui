/**
 * The api fake lives next to the wrapper (`@/core/api/api.fake`): it spies on
 * the real `api` object, so code importing `api` sees it without a `vi.mock`.
 * Re-exported here so every fake comes from `@/testing`.
 */
export * from '@/core/api/api.fake'
