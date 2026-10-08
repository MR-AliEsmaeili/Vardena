import {
  Body,
  Controller,
  Delete,
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
import { InventoryBusinessDocumentsService } from '../application/inventory-business-documents.service.js';
import { INVENTORY_DOCUMENT_PERMISSIONS } from '../domain/inventory-document-permissions.js';
import {
  toAccountingPostingOperationDto,
  type AccountingPostingOperationDto,
} from '../domain/inventory-accounting-posting-operation.js';
import { InventoryScopeQueryDto } from './dto/organization-scope.dto.js';
import {
  AccountingPostInventoryDocumentDto,
  CancelInventoryDocumentDto,
  CreateInventoryDocumentDto,
  FinalizeInventoryDocumentDto,
  InventoryAccountingPostingOperationResponseDto,
  InventoryDocumentResponseDto,
  ListInventoryDocumentsQueryDto,
  UpdateInventoryDocumentDto,
} from './dto/inventory-business-document.dto.js';

const PaginatedInventoryDocumentDto = paginatedResponseOf(
  InventoryDocumentResponseDto,
);

/**
 * Inventory Business Documents (C-58) — Receipt, Issue and Transfer.
 *
 * Transport-only (AR-03). Explicit COMMANDS rather than a generic status
 * PATCH, because the behaviours differ materially: `finalize` posts the
 * ledger effect, `accounting-post` crosses the immutability boundary, `seal`
 * is terminal and `cancel` reverses. There is deliberately no endpoint that
 * sets an arbitrary status. C-62 adds `accounting-post/cancel` for the one
 * case that needs its own verb: an Accounting-owned DRAFT.
 *
 * Every route authenticates, checks an operation-level Inventory permission
 * and resolves the document inside the caller's organization scope — a
 * document belonging to another organization answers 404, never 403
 * (ADR-0021 §4, no IDOR).
 */
@ApiTags('inventory-business-documents')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'inventory/business-documents', version: '1' })
export class InventoryBusinessDocumentsController {
  constructor(private readonly documents: InventoryBusinessDocumentsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List Inventory business documents of one organization (receipt, issue, transfer).',
  })
  @ApiExtraModels(PaginatedInventoryDocumentDto)
  @ApiOkResponse({
    schema: { allOf: [{ $ref: getSchemaPath(PaginatedInventoryDocumentDto) }] },
  })
  async list(@Query() query: ListInventoryDocumentsQueryDto): Promise<{
    items: InventoryDocumentResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.documents.listDocuments({
      organizationId: query.organizationId,
      kind: query.kind,
      status: query.status,
      warehouseId: query.warehouseId,
      dateFrom: toDate(query.dateFrom),
      dateTo: toDate(query.dateTo),
      page: query.page,
      pageSize: query.pageSize,
      sort: query.sort,
    });
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one Inventory business document with lines.' })
  @ApiOkResponse({ type: InventoryDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document does not exist.' })
  async get(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<InventoryDocumentResponseDto> {
    return this.documents.getDocument(id, scope.organizationId);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Create a DRAFT Inventory business document. A draft has no stock effect and consumes no document number.',
  })
  @ApiOkResponse({ type: InventoryDocumentResponseDto })
  @ApiNotFoundResponse({
    description: 'Organization, warehouse, item or unit does not exist.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'A disabled or non-stockable reference, a same-warehouse transfer, a cost on an issue/transfer, or no unit conversion covering the business date.',
  })
  @ApiBadRequestResponse({ description: 'Validation failed.' })
  async create(
    @Body() body: CreateInventoryDocumentDto,
  ): Promise<InventoryDocumentResponseDto> {
    return this.documents.createDraft({
      organizationId: body.organizationId,
      kind: body.kind,
      businessDate: toDate(body.businessDate),
      warehouseId: body.warehouseId,
      sourceWarehouseId: body.sourceWarehouseId,
      destinationWarehouseId: body.destinationWarehouseId,
      cost: body.cost,
      description: body.description,
      reference: body.reference,
      lines: body.lines,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit a document before Accounting Post. Editing an OPERATIONAL document reconciles its ledger effect atomically and requires an explicit side-effect acknowledgement plus a repricing choice.',
  })
  @ApiOkResponse({ type: InventoryDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'Accounting-posted/cancelled document, missing side-effect acknowledgement or repricing choice, backdating refusal, or insufficient stock (nothing was changed).',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: UpdateInventoryDocumentDto,
  ): Promise<InventoryDocumentResponseDto> {
    return this.documents.updateDocument(id, scope.organizationId, {
      businessDate: toDate(body.businessDate),
      warehouseId: body.warehouseId,
      sourceWarehouseId: body.sourceWarehouseId,
      destinationWarehouseId: body.destinationWarehouseId,
      cost: body.cost,
      description: body.description,
      reference: body.reference,
      lines: body.lines,
      acknowledgeSideEffects: body.acknowledgeSideEffects,
      repricing: body.repricing,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.DELETE)
  @ApiOperation({
    summary:
      'Delete a DRAFT document. A document with business history is cancelled, never deleted (OD-54-07).',
  })
  @ApiNotFoundResponse({ description: 'The document does not exist.' })
  @ApiUnprocessableEntityResponse({
    description: 'The document is not a draft.',
  })
  async remove(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<void> {
    await this.documents.deleteDraft(id, scope.organizationId);
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.FINALIZE)
  @ApiOperation({
    summary:
      'Finalize: allocate the document number and post the operational movement effect (both transfer legs for a transfer) atomically. Self-finalization is allowed — C-58 introduces no approval workflow.',
  })
  @ApiOkResponse({ type: InventoryDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document does not exist.' })
  @ApiConflictResponse({
    description: 'The idempotency key is held by a different request.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Illegal transition, insufficient stock, a missing backdating decision, an unconfirmed backdated transfer (inventory.backdated_document), or no numbering series configured.',
  })
  async finalize(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: FinalizeInventoryDocumentDto,
  ): Promise<InventoryDocumentResponseDto> {
    return this.documents.finalizeDocument(id, scope.organizationId, {
      backdateConfirmed: body.backdateConfirmed,
      repricing: body.repricing,
    });
  }

  @Get(':id/accounting-posting')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.VIEW)
  @ApiOperation({
    summary:
      'List the durable C-62 Accounting posting operations of one document, newest first. The only place a refusal or failure reason is visible: the document keeps its own standing, so why a posting did not cross the boundary is a fact about the OPERATION.',
  })
  @ApiOkResponse({ type: [InventoryAccountingPostingOperationResponseDto] })
  @ApiNotFoundResponse({ description: 'The document does not exist.' })
  async listAccountingPostings(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<readonly AccountingPostingOperationDto[]> {
    const operations = await this.documents.listAccountingPostings(
      id,
      scope.organizationId,
    );
    return operations.map(toAccountingPostingOperationDto);
  }

  @Post(':id/accounting-post')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.ACCOUNTING_POST)
  @ApiOperation({
    summary:
      "Cross the Accounting Post boundary (C-62): ask Accounting to post this document's authoritative value. A `direct_final` warehouse produces a FINAL Accounting voucher and the document becomes Accounting Posted; a `draft` warehouse produces an Accounting-owned DRAFT and the document does NOT. The same operation key replays the same answer.",
  })
  @ApiOkResponse({ type: InventoryDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is not accounting eligible: not operational, not fully priced, or its valuation is stale.',
  })
  @ApiConflictResponse({
    description:
      'The operation key was already used for a different request, or the document is already Accounting Posted.',
  })
  async accountingPost(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: AccountingPostInventoryDocumentDto,
  ): Promise<InventoryDocumentResponseDto> {
    return this.documents.accountingPostDocument(id, scope.organizationId, {
      operationKey: body.operationKey,
      expectedDocumentRevision: body.expectedDocumentRevision,
    });
  }

  @Post(':id/accounting-post/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.ACCOUNTING_POST)
  @ApiOperation({
    summary:
      'Cancel the Accounting DRAFT a posting created (C62-OD-02). The draft belongs to Accounting, so it is discarded through the same contract and the document returns to its normal accounting-eligible lifecycle state. A FINAL voucher is never cancellable here.',
  })
  @ApiOkResponse({ type: InventoryDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The document has no Accounting draft to cancel: it was never posted in draft mode, was already cancelled, or is finally posted.',
  })
  @ApiConflictResponse({
    description:
      'Accounting no longer holds a cancellable draft for this operation.',
  })
  async cancelAccountingPost(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: AccountingPostInventoryDocumentDto,
  ): Promise<InventoryDocumentResponseDto> {
    return this.documents.cancelAccountingPosting(id, scope.organizationId, {
      operationKey: body.operationKey,
    });
  }

  @Post(':id/seal')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.SEAL)
  @ApiOperation({
    summary:
      'Seal an accounting-posted document as permanently immutable. Terminal: no transition out of `immutable` exists.',
  })
  @ApiOkResponse({ type: InventoryDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document does not exist.' })
  @ApiUnprocessableEntityResponse({
    description: 'The document is not accounting posted.',
  })
  async seal(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
  ): Promise<InventoryDocumentResponseDto> {
    return this.documents.sealDocument(id, scope.organizationId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(INVENTORY_DOCUMENT_PERMISSIONS.CANCEL)
  @ApiOperation({
    summary:
      'Cancel before Accounting Post. An operational document has its own movements reversed atomically; the number is kept and never reused, and the document stays visible (OD-54-07/08/09).',
  })
  @ApiOkResponse({ type: InventoryDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document does not exist.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is accounting posted (an explicit accounting correction is required — OQ-27), already cancelled, or the reversal would drive stock negative.',
  })
  async cancel(
    @Param('id') id: string,
    @Query() scope: InventoryScopeQueryDto,
    @Body() body: CancelInventoryDocumentDto,
  ): Promise<InventoryDocumentResponseDto> {
    return this.documents.cancelDocument(id, scope.organizationId, {
      reason: body.reason,
    });
  }
}

// ---- Internal helpers ----

function toDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}
