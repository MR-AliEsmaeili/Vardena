# ADR-0028: Accounting Configuration Foundation — Versioned Root, Single ACTIVE, Operational Freeze

- **Status:** Accepted (Final 2026-09-18 — Review Fix Round 2 per D1-D7)
- **Date:** 2026-09-17 (Updated 2026-09-20 Final Round 2)
- **Implements:** Task 11 — Accounting Configuration Foundation (final per D1-D7)
- **Builds on:** ADR-0026 (Accounting Bounded Context), ADR-0024 (Bounded Versioned Workflow), ADR-0021 (Organization-Scoped Master Data), ADR-0025 (Single-Organization Deployment Pin)

## Final Decision (D1-D7)

Task 11 final per Product Decisions D1-D7 (Review Fix Round 2):

- **D1 — NOT NULL sole scope:** `accounts.accounting_configuration_id` is sole configuration scope, MUST be NOT NULL after backfill. `AccountsService.createAccount` throws typed `NoActiveAccountingConfigurationError` if no ACTIVE. Legacy fallback `requireActiveVersionOrThrow` in root path REMOVED. `isNoActiveAccountingConfigurationError` string matching REMOVED (D6).
- **D2 — coding_structure_versions untouched:** Task 11 must NOT change `coding_structure_versions` — columns `name`, `effective_from`, `operationally_used_at` must NOT be added. `CodingStructureVersion` Task 10.3 untouched. Transformation to state inside `AccountingConfiguration` is separate ADR, not this task. `codingStructureVersionId` remains NOT NULL (code shape version).
- **D3 — NOT NULL handling based on orphan query:** `accounts.accounting_configuration_id` must be NOT NULL in same Task based on orphan query result:
  - orphan=0: simple backfill + SET NOT NULL
  - orphan>0 + Product Strategy 5 approved = Legacy Config strategy: create `LEGACY` ACTIVE config per orphan org, copy levels from active coding version or default 2 levels, backfill, then SET NOT NULL
  - orphan>0 not approved = BLOCKED
  - no live DB = `blocked: no live DB` — migration must handle both orphan=0 and orphan>0 (implemented)
  Orphan query: `SELECT o.id, o.name, COUNT(a.id) orphan_count FROM organization.organizations o LEFT JOIN accounting.accounts a ON a.organization_id=o.id AND a.accounting_configuration_id IS NULL LEFT JOIN accounting.accounting_configurations ac ON ac.organization_id=o.id AND ac.status='ACTIVE' WHERE ac.id IS NULL AND a.id IS NOT NULL GROUP BY o.id, o.name` — sandbox has no DATABASE_URL, result = `blocked: no live DB`.
- **D4 — markOperationallyUsed deferred:** `markOperationallyUsed` NOT called in Task 11. Caller deferred to Posting/System Posting (first Voucher, not Account). Remains as deferred abstraction without caller, must be documented explicitly as deferred in ADR-0028 and docs not implicit dead code.
- **D5 — Squash migrations:** Three Task 11 migrations squashed to one final clean migration `20260920000000_accounting_configuration_foundation` (branch personal not merged).
- **D6 — Remove string matching:** `isNoActiveAccountingConfigurationError` string matching removed, use typed error `NoActiveAccountingConfigurationError`.
- **D7 — Delete in-memory FK test:** `accounting-configuration-fix.spec.ts` FK mismatch in-memory fake test deleted, converted to live DB test `accounting-configuration-live.e2e-spec.ts` covering NOT NULL + legacy handling.

## Previous Round Issues (Superseded)

Round 1 made `codingStructureVersionId` nullable and `accountingConfigurationId` nullable for legacy orphan, and called `markOperationallyUsed` in Account creation — violates new D1-D4. Fixed in Round 2.

## Context

Task 11 requires foundation for all accounting configuration affecting Transaction, Posting, Reporting. Before Task 11 only `coding_structure_versions` existed. Task 11 creates generic root `accounting_configurations` + `accounting_configuration_levels`.

Non-goals: Posting Rules, Dimensions, Control Roles, System Posting, Balances, Reports, Tax/Costing/Numbering/Closing, Frontend, Workflow, Outbox/Queue/Redis, Microservices, refactor CodingStructuresService Task 10.3, change CodingStructureVersion lifecycle, LedgerEntry, PostingService, AccountingDocuments, transform CodingStructureVersion to state inside AccountingConfiguration.

## Decision

### 1. Accounting Configuration Root (Final per D1-D7)

Two tables in `accounting` schema:

- `accounting.accounting_configurations`
  - `id`, `organization_id` FK RESTRICT, `code` (DEFAULT, LEGACY), `name`, `version_number` monotonic per org+code, `status` DRAFT/ACTIVE/SUPERSEDED default DRAFT, `effective_from` nullable, `operationally_used_at` nullable, audit
  - Unique: `(organization_id, code, version_number)`
  - Index: `(organization_id, status)`, `(organization_id, code)`
  - Partial unique: `uq_accounting_configurations_org_active ON (organization_id) WHERE status='ACTIVE'` — DB backstop for single ACTIVE, FOR UPDATE lock primary guard
  - Does NOT have `coding_structure_version_id`, does NOT touch `coding_structure_versions` (D2)

- `accounting.accounting_configuration_levels`
  - `id`, `organization_id`, `configuration_id` FK RESTRICT, `level_index`, `title`, `digit_length`, `default_is_postable`, `level_kind` nullable
  - Unique: `(configuration_id, level_index)`
  - Index: `(organization_id, configuration_id)`

Levels belong to VERSION, immutable after publish.

### 2. Status Lifecycle

- DRAFT → ACTIVE allowed before operational use
- ACTIVE → SUPERSEDED when new version ACTIVE
- ACTIVE → DELETE forbidden
- SUPERSEDED immutable
- operationally_used_at != null blocks mutation/deletion

Enforced in domain `planConfigurationTransition`, `canDeleteConfiguration`, `canDestructivelyMutate`, and data `lockAccountingConfigurationRow` + `lockAccountingConfigurationsOfOrganization` FOR UPDATE for publish.

Single ACTIVE per org: primary FOR UPDATE lock, backstop partial unique index.

### 3. Operational Freeze — Deferred per D4

- `accounting_configurations.operationally_used_at` marker
- Repository `markOperationallyUsed({id, now})` idempotent
- **D4 deferred:** NOT called in Task 11. Caller deferred to Posting/System Posting (first Voucher, not Account). Method remains as deferred abstraction without caller, explicitly documented as deferred (not dead code). Future Posting task will call it when first Voucher is finalized.
- Domain freeze helpers: `FreezeState`, `resolveFreezeState`, `isConfigurationFrozen`, `assertConfigurationMutable` — reusable.

MAX depth 8 architecture cap, not business rule.

### 4. Chart of Accounts Foundation (D1, D2, D3)

- Single `accounts` table adjacency `parent_id` + `level`
- Level titles/kinds from `accounting_configuration_levels`, configurable, no hardcoded 1=Assets
- `digit_length` per level configurable, `maxDepth` 1..8, `levelKind` informational
- **D1 sole scope NOT NULL:** `accounts.accounting_configuration_id` NOT NULL FK RESTRICT → accounting_configurations, sole authority. `coding_structure_version_id` NOT NULL (D2 untouched) code shape version.
- Root creation MUST require ACTIVE accounting configuration AND ACTIVE coding structure version (code shape) — no fallback (D1). Service throws typed `NoActiveAccountingConfigurationError` (D6).
- Child inherits parent's accounting_configuration_id AND coding_structure_version_id — both version isolation checks
- **D3 backfill + NOT NULL:** 
  1. Add column nullable
  2. UPDATE from ACTIVE accounting_configurations
  3. If orphan remains (org has accounts NULL and no ACTIVE): create LEGACY ACTIVE config per org (code LEGACY, name Legacy Accounting Configuration, version 1, status ACTIVE), copy levels from active coding_structure_versions if exists, else default 2 levels (Group 2, Detail 3)
  4. Second UPDATE from newly created LEGACY ACTIVE
  5. ALTER COLUMN SET NOT NULL — must succeed for both orphan=0 and orphan>0
- Parent-child same config version enforced (both ids), cross-org 404, cycle prevention, postable-parent rule, depth bound, code prefix proof
- Code immutable, unique per org, parent RESTRICT, lifecycle is_active only
- Nature explicit DEBIT/CREDIT

### 5. Org Isolation & Integrity

- All queries filter organizationId
- Repository asserts organizationId match, 404 foreign
- Unique code per org + unique org_code_version + partial unique org_active
- Parent same org + same config (both ids), no cycles, no postable parent, depth bounded
- Version isolation: account pinned to both accounting_configuration_id and coding_structure_version_id

### 6. Migration-Only Persistence (D5)

- Single final migration `20260920000000_accounting_configuration_foundation`:
  - CREATE accounting_configurations (no coding_structure_version_id column, no touch coding_structure_versions per D2)
  - CREATE accounting_configuration_levels
  - ALTER accounts ADD accounting_configuration_id TEXT nullable
  - Backfill per D3 step 1: UPDATE from ACTIVE
  - Legacy Config handling per D3 step 2: WITH orphan_orgs, legacy_insert (gen_random_uuid), copy levels from coding_structure_versions active, default levels fallback
  - Backfill step 3: second UPDATE from LEGACY ACTIVE
  - SET NOT NULL
  - Indexes: uq org_code_version, idx org_status, org_code, partial unique uq org_active WHERE ACTIVE, uq config_level, idx org_config, idx accounts accounting_configuration_id
  - No DROP of self-created objects (D5), no coding_structure_versions touch (D2)
- Prisma schema source of truth, no triggers, partial unique via raw SQL
- Handles both orphan=0 (no-op legacy) and orphan>0 (creates legacy) — required because sandbox has no live DB

### 7. No Scope Creep

Only generic root + accounts sole scope NOT NULL. No posting rules, dimensions, control roles, system posting, balances, reports, tax/costing/numbering/closing, frontend, workflow, outbox/queue/redis, microservices. No transform CodingStructureVersion to state inside AccountingConfiguration (separate ADR).

## Consequences

- `AccountingConfigurationsService.createDraftWithLevels` generates only accountingConfigId (no codingVersionId)
- `requireActiveConfigurationOrThrow` throws typed `NoActiveAccountingConfigurationError` — D6 no string matching
- `AccountsService.createAccount` requires ACTIVE accounting config AND ACTIVE coding version for root (D1,D2), child inherits both, uses typed errors only, snapshot uses both ids NOT NULL, does NOT call `markOperationallyUsed` per D4 deferred
- `AccountsRepository.createChecked` locks accounting_configuration row for root, checks ACTIVE, checks both config and coding version isolation for child
- `Account` domain: `codingStructureVersionId` String NOT NULL (D2), `accountingConfigurationId` String NOT NULL (D1,D3), `planAccountPlacement` checks both
- Prisma Account model: codingStructureVersionId String NOT NULL, accountingConfigurationId String NOT NULL, both relations required
- Migration final handles both orphan cases per D3, includes legacy config creation
- Docs updated: this ADR + `docs/accounting/configuration.md` reflect NOT NULL, D4 deferred without caller, D2 untouched, D3 legacy strategy
- Tests: domain + service remain green, in-memory FK mismatch test deleted per D7, live DB test `accounting-configuration-live.e2e-spec.ts` covers NOT NULL + legacy + FK mismatch
- Future Posting task will call `markOperationallyUsed` on first Voucher finalization

## Links

- Task 11 final Round 2: D1-D7
- Orphan query R1: blocked no live DB, migration handles both cases
- Domain: `backend/src/modules/accounting/domain/accounting-configuration.ts`, `account.ts`
- Data: `backend/src/modules/accounting/data/accounting-configurations.repository.ts`, `accounts.repository.ts`, `accounting-locks.ts`, `accounting-rows.ts`
- Migration: `backend/prisma/migrations/20260920000000_accounting_configuration_foundation/migration.sql`
- Prisma: `backend/prisma/schema/accounting.prisma`
- Live DB test: `backend/test/accounting-configuration-live.e2e-spec.ts`
- Previous: ADR-0026, ADR-0024
