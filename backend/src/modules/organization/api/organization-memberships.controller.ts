import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
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
import { DeploymentOrganizationRoot } from '../application/deployment-scope.decorator.js';
import { OrganizationMembershipsService } from '../application/organization-memberships.service.js';
import { MEMBERSHIP_PERMISSIONS } from '../domain/organization-permissions.js';
import {
  GrantMembershipDto,
  ListMembersQueryDto,
  OrganizationMembershipResponseDto,
} from './dto/organization-membership.dto.js';

const PaginatedMembershipDto = paginatedResponseOf(
  OrganizationMembershipResponseDto,
);

/**
 * Principal → organization membership administration (Task 19, ODR-3).
 *
 * Transport-only (AR-03), shaped after the RBAC role-assignment routes
 * (`POST /roles/:id/users`, `DELETE /roles/:id/users/:userId`): the
 * organization is addressed by the `:id` path parameter — marked with
 * `@DeploymentOrganizationRoot()` so the deployment pin guard (ADR-0025)
 * confines these routes exactly like every other organization-root route.
 *
 * Granting does not require the grantor to already be a member: the Grant
 * permission is the administration authority (the first membership of an
 * organization must be grantable — see the application service).
 */
@ApiTags('organization-memberships')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'organizations/:id/members', version: '1' })
export class OrganizationMembershipsController {
  constructor(private readonly memberships: OrganizationMembershipsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MEMBERSHIP_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: "List an organization's members (paged, grant order).",
  })
  @ApiExtraModels(PaginatedMembershipDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedMembershipDto) }] },
  })
  @ApiNotFoundResponse({ description: 'Organization does not exist.' })
  @DeploymentOrganizationRoot()
  async list(
    @Param('id') id: string,
    @Query() query: ListMembersQueryDto,
  ): Promise<{
    items: OrganizationMembershipResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.memberships.listMembers(id, query);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MEMBERSHIP_PERMISSIONS.GRANT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Grant a user access to an organization.' })
  @ApiNoContentResponse({ description: 'Membership granted.' })
  @ApiNotFoundResponse({
    description: 'Organization or user does not exist.',
  })
  @ApiConflictResponse({ description: 'User is already a member.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  @DeploymentOrganizationRoot()
  async grant(
    @Param('id') id: string,
    @Body() body: GrantMembershipDto,
  ): Promise<void> {
    await this.memberships.grantMembership(id, body.userId);
  }

  @Delete(':userId')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(MEMBERSHIP_PERMISSIONS.REVOKE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Revoke a user's access to an organization." })
  @ApiNoContentResponse({ description: 'Membership revoked.' })
  @ApiNotFoundResponse({
    description: 'Organization does not exist, or the user is not a member.',
  })
  @DeploymentOrganizationRoot()
  async revoke(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.memberships.revokeMembership(id, userId);
  }
}
