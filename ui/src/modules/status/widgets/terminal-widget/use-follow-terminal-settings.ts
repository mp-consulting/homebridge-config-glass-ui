import type { WidgetEvent } from '@/modules/status/widgets/widget.types'
import type { ITerminalOptions, Terminal } from '@xterm/xterm'

import { useEffect, useRef } from 'react'

import { settingsActions } from '@/core/settings'

/**
 * Apply global terminal settings changes (font, lighting) to a widget's live
 * terminal, then re-measure and scroll back to the newest output. The log and
 * shell widgets each carried a copy of this in Angular; here they share it.
 * @param getTerm - the live terminal, or nothing before it exists
 * @param resizeEvent - the widget's resize stream, nudged after a change
 */
export function useFollowTerminalSettings(getTerm: () => Terminal | null | undefined, resizeEvent: WidgetEvent): void {
  const getTermRef = useRef(getTerm)
  getTermRef.current = getTerm

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const off = settingsActions.onTerminalSettingsChanged((settings) => {
      const term = getTermRef.current()
      if (!term) {
        return
      }
      let changed = false
      if (settings.fontSize && term.options.fontSize !== settings.fontSize) {
        term.options.fontSize = settings.fontSize
        changed = true
      }
      if (settings.fontWeight && term.options.fontWeight !== settings.fontWeight) {
        term.options.fontWeight = settings.fontWeight as ITerminalOptions['fontWeight']
        changed = true
      }
      if (settings.lightingMode !== undefined) {
        // Both, not just the colours: a solid theme applied without its
        // transparency setting leaves the old background showing through
        const themeOptions = settingsActions.getTerminalThemeOptions(true)
        term.options.theme = themeOptions.theme
        term.options.allowTransparency = themeOptions.allowTransparency
        changed = true
      }
      if (changed) {
        resizeEvent.next()
        // Cleared through `timers` in the cleanup below
        // eslint-disable-next-line react/web-api-no-leaked-timeout
        const timer = setTimeout(() => {
          timers.delete(timer)
          getTermRef.current()?.scrollToBottom()
        }, 100)
        timers.add(timer)
      }
    })
    return () => {
      off()
      timers.forEach(clearTimeout)
    }
  }, [resizeEvent])
}
