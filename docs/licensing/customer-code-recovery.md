# L-06 customer-code backfill and failed-migration recovery

This runbook covers `20261020000000_licensing_customer_code` when a populated
installation predates independent business customer codes. It preserves the
PDR-14 identity rules, existing signed artifacts, customer relationships, and
Prisma migration history. It does **not** generate a code or reissue a license.

## 1. Root cause and why a later migration alone is insufficient

The original migration performs these operations in one Prisma migration
transaction:

1. add nullable `licensing.customers.customer_code`;
2. reject missing, blank, malformed, duplicate, or `customer_code = id` values;
3. enforce `NOT NULL`, `customers_customer_code_check`, and
   `uq_customers_customer_code`;
4. add the L-06 transfer-audit columns and pair check.

On a populated pre-L-06 database without codes, step 2 raises an exception.
PostgreSQL rolls back the whole transaction, including step 1. Prisma records
the migration as failed. The next `prisma migrate deploy` stops at the failed
history (P3009); it does not skip that entry and run a newly added later
migration. Consequently, adding another migration cannot by itself repair this
state, and splitting the old file now would not help an installation where its
checksum is already recorded.

The original migration and Prisma schema are therefore **unchanged** by this
recovery design. Installations where the original migration already succeeded
keep their existing checksum and history. Fresh installations still enforce
the constraints immediately because they have no legacy customer rows.

## 2. Owner decision for the local development customer

**PRODUCT OWNER DECISION (2026-10-23):**

For the persisted customer identified in this installation:

- **Customer ID:** `01M41HY2B6WCY41SW8JG8Q6XVX`
- **Display Name:** `Vardena Local Development`
- **Approved Customer Code:** `VARDENA-LOCAL-001`

> **Important:** This decision applies **only** to the above customer ID. It is
> **not** a general license to assign arbitrary codes to other customers. Every
> other customer without a code still requires an explicit owner-approved
> mapping. Do not derive, generate, or fabricate codes for other persisted rows.

### Why this decision is required

Repository and merged PR #150 evidence establishes the following:

- No migration, seed, or administrator bootstrap inserts customer
  `01M41HY2B6WCY41SW8JG8Q6XVX` or the name `Vardena Local Development`.
- Before L-06, the application customer writer was the signed-license import
  `upsert`; after L-06 it is create-if-absent with explicit `customerId` and
  `customerCode`. A historical import is a possible origin, but source code
  cannot prove which artifact or operator created this particular row.
- `LocalDevelopmentLicenseProvider` has no persistence dependency. It returns
  the deliberately synthetic pair `01JLOCALCUSTOMER0000000000` /
  `CUST-LOCAL-DEV` and a different synthetic installation ID. PR #150 added its
  code only to that provider contract. It neither reads nor writes the
  persisted installation/customer identity.

**Critical distinction:** `CUST-LOCAL-DEV` is **exclusively** associated with the
synthetic customer `01JLOCALCUSTOMER0000000000` in the
`LocalDevelopmentLicenseProvider`. It must **not** be assigned to the persisted
customer `01M41HY2B6WCY41SW8JG8Q6XVX` or any other persisted customer row.

Therefore, a separate, explicit business code is required for the persisted
customer. The Product Owner has approved `VARDENA-LOCAL-001` for this specific
customer ID.

## 3. State compatibility and required action

Run the read-only status command from `backend` with `DATABASE_URL` configured:

```powershell
npm run licensing:customer-code-recovery
```

It prints the migration state, customer count, IDs still requiring owner input,
and enforcement shape. It never prints or changes signed license material.

| Database state | Required action |
| --- | --- |
| No Prisma schema yet / no customers | Run normal `prisma migrate deploy`; no recovery utility is needed. |
| Original migration pending or truthfully rolled back; populated customers | Run the utility with `--apply` and the complete mapping, then normal `prisma migrate deploy`. |
| Original migration recorded as failed | Run the utility with `--apply --recover-failed` and the complete mapping, then normal `prisma migrate deploy`. |
| Original migration already applied and constraints present | No action. The utility validates and returns `already-applied` without changing data or the ledger. |
| Checksum mismatch, ambiguous history, applied ledger row with missing invariants, or nonblank conflicting existing code | Stop for investigation. The utility refuses to guess, overwrite identity evidence, or alter the ledger to bypass the problem. |

### Safety prerequisites

1. Take and verify a current backup using
   [the backup/restore runbook](../operations/backup-and-restore.md).
2. Use the normal maintenance window and stop application writes. The utility
   uses an advisory lock, table locks, and a 10-second DDL lock timeout, but
   those are not substitutes for change control.
3. Use a migration-capable database role through `DATABASE_URL`. Do not put a
   password in command arguments or in the mapping file.
4. Obtain an exact owner code for **every** reported customer ID. Each code must match
   `^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$`, differ from its `customerId`, and be
   unique across customers.

## 4. Mapping format

The JSON file is an array with exactly two fields per entry:

```json
[
  {
    "customerId": "01M41HY2B6WCY41SW8JG8Q6XVX",
    "customerCode": "VARDENA-LOCAL-001"
  }
]
```

### Complete example for local development installation

For a local development installation with the known customer, use this
owner-approved mapping:

```json
[
  {
    "customerId": "01M41HY2B6WCY41SW8JG8Q6XVX",
    "customerCode": "VARDENA-LOCAL-001"
  }
]
```

**Important:** The example above uses the **explicitly owner-approved** code for
the specific customer ID. The utility:

- rejects malformed JSON, unknown fields, malformed/duplicate/ID-equal codes,
  duplicate IDs, unknown customer IDs, and missing assignments;
- fills only `NULL` or blank codes using the exact ID/code pairs;
- never derives or generates a code;
- never overwrites a nonblank existing code, even if the mapping differs;
- updates no display name, timestamp, installation, license, version,
  entitlement, audit event, authorization record, or signed artifact.

If the status command reports **additional customer IDs** without codes, you
**must** obtain explicit owner-approved codes for each of them and add
corresponding entries to the mapping array. Do not proceed with incomplete
mappings.

Keep the approved mapping and command output with the change record according
to the installation's retention policy. They are the backfill audit evidence.

## 5. Pending populated database: committed expansion, then backfill, then Prisma

From `backend`, after the prerequisites:

```powershell
npm run licensing:customer-code-recovery -- --mapping $MappingPath --apply
npx prisma migrate deploy
```

The first command has two deliberately separate transactions:

1. **Expansion:** commit the original `ADD COLUMN IF NOT EXISTS` statement,
   leaving the column nullable and leaving the original Prisma migration
   pending.
2. **Controlled backfill:** lock the customer table, re-read all rows, validate
   the complete final mapping, apply only explicit missing-code updates,
   re-read and validate the result, then commit.

If owner input is incomplete, the additive expansion can remain committed while
no customer code is changed. Complete the mapping and rerun the same command;
it is idempotent. Constraint enforcement remains the job of the unchanged
original migration during the subsequent normal Prisma deploy. Prisma still
re-validates every row, so the utility is not a validation bypass.

This two-phase path avoids creating an expansion migration that Prisma would
immediately follow with a failing enforcement migration in the same deploy.

## 6. Recorded failed migration: atomic perform-and-complete recovery

Use the same command with the explicit failed-history flag:

```powershell
npm run licensing:customer-code-recovery -- --mapping $MappingPath --apply --recover-failed
npx prisma migrate deploy
```

For the recorded-failed state, a separate committed expansion would leave the
P3009 ledger gate untouched. Instead, the utility performs **one** transaction:

1. lock and re-read the existing failed ledger row;
2. require its checksum to equal the unchanged migration SQL;
3. expand and apply the exact owner mapping;
4. execute the complete original migration, including all validation and
   constraints;
5. re-read the customers and verify `NOT NULL`, validated `CHECK`, and the
   unique index;
6. update only that same ledger row's `finished_at` and `applied_steps_count`;
7. commit.

The original failure `logs`, `started_at`, `id`, and `checksum` are retained.
There is no ledger-only mode, no `migrate resolve`, no inserted substitute
migration, and no rolled-back/applied marker used to skip validation. Any error
before commit rolls back the DDL, backfill, constraints, and ledger completion
together. An interruption after commit needs no special handling: rerun the
command and it validates the applied state without another write.

The second command is still required. It proves Prisma accepts the completed
history and applies every later pending migration before application startup.

## 7. Exact local PowerShell resume for the reported P3009 state

Run these commands from the repository root after obtaining the owner decision.
They retain the Compose PostgreSQL volume and all licensing data. They do not
run `down`, reset Prisma, recreate the administrator, or reissue a license.

```powershell
# Keep PostgreSQL and its existing volume; stop only application writers.
docker compose up -d postgres
docker compose stop api worker
docker compose build migrate

# For the local development installation, use the owner-approved mapping.
# If status reports additional customers without codes, STOP and add their
# owner-approved mappings to this array before proceeding.
$Mapping = @(
  @{ customerId = '01M41HY2B6WCY41SW8JG8Q6XVX'; customerCode = 'VARDENA-LOCAL-001' }
)
$MappingPath = Join-Path $env:TEMP 'vardena-l06-customer-code-map.json'
$Mapping | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $MappingPath -Encoding utf8

# Read-only inspection. If this lists additional customer IDs, stop and add an
# explicit owner-approved mapping object for each one before continuing.
docker compose run --rm --no-deps migrate npm run licensing:customer-code-recovery

# Perform and verify the real failed migration, then complete its ledger row
# atomically. Docker Desktop mounts the mapping read-only in the one-shot task.
docker compose run --rm --no-deps `
  --volume "${MappingPath}:/run/vardena-l06-customer-code-map.json:ro" `
  migrate npm run licensing:customer-code-recovery -- `
    --mapping /run/vardena-l06-customer-code-map.json --apply --recover-failed

# Normal startup: Prisma continues later migrations, then the existing
# idempotent bootstrap runs, then API/worker start. No volume is recreated.
docker compose up --build -d

# Read-only final inspection: state should be applied and all three enforcement
# fields should be true, with the same customer count as before recovery.
docker compose run --rm --no-deps migrate npm run licensing:customer-code-recovery
```

If status reports `pending` or `rolled-back` rather than `failed`, use the same
mounted command **without** `--recover-failed`, then run `docker compose up
--build -d`. Do not add the failed-history flag merely to force a path.

## 8. Verification and prohibited shortcuts

The disposable rehearsal
`backend/prisma/rehearsal/licensing-customer-code-recovery/rehearse.mjs` uses the
real Prisma CLI and covers:

- fresh deploy and already-applied compatibility;
- populated expansion/backfill/enforcement and idempotent preparation;
- missing, malformed, duplicate, and ID-equal input rejection;
- the original failure's DDL rollback and the subsequent failed-history gate;
- interruption after migration execution but before ledger completion, full
  rollback, and successful retry;
- continuation of later migrations and preservation of the original failure
  log;
- field-by-field preservation of existing customers, installations, licenses,
  retained versions, entitlements, and audit events;
- database rejection of missing, blank, malformed, overlong, duplicate, and
  ID-equal final codes.

Run it from `backend` against a disposable local PostgreSQL maintenance URL:

```powershell
npm run test:licensing-customer-code-rehearsal
```

Do not point the rehearsal at a real installation. It creates uniquely named
local databases and refuses non-local database hosts.

### Preservation guarantees

The recovery utility and migration preserve the following by design:

- **All customer records** (no deletions, no overwrites of existing non-blank codes)
- **All installation records** and their customer bindings
- **All license records** and their customer/installation bindings
- **All license version records** with their complete history
- **All entitlement records**
- **All audit event records**
- **All signed artifact hashes** (never stored, only their SHA-256 digests)
- **Migration ledger history** (original failure logs preserved)
- **Database constraints** (NOT NULL, CHECK, UNIQUE all enforced)

### Prohibited actions

The following are **not** recovery procedures and will corrupt data:

- `prisma migrate reset`
- `prisma db push`
- deleting/recreating the PostgreSQL volume
- deleting a customer
- fabricating or deriving codes
- editing a signed artifact
- reissuing a license
- recreating the system administrator
- manually changing production records outside this controlled change
- marking the failed migration applied/rolled back without performing and
  verifying its real work
- using `CUST-LOCAL-DEV` for any persisted customer (it belongs exclusively to
  the synthetic provider customer `01JLOCALCUSTOMER0000000000`)

## 9. Customer creation and prevention of recurrence

### Current state (L-06 enforced)

After the L-06 migration is successfully applied, the following invariants hold:

1. **Database level:** The `licensing.customers.customer_code` column is `NOT NULL`
   with a `CHECK` constraint ensuring valid format and uniqueness.

2. **Application level:** All customer creation paths require explicit
   `customerId`, `customerCode`, and `displayName`:
   - `LicensesRepository.createCustomer()` validates all three fields
   - `LicensesRepository.importVersion()` creates customers with explicit codes
   - Domain validation (`domain/customer.ts`) rejects invalid codes

3. **No implicit creation:** There is no path that creates a customer without
   an explicit, validated `customerCode`.

### How the problem occurred

Before L-06, the `licensing.customers` table did not have a `customer_code`
column. Customers were created through the license import path which used `upsert`
and only set `id` and `display_name`. When L-06 added the `customer_code` column
with `NOT NULL` constraint in a single transaction, any existing customer without
a code caused the entire migration to fail and roll back.

### Prevention for the future

The L-06 migration remains unchanged. The recovery utility provides the
controlled backfill path. To prevent recurrence:

1. **Never** add a `NOT NULL` column to a populated table without a backfill
   strategy in the same transaction.
2. **Always** use the recovery utility for databases that failed the original
   migration.
3. **Always** provide complete owner-approved mappings for all customers without
   codes.
4. The application code already enforces that new customers always have valid
   codes, so this problem cannot occur for new installations or new customers.

## 10. General policy for historical customers without codes

### For customers with no valid code

1. **First**, check if the customer has a legacy stable identifier that can be
   mapped to a business code through authoritative records.

2. **If a legacy code exists** and is validated against product contracts:
   - Create a deterministic, auditable mapping
   - Document the evidence and approval
   - Include in the recovery mapping

3. **If no legacy code exists**:
   - **STOP** — Do not generate, derive, or fabricate a code
   - Obtain explicit owner-approved business code
   - Document the decision
   - Include in the recovery mapping

4. **Never** use `display_name` as a basis for generating a code.

5. **Never** assign `CUST-LOCAL-DEV` to any persisted customer — it is
   exclusively reserved for the synthetic provider customer
   `01JLOCALCUSTOMER0000000000`.

### Current known mapping

| Customer ID | Display Name | Approved Customer Code | Status |
|-------------|--------------|----------------------|--------|
| `01M41HY2B6WCY41SW8JG8Q6XVX` | Vardena Local Development | `VARDENA-LOCAL-001` | ✅ Owner-approved |
| `01JLOCALCUSTOMER0000000000` | (synthetic) | `CUST-LOCAL-DEV` | ⚠️ Synthetic only, not persisted |

**Note:** If your installation has additional customers without codes, you
**must** add them to your mapping file with their explicit owner-approved codes.
Do not proceed with recovery until all customers have approved codes.
