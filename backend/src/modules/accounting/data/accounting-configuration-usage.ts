import type { AccountConfigurationPin } from '../domain/accounting-configuration-freeze.js';
import { resolveUsedConfigurationIds } from '../domain/accounting-configuration-freeze.js';
import type { AccountingTxClient, RawQuery } from './accounting-rows.js';

/**
 * Operational-freeze MARKING — the data layer of the Task 11 D4 seam, wired by
 * Task 13 (Operational Freeze Integration).
 *
 * ONE statement writes the marker, and it is written ONLY inside the
 * transaction that commits the durable effect it records. There is no second
 * posting path, no event handler, no worker, no endpoint and no public service
 * that marks usage on request: `AccountingDocumentsRepository.finalizeChecked`
 * is the single production caller, because finalization IS posting
 * (AC-D-23 — `final` means "in the books") and is the only writer of
 * `ledger_entries`.
 *
 * WHY IT SITS HERE (and not one layer up)
 *
 * `PostingService` deliberately opens no transaction (its own header: a second
 * boundary "would either widen the lock scope or split the effect from its
 * evidence — both are forbidden"). Marking above the repository would therefore
 * create exactly the hole Task 11 refused to leave: a crash between "ledger
 * committed" and "marker written" would show a used configuration as unused and
 * make the freeze guarantee silently void. Marking inside `finalizeChecked`
 * makes the marker and the ledger entries ONE atomic fact: a finalization that
 * fails, is refused or rolls back leaves `operationally_used_at` NULL, and a
 * committed one cannot have missed the mark.
 *
 * LOCK POSITION (the issue `task-11-mark-operationally-used-decision-note.md` §3
 * blocked on, resolved against the accepted order rather than by inventing one)
 *
 * The module's global order already places configurations between the calendar
 * and the accounts:
 * `area → year → period → coding_structure_version / accounting_configuration →
 * account → account_balance_projections → accounting_document`
 * (`docs/accounting/lock-order-matrix.md` §1). The marker is an `UPDATE`, i.e.
 * an exclusive configuration-row lock, so it is executed BEFORE
 * `lockAccountsForLinesInTx` takes the accounts `FOR SHARE` — never after the
 * document lock. The UPDATE is issued per configuration id in ascending order,
 * the module's standard multi-row discipline. No path can invert the pair:
 * chart writers that lock a configuration row (root create, publish, draft
 * write, delete) all take it before any account row and none of them waits on a
 * document or projection row.
 *
 * IDEMPOTENCY / CONCURRENCY — first use wins, exactly as §5 of the decision
 * note prescribes: `AND "operationally_used_at" IS NULL` makes the statement a
 * single guarded write, not a read-then-write. Two concurrent finalizations that
 * both touch one configuration: the first commits the timestamp, the second
 * blocks on the row lock and then matches ZERO rows against the winner's
 * committed version (PostgreSQL re-evaluates the predicate after a lock wait) —
 * so no later timestamp ever overwrites the first one, no usage evidence is
 * duplicated, and a replay never re-marks (a replay returns before the
 * transaction is ever opened, §16.4).
 *
 * ORGANIZATION ISOLATION
 *
 * The `organization_id` predicate is part of the write, not an afterthought: a
 * configuration of another organization is never marked even if its id is
 * handed to the seam. The read is scoped twice (line and account), so a foreign
 * account cannot contribute a pin.
 *
 * Parameterized raw SQL only — the same documented exemption the module's row
 * locks carry (AR-11, `docs/modules.md` §Accounting): Prisma cannot express the
 * guarded `WHERE … IS NULL` write and the `RETURNING` in one statement through
 * this repository's typed delegates, and two statements would re-open the race
 * this file exists to close.
 */

/** A client that can run the module's parameterized raw statements. */
type RawClient = { $queryRaw: RawQuery };

/**
 * The configuration pins of the accounts one document's lines reference.
 *
 * Deliberately unlocked and set-based: the authoritative validation of every
 * referenced account (existence, organization, postability, activity) is the
 * `FOR SHARE` pass that follows, and the line-set check inside the document
 * lock proves this read still describes the same lines — the same
 * read-then-verify discipline Task 12's projection keys use. A row that
 * disappeared in between is not skipped: it makes
 * {@link resolveUsedConfigurationIds} refuse the whole operation.
 */
export async function configurationPinsOfDocumentLinesInTx(
  tx: AccountingTxClient,
  input: { organizationId: string; documentId: string },
): Promise<AccountConfigurationPin[]> {
  return tx.$queryRaw<{
    accountId: string;
    accountingConfigurationId: string | null;
  }>`
    SELECT ln."account_id"                     AS "accountId",
           acc."accounting_configuration_id"   AS "accountingConfigurationId"
      FROM "accounting"."accounting_document_lines" ln
      JOIN "accounting"."accounts" acc ON acc."id" = ln."account_id"
     WHERE ln."document_id"    = ${input.documentId}
       AND ln."organization_id" = ${input.organizationId}
       AND acc."organization_id" = ${input.organizationId}
     ORDER BY ln."line_no" ASC, ln."id" ASC`;
}

/**
 * Mark every configuration a posted document used, or refuse.
 *
 * Composes the three steps of the rule and owns nothing else: read the pins →
 * resolve the set through the domain (`resolveUsedConfigurationIds`, the only
 * place "which configuration did this use" is answered) → write the marker.
 *
 * @returns the configuration ids whose marker THIS call set (already-used
 *   configurations are absent — they were marked by the use that came first).
 */
export async function markConfigurationsUsedByDocumentInTx(
  tx: AccountingTxClient,
  input: {
    organizationId: string;
    documentId: string;
    /** The document's referenced account ids, deduplicated + ascending. */
    accountIds: readonly string[];
    now: Date;
    actorId: string | null;
  },
): Promise<string[]> {
  const pins = await configurationPinsOfDocumentLinesInTx(tx, {
    organizationId: input.organizationId,
    documentId: input.documentId,
  });
  const configurationIds = resolveUsedConfigurationIds({
    accountIds: input.accountIds,
    pins,
  });
  return markConfigurationsUsedInDb(tx, {
    organizationId: input.organizationId,
    configurationIds,
    now: input.now,
    actorId: input.actorId,
  });
}

/**
 * The module's ONE writer of `operationally_used_at`.
 *
 * One guarded statement per configuration, ascending by id:
 * `SET operationally_used_at = :now … WHERE operationally_used_at IS NULL`.
 * First use wins, the write is organization-scoped, and the returned ids are
 * exactly the rows this call transitioned (so a replay or a concurrent loser
 * reports nothing it did not do).
 */
export async function markConfigurationsUsedInDb(
  client: RawClient,
  input: {
    organizationId: string;
    configurationIds: readonly string[];
    now: Date;
    actorId: string | null;
  },
): Promise<string[]> {
  const ids = [...new Set(input.configurationIds)].sort();
  const marked: string[] = [];
  for (const configurationId of ids) {
    const rows = await client.$queryRaw<{ id: string }>`
      UPDATE "accounting"."accounting_configurations"
         SET "operationally_used_at" = ${input.now},
             "updated_at"            = ${input.now},
             "updated_by"            = ${input.actorId}
       WHERE "id" = ${configurationId}
         AND "organization_id" = ${input.organizationId}
         AND "operationally_used_at" IS NULL
      RETURNING "id"`;
    for (const row of rows) {
      marked.push(row.id);
    }
  }
  return marked;
}
