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
import { BranchesService } from '../application/branches.service.js';
import { BRANCH_PERMISSIONS } from '../domain/organization-permissions.js';
import { OrganizationScopeQueryDto } from './dto/organization-scope.dto.js';
import {
  BranchResponseDto,
  CreateBranchDto,
  ListBranchesQueryDto,
  UpdateBranchDto,
} from './dto/branch.dto.js';

const PaginatedBranchDto = paginatedResponseOf(BranchResponseDto);

/**
 * Branch administration (docs/modules.md §Organization, ADR-0020 §1).
 *
 * Transport-only (AR-03). The list requires `organizationId`, so no endpoint
 * ever returns branches across organizations. A branch is a scope dimension,
 * not a legal entity — this controller manages structure only; it creates no
 * ledger, numbering or document scoping.
 */
@ApiTags('branches')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'branches', version: '1' })
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BRANCH_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the branches of one organization.' })
  @ApiExtraModels(PaginatedBranchDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedBranchDto) }] },
  })
  async list(
    @Query() query: ListBranchesQueryDto,
  ): Promise<{
    items: BranchResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.branches.listBranches(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BRANCH_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one branch.' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiNotFoundResponse({ description: 'Branch does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
  ): Promise<BranchResponseDto> {
    return this.branches.getBranch(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BRANCH_PERMISSIONS.CREATE)
  @ApiOperation({ summary: 'Create a branch in an organization.' })
  @ApiCreatedResponse({ type: BranchResponseDto })
  @ApiConflictResponse({
    description: 'Branch code already exists in this organization.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(@Body() body: CreateBranchDto): Promise<BranchResponseDto> {
    return this.branches.createBranch({
      organizationId: body.organizationId,
      code: body.code,
      name: body.name,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BRANCH_PERMISSIONS.EDIT)
  @ApiOperation({ summary: 'Edit a branch.' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiNotFoundResponse({ description: 'Branch does not exist.' })
  @ApiConflictResponse({
    description: 'Branch code already exists in this organization.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
    @Body() body: UpdateBranchDto,
  ): Promise<BranchResponseDto> {
    return this.branches.updateBranch(scope.organizationId, id, {
      code: body.code,
      name: body.name,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BRANCH_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled branch.' })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiNotFoundResponse({ description: 'Branch does not exist.' })
  async enable(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
  ): Promise<BranchResponseDto> {
    return this.branches.enableBranch(scope.organizationId, id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(BRANCH_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary:
      'Disable a branch (blocks new usage, keeps history readable). Warehouses already linked to it stay readable.',
  })
  @ApiOkResponse({ type: BranchResponseDto })
  @ApiNotFoundResponse({ description: 'Branch does not exist.' })
  async disable(
    @Param('id') id: string,
    @Query() scope: OrganizationScopeQueryDto,
  ): Promise<BranchResponseDto> {
    return this.branches.disableBranch(scope.organizationId, id);
  }
}
