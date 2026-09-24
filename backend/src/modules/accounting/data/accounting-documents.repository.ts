import { Injectable } from '@nestjs/common';
import { generateId } from '../../../kernel/ids/ulid.js';
import { PrismaService } from '../../../kernel/prisma/prisma.service.js';
import type {
  AccountingDocument,
  AccountingDocumentOrigin,
  AccountingDocumentPhase,
  AccountingDocumentSource,
} from '../domain/accounting-document.js';
import {
  isAccountingDocumentOrigin,
  isAccountingDocumentPhase,
} from '../domain/accounting-document.js';
import type { LedgerEntry } from '../domain/ledger-entry.js';
import { canonicalizeAmount } from '../domain/money.js';
import { toLedgerEntries, toPostingInput } from '../domain/posting.js';
import { checkVoucherLines } from '../domain/voucher-lines.js';
import type { AccountingDocumentLineInput } from '../domain/voucher-lines.js';
import {
  AccountingDocumentAccountRejectedError,
  AccountingDocumentAreaImmutableError,
  AccountingDocumentDateUnresolvableError,
  AccountingDocumentFinalProtectedError,
  AccountingDocumentLineRejectedError,
  AccountingDocumentMissingError,
  AccountingDocumentPhaseConflictError,
  AccountingDocumentScopeRejectedError,
  AccountingDocumentStaleError,
  AccountingDocumentAlreadyReversedError,
} from './accounting-document-errors.js';
import { insertOperationRow } from './accounting-posting-operations.repository.js';
import { insertLedgerEntries } from './ledger-entries.repository.js';
import { markConfigurationsUsedByDocumentInTx } from './accounting-configuration-usage.js';
import { applyBalanceProjectionDeltasWithLocksHeldInTx } from './account-balance-projections.repository.js';
import {
  lockAccountRowForShare,
  lockAccountingDocumentRow,
  lockAccountingPeriodRow,
  lockBalanceProjectionRows,
  lockFinancialAreaRow,
  lockFiscalYearRow,
} from './accounting-locks.js';
import {
  CORRECTION_KIND_REVERSAL,
  invertDocumentLines,
  isAccountingCorrectionKind,
} from '../domain/document-reversal.js';

import type {
  LockedAccountingDocument,
  LockedAccountingPeriod,
  LockedFiscalYear,
} from './accounting-locks.js';

import type {
  AccountingDocumentLineCreate,
  AccountingDocumentLineRow,
  AccountingDocumentRow,
  AccountingDocumentWithLinesRow,
  AccountingDocumentWhere,
  AccountingPostingOperationCreate,
  AccountingTransactionalClient,
  AccountingTxClient,
  LedgerEntryCreate,
  OrderBy,
} from './accounting-rows.js';

/**
 * Data access for `accounting.accounting_documents` + `…_document_lines`
 * (Task 10.4, contract §12/§13/§15/§18; Task 12 projection maintenance).
 *
 * Every WRITE owns ONE transaction with the module's fixed lock order —
 * financial area → fiscal year → accounting period → referenced accounts
 * (ascending by id, `FOR SHARE`) → account_balance_projections (ascending
 * projection-key, `FOR UPDATE`, Task 12 only) → the document row — and
 * re-evaluates its guard against the LOCKED rows (AR-11,
 * docs/database-strategy.md §13). `finalizeChecked` is the ONLY path that
 * takes the projection tail; `createChecked`/`updateChecked`/`issueChecked`/
 * `deleteChecked` keep the four-step `area→year→period→accounts→document`
 * order (see `accounting-locks.ts` Task 12 tail and
 * `docs/accounting/lock-order-matrix.md` R1…R8):
 *
 * - the AREA lock is what a concurrent year/period/area write serializes on,
 *   so the calendar a voucher resolves against cannot change under it;
 * - the YEAR and PERIOD row locks make the §7.2 status gate race-safe: a
 *   concurrent close/seal either commits first (and is observed) or waits
 *   until the document transaction ends. Task 14 evaluates that gate
 *   IMMEDIATELY after those locks (fail closed, before the freeze marker and
 *   before any account/projection lock or write — see `finalizeChecked`), so
 *   a locked period refuses the whole finalization instead of merely rolling
 *   it back at the end;
 * - the ACCOUNT `FOR SHARE` locks make AC-I-09 (postable + active) hold
 *   against a concurrent postability flip or deactivation, and interlock with
 *   the account guard's `FOR UPDATE` that counts line references (AC-I-11);
 * - the DOCUMENT row lock makes the phase guard race-safe: two concurrent
 *   edits/issuances/finalizations/deletions of one voucher serialize, and the
 *   loser re-evaluates against the winner's committed row.
 *
 * The order is never reversed — a document row is always locked LAST, and no
 * calendar/account write ever waits for a document row — so no deadlock cycle
 * exists (`accounting-locks.ts`). `finalizeChecked` must therefore READ the
 * stored scope (unlocked) to learn which calendar rows to lock, and then verify
 * under the document lock that the locked scope is still the stored one; a
 * concurrent re-dating is a `Stale` conflict, never a silent write into a
 * calendar that was not validated.
 *
 * The pure domain checks (`domain/voucher-lines.ts`,
 * `domain/accounting-document.ts`) are imported here for the in-transaction
 * evaluation, exactly as the calendar/account repositories import theirs: the
 * composition path applies them for fast feedback AND again under the lock,
 * from one decision table.
 *
 * Final is protected STRUCTURALLY, not by validation alone (§15.2): no method
 * of this repository can write a `final` row — `updateChecked`, `issueChecked`
 * and `deleteChecked` all re-check the phase under the row lock, and
 * `finalizeChecked` is the single writer of `state = 'final'`.
 */

type Client = {
  accountingDocument: {
    findUnique(args: {
      where: { id: string };
    }): Promise<AccountingDocumentRow | null>;
    findMany(args: {
      where: AccountingDocumentWhere;
      orderBy: OrderBy;
      skip: number;
      take: number;
      include: { lines: true };
    }): Promise<AccountingDocumentWithLinesRow[]>;
    count(args: { where: AccountingDocumentWhere }): Promise<number>;
  };
};

export interface AccountingDocumentListFilter {
  /** Always set by the service: a list is never cross-organization (AC-I-01). */
  organizationId: string;
  financialAreaId?: string | undefined;
  fiscalYearId?: string | undefined;
  accountingPeriodId?: string | undefined;
  state?: string | undefined;
  origin?: string | undefined;
  branchId?: string | undefined;
  documentNumber?: string | undefined;
  /** Inclusive business-date bounds (`DATE` semantics, §12.3). */
  dateFrom?: Date | undefined;
  dateTo?: Date | undefined;
  search?: string | undefined;
}

/** Input line as the repository writes it (ids and `lineNo` already assigned). */
export interface AccountingDocumentLineWrite extends AccountingDocumentLineInput {
  id: string;
}

/**
 * The idempotency row a write must persist IN ITS OWN transaction (§16.4).
 * Passed as a whole `create` payload because the repository only inserts it —
 * the service owns the key, the hash and the operation kind.
 */
export type DocumentOperationRow = AccountingPostingOperationCreate;

export interface CreateAccountingDocumentInput {
  id: string;
  organizationId: string;
  financialAreaId: string;
  documentDate: Date;
  description: string;
  /** `draft` (no number) or `temporary` (issued at creation, §15.1). */
  state: AccountingDocumentPhase;
  origin: AccountingDocumentOrigin;
  branchId: string | null;
  source: AccountingDocumentSource | null;
  /** The serial the Foundation allocated, or `null` for a draft. */
  documentNumber: string | null;
  correlationId: string | null;
  /** System-origin evidence mirrored onto the header (§12.2, §16.4). */
  idempotencyReference: string | null;
  requestHash: string | null;
  lines: readonly AccountingDocumentLineWrite[];
  /** Written LAST in this transaction (§16.4). */
  ledger: DocumentOperationRow | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface UpdateAccountingDocumentInput {
  id: string;
  organizationId: string;
  /** The target scope — resolved from this area + date by the repository. */
  financialAreaId: string;
  documentDate: Date;
  description: string;
  branchId: string | null;
  lines: readonly AccountingDocumentLineWrite[];
  updatedAt: Date;
  updatedBy: string | null;
}

export interface IssueAccountingDocumentInput {
  id: string;
  organizationId: string;
  /** The serial the Document Foundation allocated for this issuance (§18). */
  documentNumber: string;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface FinalizeAccountingDocumentInput {
  id: string;
  organizationId: string;
  /** The idempotency row for this finalization (§16.4, §15.5 step 5). */
  ledger: DocumentOperationRow;
  finalizedAt: Date;
  finalizedBy: string | null;
}

export interface DeleteAccountingDocumentInput {
  id: string;
  organizationId: string;
}

/** Task 15 — reverse a Final voucher by creating a new Final counter-document. */
export interface ReverseAccountingDocumentInput {
  originalDocumentId: string;
  organizationId: string;
  reversalId: string;
  documentNumber: string;
  documentDate: Date;
  description: string;
  reason: string;
  ledger: DocumentOperationRow;
  finalizedAt: Date;
  finalizedBy: string | null;
  correlationId: string | null;
  createdBy: string | null;
}

@Injectable()
export class AccountingDocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private client(): Promise<Client> {
    return this.prisma.getClient<Client>();
  }

  private transacting(): Promise<AccountingTransactionalClient> {
    return this.prisma.getClient<AccountingTransactionalClient>();
  }

  // ---- reads --------------------------------------------------------------

  /**
   * By-id read of the WHOLE aggregate: a document without its lines is not a
   * document (the header only carries the narration), so no caller ever gets a
   * line-less shape it could mistake for complete.
   */
  async findById(id: string): Promise<AccountingDocument | null> {
    const { accountingDocument } = await this.client();
    const rows = await accountingDocument.findMany({
      where: { id },
      orderBy: [{ id: 'asc' }],
      skip: 0,
      take: 1,
      include: { lines: true },
    });
    const [row] = rows;
    return row === undefined ? null : toDomain(row, row.lines);
  }

  /** By-number read inside the number's uniqueness scope (§18). */
  async findByNumber(
    organizationId: string,
    financialAreaId: string,
    documentNumber: string,
  ): Promise<AccountingDocument | null> {
    const { accountingDocument } = await this.client();
    const rows = await accountingDocument.findMany({
      where: { organizationId, financialAreaId, documentNumber },
      orderBy: [{ id: 'asc' }],
      skip: 0,
      take: 1,
      include: { lines: true },
    });
    const [row] = rows;
    return row === undefined ? null : toDomain(row, row.lines);
  }

  async list(params: {
    where: AccountingDocumentListFilter;
    orderBy: OrderBy;
    skip: number;
    take: number;
  }): Promise<{ items: AccountingDocument[]; total: number }> {
    const { accountingDocument } = await this.client();
    const where = toWhere(params.where);
    const [rows, total] = await Promise.all([
      accountingDocument.findMany({
        where,
        orderBy: params.orderBy,
        skip: params.skip,
        take: params.take,
        include: { lines: true },
      }),
      accountingDocument.count({ where }),
    ]);
    return {
      items: rows.map((row) => toDomain(row, row.lines)),
      total,
    };
  }

  // ---- guarded writes -----------------------------------------------------

  /**
   * Compose a voucher (header + lines) in its starting phase.
   *
   * Guards re-evaluated under the locks: the resolved year+period are OPEN and
   * belong to the area/organization (§7.2 rule 4, AC-I-02/04), every account
   * is in-organization, postable and active (§14, AC-I-09), and the line set
   * is a legal balanced composition (§13, AC-I-07/08).
   */
  async createChecked(
    input: CreateAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    assertCreatePhase(input.state, input.documentNumber);
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const scope = await lockOpenScopeInTx(tx, {
        organizationId: input.organizationId,
        financialAreaId: input.financialAreaId,
        documentDate: input.documentDate,
      });
      await lockAccountsForLinesInTx(
        tx,
        input.organizationId,
        input.lines.map((line) => line.accountId),
      );
      assertLineComposition(input.lines);

      const row = await tx.accountingDocument.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          financialAreaId: input.financialAreaId,
          fiscalYearId: scope.year.id,
          accountingPeriodId: scope.period.id,
          documentType: 'accounting_voucher',
          documentNumber: input.documentNumber,
          documentDate: input.documentDate,
          description: input.description,
          state: input.state,
          origin: input.origin,
          branchId: input.branchId,
          sourceModule: input.source?.module ?? null,
          sourceEntityType: input.source?.entityType ?? null,
          sourceEntityId: input.source?.entityId ?? null,
          sourceOperation: input.source?.operation ?? null,
          idempotencyReference: input.idempotencyReference,
          requestHash: input.requestHash,
          finalizedAt: null,
          finalizedBy: null,
          correctionKind: null,
          correctionReason: null,
          reversesDocumentId: null,
          reversedByDocumentId: null,
          correlationId: input.correlationId,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
          createdBy: input.createdBy,
        },
      });
      const lines = await writeLinesInTx(tx, {
        document: row,
        lines: input.lines,
        actorId: input.createdBy,
        now: input.createdAt,
      });
      if (input.ledger !== null) {
        await insertOperationRow(tx, input.ledger);
      }
      return toDomain(row, lines);
    });
  }

  /**
   * Edit an editable voucher: the narration, the optional branch, the business
   * date and the WHOLE line set (lines are replaced as an aggregate,
   * §12.5/§15.2). The number, the origin and the phase are not part of an
   * edit; the financial AREA may change only while the voucher is a draft
   * (AC-D-03: the area is immutable once the document is issued, because the
   * number belongs to that area's series).
   *
   * A date/area change re-resolves the scope and requires the target period to
   * be OPEN (§7.2 rule 4: a closed period refuses new documents *dated in it*);
   * keeping the stored scope while editing narration is allowed even if that
   * period has since closed, because finalization re-checks the status anyway
   * (§15.5) and freezing narration would make history uneditable
   * (master-data-strategy.md §7.4).
   */
  async updateChecked(
    input: UpdateAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const target = await lockScopeInTx(tx, {
        organizationId: input.organizationId,
        financialAreaId: input.financialAreaId,
        documentDate: input.documentDate,
      });
      await lockAccountsForLinesInTx(
        tx,
        input.organizationId,
        input.lines.map((line) => line.accountId),
      );
      assertLineComposition(input.lines);

      const locked = await this.lockDocumentInTx(
        tx,
        input.id,
        input.organizationId,
      );
      assertEditablePhase(locked.state);
      if (
        input.financialAreaId !== locked.financialAreaId &&
        locked.state !== 'draft'
      ) {
        // AC-D-03: the area is frozen at issuance — the serial's scope is the
        // area (§18), so re-homing a numbered voucher would move a number
        // across series.
        throw new AccountingDocumentAreaImmutableError();
      }

      const scopeChanged =
        target.year.id !== locked.fiscalYearId ||
        target.period.id !== locked.accountingPeriodId;
      if (scopeChanged) {
        assertOpenScope(target);
      }

      const row = await tx.accountingDocument.update({
        where: { id: input.id },
        data: {
          financialAreaId: input.financialAreaId,
          fiscalYearId: target.year.id,
          accountingPeriodId: target.period.id,
          documentDate: input.documentDate,
          description: input.description,
          branchId: input.branchId,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      });
      await tx.accountingDocumentLine.deleteMany({
        where: { documentId: input.id },
      });
      const lines = await writeLinesInTx(tx, {
        document: row,
        lines: input.lines,
        actorId: input.updatedBy,
        now: input.updatedAt,
      });
      return toDomain(row, lines);
    });
  }

  /**
   * Issuance (draft → temporary) and the serial assignment (§15.1/§18). The
   * number was allocated by the Document Foundation BEFORE this call, in its
   * own transaction; a failure here leaves the allocation row behind (an
   * auditable gap, `reuse_policy = never`) and a retry replays the same serial
   * through the allocation key — never a second one, and never a replacement
   * of the serial this document already carries.
   */
  async issueChecked(
    input: IssueAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await this.lockDocumentInTx(
        tx,
        input.id,
        input.organizationId,
      );
      // Issuance is the ONLY writer of `document_number` (besides a direct
      // issuance at creation): a voucher that already has a serial has been
      // issued, and its number never changes (§15.2, AC-I-22). The service
      // treats this conflict as a replay — the post-state it asked for is the
      // state that won.
      if (locked.state !== 'draft' || locked.documentNumber !== null) {
        throw new AccountingDocumentPhaseConflictError(
          toPhase(locked.state),
          'draft',
        );
      }
      const existing = await readLinesInTx(tx, input.id);
      const row = await tx.accountingDocument.update({
        where: { id: input.id },
        data: {
          state: 'temporary',
          documentNumber: input.documentNumber,
          updatedAt: input.updatedAt,
          updatedBy: input.updatedBy,
        },
      });
      return toDomain(row, existing);
    });
  }

  /**
   * Finalization — the ONE act that makes a voucher part of the books
   * (§15.5, AC-D-23): inside the document-locked transaction it re-validates
   * the scope (year+period still OPEN, and the stored resolution still the one
   * `document_date` resolves to), the line composition and balance (§13.1),
   * every referenced account (§14) and the description, then writes the state,
   * the finalization evidence, the N immutable ledger entries (Task 10.7 —
   * one per stored line, via the `domain/posting.ts` contract, never a second
   * implementation), the operational-freeze marks of the configurations this
   * posting used (Task 13 — `accounting-configuration-usage.ts`, at the
   * configuration position of the lock order, i.e. BEFORE the accounts are
   * locked `FOR SHARE`) and the posting-operation row — all or nothing: a
   * refusal below rolls the markers back with everything else, so a
   * finalization that did not commit never leaves a configuration looking used.
   *
   * The operation row is written LAST: a unique violation on a lost key race
   * aborts the transaction, so a `final` document can never exist without its
   * entries and its idempotency evidence, and a retry can never finalize or
   * post twice.
   *
   * Task 14 — the accounting-period lifecycle gate. As soon as the resolved
   * year and period are locked, the scope is asserted OPEN and the whole
   * transaction fails closed for `closed`/`sealed` — before the freeze marker,
   * before the account/projection locks, before any write. There is no
   * redirect into "another period", no implicit reopen, and no way to reach
   * the ledger of a locked period: the ledger INSERTs (and the balance
   * projection UPSERTs and the evidence row that accompany them) sit strictly
   * after the gate, inside the same transaction. A posting that loses the race
   * against a `close` therefore leaves NOTHING behind — no `state = 'final'`,
   * no ledger entry, no balance delta, no posting-operation row, no freeze
   * marker — because the refusal rolls the single transaction back as a unit.
   */
  async finalizeChecked(
    input: FinalizeAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      // The stored scope is read (unlocked) FIRST only to learn which calendar
      // rows must be locked; every authoritative check happens after the
      // document row is locked, and a scope that moved in between is a
      // conflict rather than a silent write into an unvalidated calendar.
      const header = await tx.accountingDocument.findUnique({
        where: { id: input.id },
      });
      if (header === null || header.organizationId !== input.organizationId) {
        throw new AccountingDocumentMissingError();
      }
      const scope = await lockScopeInTx(tx, {
        organizationId: input.organizationId,
        financialAreaId: header.financialAreaId,
        documentDate: header.documentDate,
      });
      // Task 14 — the accounting-period lifecycle gate, FIRST and fail-closed
      // (contract §7.2 rules 4/8, §15.5 step 1). The resolved year and period
      // are now locked, so their status is the committed one; if the period is
      // `closed`/`sealed` (or its year is), the finalization is refused HERE —
      // before the operational-freeze marker, before the account `FOR SHARE`
      // locks, before the projection locks, before any row is written. Nothing
      // reaches the ledger, and a refused posting does not even take the locks
      // of a posting that would have committed: the period row is the
      // serialization point, so a concurrent `close` either commits first (and
      // is seen here) or waits until this transaction ends. The re-assertion
      // after the document lock below is the Task 10.7 stored-scope check, kept
      // as the authoritative verdict on the re-read scope.
      assertOpenScope(scope);
      const lockedAccountIds = await accountIdsInTx(tx, input.id);
      // Task 13 — operational freeze. The configurations this posting USES are
      // marked here, inside the finalization transaction and at the
      // configuration position of the module's lock order (calendar →
      // configuration → accounts `FOR SHARE` → projections → document), never
      // after the document lock. Two properties carry the whole guarantee:
      // the guarded statement makes the mark first-use-wins and idempotent, and
      // the shared transaction makes it atomic with the ledger entries — a
      // refusal below (phase, stale scope, closed period, bad composition)
      // rolls the marker back with everything else, so a finalization that did
      // not commit can never leave a configuration looking used. A REPLAY never
      // reaches this method at all (`PostingService` returns on the idempotency
      // row), so a retry re-marks nothing. See
      // `data/accounting-configuration-usage.ts`.
      await markConfigurationsUsedByDocumentInTx(tx, {
        organizationId: input.organizationId,
        documentId: input.id,
        accountIds: lockedAccountIds,
        now: input.finalizedAt,
        actorId: input.finalizedBy,
      });
      await lockAccountsForLinesInTx(
        tx,
        input.organizationId,
        lockedAccountIds,
      );

      // Task 12 — global order `… → accounts FOR SHARE → balance_projections FOR UPDATE → document FOR UPDATE`.
      // Lock touched projection keys BEFORE the document so two concurrent
      // finalizations for the same (period, account) tail `→ balances → document`
      // and do not invert to `document → balances` (which would deadlock against
      // `rebuildScoped` which also holds `balances FOR UPDATE`).
      // Keys are derived from the already-locked calendar scope (header+scope)
      // plus the document's referenced accounts — exactly the keys `apply…`
      // will upsert after the ledger INSERT.
      const projectionKeys = lockedAccountIds.map((accountId) => ({
        organizationId: input.organizationId,
        financialAreaId: header.financialAreaId,
        fiscalYearId: scope.year.id,
        accountingPeriodId: scope.period.id,
        accountId,
      }));
      const lockedBalances = await lockBalanceProjectionRows(
        tx,
        projectionKeys,
      );

      const locked = await this.lockDocumentInTx(
        tx,
        input.id,
        input.organizationId,
      );
      if (locked.state === 'final') {
        throw new AccountingDocumentPhaseConflictError('final', 'temporary');
      }
      if (locked.state !== 'temporary') {
        throw new AccountingDocumentPhaseConflictError(
          toPhase(locked.state),
          'temporary',
        );
      }
      if (locked.documentNumber === null) {
        // A temporary voucher always carries its serial (§18); a numbered row
        // is the only shape finalization may act on.
        throw new Error(
          `Temporary accounting document "${input.id}" carries no document number.`,
        );
      }
      if (
        scope.year.id !== locked.fiscalYearId ||
        scope.period.id !== locked.accountingPeriodId ||
        scope.period.id !== header.accountingPeriodId ||
        locked.financialAreaId !== header.financialAreaId
      ) {
        // A concurrent edit re-dated the voucher (or moved its area) after the
        // calendar locks were taken: the validated scope is not the stored one.
        throw new AccountingDocumentStaleError();
      }
      const lines = await readLinesInTx(tx, input.id);
      if (
        !sameIds(
          lockedAccountIds,
          lines.map((line) => line.accountId),
        )
      ) {
        // A concurrent edit replaced the line set: some referenced account is
        // not covered by the locks this transaction holds.
        throw new AccountingDocumentStaleError();
      }
      assertOpenScope(scope);
      assertLineComposition(lineInputsOf(lines));

      const row = await tx.accountingDocument.update({
        where: { id: input.id },
        data: {
          state: 'final',
          finalizedAt: input.finalizedAt,
          finalizedBy: input.finalizedBy,
          // System-origin evidence is mirrored onto the document (§12.2); a
          // manual document keeps them NULL and is evidenced by the ledger row.
          ...(locked.origin === 'system'
            ? {
                idempotencyReference: input.ledger.operationKey,
                requestHash: input.ledger.requestHash,
              }
            : {}),
          updatedAt: input.finalizedAt,
          updatedBy: input.finalizedBy,
        },
      });
      // Task 10.7 — ledger materialization, in the SAME transaction: the
      // entries are built from the FINAL aggregate (final-only, numbered, with
      // evidence) through the posting contract — `toPostingInput` enforces the
      // preconditions, `toLedgerEntries` re-asserts every entry invariant and
      // the balance — and the UNIQUE backstop on `voucher_line_id` makes a
      // second entry for one line impossible to persist. ULIDs are generated
      // in the data layer here (the inventory/RBAC precedent): the ids belong
      // to rows this transaction owns, and nothing outside it may observe them
      // before commit.
      const finalized = toDomain(row, lines);
      const postingInput = toPostingInput({
        document: finalized,
        operationKey: input.ledger.operationKey,
        requestHash: input.ledger.requestHash,
      });
      const ledgerCreates = toLedgerEntries(postingInput, generateId).map(
        (entry) =>
          toLedgerEntryCreate(entry, input.finalizedAt, input.finalizedBy),
      );
      await insertLedgerEntries(tx, ledgerCreates);
      // Task 12 — balance projection maintenance, SAME transaction, AFTER the
      // ledger INSERTs and BEFORE the operation row (which stays LAST per
      // §16.4). Ledger entries are the source; balances are the projection.
      // Each entry contributes its turnover to one (period, account) key — we
      // map the creates (not the domain entries) so amounts/ids match exactly.
      // Uses the `lockedBalances` acquired BEFORE the document (accounts →
      // balances → document) so the transaction does NOT re-take a
      // `document → balances` lock tail.
      await applyBalanceProjectionDeltasWithLocksHeldInTx(
        tx,
        ledgerCreates.map((c) => ({
          organizationId: c.organizationId,
          financialAreaId: c.financialAreaId,
          fiscalYearId: c.fiscalYearId,
          accountingPeriodId: c.accountingPeriodId,
          accountId: c.accountId,
          debitAmount: c.debitAmount,
          creditAmount: c.creditAmount,
        })),
        input.finalizedAt,
        input.finalizedBy,
        lockedBalances,
      );
      await insertOperationRow(tx, input.ledger);
      return finalized;
    });
  }

  /**
   * Discard a PRE-FINAL voucher (§15.3, AC-D-21). Its lines cascade; its
   * numbering allocation row is untouched, so the gap stays visible and
   * auditable. `final` is refused inside the lock (AC-I-06).
   *
   * @returns the discarded document (the event payload needs its identity).
   */
  async deleteChecked(
    input: DeleteAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const locked = await this.lockDocumentInTx(
        tx,
        input.id,
        input.organizationId,
      );
      assertEditablePhase(locked.state);
      const lines = await readLinesInTx(tx, input.id);
      const row = await tx.accountingDocument.delete({
        where: { id: input.id },
      });
      return toDomain(row, lines);
    });
  }

  /**
   * Reverse a Final voucher (Task 15, AC-D-22): create a NEW numbered Final
   * document whose lines invert debit/credit of the original. The original
   * stays Final; only `reversed_by_document_id` is written. Lock order matches
   * finalization: calendar of the reversal date → freeze → accounts FOR SHARE
   * → balances FOR UPDATE → ORIGINAL document FOR UPDATE (last). The reversal
   * header is an INSERT, not a lock. Unique `reverses_document_id` is the
   * cross-transaction backstop.
   */
  async reverseChecked(
    input: ReverseAccountingDocumentInput,
  ): Promise<AccountingDocument> {
    const client = await this.transacting();
    return client.$transaction(async (tx) => {
      const originalHeader = await tx.accountingDocument.findUnique({
        where: { id: input.originalDocumentId },
      });
      if (
        originalHeader === null ||
        originalHeader.organizationId !== input.organizationId
      ) {
        throw new AccountingDocumentMissingError();
      }
      const scope = await lockOpenScopeInTx(tx, {
        organizationId: input.organizationId,
        financialAreaId: originalHeader.financialAreaId,
        documentDate: input.documentDate,
      });
      const lockedAccountIds = await accountIdsInTx(
        tx,
        input.originalDocumentId,
      );
      await markConfigurationsUsedByDocumentInTx(tx, {
        organizationId: input.organizationId,
        documentId: input.originalDocumentId,
        accountIds: lockedAccountIds,
        now: input.finalizedAt,
        actorId: input.finalizedBy,
      });
      await lockAccountsForLinesInTx(
        tx,
        input.organizationId,
        lockedAccountIds,
      );
      const projectionKeys = lockedAccountIds.map((accountId) => ({
        organizationId: input.organizationId,
        financialAreaId: originalHeader.financialAreaId,
        fiscalYearId: scope.year.id,
        accountingPeriodId: scope.period.id,
        accountId,
      }));
      const lockedBalances = await lockBalanceProjectionRows(
        tx,
        projectionKeys,
      );
      const locked = await this.lockDocumentInTx(
        tx,
        input.originalDocumentId,
        input.organizationId,
      );
      if (locked.state !== 'final') {
        throw new AccountingDocumentPhaseConflictError(
          toPhase(locked.state),
          'final',
        );
      }
      if (locked.reversedByDocumentId) {
        throw new AccountingDocumentAlreadyReversedError(locked.id);
      }
      const originalLines = await readLinesInTx(tx, input.originalDocumentId);
      if (
        !sameIds(
          lockedAccountIds,
          originalLines.map((line) => line.accountId),
        )
      ) {
        throw new AccountingDocumentStaleError();
      }
      const inverted = invertDocumentLines(
        originalLines.map((line) => ({
          id: line.id,
          documentId: line.documentId,
          lineNo: line.lineNo,
          accountId: line.accountId,
          debitAmount: toAmountString(line.debitAmount),
          creditAmount: toAmountString(line.creditAmount),
          description: line.description,
          sourceLineReference: line.sourceLineReference,
        })),
      );
      assertLineComposition(inverted);
      const reversalLines: AccountingDocumentLineWrite[] = inverted.map(
        (line) => ({
          id: generateId(),
          lineNo: line.lineNo,
          accountId: line.accountId,
          debitAmount: line.debitAmount,
          creditAmount: line.creditAmount,
          description: line.description,
          sourceLineReference: line.sourceLineReference,
        }),
      );
      const row = await tx.accountingDocument.create({
        data: {
          id: input.reversalId,
          organizationId: input.organizationId,
          financialAreaId: originalHeader.financialAreaId,
          fiscalYearId: scope.year.id,
          accountingPeriodId: scope.period.id,
          documentType: 'accounting_voucher',
          documentNumber: input.documentNumber,
          documentDate: input.documentDate,
          description: input.description,
          state: 'final',
          origin: locked.origin,
          branchId: locked.branchId,
          sourceModule: originalHeader.sourceModule,
          sourceEntityType: originalHeader.sourceEntityType,
          sourceEntityId: originalHeader.sourceEntityId,
          sourceOperation: originalHeader.sourceOperation,
          idempotencyReference: input.ledger.operationKey,
          requestHash: input.ledger.requestHash,
          finalizedAt: input.finalizedAt,
          finalizedBy: input.finalizedBy,
          correctionKind: CORRECTION_KIND_REVERSAL,
          correctionReason: input.reason,
          reversesDocumentId: input.originalDocumentId,
          reversedByDocumentId: null,
          correlationId: input.correlationId,
          createdAt: input.finalizedAt,
          updatedAt: input.finalizedAt,
          createdBy: input.createdBy,
        },
      });
      const lineRows = await writeLinesInTx(tx, {
        document: row,
        lines: reversalLines,
        actorId: input.createdBy,
        now: input.finalizedAt,
      });
      await tx.accountingDocument.update({
        where: { id: input.originalDocumentId },
        data: {
          reversedByDocumentId: input.reversalId,
          updatedAt: input.finalizedAt,
          updatedBy: input.finalizedBy,
        },
      });
      const reversal = toDomain(row, lineRows);
      const postingInput = toPostingInput({
        document: reversal,
        operationKey: input.ledger.operationKey,
        requestHash: input.ledger.requestHash,
      });
      const ledgerCreates = toLedgerEntries(postingInput, generateId).map(
        (entry) =>
          toLedgerEntryCreate(entry, input.finalizedAt, input.finalizedBy),
      );
      await insertLedgerEntries(tx, ledgerCreates);
      await applyBalanceProjectionDeltasWithLocksHeldInTx(
        tx,
        ledgerCreates.map((c) => ({
          organizationId: c.organizationId,
          financialAreaId: c.financialAreaId,
          fiscalYearId: c.fiscalYearId,
          accountingPeriodId: c.accountingPeriodId,
          accountId: c.accountId,
          debitAmount: c.debitAmount,
          creditAmount: c.creditAmount,
        })),
        input.finalizedAt,
        input.finalizedBy,
        lockedBalances,
      );
      await insertOperationRow(tx, input.ledger);
      return reversal;
    });
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Lock the document row and verify it is the organization's. A foreign or
   * missing document answers 404 at the service layer (AC-I-16) — so a
   * mismatch here means the row moved while the request was in flight: a
   * concurrent deletion of a pre-final voucher (§15.3) or a foreign id, both
   * of which are "not found" to the caller.
   */
  private async lockDocumentInTx(
    tx: AccountingTxClient,
    id: string,
    organizationId: string,
  ): Promise<LockedAccountingDocument & { origin: AccountingDocumentOrigin }> {
    const locked = await lockAccountingDocumentRow(tx, id);
    if (locked === null || locked.organizationId !== organizationId) {
      throw new AccountingDocumentMissingError();
    }
    if (!isAccountingDocumentOrigin(locked.origin)) {
      throw new Error(
        `Accounting document "${id}" has an unknown origin "${locked.origin}".`,
      );
    }
    return locked as LockedAccountingDocument & {
      origin: AccountingDocumentOrigin;
    };
  }
}

// ---- Guard helpers (module-local, used inside the transactions) -----------

interface LockedScope {
  year: LockedFiscalYear;
  period: LockedAccountingPeriod;
}

/**
 * Lock the area → year → period rows and resolve the calendar context of a
 * business date (§6.2 rules 3/4). The area lock serializes against every
 * calendar write (they all take it first); the year and period locks make the
 * status re-check immune to a concurrent close/seal.
 *
 * @throws AccountingDocumentScopeRejectedError when the area is disabled.
 * @throws AccountingDocumentDateUnresolvableError when no year/period covers
 *   the date (no implicit creation, no nearest-year guessing).
 */
async function lockScopeInTx(
  tx: AccountingTxClient,
  input: {
    organizationId: string;
    financialAreaId: string;
    documentDate: Date;
  },
): Promise<LockedScope> {
  const area = await lockFinancialAreaRow(tx, input.financialAreaId);
  if (!area.isActive) {
    throw new AccountingDocumentScopeRejectedError('area', 'disabled');
  }

  const years = await tx.fiscalYear.findMany({
    where: {
      organizationId: input.organizationId,
      financialAreaId: input.financialAreaId,
      startDate: { lte: input.documentDate },
      endDate: { gte: input.documentDate },
    },
    orderBy: [{ startDate: 'asc' }],
    skip: 0,
    // Two rows on purpose: >1 means the calendar overlaps, which the year
    // guards refuse (AC-I-03) — an impossible state that must fail loudly
    // instead of resolving to an arbitrary book.
    take: 2,
  });
  const resolvedYear = years[0];
  if (resolvedYear === undefined) {
    throw new AccountingDocumentDateUnresolvableError(input.documentDate);
  }
  if (years.length > 1) {
    throw new Error(
      `The financial area "${input.financialAreaId}" has overlapping fiscal years covering ${input.documentDate.toISOString()}.`,
    );
  }
  const year = await lockFiscalYearRow(tx, resolvedYear.id);
  if (
    year.organizationId !== input.organizationId ||
    year.financialAreaId !== input.financialAreaId
  ) {
    throw new Error(
      `Fiscal year "${year.id}" does not belong to financial area "${input.financialAreaId}".`,
    );
  }

  const periods = await tx.accountingPeriod.findMany({
    where: {
      fiscalYearId: year.id,
      startDate: { lte: input.documentDate },
      endDate: { gte: input.documentDate },
    },
    orderBy: [{ sequence: 'asc' }],
    skip: 0,
    take: 2,
  });
  const resolvedPeriod = periods[0];
  if (periods.length !== 1 || resolvedPeriod === undefined) {
    // Zero: the year has a gap the generator is supposed to prevent (§7.2
    // rule 2). More than one: overlapping periods, refused by AC-I-03.
    throw new AccountingDocumentDateUnresolvableError(input.documentDate);
  }
  const period = await lockAccountingPeriodRow(tx, resolvedPeriod.id);
  if (
    period.fiscalYearId !== year.id ||
    period.organizationId !== input.organizationId
  ) {
    // The period must be the locked year's own, inside the caller's
    // organization: a period read from another scope would mean the
    // denormalized scope columns disagree with the year (Task 14 verifies
    // ownership of the LOCKED row, not only of the row that routed us here).
    throw new Error(
      `Accounting period "${period.id}" does not belong to fiscal year "${year.id}" of organization "${input.organizationId}".`,
    );
  }
  return { year, period };
}

/** A scope that can accept a document dated in it (§7.2 rule 4, AC-I-04). */
async function lockOpenScopeInTx(
  tx: AccountingTxClient,
  input: {
    organizationId: string;
    financialAreaId: string;
    documentDate: Date;
  },
): Promise<LockedScope> {
  const scope = await lockScopeInTx(tx, input);
  assertOpenScope(scope);
  return scope;
}

/**
 * Fail closed on a locked scope (§7.2 rule 8, AC-I-04). The YEAR is checked
 * first on purpose: `sealed`/`closed` above makes the period's own status
 * meaningless for posting, and naming the year is the more useful message.
 */
function assertOpenScope(scope: LockedScope): void {
  if (scope.year.status !== 'open') {
    throw new AccountingDocumentScopeRejectedError('year', scope.year.status);
  }
  if (!scope.year.isActive) {
    throw new AccountingDocumentScopeRejectedError('year', 'disabled');
  }
  if (scope.period.status !== 'open') {
    throw new AccountingDocumentScopeRejectedError(
      'period',
      scope.period.status,
    );
  }
}

/**
 * A voucher is created either as a draft (no serial yet) or as an issued
 * `temporary` document — issuance happens at creation in the no-draft mode, so
 * the serial must already be allocated (§15.1/§18). A creation that would land
 * in `final` is impossible: `entryStates` declares `temporary` only (Mode A
 * "direct final" is a system-posting configuration this task does not enable,
 * §17.2 + OQ-42).
 */
function assertCreatePhase(state: string, documentNumber: string | null): void {
  if (state === 'draft') {
    if (documentNumber !== null) {
      throw new Error(
        'A draft accounting document cannot carry a document number.',
      );
    }
    return;
  }
  if (state === 'temporary') {
    if (documentNumber === null) {
      throw new Error(
        'An issued accounting document must carry its allocated number.',
      );
    }
    return;
  }
  throw new Error(`An accounting document cannot be created as "${state}".`);
}

/** Narrow a stored state string to the domain's phase vocabulary. */
function toPhase(state: string): AccountingDocumentPhase {
  if (!isAccountingDocumentPhase(state)) {
    throw new Error(`Accounting document has an unknown state "${state}".`);
  }
  return state;
}

/** The phases an edit/issuance/deletion may touch (§15.2/§15.3). */
function assertEditablePhase(state: string): void {
  const phase = toPhase(state);
  if (phase === 'final') {
    throw new AccountingDocumentFinalProtectedError(phase);
  }
}

/**
 * Lock every referenced account `FOR SHARE`, ascending by id and deduplicated
 * (a balanced voucher often touches an account twice), and re-evaluate
 * AC-I-09 under the lock: the account must belong to the organization, be
 * postable and be active.
 *
 * @throws AccountingDocumentAccountRejectedError with `account_not_found` for
 *   a missing/foreign account — the service maps it to 404 (AC-I-16).
 */
async function lockAccountsForLinesInTx(
  tx: AccountingTxClient,
  organizationId: string,
  accountIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(accountIds)].sort();
  for (const accountId of ids) {
    const account = await lockAccountRowForShare(tx, accountId);
    if (account === null || account.organizationId !== organizationId) {
      throw new AccountingDocumentAccountRejectedError(
        accountId,
        'account_not_found',
      );
    }
    if (!account.isPostable) {
      throw new AccountingDocumentAccountRejectedError(
        accountId,
        'account_not_postable',
      );
    }
    if (!account.isActive) {
      throw new AccountingDocumentAccountRejectedError(
        accountId,
        'account_disabled',
      );
    }
  }
}

/**
 * Map stored line rows to the domain's line inputs (amounts become canonical
 * decimal strings). Used by the in-transaction balance check so the STORED
 * rows are what the decision table sees, never the caller's copy.
 */
function lineInputsOf(
  rows: readonly AccountingDocumentLineRow[],
): AccountingDocumentLineInput[] {
  return rows.map((row) => ({
    lineNo: row.lineNo,
    accountId: row.accountId,
    debitAmount: toAmountString(row.debitAmount),
    creditAmount: toAmountString(row.creditAmount),
    description: row.description,
    sourceLineReference: row.sourceLineReference,
  }));
}

/** The §13/§12.5 line rules, from the one decision table (fast + locked). */
function assertLineComposition(
  lines: readonly AccountingDocumentLineInput[],
): void {
  const problems = checkVoucherLines(lines);
  if (problems.length > 0) {
    throw new AccountingDocumentLineRejectedError(problems);
  }
}

async function writeLinesInTx(
  tx: AccountingTxClient,
  input: {
    document: AccountingDocumentRow;
    lines: readonly AccountingDocumentLineWrite[];
    actorId: string | null;
    now: Date;
  },
): Promise<AccountingDocumentLineRow[]> {
  const rows: AccountingDocumentLineCreate[] = input.lines.map((line) => ({
    id: line.id,
    documentId: input.document.id,
    organizationId: input.document.organizationId,
    financialAreaId: input.document.financialAreaId,
    fiscalYearId: input.document.fiscalYearId,
    accountingPeriodId: input.document.accountingPeriodId,
    lineNo: line.lineNo,
    accountId: line.accountId,
    debitAmount: line.debitAmount,
    creditAmount: line.creditAmount,
    description: line.description,
    sourceLineReference: line.sourceLineReference,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.actorId,
  }));
  await tx.accountingDocumentLine.createMany({ data: rows });
  return readLinesInTx(tx, input.document.id);
}

async function accountIdsInTx(
  tx: AccountingTxClient,
  documentId: string,
): Promise<string[]> {
  const lines = await readLinesInTx(tx, documentId);
  return [...new Set(lines.map((line) => line.accountId))].sort();
}

/** Same id set, order-insensitive (both sides are deduplicated + sorted). */
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

async function readLinesInTx(
  tx: AccountingTxClient,
  documentId: string,
): Promise<AccountingDocumentLineRow[]> {
  return tx.accountingDocumentLine.findMany({
    where: { documentId },
    orderBy: [{ lineNo: 'asc' }],
  });
}

// ---- Row ⇄ domain mapping --------------------------------------------------

/**
 * Flatten a materialized entry into its insert payload (Task 10.7). The audit
 * clock/actor are the finalization's own: the entries are created BY that act,
 * so `created_at`/`updated_at` are `finalizedAt` and `created_by` is the
 * finalizer — no second clock, no second actor.
 */
function toLedgerEntryCreate(
  entry: LedgerEntry,
  finalizedAt: Date,
  finalizedBy: string | null,
): LedgerEntryCreate {
  return {
    id: entry.id,
    organizationId: entry.organizationId,
    financialAreaId: entry.financialAreaId,
    fiscalYearId: entry.fiscalYearId,
    accountingPeriodId: entry.accountingPeriodId,
    voucherId: entry.voucherId,
    voucherNumber: entry.voucherNumber,
    voucherLineId: entry.voucherLineId,
    lineNo: entry.lineNo,
    accountId: entry.accountId,
    debitAmount: entry.debitAmount,
    creditAmount: entry.creditAmount,
    description: entry.description,
    documentDate: entry.documentDate,
    postingTimestamp: entry.postingTimestamp,
    branchId: entry.branchId,
    origin: entry.origin,
    sourceModule: entry.source?.module ?? null,
    sourceEntityType: entry.source?.entityType ?? null,
    sourceEntityId: entry.source?.entityId ?? null,
    sourceOperation: entry.source?.operation ?? null,
    correlationId: entry.correlationId,
    finalizedBy: entry.finalizedBy,
    createdAt: finalizedAt,
    updatedAt: finalizedAt,
    createdBy: finalizedBy,
  };
}

function toWhere(
  filter: AccountingDocumentListFilter,
): AccountingDocumentWhere {
  const where: AccountingDocumentWhere = {
    organizationId: filter.organizationId,
  };
  if (filter.financialAreaId !== undefined) {
    where.financialAreaId = filter.financialAreaId;
  }
  if (filter.fiscalYearId !== undefined)
    where.fiscalYearId = filter.fiscalYearId;
  if (filter.accountingPeriodId !== undefined) {
    where.accountingPeriodId = filter.accountingPeriodId;
  }
  if (filter.state !== undefined) where.state = filter.state;
  if (filter.origin !== undefined) where.origin = filter.origin;
  if (filter.branchId !== undefined) where.branchId = filter.branchId;
  if (filter.documentNumber !== undefined) {
    where.documentNumber = filter.documentNumber;
  }
  if (filter.dateFrom !== undefined || filter.dateTo !== undefined) {
    const date: { gte?: Date; lte?: Date } = {};
    if (filter.dateFrom !== undefined) date.gte = filter.dateFrom;
    if (filter.dateTo !== undefined) date.lte = filter.dateTo;
    where.documentDate = date;
  }
  if (filter.search !== undefined && filter.search !== '') {
    where.description = { contains: filter.search, mode: 'insensitive' };
  }
  return where;
}

function toDomain(
  row: AccountingDocumentRow,
  lineRows: readonly AccountingDocumentLineRow[],
): AccountingDocument {
  if (!isAccountingDocumentPhase(row.state)) {
    throw new Error(
      `Stored accounting document "${row.id}" has an unknown state "${row.state}".`,
    );
  }
  if (!isAccountingDocumentOrigin(row.origin)) {
    throw new Error(
      `Stored accounting document "${row.id}" has an unknown origin "${row.origin}".`,
    );
  }
  const source: AccountingDocumentSource | null =
    row.sourceModule === null || row.sourceEntityType === null
      ? null
      : {
          module: row.sourceModule,
          entityType: row.sourceEntityType,
          entityId: row.sourceEntityId ?? '',
          operation: row.sourceOperation ?? '',
        };
  return {
    id: row.id,
    organizationId: row.organizationId,
    financialAreaId: row.financialAreaId,
    fiscalYearId: row.fiscalYearId,
    accountingPeriodId: row.accountingPeriodId,
    documentType: row.documentType,
    documentNumber: row.documentNumber,
    documentDate: row.documentDate,
    description: row.description,
    phase: row.state,
    origin: row.origin,
    branchId: row.branchId,
    source,
    idempotencyReference: row.idempotencyReference,
    requestHash: row.requestHash,
    finalizedAt: row.finalizedAt,
    finalizedBy: row.finalizedBy,
    correctionKind:
      row.correctionKind === null
        ? null
        : isAccountingCorrectionKind(row.correctionKind)
          ? row.correctionKind
          : (() => {
              throw new Error(
                `Stored accounting document "${row.id}" has an unknown correction kind "${row.correctionKind}".`,
              );
            })(),
    correctionReason: row.correctionReason,
    reversesDocumentId: row.reversesDocumentId,
    reversedByDocumentId: row.reversedByDocumentId,
    correlationId: row.correlationId,
    lines: lineRows
      .map((line) => ({
        id: line.id,
        documentId: line.documentId,
        lineNo: line.lineNo,
        accountId: line.accountId,
        debitAmount: canonicalizeAmount(toAmountString(line.debitAmount)),
        creditAmount: canonicalizeAmount(toAmountString(line.creditAmount)),
        description: line.description,
        sourceLineReference: line.sourceLineReference,
      }))
      .sort((left, right) => left.lineNo - right.lineNo),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Map a stored `numeric(18,2)` line amount to the domain's decimal string —
 * the narrowest safe mapping (the Task 10.7 ledger semantics, applied to the
 * Task 10.4 document path): Prisma returns a `Decimal` object with an exact
 * `toString()` in production, and the in-memory fakes store canonical
 * strings. Anything else — especially a JS `number`, whose binary float
 * semantics the contract forbids (§13.1/§13.5) — is refused loudly rather
 * than stringified, because `String(0.1 + 0.2)` is float loss wearing a
 * decimal costume. A malformed string still fails downstream in
 * `canonicalizeAmount` / the line decision table, so no silent value can
 * reach the domain.
 *
 * Exported for the focused mapping spec only; both call sites are in this file.
 */
export function toAmountString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toString?: unknown }).toString === 'function'
  ) {
    return (value as { toString(): string }).toString();
  }
  throw new Error(
    `Cannot map a document line amount of type "${typeof value}" to a decimal string without float semantics.`,
  );
}
