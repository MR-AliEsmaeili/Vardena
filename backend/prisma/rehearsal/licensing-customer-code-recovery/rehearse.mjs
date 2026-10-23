#!/usr/bin/env node
/**
 * Disposable PostgreSQL rehearsal for the L-06 operational recovery path.
 *
 * Unlike the SQL-only licensing-version rehearsal, this uses the real Prisma
 * CLI to prove fresh deploy, populated pending deploy, P3018 rollback, the
 * subsequent P3009 failed-history gate, atomic recovery, and continuation of
 * the remaining migration chain. Representative customer, installation,
 * license, retained-version, entitlement and audit rows are compared field by
 * field before and after. Only disposable, uniquely named local databases are
 * used; a pre-existing database is never reused.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { runCustomerCodeRecovery } from '../../recovery/licensing-customer-code.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, '..', '..', '..');
const MIGRATIONS = join(BACKEND, 'prisma', 'migrations');
const PRISMA_CLI = join(BACKEND, 'node_modules', 'prisma', 'build', 'cli.js');
const RECOVERY_CLI = join(
  BACKEND,
  'prisma',
  'recovery',
  'licensing-customer-code.mjs',
);
const MIGRATION_NAME = '20261020000000_licensing_customer_code';
const ADMIN_URL =
  process.env.VARDENA_REHEARSAL_ADMIN_URL ??
  'postgresql://vardena:vardena_test_password@127.0.0.1:5432/postgres';
const ADMIN_HOST = new URL(ADMIN_URL).hostname.replace(/^\[|\]$/g, '');
if (!['localhost', '127.0.0.1', '::1'].includes(ADMIN_HOST)) {
  throw new Error('Customer-code recovery rehearsal is local-only.');
}
const SUFFIX = `${process.pid}_${randomBytes(5).toString('hex')}`;
const DATABASES = {
  fresh: `vardena_l06_fresh_${SUFFIX}`,
  pending: `vardena_l06_pending_${SUFFIX}`,
  failed: `vardena_l06_failed_${SUFFIX}`,
};
const KEEP = process.env.KEEP === '1';
const CUSTOMER_ONE = '01K7CUSTOMERRECOVERY000001';
const CUSTOMER_TWO = '01K7CUSTOMERRECOVERY000002';
const CODE_ONE = 'CUST-REHEARSAL-ONE';
const CODE_TWO = 'CUST-REHEARSAL-TWO';
const VALID_MAPPING = [
  { customerId: CUSTOMER_ONE, customerCode: CODE_ONE },
  { customerId: CUSTOMER_TWO, customerCode: CODE_TWO },
];
const SNAPSHOT_TABLES = [
  'customers',
  'installations',
  'licenses',
  'license_versions',
  'license_version_entitlements',
  'license_audit_events',
];

let temporaryDirectory;
let mappingSequence = 0;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function databaseUrl(name) {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

function adminClient(database = 'postgres') {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  return new pg.Client({ connectionString: url.toString() });
}

async function withClient(database, work) {
  const client = adminClient(database);
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function createDatabase(name) {
  await withClient('postgres', async (client) => {
    const existing = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    assert.equal(existing.rowCount, 0, `refusing to reuse database ${name}`);
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function dropDatabase(name) {
  await withClient('postgres', async (client) => {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
      [name],
    );
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
}

async function runNode(args, database, expectedCode = 0) {
  const child = spawn(process.execPath, args, {
    cwd: BACKEND,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl(database),
      CHECKPOINT_DISABLE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(
    code,
    expectedCode,
    `command ${args.join(' ')} exited ${code}, expected ${expectedCode}:\n${output}`,
  );
  return output;
}

async function prismaDeploy(
  database,
  { prefix = false, expectedCode = 0 } = {},
) {
  const args = [PRISMA_CLI, 'migrate', 'deploy'];
  if (prefix) {
    args.push('--config', join(temporaryDirectory, 'prisma.config.mjs'));
  }
  return runNode(args, database, expectedCode);
}

async function recoveryCli(
  database,
  mapping,
  { recoverFailed = false, expectedCode = 0, rawJson } = {},
) {
  mappingSequence += 1;
  const path = join(temporaryDirectory, `mapping-${mappingSequence}.json`);
  await writeFile(path, rawJson ?? JSON.stringify(mapping), 'utf8');
  const args = [RECOVERY_CLI, '--mapping', path, '--apply'];
  if (recoverFailed) args.push('--recover-failed');
  return runNode(args, database, expectedCode);
}

async function seedFixture(client) {
  await client.query(
    `INSERT INTO licensing.customers
       (id, display_name, created_at, updated_at, created_by, updated_by)
     VALUES
       ($1, 'Recovery Customer One', '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z', 'fixture-creator', 'fixture-editor'),
       ($2, 'Recovery Customer Two', '2026-10-03T00:00:00Z', '2026-10-04T00:00:00Z', NULL, NULL)`,
    [CUSTOMER_ONE, CUSTOMER_TWO],
  );
  await client.query(
    `INSERT INTO licensing.installations
       (id, customer_id, name, is_self, created_at, updated_at)
     VALUES
       ('01K7INSTALLATIONRECOVERY001', $1, 'Recovery Installation', true,
        '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z')`,
    [CUSTOMER_ONE],
  );
  await client.query(
    `INSERT INTO licensing.licenses
       (id, installation_id, customer_id, created_at, updated_at)
     VALUES
       ('01K7LICENSERECOVERY0000001', '01K7INSTALLATIONRECOVERY001', $1,
        '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z')`,
    [CUSTOMER_ONE],
  );
  await client.query(
    `INSERT INTO licensing.license_versions
       (id, license_id, installation_id, operation_id, status, provider,
        document_version, document_hash, key_id, source, valid_from, valid_until,
        organization_limit, user_limit, imported_at, imported_by,
        created_at, updated_at)
     VALUES
       ('01K7VERSIONRECOVERY00000001', '01K7LICENSERECOVERY0000001',
        '01K7INSTALLATIONRECOVERY001', '01K7OPERATIONRECOVERY000001',
        'ACTIVE', 'persistent', 2, 'recovery-document-hash', 'recovery-key',
        'file', '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z',
        10, 50, '2026-10-06T00:00:00Z', 'fixture-importer',
        '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z')`,
  );
  await client.query(
    `INSERT INTO licensing.license_version_entitlements
       (id, version_id, kind, code, created_at, updated_at)
     VALUES
       ('01K7ENTITLEMENTRECOVERY00001', '01K7VERSIONRECOVERY00000001',
        'MODULE', 'users', '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z')`,
  );
  await client.query(
    `INSERT INTO licensing.license_audit_events
       (id, installation_id, event_type, outcome, operation_id, license_id,
        version_id, actor_id, source, document_hash, detail, occurred_at,
        created_at, updated_at)
     VALUES
       ('01K7AUDITRECOVERY000000001', '01K7INSTALLATIONRECOVERY001',
        'license.import.applied', 'APPLIED', '01K7OPERATIONRECOVERY000001',
        '01K7LICENSERECOVERY0000001', '01K7VERSIONRECOVERY00000001',
        'fixture-actor', 'file', 'recovery-document-hash', $1,
        '2026-10-06T00:00:00Z', '2026-10-06T00:00:00Z',
        '2026-10-06T00:00:00Z')`,
    ['R'.repeat(500)],
  );
}

async function snapshot(client) {
  const result = {};
  for (const table of SNAPSHOT_TABLES) {
    const rows = await client.query(
      `SELECT * FROM licensing.${table} ORDER BY id`,
    );
    result[table] = rows.rows;
  }
  return result;
}

async function assertPreserved(client, before) {
  const after = await snapshot(client);
  for (const table of SNAPSHOT_TABLES) {
    assert.equal(
      after[table].length,
      before[table].length,
      `${table} row count must be preserved`,
    );
    for (let index = 0; index < before[table].length; index += 1) {
      const oldRow = before[table][index];
      const newRow = after[table][index];
      assert.equal(newRow.id, oldRow.id, `${table} id/order must be preserved`);
      for (const [column, value] of Object.entries(oldRow)) {
        assert.deepEqual(
          newRow[column],
          value,
          `${table}.${oldRow.id}.${column} must be preserved`,
        );
      }
    }
  }
}

async function assertCodes(client) {
  const result = await client.query(
    'SELECT id, customer_code FROM licensing.customers ORDER BY id',
  );
  assert.deepEqual(result.rows, [
    { id: CUSTOMER_ONE, customer_code: CODE_ONE },
    { id: CUSTOMER_TWO, customer_code: CODE_TWO },
  ]);
}

async function assertExpansionOnly(client) {
  const column = await client.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'licensing' AND table_name = 'customers'
        AND column_name = 'customer_code'`,
  );
  assert.equal(column.rowCount, 1);
  assert.equal(column.rows[0].is_nullable, 'YES');
  const constraints = await client.query(
    `SELECT
       EXISTS (SELECT 1 FROM pg_constraint
         WHERE conrelid = 'licensing.customers'::regclass
           AND conname = 'customers_customer_code_check') AS has_check,
       EXISTS (SELECT 1 FROM pg_class
         WHERE relname = 'uq_customers_customer_code'
           AND relnamespace = 'licensing'::regnamespace) AS has_unique`,
  );
  assert.deepEqual(constraints.rows[0], {
    has_check: false,
    has_unique: false,
  });
}

async function assertNoCustomerCodeColumn(client) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'licensing' AND table_name = 'customers'
          AND column_name = 'customer_code') AS present`,
  );
  assert.equal(result.rows[0].present, false);
}

async function failedLedgerRow(client) {
  const result = await client.query(
    `SELECT id, checksum, finished_at, rolled_back_at, applied_steps_count, logs
       FROM _prisma_migrations WHERE migration_name = $1`,
    [MIGRATION_NAME],
  );
  assert.equal(result.rowCount, 1);
  return result.rows[0];
}

async function assertRecordedFailure(client, before) {
  const ledger = await failedLedgerRow(client);
  assert.equal(ledger.finished_at, null);
  assert.equal(ledger.rolled_back_at, null);
  await assertNoCustomerCodeColumn(client);
  await assertPreserved(client, before);
  return ledger;
}

async function assertEnforced(client) {
  const shape = await client.query(
    `SELECT
       (SELECT is_nullable FROM information_schema.columns
         WHERE table_schema = 'licensing' AND table_name = 'customers'
           AND column_name = 'customer_code') AS nullable,
       EXISTS (SELECT 1 FROM pg_constraint
         WHERE conrelid = 'licensing.customers'::regclass
           AND conname = 'customers_customer_code_check'
           AND convalidated) AS has_check,
       EXISTS (SELECT 1 FROM pg_index
         WHERE indrelid = 'licensing.customers'::regclass
           AND indexrelid = 'licensing.uq_customers_customer_code'::regclass
           AND indisunique) AS has_unique`,
  );
  assert.deepEqual(shape.rows[0], {
    nullable: 'NO',
    has_check: true,
    has_unique: true,
  });
}

async function assertConstraintRejections(client) {
  const cases = [
    ['missing', null],
    ['empty', ''],
    ['whitespace', '   '],
    ['malformed', 'not a business code'],
    ['overlong', 'A'.repeat(65)],
    ['duplicate', CODE_ONE],
  ];
  for (const [index, [label, code]] of cases.entries()) {
    const id = `01K7INVALIDRECOVERY${String(index).padStart(5, '0')}`;
    let error = null;
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO licensing.customers (id, customer_code, display_name)
         VALUES ($1, $2, 'Invalid recovery customer')`,
        [id, code],
      );
    } catch (caught) {
      error = caught;
    } finally {
      await client.query('ROLLBACK');
    }
    assert.ok(error, `${label} customer_code must be rejected`);
  }
  const id = '01K7INVALIDRECOVERYIDEQUAL';
  let equalError = null;
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO licensing.customers (id, customer_code, display_name)
       VALUES ($1, $1, 'Invalid recovery customer')`,
      [id],
    );
  } catch (caught) {
    equalError = caught;
  } finally {
    await client.query('ROLLBACK');
  }
  assert.ok(equalError, 'customer_code = id must be rejected');
}

async function preparePrefixConfiguration() {
  const prefixMigrations = join(temporaryDirectory, 'migrations');
  await mkdir(prefixMigrations, { recursive: true });
  for (const entry of await readdir(MIGRATIONS, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      /^\d/.test(entry.name) &&
      entry.name < MIGRATION_NAME
    ) {
      await cp(
        join(MIGRATIONS, entry.name),
        join(prefixMigrations, entry.name),
        {
          recursive: true,
        },
      );
    }
  }
  await cp(
    join(MIGRATIONS, 'migration_lock.toml'),
    join(prefixMigrations, 'migration_lock.toml'),
  );
  await writeFile(
    join(temporaryDirectory, 'prisma.config.mjs'),
    `export default {
      schema: ${JSON.stringify(join(BACKEND, 'prisma', 'schema'))},
      migrations: { path: ${JSON.stringify(prefixMigrations)} },
      datasource: { url: process.env.DATABASE_URL },
    };\n`,
    'utf8',
  );
}

async function freshRehearsal() {
  const name = DATABASES.fresh;
  await createDatabase(name);
  await prismaDeploy(name);
  await withClient(name, async (client) => {
    await assertEnforced(client);
    const before = await failedLedgerRow(client);
    const output = await recoveryCli(name, [], { recoverFailed: true });
    assert.match(output, /already-applied/);
    const after = await failedLedgerRow(client);
    assert.equal(after.finished_at.getTime(), before.finished_at.getTime());
    assert.equal(after.applied_steps_count, before.applied_steps_count);
  });
  log('  fresh Prisma deploy and already-applied compatibility passed');
}

async function pendingPopulatedRehearsal() {
  const name = DATABASES.pending;
  await createDatabase(name);
  await prismaDeploy(name, { prefix: true });
  await withClient(name, async (client) => {
    await seedFixture(client);
  });
  const before = await withClient(name, snapshot);

  const missing = await recoveryCli(name, [VALID_MAPPING[0]], {
    expectedCode: 1,
  });
  assert.match(missing, new RegExp(CUSTOMER_TWO));
  assert.match(missing, /No code was generated or inferred/);
  await withClient(name, async (client) => {
    await assertExpansionOnly(client);
    await assertPreserved(client, before);
  });

  const rejectedMappings = [
    [
      { customerId: CUSTOMER_ONE, customerCode: 'not a valid code' },
      VALID_MAPPING[1],
    ],
    [
      { customerId: CUSTOMER_ONE, customerCode: CUSTOMER_ONE },
      VALID_MAPPING[1],
    ],
    [VALID_MAPPING[0], { customerId: CUSTOMER_TWO, customerCode: CODE_ONE }],
  ];
  for (const mapping of rejectedMappings) {
    await recoveryCli(name, mapping, { expectedCode: 1 });
    await withClient(name, async (client) => {
      await assertExpansionOnly(client);
      await assertPreserved(client, before);
    });
  }

  await recoveryCli(name, VALID_MAPPING);
  await withClient(name, async (client) => {
    await assertExpansionOnly(client);
    await assertCodes(client);
    await assertPreserved(client, before);
  });
  const repeated = await recoveryCli(name, VALID_MAPPING);
  assert.match(repeated, /"changedCustomerIds": \[\]/);
  await prismaDeploy(name);
  await withClient(name, async (client) => {
    await assertEnforced(client);
    await assertCodes(client);
    await assertPreserved(client, before);
  });
  log('  populated expansion, owner backfill, rejection and deploy passed');
}

async function failedPopulatedRehearsal() {
  const name = DATABASES.failed;
  await createDatabase(name);
  await prismaDeploy(name, { prefix: true });
  await withClient(name, async (client) => {
    await seedFixture(client);
  });
  const before = await withClient(name, snapshot);

  const firstFailure = await prismaDeploy(name, { expectedCode: 1 });
  assert.match(firstFailure, /without an explicit customer_code|P3018/);
  const failed = await withClient(name, (client) =>
    assertRecordedFailure(client, before),
  );
  const secondFailure = await prismaDeploy(name, { expectedCode: 1 });
  assert.match(secondFailure, /P3009|failed migrations/);

  const notExplicit = await recoveryCli(name, VALID_MAPPING, {
    expectedCode: 1,
  });
  assert.match(notExplicit, /--recover-failed/);
  await withClient(name, (client) => assertRecordedFailure(client, before));

  // A recovery attempt interrupted after the real migration but before ledger
  // completion must roll back BOTH; there is no partially applied success.
  await assert.rejects(
    runCustomerCodeRecovery({
      databaseUrl: databaseUrl(name),
      apply: true,
      recoverFailed: true,
      mapping: VALID_MAPPING,
      beforeLedgerUpdate: async () => {
        throw new Error('rehearsal interruption before ledger completion');
      },
    }),
    /rehearsal interruption/,
  );
  await withClient(name, (client) => assertRecordedFailure(client, before));

  await recoveryCli(name, VALID_MAPPING, { recoverFailed: true });
  await withClient(name, async (client) => {
    const recovered = await failedLedgerRow(client);
    assert.ok(recovered.finished_at instanceof Date);
    assert.equal(recovered.rolled_back_at, null);
    assert.equal(recovered.applied_steps_count, 1);
    assert.equal(recovered.id, failed.id);
    assert.equal(recovered.checksum, failed.checksum);
    assert.equal(
      recovered.logs,
      failed.logs,
      'failure evidence must be retained',
    );
    await assertEnforced(client);
    await assertCodes(client);
    await assertPreserved(client, before);
  });

  // Prisma must accept the truthfully completed row and continue with every
  // later migration; retaining the old failure log must not create a bypass.
  await prismaDeploy(name);
  const repeated = await recoveryCli(name, VALID_MAPPING, {
    recoverFailed: true,
  });
  assert.match(repeated, /already-applied/);
  await withClient(name, async (client) => {
    await assertConstraintRejections(client);
    await assertCodes(client);
    await assertPreserved(client, before);
  });
  log('  failed-ledger recovery, interruption/retry and continuation passed');
}

try {
  temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'vardena-l06-recovery-rehearsal-'),
  );
  await preparePrefixConfiguration();
  // Ensure the CLI entrypoint is present before creating any databases.
  await readFile(PRISMA_CLI);
  await freshRehearsal();
  await pendingPopulatedRehearsal();
  await failedPopulatedRehearsal();
  log('L-06 customer-code recovery rehearsal passed.');
} catch (error) {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  const annotation = detail
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  log(`::error title=L-06 customer-code recovery rehearsal::${annotation}`);
  throw error;
} finally {
  if (temporaryDirectory !== undefined) {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(
      () => {},
    );
  }
  for (const [label, name] of Object.entries(DATABASES)) {
    if (KEEP) log(`KEEP=1: retained ${label} database ${name}`);
    else {
      await dropDatabase(name).catch((error) =>
        log(`  cleanup warning for ${name}: ${error.message}`),
      );
    }
  }
}
