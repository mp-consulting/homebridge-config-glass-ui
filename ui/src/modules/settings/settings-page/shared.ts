import { i18n } from '@/core/ui/i18n'

/** Constants and small helpers shared by the settings page and its sections. */

export const fontSizes = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
export const fontWeights = ['100', '200', '300', '400', '500', '600', '700', '800', '900', 'bold', 'normal']

/**
 * An icon-only link out of the ui, named for screen readers by `label` (the
 * icon alone says nothing). Markup for the `{{ link }}` slot of a translation.
 */
export function externalIconLink(href: string, label: string): string {
  const name = label.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${name}"><i class="fas fa-up-right-from-square primary-text" aria-hidden="true"></i></a>`
}

export const linkDebug = (label: string) => externalIconLink('https://github.com/mp-consulting/homebridge-config-glass-ui/wiki/Debug-Common-Values', label)
export const linkRaspbianSsl = (label: string) => externalIconLink('https://github.com/homebridge/homebridge-raspbian-image/wiki/SSL-HTTPS-Access', label)
export const linkCron = (label: string) => externalIconLink('https://crontab.guru/', label)

export const t = (key: string, params?: Record<string, unknown>) => i18n.t(key, params)

export const MODAL_OPTIONS = { size: 'lg', backdrop: 'static' } as const

/** A save that worked keeps its spinner up this long, so the user sees it. */
export const SAVED_SPINNER_MS = 1000
