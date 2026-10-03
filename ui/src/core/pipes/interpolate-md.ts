import { RE_HOSTNAME_PLACEHOLDER } from '@/core/regex.constants'

export function interpolateMd(value: string): string {
  return value.replace(RE_HOSTNAME_PLACEHOLDER, location.hostname)
}
