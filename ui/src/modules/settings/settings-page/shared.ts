import { t } from '@/core/ui/i18n'

/** Constants and small helpers shared by the settings page and its sections. */

export const fontSizes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
export const fontWeights = ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'bold', 'normal']

export { t }

export const MODAL_OPTIONS = { size: 'lg', backdrop: 'static' } as const

/** A save that worked keeps its spinner up this long, so the user sees it. */
export const SAVED_SPINNER_MS = 1000
