import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { DocumentTypesService } from '../application/document-types.service.js';
import { DOCUMENT_TYPE_PERMISSIONS } from '../domain/document-permissions.js';
import {
  ConfigureDocumentTypeDto,
  DocumentTypeCodeQueryDto,
  DocumentTypeResponseDto,
  ListDocumentTypesQueryDto,
} from './dto/document-type.dto.js';

const PaginatedDocumentTypeDto = paginatedResponseOf(DocumentTypeResponseDto);

/**
 * Document type metadata + organization configuration (Task 8 §6/§20).
 *
 * Read-only metadata from the code registry, plus a single configuration
 * write (`draft_required`). There is deliberately no POST /documents/types:
 * a document type is a code change, never a client operation.
 */
@ApiTags('documents')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'documents/types', version: '1' })
export class DocumentTypesController {
  constructor(private readonly documentTypes: DocumentTypesService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DOCUMENT_TYPE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the registered document types of one organization.',
  })
  @ApiExtraModels(PaginatedDocumentTypeDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedDocumentTypeDto) }] },
  })
  async list(@Query() query: ListDocumentTypesQueryDto): Promise<{
    items: DocumentTypeResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.documentTypes.listDocumentTypes(query);
  }

  @Get(':code')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DOCUMENT_TYPE_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'Get one registered document type with its organization configuration.',
  })
  @ApiOkResponse({ type: DocumentTypeResponseDto })
  @ApiNotFoundResponse({ description: 'Document type is not registered.' })
  async get(
    @Param('code') code: string,
    @Query() query: DocumentTypeCodeQueryDto,
  ): Promise<DocumentTypeResponseDto> {
    return this.documentTypes.getDocumentType(query.organizationId, code);
  }

  @Put(':code/configuration')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(DOCUMENT_TYPE_PERMISSIONS.CONFIGURE)
  @ApiOperation({
    summary:
      'Configure a registered document type for an organization (e.g. whether draft is required before issuance).',
  })
  @ApiOkResponse({ type: DocumentTypeResponseDto })
  @ApiNotFoundResponse({ description: 'Document type is not registered.' })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async configure(
    @Param('code') code: string,
    @Query() query: DocumentTypeCodeQueryDto,
    @Body() body: ConfigureDocumentTypeDto,
  ): Promise<DocumentTypeResponseDto> {
    return this.documentTypes.configureDocumentType(
      query.organizationId,
      code,
      { draftRequired: body.draftRequired },
    );
  }
}
