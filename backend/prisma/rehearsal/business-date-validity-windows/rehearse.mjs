#!/usr/bin/env node
/**
 * Targeted rehearsal for 20261012000000_inventory_business_date_validity_windows.
 *
 * Uses a disposable PostgreSQL database with representative legacy
 * timestamptz rows. It verifies UTC-calendar-day conversion, preservation of
 * audit instants, and fail-closed guards for windows that collapse, duplicate
 * starts, or overlap after conversion. This fixture rehearsal is not a
 * substitute for running the preflight against a production data snapshot.
 *
 * Connection: VARDENA_REHEARSAL_ADMIN_URL (same local maintenance-database URL
 * used by the Task 11 migration rehearsal). This script refuses non-local hosts,
 * never reuses or drops a pre-existing database, and removes only the uniquely
 * created disposable database. Set KEEP=1 to retain that database.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  join(
    HERE,
    '..',
    '..',
    'migrations',
    '20261012000000_inventory_business_date_validity_windows',
    'migration.sql',
  ),
  'utf8',
);
const AUDIT_SQL = readFileSync(join(HERE, 'audit.sql'), 'utf8');
const ADMIN_URL =
  process.env['VARDENA_REHEARSAL_ADMIN_URL'] ??
  'postgresql://vardena:vardena_test_password@127.0.0.1:5432/postgres';
const REHEARSAL_DB =
  process.env['VARDENA_REHEARSAL_DB'] ??
  `vardena_bd_validity_${process.pid}_${randomBytes(6).toString('hex')}`;
const KEEP = process.env['KEEP'] === '1';
const ADMIN_HOST = new URL(ADMIN_URL).hostname.replace(/^\[|\]$/g, '');

if (!['localhost', '127.0.0.1', '::1'].includes(ADMIN_HOST)) {
  throw new Error(
    'Migration rehearsal is local-only; VARDENA_REHEARSAL_ADMIN_URL must target localhost, 127.0.0.1, or ::1.',
  );
}
if (!/^[A-Za-z0-9_]{1,63}$/.test(REHEARSAL_DB)) {
  throw new Error(
    'VARDENA_REHEARSAL_DB must be a PostgreSQL identifier of at most 63 letters, digits, or underscores.',
  );
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function adminClient(database = 'postgres') {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  return new pg.Client({ connectionString: url.toString() });
}

async function withClient(database, fn) {
  const client = adminClient(database);
  const notices = [];
  client.on('notice', (notice) => {
    if (notice.message) notices.push(notice.message);
  });
  await client.connect();
  try {
    return await fn(client, notices);
  } finally {
    await client.end().catch(() => {});
  }
}

function printNotices(notices) {
  for (const notice of notices) log(`    PostgreSQL NOTICE: ${notice}`);
  notices.length = 0;
}

function auditRow(rows, section, table) {
  const row = rows.find(
    (candidate) =>
      candidate['report_section'] === section &&
      candidate['source_table'] === table,
  );
  assert.ok(row, `aggregate audit should report ${section}.${table}`);
  return row;
}

function auditCount(row, column) {
  return Number(row[column]);
}

async function expectRejected(client, notices, { setupSql, message }) {
  await client.query('BEGIN');
  let migrationError;
  try {
    await client.query(setupSql);
    await client.query(MIGRATION_SQL);
  } catch (error) {
    migrationError = error;
  }
  await client.query('ROLLBACK').catch(() => {});
  if (!migrationError) {
    throw new Error(
      `migration unexpectedly accepted an invalid fixture (${message})`,
    );
  }
  if (!String(migrationError.message ?? '').includes(message)) {
    throw migrationError;
  }
  printNotices(notices);
  log(`    rejected invalid history: ${message}`);
}

async function expectWindow(client, table, id, expectedFrom, expectedTo) {
  const result = await client.query(
    `SELECT to_char("valid_from", 'YYYY-MM-DD') AS valid_from,
            to_char("valid_to", 'YYYY-MM-DD') AS valid_to
       FROM "inventory"."${table}"
      WHERE "id" = $1`,
    [id],
  );
  assert.equal(result.rowCount, 1, `${table}.${id} should exist`);
  assert.equal(result.rows[0].valid_from, expectedFrom);
  assert.equal(result.rows[0].valid_to, expectedTo);
}

async function main() {
  log('== BusinessDate validity-window migration rehearsal ==');
  let createdDatabase = false;
  await withClient('postgres', async (client) => {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [REHEARSAL_DB],
    );
    if (existing.rowCount !== 0) {
      throw new Error(
        `Refusing to reuse or drop existing database "${REHEARSAL_DB}"; choose a new VARDENA_REHEARSAL_DB.`,
      );
    }
    await client.query(`CREATE DATABASE "${REHEARSAL_DB}"`);
    createdDatabase = true;
  });
  log(`    created disposable database "${REHEARSAL_DB}" on ${ADMIN_HOST}`);

  let passed = false;
  try {
    await withClient(REHEARSAL_DB, async (client, notices) => {
      await client.query(`
        CREATE SCHEMA "organization";
        CREATE TABLE "organization"."organizations" (
          "id" text PRIMARY KEY,
          "calendar_system" varchar(16) NOT NULL
        );
        INSERT INTO "organization"."organizations" ("id", "calendar_system")
          VALUES ('org-1', 'JALALI'), ('org-gregorian', 'GREGORIAN');

        CREATE SCHEMA "inventory";
        CREATE TABLE "inventory"."inventory_movements" (
          "id" text PRIMARY KEY,
          "organization_id" text NOT NULL,
          "movement_date" date NOT NULL
        );
        CREATE TABLE "inventory"."inventory_business_documents" (
          "id" text PRIMARY KEY,
          "organization_id" text NOT NULL,
          "business_date" date NOT NULL
        );
        CREATE TABLE "inventory"."inventory_accounting_posting_snapshots" (
          "id" text PRIMARY KEY,
          "organization_id" text NOT NULL,
          "document_date" date NOT NULL
        );
        CREATE TABLE "inventory"."inventory_pricing_runs" (
          "id" text PRIMARY KEY,
          "organization_id" text NOT NULL,
          "from_date" date,
          "to_date" date NOT NULL
        );
        CREATE TABLE "inventory"."inventory_valuation_runs" (
          "id" text PRIMARY KEY,
          "organization_id" text NOT NULL,
          "from_date" date
        );
        CREATE TABLE "inventory"."inventory_balances" (
          "id" text PRIMARY KEY,
          "organization_id" text NOT NULL,
          "last_movement_date" date
        );

        INSERT INTO "inventory"."inventory_movements"
          ("id", "organization_id", "movement_date")
          VALUES ('movement-1', 'org-1', DATE '2026-10-08');
        INSERT INTO "inventory"."inventory_business_documents"
          ("id", "organization_id", "business_date")
          VALUES ('document-1', 'org-1', DATE '2026-10-08');
        INSERT INTO "inventory"."inventory_accounting_posting_snapshots"
          ("id", "organization_id", "document_date")
          VALUES ('snapshot-1', 'org-1', DATE '2026-10-08');
        INSERT INTO "inventory"."inventory_pricing_runs"
          ("id", "organization_id", "from_date", "to_date")
          VALUES ('pricing-run-1', 'org-1', DATE '2026-10-08', DATE '2026-10-09');
        INSERT INTO "inventory"."inventory_valuation_runs"
          ("id", "organization_id", "from_date")
          VALUES ('valuation-run-1', 'org-1', DATE '2026-10-08');
        INSERT INTO "inventory"."inventory_balances"
          ("id", "organization_id", "last_movement_date")
          VALUES ('balance-1', 'org-1', DATE '2026-10-08');

        CREATE TABLE "inventory"."unit_conversions" (
          "id" text PRIMARY KEY,
          "organization_id" text NOT NULL,
          "from_unit_id" text NOT NULL,
          "to_unit_id" text NOT NULL,
          "valid_from" timestamptz(6) NOT NULL,
          "valid_to" timestamptz(6),
          "created_at" timestamptz(6) NOT NULL,
          "updated_at" timestamptz(6) NOT NULL
        );
        CREATE UNIQUE INDEX "uq_unit_conversions_pair_valid_from"
          ON "inventory"."unit_conversions"
          ("organization_id", "from_unit_id", "to_unit_id", "valid_from");

        CREATE TABLE "inventory"."item_unit_conversions" (
          "id" text PRIMARY KEY,
          "organization_id" text NOT NULL,
          "item_id" text NOT NULL,
          "from_unit_id" text NOT NULL,
          "to_unit_id" text NOT NULL,
          "valid_from" timestamptz(6) NOT NULL,
          "valid_to" timestamptz(6),
          "created_at" timestamptz(6) NOT NULL,
          "updated_at" timestamptz(6) NOT NULL
        );
        CREATE UNIQUE INDEX "uq_item_unit_conversions_pair_valid_from"
          ON "inventory"."item_unit_conversions"
          ("item_id", "from_unit_id", "to_unit_id", "valid_from");

        CREATE TABLE "inventory"."item_valuation_methods" (
          "id" text PRIMARY KEY,
          "organization_id" text NOT NULL,
          "item_id" text NOT NULL,
          "valid_from" timestamptz(6) NOT NULL,
          "valid_to" timestamptz(6),
          "created_at" timestamptz(6) NOT NULL,
          "updated_at" timestamptz(6) NOT NULL
        );
        CREATE UNIQUE INDEX "uq_item_valuation_methods_item_valid_from"
          ON "inventory"."item_valuation_methods"
          ("organization_id", "item_id", "valid_from");
      `);

      // Adjacent windows with different legacy clock times remain adjacent
      // BusinessDate windows. UTC is the carrier interpretation, not the
      // caller's offset and not the session or organization zone.
      await client.query(
        `INSERT INTO "inventory"."unit_conversions"
          ("id", "organization_id", "from_unit_id", "to_unit_id", "valid_from", "valid_to", "created_at", "updated_at")
         VALUES
          ('global-before', 'org-1', 'kg', 'g', '2026-01-01 09:30:00-05', '2026-03-01 08:00:00-05', '2026-02-03 04:05:06.789012+03:30', '2026-02-03 04:05:06.789012+03:30'),
          ('global-next', 'org-1', 'kg', 'g', '2026-03-01 18:00:00+04', NULL, '2026-02-03 04:05:06.789012+03:30', '2026-02-03 04:05:06.789012+03:30'),
          ('gregorian-legacy-range', 'org-gregorian', 'old-unit', 'new-unit', '0600-01-01 00:00:00+00', NULL, '2026-02-03 04:05:06.789012+03:30', '2026-02-03 04:05:06.789012+03:30')`,
      );
      await client.query(
        `INSERT INTO "inventory"."item_unit_conversions"
          ("id", "organization_id", "item_id", "from_unit_id", "to_unit_id", "valid_from", "valid_to", "created_at", "updated_at")
         VALUES ('item-crosses-utc-day', 'org-1', 'item-1', 'kg', 'g',
                 '2026-01-02 01:00:00+05', '2026-01-04 00:30:00+05',
                 '2026-02-03 04:05:06.789012+03:30', '2026-02-03 04:05:06.789012+03:30')`,
      );
      await client.query(
        `INSERT INTO "inventory"."item_valuation_methods"
          ("id", "organization_id", "item_id", "valid_from", "valid_to", "created_at", "updated_at")
         VALUES ('valuation-window', 'org-1', 'item-1',
                 '2026-10-09 12:00:00-04', '2026-11-08 00:05:00+00',
                 '2026-02-03 04:05:06.789012+03:30', '2026-02-03 04:05:06.789012+03:30')`,
      );

      // The aggregate-only, read-only report is itself exercised against the
      // synthetic legacy rows before the migration changes their column types.
      const audit = await client.query(AUDIT_SQL);
      const globalAudit = auditRow(
        audit.rows,
        'validity_window',
        'unit_conversions',
      );
      assert.equal(auditCount(globalAudit, 'row_count'), 3);
      assert.equal(auditCount(globalAudit, 'valid_from_non_midnight_utc'), 2);
      assert.equal(auditCount(globalAudit, 'valid_to_non_midnight_utc'), 1);
      assert.equal(auditCount(globalAudit, 'open_ended_rows'), 2);
      assert.equal(auditCount(globalAudit, 'collapsed_or_reversed_rows'), 0);
      assert.equal(auditCount(globalAudit, 'duplicate_start_groups'), 0);
      assert.equal(auditCount(globalAudit, 'overlapping_rows'), 0);
      assert.equal(auditCount(globalAudit, 'unrenderable_rows'), 0);
      for (const table of ['item_unit_conversions', 'item_valuation_methods']) {
        const row = auditRow(audit.rows, 'validity_window', table);
        assert.equal(auditCount(row, 'row_count'), 1);
        assert.equal(auditCount(row, 'valid_from_non_midnight_utc'), 1);
        assert.equal(auditCount(row, 'valid_to_non_midnight_utc'), 1);
        assert.equal(auditCount(row, 'open_ended_rows'), 0);
        assert.equal(auditCount(row, 'collapsed_or_reversed_rows'), 0);
        assert.equal(auditCount(row, 'duplicate_start_groups'), 0);
        assert.equal(auditCount(row, 'overlapping_rows'), 0);
        assert.equal(auditCount(row, 'unrenderable_rows'), 0);
      }
      for (const table of [
        'inventory_movements.movement_date',
        'inventory_business_documents.business_date',
        'inventory_accounting_posting_snapshots.document_date',
        'inventory_pricing_runs.from_date',
        'inventory_pricing_runs.to_date',
        'inventory_valuation_runs.from_date',
        'inventory_balances.last_movement_date',
      ]) {
        const row = auditRow(
          audit.rows,
          'existing_business_date_column',
          table,
        );
        assert.equal(auditCount(row, 'row_count'), 1);
        assert.equal(auditCount(row, 'unrenderable_rows'), 0);
      }

      const nonMidnightEndpoints = audit.rows
        .filter((row) => row['report_section'] === 'validity_window')
        .reduce(
          (total, row) =>
            total +
            auditCount(row, 'valid_from_non_midnight_utc') +
            auditCount(row, 'valid_to_non_midnight_utc'),
          0,
        );
      assert.equal(nonMidnightEndpoints, 7);
      log(
        '    aggregate-only audit SQL report (synthetic fixture; counts only):',
      );
      for (const row of audit.rows) {
        const counts =
          row['report_section'] === 'validity_window'
            ? `rows=${row['row_count']}, non-midnight UTC starts=${row['valid_from_non_midnight_utc']}, non-midnight UTC ends=${row['valid_to_non_midnight_utc']}, open=${row['open_ended_rows']}, collapsed=${row['collapsed_or_reversed_rows']}, duplicate-start groups=${row['duplicate_start_groups'] ?? 0}, overlaps=${row['overlapping_rows'] ?? 0}, unrenderable=${row['unrenderable_rows']}`
            : `values=${row['row_count']}, unrenderable=${row['unrenderable_rows']}`;
        log(`      ${row['report_section']} ${row['source_table']}: ${counts}`);
      }
      log(
        `    synthetic fixture non-midnight UTC endpoints: ${nonMidnightEndpoints}`,
      );

      await expectRejected(client, notices, {
        setupSql: `INSERT INTO "inventory"."item_unit_conversions"
          ("id", "organization_id", "item_id", "from_unit_id", "to_unit_id", "valid_from", "valid_to", "created_at", "updated_at")
          VALUES ('jalali-out-of-range', 'org-1', 'legacy-item', 'old', 'new',
                  '0600-01-01 00:00:00+00', NULL, now(), now())`,
        message:
          'outside the supported BusinessDate/API/calendar rendering range',
      });

      await expectRejected(client, notices, {
        setupSql: `INSERT INTO "inventory"."inventory_business_documents"
          ("id", "organization_id", "business_date")
          VALUES ('legacy-jalali-out-of-range', 'org-1', DATE '0600-01-01')`,
        message:
          'outside the supported BusinessDate/API/calendar rendering range',
      });

      await expectRejected(client, notices, {
        setupSql: `INSERT INTO "inventory"."inventory_movements"
          ("id", "organization_id", "movement_date")
          VALUES ('legacy-too-wide-for-api', 'org-gregorian', DATE '10000-01-01')`,
        message:
          'outside the supported BusinessDate/API/calendar rendering range',
      });

      await expectRejected(client, notices, {
        setupSql: `INSERT INTO "inventory"."item_unit_conversions"
          ("id", "organization_id", "item_id", "from_unit_id", "to_unit_id", "valid_from", "valid_to", "created_at", "updated_at")
          VALUES ('collapsed-window', 'org-1', 'item-1', 'box', 'piece',
                  '2026-01-05 02:00:00+00', '2026-01-05 23:00:00+00', now(), now())`,
        message: 'collapses to an empty or reversed UTC-day window',
      });

      await expectRejected(client, notices, {
        setupSql: `INSERT INTO "inventory"."unit_conversions"
          ("id", "organization_id", "from_unit_id", "to_unit_id", "valid_from", "valid_to", "created_at", "updated_at")
          VALUES ('duplicate-start', 'org-1', 'kg', 'g',
                  '2026-03-01 20:00:00+00', NULL, now(), now())`,
        message:
          'multiple versions in one scope collapse to the same UTC business-date start',
      });

      await expectRejected(client, notices, {
        setupSql: `INSERT INTO "inventory"."unit_conversions"
          ("id", "organization_id", "from_unit_id", "to_unit_id", "valid_from", "valid_to", "created_at", "updated_at")
          VALUES ('overlapping-window', 'org-1', 'kg', 'g',
                  '2026-02-15 12:00:00+00', '2026-03-10 12:00:00+00', now(), now())`,
        message: 'effective windows overlap after UTC-day conversion',
      });

      // Execute the migration text as a standalone deployment does. The
      // temporary preflight table must not depend on the fixture's explicit
      // rollback transaction for its lifetime.
      await client.query(MIGRATION_SQL);
      const migrationNotices = [...notices];
      printNotices(notices);

      for (const table of [
        'unit_conversions',
        'item_unit_conversions',
        'item_valuation_methods',
      ]) {
        await expectWindow(
          client,
          table,
          table === 'unit_conversions'
            ? 'global-before'
            : table === 'item_unit_conversions'
              ? 'item-crosses-utc-day'
              : 'valuation-window',
          table === 'unit_conversions'
            ? '2026-01-01'
            : table === 'item_unit_conversions'
              ? '2026-01-01'
              : '2026-10-09',
          table === 'unit_conversions'
            ? '2026-03-01'
            : table === 'item_unit_conversions'
              ? '2026-01-03'
              : '2026-11-08',
        );
      }
      await expectWindow(
        client,
        'unit_conversions',
        'global-next',
        '2026-03-01',
        null,
      );
      await expectWindow(
        client,
        'unit_conversions',
        'gregorian-legacy-range',
        '0600-01-01',
        null,
      );

      const columnTypes = await client.query(`
        SELECT table_name, column_name, data_type
          FROM information_schema.columns
         WHERE table_schema = 'inventory'
           AND table_name IN ('unit_conversions', 'item_unit_conversions', 'item_valuation_methods')
           AND column_name IN ('valid_from', 'valid_to')`);
      assert.equal(columnTypes.rowCount, 6);
      assert.ok(columnTypes.rows.every((row) => row.data_type === 'date'));

      const auditInstant = await client.query(
        `SELECT "created_at" = TIMESTAMPTZ '2026-02-03 04:05:06.789012+03:30' AS preserved,
                pg_typeof("created_at")::text AS carrier_type
           FROM "inventory"."unit_conversions"
          WHERE "id" = 'global-before'`,
      );
      assert.equal(auditInstant.rows[0].preserved, true);
      assert.equal(
        auditInstant.rows[0].carrier_type,
        'timestamp with time zone',
      );

      assert.ok(
        migrationNotices.some((message) =>
          /non-midnight UTC time/.test(message),
        ),
        'migration should report discarded legacy endpoint time components',
      );
      log(
        '    verified UTC-day conversion, UTC-boundary crossing, date column types, and unchanged audit instants',
      );
      log(
        '    verified the migration refuses collapsed, duplicate-start, and overlapping effective windows',
      );
    });
    passed = true;
  } finally {
    if (createdDatabase && KEEP) {
      log(`    KEEP=1: "${REHEARSAL_DB}" kept for inspection`);
    } else if (createdDatabase) {
      await withClient('postgres', async (client) => {
        // This exact database was created by this run; an existing database is
        // rejected above and can never reach this cleanup path.
        await client.query(`DROP DATABASE "${REHEARSAL_DB}" WITH (FORCE)`);
      });
      log(`    dropped disposable database "${REHEARSAL_DB}"`);
    }
  }

  if (!passed)
    throw new Error('BusinessDate validity migration rehearsal failed.');
  log('PASS: BusinessDate validity-window migration rehearsal');
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
