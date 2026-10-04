import type { ConfigCopilotProps, ConfigCopilotResult } from '@/core/ai/copilot/ConfigCopilot'
import type { DiagnoseDrawerProps } from '@/core/ai/diagnose/DiagnoseDrawer'
import type { OrganizerChanges } from '@/core/ai/organizer/organizer'
import type { SmartOrganizerProps } from '@/core/ai/organizer/SmartOrganizer'
import type { ModalComponentProps, ModalRef } from '@/core/ui/modal'

import { lazyModal } from '@/core/ui/lazy-modal'
import { openModal } from '@/core/ui/modal'

/**
 * Where the Assistant's panels open from. Each is a lazily loaded chunk, so
 * none of it weighs on the first page load.
 */

const LazyPalette = lazyModal<ModalComponentProps>(async () => (await import('@/core/ai/palette/AssistantPalette')).AssistantPalette)
const LazyDiagnose = lazyModal<DiagnoseDrawerProps>(async () => (await import('@/core/ai/diagnose/DiagnoseDrawer')).DiagnoseDrawer)
const LazyCopilot = lazyModal<ConfigCopilotProps>(async () => (await import('@/core/ai/copilot/ConfigCopilot')).ConfigCopilot)
const LazyOrganizer = lazyModal<SmartOrganizerProps>(async () => (await import('@/core/ai/organizer/SmartOrganizer')).SmartOrganizer)

let palette: ModalRef | null = null

/** Open the Assistant command palette, or do nothing when it is already open. */
export function openAssistant(): void {
  if (palette) {
    return
  }
  const ref = openModal(LazyPalette, {}, { size: 'lg', windowClass: 'hb-ai-palette-window', scrollable: true })
  palette = ref
  const closed = () => {
    if (palette === ref) {
      palette = null
    }
  }
  ref.result.then(closed, closed)
}

/** Whether the palette is open. */
export function isAssistantOpen(): boolean {
  return palette !== null
}

/** Open Log Doctor in a side drawer; it starts diagnosing at once. */
export function openLogDoctor(focus?: string): ModalRef {
  return openModal(LazyDiagnose, { focus }, { windowClass: 'hb-ai-drawer', modalDialogClass: 'hb-ai-drawer-dialog', scrollable: true })
}

/** Open Config Copilot; resolves with the block the user applied, rejects when they close it. */
export function openConfigCopilot(props: Omit<ConfigCopilotProps, 'activeModal'>): Promise<ConfigCopilotResult> {
  return openModal<ConfigCopilotProps, ConfigCopilotResult>(LazyCopilot, props, { size: 'xl', backdrop: 'static', scrollable: true }).result
}

/** Open the smart organiser; resolves with the changes the user kept. */
export function openSmartOrganizer(props: Omit<SmartOrganizerProps, 'activeModal'>): Promise<OrganizerChanges> {
  return openModal<SmartOrganizerProps, OrganizerChanges>(LazyOrganizer, props, { size: 'lg', backdrop: 'static', scrollable: true }).result
}

/** The palette's shortcut: Cmd+K on macOS, Ctrl+K elsewhere. */
export function isAssistantShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k'
}
