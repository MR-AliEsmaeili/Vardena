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
 * Connection: VARDENA_REHEARSAL_ADMIN_URL (same maintenance-database URL used
 * by the Task 11 migration rehearsal). Set KEEP=1 to retain the database.
 */

import assert from 'node:assert/strict';
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
const ADMIN_URL =
  process.env['VARDENA_REHEARSAL_ADMIN_URL'] ??
  'postgresql://vardena:vardena_test_password@127.0.0.1:5432/postgres';
const REHEARSAL_DB =
  process.env['VARDENA_REHEARSAL_DB'] ??
  'vardena_rehearsal_business_date_validity';
const KEEP = process.env['KEEP'] === '1';

if (!/^[A-Za-z0-9_]+$/.test(REHEARSAL_DB)) {
  throw new Error(
    'VARDENA_REHEARSAL_DB must contain only letters, digits, and underscores.',
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
  await withClient('postgres', async (client) => {
    await client.query(
      `DROP DATABASE IF EXISTS "${REHEARSAL_DB}" WITH (FORCE)`,
    );
    await client.query(`CREATE DATABASE "${REHEARSAL_DB}"`);
  });
  log(`    created disposable database "${REHEARSAL_DB}"`);

  let passed = false;
  try {
    await withClient(REHEARSAL_DB, async (client, notices) => {
      await client.query(`
        CREATE SCHEMA "inventory";
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
          ('global-next', 'org-1', 'kg', 'g', '2026-03-01 18:00:00+04', NULL, '2026-02-03 04:05:06.789012+03:30', '2026-02-03 04:05:06.789012+03:30')`,
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
    if (KEEP) {
      log(`    KEEP=1: "${REHEARSAL_DB}" kept for inspection`);
    } else {
      await withClient('postgres', async (client) => {
        await client.query(
          `DROP DATABASE IF EXISTS "${REHEARSAL_DB}" WITH (FORCE)`,
        );
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
