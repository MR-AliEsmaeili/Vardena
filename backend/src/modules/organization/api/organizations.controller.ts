import {
  Body,
  Controller,
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
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
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
import { OrganizationsService } from '../application/organizations.service.js';
import { DeploymentOrganizationRoot } from '../application/deployment-scope.decorator.js';
import { ORGANIZATION_PERMISSIONS } from '../domain/organization-permissions.js';
import {
  CreateOrganizationDto,
  ListOrganizationsQueryDto,
  OrganizationResponseDto,
} from './dto/organization.dto.js';

const PaginatedOrganizationDto = paginatedResponseOf(OrganizationResponseDto);

/**
 * Organization administration (docs/modules.md §Organization).
 *
 * Transport-only (AR-03): HTTP mapping, DTO validation, permission
 * declaration, response shaping. Every route is authenticated (`AuthGuard`)
 * and authorized (`AuthorizationGuard` + `@RequirePermission`), and the
 * application service re-checks the same permission (AR-21).
 *
 * There is intentionally no delete endpoint: master-data lifecycle is
 * `is_active` (master-data-strategy.md §7.4) and deletion semantics are open
 * (OQ-36).
 */
@ApiTags('organizations')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'organizations', version: '1' })
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ORGANIZATION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List organizations (paginated).' })
  @ApiExtraModels(PaginatedOrganizationDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedOrganizationDto) }] },
  })
  async list(@Query() query: ListOrganizationsQueryDto): Promise<{
    items: OrganizationResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.organizations.listOrganizations(query);
  }

  /**
   * The organization BOOTSTRAP read (Organization Bootstrap & Context
   * Foundation task): the organizations the AUTHENTICATED SESSION may use as
   * its working scope, decided by membership alone.
   *
   * Declared before `:id` — Nest matches routes in declaration order, and
   * `mine` must never be captured as an `:id` path parameter.
   *
   * Documented authorization exception (AR-21), the same one
   * `GET /permissions/effective` and `GET /license/current` already use: no
   * permission code, because the response is limited to the caller's own
   * memberships. It is NOT the `Organization.Organization.View`
   * administration catalog `GET /organizations` above — see
   * `OrganizationsService.listMyOrganizations`.
   */
  @Get('mine')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary:
      "The authenticated session's own accessible organizations (bootstrap read).",
    description:
      'Organizations the caller holds an active membership of, excluding inactive organizations. No administration permission is required — membership is the authorization.',
  })
  @ApiOkResponse({ type: OrganizationResponseDto, isArray: true })
  async mine(): Promise<OrganizationResponseDto[]> {
    return this.organizations.listMyOrganizations();
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ORGANIZATION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one organization.' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiNotFoundResponse({ description: 'Organization does not exist.' })
  @DeploymentOrganizationRoot()
  async get(@Param('id') id: string): Promise<OrganizationResponseDto> {
    return this.organizations.getOrganization(id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ORGANIZATION_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create an organization.' })
  @ApiCreatedResponse({ type: OrganizationResponseDto })
  @ApiConflictResponse({ description: 'Organization code already exists.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizations.createOrganization({
      code: body.code,
      name: body.name,
      calendarSystem: body.calendarSystem,
      timeZone: body.timeZone,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ORGANIZATION_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled organization.' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiNotFoundResponse({ description: 'Organization does not exist.' })
  @DeploymentOrganizationRoot()
  async enable(@Param('id') id: string): Promise<OrganizationResponseDto> {
    return this.organizations.enableOrganization(id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ORGANIZATION_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable an organization (blocks new organization-scoped records, keeps history readable).',
  })
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiNotFoundResponse({ description: 'Organization does not exist.' })
  @DeploymentOrganizationRoot()
  async disable(@Param('id') id: string): Promise<OrganizationResponseDto> {
    return this.organizations.disableOrganization(id);
  }
}
