import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../application/authorization.guard.js';
import { AuthorizationService } from '../application/authorization.service.js';
import { PermissionsService } from '../application/permissions.service.js';
import { RBAC_PERMISSIONS } from '../domain/rbac-permissions.js';
import { RequirePermission } from '../application/require-permission.decorator.js';
import { ListRolesQueryDto } from './dto/role-query.dto.js';
import {
  EffectivePermissionsDto,
  PermissionDto,
} from './dto/permission.dto.js';

const PaginatedPermissionDto = paginatedResponseOf(PermissionDto);

/**
 * Permission reference API (docs/modules.md §RBAC, task §17).
 *
 * Permissions are configuration data mirrored from the code registry: this
 * controller is **read-only**. There is intentionally no create/update/delete
 * endpoint — a caller must not be able to invent a security code that no code
 * enforces (ADR-0006).
 */
@ApiTags('rbac')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@Controller({ path: 'permissions', version: '1' })
export class PermissionsController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RBAC_PERMISSIONS.PERMISSION_VIEW)
  @ApiOperation({
    summary: 'List the permission registry (paginated, ordered by code).',
  })
  @ApiExtraModels(PaginatedPermissionDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedPermissionDto) }] },
  })
  @ApiForbiddenResponse({
    description: 'Authenticated but missing Rbac.Permission.View.',
  })
  async list(@Query() query: ListRolesQueryDto): Promise<{
    items: PermissionDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.permissions.list(query);
  }

  /**
   * Effective permissions of the **current** session.
   *
   * Documented authorization exception (AR-21): this endpoint carries no
   * permission code because it returns the caller's own permissions. It is
   * still authenticated — it is not anonymous configuration, and the data it
   * exposes is limited to the caller (a UI bootstrapping read).
   *
   * The frontend uses it to hide menus/buttons; the backend remains the only
   * enforcement point (AR-21).
   */
  @Get('effective')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Effective permissions of the authenticated session (self).',
  })
  @ApiOkResponse({ type: EffectivePermissionsDto })
  async effective(): Promise<EffectivePermissionsDto> {
    const principal = getPrincipal();
    if (principal === undefined) {
      // Belt-and-braces: AuthGuard already ensured authentication.
      throw AppException.unauthorized('Authentication is required.');
    }
    return {
      userId: principal.userId,
      permissions: await this.authorization.effectivePermissionCodes(
        principal.userId,
      ),
    };
  }
}
