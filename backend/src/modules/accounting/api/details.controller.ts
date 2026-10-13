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
import { DetailsService } from '../application/details.service.js';
import { DETAIL_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  CreateDetailDto,
  DetailResponseDto,
  ListDetailsQueryDto,
  UpdateDetailDto,
} from './dto/detail.dto.js';

const PaginatedDetailDto = paginatedResponseOf(DetailResponseDto);

@ApiTags('details')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'details', version: '1' })
export class DetailsController {
  constructor(private readonly details: DetailsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List detail records of one organization.',
  })
  @ApiExtraModels(PaginatedDetailDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedDetailDto) }] },
  })
  async list(@Query() query: ListDetailsQueryDto): Promise<{
    items: DetailResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.details.listDetails(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one detail record.' })
  @ApiOkResponse({ type: DetailResponseDto })
  @ApiNotFoundResponse({ description: 'Detail record does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<DetailResponseDto> {
    return this.details.getDetail(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Create a detail record in the hierarchy (level is derived). Level 1 is a Detail Group.',
  })
  @ApiCreatedResponse({ type: DetailResponseDto })
  @ApiBadRequestResponse({
    description: 'Validation failed or the code shape is invalid.',
  })
  @ApiConflictResponse({
    description:
      'A detail record with that code already exists in this organization.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The placement violates a detail invariant (parent, level, code prefix, depth).',
  })
  async create(@Body() body: CreateDetailDto): Promise<DetailResponseDto> {
    return this.details.createDetail({
      organizationId: body.organizationId,
      code: body.code,
      title: body.title,
      parentId: body.parentId,
      isPostable: body.isPostable,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit a detail record (title; postability and parent only while unreferenced).',
  })
  @ApiOkResponse({ type: DetailResponseDto })
  @ApiNotFoundResponse({ description: 'Detail record does not exist.' })
  @ApiBadRequestResponse({
    description: 'Validation failed or the code shape is invalid.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The change violates a detail invariant, or the record is already referenced by document lines.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: UpdateDetailDto,
  ): Promise<DetailResponseDto> {
    return this.details.updateDetail(scope.organizationId, id, {
      title: body.title,
      isPostable: body.isPostable,
      parentId: body.parentId,
    });
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_PERMISSIONS.ENABLE)
  @ApiOperation({ summary: 'Enable a disabled detail record.' })
  @ApiOkResponse({ type: DetailResponseDto })
  @ApiNotFoundResponse({ description: 'Detail record does not exist.' })
  async enable(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<DetailResponseDto> {
    return this.details.enableDetail(scope.organizationId, id);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DETAIL_PERMISSIONS.DISABLE)
  @ApiOperation({
    summary: 'Disable a detail record. Records are never deleted.',
  })
  @ApiOkResponse({ type: DetailResponseDto })
  @ApiNotFoundResponse({ description: 'Detail record does not exist.' })
  async disable(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<DetailResponseDto> {
    return this.details.disableDetail(scope.organizationId, id);
  }
}
