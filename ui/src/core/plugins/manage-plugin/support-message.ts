import type { ManagePluginModalData } from '@/core/ui/modal-data'

import { escapeHtml, toHttpsUrl } from '@/core/helpers/html.helper'

const RE_KOFI = /ko-?fi/i

/** The project's own packages: never a donation prompt, and Windows installs them itself. */
export const SELF_PACKAGES = ['homebridge', '@mp-consulting/homebridge-config-glass-ui']

/** Which support message to show, and the donation link it carries. */
export function determineSupportMessage(
  pluginName: string,
  verified: boolean,
  funding: ManagePluginModalData['funding'] | string | null | undefined,
): { supportMessageKey: string, donationLink: string } {
  // Default to GitHub message
  const fallback = { supportMessageKey: 'plugins.manage.support_github', donationLink: '' }

  // Never show donation messages for homebridge or @mp-consulting/homebridge-config-glass-ui
  if (SELF_PACKAGES.includes(pluginName)) {
    return fallback
  }

  // Check if plugin qualifies for donation message and randomly decide to show it
  if (verified && funding && Math.random() < 0.5) {
    // Extract random donation URL from funding data
    let donationUrl: string | null = null
    if (typeof funding === 'string') {
      donationUrl = funding
    } else if (Array.isArray(funding)) {
      const urls = funding.map((o: any) => typeof o === 'string' ? o : o?.url).filter(Boolean)
      donationUrl = urls.length > 0 ? urls[Math.floor(Math.random() * urls.length)] : null
    } else if ((funding as any)?.url) {
      donationUrl = (funding as any).url
    }

    // The funding field comes straight from the plugin's package.json and the
    // link is rendered as HTML, so only accept a real https URL and escape it
    // for the attribute
    donationUrl = toHttpsUrl(donationUrl)
    if (donationUrl) {
      const isKofi = RE_KOFI.test(donationUrl)
      return {
        supportMessageKey: isKofi ? 'plugins.manage.support_kofi' : 'plugins.manage.support_donate',
        donationLink: `<a href="${escapeHtml(donationUrl)}" target="_blank" rel="noopener noreferrer"><i class="fas fa-external-link-alt primary-text"></i></a>`,
      }
    }
  }

  return fallback
}
