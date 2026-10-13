#!/usr/bin/env node
/**
 * Task 11 migration rehearsal — deterministic, disposable PostgreSQL run.
 *
 * What it does, in order:
 *   1. connects to a maintenance database and (re)creates the rehearsal
 *      database — every run starts from nothing;
 *   2. applies every migration BEFORE
 *      `20260920000000_accounting_configuration_foundation` in lexical order,
 *      each inside its own transaction (the way Prisma applies a migration
 *      file);
 *   3. seeds populated PRE-Task-11 data (`pre-task-11-fixture.sql`);
 *   4. snapshots counts and every account row into the `rehearsal` schema;
 *   5. applies the Task 11 migration in ONE transaction, while a second
 *      connection holds `ACCESS SHARE` on `accounting.accounts` — the runner
 *      first proves the migration BLOCKS on that lock (oldest waiting
 *      `AccessExclusiveLock` on the table shows up in `pg_locks`) and then
 *      releases it, so "the migration takes ACCESS EXCLUSIVE and runs in a
 *      single transaction" is measured, not assumed;
 *   6. runs `verify.sql` (assertions; any failure exits non-zero);
 *   7. optionally keeps the database (`KEEP=1`) for inspection, otherwise
 *      drops it.
 *
 * Connection: `VARDENA_REHEARSAL_ADMIN_URL` (default:
 * `postgresql://vardena:vardena_test_password@127.0.0.1:5432/postgres`) — the
 * maintenance database; the rehearsal database is created next to it. In CI
 * the service container credentials from `.github/workflows/ci.yml` work
 * unchanged.
 *
 * Exit code 0 = rehearsal + verification passed. Non-zero = the migration or
 * an assertion failed, with the failing check printed.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '..', '..', 'migrations');
const TASK_11_MIGRATION = '20260920000000_accounting_configuration_foundation';
const ADMIN_URL =
  process.env['VARDENA_REHEARSAL_ADMIN_URL'] ??
  'postgresql://vardena:vardena_test_password@127.0.0.1:5432/postgres';
const REHEARSAL_DB =
  process.env['VARDENA_REHEARSAL_DB'] ?? 'vardena_rehearsal_task11';
const KEEP = process.env['KEEP'] === '1';

function log(message) {
  process.stdout.write(`${message}\n`);
}

function migrationDirs() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
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
  for (const notice of notices) {
    log(`    ${notice}`);
  }
  notices.length = 0;
}

/** Apply one migration file inside a single transaction (Prisma's semantics). */
async function applyMigration(client, name, notices) {
  const sql = readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
  const started = Date.now();
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
  const duration = Date.now() - started;
  log(`    applied ${name} (${duration} ms)`);
  printNotices(notices);
  return duration;
}

async function main() {
  const dirs = migrationDirs();
  if (!dirs.includes(TASK_11_MIGRATION)) {
    throw new Error(
      `Migration ${TASK_11_MIGRATION} not found under ${MIGRATIONS_DIR}`,
    );
  }
  const before = dirs.filter((name) => name < TASK_11_MIGRATION);
  const after = dirs.filter((name) => name > TASK_11_MIGRATION);
  if (after.length > 0) {
    log(
      `    note: ${after.length} migration(s) after Task 11 found (${after.join(', ')}) — rehearsal only covers up to Task 11, later migrations are ignored for this check (Task 12 is expected)`,
    );
  }

  log(`== Task 11 migration rehearsal ==`);
  log(`    migrations before Task 11: ${before.length}`);

  // ---- 1. disposable database -------------------------------------------
  await withClient('postgres', async (client) => {
    await client.query(
      `DROP DATABASE IF EXISTS "${REHEARSAL_DB}" WITH (FORCE)`,
    );
    await client.query(`CREATE DATABASE "${REHEARSAL_DB}"`);
  });
  log(`    created disposable database "${REHEARSAL_DB}"`);

  // ---- 2. pre-Task-11 schema --------------------------------------------
  log(`-- phase 1: apply ${before.length} pre-Task-11 migrations`);
  await withClient(REHEARSAL_DB, async (client, notices) => {
    for (const name of before) {
      await applyMigration(client, name, notices);
    }
  });

  // ---- 3. populated pre-Task-11 data -------------------------------------
  log(`-- phase 2: seed populated pre-Task-11 data`);
  await withClient(REHEARSAL_DB, async (client, notices) => {
    const fixture = readFileSync(join(HERE, 'pre-task-11-fixture.sql'), 'utf8');
    await client.query(fixture);
    printNotices(notices);
    await client.query('CREATE SCHEMA rehearsal');
    await client.query(`
      CREATE TABLE rehearsal.counts_pre AS
      SELECT 'coding_structure_versions' AS relation, count(*)::int AS row_count FROM "accounting"."coding_structure_versions"
      UNION ALL
      SELECT 'coding_structure_levels', count(*)::int FROM "accounting"."coding_structure_levels"
      UNION ALL
      SELECT 'accounts', count(*)::int FROM "accounting"."accounts"
      UNION ALL
      SELECT 'organizations', count(*)::int FROM "organization"."organizations"`);
    await client.query(`
      CREATE TABLE rehearsal.account_counts_pre AS
      SELECT organization_id, count(*)::int AS account_count
        FROM "accounting"."accounts" GROUP BY organization_id`);
    await client.query(`
      CREATE TABLE rehearsal.snapshot_pre AS
      SELECT id, organization_id, code, title, parent_id, level,
             coding_structure_version_id, account_nature, is_postable, is_active
        FROM "accounting"."accounts"`);
    const counts = await client.query(
      `SELECT relation, row_count FROM rehearsal.counts_pre ORDER BY relation`,
    );
    for (const row of counts.rows) {
      log(`    ${row.relation}: ${row.row_count}`);
    }
    const nulls = await client.query(
      `SELECT count(*)::int AS orphans FROM "accounting"."accounts" WHERE "coding_structure_version_id" IS NULL`,
    );
    log(
      `    accounts with a NULL coding version (impossible): ${nulls.rows[0].orphans}`,
    );
  });

  // ---- 4. Task 11 migration under a lock probe ---------------------------
  log(
    `-- phase 3: apply ${TASK_11_MIGRATION} (single transaction, lock probe)`,
  );
  const blocker = adminClient(REHEARSAL_DB);
  await blocker.connect();
  let waitedForLock = false;
  let migrationDuration = 0;
  try {
    await blocker.query('BEGIN');
    await blocker.query(
      'LOCK TABLE "accounting"."accounts" IN ACCESS SHARE MODE',
    );

    const migration = withClient(REHEARSAL_DB, async (client, notices) => {
      const duration = await applyMigration(client, TASK_11_MIGRATION, notices);
      return { duration, notices };
    });
    // The migration must be blocked by the ACCESS SHARE lock: look for a not
    // granted AccessExclusiveLock on the accounts table while it waits.
    const probeDeadline = Date.now() + 15_000;
    while (Date.now() < probeDeadline) {
      const { rows } = await blocker.query(`
        SELECT count(*)::int AS waiting
          FROM pg_locks l
          JOIN pg_class c ON c.oid = l.relation
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'accounting'
           AND c.relname = 'accounts'
           AND l.mode = 'AccessExclusiveLock'
           AND NOT l.granted`);
      if (rows[0].waiting > 0) {
        waitedForLock = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!waitedForLock) {
      throw new Error(
        'the migration did not block on the ACCESS SHARE lock held by the probe connection — lock behaviour not observed',
      );
    }
    log(
      '    observed: migration waiting on AccessExclusiveLock for accounting.accounts',
    );
    await blocker.query('COMMIT');
    const applied = await migration;
    migrationDuration = applied.duration;
    printNotices(applied.notices);
  } catch (error) {
    await blocker.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await blocker.end().catch(() => {});
  }
  if (!waitedForLock) {
    throw new Error('lock probe did not observe the migration blocking');
  }
  log(
    `    migration transaction committed (${migrationDuration} ms) after the lock was released`,
  );

  // ---- 5. verification ---------------------------------------------------
  log(`-- phase 4: verification`);
  await withClient(REHEARSAL_DB, async (client, notices) => {
    const verify = readFileSync(join(HERE, 'verify.sql'), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(verify);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      printNotices(notices);
      throw error;
    }
    await client.query('ROLLBACK');
    printNotices(notices);
  });

  // ---- 6. cleanup --------------------------------------------------------
  if (KEEP) {
    log(`    KEEP=1: "${REHEARSAL_DB}" kept for inspection`);
  } else {
    await withClient(REHEARSAL_DB, async (client) => {
      await client.query('DROP SCHEMA rehearsal CASCADE');
    });
    await withClient('postgres', async (client) => {
      await client.query(
        `DROP DATABASE IF EXISTS "${REHEARSAL_DB}" WITH (FORCE)`,
      );
    });
    log(`    dropped "${REHEARSAL_DB}"`);
  }

  log(
    `\nREHEARSAL PASSED: migration completed and every verification check passed.`,
  );
}

main().catch((error) => {
  process.stderr.write(`\nREHEARSAL FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
