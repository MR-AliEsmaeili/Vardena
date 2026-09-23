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
import { AccountingDocumentsService } from '../application/accounting-documents.service.js';
import { ACCOUNTING_DOCUMENT_PERMISSIONS } from '../domain/accounting-permissions.js';
import { AccountingScopeQueryDto } from './dto/accounting-scope.dto.js';
import {
  AccountingDocumentResponseDto,
  CreateAccountingDocumentDto,
  DocumentTransitionDto,
  ListAccountingDocumentsQueryDto,
  ReverseAccountingDocumentDto,
  UpdateAccountingDocumentDto,
} from './dto/accounting-document.dto.js';

const PaginatedAccountingDocumentDto = paginatedResponseOf(
  AccountingDocumentResponseDto,
);

/**
 * Accounting documents (vouchers) — the aggregate's minimum surface
 * (§15/§22, Task 10.4).
 *
 * The operations are exactly the contract's lifecycle: compose, read, list,
 * edit, issue (draft → temporary), finalize (temporary → final) and discard a
 * pre-final voucher. There is deliberately NO reopen, NO reversal/correction/
 * replacement and NO posting/ledger/balance/report endpoint — those belong to
 * later tasks (contract §15.4, §19; AR-29), and a route nobody may call would
 * be an invented contract.
 *
 * Transport-only (AR-03): every rule is decided by the application service and
 * the guarded repositories. Cross-organization ids answer 404, never 403
 * (AC-I-01/AC-I-16), and the owning organization is an explicit parameter on
 * every operation — a list is never cross-organization, and a client-supplied
 * organization is scope, not proof of authority (ADR-0021).
 */
@ApiTags('accounting-documents')
@ApiUnauthorizedResponse({ description: 'Not authenticated.' })
@ApiForbiddenResponse({
  description: 'Authenticated but missing the required permission.',
})
@Controller({ path: 'accounting-documents', version: '1' })
export class AccountingDocumentsController {
  constructor(private readonly documents: AccountingDocumentsService) {}

  @Get()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_DOCUMENT_PERMISSIONS.VIEW)
  @ApiOperation({
    summary: 'List the accounting documents of one organization.',
  })
  @ApiExtraModels(PaginatedAccountingDocumentDto)
  @ApiOkResponse({
    schema: {
      allOf: [{ $ref: getSchemaPath(PaginatedAccountingDocumentDto) }],
    },
  })
  async list(@Query() query: ListAccountingDocumentsQueryDto): Promise<{
    items: AccountingDocumentResponseDto[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.documents.listDocuments(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_DOCUMENT_PERMISSIONS.VIEW)
  @ApiOperation({ summary: 'Get one accounting document with its lines.' })
  @ApiOkResponse({ type: AccountingDocumentResponseDto })
  @ApiNotFoundResponse({
    description:
      'The document does not exist or belongs to another organization.',
  })
  async get(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<AccountingDocumentResponseDto> {
    return this.documents.getDocument(scope.organizationId, id);
  }

  @Post()
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_DOCUMENT_PERMISSIONS.CREATE)
  @ApiOperation({
    summary:
      'Compose an accounting document (draft, or issued directly when the organization does not require a draft).',
  })
  @ApiCreatedResponse({ type: AccountingDocumentResponseDto })
  @ApiBadRequestResponse({
    description:
      'Validation failed, the date or an amount was malformed, or the description is blank.',
  })
  @ApiNotFoundResponse({
    description:
      'The organization, financial area, branch or a referenced account does not exist in scope.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The composition is not a legal double-entry document (balance, sides, line count), an account is not postable/active, or the resolved year/period is closed or sealed.',
  })
  @ApiConflictResponse({
    description:
      'The operationKey was already used with a different intent; nothing was applied.',
  })
  async create(
    @Body() body: CreateAccountingDocumentDto,
  ): Promise<AccountingDocumentResponseDto> {
    return this.documents.createDocument({
      organizationId: body.organizationId,
      financialAreaId: body.financialAreaId,
      documentDate: body.documentDate,
      description: body.description,
      branchId: body.branchId ?? null,
      lines: body.lines.map((line) => ({
        accountId: line.accountId,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        description: line.description ?? null,
      })),
      operationKey: body.operationKey,
    });
  }

  @Patch(':id')
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_DOCUMENT_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Edit an editable accounting document (draft or temporary). The number, origin and state are not editable.',
  })
  @ApiOkResponse({ type: AccountingDocumentResponseDto })
  @ApiNotFoundResponse({
    description:
      'The document, area, branch or a referenced account was not found in scope.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is final, the area change is not allowed once issued, the replacement lines are not a legal composition, or the target period is closed.',
  })
  @ApiConflictResponse({
    description: 'The document changed while the request was in flight.',
  })
  async update(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: UpdateAccountingDocumentDto,
  ): Promise<AccountingDocumentResponseDto> {
    return this.documents.updateDocument(scope.organizationId, id, {
      ...(body.documentDate === undefined
        ? {}
        : { documentDate: body.documentDate }),
      ...(body.description === undefined
        ? {}
        : { description: body.description }),
      ...(body.branchId === undefined ? {} : { branchId: body.branchId }),
      ...(body.financialAreaId === undefined
        ? {}
        : { financialAreaId: body.financialAreaId }),
      ...(body.lines === undefined
        ? {}
        : {
            lines: body.lines.map((line) => ({
              accountId: line.accountId,
              debitAmount: line.debitAmount,
              creditAmount: line.creditAmount,
              description: line.description ?? null,
            })),
          }),
    });
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_DOCUMENT_PERMISSIONS.EDIT)
  @ApiOperation({
    summary:
      'Issue a draft (draft → temporary): allocate the document number from the numbering series of the area. Issuing an already-issued document replays the same serial.',
  })
  @ApiOkResponse({ type: AccountingDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document was not found in scope.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is final, or no numbering series is configured for the area.',
  })
  async issue(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: DocumentTransitionDto,
  ): Promise<AccountingDocumentResponseDto> {
    return this.documents.issueDocument(scope.organizationId, id, {
      operationKey: body.operationKey,
    });
  }

  @Post(':id/finalize')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_DOCUMENT_PERMISSIONS.FINALIZE)
  @ApiOperation({
    summary:
      'Finalize a temporary accounting document (temporary → final). Re-validates the balance, lines, accounts and open period inside one locked transaction; a retried operationKey replays.',
  })
  @ApiOkResponse({ type: AccountingDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document was not found in scope.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is not temporary, or the re-validation failed (balance, lines, account usability, closed/sealed period, unresolvable scope).',
  })
  @ApiConflictResponse({
    description:
      'The operationKey was already used with a different intent, or the document changed while the request was in flight.',
  })
  async finalize(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: DocumentTransitionDto,
  ): Promise<AccountingDocumentResponseDto> {
    return this.documents.finalizeDocument(scope.organizationId, id, {
      operationKey: body.operationKey,
    });
  }

  @Post(':id/reverse')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_DOCUMENT_PERMISSIONS.REVERSE)
  @ApiOperation({
    summary:
      'Reverse a finalized accounting document by posting a new finalized counter-document (debit/credit swapped). The original stays immutable.',
  })
  @ApiOkResponse({ type: AccountingDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document was not found in scope.' })
  @ApiUnprocessableEntityResponse({
    description:
      'The document is not final, is already reversed, or the reversal date does not resolve to an open period.',
  })
  @ApiConflictResponse({
    description:
      'The operationKey was already used with a different intent, or a concurrent reverse won.',
  })
  async reverse(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
    @Body() body: ReverseAccountingDocumentDto,
  ): Promise<AccountingDocumentResponseDto> {
    return this.documents.reverseDocument(scope.organizationId, id, {
      operationKey: body.operationKey,
      reason: body.reason,
      ...(body.documentDate === undefined
        ? {}
        : { documentDate: body.documentDate }),
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, AuthorizationGuard)
  @RequirePermission(ACCOUNTING_DOCUMENT_PERMISSIONS.DELETE)
  @ApiOperation({
    summary:
      'Discard a pre-final accounting document (draft or temporary). Final documents are never deletable; a discarded temporary voucher keeps its numbering allocation as an auditable gap.',
  })
  @ApiOkResponse({ type: AccountingDocumentResponseDto })
  @ApiNotFoundResponse({ description: 'The document was not found in scope.' })
  @ApiUnprocessableEntityResponse({
    description: 'The document is final and cannot be deleted (AC-I-06).',
  })
  async remove(
    @Param('id') id: string,
    @Query() scope: AccountingScopeQueryDto,
  ): Promise<AccountingDocumentResponseDto> {
    return this.documents.deleteDocument(scope.organizationId, id);
  }
}
