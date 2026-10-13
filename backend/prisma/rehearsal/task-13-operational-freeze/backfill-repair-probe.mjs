#!/usr/bin/env node
/**
 * Task 13 — validation of the OPTIONAL operational-usage backfill statement.
 *
 * WHAT THIS IS
 *
 * Task 13 deliberately shipped NO migration that reconstructs usage from the
 * ledger (see `docs/task-13-implementation-report.md` §9: a data-only migration
 * would be an unaudited business effect, and it would fire on every fresh
 * database where nothing is missing). The consequence is documented as a known
 * limitation: configurations used by vouchers finalized BEFORE this change keep
 * `operationally_used_at IS NULL`, so they stay editable until an operator runs
 * the repair statement. This script is the evidence that the repair statement in
 * the report is correct — it is THE SAME SQL text, executed against a real
 * PostgreSQL — and not a paraphrase: `REPAIR` below is copied verbatim into
 * `docs/task-13-implementation-report.md` §9.
 *
 * SAFETY
 *
 * Everything happens inside ONE transaction that is always ROLLBACKed: the seed
 * rows, the repair, the assertions and the idempotency re-run. The script writes
 * no committed row and touches no row it did not create.
 *
 * USAGE
 *
 *   DATABASE_URL=postgresql://… node \
 *     prisma/rehearsal/task-13-operational-freeze/backfill-repair-probe.mjs
 */
import pg from 'pg';

const connectionString =
  process.env['DATABASE_URL'] ?? process.env['VARDENA_TEST_DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  console.error('DATABASE_URL (or VARDENA_TEST_DATABASE_URL) is required.');
  process.exit(2);
}

/** The repair statement, exactly as documented in the report §9. */
const REPAIR = `
UPDATE "accounting"."accounting_configurations" AS cfg
   SET "operationally_used_at" = used.first_use,
       "updated_at" = now(),
       "updated_by" = NULL
  FROM (
        SELECT acc."organization_id"             AS organization_id,
               acc."accounting_configuration_id" AS configuration_id,
               MIN(le."posting_timestamp")       AS first_use
          FROM "accounting"."ledger_entries" le
          JOIN "accounting"."accounts" acc
            ON acc."id" = le."account_id"
           AND acc."organization_id" = le."organization_id"
         WHERE acc."accounting_configuration_id" IS NOT NULL
         GROUP BY acc."organization_id", acc."accounting_configuration_id"
       ) AS used
 WHERE cfg."id" = used.configuration_id
   AND cfg."organization_id" = used.organization_id
   AND cfg."operationally_used_at" IS NULL
RETURNING cfg."id" AS id, cfg."code" AS code, used."first_use" AS first_use
`;

const suffix = Date.now().toString(36).toUpperCase();
const id = (kind) => `RP${kind}${suffix}`.padEnd(26, '0');
const ORG = id('O');
const AREA = id('A');
const YEAR = id('Y');
const PERIOD = id('P');
const STRUCT = id('S');
const CONFIG_1 = id('C1');
const CONFIG_2 = id('C2');
const ACCOUNT_1 = id('AC1');
const ACCOUNT_2 = id('AC2');
const DOC_1 = id('D');
const DOC_2 = id('D2');
const LINE_1 = id('L1');
const LINE_2 = id('L2');
const LINE_3 = id('L3');

const results = [];
let failures = 0;
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} — ${label}${detail === '' ? '' : ` — ${detail}`}`,
  );
};

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO organization.organizations (id, code, name, is_active, created_at, updated_at)
     VALUES ($1, $2, 'Repair probe', true, now(), now())`,
    [ORG, `RP${suffix}`],
  );
  await client.query(
    `INSERT INTO accounting.financial_areas
       (id, organization_id, code, title, is_active, is_default, created_at, updated_at)
     VALUES ($1, $2, 'RP', 'Repair probe area', true, false, now(), now())`,
    [AREA, ORG],
  );
  await client.query(
    `INSERT INTO accounting.fiscal_years
       (id, organization_id, financial_area_id, code, title, start_date, end_date,
        status, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'RPY', 'Repair probe year', DATE '2025-01-01',
             DATE '2025-12-31', 'open', true, now(), now())`,
    [YEAR, ORG, AREA],
  );
  await client.query(
    `INSERT INTO accounting.accounting_periods
       (id, organization_id, financial_area_id, fiscal_year_id, sequence, title,
        start_date, end_date, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 1, 'Repair probe period', DATE '2025-01-01',
             DATE '2025-12-31', 'open', now(), now())`,
    [PERIOD, ORG, AREA, YEAR],
  );
  await client.query(
    `INSERT INTO accounting.coding_structure_versions
       (id, organization_id, code, version_number, status, max_depth, separator,
        created_at, updated_at)
     VALUES ($1, $2, 'RP', 1, 'active', 1, '', now(), now())`,
    [STRUCT, ORG],
  );
  // Two configurations, BOTH unused, as a pre-Task-13 database looks.
  await client.query(
    `INSERT INTO accounting.accounting_configurations
       (id, organization_id, code, name, version_number, status,
        operationally_used_at, created_at, updated_at)
     VALUES ($1, $3, 'C1', 'Active', 1, 'ACTIVE', NULL, now(), now()),
            ($2, $3, 'C2', 'Superseded', 1, 'SUPERSEDED', NULL, now(), now())`,
    [CONFIG_1, CONFIG_2, ORG],
  );
  await client.query(
    `INSERT INTO accounting.accounts
       (id, organization_id, code, title, account_nature, is_postable, is_active,
        level, coding_structure_version_id, accounting_configuration_id,
        created_at, updated_at)
     VALUES ($1, $2, '1', 'Used twice', 'debit', true, true, 1, $3, $4, now(), now()),
            ($5, $2, '2', 'Used once', 'credit', true, true, 1, $3, $6, now(), now())`,
    [ACCOUNT_1, ORG, STRUCT, CONFIG_1, ACCOUNT_2, CONFIG_2],
  );
  const line = (lineId, documentId, accountId, lineNo, debit, credit) =>
    client.query(
      `INSERT INTO accounting.accounting_document_lines
         (id, document_id, organization_id, financial_area_id, fiscal_year_id,
          accounting_period_id, line_no, account_id, debit_amount, credit_amount,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric,
               now(), now())`,
      [
        lineId,
        documentId,
        ORG,
        AREA,
        YEAR,
        PERIOD,
        lineNo,
        accountId,
        debit,
        credit,
      ],
    );
  const document = (documentId, number, date) =>
    client.query(
      `INSERT INTO accounting.accounting_documents
         (id, organization_id, financial_area_id, fiscal_year_id, accounting_period_id,
          document_type, document_number, document_date, description, state, origin,
          finalized_at, finalized_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'accounting_voucher', $6, $7::date,
               'Repair probe voucher', 'final', 'manual', $7::timestamptz, NULL,
               now(), now())`,
      [documentId, ORG, AREA, YEAR, PERIOD, number, `${date}T09:00:00Z`],
    );
  const ledger = (
    entryId,
    documentId,
    number,
    lineId,
    lineNo,
    accountId,
    debit,
    credit,
    at,
  ) =>
    client.query(
      `INSERT INTO accounting.ledger_entries
         (id, organization_id, financial_area_id, fiscal_year_id, accounting_period_id,
          voucher_id, voucher_number, voucher_line_id, line_no, account_id,
          debit_amount, credit_amount, document_date, posting_timestamp, origin,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12::numeric,
               $13::date, $14::timestamptz, 'manual', now(), now())`,
      [
        entryId,
        ORG,
        AREA,
        YEAR,
        PERIOD,
        documentId,
        number,
        lineId,
        lineNo,
        accountId,
        debit,
        credit,
        at.slice(0, 10),
        at,
      ],
    );

  await document(DOC_1, '1', '2025-02-01');
  await line(LINE_1, DOC_1, ACCOUNT_1, 1, '1', '0');
  await line(LINE_2, DOC_1, ACCOUNT_2, 2, '0', '1');
  await ledger(
    id('LE1'),
    DOC_1,
    '1',
    LINE_1,
    1,
    ACCOUNT_1,
    '1',
    '0',
    '2025-02-01T10:00:00.000Z',
  );
  await ledger(
    id('LE2'),
    DOC_1,
    '1',
    LINE_2,
    2,
    ACCOUNT_2,
    '0',
    '1',
    '2025-03-01T10:00:00.000Z',
  );
  // A SECOND voucher over the same account, later in time: the repair must take
  // the EARLIEST posting, which is the whole point of a first-use marker.
  await document(DOC_2, '2', '2025-05-01');
  await line(LINE_3, DOC_2, ACCOUNT_1, 1, '2', '0');
  await ledger(
    id('LE3'),
    DOC_2,
    '2',
    LINE_3,
    1,
    ACCOUNT_1,
    '2',
    '0',
    '2025-05-01T10:00:00.000Z',
  );

  console.log(
    '=== operational-usage backfill repair (report §9), inside a rollback ===',
  );
  const repaired = await client.query(REPAIR);
  const byCode = new Map(
    repaired.rows.map((row) => [
      row.code,
      new Date(row.first_use).toISOString(),
    ]),
  );
  check(
    'every configuration with ledger history gets its first-use instant',
    repaired.rowCount === 2 &&
      byCode.get('C1') === '2025-02-01T10:00:00.000Z' &&
      byCode.get('C2') === '2025-03-01T10:00:00.000Z',
    [...byCode].map(([code, at]) => `${code}=${at}`).join(' '),
  );
  check(
    'the earliest posting wins — not the newest, not the document date',
    byCode.get('C1') === '2025-02-01T10:00:00.000Z',
  );
  const untouched = await client.query(
    `SELECT count(*)::int AS n FROM accounting.accounting_configurations
      WHERE organization_id = $1 AND operationally_used_at IS NULL`,
    [ORG],
  );
  check(
    'no configuration is left unmarked when it was used',
    (untouched.rows[0]?.n ?? 1) === 0,
  );
  const again = await client.query(REPAIR);
  check(
    'the statement is safe to re-run: the guard makes the second pass a no-op',
    again.rowCount === 0,
    `rowCount=${again.rowCount}`,
  );
  const after = await client.query(
    `SELECT operationally_used_at FROM accounting.accounting_configurations WHERE id = $1`,
    [CONFIG_1],
  );
  check(
    'a re-run never moves an existing first-use timestamp',
    new Date(after.rows[0].operationally_used_at).toISOString() ===
      '2025-02-01T10:00:00.000Z',
  );
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  await client.end();
}

const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} checks passed (all rows rolled back)`);
if (failures > 0) process.exitCode = 1;
