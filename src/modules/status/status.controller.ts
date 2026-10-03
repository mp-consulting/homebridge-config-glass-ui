import { Controller, Get, Inject, Request, UseGuards } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { ChildBridgesService } from '../child-bridges/child-bridges.service.js'
import { serverInfoForUser, StatusService, withoutInstallPath } from './status.service.js'

@ApiTags('Server Status')
@ApiBearerAuth()
@UseGuards(AuthGuard())
@Controller('status')
export class StatusController {
  constructor(
    @Inject(StatusService) private readonly statusService: StatusService,
    @Inject(ChildBridgesService) private readonly childBridgesService: ChildBridgesService,
  ) {}

  @ApiOperation({ summary: 'Return the current CPU load, load history and temperature (if available).' })
  @Get('/cpu')
  getServerCpuInfo() {
    return this.statusService.getServerCpuInfo()
  }

  @ApiOperation({ summary: 'Return total memory, memory usage, and memory usage history in bytes.' })
  @Get('/ram')
  getServerMemoryInfo() {
    return this.statusService.getServerMemoryInfo()
  }

  @ApiOperation({ summary: 'Returns the current transmitted and received bytes per second.' })
  @Get('/network')
  getServerNetworkInfo() {
    return this.statusService.getCurrentNetworkUsage()
  }

  @ApiOperation({ summary: 'Return the host and process (UI) uptime.' })
  @Get('/uptime')
  getServerUptimeInfo() {
    return this.statusService.getServerUptimeInfo()
  }

  @ApiOperation({
    summary: 'Return the current Homebridge status.',
    description: 'Possible Homebridge statuses are `up`, `pending` or `down`.',
  })
  @Get('/homebridge')
  async checkHomebridgeStatus() {
    return {
      status: await this.statusService.checkHomebridgeStatus(),
    }
  }

  @ApiOperation({
    summary: 'Return an array of the active child bridges and their status.',
  })
  @Get('/homebridge/child-bridges')
  async getChildBridges(@Request() req: any) {
    // Pairing codes (HomeKit / Matter PIN and setup URI) only for administrators
    return this.childBridgesService.getChildBridgesForUser(req.user?.admin === true)
  }

  @ApiOperation({ summary: 'Return the current Homebridge version and package information.' })
  @Get('/homebridge-version')
  async getHomebridgeVersion() {
    return this.statusService.getHomebridgeVersion()
  }

  @ApiOperation({ summary: 'Return general information about the host environment.' })
  @Get('/server-information')
  async getHomebridgeServerInfo(@Request() req: any) {
    // Paths, service user and network details for administrators only
    return serverInfoForUser(await this.statusService.getHomebridgeServerInfo(), req.user?.admin === true)
  }

  @ApiOperation({ summary: 'Return current Node.js version and update availability information.' })
  @Get('/nodejs')
  async getNodeVersionInfo(@Request() req: any) {
    // The install path for administrators only
    return withoutInstallPath(await this.statusService.getNodeVersionInfo(), req.user?.admin === true)
  }

  @ApiOperation({ summary: 'Returns throttled status for Raspberry Pi.' })
  @Get('/rpi/throttled')
  async getRaspberryPiThrottledStatus() {
    return this.statusService.getRaspberryPiThrottledStatus()
  }
}
