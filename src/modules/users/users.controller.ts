import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { Audited, pick } from '../../core/audit/audit.interceptor.js'
import { AuthService } from '../../core/auth/auth.service.js'
import { AdminGuard } from '../../core/auth/guards/admin.guard.js'
import { AuthUser, User } from '../../core/auth/user.decorator.js'
import { UserActivateOtpDto, UserDeactivateOtpDto, UserDto, UserUpdatePasswordDto } from './users.dto.js'

@ApiTags('User Management')
@ApiBearerAuth()
@UseGuards(AuthGuard())
@Controller('users')
export class UsersController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  @UseGuards(AdminGuard)
  @ApiResponse({ type: UserDto, isArray: true, status: 200 })
  @ApiOperation({ summary: 'Get a list of existing users.' })
  @Get()
  getUsers() {
    return this.authService.getUsers(true)
  }

  @UseGuards(AdminGuard)
  @ApiResponse({ type: UserDto, status: 201 })
  @ApiOperation({ summary: 'Create a new user.' })
  @Audited('user.create', { target: ({ body }) => (body as { username?: string } | undefined)?.username, details: ({ body }) => pick(body, ['admin']) })
  @Post()
  addUser(@Body() body: UserDto) {
    return this.authService.addUser(body)
  }

  @UseGuards(AdminGuard)
  @ApiResponse({ type: UserDto, status: 200 })
  @ApiOperation({ summary: 'Update a user.' })
  @ApiParam({ name: 'userId', type: 'number' })
  @Audited('user.update', { target: ({ params }) => params.userId, details: ({ body }) => pick(body, ['username', 'admin']) })
  @Patch('/:userId')
  updateUser(@Param('userId', ParseIntPipe) userId: number, @Body() body: UserDto) {
    return this.authService.updateUser(userId, body)
  }

  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Delete a user.' })
  @ApiParam({ name: 'userId', type: 'number' })
  @Audited('user.delete', { target: ({ params }) => params.userId })
  @Delete('/:userId')
  deleteUser(@Param('userId', ParseIntPipe) userId: number) {
    return this.authService.deleteUser(userId)
  }

  @ApiOperation({ summary: 'Update the password for the current user.' })
  @ApiBody({ type: UserUpdatePasswordDto })
  @Audited('user.change-password')
  @Post('/change-password')
  updateOwnPassword(@User() user: AuthUser, @Body() body: UserUpdatePasswordDto) {
    return this.authService.updateOwnPassword(user.username, body.currentPassword, body.newPassword)
  }

  @ApiOperation({ summary: 'Start 2FA setup for the current user.' })
  @Post('/otp/setup')
  setupOtp(@User() user: AuthUser) {
    return this.authService.setupOtp(user.username)
  }

  @ApiOperation({ summary: 'Activate 2FA setup for the current user.' })
  @ApiBody({ type: UserActivateOtpDto })
  @Audited('user.otp.activate')
  @Post('/otp/activate')
  activateOtp(@User() user: AuthUser, @Body() body: UserActivateOtpDto) {
    return this.authService.activateOtp(user.username, body.code)
  }

  @ApiOperation({ summary: 'Deactivate 2FA setup for the current user.' })
  @ApiBody({ type: UserDeactivateOtpDto })
  @Audited('user.otp.deactivate')
  @Post('/otp/deactivate')
  deactivateOtp(@User() user: AuthUser, @Body() body: UserDeactivateOtpDto) {
    return this.authService.deactivateOtp(user.username, body.password)
  }
}
