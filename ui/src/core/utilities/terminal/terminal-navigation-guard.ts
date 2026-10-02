import type { ConfirmFn, TranslateFn } from './types'

export interface TerminalSessionState {
  hasActiveSession: () => boolean
  hasUserTypedInSession: () => boolean
}

export interface TerminalEnvSettings {
  persistence?: boolean
  hideWarning?: boolean
}

export interface TerminalNavigationGuardDeps {
  terminal: TerminalSessionState
  /** `env.terminal` from the settings store, read at the moment of asking. */
  getTerminalSettings: () => TerminalEnvSettings | undefined
  confirm: ConfirmFn
  t: TranslateFn
}

/**
 * Decides whether leaving the terminal (in-app navigation or closing the tab)
 * needs a warning. The React side wires it to `useBlocker` and `beforeunload`
 * via `useTerminalNavigationGuard`.
 */
export class TerminalNavigationGuard {
  constructor(private readonly deps: TerminalNavigationGuardDeps) {}

  /**
   * Only warn if persistence is disabled, the warning is enabled, there's an
   * active session, and the user has typed in it.
   */
  public shouldWarn(): boolean {
    const settings = this.deps.getTerminalSettings()
    return !settings?.persistence
      && !settings?.hideWarning
      && this.deps.terminal.hasActiveSession()
      && this.deps.terminal.hasUserTypedInSession()
  }

  public handleBeforeUnload(event: BeforeUnloadEvent): string | undefined {
    if (this.shouldWarn()) {
      const message = this.deps.t('platform.terminal.terminate_unload')
      event.preventDefault()
      event.returnValue = message
      return message // For other browsers
    }
    return undefined
  }

  public async canDeactivate(): Promise<boolean> {
    // Persistence on, warning off, no session, or nothing typed: leave without a prompt
    if (!this.shouldWarn()) {
      return true
    }

    const { t } = this.deps
    return this.deps.confirm({
      title: t('platform.terminal.terminate_title'),
      message: t('platform.terminal.terminate_message_1'),
      message2: t('platform.terminal.terminate_message_2'),
      message3: t('common.phrases.are_you_sure'),
      confirmButtonLabel: t('form.button_continue'),
      confirmButtonClass: 'btn-primary',
      faIconClass: 'fas fa-exclamation-triangle text-warning',
    })
  }
}
