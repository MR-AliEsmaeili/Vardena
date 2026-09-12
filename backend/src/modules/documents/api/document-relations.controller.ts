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
import { DocumentRelationsService } from '../application/document-relations.service.js';
import { RELATION_PERMISSIONS } from '../domain/document-permissions.js';
import {
  CreateDocumentRelationDto,
  DocumentRelationResponseDto,
  ListDocumentRelationsQueryDto,
} from './dto/document-relation.dto.js';
import { DocumentScopeQueryDto } from './dto/document-scope.dto.js';

const PaginatedDocumentRelationDto = paginatedResponseOf(
  DocumentRelationResponseDto,
);

/**
 * Document relations (Task 8 §13/§20).
 *
 * The Foundation stores and looks up typed links between logical documents.
 * This is NOT a generic "create documents" surface: it links logical
 * references that already exist, and the owning modules remain authoritative
 * for their own documents.
 */
@ApiTags('documents')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'documents/relations', version: '1' })
export class DocumentRelationsController {
  constructor(private readonly relations: DocumentRelationsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RELATION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'List the document relations of one organization.' })
  @ApiExtraModels(PaginatedDocumentRelationDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedDocumentRelationDto) }] },
  })
  async list(@Query() query: ListDocumentRelationsQueryDto): Promise<{
    items: DocumentRelationResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.relations.listRelations(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RELATION_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one document relation of one organization.' })
  @ApiOkResponse({ type: DocumentRelationResponseDto })
  @ApiNotFoundResponse({
    description:
      'Document relation does not exist or belongs to another organization.',
  })
  async get(
    @Param('id') id: string,
    @Query() query: DocumentScopeQueryDto,
  ): Promise<DocumentRelationResponseDto> {
    return this.relations.getRelation(query.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RELATION_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Create a document relation between two logical documents (a link, not a document).',
  })
  @ApiCreatedResponse({ type: DocumentRelationResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateDocumentRelationDto,
  ): Promise<DocumentRelationResponseDto> {
    return this.relations.createRelation({
      organizationId: body.organizationId,
      source: {
        module: body.source.module,
        documentType: body.source.documentType,
        documentId: body.source.documentId,
        lineId: body.source.lineId,
      },
      target: {
        module: body.target.module,
        documentType: body.target.documentType,
        documentId: body.target.documentId,
        lineId: body.target.lineId,
      },
      relationKind: body.relationKind,
      quantity: body.quantity,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(RELATION_PERMISSIONS.DELETE)
  @ApiOperation({
    summary:
      'Delete a document relation link. Relations are links, not business facts: removing a stale link does not touch the documents.',
  })
  @ApiOkResponse({ type: DocumentRelationResponseDto })
  @ApiNotFoundResponse({
    description:
      'Document relation does not exist or belongs to another organization.',
  })
  async delete(
    @Param('id') id: string,
    @Query() query: DocumentScopeQueryDto,
  ): Promise<DocumentRelationResponseDto> {
    return this.relations.deleteRelation(query.organizationId, id);
  }
}
