# ADR-0028: Accounting Configuration Foundation — Versioned Root, Single ACTIVE, Operational Freeze

- **Status:** Accepted (Final 2026-09-18 — Review Fix Round 2 per D1-D5, R1-R10)
- **Date:** 2026-09-17 (Updated 2026-09-20 Final)
- **Implements:** Task 11 — Accounting Configuration Foundation (final)
- **Builds on:** ADR-0026 (Accounting Bounded Context), ADR-0024 (Bounded Versioned Workflow), ADR-0021 (Organization-Scoped Master Data), ADR-0025 (Single-Organization Deployment Pin)

## Final Decision (D1-D5 + R2,R8-R10)

Task 11 final per Product Decisions D1-D5:

- **D1 — Sole scope:** `accounts.accounting_configuration_id` is sole configuration scope for new accounts. Root creation MUST require ACTIVE accounting configuration. Legacy fallback `requireActiveVersionOrThrow` (coding structure) is REMOVED. `Account.codingStructureVersionId` is nullable legacy (D3).
- **D2 — Freeze columns out of scope:** `coding_structure_versions.name/effective_from/operationally_used_at` changes are out of scope — NOT touched in Task 11. Only accounting_configurations has those columns.
- **D3 — Backfill:** All existing accounts get `accounting_configuration_id` = org ACTIVE accounting_configuration if exists. If org has no active config, account remains legacy orphan with NULL — documented, not backfilled with fake value.
- **D4 — markOperationallyUsed caller:** `AccountsService.createAccount` calls `AccountingConfigurationsService.markOperationallyUsed` after successful pin on active config. Non-fatal, logged warn on failure. This marks operational use per foundation spec.
- **D5 — Squash migrations:** Three migrations `20260917/18/19` squashed into single final `20260920000000_accounting_configuration_foundation` with no DROP of self-created objects. History clean.

Review fixes R2,R8-R10:

- **R2:** No `coding_structure_versions` alteration in `accounting.prisma`, `accounting-rows.ts`, `coding-structures.repository.ts`, `accounting-configurations.repository.ts`, `accounting-locks.ts` regarding freeze columns. `AccountingConfiguration` does NOT have `codingStructureVersionId`.
- **R8:** Typed errors `NoActiveAccountingConfigurationError` and `AccountingConfigurationNotActiveError` used — no string matching `isNoActiveAccountingConfigurationError`.
- **R9:** Live DB FK mismatch test required (not in-memory fake). `Account.codingStructureVersionId` nullable prevents fake cast; repository locks accounting config row, not coding version, for root.
- **R10:** Dead code removed: `codingVersionId` generation in `accounting-configurations.service.ts`, `snapshot` no longer generates fake version id.

## Previous Review Fix Issues (Superseded)

Original Task 11 introduced:

1. Dangerous cast `AccountingConfiguration.id as CodingStructureVersion.id` — violates real PostgreSQL FK. Fixed by making `codingStructureVersionId` nullable and `accounting_configuration_id` sole scope (D1).
2. Dual source of truth: both config roots with no relationship. Fixed by D1 sole scope.
3. ACTIVE uniqueness only FOR UPDATE lock, no DB backstop. Fixed by partial unique index (final keeps it).
4. Freeze doc overclaimed posting/reporting protection not implemented. Fixed by D2 out-of-scope and D4 explicit caller documentation.

## Context

Task 11 requires foundation for all accounting configuration affecting Transaction, Posting, Reporting:

- Chart of Accounts
- Account Coding
- Detail Structure, Dimensions, Posting Rules, Control Roles, Tax, Costing, Numbering, Closing (seams only)

Before Task 11, only `coding_structure_versions` existed. Pattern correct but not generic. Task 11 creates generic root `accounting_configurations` + `accounting_configuration_levels`.

Non-goals (explicitly NOT in Task 11): Posting Rules, Dimensions, Control Roles, System Posting, Balances, Reports, Tax/Costing/Numbering/Closing, Frontend, Workflow, Outbox/Queue/Redis, Microservices, refactor CodingStructuresService, change CodingStructureVersion lifecycle, backfill orgs without active config, any change outside 10 In-Scope.

## Decision

### 1. Accounting Configuration Root (Final)

Two tables in `accounting` schema:

- `accounting.accounting_configurations`
  - `id`, `organization_id` FK RESTRICT, `code` (identity e.g. DEFAULT), `name`, `version_number` monotonic per org+code, `status` DRAFT/ACTIVE/SUPERSEDED default DRAFT, `effective_from` nullable, `operationally_used_at` nullable, audit
  - Unique: `(organization_id, code, version_number)`
  - Index: `(organization_id, status)`, `(organization_id, code)`
  - Partial unique: `uq_accounting_configurations_org_active ON (organization_id) WHERE status='ACTIVE'` — DB backstop for single ACTIVE, FOR UPDATE lock primary guard (same precedent as financial_areas.is_default but now with DB backstop per review)
  - Does NOT have `coding_structure_version_id` (per D2,R2)

- `accounting.accounting_configuration_levels`
  - `id`, `organization_id`, `configuration_id` FK RESTRICT, `level_index`, `title`, `digit_length`, `default_is_postable`, `level_kind` nullable
  - Unique: `(configuration_id, level_index)`
  - Index: `(organization_id, configuration_id)`

Levels belong to VERSION, immutable after publish — same as coding levels.

### 2. Status Lifecycle

- DRAFT → ACTIVE allowed before operational use
- ACTIVE → SUPERSEDED allowed when new version ACTIVE
- ACTIVE → DELETE forbidden
- SUPERSEDED immutable
- operationally_used_at != null blocks mutation/deletion

Enforced in domain `planConfigurationTransition`, `canDeleteConfiguration`, `canDestructivelyMutate`, and data `lockAccountingConfigurationRow` + `lockAccountingConfigurationsOfOrganization` FOR UPDATE for publish.

Single ACTIVE per org:
- Primary: `lockAccountingConfigurationsOfOrganization` FOR UPDATE serializes publishes
- Backstop: partial unique index `uq_accounting_configurations_org_active` guarantees invariant even under race (Prisma invisible, added via raw SQL migration — allowed per database-strategy.md)

### 3. Operational Freeze — Scope

- `accounting_configurations.operationally_used_at` marker
- Repository `markOperationallyUsed({id, now})` idempotent
- **D4 caller:** `AccountsService.createAccount` calls `markOperationallyUsed` after successful account pin on active config (foundation evidence that config is used operationally). Non-fatal, warn logged.
- Task 11 does NOT enforce freeze based on posting/ledger/dimensions yet — those are future tasks that will call same marker.
- Domain freeze helpers: `FreezeState` mutable/frozen_active/frozen_used/superseded, `resolveFreezeState`, `isConfigurationFrozen`, `assertConfigurationMutable` — reusable, not scattered `if(hasVouchers)`.
- D2: `coding_structure_versions` freeze columns out of scope — NOT altered.

MAX depth 8 architecture cap (same as coding), not business rule.

### 4. Chart of Accounts Foundation (D1, D3)

- Single `accounts` table adjacency `parent_id` + `level`
- Level titles/kinds from `accounting_configuration_levels`, configurable, no hardcoded 1=Assets
- `digit_length` per level configurable, `maxDepth` 1..8, `levelKind` informational
- **D1 sole scope:** `accounts.accounting_configuration_id` nullable FK RESTRICT → accounting_configurations, sole authority for new accounts. `coding_structure_version_id` nullable legacy (String? + relation CodingStructureVersion?).
- Root creation MUST require ACTIVE accounting configuration — no fallback to active coding structure (D1). Service throws typed `NoActiveAccountingConfigurationError` (R8).
- Child inherits parent's accounting_configuration_id — version isolation checks accounting_configuration_id, not coding version (legacy fallback to coding version only when both sides legacy orphan)
- **D3 backfill:** `UPDATE accounts SET accounting_configuration_id = (SELECT ac.id FROM accounting_configurations WHERE org AND status='ACTIVE' LIMIT 1) WHERE NULL`. If org has no active config, remains NULL legacy orphan — documented, not fake.
- Parent-child same config version enforced, cross-org 404, cycle prevention, postable-parent rule, depth bound, code prefix proof
- Code immutable, unique per org, parent RESTRICT, lifecycle is_active only
- Nature explicit DEBIT/CREDIT

### 5. Org Isolation & Integrity

- All queries filter organizationId
- Repository asserts organizationId match, 404 foreign
- Unique code per org + unique org_code_version + partial unique org_active
- Parent same org + same config (version_mismatch), no cycles, no postable parent, depth bounded
- Version isolation: account pinned to accounting_configuration_id, subtree never mixes

### 6. Migration-Only Persistence (D5)

- Single final migration `20260920000000_accounting_configuration_foundation`:
  - CREATE accounting_configurations (no coding_structure_version_id column)
  - CREATE accounting_configuration_levels
  - ALTER accounts ADD accounting_configuration_id nullable FK RESTRICT
  - Backfill per D3 (ACTIVE lookup, null stays for orphan)
  - Indexes: uq org_code_version, idx org_status, org_code, partial unique uq org_active WHERE ACTIVE, uq config_level, idx org_config, idx accounts accounting_configuration_id
  - No DROP of self-created objects (D5), no coding_structure_versions touch (D2)
- Prisma schema source of truth, no triggers, partial unique via raw SQL (allowed)

### 7. No Scope Creep

Only generic root + accounts sole scope. No posting rules, dimensions, control roles, system posting, balances, reports, tax/costing/numbering/closing, frontend, workflow, outbox/queue/redis, microservices.

## Consequences

- `AccountingConfigurationsService.createDraftWithLevels` generates only accountingConfigId (no codingVersionId) — R10 dead code removed
- `requireActiveConfigurationOrThrow` throws typed `NoActiveAccountingConfigurationError` — R8 no string matching
- `AccountsService.createAccount` requires active config for root (D1), calls `markOperationallyUsed` after create (D4), uses typed errors, snapshot uses accountingConfigurationId as sole scope
- `AccountsRepository.createChecked` locks accounting_configuration row for root, checks ACTIVE status throwing `AccountingConfigurationNotActiveError`, checks parent config match for child, allows missing coding version (nullable)
- `Account` domain: `codingStructureVersionId` nullable, `accountingConfigurationId` nullable legacy orphan, `planAccountPlacement` checks accounting config isolation first, fallback to coding version for legacy orphan
- Prisma Account model: codingStructureVersionId String? nullable, accountingConfigurationId String? nullable, relation CodingStructureVersion? optional, accountingConfiguration relation
- Docs updated: this ADR + `docs/accounting/configuration.md` reflect single migration, backfill null orphan, D4 caller, partial unique index, no coding FK
- Tests: domain 14 invariants + service 8 + chart 29 remain green, plus live DB FK mismatch test R9 (not in-memory) to be added
- Future tasks reference accounting_configuration_id as scope, call markOperationallyUsed, guard with isConfigurationFrozen

## Links

- Task 11 final: D1-D5 + R1-R10
- Domain: `backend/src/modules/accounting/domain/accounting-configuration.ts`, `account.ts`
- Data: `backend/src/modules/accounting/data/accounting-configurations.repository.ts`, `accounts.repository.ts`, `accounting-locks.ts`, `accounting-rows.ts`
- Migration: `backend/prisma/migrations/20260920000000_accounting_configuration_foundation/migration.sql`
- Prisma: `backend/prisma/schema/accounting.prisma`
- Previous: ADR-0026, ADR-0024
