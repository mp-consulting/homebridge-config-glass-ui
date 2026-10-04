import { Module } from '@nestjs/common'

import { AppEventsService } from './app-events.service.js'

/** Import it where events are reported or read: Nest shares the one instance. */
@Module({
  providers: [AppEventsService],
  exports: [AppEventsService],
})
export class AppEventsModule {}
