import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import {
  isUniqueViolation,
  uniqueViolationTouches,
} from '../../../kernel/prisma/prisma-errors.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import {
  businessDateFromInstant,
  type BusinessDate,
} from '../../../kernel/datetime/business-date.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { AuthorizationService } from '../../rbac/application/authorization.service.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { InventoryBusinessDocumentsRepository } from '../data/inventory-business-documents.repository.js';
import { InventoryMovementsRepository } from '../data/inventory-movements.repository.js';
import { InventoryAccountingPostingRepository } from '../data/inventory-accounting-posting.repository.js';
import type {
  InventoryAccountingPostingOperation,
  InventoryAccountingPostingSnapshot,
} from '../data/inventory-accounting-posting.repository.js';
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
  type InventoryPostingDraftCancellation,
  type InventoryPostingRequest,
  type InventoryPostingResult,
} from '../../accounting/application/inventory-posting-contract.js';
import {
  ACCOUNTING_POST_ACTION,
  buildAccountingPostingCancellationHash,
  buildAccountingPostingRequestHash,
  canonicalRequestFromSnapshot,
  deriveAccountingOperationKey,
  deriveUnitCost,
  isValidAccountingPostingOperationKey,
  normalizeAccountingPostingOperationKey,
  toAccountingPostingDateOnly,
  totalMovementValue,
  valuationBasisOf,
  type AccountingPostingCancellationRequest,
  type AccountingPostingMovementFact,
} from '../domain/inventory-accounting-posting-request.js';
import {
  ACCOUNTING_POST_CANCEL_ACTION,
  documentAccountingPostingStateFor,
  isInventoryDocumentAccountingPostingState,
  isTerminalAccountingPostingState,
  type InventoryAccountingPostingState,
} from '../domain/inventory-accounting-posting-operation.js';
import { resolveWarehouseAccountingPostingMode } from '../domain/warehouse-posting-mode.js';

/**
 * The cancel action, part of the operation identity (C62-OD-06): cancelling
 * the Accounting draft is a SEPARATE durable operation
 * (`accounting_post:cancel`), never a mutation of the posting operation.
 */
const CANCEL_ACTION = ACCOUNTING_POST_CANCEL_ACTION;

/**
 * What `writeDurableIntent` (PHASE 1) produced: either the freshly written
 * durable intent, or — when the in-lock idempotency re-check found that the
 * key already has a durable operation — that operation, to be answered by the
 * caller through the SAME OD-06 decision procedure.
 */
type Phase1Result =
  | {
      kind: 'created';
      intent: {
        request: InventoryPostingRequest;
        operationId: string;
        initiatingActorUserId?: string | null;
      };
    }
  | { kind: 'raced'; operation: InventoryAccountingPostingOperation };

type CancelPhase1Result =
  | { kind: 'created'; cancellationOperationId: string }
  | { kind: 'raced'; operation: InventoryAccountingPostingOperation };

/**
 * The column names / constraint name Prisma reports on a P2002 for
 * `uq_inventory_accounting_posting_operations_key`
 * (organization_id, document_id, action, operation_key). The catch in
 * `requestAccountingPosting` must only treat THE operation-key unique as a
 * lost race; any other unique violation propagates.
 */
const OPERATION_KEY_UNIQUE_TARGETS = [
  'operationKey',
  'operation_key',
  'operations_key',
  'uq_inventory_accounting_posting_operations_key',
] as const;

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

/** What a caller asks for when cancelling a draft. */
export interface CancelAccountingPostingInput {
  operationKey?: string | undefined;
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
  /**
   * `final_posted` | `draft_created` | `draft_cancelled` | `refused` |
   * `failed`. `draft_cancelled` is the SUCCESS answer of the cancellation
   * command — a confirmed cancellation is never reported as `refused`.
   */
  outcome: InventoryPostingResult['outcome'] | 'draft_cancelled';
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
 *   PHASE 2 (the synchronous in-process call to Accounting, ADR-0041 §2):
 *     the call runs while the operation row is locked `FOR UPDATE`, so two
 *     calls for the SAME operation serialize and the second one replays
 *     through Accounting's committed ledger instead of racing it. The lock
 *     transaction writes nothing — Accounting still commits its own voucher
 *     in its own transactions, which is why OD-01's rule is untouched.
 *
 *   PHASE 3 (a second short Inventory transaction): record the answer on the
 *     operation row and project the resulting standing onto the document.
 *
 * The window between phases is exactly the documented recovery case: an
 * operation left non-terminal is retried under the SAME key, Accounting's own
 * idempotency ledger replays it, and no second voucher can appear. Nothing
 * here claims the two phases are one atomic step, because they are not.
 *
 * THE OD-06 DECISION PROCEDURE (one place, `answerExisting`)
 * ---------------------------------------------------------
 * A request whose (organization, document, action, operation key) already has
 * a durable operation is answered by THAT operation, never by fresh work:
 *
 *   1. a DURABLY ANSWERED operation (POSTED / REFUSED / CANCELLED, or
 *      DRAFT_CREATED — the draft IS the answer) replays its recorded answer,
 *      but only after rebuilding the canonical request the caller is making
 *      NOW and comparing hashes — the same key with a DIFFERENT request is a
 *      409, never a silent replay (mirrors Accounting's own `replayOrReject`);
 *   2. a NON-TERMINAL operation (REQUESTED / PENDING / FAILED) has no answer
 *      to replay, so the caller is RESUMING it, not making a new request: the
 *      request is the one frozen in PHASE 1, reconstructed from the operation
 *      + its IMMUTABLE snapshot (OD-05 — never from mutable current state,
 *      which cannot rewrite the historical Accounting intent), verified to
 *      hash to the stored request hash, and PHASE 2 is resumed through the
 *      contract (Accounting's ledger makes the resume a replay, not a second
 *      effect) before PHASE 3 converges the durable records.
 *
 * The same procedure runs for the RACE paths with one difference: there the
 * caller HAS built its own request (Phase 1 collected the facts under the
 * locks), so the comparison is the caller's own request hash against the
 * winner's stored hash — same hash resumes/replays, different hash is a 409.
 * The unique constraint on (organization, document, action, operation key)
 * stays the authority for the insert race: Phase 1 re-checks the key UNDER
 * the document row lock (the primary interception), and a unique violation
 * that still surfaces is caught, the winner reloaded and compared, and the
 * SAME decision procedure applied — the loser replays, recovers or gets the
 * 409, never a 500. While ANY non-terminal operation exists for the
 * document, a second operation under a different key is refused: one
 * document, one in-flight posting (the one exception: a DRAFT_CREATED
 * posting superseded by a terminal cancellation is history — its draft is
 * gone and the document is re-postable).
 *
 * CANCELLATION IS ITS OWN DURABLE OPERATION
 * -----------------------------------------
 * Cancelling the Accounting draft (C62-OD-02) is a separate business effect
 * from the posting that created the draft, so it has its own operation row:
 * action `accounting_post:cancel`, its own operation key, its own canonical
 * request hash (organization, document, action, and the posting operation
 * whose draft it cancels), its own actor, and its own state machine
 * (PENDING → CANCELLED / REFUSED). The POSTING operation is never moved to
 * CANCELLED: its DRAFT_CREATED row remains the durable evidence of the posting
 * attempt and the draft it produced. The document's `draft_cancelled` standing
 * is the projection of the cancellation. Three independently auditable facts:
 * posting operation → Accounting draft; cancellation operation → draft
 * cancelled; document → current projected state. Cancellation obeys the same
 * OD-06 rule (same key + same request replays/converges, a different request
 * is a 409) and the same crash-safe recovery: a PENDING cancellation resumes
 * through the contract (Accounting's ledger answers "already gone" without a
 * second delete), and a terminal one whose projection was interrupted
 * converges the projection without another Accounting effect.
 *
 * One deliberate consequence: PHASE 3 does NOT bump the document's
 * `updatedAt`. That column is the revision the canonical request hash freezes
 * (`sourceDocumentVersion`), so the posting's own projection must not look
 * like an edit — otherwise every retry of a completed operation would hash
 * differently and conflict with itself, which would break OD-06's replay
 * guarantee. The projection's own timestamps live on the operation row.
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
   *
   * The whole OD-06 decision procedure lives in `answerExisting`: a request
   * whose key already has a durable operation is answered by that operation —
   * replayed, recovered or refused with 409 — before any fresh work starts.
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
      return this.answerExisting(existing, input);
    }

    if (
      input.expectedDocumentRevision !== undefined &&
      input.expectedDocumentRevision !== this.revisionOf(current)
    ) {
      throw AppException.conflict(
        'The inventory document changed since it was read. Re-read it and retry the posting request.',
      );
    }

    let phase1: Phase1Result;
    try {
      phase1 = await this.writeDurableIntent(id, organizationId, operationKey);
    } catch (error) {
      // Lost the insert race on (organization, document, action, operation
      // key). The unique constraint is the authority, not an accident to
      // report: reload the winner and COMPARE REQUEST HASHES — same hash
      // replays/recovers, a different hash is a 409. The loser never becomes
      // an arbitrary 500. (The caller's own request was built inside Phase 1
      // and lost with the thrown method; in this microsecond window the
      // rebuilt current request IS the caller's own request.)
      if (
        isUniqueViolation(error) &&
        uniqueViolationTouches(error, OPERATION_KEY_UNIQUE_TARGETS)
      ) {
        const winner = await this.postings.findByKey({
          organizationId,
          documentId: id,
          action: ACCOUNTING_POST_ACTION,
          operationKey,
        });
        if (winner !== null) {
          const currentRequest = await this.buildCurrentRequest(
            id,
            organizationId,
            operationKey,
          );
          if (currentRequest.requestHash !== winner.requestHash) {
            throw AppException.conflict(
              'The operation key was already used for a different accounting posting request. An idempotency key identifies one intent: use a new key for a new operation.',
            );
          }
          return this.answerExisting(winner, input);
        }
      }
      throw error;
    }
    if (phase1.kind === 'raced') {
      // The in-lock re-check found a durable operation for this key after all
      // (the primary race interception — see `writeDurableIntent`).
      return this.answerExisting(phase1.operation, input);
    }

    // PHASE 2 — the one synchronous boundary call (ADR-0041 §2), serialized
    // per operation so a racing retry replays instead of conflicting.
    const result = await this.withOperationLock(
      organizationId,
      phase1.intent.operationId,
      () => this.posting.postFromInventory(phase1.intent.request),
    );
    // PHASE 3 — record what Accounting said.
    return this.applyOutcome(phase1.intent, result);
  }

  /**
   * PHASE 2's serialization: hold the operation row `FOR UPDATE` across the
   * boundary call.
   *
   * Two calls may legitimately reach the boundary for the SAME operation —
   * a fresh posting racing its own retry, or two concurrent retries of a
   * PENDING one. Accounting's own idempotency ledger replays the second call,
   * but only once the first call's ledger row is COMMITTED; the numbering
   * allocation on Accounting's fresh-create path commits BEFORE that row and
   * is keyed by the operation key with a per-call reference, so an
   * unserialized second call can be refused as "a different request" even
   * though it is the same one. Serializing on the operation row makes the
   * second call start after the first committed its ledger row, so it
   * replays: one operation, one effect, one answer. The lock is per
   * operation (different documents never contend) and is always released
   * before PHASE 3 takes the document row, so the lock order — document in
   * PHASE 1, operation in PHASE 2, document in PHASE 3, never nested —
   * cannot deadlock. The transaction writes nothing; it exists to hold the
   * lock, which is why OD-01's "no shared transaction" rule is untouched:
   * Accounting still commits its own effect in its own transactions.
   */
  private async withOperationLock<T>(
    organizationId: string,
    operationId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.documents.withTransaction(async (tx) => {
      const locked = await this.postings.lockOperationRow(
        tx,
        organizationId,
        operationId,
      );
      if (locked === null) {
        throw AppException.notFound(
          'Accounting posting operation',
          operationId,
        );
      }
      return work();
    });
  }

  /**
   * The OD-06 answer for a request whose key already has a durable
   * operation. This is the ONE place the replay-or-recover decision is made
   * for a request that did NOT build its own facts (the fast path and the
   * race backstop both land here), so it decides identically everywhere.
   */
  private async answerExisting(
    existing: InventoryAccountingPostingOperation,
    input: RequestAccountingPostingInput = {},
  ): Promise<AccountingPostingOutcomeDto> {
    if (
      input.expectedDocumentRevision !== undefined &&
      input.expectedDocumentRevision !== existing.documentVersion
    ) {
      throw AppException.conflict(
        'The inventory document changed since it was read. Re-read it and retry the posting request.',
      );
    }

    // 1. A DURABLY ANSWERED operation (POSTED / REFUSED / CANCELLED, or
    //    DRAFT_CREATED — the draft IS the answer) replays its recorded answer.
    //    The key identifies ONE canonical request, so rebuild the request the
    //    caller is making NOW and compare hashes BEFORE answering: the same
    //    key with a different request is a 409, never a silent replay of the
    //    old answer (mirrors `AccountingDocumentsService.replayOrReject`).
    //
    //    The rebuild reads current state WITHOUT the valuation locks: the
    //    decision it feeds is fail-safe in both directions — a torn read can
    //    only produce a spurious 409, and the caller retries once the
    //    concurrent writer has committed.
    if (
      isTerminalAccountingPostingState(existing.state) ||
      existing.state === 'DRAFT_CREATED'
    ) {
      const currentRequest = await this.buildCurrentRequest(
        existing.documentId,
        existing.organizationId,
        existing.operationKey,
      );
      if (currentRequest.requestHash !== existing.requestHash) {
        throw AppException.conflict(
          'The operation key was already used for a different accounting posting request. An idempotency key identifies one intent: use a new key for a new operation.',
        );
      }
      // A replay is answered from the durable record, but it is still an EVENT
      // in that record: without this the row would keep `replayed = false`
      // forever, which is false audit evidence (C62-OD-06).
      await this.postings.markReplayed(
        existing.organizationId,
        existing.id,
        this.actorFor(existing.organizationId).userId,
        new Date(),
      );
      return this.replayExisting(existing.organizationId, existing);
    }

    // 2. REQUESTED / PENDING / FAILED: the operation never durably answered,
    //    so there is no answer to replay — the caller is RESUMING it, not
    //    making a new request. The request is the one frozen in PHASE 1: the
    //    immutable snapshot is the authority (OD-05), and mutable current
    //    Inventory state cannot rewrite the historical Accounting intent.
    //    It is a recoverable state, not a refusal (OD-01's durable pending).
    return this.recoverExisting(existing);
  }

  /**
   * Rebuild the canonical request the caller is making NOW, from current
   * state, exactly as PHASE 1 builds the frozen one. Only the HASH is used
   * (the OD-06 comparison); a recovery never sends this request.
   */
  private async buildCurrentRequest(
    documentId: string,
    organizationId: string,
    operationKey: string,
  ): Promise<InventoryPostingRequest> {
    const document = await this.mustFind(documentId, organizationId);
    if (document.warehouseId === null) {
      throw AppException.businessRule(
        'Only an inventory document with a warehouse can be posted to Accounting.',
        {
          code: 'inventory.document.accounting_post_no_warehouse',
          documentId,
        },
      );
    }
    const movements = await this.ownedMovementsOf(document);
    const facts = await this.collectFacts(
      documentId,
      organizationId,
      movements,
    );
    const warehouse = await this.warehouses.findByIdInOrganization(
      organizationId,
      document.warehouseId,
    );
    if (warehouse === null) {
      throw AppException.businessRule(
        'The warehouse this inventory document was posted against cannot be resolved in this organization.',
        {
          code: 'inventory.document.accounting_post_warehouse_unresolved',
          documentId,
          warehouseId: document.warehouseId,
        },
      );
    }
    return this.buildRequest(
      {
        id: document.id,
        organizationId,
        kind: document.kind,
        number: document.number,
        businessDate: document.businessDate,
        warehouseId: document.warehouseId,
        valuationStale: document.valuationStale,
        updatedAt: document.updatedAt,
      },
      organizationId,
      operationKey,
      this.actorFor(organizationId),
      facts,
      warehouse.accountingPostingMode,
      warehouse.branchId,
    );
  }

  /**
   * Recover a non-terminal operation (OD-01's durable pending): resume the
   * crossing from the IMMUTABLE snapshot, through the same contract, and
   * record the answer. The snapshot — never mutable current state — is the
   * source of the request facts (OD-05); Accounting's own idempotency ledger
   * makes the resumed call a replay when the effect already exists, so a
   * crash between any two durable writes converges instead of duplicating.
   */
  private async recoverExisting(
    existing: InventoryAccountingPostingOperation,
  ): Promise<AccountingPostingOutcomeDto> {
    // The document's lifecycle must still be able to RECEIVE the projection:
    // `operational` (the normal recovery) or `accounting_posted` (the
    // projection already happened and only the operation row lagged). Any
    // other status means the document moved on in a way this slice has no
    // business overriding (cancelled, sealed, still a draft) — fail closed
    // and leave the operation PENDING as honest evidence.
    const current = await this.mustFind(
      existing.documentId,
      existing.organizationId,
    );
    if (
      current.status !== 'operational' &&
      current.status !== 'accounting_posted'
    ) {
      throw AppException.businessRule(
        'The inventory document moved on in its lifecycle after the accounting posting intent was recorded, so the pending posting operation cannot be completed.',
        {
          code: 'inventory.document.accounting_post_unrecoverable',
          documentId: existing.documentId,
          status: current.status,
        },
      );
    }
    const snapshot = await this.postings.findSnapshot(
      existing.organizationId,
      existing.id,
    );
    if (snapshot === null) {
      // Impossible for an operation this service wrote: the snapshot is
      // created in the SAME transaction as the operation. A missing one means
      // the durable record is corrupt, and a corrupt record is never resumed.
      throw new Error(
        `Accounting posting operation "${existing.id}" has no immutable snapshot and cannot be recovered.`,
      );
    }
    const request = this.reconstructRequest(existing, snapshot);
    if (request.requestHash !== existing.requestHash) {
      // The durable record does not reconstruct to its own frozen hash: the
      // operation must not be reused (OD-06).
      throw AppException.conflict(
        'The durable accounting posting operation does not match its immutable snapshot, so it cannot be recovered. An idempotency key identifies one intent: use a new key for a new operation.',
      );
    }

    // A FAILED (or REQUESTED) operation is retried by re-entering PENDING —
    // the state machine's only legal exit from FAILED — so the resumed
    // transition PENDING → terminal stays legal.
    if (existing.state === 'FAILED' || existing.state === 'REQUESTED') {
      const actor = this.actorFor(existing.organizationId);
      await this.postings.updateOperation(
        existing.organizationId,
        existing.id,
        {
          state: 'PENDING',
          updatedAt: new Date(),
          updatedBy: actor.userId,
        },
      );
    }

    // PHASE 2 resumed — with the SNAPSHOT's request (ADR-0041 §2), serialized
    // on the operation row exactly like a fresh PHASE 2. Accounting
    // reconciles it through its own ledger: if the effect already exists this
    // is a replay, if it does not this completes it. Either way there is at
    // most one effect. If a concurrent winner already completed the operation
    // while we waited on the lock, replay the winner's answer directly.
    const result = await this.withOperationLock(
      existing.organizationId,
      existing.id,
      async () => {
        const refreshed = await this.postings.findById(
          existing.organizationId,
          existing.id,
        );
        if (
          refreshed !== null &&
          (isTerminalAccountingPostingState(refreshed.state) ||
            refreshed.state === 'DRAFT_CREATED')
        ) {
          return null;
        }
        return this.posting.postFromInventory(request);
      },
    );
    if (result === null) {
      const completed = await this.postings.findById(
        existing.organizationId,
        existing.id,
      );
      return this.replayExisting(existing.organizationId, completed!);
    }
    // PHASE 3 — record what Accounting said (converges the operation row and
    // the document projection even when an earlier attempt wrote only one of
    // the two).
    return this.applyOutcome(
      {
        request,
        operationId: existing.id,
        initiatingActorUserId: existing.actorUserId,
      },
      result,
    );
  }

  /**
   * Reconstruct the contract request from the operation + its immutable
   * snapshot. The reconstruction is verified against `operation.requestHash`
   * by the caller before anything crosses the boundary.
   */
  private reconstructRequest(
    existing: InventoryAccountingPostingOperation,
    snapshot: InventoryAccountingPostingSnapshot,
  ): InventoryPostingRequest {
    const canonical = canonicalRequestFromSnapshot({
      operation: {
        organizationId: existing.organizationId,
        documentId: existing.documentId,
        action: existing.action,
        postingMode: existing.postingMode,
      },
      snapshot: {
        documentType: snapshot.documentType,
        documentNumber: snapshot.documentNumber,
        documentVersion: snapshot.documentVersion,
        documentDate: snapshot.documentDate,
        branchId: snapshot.branchId,
        warehouseId: snapshot.warehouseId,
        valuationState: snapshot.valuationState,
        valuationStale: snapshot.valuationStale,
        staleVerdict: snapshot.staleVerdict,
        valuationRunId: snapshot.valuationRunId,
        valuationBasis: snapshot.valuationBasis,
        movements: snapshot.movements,
      },
    });
    return {
      organizationId: existing.organizationId,
      branchId: snapshot.branchId,
      warehouseId: snapshot.warehouseId,
      sourceDocumentId: snapshot.documentId,
      // Carried through verbatim so Accounting refuses an unsupported type
      // with `accounting.source_type_unsupported`, exactly as a fresh request.
      sourceDocumentType:
        canonical.sourceDocumentType as InventoryPostingRequest['sourceDocumentType'],
      sourceDocumentNumber: snapshot.documentNumber,
      sourceDocumentDate: canonical.sourceDocumentDate,
      sourceDocumentVersion: snapshot.documentVersion,
      // Fail closed on an unknown stored mode: guessing one would post under
      // a policy nobody chose.
      postingMode: resolveWarehouseAccountingPostingMode(existing.postingMode),
      operationKey: existing.operationKey,
      requestHash: buildAccountingPostingRequestHash(canonical),
      actor: this.actorFor(existing.organizationId),
      movements: canonical.movements,
      valuation: canonical.valuation,
    };
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
   *
   * INDEPENDENT CANCELLATION IDENTITY (C62-OD-06 / Sections 3-8):
   * Cancelling the draft is an independent business action from the posting
   * that created it, so it has its OWN durable operation identity:
   * action `accounting_post:cancel`, its own operation key, its own canonical
   * request hash, its own actor and timestamps, and its own state machine
   * (`PENDING` -> `CANCELLED` / `REFUSED`).
   *
   * The POSTING operation is NEVER mutated to `CANCELLED`: its `DRAFT_CREATED`
   * state remains the historical evidence of the draft it produced.
   *
   * RECOVERY AND IDEMPOTENCY:
   *   * same cancellation key + same request -> replay/converge;
   *   * same cancellation key + different request -> 409 Conflict;
   *   * crash before Accounting call -> PENDING resumes and calls Accounting;
   *   * crash after Accounting deleted draft -> resumes, Accounting returns
   *     already-cancelled, converges document and cancellation operation;
   *   * crash after document updated -> converges cancellation operation;
   *   * crash after operation updated -> converges document projection;
   *   * cancellation retry -> replays without calling Accounting again.
   */
  async cancelAccountingPosting(
    id: string,
    organizationId: string,
    input: CancelAccountingPostingInput = {},
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

    // 1. Idempotency first (OD-06): check if a cancellation operation already exists
    // for this (organization, document, action=accounting_post:cancel, operationKey).
    const existing = await this.postings.findByKey({
      organizationId,
      documentId: id,
      action: CANCEL_ACTION,
      operationKey,
    });
    if (existing !== null) {
      return this.answerExistingCancellation(existing, current, input);
    }

    // 2. Pre-checks for fresh cancellation
    if (
      input.expectedDocumentRevision !== undefined &&
      input.expectedDocumentRevision !== this.revisionOf(current)
    ) {
      throw AppException.conflict(
        'The inventory document changed since it was read. Re-read it and retry the cancellation.',
      );
    }
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
    const postingOp = await this.postings.findById(
      organizationId,
      current.accountingPostingOperationId,
    );
    if (postingOp === null || postingOp.action !== ACCOUNTING_POST_ACTION) {
      throw AppException.businessRule(
        'The Accounting posting operation this document names no longer exists.',
        {
          code: 'inventory.document.accounting_post_operation_missing',
          documentId: id,
        },
      );
    }

    const mode = await this.modeFor(current);
    const cancellationRequest: AccountingPostingCancellationRequest = {
      organizationId,
      sourceDocumentId: id,
      action: CANCEL_ACTION,
      postingOperationKey: postingOp.operationKey,
      documentVersion: this.revisionOf(current),
    };
    const requestHash =
      buildAccountingPostingCancellationHash(cancellationRequest);
    const actor = this.actorFor(organizationId);

    // 3. PHASE 1: Write durable cancellation operation (PENDING) under document row lock
    let phase1: CancelPhase1Result;
    try {
      phase1 = await this.writeDurableCancellationIntent(
        id,
        organizationId,
        operationKey,
        cancellationRequest,
        requestHash,
        mode,
        postingOp,
        actor,
      );
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        uniqueViolationTouches(error, OPERATION_KEY_UNIQUE_TARGETS)
      ) {
        const winner = await this.postings.findByKey({
          organizationId,
          documentId: id,
          action: CANCEL_ACTION,
          operationKey,
        });
        if (winner !== null) {
          if (winner.requestHash !== requestHash) {
            throw AppException.conflict(
              'The cancellation operation key was already used for a different cancellation request.',
            );
          }
          return this.answerExistingCancellation(winner, current, input);
        }
      }
      throw error;
    }
    if (phase1.kind === 'raced') {
      if (phase1.operation.requestHash !== requestHash) {
        throw AppException.conflict(
          'The cancellation operation key was already used for a different cancellation request.',
        );
      }
      return this.answerExistingCancellation(phase1.operation, current, input);
    }

    // 4. PHASE 2: Call Accounting cancelInventoryDraft under cancellation operation lock
    const cancellationResult = await this.withOperationLock(
      organizationId,
      phase1.cancellationOperationId,
      () =>
        this.posting.cancelInventoryDraft({
          organizationId,
          operationKey: postingOp.operationKey,
          actor,
        }),
    );

    // 5. PHASE 3: Apply outcome
    return this.applyCancellationOutcome(
      id,
      organizationId,
      operationKey,
      phase1.cancellationOperationId,
      cancellationResult,
      mode,
      actor,
    );
  }

  private async writeDurableCancellationIntent(
    id: string,
    organizationId: string,
    operationKey: string,
    cancellationRequest: AccountingPostingCancellationRequest,
    requestHash: string,
    mode: WarehouseAccountingPostingMode,
    postingOp: InventoryAccountingPostingOperation,
    actor: InventoryPostingActor,
  ): Promise<CancelPhase1Result> {
    const now = new Date();
    let result: CancelPhase1Result | null = null;

    await this.documents.withTransaction(async (tx) => {
      const locked = await this.documents.lockDocumentRow(
        tx,
        organizationId,
        id,
      );
      if (locked === null) {
        throw AppException.notFound('Inventory document', id);
      }

      const raced = await this.postings.findByKey(
        {
          organizationId,
          documentId: id,
          action: CANCEL_ACTION,
          operationKey,
        },
        tx,
      );
      if (raced !== null) {
        result = { kind: 'raced', operation: raced };
        return;
      }

      if (locked.accountingPostingState !== 'draft_created') {
        throw AppException.businessRule(
          'Only a document whose Accounting posting created a draft can be cancelled.',
          {
            code: 'inventory.document.accounting_post_draft_required',
            documentId: id,
            accountingPostingState: locked.accountingPostingState,
          },
        );
      }

      const inFlight = await this.postings.findInFlightForDocument({
        organizationId,
        documentId: id,
      });
      if (inFlight !== null && inFlight.action === CANCEL_ACTION) {
        throw AppException.businessRule(
          'The document already has a cancellation operation in progress. Retry it under its own operation key.',
          {
            code: 'inventory.document.accounting_post_in_flight',
            documentId: id,
            operationKey: inFlight.operationKey,
            state: inFlight.state,
          },
        );
      }

      const created = await this.postings.createOperation(tx, {
        organizationId,
        documentId: id,
        action: CANCEL_ACTION,
        operationKey,
        requestHash,
        documentVersion: cancellationRequest.documentVersion,
        postingMode: mode,
        state: 'PENDING',
        accountingDocumentId: locked.accountingDocumentId,
        accountingDocumentNumber: locked.accountingDocumentNumber,
        accountingDocumentPhase: locked.accountingDocumentPhase,
        accountingOperationKey: postingOp.operationKey,
        actorUserId: actor.userId,
        actorPermission: actor.permission,
        now,
      });
      result = { kind: 'created', cancellationOperationId: created.id };
    });

    if (result === null) {
      throw new Error(
        `Cancellation intent for document "${id}" was not written.`,
      );
    }
    return result;
  }

  private async applyCancellationOutcome(
    documentId: string,
    organizationId: string,
    operationKey: string,
    cancellationOperationId: string,
    cancellationResult: InventoryPostingDraftCancellation,
    mode: WarehouseAccountingPostingMode,
    actor: InventoryPostingActor,
  ): Promise<AccountingPostingOutcomeDto> {
    const now = new Date();
    if (!cancellationResult.cancelled) {
      await this.postings.updateOperation(
        organizationId,
        cancellationOperationId,
        {
          state: 'REFUSED',
          refusalCode: cancellationResult.refusalCode,
          refusalReason: cancellationResult.refusalReason,
          glPosted: false,
          completedAt: now,
          updatedAt: now,
          updatedBy: actor.userId,
        },
      );
      const current = await this.mustFind(documentId, organizationId);
      return {
        documentId,
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
        refusalCode: cancellationResult.refusalCode,
        refusalReason: cancellationResult.refusalReason,
      };
    }

    await this.documents.withTransaction(async (tx) => {
      const locked = await this.documents.lockDocumentRow(
        tx,
        organizationId,
        documentId,
      );
      if (locked === null) {
        throw AppException.notFound('Inventory document', documentId);
      }
      await this.documents.updateHeader(tx, documentId, {
        accountingPostingState: 'draft_cancelled',
        accountingPostingOperationId: cancellationOperationId,
        updatedAt: locked.updatedAt,
        updatedBy: locked.updatedBy,
      });
    });

    await this.postings.updateOperation(
      organizationId,
      cancellationOperationId,
      {
        state: 'CANCELLED',
        glPosted: false,
        completedAt: now,
        updatedAt: now,
        updatedBy: actor.userId,
      },
    );

    const updated = await this.mustFind(documentId, organizationId);
    this.logger.log(
      'Inventory business document accounting draft cancelled',
      {
        documentId,
        organizationId,
        operationKey,
        accountingDocumentId: updated.accountingDocumentId,
        initiatedByUserId: actor.userId,
      },
      InventoryAccountingPostingService.name,
    );

    return this.cancellationAnswer(updated, operationKey, mode, false);
  }

  private async answerExistingCancellation(
    existing: InventoryAccountingPostingOperation,
    current: InventoryBusinessDocument,
    input: CancelAccountingPostingInput,
  ): Promise<AccountingPostingOutcomeDto> {
    if (
      input.expectedDocumentRevision !== undefined &&
      input.expectedDocumentRevision !== existing.documentVersion
    ) {
      throw AppException.conflict(
        'The inventory document changed since it was read. Re-read it and retry the cancellation.',
      );
    }

    if (current.accountingPostingState === 'draft_created') {
      if (
        this.revisionOf(current) !== existing.documentVersion ||
        (current.accountingDocumentId !== null &&
          existing.accountingDocumentId !== null &&
          current.accountingDocumentId !== existing.accountingDocumentId)
      ) {
        throw AppException.conflict(
          'The cancellation operation key was already used for a different cancellation request.',
        );
      }
    }

    const mode = this.normalizeMode(existing.postingMode);

    if (existing.state === 'CANCELLED') {
      if (current.accountingPostingState !== 'draft_cancelled') {
        await this.documents.withTransaction(async (tx) => {
          const locked = await this.documents.lockDocumentRow(
            tx,
            existing.organizationId,
            existing.documentId,
          );
          if (
            locked !== null &&
            locked.accountingPostingState !== 'draft_cancelled'
          ) {
            await this.documents.updateHeader(tx, existing.documentId, {
              accountingPostingState: 'draft_cancelled',
              accountingPostingOperationId: existing.id,
              updatedAt: locked.updatedAt,
              updatedBy: locked.updatedBy,
            });
          }
        });
      }
      await this.postings.markReplayed(
        existing.organizationId,
        existing.id,
        this.actorFor(existing.organizationId).userId,
        new Date(),
      );
      const updated = await this.mustFind(
        existing.documentId,
        existing.organizationId,
      );
      return this.cancellationAnswer(
        updated,
        existing.operationKey,
        mode,
        true,
      );
    }

    if (existing.state === 'REFUSED') {
      return {
        documentId: existing.documentId,
        organizationId: existing.organizationId,
        action: CANCEL_ACTION,
        operationKey: existing.operationKey,
        state: current.accountingPostingState,
        outcome: 'refused',
        postingMode: mode,
        replayed: true,
        accountingDocumentId: existing.accountingDocumentId,
        accountingDocumentNumber: existing.accountingDocumentNumber,
        accountingDocumentPhase: existing.accountingDocumentPhase,
        glPosted: false,
        refusalCode: existing.refusalCode,
        refusalReason: existing.refusalReason,
      };
    }

    return this.recoverCancellation(existing, current, mode);
  }

  private async recoverCancellation(
    existing: InventoryAccountingPostingOperation,
    current: InventoryBusinessDocument,
    mode: WarehouseAccountingPostingMode,
  ): Promise<AccountingPostingOutcomeDto> {
    const actor = this.actorFor(existing.organizationId);

    if (current.accountingPostingState === 'draft_cancelled') {
      await this.postings.updateOperation(
        existing.organizationId,
        existing.id,
        {
          state: 'CANCELLED',
          glPosted: false,
          completedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: actor.userId,
        },
      );
      return this.cancellationAnswer(
        current,
        existing.operationKey,
        mode,
        true,
      );
    }

    const postingOperationKey = existing.accountingOperationKey;
    if (!postingOperationKey) {
      throw new Error(
        `Cancellation operation "${existing.id}" names no posting operation key to cancel.`,
      );
    }

    const cancellationResult = await this.withOperationLock(
      existing.organizationId,
      existing.id,
      async () => {
        const refreshed = await this.postings.findById(
          existing.organizationId,
          existing.id,
        );
        if (refreshed !== null && refreshed.state === 'CANCELLED') {
          return null;
        }
        return this.posting.cancelInventoryDraft({
          organizationId: existing.organizationId,
          operationKey: postingOperationKey,
          actor,
        });
      },
    );

    if (cancellationResult === null) {
      const updated = await this.mustFind(
        existing.documentId,
        existing.organizationId,
      );
      return this.cancellationAnswer(
        updated,
        existing.operationKey,
        mode,
        true,
      );
    }

    return this.applyCancellationOutcome(
      existing.documentId,
      existing.organizationId,
      existing.operationKey,
      existing.id,
      cancellationResult,
      mode,
      actor,
    );
  }

  /**
   * The SUCCESS answer of a (converged or fresh) draft cancellation. A
   * confirmed cancellation is `draft_cancelled`, never `refused`.
   */
  private cancellationAnswer(
    document: InventoryBusinessDocument,
    operationKey: string,
    mode: WarehouseAccountingPostingMode,
    replayed: boolean,
  ): AccountingPostingOutcomeDto {
    return {
      documentId: document.id,
      organizationId: document.organizationId,
      action: CANCEL_ACTION,
      operationKey,
      state: 'draft_cancelled',
      outcome: 'draft_cancelled',
      postingMode: mode,
      replayed,
      accountingDocumentId: document.accountingDocumentId,
      accountingDocumentNumber: document.accountingDocumentNumber,
      accountingDocumentPhase: document.accountingDocumentPhase,
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
      // The outcome mirrors the operation's own durable state — including a
      // CANCELLED draft, which is a SUCCESS answer (`draft_cancelled`), never
      // a refusal. Only durably answered operations reach this mapping (a
      // non-terminal one is recovered instead).
      outcome:
        existing.state === 'POSTED'
          ? 'final_posted'
          : existing.state === 'DRAFT_CREATED'
            ? 'draft_created'
            : existing.state === 'CANCELLED'
              ? 'draft_cancelled'
              : existing.state === 'FAILED'
                ? 'failed'
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

  private actorFor(organizationId: string): InventoryPostingActor {
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
      organizationId,
    };
  }

  /**
   * PHASE 1. One Inventory transaction:
   *
   *   1. lock the document header row (serializes edits, cancels, seals and a
   *      second posting request);
   *   1b. re-check the operation key UNDER that lock: a request whose key
   *      already has a durable operation is answered by that operation —
   *      never by the lifecycle gates below and never by a doomed insert.
   *      This is the primary interception of the find-then-create race; the
   *      unique constraint's violation remains the backstop.
   *   2. lock the valuation-state rows of every key the document's movements
   *      touch, in the module's fixed ascending order — the same tier a
   *      Pricing Run or Reverse Pricing locks through;
   *   3. re-derive eligibility from a read taken AFTER the locks, so a
   *      valuation writer that had already committed is visible and any
   *      in-flight one is still blocked on the same locks;
   *   4. refuse ineligibility (nothing written);
   *   4b. refuse a SECOND operation while any non-terminal one exists for the
   *      document — under ANY key: two in-flight postings are two Accounting
   *      effects for one document;
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
  ): Promise<Phase1Result> {
    const now = new Date();
    const actor = this.actorFor(organizationId);
    let result: Phase1Result | null = null;

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

      // 1b. The in-lock idempotency re-check. Checked under the document row
      // lock after the caller's own request is built: a concurrent request
      // whose winner committed is compared against the winner's hash — same
      // hash replays/recovers, different hash is a 409.
      const raced = await this.postings.findByKey(
        {
          organizationId,
          documentId: id,
          action: ACCOUNTING_POST_ACTION,
          operationKey,
        },
        tx,
      );
      if (raced !== null) {
        if (raced.requestHash !== request.requestHash) {
          throw AppException.conflict(
            'The operation key was already used for a different accounting posting request. An idempotency key identifies one intent: use a new key for a new operation.',
          );
        }
        result = { kind: 'raced', operation: raced };
        return;
      }

      // 4b. One document, one in-flight posting. While ANY non-terminal
      // operation exists for this document, a second operation — under any
      // key — would be a second Accounting effect for the same document (a
      // second voucher, or a second draft next to the first). The same-key
      // retry never reaches this check: it is answered by the in-lock
      // re-check above. Checked under the document row lock, so it cannot
      // race a concurrent Phase 1.
      const inFlight = await this.postings.findInFlightForDocument({
        organizationId,
        documentId: id,
      });
      if (inFlight !== null) {
        const isCancelledDraft =
          inFlight.state === 'DRAFT_CREATED' &&
          locked.accountingPostingState === 'draft_cancelled';
        if (!isCancelledDraft) {
          throw AppException.businessRule(
            inFlight.state === 'DRAFT_CREATED'
              ? 'The document already has an Accounting draft. Cancel it (or let an accountant register it) before posting again.'
              : 'The document already has an accounting posting operation in progress. Retry it under its own operation key; a second operation would be a second Accounting effect.',
            {
              code: 'inventory.document.accounting_post_in_flight',
              documentId: id,
              operationKey: inFlight.operationKey,
              state: inFlight.state,
            },
          );
        }
      }

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
          documentDate: locked.businessDate,
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
      result = {
        kind: 'created',
        intent: {
          request,
          operationId: created.id,
          initiatingActorUserId: actor.userId,
        },
      };
    });

    if (result === null) {
      throw new Error(
        `The accounting posting intent for document "${id}" was not written.`,
      );
    }
    return result;
  }

  /**
   * The ledger movements this document's lines actually own, scoped to its
   * organization. The single fetch both PHASE 1 (under the valuation locks)
   * and the OD-06 hash rebuild (a read-only decision) are built on.
   */
  private async ownedMovementsOf(
    document: InventoryBusinessDocument,
  ): Promise<readonly InventoryMovement[]> {
    const movementIds = [
      ...new Set(
        document.lines.flatMap((line) =>
          [line.movementId, line.outMovementId, line.inMovementId].filter(
            (movementId): movementId is string => movementId !== null,
          ),
        ),
      ),
    ];
    const movements = await this.movements.findIds(movementIds);
    return movements.filter(
      (movement) => movement.organizationId === document.organizationId,
    );
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
    const movements = await this.ownedMovementsOf(document);
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
    const { timeZone } =
      await this.organizations.getDateTimeSettings(organizationId);
    const asOf = businessDateFromInstant(now, timeZone);
    const lockEntries = await Promise.all(
      keys.map(async (key) => ({
        key,
        method: (
          await this.valuation.resolveMethodForPosting({
            organizationId: key.organizationId,
            itemId: key.itemId,
            asOf,
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
      businessDate: BusinessDate;
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
      sourceDocumentDate: toAccountingPostingDateOnly(header.businessDate),
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
    intent: {
      request: InventoryPostingRequest;
      operationId: string;
      initiatingActorUserId?: string | null;
    },
    result: InventoryPostingResult,
  ): Promise<AccountingPostingOutcomeDto> {
    const { request } = intent;
    const now = new Date();
    const actorUserId = request.actor.userId;
    const initiatingUserId = intent.initiatingActorUserId ?? actorUserId;
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
        // The projection of the Accounting result is NOT a document edit. The
        // document's `updatedAt` is the revision the canonical request hash
        // freezes (`sourceDocumentVersion`), so the posting's own projection
        // must not look like one — otherwise every retry of a completed
        // operation would hash differently and conflict with itself, breaking
        // OD-06's replay guarantee. The projection's own timestamps live on
        // the operation row (`completedAt`/`updatedAt`), which IS bumped.
        updatedAt: locked.updatedAt,
        updatedBy: locked.updatedBy,
      };
      if (crossesLifecycle) {
        patch.status = 'accounting_posted';
        patch.accountingPostedAt = now;
        patch.accountingPostedBy = initiatingUserId;
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
