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
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { paginatedResponseOf } from '../../../kernel/pagination/paginated-result.js';
import { AuthGuard } from '../../identity/application/auth.guard.js';
import { AuthorizationGuard } from '../../rbac/application/authorization.guard.js';
import { RequirePermission } from '../../rbac/application/require-permission.decorator.js';
import { CodingStructuresService } from '../application/coding-structures.service.js';
import { CODING_STRUCTURE_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  CodingStructureVersionResponseDto,
  CreateCodingStructureVersionDto,
  ListCodingStructuresQueryDto,
  UpdateCodingStructureVersionDto,
} from './dto/coding-structure.dto.js';

const PaginatedCodingStructureDto = paginatedResponseOf(
  CodingStructureVersionResponseDto,
);

/**
 * Coding structure administration (contract §9, AC-D-10, Task 10.3).
 *
 * Transport-only (AR-03). The resource is the VERSION: a structure is a named
 * organization-scoped configuration whose revisions are drafted, configured and
 * published (`draft → active → superseded`, §9.4). The list therefore returns
 * versions of every structure of the organization, filtered by `code`.
 *
 * There is exactly one authority for all of it — `Configure` — because the
 * contract defines no separate "create"/"edit"/"publish" permissions for the
 * structure (§22: "versioned configuration; no free-text structure editing").
 * There is no DELETE: a published structure is retired by superseding it with a
 * new version, never by removing history (an active version may be pinned by
 * accounts).
 */
@ApiTags('coding-structures')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'coding-structures', version: '1' })
export class CodingStructuresController {
  constructor(private readonly structures: CodingStructuresService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(CODING_STRUCTURE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the coding structure versions of one organization.',
  })
  @ApiExtraModels(PaginatedCodingStructureDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedCodingStructureDto) }] },
  })
  async list(@Query() query: ListCodingStructuresQueryDto): Promise<{
    items: CodingStructureVersionResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.structures.listVersions(query);
  }

  /** Declared before `:id` so the literal route is never shadowed. */
  @Get('active')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(CODING_STRUCTURE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'Get the organization’s ACTIVE coding structure version (the shape new root accounts are coded against).',
  })
  @ApiOkResponse({ type: CodingStructureVersionResponseDto })
  @ApiNotFoundResponse({
    description: 'The organization has no active coding structure version.',
  })
  async getActive(
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<CodingStructureVersionResponseDto> {
    return this.structures.getActiveVersion(scope.organizationId);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(CODING_STRUCTURE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Get one coding structure version with its levels.',
  })
  @ApiOkResponse({ type: CodingStructureVersionResponseDto })
  @ApiNotFoundResponse({
    description: 'Coding structure version does not exist.',
  })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<CodingStructureVersionResponseDto> {
    return this.structures.getVersion(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(CODING_STRUCTURE_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Draft a new coding structure version (levels + digit lengths; nothing is hardcoded).',
  })
  @ApiCreatedResponse({ type: CodingStructureVersionResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or the structure shape is invalid.',
  })
  @ApiConflictResponse({
    description: 'A version ordinal was created concurrently. Retry.',
  })
  async create(
    @Body() body: CreateCodingStructureVersionDto,
  ): Promise<CodingStructureVersionResponseDto> {
    return this.structures.createVersion({
      organizationId: body.organizationId,
      code: body.code,
      maxDepth: body.maxDepth,
      separator: body.separator,
      levels: body.levels,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(CODING_STRUCTURE_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary: 'Edit a DRAFT coding structure version (rejected once published).',
  })
  @ApiOkResponse({ type: CodingStructureVersionResponseDto })
  @ApiNotFoundResponse({
    description: 'Coding structure version does not exist.',
  })
  @ApiBadRequestResponse({
    description: 'Validation failed or the structure shape is invalid.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'The version is not a draft and can no longer be changed.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: UpdateCodingStructureVersionDto,
  ): Promise<CodingStructureVersionResponseDto> {
    return this.structures.updateVersion(scope.organizationId, id, {
      maxDepth: body.maxDepth,
      separator: body.separator,
      levels: body.levels,
    });
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(CODING_STRUCTURE_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Activate a draft version and supersede the previously active one (exactly one active version per organization).',
  })
  @ApiOkResponse({ type: CodingStructureVersionResponseDto })
  @ApiNotFoundResponse({
    description: 'Coding structure version does not exist.',
  })
  @ApiBadRequestResponse({
    description: 'The level set is not a complete, valid coding structure.',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Only a draft version can be published.',
  })
  async publish(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<CodingStructureVersionResponseDto> {
    return this.structures.publishVersion(scope.organizationId, id);
  }
}
