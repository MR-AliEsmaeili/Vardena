#!/usr/bin/env node
/**
 * Targeted populated-database rehearsal for the licensing migration chain:
 * retained version/import state, its corrections, customer identity, and the
 * OQ-83 client-device lifecycle migration.
 *
 * The migration turns the L-02 single-current-license model into retained
 * license versions without losing a single fact. This script proves that on a
 * disposable PostgreSQL database with a populated pre-migration fixture:
 *
 *   1. an installation with a current license, a replaced historical license
 *      and entitlements on both;
 *   2. a second installation with no license at all (the unlicensed state);
 *   3. a replaced row whose status is NOT ACTIVE (the SUSPENDED vocabulary
 *      must survive the migration verbatim — the mapping decision is open,
 *      PDR-11 PQ-4 / OQ-79, and a lossy migration is forbidden).
 *
 * After the migration it asserts: every license id, status, provider, window,
 * limit, hash and activation fact is preserved; entitlements moved with their
 * ids; superseded history is retained but ineligible; exactly one eligible
 * version per licensed installation remains; the L-02 columns and the partial
 * unique index are gone; the new unique guards are enforced; and the
 * fail-closed preflight aborts a database whose data the migration could not
 * represent faithfully (duplicate artifact hashes for one installation).
 *
 * The correction is asserted too: every superseded row gets a `governs_until`
 * (the successor's start when it is recorded, the recorded instant otherwise),
 * a row that the pre-correction behaviour retired prematurely is REPAIRED to
 * the successor's start, the pair check refuses a half-stamped row, and the
 * migrated data satisfies the disjoint-window invariant.
 *
 * The audit-detail migration is then applied to the populated schema: an
 * existing 500-character event detail must remain byte-for-byte intact, and a
 * new detail longer than 500 characters must round-trip as PostgreSQL TEXT.
 *
 * Finally, the rehearsal reaches the exact schema immediately before OQ-83,
 * adds a representative pre-device-entitlement VLIC2 version plus retained
 * customer/audit/history data, snapshots every existing licensing row, and
 * applies the actual 20261022000000 migration. It proves that all old row data,
 * the external artifact's retained SHA-256, and customer identity survive;
 * every old version becomes UNSPECIFIED (NULL + presence=false); and the new
 * columns, enums, tables, checks, foreign keys, and partial unique indexes have
 * their expected PostgreSQL shape. The rehearsal then reaches the official
 * Developer-license migration and proves lossless commercial backfill, closed
 * holder typing, database-enforced holder exclusivity, and customer-free
 * Developer-license persistence.
 *
 * Connection: VARDENA_REHEARSAL_ADMIN_URL (same local maintenance-database URL
 * used by the other migration rehearsals). This script refuses non-local
 * hosts, never reuses or drops a pre-existing database, and removes only the
 * uniquely created disposable databases. Set KEEP=1 to retain them.
 *
 * A fixture rehearsal is not a substitute for running the migration against a
 * real installation's data; the live PostgreSQL suite
 * (`test/licensing-persistence-live.e2e-spec.ts`) covers the runtime side.
 */

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'migrations');
const readMigration = (name) =>
  readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');

const PREREQUISITE_MIGRATIONS = [
  '20261001000000_licensing_foundation',
  '20261002000000_licensing_installation_identity_and_activation',
  '20261003000000_licensing_drop_raw_license_code',
].map(readMigration);
const MIGRATION_SQL = readMigration(
  '20261014000000_licensing_version_model_and_import',
);
/**
 * The corrective follow-up (PDR-11 corrective review, Defect 1): it separates
 * WHEN a supersession was recorded from WHEN the predecessor stops governing.
 * It is applied right after the L-03 migration, exactly as `migrate deploy`
 * would, and the assertions below cover its backfill and its pair check.
 */
const CORRECTION_SQL = readMigration(
  '20261015000000_licensing_supersession_governs_until',
);
const TRANSFER_AUDIT_SQL = readMigration(
  '20261016000000_licensing_customer_transfer_audit',
);
const RECOVERY_AUDIT_SQL = readMigration(
  '20261017000000_license_audit_previous_license_id',
);
const AUDIT_DETAIL_SQL = readMigration(
  '20261018000000_licensing_audit_detail_text',
);
const CUSTOMER_CODE_SQL = readMigration(
  '20261020000000_licensing_customer_code',
);
const TRANSFER_LICENSE_COMMENT_SQL = readMigration(
  '20261021000000_license_audit_previous_license_id_transfer',
);
const CLIENT_DEVICE_LIFECYCLE_SQL = readMigration(
  '20261022000000_licensing_client_device_lifecycle',
);
/**
 * OD-LIC-06 / OQ-88: the renewal effective start. Purely additive — the column
 * is nullable, nothing is backfilled, and no existing window is rewritten — so
 * the rehearsal asserts the schema, the local check constraint and, above all,
 * that every pre-existing row reads exactly as it did before.
 */
const RENEWAL_GOVERNS_FROM_SQL = readMigration(
  '20261023000000_licensing_renewal_governs_from',
);
const REVOCATIONS_SQL = readMigration('20261024000000_licensing_revocations');
const OFFICIAL_DEVELOPER_LICENSE_SQL = readMigration(
  '20261025000000_official_developer_license',
);
const PRE_DEVICE_VLIC2_ARTIFACT =
  'VLIC2.eyJ2IjoyLCJraW5kIjoic2VydmVyLWxpY2Vuc2UtdmVyc2lvbiIsIm9wZXJhdGlvbklkIjoiMDFLN09QRVJBVElPTkxFR0FDWVYyMDAwIn0.ZGV0ZXJtaW5pc3RpYy1yZWhlYXJzYWwtc2lnbmF0dXJl';
const PRE_DEVICE_VLIC2_HASH = createHash('sha256')
  .update(PRE_DEVICE_VLIC2_ARTIFACT, 'utf8')
  .digest('hex');
const AUDIT_DETAIL_FIXTURE = {
  id: 'rehearsal-preserved-audit-detail',
  preserved: 'H'.repeat(500),
  longId: 'rehearsal-long-audit-detail',
  long: 'L'.repeat(750),
  occurredAt: '2026-10-12T00:00:00Z',
};
/** An L-03-era successor row, used to prove the repair path of the backfill. */
const REHEARSAL_SUCCESSOR = {
  id: '01K7LICENSESUCCESSOR00000',
  operationId: '01K7OPERATIONSUCCESSOR0000',
  documentHash: 'hash-successor',
  validFrom: '2027-01-01T00:00:00Z',
  validUntil: '2028-01-01T00:00:00Z',
  recordedAt: '2026-06-01T00:00:00Z',
};

const ADMIN_URL =
  process.env['VARDENA_REHEARSAL_ADMIN_URL'] ??
  'postgresql://vardena:vardena_test_password@127.0.0.1:5432/postgres';
const SUFFIX = `${process.pid}_${randomBytes(6).toString('hex')}`;
const REHEARSAL_DB =
  process.env['VARDENA_REHEARSAL_DB'] ?? `vardena_license_version_${SUFFIX}`;
const DUPLICATE_DB =
  process.env['VARDENA_REHEARSAL_DUPLICATE_DB'] ??
  `vardena_license_duplicate_${SUFFIX}`;
const REPAIR_DB =
  process.env['VARDENA_REHEARSAL_REPAIR_DB'] ??
  `vardena_license_repair_${SUFFIX}`;
const KEEP = process.env['KEEP'] === '1';
const ADMIN_HOST = new URL(ADMIN_URL).hostname.replace(/^\[|\]$/g, '');

if (!['localhost', '127.0.0.1', '::1'].includes(ADMIN_HOST)) {
  throw new Error(
    'Migration rehearsal is local-only; VARDENA_REHEARSAL_ADMIN_URL must target localhost, 127.0.0.1, or ::1.',
  );
}
for (const name of [REHEARSAL_DB, DUPLICATE_DB, REPAIR_DB]) {
  if (!/^[A-Za-z0-9_]{1,63}$/.test(name)) {
    throw new Error(
      'VARDENA_REHEARSAL_DB / VARDENA_REHEARSAL_DUPLICATE_DB must be PostgreSQL identifiers of at most 63 letters, digits, or underscores.',
    );
  }
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
  await client.connect();
  try {
    return await fn(client);
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
    if (existing.rowCount > 0) {
      throw new Error(
        `Refusing to reuse the existing database "${name}"; choose another VARDENA_REHEARSAL_DB.`,
      );
    }
    await client.query(`CREATE DATABASE "${name}"`);
  });
}

async function dropDatabase(name) {
  await withClient('postgres', async (client) => {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
      [name],
    );
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  });
}

/** The populated pre-migration fixture (the L-02 shape). */
async function seedFixture(client) {
  await client.query(`
    INSERT INTO "licensing"."customers" ("id", "display_name") VALUES
      ('01K7CUSTOMERAAAAAAAAAAAAAA', 'Acme Holding'),
      ('01K7CUSTOMERBBBBBBBBBBBBBB', 'Bravo Industries');

    INSERT INTO "licensing"."installations"
      ("id", "customer_id", "name", "is_self", "created_at", "updated_at")
    VALUES
      ('01K7INSTALLATIONAAAAAAAAAA', '01K7CUSTOMERAAAAAAAAAAAAAA', 'Vardena', true,
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('01K7INSTALLATIONBBBBBBBBBB', NULL, 'Vardena', false,
       '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

    INSERT INTO "licensing"."licenses"
      ("id", "installation_id", "customer_id", "status", "provider", "code_hash",
       "valid_from", "valid_until", "organization_limit", "user_limit",
       "activated_at", "activated_by", "replaced_at", "created_at", "updated_at")
    VALUES
      ('01K7LICENSEHISTORICAL00000', '01K7INSTALLATIONAAAAAAAAAA',
       '01K7CUSTOMERAAAAAAAAAAAAAA', 'EXPIRED', 'persistent', 'hash-historical',
       '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 2, 8,
       '2025-01-01T00:00:00Z', '01K7ACTORAAAAAAAAAAAAAAAAA',
       '2026-01-01T00:00:00Z', '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('01K7LICENSECURRENT0000000', '01K7INSTALLATIONAAAAAAAAAA',
       '01K7CUSTOMERAAAAAAAAAAAAAA', 'ACTIVE', 'persistent', 'hash-current',
       '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 3, 25,
       '2026-01-01T00:00:00Z', '01K7ACTORAAAAAAAAAAAAAAAAA',
       NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

    INSERT INTO "licensing"."license_entitlements"
      ("id", "license_id", "kind", "code", "created_at", "updated_at")
    VALUES
      ('01K7ENTITLEMENTHISTORICAL0', '01K7LICENSEHISTORICAL00000', 'MODULE',
       'organization', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'),
      ('01K7ENTITLEMENTCURRENT0000', '01K7LICENSECURRENT0000000', 'MODULE',
       'organization', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ('01K7ENTITLEMENTCURRENT0001', '01K7LICENSECURRENT0000000', 'FEATURE',
       'advanced-reports', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  `);
}

/** The fixture that the migration must refuse (duplicate artifact hash). */
async function seedUnrepresentableFixture(client) {
  await client.query(`
    INSERT INTO "licensing"."customers" ("id", "display_name")
      VALUES ('01K7CUSTOMERDUPLICATE00000', 'Duplicate Ltd.');

    INSERT INTO "licensing"."installations"
      ("id", "customer_id", "name", "is_self")
      VALUES ('01K7INSTALLATIONDUPLICATE0', '01K7CUSTOMERDUPLICATE00000',
              'Vardena', true);

    INSERT INTO "licensing"."licenses"
      ("id", "installation_id", "customer_id", "status", "provider", "code_hash",
       "valid_from", "valid_until", "activated_at", "replaced_at")
    VALUES
      ('01K7LICENSEDUPLICATE00000A', '01K7INSTALLATIONDUPLICATE0',
       '01K7CUSTOMERDUPLICATE00000', 'ACTIVE', 'persistent', 'hash-same',
       '2026-01-01T00:00:00Z', NULL, '2026-01-01T00:00:00Z', NULL),
      ('01K7LICENSEDUPLICATE00000B', '01K7INSTALLATIONDUPLICATE0',
       '01K7CUSTOMERDUPLICATE00000', 'ACTIVE', 'persistent', 'hash-same',
       '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
       '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  `);
}

async function assertPreservedState(client) {
  // 1. License identities survive unchanged, without version columns.
  const columns = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'licensing' AND table_name = 'licenses'`,
  );
  const names = columns.rows.map((row) => row.column_name);
  for (const gone of [
    'status',
    'provider',
    'code_hash',
    'valid_from',
    'valid_until',
    'organization_limit',
    'user_limit',
    'activated_at',
    'activated_by',
    'replaced_at',
  ]) {
    assert.ok(!names.includes(gone), `licenses.${gone} should be dropped`);
  }
  const licenses = await client.query(
    `SELECT "id", "installation_id", "customer_id" FROM "licensing"."licenses" ORDER BY "id"`,
  );
  assert.equal(licenses.rowCount, 2, 'both license identities must survive');

  // 2. Version rows carry every pre-migration fact verbatim.
  const versions = await client.query(
    `SELECT "id", "license_id", "installation_id", "operation_id", "status",
            "provider", "document_version", "document_hash", "source",
            "valid_from", "valid_until", "organization_limit", "user_limit",
            "imported_at", "imported_by", "superseded_at"
       FROM "licensing"."license_versions" ORDER BY "id"`,
  );
  assert.equal(versions.rowCount, 2, 'one version per legacy license row');
  const current = versions.rows.find(
    (row) => row.id === '01K7LICENSECURRENT0000000',
  );
  const historical = versions.rows.find(
    (row) => row.id === '01K7LICENSEHISTORICAL00000',
  );
  assert.ok(
    current && historical,
    'version ids are preserved, not regenerated',
  );
  assert.equal(current.license_id, '01K7LICENSECURRENT0000000');
  assert.equal(current.status, 'ACTIVE');
  assert.equal(current.provider, 'persistent');
  assert.equal(current.document_version, 1);
  assert.equal(current.document_hash, 'hash-current');
  assert.equal(current.source, 'legacy-code');
  assert.equal(current.organization_limit, 3);
  assert.equal(current.user_limit, 25);
  assert.equal(current.imported_by, '01K7ACTORAAAAAAAAAAAAAAAAA');
  assert.equal(
    new Date(current.valid_until).toISOString(),
    '2027-01-01T00:00:00.000Z',
  );
  assert.equal(
    new Date(current.imported_at).toISOString(),
    '2026-01-01T00:00:00.000Z',
  );
  assert.equal(
    current.superseded_at,
    null,
    'the current version stays eligible',
  );

  assert.equal(historical.status, 'EXPIRED', 'status is copied verbatim');
  assert.equal(historical.document_hash, 'hash-historical');
  assert.equal(
    new Date(historical.superseded_at).toISOString(),
    '2026-01-01T00:00:00.000Z',
    'replaced_at becomes superseded_at',
  );
  assert.match(
    current.operation_id,
    /^legacy-code:hash-current:01K7LICENSECURRENT0000000$/,
    'operation ids are deterministic and unique per legacy row',
  );
  assert.notEqual(current.operation_id, historical.operation_id);

  // 3. Exactly one eligible version per licensed installation — the property
  //    the effective-version resolution depends on.
  const eligible = await client.query(
    `SELECT "installation_id", COUNT(*)::int AS count
       FROM "licensing"."license_versions"
      WHERE "superseded_at" IS NULL
      GROUP BY "installation_id"`,
  );
  assert.deepEqual(
    eligible.rows,
    [{ installation_id: '01K7INSTALLATIONAAAAAAAAAA', count: 1 }],
    'the unlicensed installation has no versions and the licensed one exactly one eligible version',
  );

  // 3b. The supersession correction: every stamped row now has a hand-over
  //     instant, the prematurely retired row was repaired to its successor's
  //     start, and the L-02 row keeps the recorded instant as its hand-over.
  const corrected = await client.query(
    `SELECT "id", "superseded_at", "governs_until"
       FROM "licensing"."license_versions" ORDER BY "id"`,
  );
  const byId = new Map(corrected.rows.map((row) => [row.id, row]));
  const correctedCurrent = byId.get('01K7LICENSECURRENT0000000');
  const correctedHistorical = byId.get('01K7LICENSEHISTORICAL00000');
  assert.equal(
    correctedCurrent.governs_until,
    null,
    'a version nobody retired has no hand-over instant',
  );
  assert.equal(
    new Date(correctedHistorical.governs_until).toISOString(),
    new Date(correctedHistorical.superseded_at).toISOString(),
    'a row without a recorded successor keeps the instant the old model stopped treating it as current',
  );

  // 3c. The pair check refuses a half-stamped row, in both directions.
  const halfStampedCases = [
    {
      label: 'governs_until without a recorded supersession',
      sql: `UPDATE "licensing"."license_versions"
               SET "governs_until" = now()
             WHERE "id" = $1`,
    },
    {
      label: 'a recorded supersession without a hand-over instant',
      sql: `UPDATE "licensing"."license_versions"
               SET "governs_until" = NULL
             WHERE "id" = $1`,
    },
  ];
  for (const halfStamped of halfStampedCases) {
    let failed = false;
    try {
      await client.query('BEGIN');
      await client.query(
        halfStamped.sql,
        halfStamped.label.startsWith('governs_until')
          ? [correctedCurrent.id]
          : [correctedHistorical.id],
      );
    } catch {
      failed = true;
    } finally {
      await client.query('ROLLBACK');
    }
    assert.ok(failed, `${halfStamped.label} must be rejected by the database`);
  }

  // 3d. Migrated data satisfies the invariant every import must preserve: at
  //     most one retained version governs any instant.
  const overlappingWindows = await client.query(
    `SELECT COUNT(*)::int AS count
       FROM "licensing"."license_versions" AS a
       JOIN "licensing"."license_versions" AS b
         ON b."installation_id" = a."installation_id" AND b."id" > a."id"
      WHERE tstzrange(
              a."valid_from",
              LEAST(COALESCE(a."valid_until", 'infinity'::timestamptz),
                    COALESCE(a."governs_until", 'infinity'::timestamptz)),
              '[)'
            )
         && tstzrange(
              b."valid_from",
              LEAST(COALESCE(b."valid_until", 'infinity'::timestamptz),
                    COALESCE(b."governs_until", 'infinity'::timestamptz)),
              '[)'
            )`,
  );
  assert.equal(
    overlappingWindows.rows[0].count,
    0,
    'migrated effective windows are pairwise disjoint',
  );

  // 4. Entitlements moved with their ids, kinds and codes.
  const entitlements = await client.query(
    `SELECT "id", "version_id", "kind", "code"
       FROM "licensing"."license_version_entitlements" ORDER BY "id"`,
  );
  assert.deepEqual(
    entitlements.rows.map((row) => ({ ...row })),
    [
      {
        id: '01K7ENTITLEMENTCURRENT0000',
        version_id: '01K7LICENSECURRENT0000000',
        kind: 'MODULE',
        code: 'organization',
      },
      {
        id: '01K7ENTITLEMENTCURRENT0001',
        version_id: '01K7LICENSECURRENT0000000',
        kind: 'FEATURE',
        code: 'advanced-reports',
      },
      {
        id: '01K7ENTITLEMENTHISTORICAL0',
        version_id: '01K7LICENSEHISTORICAL00000',
        kind: 'MODULE',
        code: 'organization',
      },
    ],
  );
  const legacyTable = await client.query(
    `SELECT to_regclass('licensing.license_entitlements') AS table_name`,
  );
  assert.equal(
    legacyTable.rows[0].table_name,
    null,
    'the L-02 entitlement table is removed after the move',
  );

  // 5. The new guards are enforced. A duplicate operation id and a duplicate
  //    artifact hash for the same installation must both be rejected.
  const guardCases = [
    {
      label: 'duplicate operation id',
      id: '01K7INSERTDUPLICATEOP0000',
      operationId: current.operation_id,
      documentHash: 'insert-hash-1',
    },
    {
      label: 'duplicate artifact hash',
      id: '01K7INSERTDUPLICATEHASH00',
      operationId: 'insert-op-2',
      documentHash: current.document_hash,
    },
  ];
  for (const guard of guardCases) {
    let failed = false;
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO "licensing"."license_versions"
           ("id", "license_id", "installation_id", "operation_id", "status",
            "provider", "document_version", "document_hash", "source",
            "valid_from", "imported_at", "created_at", "updated_at")
         VALUES ($1, '01K7LICENSECURRENT0000000',
                 '01K7INSTALLATIONAAAAAAAAAA', $2, 'ACTIVE', 'persistent', 2,
                 $3, 'file', now(), now(), now(), now())`,
        [guard.id, guard.operationId, guard.documentHash],
      );
    } catch {
      failed = true;
    } finally {
      await client.query('ROLLBACK');
    }
    assert.ok(failed, `${guard.label} must be rejected by the database`);
  }

  // 6. The retired partial unique index is gone.
  const indexes = await client.query(
    `SELECT indexname FROM pg_indexes
      WHERE schemaname = 'licensing' AND tablename = 'licenses'`,
  );
  const indexNames = indexes.rows.map((row) => row.indexname);
  assert.ok(
    !indexNames.includes('uq_licenses_installation_current'),
    'the single-current-license index must be dropped',
  );
  assert.ok(
    indexNames.includes('uq_licenses_id_installation'),
    'the composite license target must exist for the version foreign key',
  );
}

async function assertAuditDetailWidening(client) {
  const column = await client.query(
    `SELECT data_type, character_maximum_length
       FROM information_schema.columns
      WHERE table_schema = 'licensing'
        AND table_name = 'license_audit_events'
        AND column_name = 'detail'`,
  );
  assert.equal(column.rowCount, 1, 'the audit detail column must exist');
  assert.equal(column.rows[0].data_type, 'text');
  assert.equal(
    column.rows[0].character_maximum_length,
    null,
    'TEXT has no old VARCHAR(500) length limit',
  );

  const preserved = await client.query(
    `SELECT "detail" FROM "licensing"."license_audit_events" WHERE "id" = $1`,
    [AUDIT_DETAIL_FIXTURE.id],
  );
  assert.equal(preserved.rowCount, 1, 'the historical audit event survives');
  assert.equal(
    preserved.rows[0].detail,
    AUDIT_DETAIL_FIXTURE.preserved,
    'migration must preserve the existing 500-character detail exactly',
  );

  await client.query(
    `INSERT INTO "licensing"."license_audit_events"
       ("id", "installation_id", "event_type", "outcome", "source", "detail", "occurred_at")
     VALUES ($1, '01K7INSTALLATIONAAAAAAAAAA', 'license.import.recovered', 'APPLIED', 'file', $2, $3)`,
    [
      AUDIT_DETAIL_FIXTURE.longId,
      AUDIT_DETAIL_FIXTURE.long,
      AUDIT_DETAIL_FIXTURE.occurredAt,
    ],
  );
  const longer = await client.query(
    `SELECT "detail" FROM "licensing"."license_audit_events" WHERE "id" = $1`,
    [AUDIT_DETAIL_FIXTURE.longId],
  );
  assert.equal(longer.rowCount, 1);
  assert.equal(longer.rows[0].detail, AUDIT_DETAIL_FIXTURE.long);
  assert.equal(longer.rows[0].detail.length, 750);
}

async function assertCustomerCodeMigration(client) {
  // 1. Applying 20261020000000 on populated rows without owner-assigned
  //    business codes must fail closed and never fabricate codes.
  let missingError = null;
  try {
    await client.query('BEGIN');
    await client.query(CUSTOMER_CODE_SQL);
  } catch (error) {
    missingError = error.message;
  } finally {
    await client.query('ROLLBACK');
  }
  assert.ok(
    missingError !== null &&
      /without an explicit customer_code/i.test(missingError),
    `migration must refuse populated rows missing customer_code (got: ${String(missingError)})`,
  );

  // 2. Staged owner-supplied business customer_code values allow the migration
  //    to succeed and enforce NOT NULL, CHECK, and UNIQUE constraints.
  await client.query(
    `ALTER TABLE "licensing"."customers" ADD COLUMN IF NOT EXISTS "customer_code" VARCHAR(64)`,
  );
  await client.query(`
    UPDATE "licensing"."customers"
       SET "customer_code" = CASE "id"
         WHEN '01K7CUSTOMERAAAAAAAAAAAAAA' THEN 'CUST-ACME-001'
         WHEN '01K7CUSTOMERBBBBBBBBBBBBBB' THEN 'CUST-BRAVO-002'
       END
  `);
  await client.query(CUSTOMER_CODE_SQL);

  const customers = await client.query(
    `SELECT "id", "customer_code", "display_name"
       FROM "licensing"."customers" ORDER BY "id"`,
  );
  assert.deepEqual(
    customers.rows.map((row) => ({ ...row })),
    [
      {
        id: '01K7CUSTOMERAAAAAAAAAAAAAA',
        customer_code: 'CUST-ACME-001',
        display_name: 'Acme Holding',
      },
      {
        id: '01K7CUSTOMERBBBBBBBBBBBBBB',
        customer_code: 'CUST-BRAVO-002',
        display_name: 'Bravo Industries',
      },
    ],
  );

  const invalidCases = [
    {
      label: 'duplicate customer_code',
      id: '01K7CUSTOMERCCCCCCCCCCCCCC',
      code: 'CUST-ACME-001',
    },
    {
      label: 'empty customer_code',
      id: '01K7CUSTOMERDDDDDDDDDDDDDD',
      code: '',
    },
    {
      label: 'whitespace customer_code',
      id: '01K7CUSTOMEREEEEEEEEEEEEEE',
      code: '   ',
    },
    {
      label: 'customer_code equal to id',
      id: '01K7CUSTOMERFFFFFFFFFFFFFF',
      code: '01K7CUSTOMERFFFFFFFFFFFFFF',
    },
  ];
  for (const invalid of invalidCases) {
    let rejected = false;
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO "licensing"."customers" ("id", "customer_code", "display_name")
         VALUES ($1, $2, 'Invalid Customer')`,
        [invalid.id, invalid.code],
      );
    } catch {
      rejected = true;
    } finally {
      await client.query('ROLLBACK');
    }
    assert.ok(rejected, `${invalid.label} must be rejected by the database`);
  }
}

async function seedPreDeviceEntitlementFixture(client) {
  await client.query(
    `INSERT INTO "licensing"."customers"
       ("id", "customer_code", "display_name", "created_at", "updated_at")
     VALUES
       ('01K7CUSTOMERLEGACYV200000', 'CUST-LEGACY-V2', 'Legacy VLIC2 Customer',
        '2026-10-14T08:00:00Z', '2026-10-14T08:00:00Z');

     INSERT INTO "licensing"."installations"
       ("id", "customer_id", "name", "is_self", "created_at", "updated_at")
     VALUES
       ('01K7INSTALLLEGACYV2000000', '01K7CUSTOMERLEGACYV200000',
        'Legacy VLIC2 Installation', false,
        '2026-10-14T08:00:00Z', '2026-10-14T08:00:00Z');

     INSERT INTO "licensing"."licenses"
       ("id", "installation_id", "customer_id", "created_at", "updated_at")
     VALUES
       ('01K7LICENSELEGACYV2000000', '01K7INSTALLLEGACYV2000000',
        '01K7CUSTOMERLEGACYV200000',
        '2026-10-14T08:00:00Z', '2026-10-14T08:00:00Z')`,
  );

  await client.query(
    `INSERT INTO "licensing"."license_versions"
       ("id", "license_id", "installation_id", "operation_id", "status",
        "provider", "document_version", "document_hash", "key_id", "source",
        "valid_from", "valid_until", "organization_limit", "user_limit",
        "imported_at", "imported_by", "supersedes_version_id",
        "superseded_at", "governs_until", "superseded_by_version_id",
        "created_at", "updated_at")
     VALUES
       ('01K7VERSIONLEGACYV2000000', '01K7LICENSELEGACYV2000000',
        '01K7INSTALLLEGACYV2000000', '01K7OPERATIONLEGACYV20000', 'ACTIVE',
        'persistent', 2, $1, 'legacy-authority-2026', 'file',
        '2026-10-14T08:00:00Z', '2027-10-14T08:00:00Z', 4, 40,
        '2026-10-14T08:05:00Z', '01K7ACTORAAAAAAAAAAAAAAAAA',
        NULL, NULL, NULL, NULL,
        '2026-10-14T08:05:00Z', '2026-10-14T08:05:00Z')`,
    [PRE_DEVICE_VLIC2_HASH],
  );

  await client.query(
    `INSERT INTO "licensing"."license_version_entitlements"
       ("id", "version_id", "kind", "code", "created_at", "updated_at")
     VALUES
       ('01K7ENTITLEMENTLEGACYV200', '01K7VERSIONLEGACYV2000000', 'MODULE',
        'organization', '2026-10-14T08:05:00Z', '2026-10-14T08:05:00Z')`,
  );

  await client.query(
    `INSERT INTO "licensing"."license_audit_events"
       ("id", "installation_id", "event_type", "outcome", "operation_id",
        "license_id", "version_id", "actor_id", "source", "document_hash",
        "reason", "detail", "occurred_at", "created_at", "updated_at")
     VALUES
       ('01K7AUDITLEGACYV20000000', '01K7INSTALLLEGACYV2000000',
        'license.import.applied', 'APPLIED', '01K7OPERATIONLEGACYV20000',
        '01K7LICENSELEGACYV2000000', '01K7VERSIONLEGACYV2000000',
        '01K7ACTORAAAAAAAAAAAAAAAAA', 'file', $1, NULL,
        'pre-device-entitlement VLIC2 import',
        '2026-10-14T08:05:00Z', '2026-10-14T08:05:00Z',
        '2026-10-14T08:05:00Z')`,
    [PRE_DEVICE_VLIC2_HASH],
  );
}

async function snapshotPreDeviceState(client) {
  const tables = [
    ['customers', []],
    ['installations', []],
    ['licenses', []],
    ['license_versions', ['device_limit', 'device_limit_specified']],
    ['license_version_entitlements', []],
    ['license_audit_events', ['device_id', 'replacement_request_id']],
  ];
  const snapshot = {};
  for (const [table, excluded] of tables) {
    const subtraction = excluded.map((column) => ` - '${column}'`).join('');
    const result = await client.query(
      `SELECT COALESCE(jsonb_agg("row_data" ORDER BY "id"), '[]'::jsonb) AS "rows"
         FROM (
           SELECT "id", to_jsonb(row_source)${subtraction} AS "row_data"
             FROM "licensing"."${table}" AS row_source
         ) AS snapshot_rows`,
    );
    snapshot[table] = result.rows[0].rows;
  }
  return snapshot;
}

async function expectConstraintFailure(client, label, sql, values = []) {
  let rejected = false;
  try {
    await client.query('BEGIN');
    await client.query(sql, values);
  } catch {
    rejected = true;
  } finally {
    await client.query('ROLLBACK');
  }
  assert.ok(rejected, `${label} must be rejected by PostgreSQL`);
}

async function assertClientDeviceMigration(client, before) {
  const after = await snapshotPreDeviceState(client);
  assert.deepEqual(
    after,
    before,
    'OQ-83 migration must preserve every pre-existing licensing field byte-for-byte',
  );

  const legacyHash = await client.query(
    `SELECT "document_version", "document_hash", "key_id"
       FROM "licensing"."license_versions"
      WHERE "id" = '01K7VERSIONLEGACYV2000000'`,
  );
  assert.deepEqual(legacyHash.rows, [
    {
      document_version: 2,
      document_hash: PRE_DEVICE_VLIC2_HASH,
      key_id: 'legacy-authority-2026',
    },
  ]);
  assert.equal(
    createHash('sha256')
      .update(PRE_DEVICE_VLIC2_ARTIFACT, 'utf8')
      .digest('hex'),
    legacyHash.rows[0].document_hash,
    'the retained hash still identifies the exact external signed artifact bytes',
  );

  const quota = await client.query(
    `SELECT "id", "device_limit", "device_limit_specified"
       FROM "licensing"."license_versions" ORDER BY "id"`,
  );
  assert.ok(
    quota.rowCount > 0,
    'the rehearsal must upgrade populated versions',
  );
  for (const row of quota.rows) {
    assert.equal(
      row.device_limit,
      null,
      `${row.id} must have no inferred limit`,
    );
    assert.equal(
      row.device_limit_specified,
      false,
      `${row.id} must remain UNSPECIFIED, not unlimited`,
    );
  }

  const columns = await client.query(
    `SELECT "column_name", "data_type", "is_nullable", "column_default"
       FROM information_schema.columns
      WHERE "table_schema" = 'licensing'
        AND "table_name" = 'license_versions'
        AND "column_name" IN ('device_limit', 'device_limit_specified')
      ORDER BY "column_name"`,
  );
  assert.deepEqual(columns.rows, [
    {
      column_name: 'device_limit',
      data_type: 'integer',
      is_nullable: 'YES',
      column_default: null,
    },
    {
      column_name: 'device_limit_specified',
      data_type: 'boolean',
      is_nullable: 'NO',
      column_default: 'false',
    },
  ]);

  const tables = await client.query(
    `SELECT "table_name"
       FROM information_schema.tables
      WHERE "table_schema" = 'licensing'
        AND "table_name" IN (
          'client_devices',
          'device_enrollment_challenges',
          'client_device_replacement_requests'
        )
      ORDER BY "table_name"`,
  );
  assert.deepEqual(
    tables.rows.map((row) => row.table_name),
    [
      'client_device_replacement_requests',
      'client_devices',
      'device_enrollment_challenges',
    ],
  );
  for (const table of tables.rows.map((row) => row.table_name)) {
    const count = await client.query(
      `SELECT COUNT(*)::int AS "count" FROM "licensing"."${table}"`,
    );
    assert.equal(count.rows[0].count, 0, `${table} must start empty`);
  }

  const enums = await client.query(
    `SELECT t.typname AS "name", json_agg(e.enumlabel ORDER BY e.enumsortorder) AS "labels"
       FROM pg_type AS t
       JOIN pg_namespace AS n ON n.oid = t.typnamespace
       JOIN pg_enum AS e ON e.enumtypid = t.oid
      WHERE n.nspname = 'licensing'
        AND t.typname IN (
          'ClientDeviceStatus',
          'DeviceEnrollmentState',
          'DeviceReplacementState'
        )
      GROUP BY t.typname
      ORDER BY t.typname`,
  );
  assert.deepEqual(enums.rows, [
    {
      name: 'ClientDeviceStatus',
      labels: ['ACTIVE', 'DEACTIVATED', 'REPLACED'],
    },
    {
      name: 'DeviceEnrollmentState',
      labels: ['PENDING', 'CONSUMED', 'EXPIRED'],
    },
    {
      name: 'DeviceReplacementState',
      labels: ['CHALLENGE', 'PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
    },
  ]);

  const constraints = await client.query(
    `SELECT conname
       FROM pg_constraint
      WHERE connamespace = 'licensing'::regnamespace
        AND conname IN (
          'license_versions_device_limit_nonnegative_check',
          'license_versions_device_limit_presence_check',
          'client_devices_state_timestamps_check',
          'client_devices_origin_check',
          'device_enrollment_challenges_state_timestamp_check',
          'client_device_replacement_requests_state_check',
          'client_device_replacement_requests_old_device_same_installation_fkey',
          'client_devices_enrollment_challenge_same_installation_fkey',
          'client_devices_replacement_request_same_installation_fkey'
        )
      ORDER BY conname`,
  );
  assert.deepEqual(
    constraints.rows.map((row) => row.conname),
    [
      // PostgreSQL truncates identifiers to NAMEDATALEN - 1 (63 bytes).
      'client_device_replacement_requests_old_device_same_installation',
      'client_device_replacement_requests_state_check',
      'client_devices_enrollment_challenge_same_installation_fkey',
      'client_devices_origin_check',
      'client_devices_replacement_request_same_installation_fkey',
      'client_devices_state_timestamps_check',
      'device_enrollment_challenges_state_timestamp_check',
      'license_versions_device_limit_nonnegative_check',
      'license_versions_device_limit_presence_check',
    ],
  );

  const indexes = await client.query(
    `SELECT indexname, indexdef
       FROM pg_indexes
      WHERE schemaname = 'licensing'
        AND indexname IN (
          'uq_device_enrollment_challenges_pending_fingerprint',
          'uq_device_replacement_requests_one_pending_per_old_device',
          'uq_device_replacement_requests_active_key_fingerprint',
          'uq_client_devices_enrollment_challenge_installation',
          'uq_client_devices_replacement_request_installation'
        )
      ORDER BY indexname`,
  );
  assert.equal(indexes.rowCount, 5, 'all OQ-83 unique indexes must exist');
  assert.match(
    indexes.rows.find(
      (row) =>
        row.indexname ===
        'uq_device_replacement_requests_one_pending_per_old_device',
    ).indexdef,
    /WHERE \(state = ANY \(ARRAY\['CHALLENGE'::.*'PENDING'/,
  );
  assert.match(
    indexes.rows.find(
      (row) =>
        row.indexname ===
        'uq_device_replacement_requests_active_key_fingerprint',
    ).indexdef,
    /WHERE \(state = ANY \(ARRAY\['CHALLENGE'::.*'PENDING'/,
  );

  await expectConstraintFailure(
    client,
    'a finite limit without explicit signed presence',
    `UPDATE "licensing"."license_versions"
        SET "device_limit" = 1, "device_limit_specified" = false
      WHERE "id" = '01K7VERSIONLEGACYV2000000'`,
  );
  await expectConstraintFailure(
    client,
    'a negative explicit device limit',
    `UPDATE "licensing"."license_versions"
        SET "device_limit" = -1, "device_limit_specified" = true
      WHERE "id" = '01K7VERSIONLEGACYV2000000'`,
  );

  await client.query('BEGIN');
  await client.query(
    `UPDATE "licensing"."license_versions"
        SET "device_limit" = NULL, "device_limit_specified" = true
      WHERE "id" = '01K7VERSIONLEGACYV2000000'`,
  );
  await client.query('ROLLBACK');
  await client.query('BEGIN');
  await client.query(
    `UPDATE "licensing"."license_versions"
        SET "device_limit" = 0, "device_limit_specified" = true
      WHERE "id" = '01K7VERSIONLEGACYV2000000'`,
  );
  await client.query('ROLLBACK');
}

async function rehearsal() {
  await createDatabase(REHEARSAL_DB);
  await withClient(REHEARSAL_DB, async (client) => {
    for (const sql of PREREQUISITE_MIGRATIONS) await client.query(sql);
    await seedFixture(client);
    log(`  seeded ${REHEARSAL_DB} with the L-02 fixture`);

    await client.query(MIGRATION_SQL);
    log('  applied 20261014000000_licensing_version_model_and_import');

    await client.query(CORRECTION_SQL);
    log('  applied 20261015000000_licensing_supersession_governs_until');

    await client.query(TRANSFER_AUDIT_SQL);
    log('  applied 20261016000000_licensing_customer_transfer_audit');

    await client.query(RECOVERY_AUDIT_SQL);
    log('  applied 20261017000000_license_audit_previous_license_id');

    await client.query(
      `INSERT INTO "licensing"."license_audit_events"
         ("id", "installation_id", "event_type", "outcome", "source", "detail", "occurred_at")
       VALUES ($1, '01K7INSTALLATIONAAAAAAAAAA', 'license.import.applied', 'APPLIED', 'file', $2, $3)`,
      [
        AUDIT_DETAIL_FIXTURE.id,
        AUDIT_DETAIL_FIXTURE.preserved,
        AUDIT_DETAIL_FIXTURE.occurredAt,
      ],
    );
    log('  seeded an existing audit event with a 500-character detail');

    await client.query(AUDIT_DETAIL_SQL);
    log('  applied 20261018000000_licensing_audit_detail_text');

    await assertPreservedState(client);
    log('  licensing version state assertions passed');
    await assertAuditDetailWidening(client);
    log(
      '  audit detail preservation and >500-character round-trip assertions passed',
    );
    await assertCustomerCodeMigration(client);
    log(
      '  applied 20261020000000_licensing_customer_code and verified customer_code constraints',
    );

    await client.query(TRANSFER_LICENSE_COMMENT_SQL);
    log('  applied 20261021000000_license_audit_previous_license_id_transfer');

    await seedPreDeviceEntitlementFixture(client);
    const preDeviceState = await snapshotPreDeviceState(client);
    log(
      '  seeded and snapshotted the populated schema immediately before OQ-83',
    );

    await client.query(CLIENT_DEVICE_LIFECYCLE_SQL);
    log('  applied 20261022000000_licensing_client_device_lifecycle');
    await assertClientDeviceMigration(client, preDeviceState);
    log(
      '  OQ-83 data preservation, UNSPECIFIED semantics, and schema assertions passed',
    );

    const preRenewalState = await snapshotRetainedWindows(client);
    await client.query(RENEWAL_GOVERNS_FROM_SQL);
    log('  applied 20261023000000_licensing_renewal_governs_from');
    await assertRenewalMigration(client, preRenewalState);
    log(
      '  OQ-88 governs_from / renewal-audit schema assertions and no-backfill proof passed',
    );

    await client.query(REVOCATIONS_SQL);
    log('  applied 20261024000000_licensing_revocations');

    const preDeveloperState = await snapshotPreDeveloperLicenses(client);
    await client.query(OFFICIAL_DEVELOPER_LICENSE_SQL);
    log('  applied 20261025000000_official_developer_license');
    await assertOfficialDeveloperLicenseMigration(client, preDeveloperState);
    log(
      '  Developer holder backfill, schema, exclusivity, and customer-free license assertions passed',
    );
  });
}

async function snapshotPreDeveloperLicenses(client) {
  const result = await client.query(
    `SELECT "id", "installation_id", "customer_id", "revoked_at",
            "revocation_id", "created_at", "updated_at", "created_by",
            "updated_by"
       FROM "licensing"."licenses" ORDER BY "id"`,
  );
  return result.rows.map((row) => ({
    ...row,
    revoked_at:
      row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  }));
}

async function assertOfficialDeveloperLicenseMigration(client, preState) {
  const enumValues = await client.query(
    `SELECT e.enumlabel
       FROM pg_type AS t
       JOIN pg_enum AS e ON e.enumtypid = t.oid
       JOIN pg_namespace AS n ON n.oid = t.typnamespace
      WHERE n.nspname = 'licensing' AND t.typname = 'LicenseType'
      ORDER BY e.enumsortorder`,
  );
  assert.deepEqual(
    enumValues.rows.map((row) => row.enumlabel),
    ['COMMERCIAL', 'DEVELOPER'],
    'license type is closed over commercial and Developer holders',
  );

  const columns = await client.query(
    `SELECT column_name, is_nullable, data_type, column_default
       FROM information_schema.columns
      WHERE table_schema = 'licensing' AND table_name = 'licenses'
        AND column_name IN ('license_type', 'developer_id', 'developer_name')
      ORDER BY column_name`,
  );
  assert.deepEqual(
    columns.rows.map((row) => [row.column_name, row.is_nullable]),
    [
      ['developer_id', 'YES'],
      ['developer_name', 'YES'],
      ['license_type', 'NO'],
    ],
    'the explicit holder columns have the intended nullability',
  );

  const holderConstraint = await client.query(
    `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint AS c
       JOIN pg_class AS t ON t.oid = c.conrelid
       JOIN pg_namespace AS n ON n.oid = t.relnamespace
      WHERE n.nspname = 'licensing' AND t.relname = 'licenses'
        AND c.conname = 'licenses_holder_type_check'`,
  );
  assert.equal(holderConstraint.rowCount, 1, 'holder exclusivity is enforced');

  const migrated = await client.query(
    `SELECT "id", "installation_id", "customer_id", "revoked_at",
            "revocation_id", "created_at", "updated_at", "created_by",
            "updated_by", "license_type", "developer_id", "developer_name"
       FROM "licensing"."licenses" ORDER BY "id"`,
  );
  assert.deepEqual(
    migrated.rows.map((row) => ({
      id: row.id,
      installation_id: row.installation_id,
      customer_id: row.customer_id,
      revoked_at:
        row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
      revocation_id: row.revocation_id,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
      created_by: row.created_by,
      updated_by: row.updated_by,
    })),
    preState,
    'all pre-existing license facts survive byte-for-byte',
  );
  assert.ok(
    migrated.rows.every(
      (row) =>
        row.license_type === 'COMMERCIAL' &&
        row.customer_id !== null &&
        row.developer_id === null &&
        row.developer_name === null,
    ),
    'every existing license is backfilled as an unchanged commercial holder',
  );

  const expectHolderRejection = async (values, expected) => {
    await client.query('BEGIN');
    let message = null;
    try {
      await client.query(
        `INSERT INTO "licensing"."licenses"
           ("id", "installation_id", "customer_id", "license_type",
            "developer_id", "developer_name")
         VALUES ($1, '01K7INSTALLATIONBBBBBBBBBB', $2, $3, $4, $5)`,
        values,
      );
    } catch (error) {
      message = error.message;
    }
    await client.query('ROLLBACK');
    assert.ok(
      message !== null && /holder_type/i.test(message),
      `${expected} must be rejected by holder exclusivity (got: ${String(message)})`,
    );
  };

  await expectHolderRejection(
    ['rehearsal-commercial-without-customer', null, 'COMMERCIAL', null, null],
    'commercial holder without a customer',
  );
  await expectHolderRejection(
    [
      'rehearsal-developer-with-customer',
      preState[0].customer_id,
      'DEVELOPER',
      'developer-rehearsal',
      'Developer Rehearsal',
    ],
    'Developer holder with a customer',
  );
  await expectHolderRejection(
    ['rehearsal-developer-without-id', null, 'DEVELOPER', null, null],
    'Developer holder without an identity',
  );

  const customersBefore = await client.query(
    `SELECT COUNT(*)::int AS count FROM "licensing"."customers"`,
  );
  await client.query(
    `INSERT INTO "licensing"."licenses"
       ("id", "installation_id", "customer_id", "license_type",
        "developer_id", "developer_name")
     VALUES ('01K7REHEARSALDEVELOPER001', '01K7INSTALLATIONBBBBBBBBBB', NULL,
             'DEVELOPER', 'developer-rehearsal', 'Developer Rehearsal')`,
  );
  const developer = await client.query(
    `SELECT "license_type", "customer_id", "developer_id", "developer_name"
       FROM "licensing"."licenses"
      WHERE "id" = '01K7REHEARSALDEVELOPER001'`,
  );
  assert.deepEqual(developer.rows[0], {
    license_type: 'DEVELOPER',
    customer_id: null,
    developer_id: 'developer-rehearsal',
    developer_name: 'Developer Rehearsal',
  });
  const customersAfter = await client.query(
    `SELECT COUNT(*)::int AS count FROM "licensing"."customers"`,
  );
  assert.equal(
    customersAfter.rows[0].count,
    customersBefore.rows[0].count,
    'storing a Developer license creates no commercial customer',
  );
}

/**
 * The retained windows of every version row, as text, so a later migration can
 * be proven not to have rewritten any of them.
 */
async function snapshotRetainedWindows(client) {
  const rows = await client.query(
    `SELECT "id", "valid_from", "valid_until", "governs_until",
            "superseded_at", "supersedes_version_id"
       FROM "licensing"."license_versions" ORDER BY "id"`,
  );
  return rows.rows.map((row) => ({
    id: row.id,
    validFrom: new Date(row.valid_from).toISOString(),
    validUntil:
      row.valid_until === null ? null : new Date(row.valid_until).toISOString(),
    governsUntil:
      row.governs_until === null
        ? null
        : new Date(row.governs_until).toISOString(),
    supersededAt:
      row.superseded_at === null
        ? null
        : new Date(row.superseded_at).toISOString(),
    supersedesVersionId: row.supersedes_version_id ?? null,
  }));
}

/**
 * OD-LIC-06 / OQ-88 — `license_versions.governs_from` and the typed renewal audit
 * columns. The assertions are deliberately about the NEGATIVE space: the
 * migration must add a nullable column and a local check, backfill nothing, and
 * leave every existing window byte-identical (ADR-0046 Decision 2).
 */
async function assertRenewalMigration(client, preState) {
  const columns = await client.query(
    `SELECT column_name, data_type, is_nullable, datetime_precision
       FROM information_schema.columns
      WHERE table_schema = 'licensing' AND table_name = 'license_versions'
        AND column_name = 'governs_from'`,
  );
  assert.equal(columns.rowCount, 1, 'governs_from exists');
  assert.equal(columns.rows[0].data_type, 'timestamp with time zone');
  assert.equal(columns.rows[0].datetime_precision, 6);
  assert.equal(columns.rows[0].is_nullable, 'YES');

  const constraint = await client.query(
    `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint AS c
       JOIN pg_class AS t ON t.oid = c.conrelid
       JOIN pg_namespace AS n ON n.oid = t.relnamespace
      WHERE n.nspname = 'licensing' AND t.relname = 'license_versions'
        AND c.conname = 'license_versions_governs_from_check'`,
  );
  assert.equal(constraint.rowCount, 1, 'the governs_from check exists');

  // No backfill: every row that existed before the migration is still NULL, and
  // every retained window reads exactly as it did before.
  const nulls = await client.query(
    `SELECT COUNT(*)::int AS count FROM "licensing"."license_versions"
      WHERE "governs_from" IS NOT NULL`,
  );
  assert.equal(nulls.rows[0].count, 0, 'the migration backfills nothing');
  assert.deepEqual(
    await snapshotRetainedWindows(client),
    preState,
    'no retained window changed',
  );

  // `supersedes_version_id` is a real foreign key to a retained version, so the
  // constraint probes below reference a row this database actually holds. The
  // repair-path fixture that defines REHEARSAL_SUCCESSOR lives in its own
  // database and must not be borrowed here.
  const retained = await client.query(
    `SELECT "id" FROM "licensing"."license_versions" ORDER BY "id" LIMIT 1`,
  );
  assert.equal(
    retained.rowCount,
    1,
    'a retained version exists to be named by the renewal',
  );
  const renewalTargetId = retained.rows[0].id;

  // The check is local and strict: a deferred start needs a recorded
  // supersession and must precede the signed end.
  await client.query('BEGIN');
  let message = null;
  try {
    await client.query(
      `INSERT INTO "licensing"."license_versions"
         ("id", "license_id", "installation_id", "operation_id", "status",
          "provider", "document_version", "document_hash", "source",
          "valid_from", "governs_from", "valid_until", "imported_at",
          "created_at", "updated_at")
       VALUES ('01K7REHEARSALRENEWAL00000', '01K7LICENSECURRENT0000000',
               '01K7INSTALLATIONAAAAAAAAAA', '01K7REHEARSALRENEWALOP000',
               'ACTIVE', 'persistent', 2, 'rehearsal-renewal-without-target',
               'file', '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z',
               '2028-01-01T00:00:00Z', '2026-10-01T00:00:00Z',
               '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
    );
  } catch (error) {
    message = error.message;
  }
  await client.query('ROLLBACK');
  assert.ok(
    message !== null && /governs_from/i.test(message),
    `a deferred start without a supersession link must be refused (got: ${String(message)})`,
  );

  await client.query('BEGIN');
  message = null;
  try {
    await client.query(
      `INSERT INTO "licensing"."license_versions"
         ("id", "license_id", "installation_id", "operation_id", "status",
          "provider", "document_version", "document_hash", "source",
          "valid_from", "governs_from", "valid_until", "supersedes_version_id",
          "imported_at", "created_at", "updated_at")
       VALUES ('01K7REHEARSALRENEWAL00001', '01K7LICENSECURRENT0000000',
               '01K7INSTALLATIONAAAAAAAAAA', '01K7REHEARSALRENEWALOP001',
               'ACTIVE', 'persistent', 2, 'rehearsal-renewal-past-end',
               'file', '2026-10-01T00:00:00Z', '2028-01-01T00:00:00Z',
               '2028-01-01T00:00:00Z', $1,
               '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z',
               '2026-10-01T00:00:00Z')`,
      [renewalTargetId],
    );
  } catch (error) {
    message = error.message;
  }
  await client.query('ROLLBACK');
  assert.ok(
    message !== null && /governs_from/i.test(message),
    `a deferred start at or after the signed end must be refused (got: ${String(message)})`,
  );

  // The valid shape is accepted, and the audit columns carry the typed facts.
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO "licensing"."license_versions"
       ("id", "license_id", "installation_id", "operation_id", "status",
        "provider", "document_version", "document_hash", "source",
        "valid_from", "governs_from", "valid_until", "supersedes_version_id",
        "imported_at", "created_at", "updated_at")
     VALUES ('01K7REHEARSALRENEWAL00002', '01K7LICENSECURRENT0000000',
             '01K7INSTALLATIONAAAAAAAAAA', '01K7REHEARSALRENEWALOP002',
             'ACTIVE', 'persistent', 2, 'rehearsal-renewal-valid',
             'file', '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z',
             '2028-01-01T00:00:00Z', $1,
             '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z',
             '2026-10-01T00:00:00Z')`,
    [renewalTargetId],
  );
  await client.query(
    `INSERT INTO "licensing"."license_audit_events"
       ("id", "installation_id", "event_type", "outcome", "source",
        "renewed_version_id", "renewed_from", "renewed_until", "occurred_at")
     VALUES ('rehearsal-renewal-event', '01K7INSTALLATIONAAAAAAAAAA',
             'license.import.renewed', 'APPLIED', 'file', $1,
             '2027-01-01T00:00:00Z', '2028-01-01T00:00:00Z',
             '2026-10-01T00:00:00Z')`,
    [renewalTargetId],
  );
  const stored = await client.query(
    `SELECT "governs_from" FROM "licensing"."license_versions"
      WHERE "id" = '01K7REHEARSALRENEWAL00002'`,
  );
  assert.equal(
    new Date(stored.rows[0].governs_from).toISOString(),
    '2027-01-01T00:00:00.000Z',
    'a valid deferred start is stored exactly',
  );
  const auditColumns = await client.query(
    `SELECT column_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'licensing' AND table_name = 'license_audit_events'
        AND column_name IN ('renewed_version_id', 'renewed_from', 'renewed_until')
      ORDER BY column_name`,
  );
  assert.deepEqual(
    auditColumns.rows.map((row) => [row.column_name, row.is_nullable]),
    [
      ['renewed_from', 'YES'],
      ['renewed_until', 'YES'],
      ['renewed_version_id', 'YES'],
    ],
  );
  await client.query('ROLLBACK');

  // Nothing was left behind by the exercises.
  assert.deepEqual(
    await snapshotRetainedWindows(client),
    preState,
    'the constraint exercises wrote nothing',
  );
}

/**
 * The repair path of the correction, on a database that carries the defect it
 * fixes: a license that the pre-correction behaviour retired the moment a
 * future-dated successor was imported, even though the successor only starts a
 * year later. After the correction the row hands over at the successor's start
 * and is still the version that governs today.
 */
async function prematureRetirementRehearsal() {
  await createDatabase(REPAIR_DB);
  await withClient(REPAIR_DB, async (client) => {
    for (const sql of PREREQUISITE_MIGRATIONS) await client.query(sql);
    await seedFixture(client);
    await client.query(MIGRATION_SQL);

    // The L-03-era successor, then the premature stamp the old behaviour wrote.
    await client.query(
      `INSERT INTO "licensing"."license_versions"
         ("id", "license_id", "installation_id", "operation_id", "status",
          "provider", "document_version", "document_hash", "source",
          "valid_from", "valid_until", "imported_at", "superseded_at",
          "created_at", "updated_at")
       VALUES ($1, '01K7LICENSECURRENT0000000', '01K7INSTALLATIONAAAAAAAAAA',
               $2, 'ACTIVE', 'persistent', 2, $3, 'file', $4, $5, $6, NULL,
               $6, $6)`,
      [
        REHEARSAL_SUCCESSOR.id,
        REHEARSAL_SUCCESSOR.operationId,
        REHEARSAL_SUCCESSOR.documentHash,
        REHEARSAL_SUCCESSOR.validFrom,
        REHEARSAL_SUCCESSOR.validUntil,
        REHEARSAL_SUCCESSOR.recordedAt,
      ],
    );
    await client.query(
      `UPDATE "licensing"."license_versions"
          SET "superseded_at" = $1, "superseded_by_version_id" = $2
        WHERE "id" = '01K7LICENSECURRENT0000000'`,
      [REHEARSAL_SUCCESSOR.recordedAt, REHEARSAL_SUCCESSOR.id],
    );
    await client.query(CORRECTION_SQL);

    const rows = await client.query(
      `SELECT "id", "superseded_at", "governs_until"
         FROM "licensing"."license_versions" ORDER BY "id"`,
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    const repaired = byId.get('01K7LICENSECURRENT0000000');
    const successor = byId.get(REHEARSAL_SUCCESSOR.id);
    assert.equal(
      new Date(repaired.governs_until).toISOString(),
      new Date(REHEARSAL_SUCCESSOR.validFrom).toISOString(),
      'the premature retirement is repaired to the successor start',
    );
    assert.equal(
      new Date(repaired.superseded_at).toISOString(),
      new Date(REHEARSAL_SUCCESSOR.recordedAt).toISOString(),
      'the recorded-at fact is preserved unchanged',
    );
    assert.notEqual(
      repaired.governs_until,
      repaired.superseded_at,
      'recorded-at and governs-until are separate facts',
    );
    assert.equal(successor.governs_until, null);
    assert.equal(successor.superseded_at, null);

    // The point of the repair: at the recorded instant the repaired version is
    // still the ONE version that governs, instead of none. "Governs at an
    // instant" is coverage AND not-yet-retired — the same rule the domain
    // resolution applies.
    const governing = await client.query(
      `SELECT "id" FROM "licensing"."license_versions"
        WHERE "valid_from" <= $1
          AND ("valid_until" IS NULL OR "valid_until" > $1)
          AND ("governs_until" IS NULL OR "governs_until" > $1)`,
      [REHEARSAL_SUCCESSOR.recordedAt],
    );
    assert.deepEqual(
      governing.rows.map((row) => row.id),
      ['01K7LICENSECURRENT0000000'],
      'exactly the repaired version governs at the recorded instant',
    );

    const overlappingWindows = await client.query(
      `SELECT COUNT(*)::int AS count
         FROM "licensing"."license_versions" AS a
         JOIN "licensing"."license_versions" AS b
           ON b."installation_id" = a."installation_id" AND b."id" > a."id"
        WHERE tstzrange(
                a."valid_from",
                LEAST(COALESCE(a."valid_until", 'infinity'::timestamptz),
                      COALESCE(a."governs_until", 'infinity'::timestamptz)),
                '[)'
              )
           && tstzrange(
                b."valid_from",
                LEAST(COALESCE(b."valid_until", 'infinity'::timestamptz),
                      COALESCE(b."governs_until", 'infinity'::timestamptz)),
                '[)'
              )`,
    );
    assert.equal(
      overlappingWindows.rows[0].count,
      0,
      'the repaired data satisfies the disjoint-window invariant',
    );
  });
}

async function duplicateHashRehearsal() {
  await createDatabase(DUPLICATE_DB);
  await withClient(DUPLICATE_DB, async (client) => {
    for (const sql of PREREQUISITE_MIGRATIONS) await client.query(sql);
    await seedUnrepresentableFixture(client);

    let message = null;
    try {
      await client.query('BEGIN');
      await client.query(MIGRATION_SQL);
    } catch (error) {
      message = error.message;
    } finally {
      await client.query('ROLLBACK');
    }
    assert.ok(
      message !== null && /duplicate artifact hash/i.test(message),
      `the migration must refuse unrepresentable data with a clear message (got: ${String(message)})`,
    );
    // The refusal wrote nothing: the L-02 shape is intact after rollback.
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'licensing' AND table_name = 'licenses'
          AND column_name = 'code_hash'`,
    );
    assert.equal(
      columns.rowCount,
      1,
      'the refused migration leaves L-02 intact',
    );
  });
}

try {
  await rehearsal();
  await prematureRetirementRehearsal();
  await duplicateHashRehearsal();
  log('Migration rehearsal passed.');
} catch (error) {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  const annotation = detail
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  log(`::error title=Licensing migration rehearsal::${annotation}`);
  throw error;
} finally {
  if (KEEP) {
    log(`KEEP=1: retained ${REHEARSAL_DB}, ${REPAIR_DB} and ${DUPLICATE_DB}`);
  } else {
    await dropDatabase(REHEARSAL_DB).catch((error) =>
      log(`  cleanup warning: ${error.message}`),
    );
    await dropDatabase(DUPLICATE_DB).catch((error) =>
      log(`  cleanup warning: ${error.message}`),
    );
    await dropDatabase(REPAIR_DB).catch((error) =>
      log(`  cleanup warning: ${error.message}`),
    );
  }
}
