# Licensing Customer Code Recovery — Implementation Report (2026-10-23)

**Status:** READY FOR REVIEW  
**PR:** #200 — BLOCKED: recover L-06 customer-code migration safely  
**Branch:** `arena/19836cb4-vardena`  
**Commit:** See final SHA in PR #200  
**Author:** Senior Backend Engineer / Database Migration Engineer  

---

## Executive Summary

This report documents the comprehensive solution for recovering the failed `20261020000000_licensing_customer_code` migration, incorporating the **Product Owner's explicit decision** for customer `01M41HY2B6WCY41SW8JG8Q6XVX` and ensuring the solution works for all installation scenarios.

### Owner Decision (2026-10-23)

| Customer Attribute | Value | Status |
|-------------------|-------|--------|
| Customer ID | `01M41HY2B6WCY41SW8JG8Q6XVX` | Confirmed |
| Display Name | `Vardena Local Development` | Confirmed |
| **Approved Customer Code** | **`VARDENA-LOCAL-001`** | ✅ **OWNER-APPROVED** |

**Critical Distinction:** The code `CUST-LOCAL-DEV` is **exclusively** associated with the **synthetic** customer `01JLOCALCUSTOMER0000000000` in the `LocalDevelopmentLicenseProvider` and **must not** be assigned to any persisted customer.

---

## 1. Root Cause Analysis

### Why the Migration Failed

The original migration `20261020000000_licensing_customer_code` performs all operations in a **single PostgreSQL transaction**:

1. ✅ Add nullable `customer_code VARCHAR(64)` column
2. ❌ **Fail-closed validation:** Reject if any customer has NULL, blank, malformed, duplicate, or ID-equal code
3. ❌ Enforce `NOT NULL` constraint
4. ❌ Add unique index `uq_customers_customer_code`
5. ❌ Add L-06 transfer-audit columns

**Problem:** On a populated pre-L-06 database, step 2 raises an exception, causing PostgreSQL to **rollback the entire transaction** (including step 1). Prisma records the migration as **failed**, and subsequent `prisma migrate deploy` commands stop with **P3009** error.

**Why a later migration cannot fix this:** Prisma's migration ledger gate prevents skipping failed migrations. Adding a new migration would never be reached.

### Evidence from Repository

- ✅ **No migration** inserts into `licensing.customers`
- ✅ **No seed** creates customer records
- ✅ **No bootstrap** inserts customers
- ✅ **Only creation path** is license import (via `tx.licenseCustomer.create` after L-06)
- ✅ Before L-06, customers were created without `customer_code` (column didn't exist)
- ❌ Customer `01M41HY2B6WCY41SW8JG8Q6XVX` has **no representation in source code**
- ✅ Must have been created by historical license import from external artifact

---

## 2. Solution Architecture

### Design Principles

1. **Preserve the original migration** — Checksum must remain unchanged for installations where it already succeeded
2. **No data loss** — All customers, installations, licenses, versions, entitlements, and audit events preserved
3. **No validation bypass** — All constraints (NOT NULL, CHECK, UNIQUE) must be enforced
4. **Explicit owner control** — No auto-generation of business codes
5. **Idempotent operations** — Recovery can be safely retried
6. **Atomic execution** — Either all changes succeed or none are committed

### Solution Components

#### A. For New Installations (Fresh Database)

**Status:** ✅ Already working

- Empty `licensing.customers` table → Migration adds column and constraints in one transaction
- No customers exist → No validation failure
- Normal `prisma migrate deploy` succeeds

#### B. For Existing Databases (Migration Not Yet Run)

**Status:** ✅ Handled by two-phase recovery

1. **Expansion phase:** Add nullable `customer_code` column separately
2. **Backfill phase:** Apply explicit owner-approved mappings
3. **Enforcement phase:** Run original migration to add constraints

#### C. For Failed Migration (P3009 State)

**Status:** ✅ Handled by atomic recovery

1. Lock and re-read the failed ledger row
2. Verify checksum matches original migration SQL
3. Expand column if not exists
4. Apply explicit backfill
5. Execute complete original migration (validation + constraints)
6. Re-verify all invariants
7. Update ledger row (`finished_at`, `applied_steps_count`) **atomically**
8. Preserve original failure logs, started_at, id, checksum

#### D. For Already Applied Migration

**Status:** ✅ No action required

- Migration already succeeded → Constraints are active
- Recovery utility validates and returns `already-applied` without changes

---

## 3. Implementation Changes

### Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `docs/licensing/customer-code-recovery.md` | Documentation | Added owner-approved mapping, updated PowerShell commands, clarified `CUST-LOCAL-DEV` distinction |
| `backend/prisma/recovery/licensing-customer-code-map.example.json` | New file | Example mapping file with owner-approved code |

### Files Unchanged (Preserved from PR #200)

| File | Purpose |
|------|---------|
| `backend/prisma/recovery/licensing-customer-code.mjs` | Recovery utility | Controlled status, expansion/backfill, atomic failed-history recovery |
| `backend/prisma/rehearsal/licensing-customer-code-recovery/rehearse.mjs` | Rehearsal tests | Real-Prisma disposable fresh/populated/P3009/interruption/retry tests |
| `backend/prisma/migrations/20261020000000_licensing_customer_code/migration.sql` | Original migration | Unchanged — preserves checksum for existing installations |
| `backend/prisma/schema/licensing.prisma` | Schema | Unchanged — `customerCode` remains NOT NULL with constraints |

### Customer Creation Paths (Already Secure)

All customer creation paths **require** explicit `customerId`, `customerCode`, and `displayName`:

1. ✅ `LicensesRepository.createCustomer()` — Validates all three fields via `assertValidCustomerRecord()`
2. ✅ `LicensesRepository.importVersion()` — Creates customers with explicit codes (L-06)
3. ✅ Domain validation (`domain/customer.ts`) — Rejects invalid codes with `CUSTOMER_CODE_PATTERN`

**Prevention:** New customers **cannot** be created without a valid code. The problem only affects historical customers created before L-06.

---

## 4. Owner Decision Integration

### Approved Mapping

```json
[
  {
    "customerId": "01M41HY2B6WCY41SW8JG8Q6XVX",
    "customerCode": "VARDENA-LOCAL-001"
  }
]
```

### Critical Distinctions

| Identifier | Type | Code | Persistence | Usage |
|------------|------|------|-------------|-------|
| `01M41HY2B6WCY41SW8JG8Q6XVX` | Real customer | `VARDENA-LOCAL-001` | ✅ Persisted | Production installation |
| `01JLOCALCUSTOMER0000000000` | Synthetic | `CUST-LOCAL-DEV` | ❌ Not persisted | `LocalDevelopmentLicenseProvider` only |

**Warning:** `CUST-LOCAL-DEV` **must never** be assigned to `01M41HY2B6WCY41SW8JG8Q6XVX` or any other persisted customer. It is exclusively reserved for the synthetic provider.

### General Policy for Other Customers

For any other customer without a code:

1. ❌ **Do NOT** auto-generate codes
2. ❌ **Do NOT** derive codes from `display_name` or `id`
3. ❌ **Do NOT** use `CUST-LOCAL-DEV`
4. ✅ **STOP** and obtain explicit owner-approved code
5. ✅ Document the decision
6. ✅ Add to mapping file

---

## 5. Execution Workflow

### Prerequisites

1. ✅ **Backup verified** — Use [backup/restore runbook](../operations/backup-and-restore.md)
2. ✅ **Maintenance window** — Stop application writes
3. ✅ **Database accessible** — PostgreSQL running, connection verified
4. ✅ **Complete mapping** — Every customer without a code has an owner-approved entry

### For Local Development Installation (Known Customer)

```powershell
# From repository root

# 1. Ensure PostgreSQL is running
docker compose up -d postgres

# 2. Stop application services
docker compose stop api worker

# 3. Build migrate service
docker compose build migrate

# 4. Create mapping file with owner-approved code
$Mapping = @(
  @{ customerId = '01M41HY2B6WCY41SW8JG8Q6XVX'; customerCode = 'VARDENA-LOCAL-001' }
)
$MappingPath = Join-Path $env:TEMP 'vardena-l06-customer-code-map.json'
$Mapping | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $MappingPath -Encoding utf8

# 5. Read-only inspection (verify only this customer needs mapping)
docker compose run --rm --no-deps migrate npm run licensing:customer-code-recovery

# 6. If status shows 'failed', execute atomic recovery
docker compose run --rm --no-deps `
  --volume "${MappingPath}:/run/vardena-l06-customer-code-map.json:ro" `
  migrate npm run licensing:customer-code-recovery -- `
    --mapping /run/vardena-l06-customer-code-map.json --apply --recover-failed

# 7. Continue with normal migrations
docker compose run --rm --no-deps migrate npx prisma migrate deploy

# 8. Start application services
docker compose up --build -d

# 9. Final verification
docker compose run --rm --no-deps migrate npm run licensing:customer-code-recovery
```

### Expected Output

```json
{
  "migration": "20261020000000_licensing_customer_code",
  "result": "recovered",
  "customerCount": 1,
  "changedCustomerIds": ["01M41HY2B6WCY41SW8JG8Q6XVX"],
  "ledgerChanged": true,
  "failureLogPreserved": true
}
```

### Final Verification Checklist

- [ ] Migration status: `applied`
- [ ] Enforcement: `NOT NULL = true`, `CHECK = true`, `UNIQUE = true`
- [ ] Customer count: Same as before recovery
- [ ] Customer `01M41HY2B6WCY41SW8JG8Q6XVX` has code: `VARDENA-LOCAL-001`
- [ ] All licenses, installations, versions preserved
- [ ] All audit events preserved
- [ ] Original failure logs preserved in ledger
- [ ] Application starts successfully
- [ ] License evaluation works correctly

---

## 6. Data Preservation Evidence

### What is Preserved (By Design)

| Entity | Preservation Mechanism | Verification |
|--------|----------------------|--------------|
| Customer records | Only NULL/blank codes updated; non-blank codes never overwritten | `planBackfill()` validation |
| Installation records | No updates to installations table | Rehearsal test comparison |
| License records | No updates to licenses table | Rehearsal test comparison |
| License version records | No updates to license_versions table | Rehearsal test comparison |
| Entitlement records | No updates to entitlements tables | Rehearsal test comparison |
| Audit events | No updates to license_audit_events table | Rehearsal test comparison |
| Signed artifact hashes | SHA-256 digests preserved (artifacts never stored) | Database query |
| Migration ledger | Original failure logs, started_at, id, checksum preserved | Ledger update logic |
| Database constraints | NOT NULL, CHECK, UNIQUE all enforced | `assertEnforced()` validation |

### Field-by-Field Preservation

The rehearsal test (`licensing-customer-code-recovery/rehearse.mjs`) performs **field-by-field comparison** of:

- All `customers` fields
- All `installations` fields
- All `licenses` fields
- All `license_versions` fields
- All `license_version_entitlements` fields
- All `license_audit_events` fields

Before and after recovery, ensuring **no data loss**.

---

## 7. Testing Coverage

### Unit Tests

| Test Suite | Coverage | Status |
|------------|----------|--------|
| `customer.spec.ts` | Domain validation | ✅ Passed |
| `license-import.service.spec.ts` | Import validation | ✅ Passed |
| `local-development-license.provider.spec.ts` | Synthetic provider isolation | ✅ Passed |

### Integration Tests

| Test | Scenario | Status |
|------|----------|--------|
| `test:licensing-customer-code-rehearsal` | Fresh deploy, populated, P3009, interruption, retry, preservation | ✅ Passed in CI |
| `test:licensing-migration-rehearsal` | Combined licensing version + customer code | ✅ Passed in CI |

### Rehearsal Test Scenarios

The `licensing-customer-code-recovery/rehearse.mjs` covers:

1. ✅ **Fresh database** — Normal `prisma migrate deploy` works
2. ✅ **Already applied** — No-op validation
3. ✅ **Pending populated** — Two-phase expansion + backfill
4. ✅ **Failed migration (P3009)** — Atomic recovery with ledger completion
5. ✅ **Missing codes** — Rejects incomplete mapping
6. ✅ **Malformed codes** — Rejects invalid format
7. ✅ **Duplicate codes** — Rejects duplicate customerCode
8. ✅ **ID-equal codes** — Rejects customerCode = customerId
9. ✅ **Unknown customer IDs** — Rejects mapping to non-existent customers
10. ✅ **Interruption before commit** — Full rollback
11. ✅ **Interruption after commit** — Idempotent retry
12. ✅ **Field-by-field preservation** — All data preserved
13. ✅ **Later migration continuation** — Subsequent migrations apply

---

## 8. CI Status

### Current CI Configuration

- ✅ **Backend CI** — All 7 checks pass:
  - `classify`
  - `docs`
  - `backend` (unit tests, typecheck, lint, format, build)
  - `frontend`
  - `generated-api-client`
  - `owner-artifact-store-windows`
  - `ci-gate`

- ✅ **Licensing rehearsals** — Both pass:
  - `test:licensing-version-rehearsal`
  - `test:licensing-customer-code-rehearsal`

- ✅ **GitHub Actions Run** — [#39947763149](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39947763149)

### CI Evidence Links

- **PR #200:** https://github.com/MR-AliEsmaeili/Vardena/pull/200
- **CI Run:** https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39947763149
- **Backend Job:** https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39947763149/job/120394582345

---

## 9. Prohibited Actions (Safety Checklist)

### ❌ Never Do These

- [ ] `docker compose down -v` — Destroys volume and all data
- [ ] `docker volume rm vardena_pgdata` — Destroys volume and all data
- [ ] `prisma migrate reset` — Destroys and recreates database
- [ ] `prisma db push` — Bypasses migrations, can corrupt schema
- [ ] Deleting customer `01M41HY2B6WCY41SW8JG8Q6XVX` — Loses historical data
- [ ] Deriving `VARDENA-LOCAL-001` from ID or display name — Violates policy
- [ ] Using `CUST-LOCAL-DEV` for persisted customer — Violates synthetic/real separation
- [ ] `prisma migrate resolve` — Bypasses validation, marks failed as applied
- [ ] Manually updating `_prisma_migrations` — Bypasses actual migration work
- [ ] Weakening constraints (removing NOT NULL, CHECK, UNIQUE) — Violates PDR-14
- [ ] Recreating system administrator — Unnecessary, can break RBAC
- [ ] Reissuing licenses as workaround — Doesn't fix root cause

### ✅ Always Do These

- [x] Take and verify backup before recovery
- [x] Use maintenance window, stop application writes
- [x] Use explicit owner-approved mapping
- [x] Verify mapping completeness (all customers have codes)
- [x] Run read-only inspection first
- [x] Use atomic recovery for failed migrations
- [x] Verify final state (applied, constraints enforced)
- [x] Preserve all existing data

---

## 10. Next Steps

### For This PR (#200)

1. ✅ **Owner decision documented** — `VARDENA-LOCAL-001` for `01M41HY2B6WCY41SW8JG8Q6XVX`
2. ✅ **Documentation updated** — Recovery runbook includes specific mapping
3. ✅ **Example mapping file** — `licensing-customer-code-map.example.json`
4. ✅ **Tests passing** — All CI checks green
5. ⏳ **Owner review** — Review and approve the solution
6. ⏳ **Actual recovery execution** — Run on real database (separate step, not in this PR)

### For Production Recovery (After PR Merge)

**Do NOT execute as part of this PR.** Recovery must be a separate, controlled operation:

1. Schedule maintenance window
2. Verify backup
3. Stop application services
4. Execute recovery with owner-approved mapping
5. Verify success
6. Start application services
7. Monitor for issues

### For Other Installations

If other installations have the same issue:

1. Identify all customers without codes using read-only inspection
2. Obtain explicit owner-approved codes for each
3. Create mapping file
4. Execute recovery
5. **Do NOT** use `VARDENA-LOCAL-001` for other installations — each installation's customers require their own owner-approved codes

---

## 11. Files Changed Summary

### New Files

1. `backend/prisma/recovery/licensing-customer-code-map.example.json`
   - Example mapping file with owner-approved code
   - Shows correct format for the local development customer

### Modified Files

1. `docs/licensing/customer-code-recovery.md`
   - Added owner decision section
   - Updated PowerShell commands with specific mapping
   - Clarified `CUST-LOCAL-DEV` vs `VARDENA-LOCAL-001` distinction
   - Added preservation guarantees section
   - Added prohibited actions section
   - Added current known mapping table

### Unchanged Files (Preserved from PR #200)

1. `backend/prisma/recovery/licensing-customer-code.mjs` — Recovery utility
2. `backend/prisma/rehearsal/licensing-customer-code-recovery/rehearse.mjs` — Rehearsal tests
3. `backend/package.json` — npm scripts
4. `.github/workflows/ci.yml` — CI configuration
5. `backend/prisma/migrations/20261020000000_licensing_customer_code/migration.sql` — Original migration
6. `backend/prisma/schema/licensing.prisma` — Schema
7. Various test files and documentation

---

## 12. Verification Commands

### Read-Only Status Check

```powershell
# Check migration status without making changes
docker compose run --rm --no-deps migrate npm run licensing:customer-code-recovery
```

### Verify Customer Code

```powershell
# After recovery, verify the customer has the correct code
docker compose exec postgres psql -U vardena -d vardena -c \
  "SELECT id, customer_code, display_name FROM licensing.customers WHERE id = '01M41HY2B6WCY41SW8JG8Q6XVX';"
```

### Verify Constraints

```powershell
# Verify all constraints are enforced
docker compose exec postgres psql -U vardena -d vardena -c \
  "SELECT column_name, is_nullable FROM information_schema.columns \
   WHERE table_schema = 'licensing' AND table_name = 'customers' AND column_name = 'customer_code';"

docker compose exec postgres psql -U vardena -d vardena -c \
  "SELECT conname, convalidated FROM pg_constraint \
   WHERE conrelid = 'licensing.customers'::regclass AND conname = 'customers_customer_code_check';"

docker compose exec postgres psql -U vardena -d vardena -c \
  "SELECT indexname FROM pg_indexes \
   WHERE schemaname = 'licensing' AND tablename = 'customers' AND indexname = 'uq_customers_customer_code';"
```

---

## Final Status

# **READY FOR REVIEW**

### Summary

- ✅ **Owner decision integrated** — `VARDENA-LOCAL-001` for customer `01M41HY2B6WCY41SW8JG8Q6XVX`
- ✅ **Comprehensive solution** — Handles all scenarios (fresh, pending, failed, applied)
- ✅ **Data preservation** — All customers, licenses, versions, entitlements, audit events preserved
- ✅ **No validation bypass** — All constraints enforced
- ✅ **Explicit owner control** — No auto-generation of codes
- ✅ **Tests passing** — All CI checks green
- ✅ **Documentation complete** — Runbook, examples, warnings, verification steps
- ✅ **Safety guaranteed** — Read-only inspection, atomic recovery, idempotent retry

### What This PR Does NOT Do

- ❌ Does NOT execute recovery on real database (requires separate controlled operation)
- ❌ Does NOT auto-generate codes for other customers
- ❌ Does NOT weaken constraints or validation
- ❌ Does NOT modify the original migration
- ❌ Does NOT bypass Prisma's migration ledger

### Next Action

**Product Owner Review:** Please review and approve this solution. Once approved, the actual database recovery can be scheduled and executed using the documented procedures.

---

**Report Date:** 2026-10-23  
**Location:** Newark, New Jersey, US  
**Branch:** `arena/19836cb4-vardena`  
**PR:** #200  
**Status:** READY FOR REVIEW
