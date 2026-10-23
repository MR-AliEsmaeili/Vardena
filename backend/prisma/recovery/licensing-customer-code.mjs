#!/usr/bin/env node
/**
 * Controlled L-06 customer-code expansion/backfill and failed-migration recovery.
 *
 * Normal schema deployment remains `prisma migrate deploy`. This utility has
 * only two purposes:
 *
 * 1. Pending populated databases: commit the original migration's nullable
 *    expansion separately, apply an exact owner-supplied mapping, and leave
 *    constraint enforcement to the normal Prisma deploy.
 * 2. A database whose original L-06 migration is recorded as failed: execute
 *    the REAL migration and verify its invariants in one transaction. Only
 *    then complete that migration's existing ledger row in the SAME
 *    transaction. There is no ledger-only mode and no constraint bypass.
 *
 * The original migration is deliberately unchanged: installations where it
 * already succeeded retain their migration history and checksum.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_NAME = '20261020000000_licensing_customer_code';
const MIGRATION_SQL = await readFile(
  join(HERE, '..', 'migrations', MIGRATION_NAME, 'migration.sql'),
  'utf8',
);
const MIGRATION_CHECKSUM = createHash('sha256')
  .update(MIGRATION_SQL)
  .digest('hex');
const CUSTOMER_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/;
const ADVISORY_LOCK =
  "hashtextextended('vardena/licensing-customer-code-recovery', 0)";

class RecoveryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecoveryError';
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new RecoveryError(message);
}

function validCode(code, customerId) {
  return CUSTOMER_CODE_PATTERN.test(code) && code !== customerId;
}

/** Validate the complete owner input before any database mutation. */
export function normalizeAssignments(input) {
  requireCondition(
    Array.isArray(input),
    'The mapping file must contain a JSON array of customerId/customerCode objects.',
  );
  const byId = new Map();
  const byCode = new Map();
  for (const [index, value] of input.entries()) {
    requireCondition(
      value !== null && typeof value === 'object' && !Array.isArray(value),
      `Mapping entry ${index + 1} must be an object.`,
    );
    const keys = Object.keys(value).sort();
    requireCondition(
      keys.length === 2 &&
        keys[0] === 'customerCode' &&
        keys[1] === 'customerId',
      `Mapping entry ${index + 1} must contain exactly customerId and customerCode.`,
    );
    const { customerId, customerCode } = value;
    requireCondition(
      typeof customerId === 'string' && CUSTOMER_CODE_PATTERN.test(customerId),
      `Mapping entry ${index + 1} has a malformed customerId.`,
    );
    requireCondition(
      typeof customerCode === 'string' &&
        CUSTOMER_CODE_PATTERN.test(customerCode),
      `Mapping entry ${index + 1} has a malformed customerCode; expected 2..64 ASCII code characters.`,
    );
    requireCondition(
      customerCode !== customerId,
      `Mapping entry ${index + 1} assigns customerCode equal to customerId; the business code must be independent.`,
    );
    requireCondition(
      !byId.has(customerId),
      `The mapping contains customerId "${customerId}" more than once.`,
    );
    requireCondition(
      !byCode.has(customerCode),
      `The mapping assigns the same customerCode to "${byCode.get(customerCode)}" and "${customerId}".`,
    );
    byId.set(customerId, customerCode);
    byCode.set(customerCode, customerId);
  }
  return [...byId].map(([customerId, customerCode]) => ({
    customerId,
    customerCode,
  }));
}

async function relationExists(client, name) {
  const result = await client.query('SELECT to_regclass($1)::text AS name', [
    name,
  ]);
  return result.rows[0].name !== null;
}

async function columnExists(client) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'licensing' AND table_name = 'customers'
          AND column_name = 'customer_code'
     ) AS present`,
  );
  return result.rows[0].present;
}

async function readCustomers(client) {
  const hasCode = await columnExists(client);
  const result = await client.query(
    hasCode
      ? 'SELECT id, customer_code FROM licensing.customers ORDER BY id'
      : 'SELECT id, NULL::text AS customer_code FROM licensing.customers ORDER BY id',
  );
  return result.rows;
}

async function readLedger(client, forUpdate = false) {
  const result = await client.query(
    `SELECT id, migration_name, checksum, finished_at, rolled_back_at,
            applied_steps_count, logs
       FROM _prisma_migrations
      WHERE migration_name = $1
      ORDER BY started_at DESC, id DESC${forUpdate ? ' FOR UPDATE' : ''}`,
    [MIGRATION_NAME],
  );
  requireCondition(
    result.rows.length <= 1 ||
      !result.rows.some((row) => row.finished_at !== null) ||
      result.rows[0].finished_at !== null,
    `Ambiguous ledger history for ${MIGRATION_NAME}; stop and inspect it rather than guessing.`,
  );
  return result.rows[0] ?? null;
}

function ledgerState(row) {
  if (row === null) return 'pending';
  if (row.finished_at !== null) return 'applied';
  if (row.rolled_back_at !== null) return 'rolled-back';
  return 'failed';
}

/**
 * Plan only explicit NULL/blank backfills. Existing non-blank codes are never
 * overwritten, including malformed values: those require separate owner/data
 * investigation because they may already be historical identity evidence.
 */
function planBackfill(rows, assignments) {
  const mapping = new Map(
    assignments.map(({ customerId, customerCode }) => [
      customerId,
      customerCode,
    ]),
  );
  const existingIds = new Set(rows.map((row) => row.id));
  const unknown = [...mapping.keys()].filter((id) => !existingIds.has(id));
  requireCondition(
    unknown.length === 0,
    `The mapping contains customerId value(s) not present in licensing.customers: ${unknown.join(', ')}.`,
  );

  const updates = [];
  const missing = [];
  const finalCodeOwners = new Map();
  for (const row of rows) {
    const isMissing =
      row.customer_code === null || row.customer_code.trim() === '';
    const assigned = mapping.get(row.id);
    if (isMissing && assigned === undefined) {
      missing.push(row.id);
      continue;
    }
    if (
      !isMissing &&
      assigned !== undefined &&
      assigned !== row.customer_code
    ) {
      throw new RecoveryError(
        `Customer "${row.id}" already has a different non-blank customer_code; this utility will not overwrite it.`,
      );
    }
    const code = isMissing ? assigned : row.customer_code;
    requireCondition(
      validCode(code, row.id),
      `Customer "${row.id}" has a missing, malformed, or id-equal final customer_code; supply an owner-approved correction without deriving it.`,
    );
    const previousOwner = finalCodeOwners.get(code);
    requireCondition(
      previousOwner === undefined,
      `Customers "${previousOwner}" and "${row.id}" would have a duplicate customer_code.`,
    );
    finalCodeOwners.set(code, row.id);
    if (isMissing) updates.push({ customerId: row.id, customerCode: code });
  }
  requireCondition(
    missing.length === 0,
    `Owner-assigned customerCode input is required for: ${missing.join(', ')}. No code was generated or inferred.`,
  );
  return updates;
}

async function applyUpdates(client, updates) {
  if (updates.length === 0) return [];
  const result = await client.query(
    `WITH assignments(customer_id, customer_code) AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb)
         AS item(customer_id text, customer_code text)
     )
     UPDATE licensing.customers AS customer
        SET customer_code = assignments.customer_code
       FROM assignments
      WHERE customer.id = assignments.customer_id
        AND (customer.customer_code IS NULL OR BTRIM(customer.customer_code) = '')
      RETURNING customer.id`,
    [
      JSON.stringify(
        updates.map(({ customerId, customerCode }) => ({
          customer_id: customerId,
          customer_code: customerCode,
        })),
      ),
    ],
  );
  requireCondition(
    result.rowCount === updates.length,
    `Expected to backfill ${updates.length} customer(s), but updated ${result.rowCount}; the transaction was rolled back.`,
  );
  return result.rows.map((row) => row.id).sort();
}

async function withTransaction(client, work) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function lockCustomers(client) {
  await client.query(
    'LOCK TABLE licensing.customers IN SHARE ROW EXCLUSIVE MODE',
  );
}

async function expandSeparately(client) {
  await withTransaction(client, async () => {
    await client.query(
      'ALTER TABLE licensing.customers ADD COLUMN IF NOT EXISTS customer_code VARCHAR(64)',
    );
  });
}

async function backfillSeparately(client, assignments) {
  return withTransaction(client, async () => {
    await lockCustomers(client);
    const updates = planBackfill(await readCustomers(client), assignments);
    const updatedCustomerIds = await applyUpdates(client, updates);
    // Re-read and validate the complete final population before committing.
    planBackfill(await readCustomers(client), []);
    return updatedCustomerIds;
  });
}

async function enforcementShape(client) {
  const column = await client.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'licensing' AND table_name = 'customers'
        AND column_name = 'customer_code'`,
  );
  const check = await client.query(
    `SELECT convalidated FROM pg_constraint
      WHERE conrelid = 'licensing.customers'::regclass
        AND conname = 'customers_customer_code_check'`,
  );
  const unique = await client.query(
    `SELECT indexrel.indisunique, pg_get_indexdef(indexrel.indexrelid) AS definition
       FROM pg_index AS indexrel
       JOIN pg_class AS index_class ON index_class.oid = indexrel.indexrelid
       JOIN pg_namespace AS index_schema
         ON index_schema.oid = index_class.relnamespace
      WHERE indexrel.indrelid = 'licensing.customers'::regclass
        AND index_schema.nspname = 'licensing'
        AND index_class.relname = 'uq_customers_customer_code'`,
  );
  return {
    notNull: column.rowCount === 1 && column.rows[0].is_nullable === 'NO',
    check: check.rowCount === 1 && check.rows[0].convalidated === true,
    unique:
      unique.rowCount === 1 &&
      unique.rows[0].indisunique === true &&
      /\(customer_code\)/.test(unique.rows[0].definition),
  };
}

async function assertEnforced(client) {
  const shape = await enforcementShape(client);
  requireCondition(
    shape.notNull && shape.check && shape.unique,
    `L-06 enforcement is incomplete (NOT NULL=${shape.notNull}, CHECK=${shape.check}, UNIQUE=${shape.unique}); no ledger state was changed.`,
  );
  return shape;
}

async function recoverFailed(client, assignments, beforeLedgerUpdate) {
  return withTransaction(client, async () => {
    const ledger = await readLedger(client, true);
    requireCondition(
      ledgerState(ledger) === 'failed',
      `${MIGRATION_NAME} is no longer in the recorded-failed state; no recovery was performed.`,
    );
    requireCondition(
      ledger.checksum === MIGRATION_CHECKSUM,
      `The failed migration checksum does not match the current ${MIGRATION_NAME} SQL. Refusing to apply different SQL under that ledger entry.`,
    );

    await lockCustomers(client);
    await client.query(
      'ALTER TABLE licensing.customers ADD COLUMN IF NOT EXISTS customer_code VARCHAR(64)',
    );
    const updates = planBackfill(await readCustomers(client), assignments);
    const updatedCustomerIds = await applyUpdates(client, updates);

    // This is the unchanged, real migration: validation, NOT NULL, CHECK,
    // UNIQUE, audit columns and comments all succeed before ledger completion.
    await client.query(MIGRATION_SQL);
    planBackfill(await readCustomers(client), assignments);
    await assertEnforced(client);

    // Test-only dependency injection for interruption/rollback rehearsal. The
    // CLI never supplies this hook; production has no fault-injection switch.
    if (beforeLedgerUpdate !== undefined) await beforeLedgerUpdate();

    const completed = await client.query(
      `UPDATE _prisma_migrations
          SET finished_at = CURRENT_TIMESTAMP, applied_steps_count = 1
        WHERE id = $1 AND migration_name = $2 AND checksum = $3
          AND finished_at IS NULL AND rolled_back_at IS NULL`,
      [ledger.id, MIGRATION_NAME, MIGRATION_CHECKSUM],
    );
    requireCondition(
      completed.rowCount === 1,
      'The failed ledger row changed concurrently; the entire recovery was rolled back.',
    );
    return updatedCustomerIds;
  });
}

async function inspect(client) {
  const hasLedger = await relationExists(client, 'public._prisma_migrations');
  const hasCustomers = await relationExists(client, 'licensing.customers');
  if (!hasLedger && !hasCustomers) {
    return {
      migration: MIGRATION_NAME,
      state: 'fresh',
      action: 'Run the normal prisma migrate deploy; no backfill is needed.',
    };
  }
  requireCondition(
    hasLedger && hasCustomers,
    'The licensing customers table and Prisma migration ledger must both exist; refusing to infer a recovery state.',
  );
  const ledger = await readLedger(client);
  const state = ledgerState(ledger);
  const rows = await readCustomers(client);
  return {
    migration: MIGRATION_NAME,
    state,
    customerCount: rows.length,
    customerIdsRequiringOwnerCode: rows
      .filter(
        (row) => row.customer_code === null || row.customer_code.trim() === '',
      )
      .map((row) => row.id),
    expansionPresent: await columnExists(client),
    enforcement: await enforcementShape(client),
    action:
      state === 'failed'
        ? 'Supply the exact owner mapping and rerun with --apply --recover-failed.'
        : state === 'applied'
          ? 'No recovery is needed; the original migration is recorded as applied.'
          : 'Supply the exact owner mapping with --apply, then run prisma migrate deploy.',
  };
}

export async function runCustomerCodeRecovery(options = {}) {
  const apply = options.apply === true;
  const recoverFailedFlag = options.recoverFailed === true;
  requireCondition(
    !recoverFailedFlag || apply,
    '--recover-failed requires --apply.',
  );
  requireCondition(
    !apply || options.mapping !== undefined,
    '--apply requires --mapping.',
  );
  const assignments =
    options.mapping === undefined ? [] : normalizeAssignments(options.mapping);
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  requireCondition(
    databaseUrl,
    'DATABASE_URL must be configured; never pass credentials on the command line.',
  );

  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: 'vardena-customer-code-recovery',
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    if (!apply) return await inspect(client);

    const lock = await client.query(
      `SELECT pg_try_advisory_lock(${ADVISORY_LOCK}) AS acquired`,
    );
    requireCondition(
      lock.rows[0].acquired,
      'Another customer-code recovery holds the advisory lock; stop rather than running concurrent mutations.',
    );
    try {
      const hasLedger = await relationExists(
        client,
        'public._prisma_migrations',
      );
      const hasCustomers = await relationExists(client, 'licensing.customers');
      requireCondition(
        hasLedger && hasCustomers,
        'Recovery requires the existing Prisma ledger and licensing.customers table. Fresh databases use prisma migrate deploy directly.',
      );
      const ledger = await readLedger(client);
      const state = ledgerState(ledger);

      if (state === 'applied') {
        planBackfill(await readCustomers(client), assignments);
        await assertEnforced(client);
        return {
          migration: MIGRATION_NAME,
          result: 'already-applied',
          customerCount: (await readCustomers(client)).length,
          changedCustomerIds: [],
          ledgerChanged: false,
        };
      }
      if (state === 'failed') {
        requireCondition(
          recoverFailedFlag,
          `${MIGRATION_NAME} is recorded as failed. Review the owner mapping, then explicitly rerun with --recover-failed. No data or ledger state was changed.`,
        );
        const changedCustomerIds = await recoverFailed(
          client,
          assignments,
          options.beforeLedgerUpdate,
        );
        return {
          migration: MIGRATION_NAME,
          result: 'recovered',
          customerCount: (await readCustomers(client)).length,
          changedCustomerIds,
          ledgerChanged: true,
          failureLogPreserved: true,
        };
      }
      requireCondition(
        !recoverFailedFlag,
        `${MIGRATION_NAME} has no recorded-failed row. Rerun without --recover-failed.`,
      );

      // The expansion commits independently, so incomplete owner input leaves a
      // genuine retry boundary instead of Prisma rolling the column back again.
      await expandSeparately(client);
      const changedCustomerIds = await backfillSeparately(client, assignments);
      return {
        migration: MIGRATION_NAME,
        result: 'prepared',
        customerCount: (await readCustomers(client)).length,
        changedCustomerIds,
        ledgerChanged: false,
        next: 'Run prisma migrate deploy to validate and enforce the original migration.',
      };
    } finally {
      await client
        .query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK})`)
        .catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
}

function usage() {
  return `Usage:
  node prisma/recovery/licensing-customer-code.mjs
  node prisma/recovery/licensing-customer-code.mjs --mapping <json-file> --apply [--recover-failed]

DATABASE_URL supplies the connection. The JSON file is an array containing
exactly { "customerId": "...", "customerCode": "..." } entries. Codes are
owner-assigned; this utility never derives, generates, or overwrites them.`;
}

async function main(argv) {
  let mappingPath;
  let apply = false;
  let recoverFailed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    if (argument === '--apply') apply = true;
    else if (argument === '--recover-failed') recoverFailed = true;
    else if (argument === '--mapping') {
      index += 1;
      requireCondition(index < argv.length, '--mapping requires a file path.');
      mappingPath = argv[index];
    } else throw new RecoveryError(`Unknown argument: ${argument}\n${usage()}`);
  }
  requireCondition(
    !apply || mappingPath !== undefined,
    '--apply requires --mapping.',
  );
  requireCondition(
    mappingPath === undefined || apply,
    '--mapping requires --apply.',
  );

  let mapping;
  if (mappingPath !== undefined) {
    const bytes = await readFile(resolve(mappingPath));
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    try {
      mapping = JSON.parse(text);
    } catch (error) {
      throw new RecoveryError(
        `The mapping file is not valid JSON: ${error.message}`,
      );
    }
  }
  const result = await runCustomerCodeRecovery({
    apply,
    recoverFailed,
    mapping,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedPath =
  process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Customer-code recovery failed: ${message}\n`);
    process.exitCode = 1;
  }
}
