#!/usr/bin/env node
/**
 * Task 13 — operational-freeze marker rehearsal on a REAL PostgreSQL.
 *
 * WHY THIS EXISTS
 *
 * Task 11's decision note
 * (`docs/accounting/task-11-mark-operationally-used-decision-note.md`) left the
 * marker unwired on two grounds: which configuration a voucher freezes, and
 * where the marker write sits in the module's lock order. Both were argued on
 * paper; Task 13 answers them in code, and this script proves the parts that only
 * a real server can prove — statement validity, first-use-wins under a LOCK WAIT
 * between two sessions, rollback of the marker with a rolled-back finalization,
 * and the deadlock behaviour of the chosen lock position versus the inverted one.
 *
 * WHAT IT EXECUTES
 *
 * Not a paraphrase: the two SQL statements are READ OUT of
 * `src/modules/accounting/data/accounting-configuration-usage.ts`, their tagged
 * template placeholders are turned into positional parameters in order of
 * appearance (exactly what Prisma's `$queryRaw` does), and those texts run against
 * the migrated schema. If the shipped statement changes shape, this rehearsal
 * stops matching it and fails loudly (section 0).
 *
 * HOW IT SYNCHRONIZES
 *
 * No probe relies on a `sleep` lining up with the scheduler. Where an interleaving
 * has to be forced, the script POLLS `pg_stat_activity` for the lock wait it wants
 * to create and only then continues — so a check either demonstrates real
 * contention or fails. (`SELECT … FOR UPDATE` row locks are not in `pg_locks`; a
 * blocked session is what `wait_event_type = 'Lock'` reports.)
 *
 * USAGE
 *
 *   DATABASE_URL=postgresql://… node \
 *     prisma/rehearsal/task-13-operational-freeze/rehearse.mjs
 *   (or `npm run test:operational-freeze-rehearsal`, which also runs
 *    `backfill-repair-probe.mjs`)
 *
 * Requires a database with ALL migrations applied (the precondition of the live
 * suites). It seeds its own throwaway organization and deletes every row it
 * inserted in a `finally` block; it never mutates rows it did not create.
 *
 * EVIDENCE LABELS (report `docs/task-13-implementation-report.md` §5.2/§10)
 *
 * This script exercises the DATA layer on a real server. It does not run the
 * NestJS services, the RBAC guards or the Prisma delegate plumbing — those stay
 * with the unit suites and the live e2e specs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE_SOURCE = path.join(
  HERE,
  '../../../src/modules/accounting/data/accounting-configuration-usage.ts',
);
const connectionString =
  process.env['DATABASE_URL'] ?? process.env['VARDENA_TEST_DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  console.error(
    'DATABASE_URL (or VARDENA_TEST_DATABASE_URL) is required: a migrated PostgreSQL.',
  );
  process.exit(2);
}

const results = [];
let failures = 0;
function check(label, ok, detail = '') {
  results.push({ label, ok, detail });
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} — ${label}${detail === '' ? '' : ` — ${detail}`}`,
  );
}
function section(title) {
  console.log(`\n=== ${title} ===`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Fixture identities. Every row is created and deleted by this script.
// ---------------------------------------------------------------------------

const suffix = Date.now().toString(36).toUpperCase();
const id = (kind) => `T13${kind}${suffix}`.padEnd(26, '0');
const ORG_A = id('ORGA');
const ORG_B = id('ORGB');
const AREA_A = id('AREA');
const YEAR_A = id('YEAR');
const PERIOD_A = id('PERD');
const STRUCT_A = id('STRU');
const CONFIG_ACTIVE = id('CFGA');
const CONFIG_SUPERSEDED = id('CFGB');
const CONFIG_FOREIGN = id('CFGF');
const ACCOUNT_DEBIT = id('ACCD');
const ACCOUNT_CREDIT = id('ACCC');
const ACCOUNT_LEGACY = id('ACCL');
const DOC_TEMP = id('DOCT');
const DOC_FINAL = id('DOCF');
const LINE_1 = id('LIN1');
const LINE_2 = id('LIN2');
const LINE_3 = id('LIN3');
const LINE_F1 = id('LNF1');
const LINE_F2 = id('LNF2');
const DOC_TEMP_NUMBER = `91${suffix}`;
const DOC_FINAL_NUMBER = `92${suffix}`;
const MARKER_STAMP = new Date('2026-04-05T06:00:00.000Z');
const LATER_STAMP = new Date('2027-01-01T00:00:00.000Z');

let markerSql = '';
let pinsSql = '';

// ---------------------------------------------------------------------------
// The shipped statements, extracted from the TypeScript source.
// ---------------------------------------------------------------------------

/** Every `${…}` placeholder becomes $1…$n, in order of appearance. */
function toPositional(template) {
  let index = 0;
  return template
    .replace(/\$\{[^}]*\}/g, () => `$${(index += 1)}`)
    .replace(/\s+/g, ' ')
    .trim();
}

function shippedStatements() {
  const source = readFileSync(USAGE_SOURCE, 'utf8');
  const templates = [...source.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
  const marker = templates.find((t) =>
    t.includes('UPDATE "accounting"."accounting_configurations"'),
  );
  const pins = templates.find((t) =>
    t.includes('FROM "accounting"."accounting_document_lines"'),
  );
  if (marker === undefined || pins === undefined) {
    throw new Error(
      'accounting-configuration-usage.ts no longer contains the marker/pins statements — update the rehearsal.',
    );
  }
  return { marker: toPositional(marker), pins: toPositional(pins) };
}

// ---------------------------------------------------------------------------
// Statement wrappers + observation helpers.
// ---------------------------------------------------------------------------

const pool = new pg.Pool({ connectionString, max: 6 });

const q = (client, sql, params = []) => client.query(sql, params);

/** The marker exactly as `markConfigurationsUsedInDb` issues it. */
const marker = (client, configurationId, organizationId, now, actorId) =>
  client.query(markerSql, [now, now, actorId, configurationId, organizationId]);

/** The pin read exactly as `configurationPinsOfDocumentLinesInTx` issues it. */
const pins = (client, documentId, organizationId) =>
  client.query(pinsSql, [documentId, organizationId, organizationId]);

const usedAt = (client, configurationId) =>
  client
    .query(
      `SELECT operationally_used_at, updated_by FROM accounting.accounting_configurations
      WHERE id = $1`,
      [configurationId],
    )
    .then((r) => r.rows[0] ?? null);

const backendPid = (client) =>
  q(client, 'SELECT pg_backend_pid() AS pid').then((r) =>
    Number(r.rows[0]?.pid ?? -1),
  );

/** Put the rehearsal organization's configurations back to "unused". */
const resetUsage = (client) =>
  client.query(
    `UPDATE accounting.accounting_configurations
        SET operationally_used_at = NULL, updated_by = NULL
      WHERE organization_id = $1`,
    [ORG_A],
  );

/**
 * Wait until a session IS (or is NOT) blocked on a lock, bounded by `timeoutMs`.
 *
 * `SELECT … FOR UPDATE` row locks are not visible in `pg_locks` (they live in the
 * tuple header), so `pg_stat_activity.wait_event_type = 'Lock'` is the observable
 * signal that a wait really happened. Polling it is a positive synchronization:
 * the probe continues only on the state it wants to demonstrate, and the caller
 * turns a `false` into a failed check instead of a silent pass.
 */
async function waitLockState(client, pid, wantBlocked, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await client.query(
      `SELECT (wait_event_type = 'Lock') AS blocked
         FROM pg_stat_activity WHERE pid = $1`,
      [pid],
    );
    if ((r.rows[0]?.blocked === true) === wantBlocked) return true;
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
}

const lockConfigsForUpdate = (client, organizationId) =>
  client.query(
    `SELECT id FROM accounting.accounting_configurations
      WHERE organization_id = $1 ORDER BY id ASC FOR UPDATE`,
    [organizationId],
  );
const lockAccountShare = (client, accountId) =>
  client.query(`SELECT id FROM accounting.accounts WHERE id = $1 FOR SHARE`, [
    accountId,
  ]);
const touchAccount = (client, accountId, tag) =>
  client.query(`UPDATE accounting.accounts SET title = $2 WHERE id = $1`, [
    accountId,
    tag,
  ]);

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seed() {
  const c = await pool.connect();
  try {
    for (const [org, code] of [
      [ORG_A, `T13A${suffix}`],
      [ORG_B, `T13B${suffix}`],
    ]) {
      await q(
        c,
        `INSERT INTO organization.organizations (id, code, name, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, true, now(), now())`,
        [org, code, `Rehearsal org ${code}`],
      );
    }
    await q(
      c,
      `INSERT INTO accounting.financial_areas
         (id, organization_id, code, title, is_active, is_default, created_at, updated_at)
       VALUES ($1, $2, 'GA', 'General area', true, false, now(), now())`,
      [AREA_A, ORG_A],
    );
    await q(
      c,
      `INSERT INTO accounting.fiscal_years
         (id, organization_id, financial_area_id, code, title, start_date, end_date,
          status, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, 'Y1405', 'Year 1405', DATE '2026-01-01', DATE '2026-12-31',
               'open', true, now(), now())`,
      [YEAR_A, ORG_A, AREA_A],
    );
    await q(
      c,
      `INSERT INTO accounting.accounting_periods
         (id, organization_id, financial_area_id, fiscal_year_id, sequence, title,
          start_date, end_date, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, 'Whole year', DATE '2026-01-01', DATE '2026-12-31',
               'open', now(), now())`,
      [PERIOD_A, ORG_A, AREA_A, YEAR_A],
    );
    await q(
      c,
      `INSERT INTO accounting.coding_structure_versions
         (id, organization_id, code, version_number, status, max_depth, separator,
          created_at, updated_at)
       VALUES ($1, $2, 'DEFAULT', 1, 'active', 1, '', now(), now())`,
      [STRUCT_A, ORG_A],
    );
    // The mixed-configuration shape the Task 11 backfill produces: an ACTIVE
    // DEFAULT and a SUPERSEDED LEGACY, both pinned by accounts of ONE voucher.
    await q(
      c,
      `INSERT INTO accounting.accounting_configurations
         (id, organization_id, code, name, version_number, status, effective_from,
          operationally_used_at, created_at, updated_at)
       VALUES ($1, $2, 'DEFAULT', 'Main', 1, 'ACTIVE', NULL, NULL, now(), now()),
              ($3, $2, 'LEGACY', 'Legacy', 1, 'SUPERSEDED', NULL, NULL, now(), now())`,
      [CONFIG_ACTIVE, ORG_A, CONFIG_SUPERSEDED],
    );
    // A configuration owned by ANOTHER organization, for the scope probes.
    await q(
      c,
      `INSERT INTO accounting.accounting_configurations
         (id, organization_id, code, name, version_number, status, created_at, updated_at)
       VALUES ($1, $2, 'FOREIGN', 'Other org config', 1, 'ACTIVE', now(), now())`,
      [CONFIG_FOREIGN, ORG_B],
    );
    for (const [accountId, code, configurationId] of [
      [ACCOUNT_DEBIT, '1000', CONFIG_ACTIVE],
      [ACCOUNT_CREDIT, '2000', CONFIG_ACTIVE],
      [ACCOUNT_LEGACY, '2100', CONFIG_SUPERSEDED],
    ]) {
      await q(
        c,
        `INSERT INTO accounting.accounts
           (id, organization_id, code, title, account_nature, is_postable, is_active,
            level, coding_structure_version_id, accounting_configuration_id,
            created_at, updated_at)
         VALUES ($1, $2, $3, 'Rehearsal account', 'debit', true, true, 1, $4, $5,
                 now(), now())`,
        [accountId, ORG_A, code, STRUCT_A, configurationId],
      );
    }
    // Two temporary vouchers: one mixed-configuration (3 lines, 2
    // configurations) for the pins read, one simple (2 lines) for the
    // whole-finalization probes.
    for (const [docId, documentNumber] of [
      [DOC_TEMP, DOC_TEMP_NUMBER],
      [DOC_FINAL, DOC_FINAL_NUMBER],
    ]) {
      await q(
        c,
        `INSERT INTO accounting.accounting_documents
           (id, organization_id, financial_area_id, fiscal_year_id, accounting_period_id,
            document_type, document_number, document_date, description, state, origin,
            finalized_at, finalized_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'accounting_voucher', $6, DATE '2026-04-05',
                 'Rehearsal voucher', 'temporary', 'manual', NULL, NULL, now(), now())`,
        [docId, ORG_A, AREA_A, YEAR_A, PERIOD_A, documentNumber],
      );
    }
    const lines = [
      [LINE_1, DOC_TEMP, ACCOUNT_DEBIT, 1, '0.20', '0'],
      [LINE_2, DOC_TEMP, ACCOUNT_CREDIT, 2, '0', '0.10'],
      [LINE_3, DOC_TEMP, ACCOUNT_LEGACY, 3, '0', '0.10'],
      [LINE_F1, DOC_FINAL, ACCOUNT_DEBIT, 1, '0.10', '0'],
      [LINE_F2, DOC_FINAL, ACCOUNT_CREDIT, 2, '0', '0.10'],
    ];
    for (const [lineId, docId, accountId, lineNo, debit, credit] of lines) {
      await q(
        c,
        `INSERT INTO accounting.accounting_document_lines
           (id, document_id, organization_id, financial_area_id, fiscal_year_id,
            accounting_period_id, line_no, account_id, debit_amount, credit_amount,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric,
                 now(), now())`,
        [
          lineId,
          docId,
          ORG_A,
          AREA_A,
          YEAR_A,
          PERIOD_A,
          lineNo,
          accountId,
          debit,
          credit,
        ],
      );
    }
  } finally {
    c.release();
  }
}

async function insertLedgerRow(
  client,
  entryId,
  docId,
  lineId,
  accountId,
  lineNo,
) {
  await q(
    client,
    `INSERT INTO accounting.ledger_entries
       (id, organization_id, financial_area_id, fiscal_year_id, accounting_period_id,
        voucher_id, voucher_number, voucher_line_id, line_no, account_id,
        debit_amount, credit_amount, document_date, posting_timestamp, origin,
        created_at, updated_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0.10, 0,
             DATE '2026-04-05', $11, 'manual', now(), now(), 'finalizer')`,
    [
      entryId,
      ORG_A,
      AREA_A,
      YEAR_A,
      PERIOD_A,
      docId,
      DOC_FINAL_NUMBER,
      lineId,
      lineNo,
      accountId,
      MARKER_STAMP,
    ],
  );
}

// ---------------------------------------------------------------------------
// The rehearsal
// ---------------------------------------------------------------------------

async function main() {
  section('0. the rehearsal runs the SHIPPED statements');
  const shipped = shippedStatements();
  markerSql = shipped.marker;
  pinsSql = shipped.pins;
  check(
    'marker statement is the guarded single write',
    markerSql.includes('"operationally_used_at" IS NULL') &&
      markerSql.includes('"organization_id" = $5') &&
      markerSql.includes('RETURNING "id"'),
    `${markerSql.slice(0, 64)}…`,
  );
  check(
    'pins statement is an unlocked, twice-scoped read',
    !/FOR (UPDATE|SHARE)/.test(pinsSql) &&
      (pinsSql.match(/"organization_id" = \$\d/g) ?? []).length === 2,
  );

  const admin = await pool.connect();
  try {
    const column = await q(
      admin,
      `SELECT is_nullable, data_type, datetime_precision
         FROM information_schema.columns
        WHERE table_schema = 'accounting'
          AND table_name = 'accounting_configurations'
          AND column_name = 'operationally_used_at'`,
    );
    check(
      'the marker column exists as the accepted nullable timestamptz(6)',
      column.rows[0]?.data_type === 'timestamp with time zone' &&
        column.rows[0]?.is_nullable === 'YES' &&
        column.rows[0]?.datetime_precision === 6,
      JSON.stringify(column.rows[0] ?? null),
    );
    const usageTable = await q(
      admin,
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema = 'accounting' AND table_name LIKE '%usage%'`,
    );
    check(
      'no usage table was introduced (the mark rides the configuration row)',
      (usageTable.rows[0]?.n ?? 0) === 0,
    );

    section('1. fixture');
    await seed();
    check(
      'seeded two organizations, two configurations, three accounts, two vouchers',
      true,
    );

    section('2. pins read: which configurations a document used');
    const read = await pins(admin, DOC_TEMP, ORG_A);
    const resolved = [
      ...new Set(read.rows.map((row) => row.accountingConfigurationId)),
    ].sort();
    check(
      'the mixed-configuration voucher resolves to BOTH pinned configurations',
      read.rows.length === 3 &&
        resolved.length === 2 &&
        resolved.includes(CONFIG_ACTIVE) &&
        resolved.includes(CONFIG_SUPERSEDED),
      `rows=${read.rows.length} configurations=${resolved.length}`,
    );
    const foreign = await pins(admin, DOC_TEMP, ORG_B);
    check(
      'the same document read under another organization resolves to NOTHING',
      foreign.rows.length === 0,
    );

    section('3. guarded marker write: idempotency and organization scope');
    const first = await marker(
      admin,
      CONFIG_ACTIVE,
      ORG_A,
      MARKER_STAMP,
      'actor-1',
    );
    const stamped = await usedAt(admin, CONFIG_ACTIVE);
    check(
      'first use marks exactly one row, with the caller’s clock and actor',
      first.rowCount === 1 &&
        new Date(stamped?.operationally_used_at ?? 0).toISOString() ===
          MARKER_STAMP.toISOString() &&
        stamped?.updated_by === 'actor-1',
      `rowCount=${first.rowCount}`,
    );
    const replay = await marker(
      admin,
      CONFIG_ACTIVE,
      ORG_A,
      LATER_STAMP,
      'actor-2',
    );
    const afterReplay = await usedAt(admin, CONFIG_ACTIVE);
    check(
      'a repeated mark touches 0 rows and cannot move the first timestamp',
      replay.rowCount === 0 &&
        new Date(afterReplay?.operationally_used_at ?? 0).toISOString() ===
          MARKER_STAMP.toISOString(),
      `rowCount=${replay.rowCount}`,
    );
    const wrongOrg = await marker(
      admin,
      CONFIG_ACTIVE,
      ORG_B,
      LATER_STAMP,
      null,
    );
    check(
      'the statement cannot mark a configuration outside the given organization',
      wrongOrg.rowCount === 0 &&
        new Date(
          (await usedAt(admin, CONFIG_ACTIVE))?.operationally_used_at ?? 0,
        ).toISOString() === MARKER_STAMP.toISOString(),
    );
    const foreignRow = await marker(
      admin,
      CONFIG_FOREIGN,
      ORG_A,
      MARKER_STAMP,
      null,
    );
    check(
      'a row id owned by another organization is never matched',
      foreignRow.rowCount === 0 &&
        (await usedAt(admin, CONFIG_FOREIGN))?.operationally_used_at === null,
    );

    section('4. rollback: an aborted finalization leaves no usage state');
    await q(admin, 'BEGIN');
    await marker(
      admin,
      CONFIG_SUPERSEDED,
      ORG_A,
      MARKER_STAMP,
      'actor-rollback',
    );
    check(
      'inside the transaction the mark is visible',
      (await usedAt(admin, CONFIG_SUPERSEDED))?.operationally_used_at !== null,
    );
    await q(admin, 'ROLLBACK');
    check(
      'after ROLLBACK the configuration is unused again',
      (await usedAt(admin, CONFIG_SUPERSEDED))?.operationally_used_at === null,
    );

    section('5. two sessions, one row: first use wins under a real lock wait');
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await q(a, 'BEGIN');
      await marker(a, CONFIG_SUPERSEDED, ORG_A, MARKER_STAMP, 'session-A');
      const bPid = await backendPid(b);
      const bRun = b.query(markerSql, [
        LATER_STAMP,
        LATER_STAMP,
        'session-B',
        CONFIG_SUPERSEDED,
        ORG_A,
      ]);
      // B must be SEEN waiting before A commits — otherwise "the loser updates 0
      // rows" would only prove that two sequential updates are sequential.
      const blocked = await waitLockState(admin, bPid, true);
      check(
        'the second session blocks on the row lock the first holds',
        blocked,
        `pid=${bPid}`,
      );
      const raced = await marker(
        a,
        CONFIG_SUPERSEDED,
        ORG_A,
        MARKER_STAMP,
        'session-A',
      );
      check(
        'a second write inside the same transaction still matches 0 rows',
        raced.rowCount === 0,
      );
      await q(a, 'COMMIT');
      const bResult = await bRun;
      const settled = await usedAt(admin, CONFIG_SUPERSEDED);
      check(
        'after the winner commits the loser updates 0 rows and the FIRST timestamp survives',
        bResult.rowCount === 0 &&
          new Date(settled?.operationally_used_at ?? 0).toISOString() ===
            MARKER_STAMP.toISOString() &&
          settled?.updated_by === 'session-A',
        `rowCount=${bResult.rowCount} actor=${settled?.updated_by}`,
      );
    } finally {
      await q(a, 'ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }

    section('6. a rolled-back first writer lets the next real use mark');
    await resetUsage(admin);
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await q(c1, 'BEGIN');
      await marker(
        c1,
        CONFIG_SUPERSEDED,
        ORG_A,
        MARKER_STAMP,
        'aborted-writer',
      );
      await q(c1, 'ROLLBACK');
      const next = await marker(
        c2,
        CONFIG_SUPERSEDED,
        ORG_A,
        LATER_STAMP,
        'next-writer',
      );
      check(
        'after the abort the column is NULL again, so a later real use marks it',
        next.rowCount === 1,
        `rowCount=${next.rowCount}`,
      );
    } finally {
      c1.release();
      c2.release();
      await resetUsage(admin);
    }

    section(
      '7. lock position: configuration→accounts (shipped) vs accounts→configuration',
    );
    // Both probes FORCE the interesting interleaving and observe it. The shipped
    // order is marker-then-accounts, which agrees with the chart's own
    // configuration-before-account order (A1/A5); the inversion creates a cycle.
    const probeRun = async (ordered) => {
      await resetUsage(admin);
      const finalize = await pool.connect();
      const chart = await pool.connect();
      const errors = [];
      let waitsObserved = 0;
      let fPid = -1;
      let gPid = -1;
      try {
        fPid = await backendPid(finalize);
        gPid = await backendPid(chart);
        await q(finalize, 'BEGIN');
        if (ordered) {
          await marker(finalize, CONFIG_ACTIVE, ORG_A, MARKER_STAMP, 'probe');
          const chartPromise = (async () => {
            await q(chart, 'BEGIN');
            await lockConfigsForUpdate(chart, ORG_A);
            await touchAccount(chart, ACCOUNT_DEBIT, 'probe-chart');
            await q(chart, 'COMMIT');
          })().catch((error) => errors.push(error.code ?? error.message));
          // The chart writer waits on the marker…
          if (await waitLockState(admin, gPid, true)) waitsObserved += 1;
          // …while the finalize takes its account lock and commits.
          await lockAccountShare(finalize, ACCOUNT_DEBIT);
          await q(finalize, 'COMMIT');
          await chartPromise;
        } else {
          // The inversion: finalize locks the account first, then wants the
          // configuration the chart holds, while the chart (having taken the
          // configuration) wants the account the finalize holds.
          await lockAccountShare(finalize, ACCOUNT_DEBIT);
          await q(chart, 'BEGIN');
          await lockConfigsForUpdate(chart, ORG_A);
          const markerPromise = marker(
            finalize,
            CONFIG_ACTIVE,
            ORG_A,
            MARKER_STAMP,
            'probe',
          )
            .then(() => q(finalize, 'COMMIT'))
            .catch((error) => errors.push(error.code ?? error.message));
          if (await waitLockState(admin, fPid, true)) waitsObserved += 1;
          const chartPromise = touchAccount(chart, ACCOUNT_DEBIT, 'probe-chart')
            .then(() => q(chart, 'COMMIT'))
            .catch((error) => errors.push(error.code ?? error.message));
          if (await waitLockState(admin, gPid, true)) waitsObserved += 1;
          await Promise.all([markerPromise, chartPromise]);
        }
      } catch (error) {
        errors.push(error.code ?? error.message);
      } finally {
        for (const client of [finalize, chart]) {
          await q(client, 'ROLLBACK').catch(() => undefined);
          client.release();
        }
        await resetUsage(admin);
      }
      return { errors, waitsObserved };
    };
    const orderedRun = await probeRun(true);
    check(
      'shipped order: contention is REAL (the chart writer waits) and no deadlock occurs',
      orderedRun.waitsObserved === 1 && !orderedRun.errors.includes('40P01'),
      `waits=${orderedRun.waitsObserved} errors=${orderedRun.errors.join(',') || 'none'}`,
    );
    const invertedRun = await probeRun(false);
    check(
      'inverted order: each side waits on the other and PostgreSQL reports a deadlock (40P01)',
      invertedRun.waitsObserved === 2 && invertedRun.errors.includes('40P01'),
      `waits=${invertedRun.waitsObserved} errors=${invertedRun.errors.join(',') || 'none'}`,
    );

    section(
      '8. the whole finalization-shaped transaction (marker + ledger + evidence)',
    );
    await resetUsage(admin);
    const finalize = await pool.connect();
    try {
      await q(finalize, 'BEGIN');
      await q(
        finalize,
        `SELECT id FROM accounting.financial_areas WHERE id = $1 FOR UPDATE`,
        [AREA_A],
      );
      await q(
        finalize,
        `SELECT id FROM accounting.fiscal_years WHERE id = $1 FOR UPDATE`,
        [YEAR_A],
      );
      await q(
        finalize,
        `SELECT id FROM accounting.accounting_periods WHERE id = $1 FOR UPDATE`,
        [PERIOD_A],
      );
      const docPins = await pins(finalize, DOC_FINAL, ORG_A);
      const docConfigurations = [
        ...new Set(docPins.rows.map((row) => row.accountingConfigurationId)),
      ]
        .filter((value) => value !== null)
        .sort();
      for (const configurationId of docConfigurations) {
        await marker(
          finalize,
          configurationId,
          ORG_A,
          MARKER_STAMP,
          'finalizer',
        );
      }
      await lockAccountShare(finalize, ACCOUNT_DEBIT);
      await lockAccountShare(finalize, ACCOUNT_CREDIT);
      await q(
        finalize,
        `SELECT id FROM accounting.accounting_documents WHERE id = $1 FOR UPDATE`,
        [DOC_FINAL],
      );
      await q(
        finalize,
        `UPDATE accounting.accounting_documents
            SET state = 'final', finalized_at = $2, finalized_by = 'finalizer',
                updated_at = now()
          WHERE id = $1 AND state = 'temporary'`,
        [DOC_FINAL, MARKER_STAMP],
      );
      await insertLedgerRow(
        finalize,
        id('LEF1'),
        DOC_FINAL,
        LINE_F1,
        ACCOUNT_DEBIT,
        1,
      );
      await q(
        finalize,
        `INSERT INTO accounting.ledger_entries
           (id, organization_id, financial_area_id, fiscal_year_id, accounting_period_id,
            voucher_id, voucher_number, voucher_line_id, line_no, account_id,
            debit_amount, credit_amount, document_date, posting_timestamp, origin,
            created_at, updated_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 2, $9, 0, 0.10,
                 DATE '2026-04-05', $10, 'manual', now(), now(), 'finalizer')`,
        [
          id('LEF2'),
          ORG_A,
          AREA_A,
          YEAR_A,
          PERIOD_A,
          DOC_FINAL,
          DOC_FINAL_NUMBER,
          LINE_F2,
          ACCOUNT_CREDIT,
          MARKER_STAMP,
        ],
      );
      await q(
        finalize,
        `INSERT INTO accounting.accounting_posting_operations
           (id, organization_id, operation_key, operation, request_hash, result,
            created_at, updated_at)
         VALUES ($1, $2, $3, 'document_finalize', $4, $5::jsonb, now(), now())`,
        [
          id('OPR'),
          ORG_A,
          `post-${DOC_FINAL}`,
          '0'.repeat(64),
          JSON.stringify({ documentId: DOC_FINAL }),
        ],
      );
      await q(finalize, 'COMMIT');
      const committed = await q(
        admin,
        `SELECT (SELECT state FROM accounting.accounting_documents WHERE id = $1) AS state,
                (SELECT count(*) FROM accounting.ledger_entries WHERE voucher_id = $1) AS entries,
                (SELECT operationally_used_at FROM accounting.accounting_configurations
                  WHERE id = $2) AS marked,
                (SELECT updated_by FROM accounting.accounting_configurations
                  WHERE id = $2) AS actor`,
        [DOC_FINAL, CONFIG_ACTIVE],
      );
      const row = committed.rows[0] ?? {};
      check(
        'a committed finalization leaves the document final, the ledger written and the configuration marked for its finalizer',
        row.state === 'final' &&
          Number(row.entries) === 2 &&
          row.marked !== null &&
          row.actor === 'finalizer',
        JSON.stringify({
          state: row.state,
          entries: row.entries,
          actor: row.actor,
        }),
      );
      const reMarked = await marker(
        admin,
        CONFIG_ACTIVE,
        ORG_A,
        LATER_STAMP,
        'late',
      );
      check(
        'a later voucher over the same configuration keeps the first instant',
        reMarked.rowCount === 0,
      );
    } finally {
      await q(finalize, 'ROLLBACK').catch(() => undefined);
      finalize.release();
    }

    section('9. the same transaction, aborted by the 1:1 ledger backstop');
    const failing = await pool.connect();
    try {
      await q(failing, 'BEGIN');
      await marker(failing, CONFIG_SUPERSEDED, ORG_A, MARKER_STAMP, 'aborted');
      await q(
        failing,
        `UPDATE accounting.accounting_documents SET state = 'final', finalized_at = $2
          WHERE id = $1`,
        [DOC_TEMP, MARKER_STAMP],
      );
      // Collide with the entry already committed for DOC_FINAL's line 1: the
      // UNIQUE (voucher_line_id) backstop aborts, exactly like `createMany` does
      // inside the real `finalizeChecked`.
      let collision = null;
      try {
        await insertLedgerRow(
          failing,
          id('LEDX'),
          DOC_TEMP,
          LINE_F1,
          ACCOUNT_DEBIT,
          1,
        );
      } catch (error) {
        collision = error.code;
      }
      await q(failing, 'ROLLBACK');
      const after = await q(
        admin,
        `SELECT (SELECT state FROM accounting.accounting_documents WHERE id = $1) AS state,
                (SELECT operationally_used_at FROM accounting.accounting_configurations
                  WHERE id = $2) AS marked`,
        [DOC_TEMP, CONFIG_SUPERSEDED],
      );
      check(
        'a real unique-violation abort rolls the marker back with the state change',
        collision === '23505' &&
          after.rows[0]?.state === 'temporary' &&
          after.rows[0]?.marked === null,
        `sqlstate=${collision}`,
      );
    } finally {
      failing.release();
    }

    section('10. the marker does not block unrelated reads');
    const listed = await q(
      admin,
      `SELECT c.id, c.operationally_used_at, count(a.id)::int AS accounts
         FROM accounting.accounting_configurations c
         LEFT JOIN accounting.accounts a ON a.accounting_configuration_id = c.id
        WHERE c.organization_id = $1
        GROUP BY c.id, c.operationally_used_at
        ORDER BY c.id ASC`,
      [ORG_A],
    );
    check(
      'a read of the configuration list works while rows are marked, and reports the marker',
      listed.rows.length === 2 &&
        listed.rows.every((row) => Number(row.accounts) >= 1),
      listed.rows
        .map(
          (row) =>
            `${row.id.slice(3, 7)}:${row.operationally_used_at ? 'used' : 'free'}`,
        )
        .join(' '),
    );
  } finally {
    await cleanup(admin);
    admin.release();
  }

  section('summary');
  const passed = results.filter((r) => r.ok).length;
  console.log(`${passed}/${results.length} checks passed`);
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`FAILED: ${r.label} ${r.detail}`);
  }
  if (failures > 0) process.exitCode = 1;
}

async function cleanup(client) {
  const tables = [
    'accounting.ledger_entries',
    'accounting.accounting_posting_operations',
    'accounting.accounting_document_lines',
    'accounting.accounting_documents',
    'accounting.accounts',
    'accounting.accounting_configuration_levels',
    'accounting.accounting_configurations',
    'accounting.coding_structure_versions',
    'accounting.accounting_periods',
    'accounting.fiscal_years',
    'accounting.financial_areas',
  ];
  for (const table of tables) {
    await client
      .query(`DELETE FROM ${table} WHERE organization_id = ANY($1::text[])`, [
        [ORG_A, ORG_B],
      ])
      .catch(() => undefined);
  }
  await client
    .query(
      `DELETE FROM organization.organizations WHERE id = ANY($1::text[])`,
      [[ORG_A, ORG_B]],
    )
    .catch(() => undefined);
}

await main();
await pool.end();
