import type { AccountingTxClient } from './accounting-rows.js';

/**
 * Row locking for the Accounting guard transactions (Task 10.2 calendar
 * AC-I-03/AC-I-04; Task 10.3 coding structure + chart AC-I-10/AC-I-11).
 *
 * Every calendar write holds a parent-row lock from BEFORE its guard check
 * until commit; that single rule is what makes the overlap, boundary and
 * lifecycle guards race-safe:
 *
 * - two year writes for one area serialize on the area lock; the overlap
 *   check reads the winner's committed years, so check-then-act is atomic;
 * - two period writes for one year serialize on the year lock;
 * - a year close/seal holding the year lock sees exactly the committed
 *   periods — a concurrent period transition either committed before and
 *   is observed, or waits and evaluates after;
 * - an area disable holding the area lock (plus the area's year locks)
 *   sees every open year; a concurrent year create/reopen either committed
 *   first and blocks the disable, or waits and is refused against the
 *   disabled area.
 *
 * Lock ORDER is fixed everywhere and never reversed — area → year →
 * period, and (Task 10.3) coding-structure version → account — so no deadlock
 * cycle exists: no transaction holding a year lock ever waits on an area lock
 * (year transitions lock the year only; period writes lock the year, then the
 * period), no account write ever locks a version row before its own account
 * row, and multi-row locks always ascend by id.
 *
 * Task 13 (operational freeze) added no new lock POSITION: the
 * configuration row an accounting-configuration marker updates already sits
 * between the period and the accounts in the order below, so
 * `finalizeChecked` takes it there — after `lockScopeInTx` and BEFORE
 * `lockAccountRowForShare` — with the ids ascending. Full matrix + the
 * deadlock argument against root-account creation/publish:
 * `docs/accounting/lock-order-matrix.md` (row D4″).
 *
 * Prisma cannot express `SELECT … FOR UPDATE`, hence the parameterized raw
 * statements below — the documented concurrency-critical path
 * (docs/modules.md §Accounting, AR-11).
 */

/** A locked financial-area row: the scope + usability the guards need. */
export interface LockedFinancialArea {
  id: string;
  organizationId: string;
  isDefault: boolean;
  isActive: boolean;
}

/** A locked fiscal-year row: scope + status + range the guards need. */
export interface LockedFiscalYear {
  id: string;
  organizationId: string;
  financialAreaId: string;
  status: string;
  isActive: boolean;
  startDate: Date;
  endDate: Date;
}

/**
 * A locked accounting-period row: the routing + status the guards need.
 *
 * `organizationId` is carried since Task 14 so a lifecycle transition can
 * verify organization ownership of the LOCKED row inside its own transaction
 * (the service resolves the period in scope first and answers 404 for a
 * foreign id; this is the authoritative re-check, so no future caller can
 * mutate a period across the boundary by handing the repository a foreign
 * id).
 */
export interface LockedAccountingPeriod {
  id: string;
  organizationId: string;
  fiscalYearId: string;
  status: string;
}

/**
 * Lock one financial-area row. The lock is held until the surrounding
 * transaction commits or rolls back, so the year-overlap check and the
 * year insert that follow are atomic for the area.
 *
 * @throws Error when the area row does not exist (an area deleted
 *   mid-flight is a bug — the service resolves the area inside the same
 *   operation boundary and areas are never deleted).
 */
export async function lockFinancialAreaRow(
  tx: AccountingTxClient,
  financialAreaId: string,
): Promise<LockedFinancialArea> {
  const rows = await tx.$queryRaw<LockedFinancialArea>`
    SELECT "id",
           "organization_id" AS "organizationId",
           "is_default"      AS "isDefault",
           "is_active"       AS "isActive"
      FROM "accounting"."financial_areas"
     WHERE "id" = ${financialAreaId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Financial area "${financialAreaId}" no longer exists.`);
  }
  return row;
}

/**
 * Lock every financial-area row of one organization, ascending by id.
 * Serializes concurrent "set default area" operations for the org so two
 * areas can never both end up flagged default.
 */
export async function lockFinancialAreasOfOrganization(
  tx: AccountingTxClient,
  organizationId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }>`
    SELECT "id"
      FROM "accounting"."financial_areas"
     WHERE "organization_id" = ${organizationId}
     ORDER BY "id" ASC
     FOR UPDATE`;
  return rows.map((row) => row.id);
}

/**
 * Lock one fiscal-year row. The lock is held until commit, so the
 * period-overlap/boundary check and the period insert that follow are
 * atomic for the year, and so concurrent lifecycle moves of one year
 * serialize.
 *
 * @throws Error when the year row does not exist (same bug posture as the
 *   area lock above — the service pre-resolves, and years are never
 *   deleted).
 */
export async function lockFiscalYearRow(
  tx: AccountingTxClient,
  fiscalYearId: string,
): Promise<LockedFiscalYear> {
  const rows = await tx.$queryRaw<LockedFiscalYear>`
    SELECT "id",
           "organization_id"   AS "organizationId",
           "financial_area_id" AS "financialAreaId",
           "status"            AS "status",
           "is_active"         AS "isActive",
           "start_date"        AS "startDate",
           "end_date"          AS "endDate"
      FROM "accounting"."fiscal_years"
     WHERE "id" = ${fiscalYearId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Fiscal year "${fiscalYearId}" no longer exists.`);
  }
  return row;
}

/**
 * Lock every fiscal-year row of one area, ascending by id. The area
 * disable takes this (after the area lock) so its "no open years" guard
 * cannot miss a concurrent year reopen.
 */
export async function lockFiscalYearsOfArea(
  tx: AccountingTxClient,
  financialAreaId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }>`
    SELECT "id"
      FROM "accounting"."fiscal_years"
     WHERE "financial_area_id" = ${financialAreaId}
     ORDER BY "id" ASC
     FOR UPDATE`;
  return rows.map((row) => row.id);
}

/**
 * Lock one accounting-period row. Period transitions take the year lock
 * first (for the year-level gate), then this lock — always in that order.
 *
 * @throws Error when the period row does not exist (same bug posture as
 *   above — the service pre-resolves, and periods are never deleted).
 */
export async function lockAccountingPeriodRow(
  tx: AccountingTxClient,
  periodId: string,
): Promise<LockedAccountingPeriod> {
  const rows = await tx.$queryRaw<LockedAccountingPeriod>`
    SELECT "id",
           "organization_id" AS "organizationId",
           "fiscal_year_id"  AS "fiscalYearId",
           "status"          AS "status"
      FROM "accounting"."accounting_periods"
     WHERE "id" = ${periodId}
     FOR UPDATE`;
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`Accounting period "${periodId}" no longer exists.`);
  }
  return row;
}

/**
 * Lock the open periods of one year, ascending by id. The year close
 * takes this (after the year lock) and closes exactly the locked rows in
 * the same transaction (contract §7.2 rule 6). The sequences come along
 * so the close events carry the true ordinals without a second read.
 */
export async function lockOpenPeriodsOfYear(
  tx: AccountingTxClient,
  fiscalYearId: string,
): Promise<Array<{ id: string; sequence: number }>> {
  const rows = await tx.$queryRaw<{ id: string; sequence: number }>`
    SELECT "id",
           "sequence" AS "sequence"
      FROM "accounting"."accounting_periods"
     WHERE "fiscal_year_id" = ${fiscalYearId}
       AND "status" = 'open'
     ORDER BY "id" ASC
     FOR UPDATE`;
  return rows.map((row) => ({ id: row.id, sequence: row.sequence }));
}

// ---------------------------------------------------------------------------
// Coding structure versions (Task 10.3)
// ---------------------------------------------------------------------------

/** A locked coding-structure version row (status is the guard's input). */
export interface LockedCodingStructureVersion {
  id: string;
  organizationId: string;
  code: string;
  versionNumber: number;
  status: string;
  maxDepth: number;
  separator: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lock one coding-structure version row.
 *
 * Draft-configuration writes take this lock BEFORE changing the version or
 * replacing its levels and re-check `status = 'draft'` under it; the publish
 * transaction takes the same row (via the organization-wide lock below). That
 * is what makes "an active or superseded version is immutable" (§9.4) hold
 * against a configuration write that started while the version was still a
 * draft — the double check the Workflow Foundation records for exactly this
 * race (ADR-0024).
 *
 * @returns null when the row does not exist (the service maps it to 404).
 */
export async function lockCodingStructureVersionRow(
  tx: AccountingTxClient,
  versionId: string,
): Promise<LockedCodingStructureVersion | null> {
  const rows = await tx.$queryRaw<LockedCodingStructureVersion>`
    SELECT "id"              AS "id",
           "organization_id" AS "organizationId",
           "code"            AS "code",
           "version_number"  AS "versionNumber",
           "status"          AS "status",
           "max_depth"       AS "maxDepth",
           "separator"       AS "separator",
           "created_at"     AS "createdAt",
           "updated_at"     AS "updatedAt"
      FROM "accounting"."coding_structure_versions"
     WHERE "id" = ${versionId}
     FOR UPDATE`;
  const [row] = rows;
  return row ?? null;
}

/**
 * Lock EVERY coding-structure version row of one organization, ascending by
 * id — the publish path's serialization point.
 *
 * "Exactly one version is ACTIVE per organization" (§9.4) is an
 * organization-wide statement, so it needs an organization-wide lock: two
 * concurrent publishes for one organization serialize here, and the loser
 * re-reads the winner's committed rows inside the same transaction, so it can
 * never leave two active versions behind. A partial unique index would be the
 * database-side alternative and is rejected for the reason this module already
 * gives for `financial_areas.is_default`: Prisma cannot represent it, so the
 * next generated migration would drop it and silently lose the invariant.
 */
export async function lockCodingStructureVersionsOfOrganization(
  tx: AccountingTxClient,
  organizationId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }>`
    SELECT "id"
      FROM "accounting"."coding_structure_versions"
     WHERE "organization_id" = ${organizationId}
     ORDER BY "id" ASC
     FOR UPDATE`;
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// Accounting Configurations (Task 11 — Configuration Foundation)
// ---------------------------------------------------------------------------
//
// Task 13 reuses this position for the operational-freeze marker: the guarded
// `UPDATE … WHERE operationally_used_at IS NULL` that finalization issues
// (`accounting-configuration-usage.ts`) is an exclusive lock on exactly these
// rows, taken here — after the calendar, before the accounts. No other writer
// of a configuration row reaches an account or document lock afterwards, so the
// pair `configuration → account` is never held in the opposite order.

/** A locked accounting-configuration row. */
export interface LockedAccountingConfiguration {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  versionNumber: number;
  status: string;
  effectiveFrom: Date | null;
  operationallyUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // For draft validation that needs level count.
  levelsCount?: number | undefined;
}

export async function lockAccountingConfigurationRow(
  tx: AccountingTxClient,
  configurationId: string,
): Promise<LockedAccountingConfiguration | null> {
  const rows = await tx.$queryRaw<LockedAccountingConfiguration>`
    SELECT "id"                    AS "id",
           "organization_id"       AS "organizationId",
           "code"                  AS "code",
           "name"                  AS "name",
           "version_number"        AS "versionNumber",
           "status"                AS "status",
           "effective_from"        AS "effectiveFrom",
           "operationally_used_at" AS "operationallyUsedAt",
           "created_at"            AS "createdAt",
           "updated_at"            AS "updatedAt"
      FROM "accounting"."accounting_configurations"
     WHERE "id" = ${configurationId}
     FOR UPDATE`;
  const [row] = rows;
  return row ?? null;
}

export async function lockAccountingConfigurationsOfOrganization(
  tx: AccountingTxClient,
  organizationId: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }>`
    SELECT "id"
      FROM "accounting"."accounting_configurations"
     WHERE "organization_id" = ${organizationId}
     ORDER BY "id" ASC
     FOR UPDATE`;
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Accounts (Task 10.3)
// ---------------------------------------------------------------------------

/** A locked account row: everything the tree guards read. */
export interface LockedAccount {
  id: string;
  organizationId: string;
  code: string;
  title: string;
  parentId: string | null;
  level: number;
  codingStructureVersionId: string;
  accountingConfigurationId: string;
  accountNature: string;
  isPostable: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lock one account row.
 *
 * Callers follow ONE order, which is what keeps the chart race-safe without a
 * trigger (the database cannot express "no cycles" declaratively anyway):
 *
 * - CREATE a child   → lock the PARENT row, re-run `planAccountPlacement`
 *   against the locked parent, insert. A racing `is_postable = true` on that
 *   parent locks the same row, so the two paths serialize and the loser sees
 *   the winner's committed state: no representable "postable parent with
 *   children" (§14 rule 2) and no code collision the unique index does not
 *   already forbid.
 * - FLIP postability → lock the SAME row (the would-be parent) and count its
 *   children under that lock.
 * - MOVE             → lock the moved row and the new parent row in ASCENDING
 *   id order. Every move that could close a cycle has to lock the node whose
 *   subtree is being walked, so two concurrent cycle-forming moves serialize on
 *   it and exactly one wins; the FK (`parent_id` → RESTRICT) makes a dangling
 *   parent impossible.
 * - Root CREATE      → lock the resolved coding-structure version row first
 *   (`lockCodingStructureVersionRow`) and re-check it is still `active`.
 *
 * Version rows are locked before account rows and never the reverse, so no
 * transaction holds the two in opposite orders and no deadlock cycle exists.
 *
 * @returns null when the row does not exist (the service maps it to 404).
 */
export async function lockAccountRow(
  tx: AccountingTxClient,
  accountId: string,
): Promise<LockedAccount | null> {
  const rows = await tx.$queryRaw<LockedAccount>`
    SELECT "id"                            AS "id",
           "organization_id"               AS "organizationId",
           "code"                          AS "code",
           "title"                         AS "title",
           "parent_id"                     AS "parentId",
           "level"                         AS "level",
           "coding_structure_version_id"   AS "codingStructureVersionId",
           "accounting_configuration_id"   AS "accountingConfigurationId",
           "account_nature"                AS "accountNature",
           "is_postable"                   AS "isPostable",
           "is_active"                     AS "isActive",
           "created_at"                    AS "createdAt",
           "updated_at"                    AS "updatedAt"
      FROM "accounting"."accounts"
     WHERE "id" = ${accountId}
     FOR UPDATE`;
  const [row] = rows;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Balance projections — Task 12 (turnover, AC-I-19)
// ---------------------------------------------------------------------------
//
// The projection rides the finalization lock TAIL: it is written AFTER the
// ledger inserts, inside the SAME document-finalization transaction
// (§15.5 re-read, ADR-0031). The added row(s) are taken `FOR UPDATE` on
// their UNIQUE projection key (org, area, year, period, account), ordered
// ascending by that key's natural id order, BEFORE the `accounting_document`
// row is locked — i.e. after accounts, before the document — so the global
// order becomes:
//
//   financial_area → fiscal_year → accounting_period → accounts (FOR SHARE,
//   ascending id) → account_balance_projections (FOR UPDATE, ascending
//   projection-key id) → accounting_document (FOR UPDATE, last)
//
// No other accounting writer touches `account_balance_projections` inside a
// different order: the explicit `rebuild` path takes area → year → period
// (when scoped) → `account_balance_projections` FOR UPDATE (scope-predicate
// sort) → ledger aggregation read, with no account row held concurrently that
// could invert the order. Hence every Task-12 path nests inside the existing
// one and never reverses it. See `docs/accounting/lock-order-matrix.md` Task
// 12 rows (R1…R8) for the full matrix.
//
// Locking a projection key `FOR UPDATE` makes concurrent finalizations that
// touch the same (period, account) serialize on it. Two finalizations of two
// vouchers for disjoint keys proceed concurrently (the UNIQUE index is the
// cross-transaction backstop — the loser of a raced INSERT retries as an
// UPDATE — and the rebuilt slice is replaced atomically).

export interface LockedBalanceProjection {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  accountId: string;
}

/**
 * Lock the balance projection row(s) for the exact keys touched by this
 * finalization (`WHERE organization_id = ? AND financial_area_id = ? AND
 * fiscal_year_id = ? AND accounting_period_id = ? AND account_id = ?` per
 * key, `FOR UPDATE`). Locks are taken ascending by the composite key
 * (lexicographic on the five ids — deterministic, id-sort-equivalent) so
 * concurrent finalizations never deadlock.
 *
 * @returns map from projection-key string → locked row (absent = no row yet).
 */
export async function lockBalanceProjectionRows(
  tx: AccountingTxClient,
  keys: readonly {
    organizationId: string;
    financialAreaId: string;
    fiscalYearId: string;
    accountingPeriodId: string;
    accountId: string;
  }[],
): Promise<Map<string, LockedBalanceProjection>> {
  if (keys.length === 0) return new Map();
  const sorted = [...new Set(keys.map(balanceProjectionKeyOf))].sort();
  // Rehydrate deduped sorted keys to full tuples.
  const keyByStr = new Map<string, (typeof keys)[number]>();
  for (const k of keys) keyByStr.set(balanceProjectionKeyOf(k), k);
  const out = new Map<string, LockedBalanceProjection>();
  for (const keyStr of sorted) {
    const k = keyByStr.get(keyStr);
    if (k === undefined) continue;
    const rows = await tx.$queryRaw<LockedBalanceProjection>`
      SELECT "id"                   AS "id",
             "organization_id"      AS "organizationId",
             "financial_area_id"    AS "financialAreaId",
             "fiscal_year_id"       AS "fiscalYearId",
             "accounting_period_id" AS "accountingPeriodId",
             "account_id"           AS "accountId"
        FROM "accounting"."account_balance_projections"
       WHERE "organization_id"      = ${k.organizationId}
         AND "financial_area_id"    = ${k.financialAreaId}
         AND "fiscal_year_id"       = ${k.fiscalYearId}
         AND "accounting_period_id" = ${k.accountingPeriodId}
         AND "account_id"           = ${k.accountId}
       FOR UPDATE`;
    const [row] = rows;
    if (row !== undefined) out.set(keyStr, row);
  }
  return out;
}

/**
 * Lock every balance projection row whose predicate matches the rebuild
 * scope (always org-scoped; optionally area/year). Used only by the explicit
 * audited rebuild transaction — not by the per-voucher finalization. The
 * rebuild then DELETEs + re-INSERTs the scoped slice atomically
 * (idempotent-by-replacement, AC-I-19e). Taking the scope predicate's rows
 * `FOR UPDATE` here guarantees the slice is frozen while aggregation reads
 * the ledger: a concurrent finalization that would extend the slice waits on
 * the same rows.
 */
export async function lockBalanceProjectionScope(
  tx: AccountingTxClient,
  scope: {
    organizationId: string;
    financialAreaId?: string | undefined;
    fiscalYearId?: string | undefined;
  },
): Promise<string[]> {
  // One query to lock, one to return ids (keeps the logic portable between
  // rebuild's predicate variants without 4 branches of dynamic SQL).
  const rows = await tx.$queryRaw<{ id: string }>`
    SELECT "id"
      FROM "accounting"."account_balance_projections"
     WHERE "organization_id" = ${scope.organizationId}
       AND (${scope.financialAreaId as string | undefined}::text IS NULL
            OR "financial_area_id" = ${scope.financialAreaId as string | undefined})
       AND (${scope.fiscalYearId as string | undefined}::text IS NULL
            OR "fiscal_year_id" = ${scope.fiscalYearId as string | undefined})
     ORDER BY "organization_id" ASC, "financial_area_id" ASC,
              "fiscal_year_id" ASC, "accounting_period_id" ASC,
              "account_id" ASC
     FOR UPDATE`;
  return rows.map((r) => r.id);
}

function balanceProjectionKeyOf(key: {
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  accountId: string;
}): string {
  return [
    key.organizationId,
    key.financialAreaId,
    key.fiscalYearId,
    key.accountingPeriodId,
    key.accountId,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Accounting documents (Task 10.4) + ledger materialization (Task 10.7)
// ---------------------------------------------------------------------------
//
// Task 10.7 adds NO new lock and NO new lock order: the ledger entries are
// INSERTed inside the finalization transaction, between the state update and
// the operation-ledger insert (which stays LAST, the §16.4 evidence rule), so
// they ride the locks that transaction already holds. The document row lock
// serializes concurrent finalizations of one voucher; the UNIQUE backstop on
// `ledger_entries.voucher_line_id` makes a second entry for one line
// impossible to persist even across separate transactions (a hand-written row
// colliding with a finalization aborts that finalization, loudly). Fresh
// INSERTs under an already-held document lock cannot deadlock: no path waits
// on a ledger row, so there is no cycle to order against.

/**
 * A locked accounting-document row: everything the document guards read
 * (scope, the resolved calendar, the number, the phase, the origin).
 */
export interface LockedAccountingDocument {
  id: string;
  organizationId: string;
  financialAreaId: string;
  fiscalYearId: string;
  accountingPeriodId: string;
  documentType: string;
  documentNumber: string | null;
  documentDate: Date;
  description: string;
  state: string;
  origin: string;
  branchId: string | null;
  correctionKind: string | null;
  correctionReason: string | null;
  reversesDocumentId: string | null;
  reversedByDocumentId: string | null;
}

/**
 * Lock one accounting-document row. The lock is held until commit, so the
 * phase the guard evaluated is the phase the write applies to: a concurrent
 * edit/issuance/finalization/deletion of the same voucher serializes here and
 * the loser re-evaluates against the winner's committed row.
 *
 * This lock is taken LAST in every document-write transaction — after the
 * area → year → period → account locks — because it is the only row a
 * voucher write takes that no calendar/account write ever waits for, so the
 * global order `area → year → period → account → document` stays acyclic
 * (a document lock never precedes a calendar lock anywhere).
 *
 * @returns null when the row does not exist. A pre-final voucher may be
 *   deleted concurrently (§15.3), so a null answer is an ordinary outcome the
 *   service maps to 404 — not, as with the calendar rows, a bug.
 */
export async function lockAccountingDocumentRow(
  tx: AccountingTxClient,
  documentId: string,
): Promise<LockedAccountingDocument | null> {
  const rows = await tx.$queryRaw<LockedAccountingDocument>`
    SELECT "id"                   AS "id",
           "organization_id"      AS "organizationId",
           "financial_area_id"    AS "financialAreaId",
           "fiscal_year_id"       AS "fiscalYearId",
           "accounting_period_id" AS "accountingPeriodId",
           "document_type"        AS "documentType",
           "document_number"      AS "documentNumber",
           "document_date"        AS "documentDate",
           "description"          AS "description",
           "state"                AS "state",
           "origin"               AS "origin",
           "branch_id"            AS "branchId",
           "correction_kind"      AS "correctionKind",
           "correction_reason"    AS "correctionReason",
           "reverses_document_id" AS "reversesDocumentId",
           "reversed_by_document_id" AS "reversedByDocumentId"
      FROM "accounting"."accounting_documents"
     WHERE "id" = ${documentId}
     FOR UPDATE`;
  const [row] = rows;
  return row ?? null;
}

/** A locked account row: the usability the line guard re-evaluates. */
export interface LockedAccountUsage {
  id: string;
  organizationId: string;
  code: string;
  isPostable: boolean;
  isActive: boolean;
}

/**
 * Lock one account row FOR SHARE while a voucher's lines reference it.
 *
 * This is what makes AC-I-09 ("only postable, active accounts may receive
 * lines") and AC-I-11 ("an account is frozen once a document line references
 * it") hold against each other under concurrency:
 *
 * - the write path takes this lock BEFORE it re-evaluates postability/activity,
 *   so the values it validates are the committed ones (PostgreSQL re-reads the
 *   row after any wait — a concurrent postability flip is therefore either
 *   committed and seen, or blocked until this transaction ends);
 * - the account guard transaction takes `FOR UPDATE` on the same row and
 *   counts referencing lines under that lock, so a flip cannot commit while a
 *   line insert is in flight, and a line insert cannot commit while a flip
 *   holds the row.
 *
 * `FOR SHARE` is chosen over the weaker `FOR KEY SHARE` because it conflicts
 * with every account write path (`FOR UPDATE` / `FOR NO KEY UPDATE`), and over
 * `FOR UPDATE` because a voucher must never block two other vouchers that
 * merely share an account.
 *
 * Locks are always taken ascending by id (the caller sorts), and this lock is
 * taken after the area → year → period locks, never before them.
 *
 * @returns null when the row does not exist (the service maps a missing or
 *   foreign account to 404, AC-I-16).
 */
export async function lockAccountRowForShare(
  tx: AccountingTxClient,
  accountId: string,
): Promise<LockedAccountUsage | null> {
  const rows = await tx.$queryRaw<LockedAccountUsage>`
    SELECT "id"             AS "id",
           "organization_id" AS "organizationId",
           "code"           AS "code",
           "is_postable"    AS "isPostable",
           "is_active"      AS "isActive"
      FROM "accounting"."accounts"
     WHERE "id" = ${accountId}
     FOR SHARE`;
  const [row] = rows;
  return row ?? null;
}
