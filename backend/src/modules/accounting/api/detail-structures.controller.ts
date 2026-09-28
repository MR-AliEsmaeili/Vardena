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
import { DetailStructuresService } from '../application/detail-structures.service.js';
import { DETAIL_STRUCTURE_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  CreateDetailStructureVersionDto,
  DetailStructureVersionResponseDto,
  ListDetailStructuresQueryDto,
  UpdateDetailStructureVersionDto,
} from './dto/detail-structure.dto.js';

const PaginatedDetailStructureDto = paginatedResponseOf(
  DetailStructureVersionResponseDto,
);

@ApiTags('detail-structures')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'detail-structures', version: '1' })
export class DetailStructuresController {
  constructor(private readonly structures: DetailStructuresService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_STRUCTURE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the detail structure versions of one organization.',
  })
  @ApiExtraModels(PaginatedDetailStructureDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedDetailStructureDto) }] },
  })
  async list(@Query() query: ListDetailStructuresQueryDto): Promise<{
    items: DetailStructureVersionResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.structures.listDetailStructures(query);
  }

  @Get('active')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_STRUCTURE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Get the organization’s ACTIVE detail structure version.',
  })
  @ApiOkResponse({ type: DetailStructureVersionResponseDto })
  @ApiNotFoundResponse({
    description: 'The organization has no active detail structure version.',
  })
  async getActive(
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<DetailStructureVersionResponseDto | null> {
    return this.structures.getActiveDetailStructure(scope.organizationId);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_STRUCTURE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'Get one detail structure version with its levels.',
  })
  @ApiOkResponse({ type: DetailStructureVersionResponseDto })
  @ApiNotFoundResponse({
    description: 'Detail structure version does not exist.',
  })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<DetailStructureVersionResponseDto> {
    return this.structures.getDetailStructure(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_STRUCTURE_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary: 'Draft a new detail structure version (OD-29-03).',
  })
  @ApiCreatedResponse({ type: DetailStructureVersionResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or the structure shape is invalid.',
  })
  async create(
    @Body() body: CreateDetailStructureVersionDto,
  ): Promise<DetailStructureVersionResponseDto> {
    return this.structures.createDraft({
      organizationId: body.organizationId,
      title: body.title,
      maxDepth: body.maxDepth,
      levels: body.levels,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_STRUCTURE_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary: 'Edit a DRAFT detail structure version.',
  })
  @ApiOkResponse({ type: DetailStructureVersionResponseDto })
  @ApiNotFoundResponse({
    description: 'Detail structure version does not exist.',
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
    @Body() body: UpdateDetailStructureVersionDto,
  ): Promise<DetailStructureVersionResponseDto> {
    return this.structures.updateDraft(scope.organizationId, id, {
      title: body.title,
      maxDepth: body.maxDepth,
      levels: body.levels,
    });
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_STRUCTURE_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary: 'Activate a draft detail structure version.',
  })
  @ApiOkResponse({ type: DetailStructureVersionResponseDto })
  @ApiNotFoundResponse({
    description: 'Detail structure version does not exist.',
  })
  @ApiBadRequestResponse({
    description: 'The level set is not a complete, valid detail structure.',
  })
  async publish(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<DetailStructureVersionResponseDto> {
    return this.structures.publishVersion(scope.organizationId, id);
  }
}
