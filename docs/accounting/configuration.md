# Accounting Configuration — Task 11 Foundation (Final Round 2 per D1-D7; remediated 2026-09-22)

> Generic, organization-scoped, versioned root for all accounting configuration affecting Transaction, Posting, Reporting. Final per D1-D7, NOT NULL + deferred markOperationallyUsed.

## Scope (Task 11 Final Round 2)

**Foundation (Task 11 Final D1-D7):**
- Configuration root: `accounting_configurations` + `accounting_configuration_levels`
- Real versioning: `version_number` monotonic per `(organization_id, code)`
- Status: `DRAFT` → `ACTIVE` → `SUPERSEDED`, exactly one ACTIVE per org (FOR UPDATE lock primary + partial unique index backstop)
- Operational freeze: domain abstraction + D4 deferred — `markOperationallyUsed` NOT called in Task 11, caller deferred to Posting/System Posting (first Voucher, not Account), remains as deferred abstraction without caller, explicitly documented as deferred (not dead code)
- Chart foundation: Account entity sole scope `accounting_configuration_id` NOT NULL (D1,D3) + code shape `coding_structure_version_id` NOT NULL (D2 untouched), recursive hierarchy, configurable coding, explicit nature, non-destructive lifecycle
- Backfill D3 NOT NULL: handles both orphan=0 and orphan>0 — legacy config strategy for orphan>0, simple backfill+NOT NULL for orphan=0. Orphan query blocked no live DB in sandbox, migration handles both.
- D5 single migration, D6 typed errors only, D7 live DB test

**Non-Goals (NOT in Task 11 Final):**
- Posting Rules, Dimensions/Detail Structure, Control Roles, System Posting, Balances/Projections, Reports, Tax/Costing/Numbering/Closing Policies (seams only)
- Frontend, Workflow, Outbox/Queue/Redis, Microservices
- Refactor CodingStructuresService Task 10.3, change CodingStructureVersion lifecycle, LedgerEntry, PostingService, AccountingDocuments
- `coding_structure_versions` name/effective_from/operationally_used_at changes (D2 out of scope — NOT touched)
- Transform CodingStructureVersion to state inside AccountingConfiguration (separate ADR)

## Data Model (Final per D1-D7)

### `accounting_configurations`

- `id` ULID PK
- `organization_id` FK RESTRICT → organizations
- `code` VARCHAR(64) identity inside org e.g. DEFAULT, LEGACY
- `name` VARCHAR(200) human title
- `version_number` INT 1-based per (org, code)
- `status` VARCHAR(16) DRAFT|ACTIVE|SUPERSEDED default DRAFT
- `effective_from` TIMESTAMPTZ nullable
- `operationally_used_at` TIMESTAMPTZ nullable freeze marker
- Audit: `created_at`, `updated_at`, `created_by`, `updated_by`
- **NOT** `coding_structure_version_id` (per D2 — no column, no touch coding_structure_versions)

Constraints:
- `UNIQUE (organization_id, code, version_number)` → `uq_accounting_configurations_org_code_version`
- `INDEX (organization_id, status)` → `idx_accounting_configurations_org_status`
- `INDEX (organization_id, code)` → `idx_accounting_configurations_org_code`
- `UNIQUE INDEX uq_accounting_configurations_org_active ON (organization_id) WHERE status='ACTIVE'` — DB backstop

### `accounting_configuration_levels`

- `id`, `organization_id`, `configuration_id` FK RESTRICT
- `level_index` 1-based inside version
- `title` VARCHAR(200)
- `digit_length` INT ≥1
- `default_is_postable` BOOL
- `level_kind` VARCHAR(20) nullable informational
- Audit

Constraints:
- `UNIQUE (configuration_id, level_index)` → `uq_accounting_configuration_levels_config_level`
- `INDEX (organization_id, configuration_id)` → `idx_accounting_configuration_levels_org_config`

Levels belong to VERSION, immutable after publish. MAX depth 8 architecture cap.

### `accounts` — final per D1,D2,D3

- Existing: `id`, `organization_id`, `code`, `title`, `parent_id`, `level`, `account_nature`, `is_postable`, `is_active`, audit
- `coding_structure_version_id` TEXT NOT NULL FK RESTRICT → `coding_structure_versions` (code shape version, D2 untouched, remains NOT NULL)
- `accounting_configuration_id` TEXT NOT NULL FK RESTRICT → `accounting_configurations` (canonical sole scope D1, NOT NULL after D3 backfill)
  - New accounts MUST set it (D1 requires ACTIVE config for root, throws typed NoActiveAccountingConfigurationError)
  - Child inherits parent's both ids — version isolation on both accounting_configuration_id and coding_structure_version_id
  - Old rows backfilled: first from ACTIVE, then legacy LEGACY ACTIVE config created for orphan orgs per D3, second backfill, then SET NOT NULL

Indexes:
- `uq_accounts_organization_id_code` (existing)
- `idx_accounts_accounting_configuration_id` (new)
- `idx_accounts_coding_structure_version_id` (existing, remains NOT NULL per D2)

### `coding_structure_versions` — NOT touched (D2)

No `name`, `effective_from`, `operationally_used_at` addition in Task 11 final. Task 11 does not alter this table. CodingStructureVersion Task 10.3 untouched.

## Lifecycle

```
DRAFT (mutable, not used) → ACTIVE (frozen, one per org) → SUPERSEDED (immutable)
       ↓
   DELETE only while DRAFT and operationally_used_at IS NULL
```

- DRAFT → ACTIVE: publish transaction locks `lockAccountingConfigurationsOfOrganization` FOR UPDATE, validates shape via `planAccountingConfiguration`, supersedes previous ACTIVE
- ACTIVE → SUPERSEDED: when new version ACTIVE
- ACTIVE → DELETE forbidden
- SUPERSEDED immutable
- operationally_used_at != null blocks mutation/deletion

Single ACTIVE per org: primary FOR UPDATE lock, backstop partial unique index.

## Operational Freeze — D4 Deferred

> هر Accounting Configuration که بر Transaction، Posting یا Reporting اثر می‌گذارد، قبل از اولین استفاده عملیاتی قابل تغییر است؛ پس از شروع استفاده عملیاتی، تغییر مخرب ممنوع است و تغییرات آینده باید از طریق Version جدید یا Migration کنترل‌شده انجام شوند.

**Task 11 Final Round 2 per D4:**
- Implements `operationally_used_at` marker + domain guards `canDestructivelyMutate`, `canDeleteConfiguration`, `assertConfigurationMutable`, `resolveFreezeState`
- **D4 deferred:** `markOperationallyUsed` NOT called in Task 11. Caller deferred to Posting/System Posting (first Voucher, not Account). Method remains as deferred abstraction without caller, explicitly documented as deferred in ADR-0028 and here — not implicit dead code. Future Posting task will call it on first Voucher finalization.
- Does NOT yet enforce freeze based on posting/ledger/dimensions — future tasks will call same marker
- Design centralized: `domain/accounting-configuration-freeze.ts` owns FreezeState, `resolveFreezeState`, `isConfigurationFrozen`, `ConfigurationFrozenError`
- Repository: `markOperationallyUsed({id, now})` idempotent
- D2: coding_structure_versions freeze columns out of scope
- **Still deferred after the 2026-09-22 remediation** (OQ-64): which configuration a voucher freezes (multi-configuration vouchers), the marker's position in the module's lock order, first-use-wins idempotency and replay behaviour are analysed — not implemented — in [`task-11-mark-operationally-used-decision-note.md`](./task-11-mark-operationally-used-decision-note.md)

## Chart of Accounts Foundation (D1,D2,D3)

- One table adjacency `parent_id` + `level`
- Level titles/kinds from `accounting_configuration_levels`, configurable — no hardcoded 1=Assets
- `digit_length` per level configurable, `maxDepth` 1..8, `levelKind` informational
- **D1 sole scope NOT NULL:** `accounting_configuration_id` is sole authority, NOT NULL after D3. Root MUST require ACTIVE accounting configuration AND ACTIVE coding structure version (D2) — throws typed `NoActiveAccountingConfigurationError` (D6), no fallback, no string matching.
- **D2 untouched:** `coding_structure_version_id` remains NOT NULL code shape version, Task 10.3 untouched
- Child inherits parent's both ids, version isolation checks both
- **D3 backfill + NOT NULL handling both orphan cases:**
  1. Add column nullable
  2. UPDATE from ACTIVE accounting_configurations
  3. If orphan remains: create a LEGACY ACTIVE configuration per orphan org (code LEGACY, name Legacy Accounting Configuration, version 1, status ACTIVE) and **copy the level set of the organization's ACTIVE coding-structure version** (chosen deterministically: newest `version_number`, then id). A copied set is **never extended** — including a ONE-level structure. Only when there is no ACTIVE version to copy from (or it has no level rows) does the configuration receive the documented default `(1, Group, 2, not postable)` + `(2, Detail, 3, postable)`, inserted in one statement guarded by "this configuration has no level rows". That fallback case is recorded as **OQ-63**
  4. Second UPDATE from LEGACY ACTIVE
  5. ALTER COLUMN SET NOT NULL — must succeed for both orphan=0 and orphan>0
  - Orphan query: blocked no live DB in sandbox, so migration must handle both
- Parent same org + same config (both ids), cross-org 404, cycle prevention, postable-parent rule, depth bound, code prefix proof
- Code immutable, unique per org 409, parent RESTRICT, lifecycle is_active only, no DELETE, no code reuse
- Nature explicit DEBIT/CREDIT closed list

## API

- `GET /v1/accounting-configurations?organizationId=&code=&status=&search=&page=&pageSize=&sort=` list
- `GET /v1/accounting-configurations/active?organizationId=` active
- `GET /v1/accounting-configurations/:id?organizationId=` one with levels
- `POST /v1/accounting-configurations` draft (code, name, effectiveFrom, levels)
- `PATCH /v1/accounting-configurations/:id?organizationId=` edit DRAFT rejected once published or used
- `POST /v1/accounting-configurations/:id/publish?organizationId=` activate draft supersede previous
- `DELETE /v1/accounting-configurations/:id?organizationId=` delete DRAFT not yet used

Permissions: `Accounting.AccountingConfiguration.View`, `Accounting.AccountingConfiguration.Configure`

## Invariants & Tests (state after the 2026-09-22 remediation)

- `domain/accounting-configuration.spec.ts` — 15 invariants (incl. the `levelKind` 20/21/64 bound and the freeze-state table)
- `application/accounting-configurations.spec.ts` — 8 service tests
- `api/dto/accounting-configuration.dto.spec.ts` — 5 DTO boundary tests (`levelKind` 20/21/64, no truncation)
- `domain/level-kind-contract.spec.ts` — 3 cross-layer tests: the domain constant, the Prisma `@db.VarChar(20)` declarations and the migration DDL must agree, and no source line may slice/truncate a `levelKind`
- Chart of accounts: `domain/account-placement.spec.ts` (31 tests — it adds the move-pin and root-pin write-boundary describes) + `domain/account-code.spec.ts` + `application/coding-structure-accounts.spec.ts` (31 tests, incl. the two cross-configuration/publish-race regressions)
- `data/accounts.repository.spec.ts` — 7 tests against the REAL `AccountsRepository` through a minimal fake transactional client: the root pin (inactive coding version / non-ACTIVE configuration refused, ACTIVE pair accepted) and the move pin (a snapshot naming another configuration or version refused with `version_mismatch` and no write; no snapshot refused; own pair accepted). Added after the verification pass showed those call sites had no direct test
- **D7:** `accounting-configuration-fix.spec.ts` deleted (FK mismatch in-memory fake). Live DB test `accounting-configuration-live.e2e-spec.ts` covers: both NOT NULL pins, the coding-version FK rejecting a configuration id (with a control insert and the DB state as the oracle), the PARTIAL unique index challenged by a violating raw INSERT (with a DRAFT control), the `level_kind` storage width, the root write-boundary ACTIVE re-check, ON DELETE RESTRICT, and the D4 deferral
- **Populated backfill (NOT observable in a database migrated from empty):** `npm run test:migration-rehearsal` (`backend/prisma/rehearsal/task-11-configuration-foundation/`) applies all pre-Task-11 migrations to a disposable PostgreSQL, seeds populated data (orphans, one-level structures, multi-organization, draft/superseded versions), applies the Task 11 migration in one transaction while proving it blocks on a table lock, then runs `verify.sql`
- **D6:** typed errors only, no `isNoActiveAccountingConfigurationError` string matching

## Remediation (2026-09-22) — what changed after the independent review

1. **Cross-configuration validation is impossible by construction**: moves validate against the account's OWN pinned configuration/version (`planAccountMovePin` + `pinnedPairForMove`), and two application-level regression tests prove it (a second ACTIVE configuration exists, an account pinned to another one still fails with `level_length_mismatch`; a concurrent publish supersedes the resolved version and the root create is refused with `Conflict`, writing nothing).
2. **Coding-version ACTIVE is re-checked at the write boundary** (`planRootAccountPin` under the version + configuration row locks), not only during service resolution.
3. **Migration semantics corrected**: deterministic single-ACTIVE-version level copy, and the "no level rows" fallback guard (no silent widening of a ONE-level copy). Verified by the rehearsal.
4. **`levelKind` contract aligned**: domain `MAX_LEVEL_KIND_LENGTH = 20` = Prisma `@db.VarChar(20)` = SQL `VARCHAR(20)` = API `@MaxLength(20)`; 21/64-character values are refused, never truncated.
5. **Live e2e tests repaired** (FK-negative test now fails when the FK is missing; the partial-index test challenges the index itself instead of counting ACTIVE rows) and the populated-backfill claim moved to the rehearsal.
6. **Deferred D4 documented, not implemented**: `docs/accounting/task-11-mark-operationally-used-decision-note.md` (OQ-64).

## Migration (Final per D5 + D3)

- Single final `20260920000000_accounting_configuration_foundation`:
  - CREATE `accounting_configurations` (id, org, code, name, version_number, status DRAFT default, effective_from, operationally_used_at, audit) — NO coding_structure_version_id column (D2)
  - CREATE UNIQUE `uq_accounting_configurations_org_code_version` (org, code, version_number)
  - CREATE INDEX `idx_accounting_configurations_org_status` (org, status), `idx_accounting_configurations_org_code` (org, code)
  - CREATE UNIQUE partial `uq_accounting_configurations_org_active` (org) WHERE status='ACTIVE' — DB backstop
  - CREATE `accounting_configuration_levels` (id, org, configuration_id FK, level_index, title, digit_length, default_is_postable, level_kind, audit)
  - CREATE UNIQUE `uq_accounting_configuration_levels_config_level` (config, level_index)
  - CREATE INDEX `idx_accounting_configuration_levels_org_config` (org, config)
  - ALTER `accounts` ADD `accounting_configuration_id` TEXT nullable
  - ADD FK `fk_accounts_accounting_configuration` RESTRICT → accounting_configurations
  - CREATE INDEX `idx_accounts_accounting_configuration_id`
  - Backfill D3 step1: UPDATE from ACTIVE
  - Legacy handling D3 step2: WITH orphan_orgs, legacy_insert gen_random_uuid LEGACY ACTIVE; copy the ACTIVE version's level set (deterministic single-version join: `ORDER BY version_number DESC, id ASC LIMIT 1`, so a violated one-active-version invariant cannot abort on `uq_accounting_configuration_levels_config_level`); one-statement default 2-level fallback guarded by `NOT EXISTS (… level rows)` — a copied level set is never appended to
  - `uq_accounting_configurations_org_active` is **raw SQL only** (Prisma cannot express a partial unique index); the drift risk (a later `prisma migrate dev` regenerating the schema) is accepted and covered by the live e2e index-definition test and the rehearsal
  - Backfill D3 step3: second UPDATE from LEGACY ACTIVE
  - SET NOT NULL per D1,D3
  - No DROP of self-created objects (D5), no coding_structure_versions touch (D2)
- Prisma schema source of truth, migration-only persistence, no triggers, partial indexes via raw SQL

## Future Extensions

- Reference `accounting_configuration_id` as configuration scope NOT NULL
- Call `markOperationallyUsed` when first Voucher finalized (D4 deferred to Posting)
- Guard destructive changes with `isConfigurationFrozen` / `resolveFreezeState`
- New tables under `accounting` schema linked to configuration version

No change to foundation tables needed for extensions — only new tables referencing `accounting_configuration_id`.

## Links

- ADR-0028: `docs/adr/0028-accounting-configuration-foundation.md` (final Round 2 D1-D7)
- Domain: `backend/src/modules/accounting/domain/accounting-configuration.ts`, `account.ts`, `accounting-configuration-freeze.ts`
- Data: `backend/src/modules/accounting/data/accounting-configurations.repository.ts`, `accounts.repository.ts`
- Migration: `backend/prisma/migrations/20260920000000_accounting_configuration_foundation/migration.sql`
- Prisma: `backend/prisma/schema/accounting.prisma`
- Live DB test: `backend/test/accounting-configuration-live.e2e-spec.ts`
- Decision note (D4): `docs/accounting/task-11-mark-operationally-used-decision-note.md`
- Migration rehearsal: `backend/prisma/rehearsal/task-11-configuration-foundation/` (`npm run test:migration-rehearsal`)
- Remediation report: `docs/task-11-implementation-report.md` (sections A–J)
- Open Questions raised by the remediation: OQ-62 (pin compatibility), OQ-63 (legacy fallback shape), OQ-64 (operational-use boundary)
