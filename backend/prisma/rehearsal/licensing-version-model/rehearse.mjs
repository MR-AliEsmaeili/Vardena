#!/usr/bin/env node
/**
 * Targeted rehearsal for the licensing version/import migration, its
 * supersession correction, and the later licensing audit-detail widening.
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
import { randomBytes } from 'node:crypto';
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
  });
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
