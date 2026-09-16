import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from '../../../kernel/events/domain-event-bus.js';
import { AppException } from '../../../kernel/errors/app-exception.js';
import { getPrincipal } from '../../../kernel/correlation/request-context.js';
import { JsonLogger } from '../../../kernel/logging/json-logger.service.js';
import { isUniqueViolation } from '../../../kernel/prisma/prisma-errors.js';
import { OrganizationsService } from '../../organization/application/organizations.service.js';
import { lifecycleProblemMessage } from '../../documents/domain/document-lifecycle.js';
import { AccountingDocumentsRepository } from '../data/accounting-documents.repository.js';
import { AccountingPostingOperationsRepository } from '../data/accounting-posting-operations.repository.js';
import { LedgerEntriesRepository } from '../data/ledger-entries.repository.js';
import { planVoucherFinalize } from '../domain/accounting-document.js';
import type { AccountingDocument } from '../domain/accounting-document.js';
import { ACCOUNTING_DOCUMENT_FINALIZED_EVENT } from '../domain/accounting.events.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import {
  checkPostingInput,
  toPostingInput,
  type PostingInput,
  type PostingResult,
} from '../domain/posting.js';
import {
  buildRequestHash,
  documentOperationRow,
  publishDocumentEvent,
  requireOperationKey,
} from './accounting-document-support.js';
import { PostingReadinessService } from './posting-readiness.service.js';

/**
 * Posting — the application-level orchestration seam (Task 10.8, contract
 * §15.5/§16.4/§19.2, ADR-0026).
 *
 * WHAT THIS IS
 *
 * ONE use case with ONE entry point: "post this voucher". It is the boundary
 * every caller reaches posting through, so no caller re-assembles the posting
 * sequence itself:
 *
 * ```
 * PostVoucherCommand { organizationId, voucherId, operationKey }
 *   │
 *   ├─ 1. resolve the voucher in the organization scope      (404, AC-I-01/16)
 *   ├─ 2. idempotency: replay | conflict | proceed           (§16.4, AC-I-12)
 *   ├─ 3. lifecycle verdict: `temporary → final`             (§15.1/§15.5)
 *   ├─ 4. ATOMIC posting persistence — Task 10.7's ONE transaction,
 *   │      unchanged and unwrapped: locks in the module's fixed order,
 *   │      in-transaction re-validation, state=final, N immutable
 *   │      LedgerEntries (one per stored line), the operation row LAST
 *   ├─ 5. publish `AccountingDocument.Finalized`             (§21, AC-D-20)
 *   ├─ 6. readiness verdict on the FINAL voucher             (Task 10.5)
 *   └─ 7. result: PostingInput + PostingResult built from the
 *          STORED rows through the Task 10.6 contract
 *   ▼
 * PostingOutcome { kind, document, input, result }
 * ```
 *
 * WHAT THIS IS NOT (the task's boundary, and the contract's §1.2/§28.2)
 *
 * This is NOT a Posting Engine. There is no posting-rules engine, no automatic
 * account mapping, no control-role resolution, no account selection, no
 * dimension handling, no balance/trial-balance/report/closing/reopening/
 * reversal/correction behavior, no source-module integration, no outbox, no
 * queue, no worker, no endpoint, no permission and no event of its own. Those
 * are later tasks and several are OQ-gated (OQ-39…OQ-43 stay open).
 *
 * THE ATOMIC MODEL IS THE ACCEPTED ONE (§15.5 AC-D-23, Task 10.6/10.7)
 *
 * Finalization IS posting: `final` = posted, there is no separate `posted`
 * state and no Posting entity. Therefore the "atomic posting persistence" of
 * step 4 is `AccountingDocumentsRepository.finalizeChecked` — the Task 10.7
 * transaction — and this seam opens NO transaction of its own around it. A
 * second boundary here would either widen the lock scope or split the effect
 * from its evidence; both are forbidden (§16.4 atomicity, AC-04). The lock
 * order stays exactly as `data/accounting-locks.ts` documents it (area → year
 * → period → accounts `FOR SHARE` → document `FOR UPDATE`), because this seam
 * takes no lock at all — it delegates.
 *
 * IDEMPOTENCY IS THE EXISTING LEDGER, VERBATIM (§16.4, AC-I-12)
 *
 * The only identity is `(organization_id, operation_key)` plus `request_hash`,
 * on the existing `document_finalize` kind. Same key + same hash ⇒ replay the
 * stored result by RE-READING current rows; same key + different hash (or a
 * different kind) ⇒ 409 and nothing is applied. No second mechanism exists
 * here: no `ledger-post-${voucherId}` key, no `PostingResult.id`, and
 * `accounting_posting_operations.id` remains evidence identity only — the
 * ledger entries carry their own ULIDs (Task 10.6 correction).
 *
 * WHERE EACH RULE LIVES (the seam is thin on purpose)
 *
 * - the DOMAIN decides: lifecycle (`planVoucherFinalize`), the posting input
 *   preconditions (`toPostingInput`), the entry invariants and the balance
 *   (`toLedgerEntries`, re-asserted inside the transaction), readiness
 *   (`domain/posting-readiness.ts`);
 * - the REPOSITORY guards inside ONE transaction and materializes the entries
 *   (Task 10.7) — nothing here re-implements or re-orders any of it;
 * - the CALLING use case authorizes and maps errors onto the API model. Like
 *   `PostingReadinessService` and the `requireUsable*` resolvers, this seam
 *   carries NO permission of its own: AR-21 binds endpoints and there is none
 *   here, and §16.5 leaves a future system posting's authority (and, with
 *   OQ-39, its delivery) undecided — so the HTTP error model is deliberately
 *   NOT baked into the posting act. `AccountingDocumentsService.finalizeDocument`
 *   authorizes `Accounting.Document.Finalize` and maps the repository's guard
 *   errors with the module's one decision table (`mapDocumentGuardError`).
 *
 * WHAT THIS SEAM ADDS OF ITS OWN (and why it is not a business rule)
 *
 * Two verifications of the persistence result, both evaluated from STORED rows
 * rather than from what the transaction intended to write:
 *
 * 1. the Task 10.5 readiness verdict on the final voucher — a `PostingResult`
 *    is never produced for a voucher the readiness contract does not consider
 *    consumable. The verdict is consulted through `PostingReadinessService`,
 *    never re-implemented, and it means one thing on each path: on a REPLAY it
 *    is a refusal (422 with the machine-readable reasons — this request
 *    mutated nothing, so refusing is truthful); on a FRESH posting it is an
 *    assertion (the transaction re-validated every one of those dimensions
 *    under the module's locks moments earlier and a `ready` verdict on a final
 *    voucher is stable, so a failure means the stored books contradict the
 *    module's own guarantee — reported loudly as an internal error, because
 *    the posting DID commit and a 4xx would claim the opposite);
 * 2. the ledger snapshot integrity (`assertPostedLedger`): exactly one entry
 *    per voucher line, each entry naming its own line, and every sourcing
 *    column equal to the voucher's (AC-07/AC-08 of Task 10.8, contract
 *    §12.5/§19.2, AC-I-14/22).
 *
 * Neither is a rule about accounting policy; both are the seam refusing to
 * report a book fact it cannot prove. Everything else is delegation.
 */
@Injectable()
export class PostingService {
  constructor(
    private readonly documents: AccountingDocumentsRepository,
    private readonly operations: AccountingPostingOperationsRepository,
    private readonly ledgerEntries: LedgerEntriesRepository,
    private readonly readiness: PostingReadinessService,
    private readonly organizations: OrganizationsService,
    private readonly logger: JsonLogger,
    @Inject(DOMAIN_EVENT_BUS) private readonly events: DomainEventBus,
  ) {}

  /**
   * Post one voucher: the single act that makes it part of the books (§15.5,
   * AC-D-23) and the single place a caller asks for it.
   *
   * Idempotent on `(organizationId, operationKey)` + the canonical
   * `document_finalize` hash of `{ documentId }` — the finalization intent is
   * exactly the voucher it names, and no server-resolved value enters the hash
   * (§16.4, ADR-0022 §4), so a retry replays instead of conflicting with
   * itself.
   */
  async postVoucher(command: PostVoucherCommand): Promise<PostingOutcome> {
    // -- step 1: resolve, in scope, before the ledger is consulted ----------
    const operationKey = requireOperationKey(command.operationKey);
    // The voucher must exist in THIS organization before anything else: a
    // foreign id is indistinguishable from a missing one (AC-I-01/16), and the
    // idempotency ledger is consulted only for a voucher the caller may see.
    const voucher = await this.mustFindInOrganization(
      command.organizationId,
      command.voucherId,
    );
    const requestHash = buildRequestHash('document_finalize', {
      documentId: voucher.id,
    });

    // -- step 2: replay BEFORE the lifecycle verdict ------------------------
    // A retried posting meets an already-final voucher, which must return the
    // recorded result instead of being reported as an illegal transition
    // (§16.4, ADR-0022 §3).
    const replayed = await this.replayOrReject(
      voucher.organizationId,
      operationKey,
      requestHash,
    );
    if (replayed !== null) return replayed;

    // -- step 3: the lifecycle decision table, never a second state machine --
    const plan = planVoucherFinalize(voucher.phase);
    if (plan.problem !== null) {
      throw AppException.businessRule(lifecycleProblemMessage(plan.problem), {
        problem: plan.problem,
      });
    }

    // -- step 4: the ONE atomic posting transaction (Task 10.7, unwrapped) ---
    const now = new Date();
    const actorId = getPrincipal()?.userId ?? null;
    let posted: AccountingDocument;
    try {
      posted = await this.documents.finalizeChecked({
        id: voucher.id,
        organizationId: voucher.organizationId,
        ledger: documentOperationRow({
          organizationId: voucher.organizationId,
          operationKey,
          operation: 'document_finalize',
          requestHash,
          documentId: voucher.id,
          actorId,
          now,
        }),
        finalizedAt: now,
        finalizedBy: actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Lost a race on the ledger key: the winner's row decides, so re-run
        // the SAME replay-or-reject. Anything else (a phase that moved, a
        // closed scope, a rejected line set, a colliding `voucher_line_id`)
        // propagates as the data layer's own error: the transaction rolled
        // everything back, and the calling use case maps it onto the API model.
        const raced = await this.replayOrReject(
          voucher.organizationId,
          operationKey,
          requestHash,
        );
        if (raced !== null) return raced;
      }
      throw error;
    }

    // -- step 5: the posting evidence event (§21). `Finalized` IS the posting
    // event: `final` = posted (AC-D-20), so no `Posted` event is invented.
    await publishDocumentEvent(
      this.events,
      ACCOUNTING_DOCUMENT_FINALIZED_EVENT,
      posted,
    );
    // The log vocabulary is the one the finalization already used (only the
    // context moves to this seam): an operator's existing filter keeps working.
    this.logger.log(
      'Accounting document finalized',
      {
        documentId: posted.id,
        organizationId: posted.organizationId,
        documentNumber: posted.documentNumber,
      },
      PostingService.name,
    );

    // -- steps 6+7: verify from stored rows, then report --------------------
    // The transaction has just re-validated every readiness dimension under
    // the module's locks, so a `not_ready` verdict here is not a business
    // outcome — it means the stored books contradict the module's own
    // guarantee. It is asserted loudly, not reported as a refusal: the posting
    // DID commit, and a 4xx would tell the caller the opposite.
    await this.assertReady(posted);
    return this.toOutcome(posted, operationKey, requestHash, 'posted');
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Scoped by-id resolution (ADR-0021 §4, AC-I-01/16): a voucher in another
   * organization is reported as NOT FOUND, so the boundary cannot be crossed
   * by guessing an id. The deployment pin (ADR-0025) is enforced here too, so
   * a direct service caller is bounded exactly like an HTTP caller.
   */
  private async mustFindInOrganization(
    organizationId: string,
    voucherId: string,
  ): Promise<AccountingDocument> {
    this.organizations.assertOrganizationInScope(organizationId);
    const document = await this.documents.findById(voucherId);
    if (document === null || document.organizationId !== organizationId) {
      throw AppException.notFound('AccountingDocument', voucherId);
    }
    return document;
  }

  /**
   * The §16.4 replay-or-reject decision for the `document_finalize` kind — the
   * module's ONE idempotency rule, applied to the posting operation.
   *
   * @returns the replayed outcome, or `null` when no row exists for this key
   *   (the caller then performs the posting).
   * @throws AppException 409 when the key already carries a different intent:
   *   an idempotency key identifies ONE operation, so a reuse for another
   *   voucher (a different hash) or another kind is refused and NOTHING is
   *   applied — no state change, no ledger entry, no second evidence row.
   */
  private async replayOrReject(
    organizationId: string,
    operationKey: string,
    requestHash: string,
  ): Promise<PostingOutcome | null> {
    const existing = await this.operations.findByKey(
      organizationId,
      operationKey,
    );
    if (existing === null) return null;
    if (
      existing.operation !== 'document_finalize' ||
      existing.requestHash !== requestHash
    ) {
      throw AppException.conflict(
        `The operationKey was already used for "${existing.operation}". An idempotency key identifies one intent: use a new key for a new operation.`,
      );
    }
    const document = await this.documents.findById(existing.result.documentId);
    if (document === null) {
      // Impossible: ledger rows are append-only and a pre-final deletion keeps
      // them; a missing document would mean the evidence points nowhere.
      throw new Error(
        `Replay of accounting operation "${existing.id}" points at a missing accounting document.`,
      );
    }
    // A replay re-reads CURRENT rows (§16.4), so the readiness verdict is
    // re-evaluated on the stored voucher: the seam will not hand back a
    // posting result for a voucher the Task 10.5 contract no longer considers
    // consumable. Nothing is mutated on this path, so the refusal is a 422.
    await this.requireReady(document);
    return this.toOutcome(document, operationKey, requestHash, 'replayed');
  }

  /**
   * The Task 10.5 verdict as a POSTING refusal (replay path only): a stored
   * final voucher that is no longer consumable is a business outcome the
   * caller can act on, and this request mutated nothing.
   */
  private async requireReady(document: AccountingDocument): Promise<void> {
    const verdict = await this.readiness.evaluateReadiness(
      document.organizationId,
      document.id,
    );
    if (verdict.status !== 'ready') {
      throw AppException.businessRule(
        'The voucher is not posting-ready, so its stored posting cannot be replayed (contract §15.5/§19.3).',
        { problem: 'posting_not_ready', reasons: verdict.reasons },
      );
    }
  }

  /**
   * The same verdict as an ASSERTION (fresh path): the Task 10.7 transaction
   * re-validated every readiness dimension under the area/year/period/account/
   * document locks moments earlier, and a `ready` verdict on a final voucher
   * is stable (Task 10.5), so this cannot legitimately fire.
   */
  private async assertReady(document: AccountingDocument): Promise<void> {
    const verdict = await this.readiness.evaluateReadiness(
      document.organizationId,
      document.id,
    );
    if (verdict.status !== 'ready') {
      throw new Error(
        `Posting of accounting document "${document.id}" committed but the result is not posting-ready (${verdict.reasons
          .map((reason) => reason.problem)
          .join(', ')}).`,
      );
    }
  }

  /**
   * Assemble the result from STORED rows through the Task 10.6 contract — the
   * seam reports what the books contain, never what it asked the transaction
   * to write.
   *
   * `toPostingInput` enforces the posting preconditions (final, numbered,
   * evidenced) and `checkPostingInput` re-asserts the whole input contract;
   * the entries are then read back through the insert-only ledger repository
   * and checked against the voucher (1:1 per line, sourcing snapshot equal).
   *
   * `toPostingResult` is deliberately NOT used: it GENERATES entries (fresh
   * ULIDs) as the pure contract transform, and re-deriving identities for
   * evidence that is already persisted would invent a second identity for the
   * same rows. The `PostingResult` shape is assembled from the stored entries.
   */
  private async toOutcome(
    document: AccountingDocument,
    operationKey: string,
    requestHash: string,
    kind: PostingOutcomeKind,
  ): Promise<PostingOutcome> {
    const input = toPostingInput({ document, operationKey, requestHash });
    const problems = checkPostingInput(input);
    if (problems.length > 0) {
      // A final voucher that broke the posting input contract would mean the
      // finalization transaction let an illegal aggregate through: fail loudly
      // (the repository's posture), never repair and never post anyway.
      throw new Error(
        `Stored accounting document "${document.id}" cannot be represented as a posting input (${problems.join(', ')}).`,
      );
    }
    const entries = await this.ledgerEntries.findByVoucher(
      document.organizationId,
      document.id,
    );
    assertPostedLedger(document, entries);
    const result: PostingResult = {
      organizationId: input.organizationId,
      financialAreaId: input.financialAreaId,
      voucherId: input.voucherId,
      voucherNumber: input.voucherNumber,
      operationKey: input.operationKey,
      requestHash: input.requestHash,
      postedAt: new Date(input.finalizedAt.getTime()),
      ledgerEntries: entries,
    };
    return { kind, document, input, result };
  }
}

// ---- module-level helpers --------------------------------------------------

export interface PostVoucherCommand {
  /** Always required: posting is never cross-organization (AC-I-01). */
  organizationId: string;
  /** The voucher to post. */
  voucherId: string;
  /** Required: posting is an effect-creating operation (§16.4, AC-I-12). */
  operationKey: string;
}

/** Whether this call performed the posting or replayed a stored one (§16.4). */
export type PostingOutcomeKind = 'posted' | 'replayed';

export interface PostingOutcome {
  /** `posted` = this call ran the atomic transaction; `replayed` = it did not. */
  kind: PostingOutcomeKind;
  /** The final voucher (the aggregate the caller authorized and asked about). */
  document: AccountingDocument;
  /** The Task 10.6 posting input snapshot the result was built from. */
  input: PostingInput;
  /**
   * The Task 10.6 posting result, carrying the STORED ledger entries. It has
   * no `id`: a posting is not a persisted entity, and
   * `accounting_posting_operations.id` is evidence identity only.
   */
  result: PostingResult;
}

/**
 * Prove the persistence result from the STORED rows: one entry per voucher
 * line, each naming its own line, and every sourcing column equal to the
 * voucher's (contract §12.5/§19.2, AC-I-14/22; Task 10.8 AC-07/AC-08).
 *
 * This is an integrity assertion about what the atomic transaction persisted,
 * not an accounting rule — the rules live in `domain/` and were already
 * applied inside the transaction (`toLedgerEntries` re-asserts every entry
 * invariant and the balance under the document lock). It exists so the seam
 * cannot report a posting whose stored evidence does not match the voucher,
 * and so a future change to the materialization cannot silently break the 1:1
 * traceability the ledger is built on. Amounts are compared as the exact
 * decimal strings they are stored as: nothing here parses them as numbers
 * (§13.1/§13.5, AR-12).
 */
export function assertPostedLedger(
  document: AccountingDocument,
  entries: readonly LedgerEntry[],
): void {
  const lines = [...document.lines].sort(
    (left, right) => left.lineNo - right.lineNo,
  );
  if (entries.length !== lines.length) {
    throw new Error(
      `Posting of accounting document "${document.id}" materialized ${entries.length} ledger entries for ${lines.length} voucher lines: exactly one line maps to one entry (contract §12.5/§19.2).`,
    );
  }
  const byLineId = new Map(
    entries.map((entry) => [entry.voucherLineId, entry]),
  );
  if (byLineId.size !== entries.length) {
    throw new Error(
      `Posting of accounting document "${document.id}" materialized two ledger entries for one voucher line (contract §12.5: 1 → 1).`,
    );
  }
  if (document.finalizedAt === null) {
    // Unreachable: `toPostingInput` refuses a final voucher without its
    // finalization evidence, and the caller builds the input first.
    throw new Error(
      `Accounting document "${document.id}" is final without finalizedAt evidence (§15.5).`,
    );
  }
  for (const line of lines) {
    const entry = byLineId.get(line.id);
    if (entry === undefined) {
      throw new Error(
        `Voucher line "${line.id}" of accounting document "${document.id}" has no ledger entry (contract §12.5: 1 → 1).`,
      );
    }
    if (entry.voucherId !== document.id) {
      throw new Error(
        `Ledger entry "${entry.id}" names voucher "${entry.voucherId}", not the voucher "${document.id}" that produced it.`,
      );
    }
    // The sourcing snapshot must equal the voucher's, column for column: an
    // entry stays traceable without re-reading mutable state (AC-D-35,
    // AC-I-14/22). Amounts are compared as the exact decimal strings they are
    // stored as — never parsed as numbers (§13.1/§13.5).
    const scopeMatches =
      entry.organizationId === document.organizationId &&
      entry.financialAreaId === document.financialAreaId &&
      entry.fiscalYearId === document.fiscalYearId &&
      entry.accountingPeriodId === document.accountingPeriodId &&
      entry.voucherNumber === document.documentNumber &&
      entry.branchId === document.branchId;
    const lineMatches =
      entry.lineNo === line.lineNo &&
      entry.accountId === line.accountId &&
      entry.debitAmount === line.debitAmount &&
      entry.creditAmount === line.creditAmount &&
      entry.description === line.description;
    const evidenceMatches =
      entry.documentDate.getTime() === document.documentDate.getTime() &&
      entry.postingTimestamp.getTime() === document.finalizedAt.getTime() &&
      entry.finalizedBy === document.finalizedBy &&
      entry.correlationId === document.correlationId &&
      entry.origin === document.origin &&
      sameSource(entry.source, document.source);
    if (!scopeMatches || !lineMatches || !evidenceMatches) {
      throw new Error(
        `Ledger entry "${entry.id}" does not carry the sourcing snapshot of voucher "${document.id}" line ${line.lineNo} (AC-D-35, AC-I-14/22).`,
      );
    }
  }
}

/** The logical source identity (§16.3): both null, or all four fields equal. */
function sameSource(
  entry: LedgerEntry['source'],
  document: AccountingDocument['source'],
): boolean {
  if (entry === null || document === null) return entry === document;
  return (
    entry.module === document.module &&
    entry.entityType === document.entityType &&
    entry.entityId === document.entityId &&
    entry.operation === document.operation
  );
}
