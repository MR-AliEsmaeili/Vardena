import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { InventoryBusinessDocumentsRepository } from '../data/inventory-business-documents.repository.js';
import { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import { InventoryAccountingPostingRepository } from '../data/inventory-accounting-posting.repository.js';
import type { InventoryAccountingPostingOperation } from '../data/inventory-accounting-posting.repository.js';
import type {
  DocTxClient,
  InventoryDocumentUpdate,
} from '../data/inventory-business-document-rows.js';
import type { InventoryMovement } from '../domain/inventory-movement.js';

/**
 * `deriveDocumentValuationState` is deliberately closed over the ledger's own
 * valuation vocabulary; the row already carries exactly that type, so the cast
 * is a restatement of a stored invariant, not a widening.
 */
type MovementValuationStatusForDerivation =
  'unvalued' | 'provisional' | 'valued';
import {
  assertTransition,
  deriveDocumentValuationState,
  InventoryDocumentRuleError,
  isAccountingEligible,
  isInventoryDocumentStatus,
  type InventoryBusinessDocument,
  type InventoryDocumentAccountingPostingState,
  type InventoryDocumentStatus,
} from '../domain/inventory-business-document.js';
import { INVENTORY_DOCUMENT_PERMISSIONS } from '../domain/inventory-document-permissions.js';
import { documentTypeFor } from '../domain/inventory-document-types.js';
import { INVENTORY_DOCUMENT_ACCOUNTING_POSTED_EVENT } from '../domain/inventory-document.events.js';
import type { WarehouseAccountingPostingMode } from '../domain/warehouse-posting-mode.js';
import { WarehousesRepository } from '../data/warehouses.repository.js';
import { InventoryValuationService } from './inventory-valuation.service.js';
import { publishEvent } from './master-data-support.js';
import { InventoryPostingService } from '../../accounting/application/inventory-posting.service.js';
import {
  type InventoryPostingActor,
  type InventoryPostingRequest,
  type InventoryPostingResult,
} from '../../accounting/application/inventory-posting-contract.js';
import {
  ACCOUNTING_POST_ACTION,
  buildAccountingPostingRequestHash,
  deriveAccountingOperationKey,
  deriveUnitCost,
  isValidAccountingPostingOperationKey,
  normalizeAccountingPostingOperationKey,
  totalMovementValue,
  valuationBasisOf,
  type AccountingPostingMovementFact,
} from '../domain/inventory-accounting-posting-request.js';
import {
  documentAccountingPostingStateFor,
  isInventoryDocumentAccountingPostingState,
  type InventoryAccountingPostingState,
} from '../domain/inventory-accounting-posting-operation.js';

/** The cancel action, part of the operation identity (C62-OD-06). */
const CANCEL_ACTION = `${ACCOUNTING_POST_ACTION}:cancel`;

/** What a caller asks for when crossing the boundary. */
export interface RequestAccountingPostingInput {
  /**
   * The caller's idempotency key. When omitted one is derived from the
   * document and action, so a UI retry without an explicit key still lands on
   * the same durable operation instead of a second one.
   */
  operationKey?: string | undefined;
  /**
   * Optional optimistic-concurrency expectation. When supplied, the request is
   * refused (409) unless the document is still at that revision.
   */
  expectedDocumentRevision?: string | undefined;
}

/** The answer to a posting request, in terms the caller may persist. */
export interface AccountingPostingOutcomeDto {
  documentId: string;
  organizationId: string;
  action: string;
  operationKey: string;
  /** `not_posted` | `draft_created` | `final_posted` | `draft_cancelled`. */
  state: InventoryDocumentAccountingPostingState;
  /** `final_posted` | `draft_created` | `refused` | `failed`. */
  outcome: InventoryPostingResult['outcome'];
  postingMode: WarehouseAccountingPostingMode;
  /** True when this answer replays an earlier identical request. */
  replayed: boolean;
  accountingDocumentId: string | null;
  accountingDocumentNumber: string | null;
  accountingDocumentPhase: string | null;
  glPosted: boolean;
  refusalCode: string | null;
  refusalReason: string | null;
}

/** Everything the snapshot and the contract request are built from. */
interface CollectedFacts {
  movements: readonly AccountingPostingMovementFact[];
  valuationState: string;
  valuationBasis: string;
  valuationRunId: string | null;
  staleVerdict: 'not_stale' | 'stale';
}

/**
 * The Inventory side of the C-62 Inventory → Accounting posting boundary
 * (PDR-09 PO-01…PO-12, PDR-10 C62-OD-01…06, ADR-0041 §2).
 *
 * WHAT THIS SERVICE DOES NOT DO
 * -----------------------------
 * It never selects an account, never reads an Accounting table and never
 * writes an Accounting row. Everything accounting-shaped is decided by
 * `InventoryPostingService` inside Accounting; this class supplies SOURCE
 * FACTS and persists the Accounting RESULT it gets back (PO-02, AR-07). The
 * boundary is one synchronous in-process application-service call — not the
 * in-memory event bus, not an HTTP hop, not a shared table.
 *
 * WHY IT IS NOT ONE TRANSACTION (OD-01)
 * -------------------------------------
 * OD-01 asked for a shared atomic transaction "if truly feasible". It is not,
 * and this is the durable fallback, never labelled atomic:
 *
 *   * Accounting's repositories and `NumberingSeriesRepository.allocate` each
 *     open their own non-nestable `PrismaService.$transaction`, and there is
 *     no caller-owned transaction seam in `PrismaService`. Making one would be
 *     the prohibited broad transaction-infrastructure rewrite.
 *   * Even with such a seam the two modules take their locks in different
 *     orders (Accounting: period/area → accounts → document → projection;
 *     Inventory: document header → valuation states). Sharing a transaction
 *     would create a new cross-module lock order and a deadlock risk for no
 *     correctness gain, because the recovery rule is already explicit.
 *
 * So the operation is TWO PHASES with a durable intent between them:
 *
 *   PHASE 1 (an Inventory transaction): lock the document header and the
 *     valuation-state rows, re-derive eligibility, then write the PENDING
 *     operation row and its immutable snapshot. A crash here leaves a
 *     recoverable row that says exactly what was attempted (C62-OD-06).
 *
 *   PHASE 2 (outside any transaction): the synchronous in-process call to
 *     Accounting. Accounting commits its own voucher in its own transaction
 *     and answers with a typed result.
 *
 *   PHASE 3 (a second short Inventory transaction): record the answer on the
 *     operation row and project the resulting standing onto the document.
 *
 * The window between phases is exactly the documented recovery case: an
 * operation left non-terminal is retried under the SAME key, Accounting's own
 * idempotency ledger replays it, and no second voucher can appear. Nothing
 * here claims the two phases are one atomic step, because they are not.
 */
@Injectable()
export class InventoryAccountingPostingService {
  constructor(
    private readonly documents: InventoryBusinessDocumentsRepository,
    private readonly movements: InventoryMovementsRepository,
    private readonly postings: InventoryAccountingPostingRepository,
    private readonly warehouses: WarehousesRepository,
    private readonly valuation: InventoryValuationService,
    private readonly organizations: OrganizationsService,
    private readonly authorization: AuthorizationService,
    private readonly posting: InventoryPostingService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  /**
   * Cross the Accounting Post boundary for one document (C-62).
   *
   * The action is part of the operation identity, so «post» and «cancel the
   * draft» are two durable operations over one document, never one
   * indistinguishable ledger row.
   */
  async requestAccountingPosting(
    id: string,
    organizationId: string,
    input: RequestAccountingPostingInput = {},
  ): Promise<AccountingPostingOutcomeDto> {
    await this.authorization.requireAllPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.ACCOUNTING_POST,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);

    const operationKey = this.resolveOperationKey(
      id,
      ACCOUNTING_POST_ACTION,
      input.operationKey,
    );
    const current = await this.mustFind(id, organizationId);

    // Idempotency first, before any eligibility work: a retried request must
    // replay its own earlier answer rather than re-decide on facts that may
    // have moved (C62-OD-06).
    const existing = await this.postings.findByKey({
      organizationId,
      documentId: id,
      action: ACCOUNTING_POST_ACTION,
      operationKey,
    });
    if (existing !== null) {
      // A replay is answered from the durable record, but it is still an EVENT
      // in that record: without this the row would keep `replayed = false`
      // forever, which is false audit evidence (C62-OD-06).
      await this.postings.markReplayed(
        organizationId,
        existing.id,
        existing.actorUserId,
        new Date(),
      );
      return this.replayExisting(organizationId, existing);
    }

    if (
      input.expectedDocumentRevision !== undefined &&
      input.expectedDocumentRevision !== this.revisionOf(current)
    ) {
      throw AppException.conflict(
        'The inventory document changed since it was read. Re-read it and retry the posting request.',
      );
    }

    const intent = await this.writeDurableIntent(
      id,
      organizationId,
      operationKey,
    );
    // PHASE 2 — the one synchronous boundary call (ADR-0041 §2).
    const result = await this.posting.postFromInventory(intent.request);
    // PHASE 3 — record what Accounting said.
    return this.applyOutcome(intent, result);
  }

  /**
   * The durable posting trail of one document, newest first (C-62 audit
   * surface).
   *
   * This is the ONLY honest way an operator can learn WHY a posting did not
   * cross the boundary: a refusal and a failure are durable facts about the
   * OPERATION, not about the document, and the document deliberately keeps its
   * own standing (`not_posted`) instead of absorbing Accounting's verdict. So
   * the answer is read from the ledger Inventory owns, and never from
   * Accounting's tables (PO-02/AR-07).
   */
  async listAccountingPostings(
    id: string,
    organizationId: string,
  ): Promise<readonly InventoryAccountingPostingOperation[]> {
    await this.mustFind(id, organizationId);
    return this.postings.listForDocument({ organizationId, documentId: id });
  }

  /**
   * Cancel the Accounting DRAFT a posting operation created (C62-OD-02).
   *
   * Only a document whose standing is `draft_created` may be cancelled: the
   * draft belongs to Accounting, so the request is made THROUGH the same
   * contract, and the Inventory standing only moves to `draft_cancelled` once
   * Accounting confirms the draft is gone. A final voucher is never
   * cancellable here.
   */
  async cancelAccountingPosting(
    id: string,
    organizationId: string,
    input: { operationKey?: string | undefined } = {},
  ): Promise<AccountingPostingOutcomeDto> {
    await this.authorization.requireAllPermissions([
      INVENTORY_DOCUMENT_PERMISSIONS.ACCOUNTING_POST,
    ]);
    await this.organizations.assertOrganizationInScope(organizationId);

    const operationKey = this.resolveOperationKey(
      id,
      CANCEL_ACTION,
      input.operationKey,
    );
    const current = await this.mustFind(id, organizationId);
    const mode = await this.modeFor(current);

    if (current.accountingPostingState !== 'draft_created') {
      throw AppException.businessRule(
        'Only a document whose Accounting posting created a draft can be cancelled.',
        {
          code: 'inventory.document.accounting_post_draft_required',
          documentId: id,
          accountingPostingState: current.accountingPostingState,
        },
      );
    }
    if (current.accountingPostingOperationId === null) {
      throw AppException.businessRule(
        'The document names no Accounting posting operation to cancel.',
        {
          code: 'inventory.document.accounting_post_operation_missing',
          documentId: id,
        },
      );
    }
    const operation = await this.postings.findById(
      organizationId,
      current.accountingPostingOperationId,
    );
    if (operation === null) {
      throw AppException.businessRule(
        'The Accounting posting operation this document names no longer exists.',
        {
          code: 'inventory.document.accounting_post_operation_missing',
          documentId: id,
        },
      );
    }

    const actor = this.actorFor(current);
    const cancellation = await this.posting.cancelInventoryDraft({
      organizationId,
      operationKey: operation.operationKey,
      actor,
    });
    if (!cancellation.cancelled) {
      // Accounting still owns the draft, so Inventory must not claim it was
      // discarded: the standing stays exactly where it is.
      return {
        documentId: id,
        organizationId,
        action: CANCEL_ACTION,
        operationKey,
        state: current.accountingPostingState,
        outcome: 'refused',
        postingMode: mode,
        replayed: false,
        accountingDocumentId: current.accountingDocumentId,
        accountingDocumentNumber: current.accountingDocumentNumber,
        accountingDocumentPhase: current.accountingDocumentPhase,
        glPosted: false,
        refusalCode: cancellation.refusalCode,
        refusalReason: cancellation.refusalReason,
      };
    }

    const updated = await this.recordCancellation(
      current,
      operation.id,
      operationKey,
      actor,
    );
    return {
      documentId: id,
      organizationId,
      action: CANCEL_ACTION,
      operationKey,
      state: updated.accountingPostingState,
      outcome: 'refused',
      postingMode: await this.modeFor(updated),
      replayed: false,
      accountingDocumentId: updated.accountingDocumentId,
      accountingDocumentNumber: updated.accountingDocumentNumber,
      accountingDocumentPhase: updated.accountingDocumentPhase,
      glPosted: false,
      refusalCode: null,
      refusalReason: null,
    };
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Resolve, never invent, the operation key. A malformed caller key is a 400:
   * silently substituting a different identity would break exactly the
   * guarantee the key exists to provide.
   */
  private resolveOperationKey(
    documentId: string,
    action: string,
    supplied: string | undefined,
  ): string {
    if (supplied === undefined || supplied.trim() === '') {
      return deriveAccountingOperationKey({
        documentId,
        action,
        operationKey: '',
        step: 'create',
      });
    }
    if (!isValidAccountingPostingOperationKey(supplied)) {
      throw AppException.validation([
        {
          field: 'operationKey',
          message: 'The operation key must be 1-128 characters.',
          code: 'invalidOperationKey',
        },
      ]);
    }
    return normalizeAccountingPostingOperationKey(supplied);
  }

  /**
   * The document revision the request hash is computed over. There is no
   * version column and inventing one would be a schema change for its own
   * sake, so the revision is the document's own last-modified instant: any
   * edit between two attempts of one key changes it, which is exactly what the
   * hash needs.
   */
  private revisionOf(document: InventoryBusinessDocument): string {
    return document.updatedAt.toISOString();
  }

  private async mustFind(
    id: string,
    organizationId: string,
  ): Promise<InventoryBusinessDocument> {
    const document = await this.documents.findById(organizationId, id);
    if (document === null) {
      // 404, never 403: the API must not confirm that an id belonging to
      // another organization exists (ADR-0021 §4).
      throw AppException.notFound('Inventory document', id);
    }
    return document;
  }

  /** Re-answer an earlier identical request from its durable record. */
  private replayExisting(
    organizationId: string,
    existing: {
      id: string;
      documentId: string;
      action: string;
      operationKey: string;
      postingMode: string;
      state: InventoryAccountingPostingState;
      accountingDocumentId: string | null;
      accountingDocumentNumber: string | null;
      accountingDocumentPhase: string | null;
      glPosted: boolean;
      refusalCode: string | null;
      refusalReason: string | null;
    },
  ): AccountingPostingOutcomeDto {
    const standing = documentAccountingPostingStateFor(existing.state);
    return {
      documentId: existing.documentId,
      organizationId,
      action: existing.action,
      operationKey: existing.operationKey,
      state: standing ?? 'not_posted',
      outcome:
        existing.state === 'POSTED'
          ? 'final_posted'
          : existing.state === 'DRAFT_CREATED'
            ? 'draft_created'
            : 'refused',
      postingMode: this.normalizeMode(existing.postingMode),
      replayed: true,
      accountingDocumentId: existing.accountingDocumentId,
      accountingDocumentNumber: existing.accountingDocumentNumber,
      accountingDocumentPhase: existing.accountingDocumentPhase,
      glPosted: existing.glPosted,
      refusalCode: existing.refusalCode,
      refusalReason: existing.refusalReason,
    };
  }

  private normalizeMode(mode: string): WarehouseAccountingPostingMode {
    return mode === 'draft' ? 'draft' : 'direct_final';
  }

  private async modeFor(
    document: InventoryBusinessDocument,
  ): Promise<WarehouseAccountingPostingMode> {
    if (document.warehouseId === null) return 'direct_final';
    const warehouse = await this.warehouses.findByIdInOrganization(
      document.organizationId,
      document.warehouseId,
    );
    if (warehouse === null) {
      // The document names a warehouse that is not in this organization (or
      // no longer exists). A posting mode is the accountant's configuration,
      // so guessing one would post under a policy nobody chose: fail closed.
      throw AppException.businessRule(
        'The warehouse this inventory document was posted against cannot be resolved in this organization.',
        {
          code: 'inventory.document.accounting_post_warehouse_unresolved',
          documentId: document.id,
          warehouseId: document.warehouseId,
        },
      );
    }
    return warehouse.accountingPostingMode;
  }

  private actorFor(document: InventoryBusinessDocument): InventoryPostingActor {
    const userId = getPrincipal()?.userId;
    if (userId === undefined || userId === '') {
      // The request-context seam is what makes the service authority
      // auditable: with no authenticated human there is nothing to assert
      // against, so the operation fails closed instead of running as an
      // anonymous "system".
      throw AppException.unauthorized(
        'An authenticated user is required to post an inventory document to Accounting.',
      );
    }
    return {
      userId,
      permission: INVENTORY_DOCUMENT_PERMISSIONS.ACCOUNTING_POST,
      organizationId: document.organizationId,
    };
  }

  /**
   * PHASE 1. One Inventory transaction:
   *
   *   1. lock the document header row (serializes edits, cancels, seals and a
   *      second posting request);
   *   2. lock the valuation-state rows of every key the document's movements
   *      touch, in the module's fixed ascending order — the same tier a
   *      Pricing Run or Reverse Pricing locks through;
   *   3. re-derive eligibility from a read taken AFTER the locks, so a
   *      valuation writer that had already committed is visible and any
   *      in-flight one is still blocked on the same locks;
   *   4. refuse ineligibility (nothing written);
   *   5. write the PENDING operation row and its immutable snapshot, and return
   *      the request built from the SAME post-lock facts the snapshot froze.
   *
   * Steps 1-3 are the concurrency hardening the pre-C-62 boundary already had;
   * step 5 is what makes the non-atomic fallback recoverable.
   */
  private async writeDurableIntent(
    id: string,
    organizationId: string,
    operationKey: string,
  ): Promise<{ request: InventoryPostingRequest; operationId: string }> {
    const now = new Date();
    const actor = this.actorFor(await this.mustFind(id, organizationId));
    let intent: {
      request: InventoryPostingRequest;
      operationId: string;
    } | null = null;

    await this.documents.withTransaction(async (tx) => {
      const locked = await this.documents.lockDocumentRow(
        tx,
        organizationId,
        id,
      );
      if (locked === null) {
        throw AppException.notFound('Inventory document', id);
      }
      if (!isInventoryDocumentStatus(locked.status)) {
        throw new Error(
          `Stored inventory document "${id}" has an unknown status "${locked.status}".`,
        );
      }
      if (
        !isInventoryDocumentAccountingPostingState(
          locked.accountingPostingState,
        )
      ) {
        throw new Error(
          `Stored inventory document "${id}" has an unknown accounting posting state "${locked.accountingPostingState}".`,
        );
      }
      // The lifecycle vocabulary comes first: a draft asking to cross the
      // Accounting Post boundary is an illegal transition, which is a more
      // precise answer than "not eligible" and is what the document lifecycle
      // has always said.
      const lockedStatus: InventoryDocumentStatus = locked.status;
      rethrowDomain(() => assertTransition(lockedStatus, 'accounting_posted'));
      if (
        locked.status === 'accounting_posted' ||
        locked.status === 'immutable'
      ) {
        // Another request already crossed the boundary. A second durable
        // operation would be a second Accounting effect, so this is refused
        // rather than replayed: the caller must read the document's standing.
        throw AppException.businessRule(
          'The inventory document has already been posted to Accounting.',
          {
            code: 'inventory.document.already_accounting_posted',
            documentId: id,
            status: locked.status,
            accountingPostingState: locked.accountingPostingState,
          },
        );
      }
      if (locked.warehouseId === null) {
        throw AppException.businessRule(
          'Only an inventory document with a warehouse can be posted to Accounting.',
          {
            code: 'inventory.document.accounting_post_no_warehouse',
            documentId: id,
          },
        );
      }

      const movements = await this.lockValuationKeysFor(
        tx,
        organizationId,
        id,
        now,
        actor.userId,
      );
      if (movements.length === 0) {
        throw this.ineligible(
          id,
          locked.status,
          'unpriced',
          locked.valuationStale,
        );
      }
      // The read the snapshot is frozen from: taken AFTER every lock above, so
      // the values in the snapshot are the values this organization had
      // committed, and a concurrent valuation writer cannot slip between the
      // eligibility decision and the snapshot.
      const facts = await this.collectFacts(id, organizationId, movements);
      if (facts.movements.length === 0) {
        throw this.ineligible(
          id,
          locked.status,
          facts.valuationState,
          locked.valuationStale,
        );
      }
      const valuationState = deriveDocumentValuationState(
        facts.movements.map(
          (movement) =>
            movement.valuationStatus as MovementValuationStatusForDerivation,
        ),
      );
      if (
        !isAccountingEligible(
          { status: locked.status, valuationStale: locked.valuationStale },
          valuationState,
        ) ||
        locked.valuationStale ||
        facts.staleVerdict === 'stale'
      ) {
        throw this.ineligible(
          id,
          locked.status,
          valuationState,
          locked.valuationStale,
        );
      }

      const warehouse = await this.warehouses.findByIdInOrganization(
        organizationId,
        locked.warehouseId,
      );
      if (warehouse === null) {
        throw AppException.businessRule(
          'The warehouse this inventory document was posted against cannot be resolved in this organization.',
          {
            code: 'inventory.document.accounting_post_warehouse_unresolved',
            documentId: id,
            warehouseId: locked.warehouseId,
          },
        );
      }
      const request = this.buildRequest(
        {
          id: locked.id,
          organizationId,
          kind: locked.kind,
          number: locked.number,
          businessDate: locked.businessDate,
          warehouseId: locked.warehouseId,
          valuationStale: locked.valuationStale,
          updatedAt: locked.updatedAt,
        },
        organizationId,
        operationKey,
        actor,
        facts,
        warehouse.accountingPostingMode,
        warehouse.branchId,
      );

      // PHASE 1 stays ONE transaction: the operation and its snapshot are
      // written on the SAME `tx` that holds the header and valuation-state
      // locks, so the eligibility decision and the record of what was sent
      // across the boundary can never disagree.
      const created = await this.postings.createOperationWithSnapshot(
        tx,
        {
          organizationId,
          documentId: id,
          action: ACCOUNTING_POST_ACTION,
          operationKey,
          requestHash: request.requestHash,
          documentVersion: request.sourceDocumentVersion,
          postingMode: request.postingMode,
          state: 'PENDING',
          actorUserId: actor.userId,
          actorPermission: actor.permission,
          now,
        },
        {
          operationId: '',
          organizationId,
          documentId: id,
          documentType: request.sourceDocumentType,
          documentNumber: request.sourceDocumentNumber,
          documentVersion: request.sourceDocumentVersion,
          documentDate: new Date(request.sourceDocumentDate),
          branchId: request.branchId,
          warehouseId: request.warehouseId,
          valuationState: facts.valuationState,
          valuationStale: locked.valuationStale,
          staleVerdict: facts.staleVerdict,
          valuationRunId: facts.valuationRunId,
          valuationBasis: facts.valuationBasis,
          totalValue: request.valuation.totalValue,
          actorUserId: actor.userId,
          capturedAt: now,
          movements: facts.movements,
          now,
        },
      );
      intent = { request, operationId: created.id };
    });

    if (intent === null) {
      throw new Error(
        `The accounting posting intent for document "${id}" was not written.`,
      );
    }
    return intent;
  }

  /**
   * Lock the valuation-state rows of every key this document's movements touch,
   * in the module's fixed ascending multi-key order, and return the movements
   * the document actually owns.
   */
  private async lockValuationKeysFor(
    tx: DocTxClient,
    organizationId: string,
    id: string,
    now: Date,
    actorId: string | null,
  ): Promise<readonly InventoryMovement[]> {
    const document = await this.mustFind(id, organizationId);
    const movementIds = [
      ...new Set(
        document.lines.flatMap((line) =>
          [line.movementId, line.outMovementId, line.inMovementId].filter(
            (movementId): movementId is string => movementId !== null,
          ),
        ),
      ),
    ];
    const movements = (await this.movements.findIds(movementIds)).filter(
      (movement) => movement.organizationId === organizationId,
    );
    const keys = [
      ...new Map(
        movements.map((movement) => [
          `${movement.warehouseId}:${movement.itemId}`,
          {
            organizationId: movement.organizationId,
            branchId: movement.branchId,
            warehouseId: movement.warehouseId,
            itemId: movement.itemId,
          },
        ]),
      ).values(),
    ];
    const lockEntries = await Promise.all(
      keys.map(async (key) => ({
        key,
        method: (
          await this.valuation.resolveMethodForPosting({
            organizationId: key.organizationId,
            itemId: key.itemId,
            asOf: now,
          })
        ).method,
      })),
    );
    await this.documents.lockValuationStateRows(tx, lockEntries, actorId);
    return movements;
  }

  /**
   * Gather every source fact the posting needs — and nothing
   * accounting-shaped.
   *
   * Values come verbatim from the owned movements: `total_cost` is the
   * authoritative signed inventory value, and `unit_cost` is its derived
   * per-base-unit presentation (`total_cost / base_quantity`, scale 6). The
   * ledger deliberately stores no unit cost of its own, so the snapshot is the
   * one place the derived figure is frozen for audit — never a second rounded
   * truth.
   */
  private async collectFacts(
    id: string,
    organizationId: string,
    movements: readonly InventoryMovement[],
  ): Promise<CollectedFacts> {
    const document = await this.mustFind(id, organizationId);
    const lineOf = new Map<string, string>();
    for (const line of document.lines) {
      for (const movementId of [
        line.movementId,
        line.outMovementId,
        line.inMovementId,
      ]) {
        if (movementId !== null && !lineOf.has(movementId)) {
          lineOf.set(movementId, line.id);
        }
      }
    }
    const owned = movements.filter(
      (movement) => movement.organizationId === organizationId,
    );
    const facts: AccountingPostingMovementFact[] = owned
      .map((movement) => ({
        movementId: movement.id,
        lineId: lineOf.get(movement.id) ?? '',
        itemId: movement.itemId,
        quantity: movement.quantity,
        unitId: movement.enteredUnitId,
        baseQuantity: movement.baseQuantity,
        baseUnitId: movement.baseUnitId,
        value: movement.totalCost ?? '0.00',
        unitCost: deriveUnitCost(
          movement.totalCost ?? '0.00',
          movement.baseQuantity,
        ),
        valuationStatus: movement.valuationStatus,
        valuationSource: movement.valuationSource,
        valuationRunId: movement.valuationRunId,
      }))
      .sort((left, right) => left.movementId.localeCompare(right.movementId));

    // A stale valuation key blocks eligibility, so the verdict is enforced
    // here rather than inferred by Accounting.
    return {
      movements: facts,
      valuationState: deriveDocumentValuationState(
        owned.map(
          (movement) =>
            movement.valuationStatus as MovementValuationStatusForDerivation,
        ),
      ),
      valuationBasis: valuationBasisOf(
        owned.find((movement) => movement.valuationSource !== null)
          ?.valuationSource ?? null,
      ),
      valuationRunId:
        owned.find((movement) => movement.valuationRunId !== null)
          ?.valuationRunId ?? null,
      staleVerdict: document.valuationStale ? 'stale' : 'not_stale',
    };
  }

  /** Build the contract request: source facts only (C62-OD-04). */
  private buildRequest(
    header: {
      id: string;
      organizationId: string;
      kind: string;
      number: string | null;
      businessDate: Date;
      warehouseId: string | null;
      valuationStale: boolean;
      updatedAt: Date;
    },
    organizationId: string,
    operationKey: string,
    actor: InventoryPostingActor,
    facts: CollectedFacts,
    postingMode: WarehouseAccountingPostingMode,
    branchId: string,
  ): InventoryPostingRequest {
    if (header.warehouseId === null) {
      throw AppException.businessRule(
        'Only an inventory document with a warehouse can be posted to Accounting.',
        {
          code: 'inventory.document.accounting_post_no_warehouse',
          documentId: header.id,
        },
      );
    }
    // The DECLARED source type, not the Inventory kind: Accounting's mapping
    // table is keyed by it, and this slice implements exactly one of them.
    const sourceDocumentType = documentTypeFor(
      header.kind as Parameters<typeof documentTypeFor>[0],
    );
    const canonical = {
      organizationId,
      branchId,
      sourceDocumentId: header.id,
      sourceDocumentType,
      sourceDocumentNumber: header.number,
      sourceDocumentDate: toDateOnly(header.businessDate),
      sourceDocumentVersion: header.updatedAt.toISOString(),
      warehouseId: header.warehouseId,
      postingMode,
      action: ACCOUNTING_POST_ACTION,
      valuation: {
        state: facts.valuationState,
        documentStale: header.valuationStale,
        keyStaleVerdict: facts.staleVerdict,
        valuationRunId: facts.valuationRunId,
        basis: facts.valuationBasis,
        totalValue: totalMovementValue(facts.movements),
      },
      movements: facts.movements,
    };
    const request: InventoryPostingRequest = {
      organizationId,
      branchId,
      warehouseId: header.warehouseId,
      sourceDocumentId: header.id,
      // An unsupported source type is carried through verbatim so Accounting
      // refuses it with `accounting.source_type_unsupported` — a durable,
      // explicit fact — instead of being silently skipped here.
      sourceDocumentType:
        canonical.sourceDocumentType as InventoryPostingRequest['sourceDocumentType'],
      sourceDocumentNumber: header.number,
      sourceDocumentDate: canonical.sourceDocumentDate,
      sourceDocumentVersion: canonical.sourceDocumentVersion,
      postingMode,
      operationKey,
      requestHash: '',
      actor,
      movements: facts.movements,
      valuation: canonical.valuation,
    };
    return {
      ...request,
      requestHash: buildAccountingPostingRequestHash(canonical),
    };
  }

  private ineligible(
    id: string,
    status: string,
    valuationState: string,
    valuationStale: boolean,
  ): AppException {
    return AppException.businessRule(
      'The inventory document is not accounting eligible. It must be operational, fully priced, and have no stale valuation.',
      {
        code: 'inventory.document.accounting_ineligible',
        documentId: id,
        status,
        valuationState,
        valuationStale,
      },
    );
  }

  /**
   * PHASE 3. Record Accounting's answer and project the resulting standing
   * onto the document, under the document row lock, so two concurrent requests
   * cannot both decide the lifecycle.
   */
  private async applyOutcome(
    intent: { request: InventoryPostingRequest; operationId: string },
    result: InventoryPostingResult,
  ): Promise<AccountingPostingOutcomeDto> {
    const { request } = intent;
    const now = new Date();
    const actorUserId = request.actor.userId;
    const crossesLifecycle =
      result.outcome === 'final_posted' && result.glPosted;
    const operationState: InventoryAccountingPostingState =
      result.outcome === 'final_posted'
        ? 'POSTED'
        : result.outcome === 'draft_created'
          ? 'DRAFT_CREATED'
          : result.outcome === 'failed'
            ? 'FAILED'
            : 'REFUSED';

    await this.documents.withTransaction(async (tx) => {
      const locked = await this.documents.lockDocumentRow(
        tx,
        request.organizationId,
        request.sourceDocumentId,
      );
      if (locked === null) {
        throw AppException.notFound(
          'Inventory document',
          request.sourceDocumentId,
        );
      }
      if (crossesLifecycle && locked.status === 'accounting_posted') {
        // Another request already crossed the boundary: this one is a replay
        // and must not write a second time.
        return;
      }
      const patch: InventoryDocumentUpdate = {
        accountingPostingState:
          documentAccountingPostingStateFor(operationState) ?? 'not_posted',
        accountingPostingOperationId: intent.operationId,
        accountingDocumentId: result.accountingDocument?.id ?? null,
        accountingDocumentNumber: result.accountingDocument?.number ?? null,
        accountingDocumentPhase: result.accountingDocument?.phase ?? null,
        updatedAt: now,
        updatedBy: actorUserId,
      };
      if (crossesLifecycle) {
        patch.status = 'accounting_posted';
        patch.accountingPostedAt = now;
        patch.accountingPostedBy = actorUserId;
      }
      await this.documents.updateHeader(tx, request.sourceDocumentId, patch);
    });

    await this.postings.updateOperation(
      request.organizationId,
      intent.operationId,
      {
        state: operationState,
        refusalCode: result.refusalCode,
        refusalReason: result.refusalReason,
        accountingDocumentId: result.accountingDocument?.id ?? null,
        accountingDocumentNumber: result.accountingDocument?.number ?? null,
        accountingDocumentPhase: result.accountingDocument?.phase ?? null,
        accountingOperationKey: result.accountingDocument?.id
          ? deriveAccountingOperationKey({
              documentId: request.sourceDocumentId,
              action: ACCOUNTING_POST_ACTION,
              operationKey: request.operationKey,
              step: 'create',
            })
          : null,
        glPosted: result.glPosted,
        replayed: result.replayed,
        completedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: actorUserId,
      },
    );

    const updated = await this.mustFind(
      request.sourceDocumentId,
      request.organizationId,
    );
    if (crossesLifecycle) {
      await publishEvent(this.events, {
        type: INVENTORY_DOCUMENT_ACCOUNTING_POSTED_EVENT,
        aggregateType: 'InventoryBusinessDocument',
        aggregateId: updated.id,
        payload: {
          id: updated.id,
          organizationId: updated.organizationId,
          kind: updated.kind,
          number: updated.number,
          status: updated.status,
          movementIds: [],
          accountingPostingState: updated.accountingPostingState,
          accountingDocumentId: updated.accountingDocumentId,
          accountingDocumentNumber: updated.accountingDocumentNumber,
        },
      });
      this.logger.log(
        'Inventory business document accounting-posted',
        {
          documentId: updated.id,
          organizationId: request.organizationId,
          number: updated.number,
          accountingDocumentId: result.accountingDocument?.id ?? null,
          accountingDocumentNumber: result.accountingDocument?.number ?? null,
          postingMode: request.postingMode,
          outcome: result.outcome,
          initiatedByUserId: request.actor.userId,
        },
        InventoryAccountingPostingService.name,
      );
    } else {
      this.logger.warn(
        'Inventory accounting posting did not reach the General Ledger',
        {
          documentId: updated.id,
          organizationId: request.organizationId,
          outcome: result.outcome,
          refusalCode: result.refusalCode,
          accountingDocumentId: result.accountingDocument?.id ?? null,
          postingMode: request.postingMode,
          initiatedByUserId: request.actor.userId,
        },
        InventoryAccountingPostingService.name,
      );
    }

    return {
      documentId: updated.id,
      organizationId: request.organizationId,
      action: ACCOUNTING_POST_ACTION,
      operationKey: request.operationKey,
      state: updated.accountingPostingState,
      outcome: result.outcome,
      postingMode: request.postingMode,
      replayed: result.replayed,
      accountingDocumentId: updated.accountingDocumentId,
      accountingDocumentNumber: updated.accountingDocumentNumber,
      accountingDocumentPhase: updated.accountingDocumentPhase,
      glPosted: result.glPosted,
      refusalCode: result.refusalCode,
      refusalReason: result.refusalReason,
    };
  }

  private async recordCancellation(
    document: InventoryBusinessDocument,
    operationId: string,
    operationKey: string,
    actor: InventoryPostingActor,
  ): Promise<InventoryBusinessDocument> {
    const now = new Date();
    await this.documents.withTransaction(async (tx) => {
      const locked = await this.documents.lockDocumentRow(
        tx,
        document.organizationId,
        document.id,
      );
      if (locked === null) {
        throw AppException.notFound('Inventory document', document.id);
      }
      if (locked.accountingPostingState !== 'draft_created') {
        throw AppException.businessRule(
          'Only a document whose Accounting posting created a draft can be cancelled.',
          {
            code: 'inventory.document.accounting_post_draft_required',
            documentId: document.id,
            accountingPostingState: locked.accountingPostingState,
          },
        );
      }
      await this.documents.updateHeader(tx, document.id, {
        accountingPostingState: 'draft_cancelled',
        updatedAt: now,
        updatedBy: actor.userId,
      });
    });
    await this.postings.updateOperation(document.organizationId, operationId, {
      state: 'CANCELLED',
      glPosted: false,
      completedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: actor.userId,
    });
    this.logger.log(
      'Inventory business document accounting draft cancelled',
      {
        documentId: document.id,
        organizationId: document.organizationId,
        operationKey,
        accountingDocumentId: document.accountingDocumentId,
        initiatedByUserId: actor.userId,
      },
      InventoryAccountingPostingService.name,
    );
    return this.mustFind(document.id, document.organizationId);
  }
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The module's one domain-rule → HTTP mapping, restated here because the
 * posting service is a separate application class that owns its own boundary.
 * Same rule as the document service's own copy: a rule violation becomes a
 * 422 with the domain's stable code, never an unhandled 500.
 */
function rethrowDomain(work: () => void): void {
  try {
    work();
  } catch (error) {
    if (error instanceof InventoryDocumentRuleError) {
      throw AppException.businessRule(error.message, { code: error.code });
    }
    throw error;
  }
}
