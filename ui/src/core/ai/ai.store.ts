import type { AiStatus } from './ai.interfaces'

import { create } from 'zustand'

import { api } from '@/core/api'

/**
 * Whether the Assistant is on, and how many of its requests are running (the
 * page-edge glow shows while any is). Every AI entry point reads `enabled`
 * here and stays hidden while it is false.
 */
export interface AiState {
  status: AiStatus | null
  /** Requests streaming right now. */
  running: number
}

export const useAiStore = create<AiState>()(() => ({
  status: null,
  running: 0,
}))

let pending: Promise<AiStatus | null> | null = null

export const aiActions = {
  /**
   * Fetch `/ai/status`. Concurrent callers share one request. A failure (an
   * older server without the route, a network blip) leaves the Assistant
   * hidden rather than surfacing an error.
   */
  loadStatus(): Promise<AiStatus | null> {
    pending ??= api.get<AiStatus>('/ai/status').then((status) => {
      useAiStore.setState({ status })
      return status
    }, () => {
      useAiStore.setState({ status: null })
      return null
    }).finally(() => {
      pending = null
    })
    return pending
  },

  setStatus(status: AiStatus | null): void {
    useAiStore.setState({ status })
  },

  /** Count a running request; returns the function that ends it (call it once). */
  beginRun(): () => void {
    useAiStore.setState(state => ({ running: state.running + 1 }))
    let ended = false
    return () => {
      if (!ended) {
        ended = true
        useAiStore.setState(state => ({ running: Math.max(0, state.running - 1) }))
      }
    }
  },

  reset(): void {
    useAiStore.setState({ status: null, running: 0 })
  },
}

/** Whether the Assistant can be used right now. */
export function useAiEnabled(): boolean {
  return useAiStore(state => state.status?.enabled === true)
}
