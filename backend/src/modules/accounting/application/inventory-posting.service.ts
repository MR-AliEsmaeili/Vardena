import { Injectable } from '@nestjs/common';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { AccountsService } from './accounts.service.js';
import { FinancialAreasService } from './financial-areas.service.js';
import { AccountingDocumentsService } from './accounting-documents.service.js';
import type { AccountingDocumentDto } from '../domain/accounting-document.js';
import { SourcePostingMappingsRepository } from '../data/source-posting-mappings.repository.js';
import type { SourcePostingMapping } from '../domain/source-posting-mapping.js';
import { isZeroAmount } from '../domain/money.js';
import {
  ACCOUNTING_SOURCE_POSTING_AUTHORITY_CODE,
  EXPECTED_ACCOUNTING_SOURCE_POSTING_AUTHORITY,
  INVENTORY_POSTING_SOURCE_MODULE,
  INVENTORY_POSTING_SOURCE_OPERATION,
  isInventoryPostingSourceDocumentType,
  type InventoryPostingActor,
  type InventoryPostingDraftCancellation,
  type InventoryPostingRequest,
  type InventoryPostingResult,
  type InventoryPostingRefusalCode,
} from './inventory-posting-contract.js';
import type { ServiceAuthority } from '../../rbac/domain/service-authority.js';

/** `accounting_documents.description` width. */
const MAX_VOUCHER_DESCRIPTION_LENGTH = 500;

/**
 * The Accounting-owned Inventory → Accounting posting contract (C-62,
 * ADR-0041 §2, PDR-09 PO-01/PO-04, PDR-10 C62-OD-02/OD-03/OD-04).
 *
 * THIS is the boundary. Inventory calls `postFromInventory` with SOURCE FACTS
 * and receives a typed Accounting RESULT. It never names an account, never
 * names a financial area, never writes an Accounting row and never reads an
 * Accounting table: everything accounting-shaped is resolved here, inside the
 * module that owns it.
 *
 * What Accounting owns, concretely:
 *   * the account mapping — resolved from `accounting.source_posting_mappings`
 *     and nowhere else; a missing or unusable mapping is a fail-closed
 *     refusal (`accounting.mapping_missing` / `accounting.mapping_unusable`),
 *     never a guessed account (C62-OD-04);
 *   * the journal policy — for the C-62 slice, one valued receipt becomes ONE
 *     balanced voucher: the authoritative value debited to the mapped
 *     inventory account and credited to the mapped offsetting account. The
 *     journal line count is independent of the movement count (PO-04);
 *   * the financial area and the period — resolved by the document
 *     aggregate's own guarded transaction, which re-validates an OPEN period
 *     and usable, postable accounts under the module's locks;
 *   * the posting mode's finalization behaviour — `direct_final` drives the
 *     voucher to `final` (a real GL effect); `draft` leaves it an
 *     Accounting-owned draft an accountant registers or cancels later.
 *
 * Authority (C62-OD-03): the operation runs under the EXPLICIT bounded service
 * authority `Accounting.Document.SourcePost`, asserted against the
 * authenticated initiating human and the initiating Inventory permission. No
 * wildcard, no "system context is trusted", and nothing here consults the
 * License.
 *
 * Idempotency (C62-OD-06): the operation key Accounting's own ledger is keyed
 * by is derived deterministically from the Inventory operation, so a replay of
 * the same request returns the SAME Accounting document instead of creating a
 * second voucher, and a different request under the same key is refused with
 * 409 by the document aggregate's own ledger rule.
 */
@Injectable()
export class InventoryPostingService {
  constructor(
    private readonly documents: AccountingDocumentsService,
    private readonly mappings: SourcePostingMappingsRepository,
    private readonly accounts: AccountsService,
    private readonly areas: FinancialAreasService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
  ) {}

  /**
   * Post ONE Inventory business document's facts to Accounting.
   *
   * Never throws for a business refusal or a business failure: both are
   * RESULTS the caller must persist, because «no mapping is configured» and
   * «the period is closed» are durable facts about the operation, not
   * transport errors. A 409 on the operation key and an internal defect DO
   * propagate: the first is the idempotency contract's own answer, the second
   * must not be reported as an accounting outcome.
   */
  async postFromInventory(
    request: InventoryPostingRequest,
  ): Promise<InventoryPostingResult> {
    const requestedAt = new Date().toISOString();
    const authority: ServiceAuthority = {
      code: ACCOUNTING_SOURCE_POSTING_AUTHORITY_CODE,
      initiatedByUserId: request.actor.userId,
      initiatingPermission: request.actor.permission,
      organizationId: request.actor.organizationId,
    };

    // 1. Organization scope, then the explicit service authority. The order
    //    matters: a cross-organization request fails closed before any
    //    authority decision is recorded against it.
    await this.organizations.assertOrganizationInScope(request.organizationId);
    await this.authorization.requireServiceAuthority(
      authority,
      EXPECTED_ACCOUNTING_SOURCE_POSTING_AUTHORITY,
      request.organizationId,
    );

    // 2. The source document type this slice implements. Anything else is
    //    refused, never posted by inference (PO-03/PO-12: only explicitly
    //    approved document types may create posting operations).
    if (!isInventoryPostingSourceDocumentType(request.sourceDocumentType)) {
      return this.refusal(
        request,
        'accounting.source_type_unsupported',
        `Accounting posting for source document type "${request.sourceDocumentType}" is not implemented in this slice.`,
        requestedAt,
      );
    }

    // 3. The account mapping. Missing configuration is a fail-closed refusal
    //    with an explicit code — never a guessed account (C62-OD-04).
    const mapping = await this.mappings.findForSource({
      organizationId: request.organizationId,
      sourceModule: INVENTORY_POSTING_SOURCE_MODULE,
      sourceDocumentType: request.sourceDocumentType,
    });
    if (mapping === null) {
      return this.refusal(
        request,
        'accounting.mapping_missing',
        `No Accounting posting mapping is configured for "${request.sourceDocumentType}" in this organization. Configure the mapping before posting inventory documents to Accounting.`,
        requestedAt,
      );
    }
    if (mapping.organizationId !== request.organizationId) {
      return this.refusal(
        request,
        'accounting.organization_scope_rejected',
        'The resolved Accounting posting mapping belongs to another organization.',
        requestedAt,
      );
    }

    // 4. The mapping must name a usable area and two usable, postable
    //    accounts. A disabled account or a foreign area is a configuration
    //    defect, not a silent fallback.
    if (!(await this.isMappingUsable(request.organizationId, mapping))) {
      return this.refusal(
        request,
        'accounting.mapping_unusable',
        'The configured Accounting posting mapping names a financial area or an account that is missing, disabled or outside this organization.',
        requestedAt,
      );
    }

    // 5. Something must actually be postable. A zero-value receipt is
    //    operational but carries no accounting effect, and a 0 = 0 voucher
    //    would be a number in the books that means nothing.
    if (isZeroAmount(request.valuation.totalValue)) {
      return this.refusal(
        request,
        'accounting.no_postable_value',
        'The inventory document carries no authoritative value to post to Accounting.',
        requestedAt,
      );
    }

    // 6. The journal. ONE balanced voucher from the authoritative total: the
    //    value debited to the mapped inventory account and credited to the
    //    mapped offsetting account. No line is derived per movement — the
    //    journal structure is Accounting's decision (PO-04).
    const total = request.valuation.totalValue;
    const source = {
      module: INVENTORY_POSTING_SOURCE_MODULE,
      entityType: 'inventory_business_document',
      entityId: request.sourceDocumentId,
      operation: INVENTORY_POSTING_SOURCE_OPERATION,
    };

    let document: AccountingDocumentDto;
    try {
      document = await this.documents.createDocument(
        {
          organizationId: request.organizationId,
          financialAreaId: mapping.financialAreaId,
          documentDate: request.sourceDocumentDate,
          description: this.voucherDescription(request),
          branchId: request.branchId,
          lines: [
            {
              accountId: mapping.debitAccountId,
              debitAmount: total,
              creditAmount: '0.00',
              description: `Inventory receipt value (${request.sourceDocumentType})`,
              sourceLineReference: request.sourceDocumentId,
            },
            {
              accountId: mapping.creditAccountId,
              debitAmount: '0.00',
              creditAmount: total,
              description: `Inventory receipt offset (${request.sourceDocumentType})`,
              sourceLineReference: request.sourceDocumentId,
            },
          ],
          operationKey: request.operationKey,
          origin: 'system',
          source,
          // Accounting owns draft classification: the Warehouse's configured
          // mode arrives through this contract, and only Accounting decides
          // what it means for the voucher's phase.
          draftPhase: request.postingMode === 'draft',
        },
        authority,
      );

      // 7. Direct Final mode drives the voucher through Accounting's OWN
      //    lifecycle to `final`, the one act that makes it part of the books
      //    (`final` = posted, AC-D-20). Draft mode deliberately stops at the
      //    draft: a draft is never Accounting Posted (C62-OD-02).
      if (request.postingMode === 'direct_final') {
        if (document.state === 'draft') {
          document = await this.documents.issueDocument(
            request.organizationId,
            document.id,
            { operationKey: `${request.operationKey}:issue` },
            authority,
          );
        }
        document = await this.documents.finalizeDocument(
          request.organizationId,
          document.id,
          { operationKey: `${request.operationKey}:finalize` },
          authority,
        );
      }
    } catch (error) {
      if (error instanceof AppException) {
        // A 409 on the operation key is the idempotency contract's own answer
        // (the key was already used for a different intent) and must reach the
        // caller unchanged. Every other business refusal — a closed period, an
        // unusable account, an illegal composition — is a durable, retryable
        // `failed` outcome.
        if (error.code === 'Conflict') throw error;
        if (
          error.code === 'Unauthorized' ||
          error.code === 'PermissionDenied'
        ) {
          throw error;
        }
        return this.failure(
          request,
          'accounting.operation_failed',
          'Accounting could not complete the posting operation.',
          requestedAt,
        );
      }
      throw error;
    }

    const outcome: InventoryPostingResult['outcome'] =
      document.state === 'final'
        ? 'final_posted'
        : document.state === 'draft'
          ? 'draft_created'
          : 'failed';

    this.logger.log(
      'Inventory posting operation completed',
      {
        organizationId: request.organizationId,
        sourceDocumentId: request.sourceDocumentId,
        sourceDocumentType: request.sourceDocumentType,
        accountingDocumentId: document.id,
        accountingDocumentNumber: document.documentNumber,
        accountingDocumentState: document.state,
        postingMode: request.postingMode,
        outcome,
        initiatedByUserId: request.actor.userId,
        serviceAuthority: ACCOUNTING_SOURCE_POSTING_AUTHORITY_CODE,
      },
      InventoryPostingService.name,
    );

    return {
      operationKey: request.operationKey,
      requestHash: request.requestHash,
      postingMode: request.postingMode,
      outcome,
      accountingDocument: {
        id: document.id,
        number: document.documentNumber,
        phase: document.state,
        state: document.state,
        final: document.state === 'final',
      },
      glPosted: document.state === 'final',
      replayed: false,
      refusalCode: null,
      refusalReason: null,
      requestedAt,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Re-read the Accounting state of an operation that already produced a
   * document (C62-OD-02: Inventory must eventually reflect draft registration
   * or cancellation THROUGH this contract, never by reading Accounting's
   * tables).
   *
   * `null` means Accounting holds no document for that operation key — the
   * caller keeps its own durable state and asks again later.
   */
  async getInventoryPostingOutcome(input: {
    organizationId: string;
    operationKey: string;
  }): Promise<InventoryPostingResult | null> {
    const document = await this.documents.getDocumentForOperation(
      input.organizationId,
      input.operationKey,
    );
    if (document === null) return null;
    return {
      operationKey: input.operationKey,
      requestHash: '',
      postingMode: document.state === 'draft' ? 'draft' : 'direct_final',
      outcome:
        document.state === 'final'
          ? 'final_posted'
          : document.state === 'draft'
            ? 'draft_created'
            : 'failed',
      accountingDocument: {
        id: document.id,
        number: document.documentNumber,
        phase: document.state,
        state: document.state,
        final: document.state === 'final',
      },
      glPosted: document.state === 'final',
      replayed: true,
      refusalCode: null,
      refusalReason: null,
      requestedAt: document.createdAt,
      completedAt: document.updatedAt,
    };
  }

  /**
   * Cancel the Accounting draft an Inventory posting operation created
   * (C62-OD-02).
   *
   * The draft is discarded through Accounting's OWN guarded lifecycle
   * (`deleteDocument` re-validates the phase and refuses anything that is not
   * still a draft), under the same explicit service authority as the posting
   * itself. Inventory never touches an Accounting row and never marks an
   * Accounting document cancelled by itself.
   *
   * A same-key retry is a replay: if Accounting holds no document for the key
   * any more, the draft is already gone and the answer is `cancelled: true`.
   */
  async cancelInventoryDraft(input: {
    organizationId: string;
    operationKey: string;
    actor: InventoryPostingActor;
  }): Promise<InventoryPostingDraftCancellation> {
    const authority: ServiceAuthority = {
      code: ACCOUNTING_SOURCE_POSTING_AUTHORITY_CODE,
      initiatedByUserId: input.actor.userId,
      initiatingPermission: input.actor.permission,
      organizationId: input.actor.organizationId,
    };
    await this.organizations.assertOrganizationInScope(input.organizationId);
    await this.authorization.requireServiceAuthority(
      authority,
      EXPECTED_ACCOUNTING_SOURCE_POSTING_AUTHORITY,
      input.organizationId,
    );

    const document = await this.documents.getDocumentForOperation(
      input.organizationId,
      input.operationKey,
    );
    if (document === null) {
      // The draft was already discarded (or the operation never created one):
      // the caller's standing is what makes that a legal state.
      return {
        operationKey: input.operationKey,
        cancelled: true,
        refusalCode: null,
        refusalReason: null,
      };
    }
    if (document.state !== 'draft') {
      return {
        operationKey: input.operationKey,
        cancelled: false,
        refusalCode: 'accounting.draft_not_cancellable',
        refusalReason: `The Accounting document ${document.id} is no longer a draft and cannot be cancelled here.`,
      };
    }
    try {
      await this.documents.deleteDocument(
        input.organizationId,
        document.id,
        authority,
      );
    } catch (error) {
      if (error instanceof AppException) throw error;
      throw error;
    }
    this.logger.log(
      'Inventory posting draft cancelled',
      {
        organizationId: input.organizationId,
        accountingDocumentId: document.id,
        operationKey: input.operationKey,
        initiatedByUserId: input.actor.userId,
      },
      InventoryPostingService.name,
    );
    return {
      operationKey: input.operationKey,
      cancelled: true,
      refusalCode: null,
      refusalReason: null,
    };
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Whether the mapping's area and both accounts resolve to usable,
   * in-organization master data. The public services already refuse a foreign
   * or unusable row with their own precise errors; collapsing them into one
   * boolean here keeps the Inventory-facing contract stable instead of leaking
   * Accounting's 404/422 shapes across the module boundary.
   */
  private async isMappingUsable(
    organizationId: string,
    mapping: SourcePostingMapping,
  ): Promise<boolean> {
    try {
      await this.areas.requireUsableFinancialAreaInOrganization(
        mapping.financialAreaId,
        organizationId,
      );
      await this.accounts.requireUsableAccountInOrganization(
        mapping.debitAccountId,
        organizationId,
      );
      await this.accounts.requireUsableAccountInOrganization(
        mapping.creditAccountId,
        organizationId,
      );
      return true;
    } catch {
      return false;
    }
  }

  private voucherDescription(request: InventoryPostingRequest): string {
    const label = request.sourceDocumentNumber ?? request.sourceDocumentId;
    return `Inventory receipt ${label} dated ${request.sourceDocumentDate}`.slice(
      0,
      MAX_VOUCHER_DESCRIPTION_LENGTH,
    );
  }

  private refusal(
    request: InventoryPostingRequest,
    code: InventoryPostingRefusalCode,
    reason: string,
    requestedAt: string,
  ): InventoryPostingResult {
    this.logger.warn(
      'Inventory posting operation refused',
      {
        organizationId: request.organizationId,
        sourceDocumentId: request.sourceDocumentId,
        sourceDocumentType: request.sourceDocumentType,
        refusalCode: code,
        initiatedByUserId: request.actor.userId,
      },
      InventoryPostingService.name,
    );
    return this.outcomeResult(request, 'refused', null, false, {
      refusalCode: code,
      refusalReason: reason,
      requestedAt,
    });
  }

  private failure(
    request: InventoryPostingRequest,
    code: InventoryPostingRefusalCode,
    reason: string,
    requestedAt: string,
  ): InventoryPostingResult {
    this.logger.warn(
      'Inventory posting operation failed',
      {
        organizationId: request.organizationId,
        sourceDocumentId: request.sourceDocumentId,
        sourceDocumentType: request.sourceDocumentType,
        refusalCode: code,
        initiatedByUserId: request.actor.userId,
      },
      InventoryPostingService.name,
    );
    return this.outcomeResult(request, 'failed', null, false, {
      refusalCode: code,
      refusalReason: reason,
      requestedAt,
    });
  }

  private outcomeResult(
    request: InventoryPostingRequest,
    outcome: InventoryPostingResult['outcome'],
    accountingDocument: InventoryPostingResult['accountingDocument'],
    glPosted: boolean,
    extra: {
      refusalCode: InventoryPostingRefusalCode | null;
      refusalReason: string | null;
      requestedAt: string;
    },
  ): InventoryPostingResult {
    return {
      operationKey: request.operationKey,
      requestHash: request.requestHash,
      postingMode: request.postingMode,
      outcome,
      accountingDocument,
      glPosted,
      replayed: false,
      refusalCode: extra.refusalCode,
      refusalReason: extra.refusalReason,
      requestedAt: extra.requestedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
