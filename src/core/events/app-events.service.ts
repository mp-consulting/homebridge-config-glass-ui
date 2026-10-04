import { EventEmitter } from 'node:events'

import { Injectable } from '@nestjs/common'

/** What the in-process events carry. */
export interface AppEventMap {
  /** A scheduled (or requested) instance backup failed. */
  backupFailed: [{ message: string }]
}

/**
 * An in-process event bus for things one module reports and another reacts
 * to (a backup failing, read by the notifications), without the reporting
 * module depending on the reacting one.
 */
@Injectable()
export class AppEventsService extends EventEmitter<AppEventMap> {}
