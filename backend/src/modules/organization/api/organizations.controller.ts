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
  UpdateOrganizationDto,
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
  async list(
    @Query() query: ListOrganizationsQueryDto,
  ): Promise<{
    items: OrganizationResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.organizations.listOrganizations(query);
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
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ORGANIZATION_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit an organization.' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiNotFoundResponse({ description: 'Organization does not exist.' })
  @ApiConflictResponse({ description: 'Organization code already exists.' })
  @DeploymentOrganizationRoot()
  async update(
    @Param('id') id: string,
    @Body() body: UpdateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizations.updateOrganization(id, {
      code: body.code,
      name: body.name,
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
