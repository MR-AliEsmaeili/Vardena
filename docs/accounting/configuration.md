# Accounting Configuration — Task 11 Foundation (Final)

> Generic, organization-scoped, versioned root for all accounting configuration affecting Transaction, Posting, Reporting. Final per D1-D5, R1-R10.

## Scope (Task 11 Final)

**Foundation (Task 11 Final):**
- Configuration root: `accounting_configurations` + `accounting_configuration_levels`
- Real versioning: `version_number` monotonic per `(organization_id, code)`
- Status: `DRAFT` → `ACTIVE` → `SUPERSEDED`, exactly one ACTIVE per org (FOR UPDATE lock primary + partial unique index backstop)
- Operational freeze: domain abstraction + D4 caller `AccountsService.createAccount` → `markOperationallyUsed`
- Chart foundation: Account entity sole scope `accounting_configuration_id` (D1), nullable legacy `codingStructureVersionId`, recursive hierarchy, configurable coding, explicit nature, non-destructive lifecycle
- Backfill D3: existing accounts get ACTIVE config if exists, else null legacy orphan documented

**Non-Goals (NOT in Task 11 Final):**
- Posting Rules, Dimensions/Detail Structure, Control Roles, System Posting, Balances/Projections, Reports, Tax/Costing/Numbering/Closing Policies (seams only)
- Frontend, Workflow, Outbox/Queue/Redis, Microservices
- Refactor CodingStructuresService, change CodingStructureVersion lifecycle, backfill orgs without active config
- `coding_structure_versions` name/effective_from/operationally_used_at changes (D2 out of scope)
- `accounting_configurations.coding_structure_version_id` FK (R2 removed)

## Data Model (Final)

### `accounting_configurations`

- `id` ULID PK
- `organization_id` FK RESTRICT → organizations
- `code` VARCHAR(64) identity inside org e.g. DEFAULT
- `name` VARCHAR(200) human title
- `version_number` INT 1-based per (org, code)
- `status` VARCHAR(16) DRAFT|ACTIVE|SUPERSEDED default DRAFT
- `effective_from` TIMESTAMPTZ nullable
- `operationally_used_at` TIMESTAMPTZ nullable freeze marker
- Audit: `created_at`, `updated_at`, `created_by`, `updated_by`
- **NOT** `coding_structure_version_id` (per D2,R2 — no column)

Constraints:
- `UNIQUE (organization_id, code, version_number)` → `uq_accounting_configurations_org_code_version`
- `INDEX (organization_id, status)` → `idx_accounting_configurations_org_status`
- `INDEX (organization_id, code)` → `idx_accounting_configurations_org_code`
- `UNIQUE INDEX uq_accounting_configurations_org_active ON (organization_id) WHERE status='ACTIVE'` — DB backstop, FOR UPDATE primary

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

### `accounts` — final

- Existing: `id`, `organization_id`, `code`, `title`, `parent_id`, `level`, `account_nature`, `is_postable`, `is_active`, audit
- `coding_structure_version_id` TEXT nullable FK RESTRICT → `coding_structure_versions` (legacy, nullable after Task 11 final per D1,D3)
- `accounting_configuration_id` TEXT nullable FK RESTRICT → `accounting_configurations` (canonical sole scope D1, nullable for legacy orphan D3)
  - New accounts MUST set it (D1 requires ACTIVE config for root)
  - Child inherits parent's accounting_configuration_id — version isolation on accounting config
  - Old rows backfilled from ACTIVE config per org if exists, else remains NULL legacy orphan

Indexes:
- `uq_accounts_organization_id_code` (existing)
- `idx_accounts_accounting_configuration_id` (new)
- `idx_accounts_coding_structure_version_id` (existing, now nullable)

### `coding_structure_versions` — NOT touched (D2,R2)

No `name`, `effective_from`, `operationally_used_at` addition in Task 11 final. No partial unique index on coding_structure_versions. Task 11 does not alter this table.

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

Single ACTIVE per org:
- Primary: FOR UPDATE lock serializes publishes (same rationale as financial_areas.is_default)
- Backstop: partial unique index `uq_accounting_configurations_org_active WHERE status='ACTIVE'` added in final migration `20260920000000` — guarantees invariant under race, Prisma invisible added via raw SQL (allowed per database-strategy.md)

## Operational Freeze — D4 Caller

> هر Accounting Configuration که بر Transaction، Posting یا Reporting اثر می‌گذارد، قبل از اولین استفاده عملیاتی قابل تغییر است؛ پس از شروع استفاده عملیاتی، تغییر مخرب ممنوع است و تغییرات آینده باید از طریق Version جدید یا Migration کنترل‌شده انجام شوند.

**Task 11 Final:**
- Implements `operationally_used_at` marker + domain guards `canDestructivelyMutate`, `canDeleteConfiguration`, `assertConfigurationMutable`, `resolveFreezeState`
- **D4 caller:** `AccountsService.createAccount` calls `AccountingConfigurationsService.markOperationallyUsed(accountingConfigurationId)` after successful pin on active config. Non-fatal, warn logged on failure. This is foundation evidence that config is used operationally.
- Does NOT yet enforce freeze based on posting/ledger/dimensions — future tasks will call same marker
- Design centralized: `domain/accounting-configuration-freeze.ts` owns FreezeState mutable/frozen_active/frozen_used/superseded, `resolveFreezeState`, `isConfigurationFrozen`, `ConfigurationFrozenError`, `OperationalUsage`, `isConfigurationUsedOperationally` abstraction
- Repository: `markOperationallyUsed({id, now})` idempotent
- D2: coding_structure_versions freeze columns out of scope

MAX depth 8 architecture cap, not business rule.

## Chart of Accounts Foundation (D1,D3)

- One table adjacency `parent_id` + `level` (AC-D-06/07) — no groups/generals/subsidiaries/details tables
- Level titles/kinds from `accounting_configuration_levels`, configurable — no hardcoded 1=Assets
- `digit_length` per level configurable, `maxDepth` 1..8, `levelKind` informational
- **D1 sole scope:** `accounting_configuration_id` is sole authority for new accounts. Root MUST require ACTIVE accounting configuration — throws typed `NoActiveAccountingConfigurationError` (R8), no fallback to `requireActiveVersionOrThrow` (removed)
- Child inherits parent's accounting_configuration_id, version isolation checks accounting_configuration_id first, fallback to coding version only for legacy orphan (both sides null)
- **D3 backfill:** `UPDATE accounts SET accounting_configuration_id = (SELECT ac.id FROM accounting_configurations WHERE organization_id = a.organization_id AND status='ACTIVE' LIMIT 1) WHERE NULL`. If org has no active config, remains NULL legacy orphan — documented in ADR-0028, not fake backfill
- Parent same org + same config, cross-org 404, cycle prevention, postable-parent rule, depth bound, code prefix proof
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

## Invariants & Tests

- `domain/accounting-configuration.spec.ts` 14 invariants: code/name, missing levels, gap/duplicate, digit_length, code_length cap, levelKind configurable, status transitions, delete/mutate guards, freeze state, effectiveFrom, blank title, pattern not hardcoded
- `application/accounting-configurations.spec.ts` 8 service tests: draft+publish, single ACTIVE, immutable after publish, operational freeze blocks mutation/deletion, delete DRAFT, org isolation 404, configurable hierarchy, View vs Configure
- Chart: 29 tests
- **R9 live DB FK mismatch test:** must verify real PostgreSQL FK (accounting_configuration_id RESTRICT + coding_structure_version_id nullable) — not in-memory fake. Ensures no cast `AccountingConfiguration.id as CodingStructureVersion.id`
- Total accounting module ~348 green + R9

## Migration (Final per D5)

- Single final `20260920000000_accounting_configuration_foundation`:
  - CREATE `accounting_configurations` (id, org, code, name, version_number, status DRAFT default, effective_from, operationally_used_at, audit) — NO coding_structure_version_id column (D2,R2)
  - CREATE UNIQUE `uq_accounting_configurations_org_code_version` (org, code, version_number)
  - CREATE INDEX `idx_accounting_configurations_org_status` (org, status), `idx_accounting_configurations_org_code` (org, code)
  - CREATE UNIQUE partial `uq_accounting_configurations_org_active` (org) WHERE status='ACTIVE' — DB backstop
  - CREATE `accounting_configuration_levels` (id, org, configuration_id FK, level_index, title, digit_length, default_is_postable, level_kind, audit)
  - CREATE UNIQUE `uq_accounting_configuration_levels_config_level` (config, level_index)
  - CREATE INDEX `idx_accounting_configuration_levels_org_config` (org, config)
  - ALTER `accounts` ADD `accounting_configuration_id` TEXT nullable
  - ADD FK `fk_accounts_accounting_configuration` RESTRICT → accounting_configurations
  - CREATE INDEX `idx_accounts_accounting_configuration_id`
  - Backfill per D3: set accounting_configuration_id to active config of same org if exists, else remains NULL legacy orphan
  - No DROP of self-created objects (D5), no coding_structure_versions touch (D2), no coding partial unique index
- Prisma schema source of truth, migration-only persistence, no triggers, partial indexes via raw SQL

## Future Extensions

- Reference `accounting_configuration_id` as configuration scope
- Call `markOperationallyUsed` when first used (D4 already done for accounts, future: posting, ledger, dimensions, etc.)
- Guard destructive changes with `isConfigurationFrozen` / `resolveFreezeState`
- New tables under `accounting` schema linked to configuration version

No change to foundation tables needed for extensions — only new tables referencing `accounting_configuration_id`.

## Links

- ADR-0028: `docs/adr/0028-accounting-configuration-foundation.md` (final)
- Domain: `backend/src/modules/accounting/domain/accounting-configuration.ts`, `account.ts`, `accounting-configuration-freeze.ts`
- Data: `backend/src/modules/accounting/data/accounting-configurations.repository.ts`, `accounts.repository.ts`
- Migration: `backend/prisma/migrations/20260920000000_accounting_configuration_foundation/migration.sql`
- Prisma: `backend/prisma/schema/accounting.prisma`
