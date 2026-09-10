import {
  Body,
  Controller,
  Delete,
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
import { AuthorizationGuard } from '../application/authorization.guard.js';
import { RolesService } from '../application/roles.service.js';
import { UserRolesService } from '../application/user-roles.service.js';
import { RBAC_PERMISSIONS } from '../domain/rbac-permissions.js';
import { RequirePermission } from '../application/require-permission.decorator.js';
import { ListRolesQueryDto } from './dto/role-query.dto.js';
import { RoleDetailDto, RoleDto } from './dto/role.dto.js';
import {
  AssignPermissionDto,
  AssignRoleToUserDto,
  CreateRoleDto,
  UpdateRoleDto,
} from './dto/role-request.dto.js';

const PaginatedRoleDto = paginatedResponseOf(RoleDto);

/**
 * Role administration (docs/modules.md §RBAC, task §16).
 *
 * Transport-only (AR-03): HTTP mapping, DTO validation, permission
 * *declaration*, and response shaping. Authorization is enforced by the guards
 * below and re-checked inside the application services (AR-04/AR-21) — the
 * controller never inspects roles or permissions itself.
 *
 * Every route declares exactly one permission. Declaring several would mean
 * ALL of them are required (task §13).
 */
@ApiTags('rbac')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly userRoles: UserRolesService,
  ) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RBAC_PERMISSIONS.ROLE_VIEW)
  @ApiOperation({ summary: 'List roles (paginated).' })
  @ApiExtraModels(PaginatedRoleDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedRoleDto) }] },
  })
  async list(@Query() query: ListRolesQueryDto): Promise<{
    items: RoleDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.roles.listRoles(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RBAC_PERMISSIONS.ROLE_VIEW)
  @ApiOperation({ summary: 'Get a role with its assigned permissions.' })
  @ApiOkResponse({ type: RoleDetailDto })
  @ApiNotFoundResponse({ description: 'Role does not exist.' })
  async get(@Param('id') id: string): Promise<RoleDetailDto> {
    return this.roles.getRole(id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RBAC_PERMISSIONS.ROLE_CREATE)
  @ApiOperation({
    summary: 'Create a role (optionally with its initial permission set).',
  })
  @ApiCreatedResponse({ type: RoleDetailDto })
  @ApiConflictResponse({ description: 'A role with that name already exists.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(@Body() body: CreateRoleDto): Promise<RoleDetailDto> {
    return this.roles.createRole(body);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RBAC_PERMISSIONS.ROLE_EDIT)
  @ApiOperation({ summary: 'Edit role name/description.' })
  @ApiOkResponse({ type: RoleDetailDto })
  @ApiNotFoundResponse({ description: 'Role does not exist.' })
  @ApiConflictResponse({ description: 'A role with that name already exists.' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateRoleDto,
  ): Promise<RoleDetailDto> {
    return this.roles.updateRole(id, body);
  }

  @Post(':id/permissions')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RBAC_PERMISSIONS.ROLE_PERMISSION_ASSIGN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Assign a permission to a role.' })
  @ApiNoContentResponse({ description: 'Permission assigned.' })
  @ApiNotFoundResponse({ description: 'Role or permission does not exist.' })
  @ApiConflictResponse({ description: 'Permission already assigned.' })
  async assignPermission(
    @Param('id') id: string,
    @Body() body: AssignPermissionDto,
  ): Promise<void> {
    await this.roles.assignPermissionToRole(id, body.code);
  }

  @Delete(':id/permissions/:code')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RBAC_PERMISSIONS.ROLE_PERMISSION_REMOVE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a permission from a role.' })
  @ApiNoContentResponse({ description: 'Permission removed.' })
  @ApiNotFoundResponse({
    description: 'Role, permission, or assignment not found.',
  })
  async removePermission(
    @Param('id') id: string,
    @Param('code') code: string,
  ): Promise<void> {
    await this.roles.removePermissionFromRole(id, code);
  }

  @Post(':id/users')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RBAC_PERMISSIONS.USER_ROLE_ASSIGN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Assign a role to a user.' })
  @ApiNoContentResponse({ description: 'Role assigned.' })
  @ApiNotFoundResponse({ description: 'Role or user does not exist.' })
  @ApiConflictResponse({ description: 'Role already assigned to that user.' })
  async assignUserToRole(
    @Param('id') id: string,
    @Body() body: AssignRoleToUserDto,
  ): Promise<void> {
    await this.userRoles.assignRoleToUser(id, body.userId);
  }

  @Delete(':id/users/:userId')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RBAC_PERMISSIONS.USER_ROLE_REMOVE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a role from a user.' })
  @ApiNoContentResponse({ description: 'Role removed.' })
  @ApiNotFoundResponse({ description: 'Role, user, or assignment not found.' })
  async removeUserFromRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.userRoles.removeRoleFromUser(id, userId);
  }
}
