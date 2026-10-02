// eslint-disable-next-line no-control-regex
const RE_ANSI = /\x1B\[(\d{1,3}(;\d{1,2})?)?[mGK]/g
const RE_BRACKET_TAG = /36m\[.*?\]/

/**
 * Keep the lines a plugin logged (tagged `[alias]` in cyan), plus the untagged
 * continuation lines after them, without the colour codes.
 */
export function filterPluginLog(body: string, pluginAlias: string): string {
  const lines = body.split('\n')
  let finalOutput = ''
  let includeNextLine = false

  lines.forEach((line: string) => {
    if (!line) {
      return
    }

    if (includeNextLine) {
      if (RE_BRACKET_TAG.test(line)) {
        includeNextLine = false
      } else {
        finalOutput += `${line.replace(RE_ANSI, '')}\r\n`
        return
      }
    }

    if (line.includes(`36m[${pluginAlias}]`)) {
      finalOutput += `${line.replace(RE_ANSI, '')}\r\n`
      includeNextLine = true
    }
  })
  return finalOutput
}

/**
 * xterm writes its own live region and asks for it to be assertive, which
 * interrupts a screen reader on every line a busy plugin logs; turn it down
 * to polite so the log can be read at the user's own pace.
 */
export function patchXtermLiveRegion(host: HTMLElement | null | undefined): void {
  if (!host) {
    return
  }

  const live = host.querySelector('[aria-live]') as HTMLElement | null
  if (!live) {
    return
  }

  live.setAttribute('role', 'status')
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('aria-atomic', 'true')
}
