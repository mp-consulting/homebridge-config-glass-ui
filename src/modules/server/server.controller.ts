import type { FastifyRequest } from 'fastify'

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  InternalServerErrorException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'

import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { Logger } from '../../core/logger/logger.service.js'
import { RE_DEVICE_ID } from '../../core/regex.constants.js'
import { ChildBridgesService } from '../child-bridges/child-bridges.service.js'
import { PortRangeDto } from '../config-editor/config-editor.dto.js'
import { ServerCachedAccessoriesService } from './server-cached-accessories.service.js'
import { ServerNetworkService } from './server-network.service.js'
import { ServerPairingsService } from './server-pairings.service.js'
import { ServerWallpaperService } from './server-wallpaper.service.js'
import { HomebridgeMdnsSettingDto, HomebridgeNetworkInterfacesDto } from './server.dto.js'
import { ServerService } from './server.service.js'

@ApiTags('Homebridge')
@ApiBearerAuth()
@UseGuards(AuthGuard())
@Controller('server')
export class ServerController {
  constructor(
    @Inject(ServerService) private readonly serverService: ServerService,
    @Inject(ServerPairingsService) private readonly serverPairingsService: ServerPairingsService,
    @Inject(ServerCachedAccessoriesService) private readonly serverCachedAccessoriesService: ServerCachedAccessoriesService,
    @Inject(ServerNetworkService) private readonly serverNetworkService: ServerNetworkService,
    @Inject(ServerWallpaperService) private readonly serverWallpaperService: ServerWallpaperService,
    @Inject(ChildBridgesService) private readonly childBridgesService: ChildBridgesService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  @UseGuards(AdminGuard)
  @Put('/restart')
  @ApiOperation({ summary: 'Restart the Homebridge instance.' })
  restartServer() {
    return this.serverService.restartServer()
  }

  @UseGuards(AdminGuard)
  @Put('/restart/:deviceId')
  @ApiOperation({
    summary: 'Restart a child bridge instance.',
  })
  restartChildBridge(@Param('deviceId') deviceId: string) {
    return this.childBridgesService.restartChildBridge(deviceId)
  }

  @UseGuards(AdminGuard)
  @Put('/stop/:deviceId')
  @ApiOperation({
    summary: 'Stop a child bridge instance.',
  })
  stopChildBridge(@Param('deviceId') deviceId: string) {
    return this.childBridgesService.stopChildBridge(deviceId)
  }

  @UseGuards(AdminGuard)
  @Put('/start/:deviceId')
  @ApiOperation({
    summary: 'Start a child bridge instance.',
  })
  startChildBridge(@Param('deviceId') deviceId: string) {
    return this.childBridgesService.startChildBridge(deviceId)
  }

  @UseGuards(AdminGuard)
  @Get('/pairing')
  @ApiOperation({ summary: 'Get the Homebridge <> HomeKit pairing information and status.' })
  getBridgePairingInformation() {
    return this.serverService.getBridgePairingInformation()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Reset the main Homebridge bridge, and change its username and pin. Also remove cached bridges and accessories.' })
  @Put('/reset-homebridge-accessory')
  resetHomebridgeAccessory() {
    return this.serverService.resetHomebridgeAccessory()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove Homebridge cached accessories.',
  })
  @Put('/reset-cached-accessories')
  deleteAllCachedAccessories() {
    return this.serverCachedAccessoriesService.deleteAllCachedAccessories()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'List cached Homebridge accessories.' })
  @Get('/cached-accessories')
  getCachedAccessories() {
    return this.serverCachedAccessoriesService.getCachedAccessories()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove a single Homebridge cached accessory.',
  })
  @ApiParam({ name: 'uuid' })
  @ApiQuery({ name: 'cacheFile' })
  @Delete('/cached-accessories/:uuid')
  @HttpCode(204)
  deleteCachedAccessory(@Param('uuid') uuid: string, @Query('cacheFile') cacheFile?: string) {
    return this.serverCachedAccessoriesService.deleteCachedAccessory(uuid, cacheFile)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove multiple Homebridge cached accessories.',
  })
  @ApiBody({ description: 'Array of accessories (uuid and cacheFile) to remove from the cache', type: 'json', isArray: true })
  @Delete('/cached-accessories')
  @HttpCode(204)
  deleteCachedAccessories(@Body() accessories?: { uuid: string, cacheFile: string }[]) {
    return this.serverCachedAccessoriesService.deleteCachedAccessories(accessories)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'List cached Matter accessories.' })
  @Get('/matter-accessories')
  getMatterAccessories() {
    return this.serverCachedAccessoriesService.getMatterAccessories()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove a single Matter cached accessory.',
  })
  @ApiParam({ name: 'deviceId' })
  @ApiParam({ name: 'uuid' })
  @Delete('/matter-accessories/:deviceId/:uuid')
  @HttpCode(204)
  deleteMatterAccessory(@Param('deviceId') deviceId: string, @Param('uuid') uuid: string) {
    return this.serverCachedAccessoriesService.deleteMatterAccessory(deviceId, uuid)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove multiple Matter cached accessories.',
  })
  @ApiBody({ description: 'Array of Matter accessories (deviceId and uuid) to remove from the cache', type: 'json', isArray: true })
  @Delete('/matter-accessories')
  @HttpCode(204)
  deleteMatterAccessories(@Body() accessories?: { deviceId: string, uuid: string }[]) {
    return this.serverCachedAccessoriesService.deleteMatterAccessories(accessories)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'List all paired accessories (main bridge, external cameras, TVs etc).' })
  @Get('/pairings')
  getDevicePairings() {
    return this.serverPairingsService.getDevicePairings()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Bundled accessory + pairing snapshot used by accessory-management modals.',
    description: 'Aggregator that returns cached HAP accessories, cached Matter accessories, and HAP pairings in a single payload — replaces the two-to-three separate fetches that accessory removal / reset modals used to issue on open.',
  })
  @Get('/accessory-overview')
  getAccessoryOverview() {
    return this.serverCachedAccessoriesService.getAccessoryOverview()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get a single device pairing.' })
  @Get('/pairings/:deviceId')
  getDevicePairingById(@Param('deviceId') deviceId: string) {
    // The id is joined into a file path, and the router decodes %2F - without
    // this `..%2F..%2Fauth` would read auth.json (every user's password hash)
    if (!RE_DEVICE_ID.test(deviceId)) {
      throw new BadRequestException('Invalid device ID.')
    }
    return this.serverPairingsService.getDevicePairingById(deviceId)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove a single paired bridge.',
  })
  @ApiParam({ name: 'deviceId' })
  @ApiQuery({ name: 'resetPairingInfo', type: Boolean })
  @Delete('/pairings/:deviceId')
  @HttpCode(204)
  deleteDevicePairing(@Param('deviceId') deviceId: string, @Query('resetPairingInfo') resetPairingInfo?: string) {
    const resetPairingInfoBool = resetPairingInfo === 'true'
    return this.serverPairingsService.deleteDevicePairing(deviceId, resetPairingInfoBool)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove Matter configuration from a child bridge.',
  })
  @ApiParam({ name: 'deviceId' })
  @Delete('/pairings/:deviceId/matter')
  @HttpCode(204)
  deleteDeviceMatterConfig(@Param('deviceId') deviceId: string) {
    return this.serverPairingsService.deleteDeviceMatterConfig(deviceId)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove multiple paired bridges.',
  })
  @ApiBody({ description: 'Array of paired bridges (id and resetPairingInfo) to remove from the cache', type: 'json', isArray: true })
  @Delete('/pairings')
  @HttpCode(204)
  deleteDevicesPairings(@Body() bridges?: { id: string, resetPairingInfo: boolean }[]) {
    return this.serverPairingsService.deleteDevicesPairing(bridges)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove a paired bridge\'s cached accessories.',
  })
  @ApiParam({ name: 'deviceId' })
  @Delete('/pairings/:deviceId/accessories')
  @HttpCode(204)
  deleteDeviceAccessories(@Param('deviceId') deviceId: string) {
    return this.serverPairingsService.deleteDeviceAccessories(deviceId)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'Remove multiple paired bridges\'s cached accessories.',
  })
  @ApiBody({ description: 'Array of bridges (id and optional protocol) for which to remove accessories.', type: 'json', isArray: true })
  @Delete('/pairings/accessories')
  @HttpCode(204)
  deleteDevicesAccessories(@Body() bridges?: { id: string, protocol?: 'hap' | 'matter' | 'both' }[]) {
    return this.serverPairingsService.deleteDevicesAccessories(bridges)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get a unified network overview of all port assignments, Matter diagnostics, and conflict detection.' })
  @Get('/network/overview')
  getNetworkOverview() {
    return this.serverNetworkService.getNetworkOverview()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Return a random, unused port.' })
  @Get('/port/new')
  lookupUnusedPort() {
    return this.serverNetworkService.lookupUnusedPort()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Return a random, unused port from the Matter port range (5530-5541).' })
  @Get('/port/new/matter')
  lookupUnusedMatterPort() {
    return this.serverNetworkService.lookupUnusedMatterPort()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Return a list of available network interfaces on the server.' })
  @Get('/network-interfaces/system')
  getSystemNetworkInterfaces() {
    return this.serverNetworkService.getSystemNetworkInterfaces()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Return a list of the network interface names assigned to Homebridge.' })
  @Get('/network-interfaces/bridge')
  getHomebridgeNetworkInterfaces() {
    return this.serverNetworkService.getHomebridgeNetworkInterfaces()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Set a list of the network interface names assigned to Homebridge.' })
  @Put('/network-interfaces/bridge')
  setHomebridgeNetworkInterfaces(@Body() body: HomebridgeNetworkInterfacesDto) {
    return this.serverNetworkService.setHomebridgeNetworkInterfaces(body.adapters)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Return the current mDNS advertiser settings.' })
  @Get('/mdns-advertiser')
  getHomebridgeMdnsSetting(): Promise<HomebridgeMdnsSettingDto> {
    return this.serverNetworkService.getHomebridgeMdnsSetting()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Set the mDNS advertiser settings.' })
  @Put('/mdns-advertiser')
  setHomebridgeMdnsSetting(@Body() body: HomebridgeMdnsSettingDto) {
    return this.serverNetworkService.setHomebridgeMdnsSetting(body)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Set the Homebridge name.' })
  @Put('/name')
  setHomebridgeName(@Body() body: { name: string }) {
    return this.serverNetworkService.setHomebridgeName(body.name)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get the Homebridge port.' })
  @Get('/port')
  getHomebridgePort() {
    return this.serverNetworkService.getHomebridgePort()
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Set the Homebridge port.' })
  @Put('/port')
  setHomebridgePort(@Body() body: { port: number }) {
    return this.serverNetworkService.setHomebridgePort(body.port)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get the usable ports as set in the config file.' })
  @Get('/ports')
  getUsablePort() {
    return this.serverNetworkService.getUsablePorts()
  }

  @UseGuards(AdminGuard)
  @Put('/ports')
  @ApiOperation({ summary: 'Update the usable ports for Homebridge.' })
  setUsablePorts(@Body() body: PortRangeDto) {
    return this.serverNetworkService.setUsablePorts(body)
  }

  @UseGuards(AdminGuard)
  @Post('/wallpaper')
  @ApiOperation({ summary: 'Upload an image file to the Homebridge storage directory and reference this as a wallpaper in the config file.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadWallpaper(@Req() req: FastifyRequest) {
    try {
      const data = await req.file()
      if (data.file.truncated) {
        throw new InternalServerErrorException(`Wallpaper exceeds maximum size ${globalThis.backup.maxBackupSizeText}.`)
      }
      await this.serverWallpaperService.uploadWallpaper(data)
    } catch (err) {
      this.logger.error(`Wallpaper upload failed as ${err.message}`)
      // A refused file type is the client's error, not the server's
      if (err instanceof BadRequestException) {
        throw err
      }
      throw new InternalServerErrorException(err.message)
    }
  }

  @UseGuards(AdminGuard)
  @Post('/ssl/keycert')
  @ApiOperation({ summary: 'Upload a PEM private key and certificate, validate, and save to storage, updating config.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        key: { type: 'string', format: 'binary' },
        cert: { type: 'string', format: 'binary' },
        files: { type: 'string', format: 'binary', description: 'Alternatively, submit both files as multiple parts with field name "files"' },
      },
    },
  })
  async uploadSslKeyCert(@Req() req: FastifyRequest) {
    try {
      return await this.serverService.uploadSslKeyCert(req)
    } catch (err) {
      if (err instanceof HttpException) {
        throw err
      }
      this.logger.error(`SSL key/cert upload failed as ${(err as Error)?.message}`)
      throw new InternalServerErrorException((err as Error)?.message)
    }
  }

  @UseGuards(AdminGuard)
  @Post('/ssl/pfx')
  @ApiOperation({ summary: 'Upload a PKCS#12 (PFX/P12) file with passphrase, validate, and save to storage, updating config.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        pfx: { type: 'string', format: 'binary' },
        passphrase: { type: 'string' },
      },
      required: ['pfx'],
    },
  })
  async uploadSslPfx(@Req() req: FastifyRequest) {
    try {
      return await this.serverService.uploadSslPfx(req)
    } catch (err) {
      if (err instanceof HttpException) {
        throw err
      }
      this.logger.error(`SSL pfx upload failed as ${(err as Error)?.message}`)
      throw new InternalServerErrorException((err as Error)?.message)
    }
  }

  @UseGuards(AdminGuard)
  @Post('/ssl/validate')
  @ApiOperation({ summary: 'Validate the currently configured SSL settings (key+cert or pfx+passphrase).' })
  async validateSsl() {
    try {
      return await this.serverService.validateCurrentSslConfig()
    } catch (err) {
      if (err instanceof HttpException) {
        throw err
      }
      this.logger.error(`SSL validate failed as ${(err as Error)?.message}`)
      throw new InternalServerErrorException((err as Error)?.message)
    }
  }

  @UseGuards(AdminGuard)
  @Post('/ssl/selfsigned/generate')
  @ApiOperation({ summary: 'Generate a self-signed certificate and optionally set it as active key/cert in config.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        hostnames: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['selfsigned', 'keycert'], default: 'keycert' },
      },
    },
  })
  async generateSelfSigned(@Body() body: { hostnames?: string[], mode?: 'selfsigned' | 'keycert' }) {
    try {
      return await this.serverService.generateSelfSignedCertificate(body)
    } catch (err) {
      if (err instanceof HttpException) {
        throw err
      }
      this.logger.error(`Generate self-signed certificate failed as ${(err as Error)?.message}`)
      throw new InternalServerErrorException((err as Error)?.message)
    }
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Delete the current wallpaper file and remove the reference from the config file.' })
  @Delete('/wallpaper')
  @HttpCode(204)
  async deleteWallpaper(): Promise<void> {
    await this.serverWallpaperService.deleteWallpaper()
  }
}
