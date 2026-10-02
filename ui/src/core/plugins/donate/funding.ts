import type { PluginFundingOption } from '@/core/plugins/manage-plugins.interfaces'

/** Normalise the different `funding` formats of a package.json. */
export function normaliseFunding(funding: unknown): PluginFundingOption[] {
  if (Array.isArray(funding)) {
    return funding.map((option: PluginFundingOption | string) => {
      if (typeof option === 'string') {
        return { type: 'other', url: option }
      } else if (typeof option === 'object') {
        return { type: option.type || 'other', url: option.url }
      }
      return undefined
    }).filter(Boolean) as PluginFundingOption[]
  } else if (typeof funding === 'string') {
    return [{ type: 'other', url: funding }]
  } else if (typeof funding === 'object' && funding !== null) {
    const option = funding as PluginFundingOption
    return [{ type: option.type || 'other', url: option.url }]
  }
  return []
}

export function getIconClass(type: string): string {
  switch (type.toLowerCase()) {
    case 'paypal':
      return 'fab fa-paypal'
    case 'github':
      return 'fab fa-github'
    case 'patreon':
      return 'fab fa-patreon'
    case 'kofi':
    case 'ko-fi':
      return 'fab fa-ko-fi'
    case 'venmo':
      return 'fab fa-venmo-v'
    default:
      return 'fas fa-link'
  }
}
