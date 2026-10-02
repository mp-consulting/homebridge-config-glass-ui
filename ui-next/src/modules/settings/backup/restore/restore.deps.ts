import type { TerminalFactory } from '@/core/utilities/terminal/types'

import { xtermFactory } from '@/core/utilities/terminal/terminal.factory'

import { uploadWithProgress } from './upload-with-progress'

/** Seams for the specs: a fake terminal (jsdom has no canvas) and the progress upload. */
export const restoreDeps: { terminals: TerminalFactory, uploadWithProgress: typeof uploadWithProgress } = {
  terminals: xtermFactory,
  uploadWithProgress,
}
