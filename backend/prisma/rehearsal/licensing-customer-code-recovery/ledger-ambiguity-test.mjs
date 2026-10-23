#!/usr/bin/env node
/**
 * Ledger ambiguity tests for L-06 customer-code recovery.
 *
 * These tests verify that the recovery utility correctly rejects ambiguous
 * migration ledger states according to Prisma 7.10 semantics:
 * each migration name must have exactly 0 or 1 row in _prisma_migrations.
 * Multiple rows indicate manual manipulation or corruption and must be
 * rejected to preserve the fail-closed guarantee.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { runCustomerCodeRecovery } from '../../recovery/licensing-customer-code.mjs';

const ADMIN_URL =
  process.env.VARDENA_REHEARSAL_ADMIN_URL ??
  'postgresql://vardena:vardena_test_password@127.0.0.1:5432/postgres';
const ADMIN_HOST = new URL(ADMIN_URL).hostname.replace(/^\[|\]$/g, '');
if (!['localhost', '127.0.0.1', '::1'].includes(ADMIN_HOST)) {
  throw new Error('Ledger ambiguity tests are local-only.');
}
const SUFFIX = `${process.pid}_${randomBytes(5).toString('hex')}`;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function buildDatabaseUrl(name) {
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

async function dropDatabase(name) {
  await withClient('postgres', async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  }).catch(() => {});
}

async function createDatabase(name) {
  await dropDatabase(name);
  await withClient('postgres', async (client) => {
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function setupSchema(client) {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS licensing;
    CREATE SCHEMA IF NOT EXISTS public;

    CREATE TABLE IF NOT EXISTS public._prisma_migrations (
      id TEXT PRIMARY KEY,
      migration_name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      finished_at TIMESTAMPTZ(6),
      rolled_back_at TIMESTAMPTZ(6),
      applied_steps_count INTEGER,
      logs TEXT,
      started_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS licensing.customers (
      id TEXT PRIMARY KEY,
      customer_code VARCHAR(64),
      display_name VARCHAR(200) NOT NULL
    );
  `);
}

/**
 * Test: Multiple failed rows for the same migration
 * Expected: REJECTED (multiple rows = ambiguity/corruption)
 */
async function testMultipleFailedRows() {
  const name = `vardena_l06_ambig_multiple_failed_${SUFFIX}`;
  log('\n=== Test: Multiple failed ledger rows ===');

  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);

      // Insert two failed ledger rows for the same migration
      // This should NEVER happen in normal Prisma operation
      const now = new Date();
      await client.query(
        `
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', null, null, 0, 'first failure', $1),
        ('ledger2', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', null, null, 0, 'second failure', $2)
      `,
        [now.toISOString(), new Date(now.getTime() - 1000).toISOString()],
      );

      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000001', null, 'Test Customer')
      `);
    });

    const databaseUrl = buildDatabaseUrl(name);
    try {
      await runCustomerCodeRecovery({ databaseUrl });
      assert.fail('Should have rejected multiple failed rows');
    } catch (error) {
      const message = String(error);
      assert.match(message, /Ambiguous ledger history/);
      assert.match(message, /found \d+ rows/);
      log('  ✅ Correctly rejected multiple failed rows');
    }

    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    await dropDatabase(name).catch(() => {});
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

/**
 * Test: Multiple applied rows for the same migration
 * Expected: REJECTED (multiple rows = ambiguity/corruption)
 */
async function testMultipleAppliedRows() {
  const name = `vardena_l06_ambig_multiple_applied_${SUFFIX}`;
  log('\n=== Test: Multiple applied ledger rows ===');

  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);

      const now = new Date();
      await client.query(
        `
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', $1, null, 1, 'first applied', $2),
        ('ledger2', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', $3, null, 1, 'second applied', $4)
      `,
        [
          new Date(now.getTime() - 2000).toISOString(),
          new Date(now.getTime() - 3000).toISOString(),
          new Date(now.getTime() - 1000).toISOString(),
          now.toISOString(),
        ],
      );

      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000002', 'TEST-CODE-001', 'Test Customer')
      `);
    });

    const databaseUrl = buildDatabaseUrl(name);
    try {
      await runCustomerCodeRecovery({ databaseUrl });
      assert.fail('Should have rejected multiple applied rows');
    } catch (error) {
      const message = String(error);
      assert.match(message, /Ambiguous ledger history/);
      log('  ✅ Correctly rejected multiple applied rows');
    }

    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    await dropDatabase(name).catch(() => {});
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

/**
 * Test: Mixed applied and rolled-back rows
 * Expected: REJECTED (multiple rows = ambiguity/corruption)
 */
async function testMixedStates() {
  const name = `vardena_l06_ambig_mixed_${SUFFIX}`;
  log('\n=== Test: Mixed applied and rolled-back rows ===');

  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);

      const now = new Date();
      await client.query(
        `
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', $1, null, 1, 'applied', $2),
        ('ledger2', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', null, $3, 0, 'rolled back', $4)
      `,
        [
          new Date(now.getTime() - 2000).toISOString(),
          new Date(now.getTime() - 3000).toISOString(),
          new Date(now.getTime() - 1000).toISOString(),
          now.toISOString(),
        ],
      );

      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000003', null, 'Test Customer')
      `);
    });

    const databaseUrl = buildDatabaseUrl(name);
    try {
      await runCustomerCodeRecovery({ databaseUrl });
      assert.fail('Should have rejected mixed states');
    } catch (error) {
      const message = String(error);
      assert.match(message, /Ambiguous ledger history/);
      log('  ✅ Correctly rejected mixed applied and rolled-back rows');
    }

    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    await dropDatabase(name).catch(() => {});
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

/**
 * Test: Valid - zero rows (fresh database)
 * Expected: ACCEPTED (state = pending)
 */
async function testZeroRows() {
  const name = `vardena_l06_valid_zero_${SUFFIX}`;
  log('\n=== Test: Zero ledger rows (fresh database) ===');

  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);
      // No ledger rows - fresh database
    });

    const databaseUrl = buildDatabaseUrl(name);
    const result = await runCustomerCodeRecovery({ databaseUrl });
    assert.ok(result);
    assert.equal(result.state, 'pending');
    log('  ✅ Correctly accepted zero rows (fresh database)');

    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    await dropDatabase(name).catch(() => {});
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

/**
 * Test: Valid - single failed row
 * Expected: ACCEPTED (state = failed)
 */
async function testSingleFailedRow() {
  const name = `vardena_l06_valid_single_failed_${SUFFIX}`;
  log('\n=== Test: Single failed ledger row ===');

  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);

      await client.query(`
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', null, null, 0, 'validation failed', CURRENT_TIMESTAMP)
      `);

      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000004', null, 'Test Customer')
      `);
    });

    const databaseUrl = buildDatabaseUrl(name);
    const result = await runCustomerCodeRecovery({ databaseUrl });
    assert.ok(result);
    assert.equal(result.state, 'failed');
    log('  ✅ Correctly accepted single failed row');

    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    await dropDatabase(name).catch(() => {});
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

/**
 * Test: Valid - single applied row
 * Expected: ACCEPTED (state = applied)
 */
async function testSingleAppliedRow() {
  const name = `vardena_l06_valid_single_applied_${SUFFIX}`;
  log('\n=== Test: Single applied ledger row ===');

  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);

      await client.query(`
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', CURRENT_TIMESTAMP, null, 1, 'applied', CURRENT_TIMESTAMP)
      `);

      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000005', 'TEST-CODE-001', 'Test Customer')
      `);
    });

    const databaseUrl = buildDatabaseUrl(name);
    const result = await runCustomerCodeRecovery({ databaseUrl });
    assert.ok(result);
    assert.equal(result.state, 'applied');
    log('  ✅ Correctly accepted single applied row');

    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    await dropDatabase(name).catch(() => {});
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

/**
 * Test: Valid - single rolled-back row
 * Expected: ACCEPTED (state = rolled-back)
 */
async function testSingleRolledBackRow() {
  const name = `vardena_l06_valid_single_rolled_${SUFFIX}`;
  log('\n=== Test: Single rolled-back ledger row ===');

  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);

      await client.query(`
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', null, CURRENT_TIMESTAMP, 0, 'rolled back', CURRENT_TIMESTAMP)
      `);

      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000006', null, 'Test Customer')
      `);
    });

    const databaseUrl = buildDatabaseUrl(name);
    const result = await runCustomerCodeRecovery({ databaseUrl });
    assert.ok(result);
    assert.equal(result.state, 'rolled-back');
    log('  ✅ Correctly accepted single rolled-back row');

    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    await dropDatabase(name).catch(() => {});
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

async function main() {
  log('=== L-06 Ledger Ambiguity Tests ===\n');

  try {
    await testMultipleFailedRows();
    await testMultipleAppliedRows();
    await testMixedStates();
    await testZeroRows();
    await testSingleFailedRow();
    await testSingleAppliedRow();
    await testSingleRolledBackRow();

    log('\n=== All ledger ambiguity tests passed ===\n');
    process.exitCode = 0;
  } catch (error) {
    log(`\n❌ Test suite failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  log(`\n❌ Unexpected error: ${error.message}\n`);
  process.exitCode = 1;
});
