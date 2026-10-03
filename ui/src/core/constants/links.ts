/**
 * An icon-only link out of the ui, named for screen readers by `label` (the
 * icon alone says nothing). Markup for the `{{ link }}` slot of a translation.
 */
function externalIconLink(href: string, label: string): string {
  const name = label.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<a href="${href}" target="_blank" rel="noopener noreferrer" aria-label="${name}"><i class="fas fa-up-right-from-square primary-text" aria-hidden="true"></i></a>`
}

/** Icon-only links out, named for screen readers by `label`. */
export const linkChildBridges = (label: string) => externalIconLink('https://github.com/homebridge/homebridge/wiki/Child-Bridges', label)
export const linkDebug = (label: string) => externalIconLink('https://github.com/mp-consulting/homebridge-config-glass-ui/wiki/Debug-Common-Values', label)
export const linkCron = (label: string) => externalIconLink('https://crontab.guru/', label)
export const linkRaspbianSsl = (label: string) => externalIconLink('https://github.com/homebridge/homebridge-raspbian-image/wiki/SSL-HTTPS-Access', label)
