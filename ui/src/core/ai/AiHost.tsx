import { useEffect } from 'react'

import { isAssistantShortcut, openAssistant } from '@/core/ai/ai-entry'
import { aiActions, useAiEnabled, useAiStore } from '@/core/ai/ai.store'

import '@mp-consulting/homebridge-ui-kit/dist/ai.css'
import './ai.scss'

/** Editors that use Cmd/Ctrl+K themselves (Monaco's chords, the terminal). */
const OWN_SHORTCUT_SELECTOR = '.monaco-editor, .xterm'

/**
 * The Assistant's app-wide pieces, mounted once in the signed-in layout: the
 * status load, the Cmd/Ctrl+K shortcut to the palette, and the page-edge halo
 * while a request runs.
 */
export function AiHost() {
  const enabled = useAiEnabled()
  const running = useAiStore(state => state.running > 0)

  useEffect(() => {
    void aiActions.loadStatus()
  }, [])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAssistantShortcut(event) || (event.target as Element | null)?.closest?.(OWN_SHORTCUT_SELECTOR)) {
        return
      }
      event.preventDefault()
      openAssistant()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])

  return running ? <div className="mp-ai-edge-glow" aria-hidden="true"></div> : null
}
