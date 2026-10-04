import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'

import { AccessoryHistoryService } from './accessory-history.service.js'

@ApiTags('Accessories')
@ApiBearerAuth()
@UseGuards(AuthGuard())
@Controller('accessories')
export class AccessoryHistoryController {
  constructor(
    @Inject(AccessoryHistoryService) private readonly history: AccessoryHistoryService,
  ) {}

  @ApiOperation({
    summary: 'Return the recorded history of an accessory\'s sensor values.',
    description: 'Temperature, humidity, light level, battery, air quality, power and energy readings, recorded as they change (at most one point a minute per characteristic) and kept for `accessoryHistory.retentionDays`.',
  })
  @ApiParam({ name: 'uniqueId' })
  @ApiQuery({ name: 'hours', required: false, type: Number, example: 24 })
  @ApiQuery({ name: 'type', required: false, type: String, example: 'CurrentTemperature' })
  @ApiQuery({ name: 'maxPoints', required: false, type: Number, example: 500 })
  @Get('/:uniqueId/history')
  getHistory(
    @Param('uniqueId') uniqueId: string,
    @Query('hours') hours?: string,
    @Query('type') type?: string,
    @Query('maxPoints') maxPoints?: string,
  ) {
    return this.history.query(uniqueId, { hours, type, maxPoints })
  }
}
