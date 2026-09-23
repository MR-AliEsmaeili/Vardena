import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  getCorrelationId,
  getPrincipal,
} from '../../../kernel/correlation/request-context.js';
import { generateId } from '../../../kernel/ids/ulid.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import {
  toOffset,
  toPaginatedResult,
  type PaginatedResult,
} from '../../../kernel/pagination/paginated-result.js';
import {
  isUniqueViolation,
  uniqueViolationTouches,
} from '../../../kernel/prisma/prisma-errors.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { BranchesService } from '../../organization/application/branches.service.js';
import { NumberingService } from '../../documents/application/numbering.service.js';
import { DocumentTypesService } from '../../documents/application/document-types.service.js';
import { AccountingDocumentsRepository } from '../data/accounting-documents.repository.js';
import type { AccountingDocumentLineWrite } from '../data/accounting-documents.repository.js';
import { AccountingPostingOperationsRepository } from '../data/accounting-posting-operations.repository.js';
import {
  AccountingDocumentAccountRejectedError,
  AccountingDocumentAreaImmutableError,
  AccountingDocumentDateUnresolvableError,
  AccountingDocumentFinalProtectedError,
  AccountingDocumentLineRejectedError,
  AccountingDocumentMissingError,
  AccountingDocumentOriginRejectedError,
  AccountingDocumentPhaseConflictError,
  AccountingDocumentScopeRejectedError,
  AccountingDocumentStaleError,
  AccountingDocumentAlreadyReversedError,
} from '../data/accounting-document-errors.js';
import {
  ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
  planVoucherAreaChange,
  planVoucherCreate,
  planVoucherDelete,
  planVoucherEdit,
  planVoucherIssue,
  toAccountingDocumentDto,
  voucherScopeKey,
  type AccountingDocument,
  type AccountingDocumentDto,
} from '../domain/accounting-document.js';
import { formatDateOnly } from '../domain/date-range.js';
import {
  lifecycleProblemMessage,
  type DocumentLifecycleProblem,
} from '../../documents/domain/document-lifecycle.js';
import { isZeroAmount } from '../domain/money.js';
import { checkLineNumbers } from '../domain/voucher-lines.js';
import type { AccountingDocumentLineInput } from '../domain/voucher-lines.js';
import { AccountsService } from './accounts.service.js';
import { FinancialAreasService } from './financial-areas.service.js';
import {
  assertDescription,
  assertVoucherComposition,
  buildRequestHash,
  documentOperationRow,
  normalizeLines,
  normalizeOriginSource,
  parseDocumentDate,
  parseOptionalDocumentDate,
  publishDocumentEvent,
  requireOperationKey,
  type SubmittedAccountingDocumentLine,
} from './accounting-document-support.js';
import { resolveSort } from './accounting-support.js';
import { PostingService } from './posting.service.js';
import { ACCOUNTING_DOCUMENT_PERMISSIONS } from '../domain/accounting-permissions.js';
import {
  ACCOUNTING_DOCUMENT_CREATED_EVENT,
  ACCOUNTING_DOCUMENT_DELETED_EVENT,
  ACCOUNTING_DOCUMENT_FINALIZED_EVENT,
  ACCOUNTING_DOCUMENT_REVERSED_EVENT,
  ACCOUNTING_DOCUMENT_UPDATED_EVENT,
} from '../domain/accounting.events.js';
import { publishEvent } from './accounting-support.js';

const SORTABLE_FIELDS: Record<string, string> = {
  documentDate: 'documentDate',
  documentNumber: 'documentNumber',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
};

/**
 * Accounting documents (vouchers) — the Accounting-owned aggregate's
 * application service (Task 10.4, contract §12…§18, ADR-0026).
 *
 * Scope of the surface, deliberately (§15.4, §22, AC-D-26): compose, read,
 * list, edit, issue, discard and finalize. There is NO reopen, NO reversal /
 * correction / replacement, NO approval and NO posting-rule or balance
 * behavior — those are later tasks, and inventing their endpoints here would
 * make the contract's "not in this task" list a lie.
 *
 * Where each guarantee lives:
 * - the DOMAIN decides (`domain/accounting-document.ts`,
 *   `domain/voucher-lines.ts`): phases, editability, deletability, origin
 *   evidence, the exact `Σ debit = Σ credit` rule, dense line numbering;
 * - the REPOSITORY guards inside ONE transaction with the module's fixed lock
 *   order and re-evaluates the same decision table under the locks;
 * - THIS service authorizes (permission + organization scope), normalizes the
 *   input, applies the idempotency ledger rule, sequences the Foundation's
 *   number allocation, and maps guard failures onto the API error model.
 *
 * Idempotency (§16.4, AC-I-12) is why create/finalize REQUIRE an operationKey:
 * the ledger row is written in the same transaction as the effect, so a retry
 * with the same key and the same canonical intent replays the stored document
 * and a reuse with a different intent is refused with 409 — never applied. The
 * number allocation is idempotent on the same key (§18: the operationKey IS
 * the allocation key), so a retried issuance replays the serial it already
 * allocated instead of burning another one.
 *
 * Since Task 10.8 FINALIZATION is delegated: `finalizeDocument` is the
 * HTTP-facing shell of the posting seam (`PostingService`), which owns the
 * posting sequence and the `document_finalize` half of the idempotency rule.
 * This service keeps the composition half (`document_create`), because
 * composition is its own operation with its own number allocation — one
 * service per operation's replay rule is the module's existing posture (and
 * Inventory's: each of its posting services owns its own `replayOrReject`).
 */
@Injectable()
export class AccountingDocumentsService {
  constructor(
    private readonly repository: AccountingDocumentsRepository,
    private readonly operations: AccountingPostingOperationsRepository,
    private readonly posting: PostingService,
    private readonly accounts: AccountsService,
    private readonly areas: FinancialAreasService,
    private readonly branches: BranchesService,
    private readonly organizations: OrganizationsService,
    private readonly documentTypes: DocumentTypesService,
    private readonly numbering: NumberingService,
    private readonly authorization: AuthorizationService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  // ---- reads ---------------------------------------------------------------

  async listDocuments(
    query: ListAccountingDocumentsQuery,
  ): Promise<PaginatedResult<AccountingDocumentDto>> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_DOCUMENT_PERMISSIONS.VIEW,
    ]);
    this.organizations.assertOrganizationInScope(query.organizationId);
    const { skip, take } = toOffset(query.page, query.pageSize);
    const { items, total } = await this.repository.list({
      where: {
        organizationId: query.organizationId,
        financialAreaId: query.financialAreaId,
        fiscalYearId: query.fiscalYearId,
        accountingPeriodId: query.accountingPeriodId,
        state: query.state,
        origin: query.origin,
        branchId: query.branchId,
        documentNumber: query.documentNumber,
        dateFrom: parseOptionalDocumentDate(query.dateFrom, 'dateFrom'),
        dateTo: parseOptionalDocumentDate(query.dateTo, 'dateTo'),
        search: query.search,
      },
      orderBy: resolveSort(query.sort ?? '', SORTABLE_FIELDS, [
        { documentDate: 'desc' },
        { createdAt: 'desc' },
      ]),
      skip,
      take,
    });
    return toPaginatedResult(
      items.map(toAccountingDocumentDto),
      total,
      query.page,
      query.pageSize,
    );
  }

  async getDocument(
    organizationId: string,
    id: string,
  ): Promise<AccountingDocumentDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_DOCUMENT_PERMISSIONS.VIEW,
    ]);
    const document = await this.mustFindInOrganization(organizationId, id);
    return toAccountingDocumentDto(document);
  }

  // ---- composition ---------------------------------------------------------

  /**
   * Compose a voucher. The starting phase is CONFIGURATION
   * (`document_type_configs.draft_required`, §15.1): with draft required the
   * document starts without a serial; otherwise it is issued at creation and
   * the Document Foundation allocates the number then (§18).
   *
   * The HTTP surface composes `manual` documents only; the `origin`/`source`
   * input exists for the §16.3 posting contract's entry point — no production
   * system posting is enabled before OQ-39 (§16.6, AC-D-26), so nothing in this
   * task calls it and no controller exposes it.
   */
  async createDocument(
    input: CreateAccountingDocumentInput,
  ): Promise<AccountingDocumentDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_DOCUMENT_PERMISSIONS.CREATE,
    ]);
    this.organizations.assertOrganizationInScope(input.organizationId);

    const documentDate = parseDocumentDate(input.documentDate);
    const description = assertDescription(input.description);
    const lines = normalizeLines(input.lines);
    assertVoucherComposition(lines);
    await this.areas.requireUsableFinancialAreaInOrganization(
      input.financialAreaId,
      input.organizationId,
    );
    const branchId = await this.resolveBranch(
      input.organizationId,
      input.branchId ?? null,
    );
    await this.requireUsableAccounts(input.organizationId, lines);
    const { origin, source } = normalizeOriginSource({
      origin: input.origin ?? 'manual',
      source: input.source ?? null,
    });

    const operationKey = requireOperationKey(input.operationKey);
    const requestHash = buildRequestHash('document_create', {
      organizationId: input.organizationId,
      financialAreaId: input.financialAreaId,
      documentDate: formatDateOnly(documentDate),
      description,
      branchId,
      origin,
      sourceModule: source?.module ?? null,
      sourceEntityType: source?.entityType ?? null,
      sourceEntityId: source?.entityId ?? null,
      sourceOperation: source?.operation ?? null,
      lines: lines.map((line) => ({
        accountId: line.accountId,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        description: line.description,
        sourceLineReference: line.sourceLineReference,
      })),
    });

    const replay = await this.replayOrReject(
      input.organizationId,
      operationKey,
      requestHash,
      'document_create',
    );
    if (replay !== null) return replay;

    const settings = await this.documentTypes.requireTypeSettings(
      input.organizationId,
      ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
    );
    const plan = planVoucherCreate({ draftRequired: settings.draftRequired });
    if (plan.problem !== null) {
      throw AppException.businessRule(lifecycleProblemMessage(plan.problem));
    }

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const documentId = generateId();
    const documentNumber =
      plan.phase === 'draft'
        ? null
        : await this.allocateNumber({
            organizationId: input.organizationId,
            financialAreaId: input.financialAreaId,
            documentId,
            operationKey,
            actorId,
          });

    try {
      const created = await this.repository.createChecked({
        id: documentId,
        organizationId: input.organizationId,
        financialAreaId: input.financialAreaId,
        documentDate,
        description,
        state: plan.phase,
        origin,
        branchId,
        source,
        documentNumber,
        correlationId: getCorrelationId() ?? null,
        // Header-level idempotency evidence is SYSTEM-origin only (§12.2); a
        // manual document is evidenced by the ledger row and its actor.
        idempotencyReference: origin === 'system' ? operationKey : null,
        requestHash: origin === 'system' ? requestHash : null,
        lines: withLineIds(lines),
        ledger: documentOperationRow({
          organizationId: input.organizationId,
          operationKey,
          operation: 'document_create',
          requestHash,
          documentId,
          actorId,
          now,
        }),
        createdAt: now,
        createdBy: actorId,
      });
      await publishDocumentEvent(
        this.events,
        ACCOUNTING_DOCUMENT_CREATED_EVENT,
        created,
      );
      this.logger.log(
        'Accounting document created',
        {
          documentId: created.id,
          organizationId: created.organizationId,
          financialAreaId: created.financialAreaId,
          state: created.phase,
          origin: created.origin,
        },
        AccountingDocumentsService.name,
      );
      return toAccountingDocumentDto(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Lost a race on the ledger key: the winner's row decides. If the
        // violation was the (organization, area, number) backstop instead,
        // there is no row for this key and the number is genuinely taken.
        const raced = await this.replayOrReject(
          input.organizationId,
          operationKey,
          requestHash,
          'document_create',
        );
        if (raced !== null) return raced;
        throw AppException.conflict(
          'The allocated document number already exists in this financial area.',
        );
      }
      throw mapDocumentGuardError(error) ?? error;
    }
  }

  // ---- edits ---------------------------------------------------------------

  /**
   * Edit an editable voucher (draft OR temporary, §15.2). The WHOLE line set
   * is replaced when supplied; the number, the origin and the phase are not
   * part of an edit, and the financial area may move only while the document is
   * still a draft (AC-D-03: an issued document's number belongs to its area's
   * series).
   *
   * No operationKey: an edit is a state-carrying PUT, not an effect-creating
   * posting. Repeating it converges on the same state, and it can never
   * duplicate anything the ledger protects (a document or a serial).
   */
  async updateDocument(
    organizationId: string,
    id: string,
    input: UpdateAccountingDocumentInput,
  ): Promise<AccountingDocumentDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_DOCUMENT_PERMISSIONS.EDIT,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    const plan = planVoucherEdit(current.phase);
    if (plan.problem !== null) {
      throw this.lifecycleException(plan.problem);
    }

    const financialAreaId = input.financialAreaId ?? current.financialAreaId;
    const areaChange = planVoucherAreaChange({
      phase: current.phase,
      areaChanged: financialAreaId !== current.financialAreaId,
    });
    if (areaChange.problem === 'area_immutable_after_issuance') {
      throw AppException.businessRule(
        new AccountingDocumentAreaImmutableError().message,
      );
    }
    await this.areas.requireUsableFinancialAreaInOrganization(
      financialAreaId,
      organizationId,
    );

    const documentDate =
      input.documentDate === undefined
        ? current.documentDate
        : parseDocumentDate(input.documentDate);
    const description =
      input.description === undefined
        ? current.description
        : assertDescription(input.description);
    const branchId = await this.resolveBranch(
      organizationId,
      input.branchId === undefined ? current.branchId : input.branchId,
    );
    const lines =
      input.lines === undefined
        ? currentLines(current)
        : normalizeLines(input.lines);
    assertVoucherComposition(lines);
    await this.requireUsableAccounts(organizationId, lines);

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    try {
      const updated = await this.repository.updateChecked({
        id,
        organizationId,
        financialAreaId,
        documentDate,
        description,
        branchId,
        lines: withLineIds(lines),
        updatedAt: now,
        updatedBy: actorId,
      });
      await publishDocumentEvent(
        this.events,
        ACCOUNTING_DOCUMENT_UPDATED_EVENT,
        updated,
      );
      return toAccountingDocumentDto(updated);
    } catch (error) {
      throw mapDocumentGuardError(error) ?? error;
    }
  }

  // ---- lifecycle -----------------------------------------------------------

  /**
   * Issue a draft (draft → temporary, §15.1/§18): allocate the serial from the
   * Document Foundation and write it. Issuing an already-issued voucher is a
   * REPLAY, not an error — the caller asked for the post-state that already
   * holds, and no second serial is burned for it.
   *
   * Authority: `Accounting.Document.Edit` — issuance is an edit-phase action
   * (the §22 vocabulary has no separate `Submit` code, and Task 8's own
   * document lifecycle treats `submit` as a state move of the same authority).
   */
  async issueDocument(
    organizationId: string,
    id: string,
    input: TransitionDocumentInput,
  ): Promise<AccountingDocumentDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_DOCUMENT_PERMISSIONS.EDIT,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    const plan = planVoucherIssue(current.phase);
    if (plan.kind === 'replay') return toAccountingDocumentDto(current);
    if (plan.kind === 'refused') {
      throw this.lifecycleException(plan.problem);
    }

    const operationKey = requireOperationKey(input.operationKey);
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const documentNumber = await this.allocateNumber({
      organizationId,
      financialAreaId: current.financialAreaId,
      documentId: current.id,
      operationKey,
      actorId,
    });
    try {
      const issued = await this.repository.issueChecked({
        id,
        organizationId,
        documentNumber,
        updatedAt: now,
        updatedBy: actorId,
      });
      await publishDocumentEvent(
        this.events,
        ACCOUNTING_DOCUMENT_UPDATED_EVENT,
        issued,
      );
      return toAccountingDocumentDto(issued);
    } catch (error) {
      if (error instanceof AccountingDocumentPhaseConflictError) {
        // A concurrent issuance/finalization won: the phase moved while this
        // request held a serial. Re-read and replay when the voucher is now in
        // the post-state this operation asks for; otherwise report the phase.
        const raced = await this.mustFindInOrganization(organizationId, id);
        if (raced.phase === 'temporary') return toAccountingDocumentDto(raced);
        throw mapDocumentGuardError(error) ?? error;
      }
      throw mapDocumentGuardError(error) ?? error;
    }
  }

  /**
   * Finalize (temporary → final, §15.5): the ONE act that makes a voucher part
   * of the books. Since Task 10.8 this operation is the HTTP-facing shell of
   * the posting seam, not a second implementation of it: it authorizes, maps
   * the outcome onto the API's document shape, and maps the repository's guard
   * errors onto the API error model. The posting sequence itself — idempotency
   * replay-or-reject, the lifecycle verdict, the ONE atomic transaction that
   * writes the state, the N immutable ledger entries and the operation row,
   * the `Finalized` event and the readiness/ledger verification of the result —
   * lives in `PostingService` (`application/posting.service.ts`), so no caller
   * ever re-assembles it (AR-04).
   *
   * `Accounting.Document.Finalize` is NOT approval: §17.2's approval is a
   * Workflow decision that may precede this call, and OQ-42 decides whether it
   * must. This task implements the state machine, not the approval policy.
   */
  async finalizeDocument(
    organizationId: string,
    id: string,
    input: TransitionDocumentInput,
  ): Promise<AccountingDocumentDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_DOCUMENT_PERMISSIONS.FINALIZE,
    ]);
    try {
      const outcome = await this.posting.postVoucher({
        organizationId,
        voucherId: id,
        operationKey: input.operationKey,
      });
      return toAccountingDocumentDto(outcome.document);
    } catch (error) {
      // The seam propagates the data layer's guard errors untouched (the
      // posting act is deliberately not HTTP-shaped — §16.5, OQ-39), so the
      // module's ONE mapping decision table stays here, at the API boundary.
      throw mapDocumentGuardError(error) ?? error;
    }
  }

  /**
   * Discard a PRE-final voucher (§15.3, AC-D-21). `final` is refused (§15.2,
   * AC-I-06) — the books keep what made it into them. A numbered temporary
   * voucher keeps its numbering allocation row: the gap is auditable
   * (`reuse_policy = never`), which is exactly the point.
   */
  async deleteDocument(
    organizationId: string,
    id: string,
  ): Promise<AccountingDocumentDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_DOCUMENT_PERMISSIONS.DELETE,
    ]);
    const current = await this.mustFindInOrganization(organizationId, id);
    const plan = planVoucherDelete(current.phase);
    if (plan.problem !== null) {
      throw this.lifecycleException(plan.problem);
    }
    try {
      const discarded = await this.repository.deleteChecked({
        id,
        organizationId,
      });
      await publishDocumentEvent(
        this.events,
        ACCOUNTING_DOCUMENT_DELETED_EVENT,
        discarded,
      );
      return toAccountingDocumentDto(discarded);
    } catch (error) {
      throw mapDocumentGuardError(error) ?? error;
    }
  }

  /**
   * Reverse a Final voucher (Task 15): allocate a new serial, create a new
   * Final counter-document with debit/credit inverted, leave the original
   * immutable except `reversed_by`. Idempotent on `document_reverse`.
   * There is no invented reversal-window policy: the reversal date must
   * resolve to an OPEN period (fail closed, same as composition).
   */
  async reverseDocument(
    organizationId: string,
    id: string,
    input: ReverseDocumentInput,
  ): Promise<AccountingDocumentDto> {
    await this.authorization.requireAllPermissions([
      ACCOUNTING_DOCUMENT_PERMISSIONS.REVERSE,
    ]);
    const original = await this.mustFindInOrganization(organizationId, id);
    if (original.phase !== 'final') {
      throw AppException.businessRule(
        'Only a finalized accounting document can be reversed.',
        { problem: 'not_final', state: original.phase },
      );
    }
    if (original.reversedByDocumentId) {
      throw AppException.businessRule(
        'The accounting document has already been reversed.',
        { problem: 'already_reversed' },
      );
    }
    const reason = assertDescription(input.reason);
    const documentDate =
      input.documentDate === undefined
        ? original.documentDate
        : parseDocumentDate(input.documentDate);
    const operationKey = requireOperationKey(input.operationKey);
    const requestHash = buildRequestHash('document_reverse', {
      originalDocumentId: original.id,
      documentDate: formatDateOnly(documentDate),
      reason,
    });
    const replay = await this.replayOrReject(
      organizationId,
      operationKey,
      requestHash,
      'document_reverse',
    );
    if (replay !== null) return replay;

    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    const reversalId = generateId();
    const documentNumber = await this.allocateNumber({
      organizationId,
      financialAreaId: original.financialAreaId,
      documentId: reversalId,
      operationKey,
      actorId,
    });
    const description =
      `Reversal of ${original.documentNumber ?? original.id}: ${reason}`.slice(
        0,
        500,
      );
    try {
      const reversal = await this.repository.reverseChecked({
        originalDocumentId: original.id,
        organizationId,
        reversalId,
        documentNumber,
        documentDate,
        description,
        reason,
        ledger: documentOperationRow({
          organizationId,
          operationKey,
          operation: 'document_reverse',
          requestHash,
          documentId: reversalId,
          actorId,
          now,
        }),
        finalizedAt: now,
        finalizedBy: actorId,
        correlationId: getCorrelationId() ?? null,
        createdBy: actorId,
      });
      await publishDocumentEvent(
        this.events,
        ACCOUNTING_DOCUMENT_CREATED_EVENT,
        reversal,
      );
      await publishDocumentEvent(
        this.events,
        ACCOUNTING_DOCUMENT_FINALIZED_EVENT,
        reversal,
      );
      await publishEvent(this.events, {
        type: ACCOUNTING_DOCUMENT_REVERSED_EVENT,
        aggregateType: 'AccountingDocument',
        aggregateId: reversal.id,
        payload: {
          id: reversal.id,
          organizationId: reversal.organizationId,
          financialAreaId: reversal.financialAreaId,
          fiscalYearId: reversal.fiscalYearId,
          accountingPeriodId: reversal.accountingPeriodId,
          documentType: reversal.documentType,
          documentNumber: reversal.documentNumber,
          state: reversal.phase,
          origin: reversal.origin,
          originalDocumentId: original.id,
          reason,
        },
      });
      this.logger.log(
        'Accounting document reversed',
        {
          originalDocumentId: original.id,
          reversalDocumentId: reversal.id,
          organizationId,
        },
        AccountingDocumentsService.name,
      );
      return toAccountingDocumentDto(reversal);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.replayOrReject(
          organizationId,
          operationKey,
          requestHash,
          'document_reverse',
        );
        if (raced !== null) return raced;
        throw AppException.businessRule(
          'The accounting document has already been reversed.',
          { problem: 'already_reversed' },
        );
      }
      throw mapDocumentGuardError(error) ?? error;
    }
  }

  // ---- internals -----------------------------------------------------------

  /**
   * Scoped by-id resolution (ADR-0021 §4, AC-I-01/AC-I-16): a document in
   * another organization is reported as NOT FOUND, so the boundary cannot be
   * crossed by guessing an id. The deployment pin (ADR-0025) is enforced here
   * too, so a direct service caller is bounded exactly like an HTTP caller.
   */
  private async mustFindInOrganization(
    organizationId: string,
    id: string,
  ): Promise<AccountingDocument> {
    this.organizations.assertOrganizationInScope(organizationId);
    const document = await this.repository.findById(id);
    if (document === null || document.organizationId !== organizationId) {
      throw AppException.notFound('AccountingDocument', id);
    }
    return document;
  }

  /**
   * Optional branch: validated in-organization when present (§12.4/AC-D-17),
   * `null` when absent. A foreign or missing branch is 404, like every other
   * reference in the module.
   */
  private async resolveBranch(
    organizationId: string,
    branchId: string | null,
  ): Promise<string | null> {
    if (branchId === null) return null;
    const branch = await this.branches.requireUsableBranchInOrganization(
      branchId,
      organizationId,
    );
    return branch.id;
  }

  /**
   * Fast-feedback account resolution (§14, AC-I-09): existence + organization
   * scope through Task 10.3's public service (404 for a foreign/missing
   * account), then the posting-eligibility rules. The repository re-evaluates
   * all of them under `FOR SHARE` locks — this call exists so the common
   * mistake is answered before a transaction is opened, not to be the guard.
   */
  private async requireUsableAccounts(
    organizationId: string,
    lines: readonly AccountingDocumentLineInput[],
  ): Promise<void> {
    for (const accountId of [
      ...new Set(lines.map((line) => line.accountId)),
    ].sort()) {
      const account = await this.accounts.requireUsableAccountInOrganization(
        accountId,
        organizationId,
      );
      if (!account.isPostable) {
        throw AppException.businessRule(
          `Account "${account.id}" is not postable: only leaf, posting-enabled accounts can receive document lines (AC-I-09).`,
          { accountId: account.id, problem: 'account_not_postable' },
        );
      }
    }
  }

  /**
   * Allocate the serial through the Document Foundation (ADR-0023 §4, §18).
   * The operationKey IS the allocation key, so one business action allocates at
   * most one number however many times it is retried; the series' scope token
   * is the financial area (`voucherScopeKey`). No permission of its own — the
   * owning operation already authorized (§18: numbering configuration is
   * governed by the Documents module's codes, allocation is internal).
   */
  private async allocateNumber(input: {
    organizationId: string;
    financialAreaId: string;
    documentId: string;
    operationKey: string;
    actorId: string | null;
  }): Promise<string> {
    const allocation = await this.numbering.allocateNumber({
      organizationId: input.organizationId,
      documentType: ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
      scopeKey: voucherScopeKey(input.financialAreaId),
      allocationKey: input.operationKey,
      referenceModule: 'accounting',
      referenceDocumentType: ACCOUNTING_VOUCHER_DOCUMENT_TYPE,
      referenceDocumentId: input.documentId,
    });
    return allocation.number;
  }

  /**
   * The §16.4 replay-or-reject decision: same key + same canonical intent
   * replays the CURRENT rows of the stored document; the same key with a
   * different intent (or a different operation) is a 409 and nothing is
   * applied.
   */
  private async replayOrReject(
    organizationId: string,
    operationKey: string,
    requestHash: string,
    operation: 'document_create' | 'document_finalize' | 'document_reverse',
  ): Promise<AccountingDocumentDto | null> {
    const existing = await this.operations.findByKey(
      organizationId,
      operationKey,
    );
    if (existing === null) return null;
    if (
      existing.operation !== operation ||
      existing.requestHash !== requestHash
    ) {
      throw AppException.conflict(
        `The operationKey was already used for "${existing.operation}". An idempotency key identifies one intent: use a new key for a new operation.`,
      );
    }
    const document = await this.repository.findById(existing.result.documentId);
    if (document === null) {
      // Impossible: ledger rows are append-only and a pre-final deletion keeps
      // them; a missing document would mean the evidence points nowhere.
      throw new Error(
        `Replay of accounting operation "${existing.id}" points at a missing accounting document.`,
      );
    }
    return toAccountingDocumentDto(document);
  }

  /**
   * The Foundation's lifecycle-problem vocabulary as the API's error model.
   * Every problem here is a rule the document's own state refuses (an
   * uneditable phase, an undefined transition, a missing draft), so 422 is the
   * uniform answer; a state that moved under the request is handled separately
   * as a 409 (`mapDocumentGuardError`).
   */
  private lifecycleException(problem: DocumentLifecycleProblem): AppException {
    return AppException.businessRule(lifecycleProblemMessage(problem), {
      problem,
    });
  }
}

// ---- module-level helpers --------------------------------------------------

export interface ListAccountingDocumentsQuery {
  /** Always required: a list is never cross-organization (AC-I-01, ADR-0021). */
  organizationId: string;
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  accountingPeriodId?: string | undefined;
  /** `draft` | `temporary` | `final`. */
  state?: string | undefined;
  /** `manual` | `system`. */
  origin?: string | undefined;
  branchId?: string | undefined;
  documentNumber?: string | undefined;
  /** Inclusive business-date bounds, `YYYY-MM-DD`. */
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  search?: string | undefined;
  page: number;
  pageSize: number;
  sort?: string | undefined;
}

export interface CreateAccountingDocumentLineInput extends SubmittedAccountingDocumentLine {}

export interface CreateAccountingDocumentInput {
  organizationId: string;
  financialAreaId: string;
  /** `YYYY-MM-DD` business date (§12.3). */
  documentDate: string;
  description: string;
  branchId?: string | null | undefined;
  lines: readonly CreateAccountingDocumentLineInput[];
  /** Required: the idempotency key of this composition (§16.4). */
  operationKey: string;
  /**
   * `manual` (the HTTP surface's only value) or `system` (the internal posting
   * contract's entry point, §16.3 — not exposed over HTTP in this task).
   */
  origin?: string | undefined;
  /** System-origin source identity (§16.3); forbidden for `manual`. */
  source?: {
    module?: string | null | undefined;
    entityType?: string | null | undefined;
    entityId?: string | null | undefined;
    operation?: string | null | undefined;
  } | null;
}

export interface UpdateAccountingDocumentInput {
  documentDate?: string | undefined;
  description?: string | undefined;
  branchId?: string | null | undefined;
  /** The area may change only while the document is still a draft (AC-D-03). */
  financialAreaId?: string | undefined;
  /** Whole-set replacement; omitted keeps the stored lines (§12.5/§15.2). */
  lines?: readonly CreateAccountingDocumentLineInput[] | undefined;
}

export interface TransitionDocumentInput {
  /** Required: issuance/finalization is an effect-creating operation (§16.4). */
  operationKey: string;
}

export interface ReverseDocumentInput {
  operationKey: string;
  reason: string;
  /** Optional business date of the reversal; defaults to the original date. */
  documentDate?: string | undefined;
}

/** Assign server-owned line ids; `lineNo` was assigned by `normalizeLines`. */
function withLineIds(
  lines: readonly AccountingDocumentLineInput[],
): AccountingDocumentLineWrite[] {
  return lines.map((line) => ({ ...line, id: generateId() }));
}

/**
 * The stored lines re-submitted as an edit's line set (the caller edited the
 * header only). They are already dense and canonical — a stored aggregate that
 * broke either rule would be a bug, so it is asserted rather than repaired.
 */
function currentLines(
  document: AccountingDocument,
): AccountingDocumentLineInput[] {
  const lines = [...document.lines]
    .sort((left, right) => left.lineNo - right.lineNo)
    .map((line) => ({
      lineNo: line.lineNo,
      accountId: line.accountId,
      debitAmount: line.debitAmount,
      creditAmount: line.creditAmount,
      description: line.description,
      sourceLineReference: line.sourceLineReference,
    }));
  const problems = checkLineNumbers(lines.map((line) => line.lineNo));
  if (
    problems.length > 0 ||
    lines.some(
      (line) =>
        isZeroAmount(line.debitAmount) && isZeroAmount(line.creditAmount),
    )
  ) {
    throw new Error(
      `Stored accounting document "${document.id}" has an invalid line set (${problems.join(', ') || 'zero line'}).`,
    );
  }
  return lines;
}

/**
 * The single mapping from the document guard errors (plain errors thrown inside
 * the repository's locked transactions) onto the stable API error model. The
 * in-memory fakes throw the SAME errors, so one mapping covers both paths.
 *
 * The split is the contract's own (§25): a foreign reference is a 404 (never a
 * 403 — AC-I-01/16), everything the document's own rules refuse is a 422, and
 * a state that moved under the request is a 409 (the phase-conflict semantics
 * the calendar already uses).
 */
export function mapDocumentGuardError(error: unknown): AppException | null {
  if (error instanceof AccountingDocumentMissingError) {
    return AppException.notFound('AccountingDocument');
  }
  if (error instanceof AccountingDocumentPhaseConflictError) {
    return AppException.conflict(
      `The accounting document is "${error.actual}", not "${error.expected}". Refresh and retry.`,
    );
  }
  if (error instanceof AccountingDocumentStaleError) {
    return AppException.conflict(error.message);
  }
  if (error instanceof AccountingDocumentFinalProtectedError) {
    return AppException.businessRule(
      'Final accounting documents are immutable: they cannot be edited, re-dated, re-numbered or deleted (contract §15.2/§15.3, AC-I-05/06).',
      { state: error.phase },
    );
  }
  if (error instanceof AccountingDocumentAreaImmutableError) {
    return AppException.businessRule(error.message, {
      problem: 'area_immutable_after_issuance',
    });
  }
  if (error instanceof AccountingDocumentLineRejectedError) {
    return AppException.businessRule(
      'The accounting document lines are not a valid double-entry composition.',
      { problems: error.problems },
    );
  }
  if (error instanceof AccountingDocumentAccountRejectedError) {
    if (error.problem === 'account_not_found') {
      return AppException.notFound('Account', error.accountId);
    }
    return AppException.businessRule(
      error.problem === 'account_disabled'
        ? `Account "${error.accountId}" is disabled and cannot receive document lines.`
        : `Account "${error.accountId}" is not postable: only posting-enabled accounts can receive document lines (AC-I-09).`,
      { accountId: error.accountId, problem: error.problem },
    );
  }
  if (error instanceof AccountingDocumentDateUnresolvableError) {
    return AppException.businessRule(
      'The document date resolves to no accounting period in that financial area. Create the fiscal year and its periods first (§6.2/§7.2); a document is never dated into an implicit year.',
      { documentDate: formatDateOnly(error.documentDate) },
    );
  }
  if (error instanceof AccountingDocumentScopeRejectedError) {
    return AppException.businessRule(
      `The ${error.scope} is "${error.status}": a document cannot be created, moved or finalized in a closed or sealed book (§7.2 rule 4/8).`,
      { scope: error.scope, status: error.status },
    );
  }
  if (error instanceof AccountingDocumentOriginRejectedError) {
    return AppException.badRequest(
      `The accounting document origin evidence is invalid (${error.problem}).`,
    );
  }
  if (error instanceof AccountingDocumentAlreadyReversedError) {
    return AppException.businessRule(error.message, {
      problem: 'already_reversed',
      originalDocumentId: error.originalDocumentId,
    });
  }
  return null;
}

/**
 * After a reverse unique-race, the ledger replay already missed. Classify by
 * Prisma `meta.target` so an operation-key or document-number unique is not
 * reported as already-reversed.
 */
export function mapReverseUniqueViolation(error: unknown): AppException {
  if (
    uniqueViolationTouches(error, [
      'reversesDocumentId',
      'reverses_document_id',
      'reversedByDocumentId',
      'reversed_by_document_id',
    ])
  ) {
    return AppException.businessRule(
      'The accounting document has already been reversed.',
      { problem: 'already_reversed' },
    );
  }
  if (uniqueViolationTouches(error, ['documentNumber', 'document_number'])) {
    return AppException.conflict(
      'The allocated document number already exists in this financial area.',
    );
  }
  if (uniqueViolationTouches(error, ['operationKey', 'operation_key'])) {
    return AppException.conflict(
      'The operationKey was already used. An idempotency key identifies one intent: use a new key for a new operation.',
    );
  }
  return AppException.conflict(
    'A uniqueness constraint was violated while reversing the accounting document.',
  );
}
