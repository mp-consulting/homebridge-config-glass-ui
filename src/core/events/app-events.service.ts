import { EventEmitter } from 'node:events'

import { Injectable } from '@nestjs/common'

/** A bridge crash looping soon after a plugin update (PluginRollbackService). */
export interface PluginRollbackSuggestedEvent {
  reason: 'childBridgeCrashLoop' | 'homebridgeCrashLoop'
  bridge?: string
  plugins: Array<{ name: string, fromVersion: string, toVersion: string, updatedAt: string }>
}

/** What the in-process events carry. */
export interface AppEventMap {
  /** A scheduled (or requested) instance backup failed. */
  backupFailed: [{ message: string }]
  /** A scheduled backup was saved (and uploaded: `uploads`, one per enabled off-site destination). */
  backupSucceeded: [{ fileName: string, uploads: Array<{ destination: string, ok: boolean, error?: string }> }]
  /** A bridge crash loops soon after a plugin update: rolling it back is offered. */
  pluginRollbackSuggested: [PluginRollbackSuggestedEvent]
}

/**
 * An in-process event bus for things one module reports and another reacts
 * to (a backup failing, read by the notifications), without the reporting
 * module depending on the reacting one.
 */
@Injectable()
export class AppEventsService extends EventEmitter<AppEventMap> {}
