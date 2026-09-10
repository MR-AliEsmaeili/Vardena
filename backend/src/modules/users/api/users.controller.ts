import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { UsersService } from '../application/users.service.js';
import { USER_PERMISSIONS } from '../domain/user-permissions.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import {
  CreateUserDto,
  ResetPasswordDto,
  UpdateUserDto,
} from './dto/user-request.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';

const PaginatedUserDto = paginatedResponseOf(UserResponseDto);

/**
 * User administration (docs/modules.md §Users).
 *
 * Transport-only (AR-03): HTTP mapping, DTO validation, permission
 * declaration, response shaping. Every route is authenticated (`AuthGuard`)
 * and authorized (`AuthorizationGuard` + `@RequirePermission`), and the
 * application service re-checks the same permission (AR-21). None of these
 * endpoints is public — user records are administrative data.
 *
 * There is intentionally no delete endpoint and no self-service password
 * endpoint here: neither rule is defined in the repository (OQ-18/OQ-06).
 */
@ApiTags('users')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(USER_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List users (paginated, filter by active state).' })
  @ApiExtraModels(PaginatedUserDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedUserDto) }] },
  })
  async list(@Query() query: ListUsersQueryDto): Promise<{
    items: UserResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.users.listUsers(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(USER_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one user.' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User does not exist.' })
  async get(@Param('id') id: string): Promise<UserResponseDto> {
    return this.users.getUser(id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(USER_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create a user account.' })
  @ApiCreatedResponse({ type: UserResponseDto })
  @ApiConflictResponse({ description: 'Username already exists.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(@Body() body: CreateUserDto): Promise<UserResponseDto> {
    return this.users.createUser({
      username: body.username,
      password: body.password,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(USER_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit the username of a user.' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User does not exist.' })
  @ApiConflictResponse({ description: 'Username already exists.' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.users.updateUser(id, { username: body.username });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(USER_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled user account.' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User does not exist.' })
  async enable(@Param('id') id: string): Promise<UserResponseDto> {
    return this.users.enableUser(id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(USER_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary: 'Disable a user account (blocks login, revokes sessions).',
  })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'User does not exist.' })
  async disable(@Param('id') id: string): Promise<UserResponseDto> {
    return this.users.disableUser(id);
  }

  @Post(':id/password-reset')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(USER_PERMISSIONS.RESET_PASSWORD)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Reset a user's password (administrator action)." })
  @ApiNoContentResponse({ description: 'Password reset.' })
  @ApiNotFoundResponse({ description: 'User does not exist.' })
  async resetPassword(
    @Param('id') id: string,
    @Body() body: ResetPasswordDto,
  ): Promise<void> {
    await this.users.resetPassword(id, body.newPassword);
  }
}
