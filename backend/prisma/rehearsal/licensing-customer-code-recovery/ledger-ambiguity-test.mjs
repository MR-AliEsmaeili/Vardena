#!/usr/bin/env node
/**
 * Ledger ambiguity tests for L-06 customer-code recovery.
 *
 * These tests verify that the recovery utility correctly rejects ambiguous
 * migration ledger states that could indicate data corruption, concurrent
 * migrations, or manual ledger manipulation.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runCustomerCodeRecovery } from '../../recovery/licensing-customer-code.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, '..', '..', '..');
const ADMIN_URL =
  process.env.VARDENA_REHEARSAL_ADMIN_URL ??
  'postgresql://vardena:vardena_test_password@127.0.0.1:5432/postgres';
const ADMIN_HOST = new URL(ADMIN_URL).hostname.replace(/^\[|\]$/g, '');
if (!['localhost', '127.0.0.1', '::1'].includes(ADMIN_HOST)) {
  throw new Error('Ledger ambiguity tests are local-only.');
}
const SUFFIX = `${process.pid}_${randomBytes(5).toString('hex')}`;
const DATABASES = {
  multipleFailed: `vardena_l06_ambig_multiple_failed_${SUFFIX}`,
  multipleMixed: `vardena_l06_ambig_mixed_${SUFFIX}`,
  multipleApplied: `vardena_l06_ambig_multiple_applied_${SUFFIX}`,
  finishedNotRecent: `vardena_l06_ambig_finished_not_recent_${SUFFIX}`,
};
const KEEP = process.env.KEEP === '1';

let temporaryDirectory;

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

async function dropDatabase(name) {
  await withClient('postgres', async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
}

async function createDatabase(name) {
  await withClient('postgres', async (client) => {
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function setupSchema(client) {
  // Create the schemas and tables needed for the ledger test
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

async function testMultipleFailedRows() {
  const name = DATABASES.multipleFailed;
  log('\n=== Test: Multiple failed ledger rows ===');
  
  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);
      
      // Insert two failed ledger rows for the same migration
      const now = new Date();
      await client.query(`
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'checksum1', null, null, 0, 'first failure', $1),
        ('ledger2', '20261020000000_licensing_customer_code', 'checksum1', null, null, 0, 'second failure', $2)
      `, [now.toISOString(), new Date(now.getTime() - 1000).toISOString()]);
      
      // Add a customer without code
      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000001', null, 'Test Customer')
      `);
    });
    
    // Try to inspect - should fail with ambiguity error
    const databaseUrl = `postgresql://vardena:vardena_test_password@127.0.0.1:5432/${name}`;
    try {
      await runCustomerCodeRecovery({ databaseUrl });
      assert.fail('Should have thrown for multiple failed rows');
    } catch (error) {
      const message = String(error);
      assert.match(message, /Ambiguous ledger history/);
      assert.match(message, /found \d+ rows/);
      log('  ✅ Correctly rejected multiple failed rows');
    }
    
    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

async function testMultipleAppliedRows() {
  const name = DATABASES.multipleApplied;
  log('\n=== Test: Multiple applied ledger rows ===');
  
  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);
      
      // Insert two applied ledger rows for the same migration
      const now = new Date();
      await client.query(`
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'checksum1', $1, null, 1, 'first applied', $2),
        ('ledger2', '20261020000000_licensing_customer_code', 'checksum1', $3, null, 1, 'second applied', $4)
      `, [now.toISOString(), new Date(now.getTime() - 2000).toISOString(),
           new Date(now.getTime() - 1000).toISOString(), new Date(now.getTime() - 3000).toISOString()]);
      
      // Add a customer with code
      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000002', 'TEST-CODE-001', 'Test Customer')
      `);
    });
    
    const databaseUrl = `postgresql://vardena:vardena_test_password@127.0.0.1:5432/${name}`;
    try {
      await runCustomerCodeRecovery({ databaseUrl });
      assert.fail('Should have thrown for multiple applied rows');
    } catch (error) {
      const message = String(error);
      assert.match(message, /Ambiguous ledger history/);
      log('  ✅ Correctly rejected multiple applied rows');
    }
    
    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

async function testFinishedNotRecent() {
  const name = DATABASES.finishedNotRecent;
  log('\n=== Test: Finished row is not the most recent ===');
  
  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);
      
      // Insert a finished row, then a failed row (more recent by started_at)
      const now = new Date();
      await client.query(`
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'checksum1', $1, null, 1, 'applied', $2),
        ('ledger2', '20261020000000_licensing_customer_code', 'checksum1', null, null, 0, 'failed', $3)
      `, [new Date(now.getTime() - 2000).toISOString(),
           new Date(now.getTime() - 3000).toISOString(),
           now.toISOString()]);
      
      // Add a customer without code
      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000003', null, 'Test Customer')
      `);
    });
    
    const databaseUrl = `postgresql://vardena:vardena_test_password@127.0.0.1:5432/${name}`;
    try {
      await runCustomerCodeRecovery({ databaseUrl });
      assert.fail('Should have thrown when finished row is not most recent');
    } catch (error) {
      const message = String(error);
      assert.match(message, /Ambiguous ledger history/);
      assert.match(message, /finished row is not the most recent/);
      log('  ✅ Correctly rejected when finished row is not most recent');
    }
    
    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

async function testMixedStates() {
  const name = DATABASES.multipleMixed;
  log('\n=== Test: Mixed applied and rolled-back rows ===');
  
  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);
      
      // Insert mixed states: applied and rolled-back
      const now = new Date();
      await client.query(`
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'checksum1', $1, null, 1, 'applied', $2),
        ('ledger2', '20261020000000_licensing_customer_code', 'checksum1', null, $3, 0, 'rolled back', $4)
      `, [new Date(now.getTime() - 2000).toISOString(),
           new Date(now.getTime() - 3000).toISOString(),
           new Date(now.getTime() - 1000).toISOString(),
           now.toISOString()]);
      
      // Add a customer without code
      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000004', null, 'Test Customer')
      `);
    });
    
    const databaseUrl = `postgresql://vardena:vardena_test_password@127.0.0.1:5432/${name}`;
    try {
      await runCustomerCodeRecovery({ databaseUrl });
      assert.fail('Should have thrown for mixed states');
    } catch (error) {
      const message = String(error);
      assert.match(message, /Ambiguous ledger history/);
      log('  ✅ Correctly rejected mixed applied and rolled-back rows');
    }
    
    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

async function testValidSingleRow() {
  const name = 'vardena_l06_valid_single_' + SUFFIX;
  log('\n=== Test: Valid single ledger row (failed) ===');
  
  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);
      
      // Insert a single failed ledger row
      await client.query(`
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', null, null, 0, 'validation failed', CURRENT_TIMESTAMP)
      `);
      
      // Add a customer without code
      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000005', null, 'Test Customer')
      `);
    });
    
    const databaseUrl = `postgresql://vardena:vardena_test_password@127.0.0.1:5432/${name}`;
    // Should succeed - single row is valid
    const result = await runCustomerCodeRecovery({ databaseUrl });
    assert.ok(result);
    assert.equal(result.state, 'failed');
    log('  ✅ Correctly accepted single failed row');
    
    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

async function testValidMultipleRowsOneFinished() {
  const name = 'vardena_l06_valid_multi_finished_' + SUFFIX;
  log('\n=== Test: Valid multiple rows with one finished (most recent) ===');
  
  try {
    await createDatabase(name);
    await withClient(name, async (client) => {
      await setupSchema(client);
      
      // Insert multiple rows where only the most recent is finished
      const now = new Date();
      await client.query(`
        INSERT INTO public._prisma_migrations 
        (id, migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs, started_at)
        VALUES 
        ('ledger1', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', null, null, 0, 'first attempt failed', $1),
        ('ledger2', '20261020000000_licensing_customer_code', 'd6759751a460f067f87f0c38c2b09a24ae1046e99ff55b9ecf33243f889981ae', $2, null, 1, 'retry succeeded', $3)
      `, [new Date(now.getTime() - 1000).toISOString(), now.toISOString(), new Date(now.getTime() - 2000).toISOString()]);
      
      // Add a customer with code
      await client.query(`
        INSERT INTO licensing.customers (id, customer_code, display_name)
        VALUES ('01TESTCUST0000000000006', 'TEST-CODE-002', 'Test Customer')
      `);
    });
    
    const databaseUrl = `postgresql://vardena:vardena_test_password@127.0.0.1:5432/${name}`;
    // Should succeed - only one finished row and it's the most recent
    const result = await runCustomerCodeRecovery({ databaseUrl });
    assert.ok(result);
    assert.equal(result.state, 'applied');
    log('  ✅ Correctly accepted multiple rows with one finished (most recent)');
    
    await dropDatabase(name);
    log('  ✅ Test passed');
  } catch (error) {
    log(`  ❌ Test failed: ${error.message}`);
    throw error;
  }
}

async function main() {
  log('=== L-06 Ledger Ambiguity Tests ===\n');
  
  try {
    await testMultipleFailedRows();
    await testMultipleAppliedRows();
    await testFinishedNotRecent();
    await testMixedStates();
    await testValidSingleRow();
    await testValidMultipleRowsOneFinished();
    
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
