# Vardena Project State

## 1. Source of Truth

GitHub repository files on the merged default branch are the official project memory. Chat messages are contextual only. Agent reports are claims until verified against repository evidence; unverified information must not be presented as fact. In a conflict with chat, repository files take precedence. Conflicts between repository records must be recorded, not silently resolved.

Local unstaged changes, unmerged branches, PR descriptions alone, agent memory and historical user claims are not official history. This bootstrap is a **proposed documentation update until owner merge**; committing it on a working branch does not make it accepted project history. Workflow rules below are the bootstrap's recorded process, not a claim that previous tasks followed it. Existing architecture contracts and ADRs are preserved.

Evidence labels: **verified implementation** means inspected static code/schema, not runtime validation; **recorded** means a statement in an existing file; **UNKNOWN** means insufficient evidence. Historical test logs/reports are not fresh test results.

## 2. Repository Identity

- Repository: `MR-AliEsmaeili/Vardena`
- URL: https://github.com/MR-AliEsmaeili/Vardena (origin and `gh repo view` agree).
- Default branch: `main` (origin/HEAD and GitHub metadata agree).
- Bootstrap date: 2026-09-24 (UTC).
- Bootstrap commit (inspection baseline): `79d69e1fa2450749302a24c2688869e9378643f0`, merge of PR #33. This is the baseline, not the self-referential hash of the documentation commit; locate the latter by subject `docs: bootstrap github-centered project workflow`.
- Working branch at bootstrap: `arena/01a0d3e5-vardena`.
- Initial `git status --short` and `git status --porcelain=v1`: empty, clean; no staged, unstaged or untracked user changes.
- Local history is shallow (`git rev-parse --is-shallow-repository` = `true`); `git log` exposes only the baseline merge. Older SHAs below are recorded references, not locally revalidated ancestry.
- Initial root entries: `.env.example`, `.git/`, `.github/`, `.gitignore`, `.vardena/`, `README.md`, `backend/`, `docker-compose.yml`, `docs/`.
- No initial `STATE.md` or `docs/tasks/`. `docs/decisions/product/` and `docs/adr/` already exist. No changelog, PR template or `.gitkeep` found by tracked-name inspection; contribution/PR conventions live in `.vardena/agent-rules.md`.
- Read-only GitHub inspection: PRs #30–#33 reported MERGED; #33 merge SHA matches HEAD. No PR found for this bootstrap branch. These observations do not prove review acceptance.

### Verified architecture and module inventory

`backend/package.json` declares NestJS 12, TypeScript 6, Prisma 7, PostgreSQL adapter, ESM and Node >=22.12. `backend/src/app.module.ts` registers the nine modules below. Module folders contain API, application, domain and data layers; `backend/src/kernel/` provides technical infrastructure. REST controllers are versioned under `/api/v1` with Swagger DTOs (`backend/src/main.ts`, `backend/src/kernel/http/configure-app.ts`, module `api/` files). Module boundaries are prescribed in `.vardena/architecture-rules.md` and ADR-0001/0008; this inventory is not an exhaustive boundary audit.

React/TypeScript/Vite/Tailwind/shadcn is the fixed frontend stack (ADR-0002). Task 22 (**ACCEPTED 2026-09-26**) supplies login/session, effective-permission UX gating, organization context, an RTL shell and four read-only Accounting surfaces. Task 32 subsequently added the real-data Dashboard; PR #86 is the final corrective merged implementation and supersedes PR #85 implementation claims. The Dashboard reads bounded Accounting, Inventory and Workflow APIs but adds no administration/mutation UI or Reporting module. There is still no create/edit/finalize screen, Inventory/Workflow administration UI, RBAC-admin, Treasury, generic reporting, export or notification UI, and the frontend is not part of `docker-compose.yml`.

`backend/src/worker.ts`, `worker.module.ts`, `worker.service.ts` establish a separate worker and database startup check. Actual dispatch loops are explicitly deferred in `worker.service.ts`; a production jobs/outbox runner is **not verified**. Docker Compose defines PostgreSQL 16, migration initialization, API and worker (`docker-compose.yml`, `backend/Dockerfile`). Architecture diagrams describe more capabilities than are implemented.

In the following table, module paths are relative to `backend/src/modules/`; model lists are extracted from `backend/prisma/schema/<module>.prisma`. API resource names come from controller declarations, not inferred folder responsibilities. Tests are present, not executed here.

| Module / directory | Verified responsibility                                                                                                                                     | HTTP surface (controller resource paths)                                                                                                                                                                                                                                                                                                              | Related models                                                                                                                                                                                                                                                                                                                                                                          | Test evidence                                                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health/`          | Liveness/readiness probes                                                                                                                                   | `health`                                                                                                                                                                                                                                                                                                                                              | None                                                                                                                                                                                                                                                                                                                                                                                    | backend/test/health.e2e-spec.ts                                                                                                                                                                                         |
| `identity/`        | Login/session authentication                                                                                                                                | `auth`                                                                                                                                                                                                                                                                                                                                                | Session                                                                                                                                                                                                                                                                                                                                                                                 | backend/test/auth.e2e-spec.ts                                                                                                                                                                                           |
| `users/`           | User administration and credentials                                                                                                                         | `users`                                                                                                                                                                                                                                                                                                                                               | User                                                                                                                                                                                                                                                                                                                                                                                    | application/users.service.spec.ts; backend/test/rbac.e2e-spec.ts                                                                                                                                                        |
| `rbac/`            | Permission registry, roles and user-role evaluation                                                                                                         | `permissions`, `roles`                                                                                                                                                                                                                                                                                                                                | Permission, Role, RolePermission, UserRole                                                                                                                                                                                                                                                                                                                                              | application/authorization.guard.spec.ts; backend/test/rbac.e2e-spec.ts                                                                                                                                                  |
| `organization/`    | Organizations, branches, departments, employees and party master data                                                                                       | `branches`, `departments`, `employees`, `organizations`, `parties`                                                                                                                                                                                                                                                                                    | Organization, Branch, Department, Employee, Party                                                                                                                                                                                                                                                                                                                                       | domain/hierarchy.spec.ts; backend/test/master-data.e2e-spec.ts; backend/test/deployment-scope.e2e-spec.ts                                                                                                               |
| `inventory/`       | Item/unit/warehouse master data; movements, balances, reservations and transfers                                                                            | `inventory/balances`, `inventory/movements`, `inventory/reservations`, `inventory/transfers`, `inventory/item-groups`, `inventory/items`, `inventory/unit-conversions`, `inventory/units`, `inventory/warehouses`                                                                                                                                     | Unit, UnitConversion, ItemUnitConversion, ItemGroup, Item, Warehouse, InventoryMovement, InventoryBalance, InventoryReservation, InventoryOperation                                                                                                                                                                                                                                     | backend/test/inventory-core.e2e-spec.ts                                                                                                                                                                                 |
| `documents/`       | Document type configuration, numbering allocation and typed relations                                                                                       | `documents/relations`, `documents/types`, `documents/numbering-series`                                                                                                                                                                                                                                                                                | DocumentTypeConfig, NumberingSeries, NumberingAllocation, DocumentRelation                                                                                                                                                                                                                                                                                                              | backend/test/documents-live.e2e-spec.ts                                                                                                                                                                                 |
| `workflow/`        | Versioned definitions, states/transitions, instances, approvals and automation bindings                                                                     | `workflow`, `workflow/definitions`, `workflow/instances` (nested routes in each controller)                                                                                                                                                                                                                                                           | WorkflowDefinition, WorkflowVersion, WorkflowState, WorkflowTransition, WorkflowInstance, WorkflowTransitionHistory, WorkflowApproval, WorkflowAutomationBinding                                                                                                                                                                                                                        | backend/test/workflow-live.e2e-spec.ts                                                                                                                                                                                  |
| `accounting/`      | Fiscal scope, accounts/configurations, Base Chart templates/adoption, vouchers, posting/ledger, balance projection/reversal and bounded read-only reporting | `accounting/balances`, `accounting-configurations`, `accounting-documents`, `accounting-periods`, `accounts`, `base-chart-templates`, `base-chart-template-versions`, `accounting/adopt-base-chart`, `coding-structures`, `financial-areas`, `fiscal-years`, `accounting/account-statements`, `accounting/general-ledger`, `accounting/trial-balance` | FinancialArea, FiscalYear, AccountingPeriod, CodingStructureVersion, CodingStructureLevel, Account, AccountingConfiguration, AccountingConfigurationLevel, BaseChartTemplate, BaseChartTemplateVersion, BaseChartTemplateLevel, BaseChartTemplateNode, BaseChartAdoption, AccountingDocument, AccountingDocumentLine, AccountingPostingOperation, LedgerEntry, AccountBalanceProjection | domain/money.spec.ts; domain/document-reversal.spec.ts; Base Chart/domain service specs; backend/test/base-chart-live.e2e-spec.ts; backend/test/base-chart-api-live.e2e-spec.ts; accounting report service/domain specs |

### Database inventory

Provider: PostgreSQL (`backend/prisma/schema/base.prisma`). Prisma uses a directory schema at `backend/prisma/schema/`, migrations at `backend/prisma/migrations/`, and `DATABASE_URL` via `backend/prisma.config.ts`. There are **15 SQL migrations**, from `20260910000000_init` through `20260923000000_accounting_document_reversal`. Their presence does not prove deployment to any environment. The eight database schemas are identity, users, rbac, organization, inventory, documents, workflow and accounting; model ownership is listed above.

Important inspected constraints/fields (not an exhaustive DDL audit):

- Organization-scoped business rows carry `organizationId`; organization/code and fiscal-scope composite uniques prevent duplicates. `AccountingPeriod` is unique by `(fiscalYearId, sequence)`. Supporting indexes lead with organization and relevant area/year/status/account fields (`accounting.prisma`, `organization.prisma`, `inventory.prisma`). This is structural scope, not user-to-tenant authorization.
- Users/sessions/RBAC have user and role relations, unique session token hashes, unique permission codes/role names, and composite role-permission/user-role primary keys (`identity.prisma`, `users.prisma`, `rbac.prisma`). Roles and users have no organization-membership model in these schemas.
- Accounting documents have state, origin, fiscal scope, numbered identity, finalization stamps, source references, idempotency reference/hash, correction kind/reason and typed reversal links (`accounting.prisma`). The contract §15.1 distinguishes `draft` as a phase from business states `temporary`/`final`; the actual schema stores all three in the `state` column (default `draft`). Do not confuse domain vocabulary with storage representation (`domain/accounting-document.ts`, `accounting.prisma`). Fiscal year/period statuses are open/closed/sealed; configurations are DRAFT/ACTIVE/SUPERSEDED in their code-defined vocabularies. Many statuses are strings rather than database enums; lifecycle invariants are application/domain-enforced.
- Common mutable domain records have created/updated timestamps and actor fields; accounting adds finalizedAt/finalizedBy and correlationId; configuration has operationallyUsedAt/By. Session expiry/revocation fields differ from that convention. Do not assume every model has identical audit columns.
- `AccountingPostingOperation` uniquely keys `(organizationId, operationKey)` with operation kind, requestHash and result. Document lines are unique by document/line number; ledger entries are unique by voucher line. See `accounting.prisma` and migrations `20260915000000_accounting_documents`, `20260916000000_accounting_ledger`.
- Configuration's one-ACTIVE-per-organization partial unique index `uq_accounting_configurations_org_active` is **raw SQL**, not fully representable in Prisma (`20260920000000_accounting_configuration_foundation/migration.sql`, schema comment; historical G7 risk).
- Projection unique key is organization/area/year/period/account; supporting indexes are org/area/year, org/account, org/period. Derived balance/reconciliation views are migration SQL (`20260922000000_accounting_balance_projection/migration.sql`), not an independent ledger truth.
- Reversal has unique `reverses_document_id` and `reversed_by_document_id` and self-FKs with DELETE RESTRICT; reason/kind rules are in code, not CHECK constraints (`20260923000000_accounting_document_reversal/migration.sql`).

> **Dated correction (2026-09-26 — `docs/repository-documentation-audit.md`).** The inventory above is the bootstrap-era (2026-09-24) inspection and is superseded on two verified points by Task 19: (a) there are now **16 SQL migrations**, `20260910000000_init` through **`20260926000000_organization_membership`** (not 15 ending at the reversal migration); (b) the `organization` module additionally owns the model **`OrganizationMembership`** (`organization.organization_memberships`, composite PK `(user_id, organization_id)`, user CASCADE / organization RESTRICT) and the HTTP surface `organizations/:id/members`, and the Organization permission set is **28 codes** (25 master-data + `Organization.Membership.{View,Grant,Revoke}`). Verified totals at `d46bb4e`: 9 registered modules, 43 controllers, 8 database schemas, 47 Prisma models, 131 registered permission codes, 101 unit spec files, 31 e2e spec files. The bootstrap text is preserved above as the historical record and is not rewritten.
>
> **Dated snapshot correction (2026-09-27).** At `main` `2aae5fba99671639fec4bffeb8877d3bcad09b6a` (merge of PR #67), Task 23 added migration `20260926010000_accounting_base_chart`, five Base Chart models and three Accounting permission codes. Totals at that snapshot were **17 SQL migrations**, **46 controllers**, **52 Prisma models**, **134 registered permission codes**, **107 unit spec files**, and **34 E2E spec files**. This is a repository fact, not acceptance of Task 23 or Task 24.
>
> **Current-state correction (2026-09-29).** At audited `main` `34dddfd60d6ce2f9d4599bd05b440556a80aa847`, Task 30 brings the totals to **18 SQL migrations**, **48 controllers**, **55 Prisma models**, **142 registered permission codes**, and **113 unit spec files**; the E2E-spec count remains **34**. See §10.6 and `docs/current-state-reconciliation.md`. Merge/implementation does not imply acceptance.

- Monetary debit/credit and projection amounts use Decimal/numeric(18,2); inventory quantities use numeric(18,4) (`accounting.prisma`, `inventory.prisma`). Accounting APIs/domain use exact decimal strings and BigInt-scaled arithmetic; excessive input precision is rejected, not silently rounded (`accounting/domain/money.ts`). Multi-currency/FX behavior is not established by this storage type (OQ-03/47/48).

### Security inventory and limits

- **Verified implementation (static):** opaque random 256-bit sessions, SHA-256 token storage and Argon2id passwords (`identity/domain/session-token.service.ts`, `identity/application/auth.guard.ts`, `users/domain/password.service.ts`, paths under `backend/src/modules/`). Session model has idle/absolute expiry and revocation fields; authentication service and config control cookie/session behavior.
- **Verified implementation (static):** `rbac/application/authorization.guard.ts` fails closed for missing permission metadata; `authorization.service.ts` checks the database-backed union of flat role permissions without a permission cache. Route checks plus application-service checks exist, including reversal's `Accounting.Document.Reverse` (`accounting/api/accounting-documents.controller.ts`, `accounting/application/accounting-documents.service.ts`). Absence of a request context is explicitly treated as trusted system context by the authorization service: future non-HTTP entrypoints require review.
- **Partially verified isolation:** explicit organization parameters and scoped lookups/locked-row checks appear in Accounting repositories/services. The optional deployment pin is enforced by `organization/application/deployment-scope.guard.ts` and organization services. ADR-0025 explicitly distinguishes this from tenant authorization. (Bootstrap-era statement; **superseded on `main` by Task 19 ODR-3**, which added `organization.organization_memberships` and the principal-bound `assertOrganizationInScope` chokepoint, and by the 2026-09-26 post-merge correction, which extended the binding to membership administration itself with a single bootstrap exception — see §7/§8 and `docs/security.md` §3.) User-to-organization membership and full multi-tenant security were **not found** in the schema inspected at bootstrap; when the pin is unset, structural scoping alone is not proof of authority.
- **Sensitive operations inspected:** finalization/posting, reversal, close/reopen/seal, configuration freeze. Transactional checks, permission codes, reason requirements and audit fields/events are present; end-to-end enforcement has **not been runtime verified** in this bootstrap. Durable audit/outbox delivery is **not verified** merely because events/logs exist (`worker.service.ts`, ADR-0004/0005, `docs/task-9-implementation-report.md`).

### Testing and CI inventory

All commands below are defined in `backend/package.json` and run from `backend/`; listed commands were **not executed** during bootstrap.

| Purpose                           | Command / configuration                                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Unit                              | `npm test` (Vitest; `vitest.config.ts`, `src/**/*.spec.ts`); `npm run test:cov`                                                  |
| HTTP/E2E including opt-in live DB | `npm run test:e2e` (Vitest + Supertest; `vitest.config.e2e.ts`, `test/**/*.e2e-spec.ts`)                                         |
| Integration                       | No separately named `test:integration` script; live integration cases are in `test/*-live.e2e-spec.ts` and `test/db.e2e-spec.ts` |
| Migration fixture rehearsal       | `npm run test:migration-rehearsal`                                                                                               |
| Operational freeze rehearsal      | `npm run test:operational-freeze-rehearsal`                                                                                      |
| Quality                           | `npm run lint` (Oxlint), `npm run typecheck`, `npm run format:check` (Prettier)                                                  |
| Build                             | `npm run build` (Nest)                                                                                                           |
| DB setup                          | `npm run prisma:validate`, `npm run prisma:generate`, `npm run prisma:deploy`                                                    |

Unit config targets colocated specs. E2E defaults to an intentionally unreachable DATABASE_URL; live suites opt in with VARDENA_TEST_DATABASE_URL and a migrated database. `test/support/test-app.ts` uses the application pipeline.

`.github/workflows/ci.yml` is the only workflow found: `CI`, pushes to main and PRs targeting main. It now has **two independent jobs**. Job `backend`: Node 22/npm 11, PostgreSQL 16 service, 20-minute job timeout. Steps install, validate/generate Prisma, lint, typecheck, format-check, unit test, build, migrate, populated Task 11 migration rehearsal, E2E (shell timeout 540 seconds; step timeout 10 minutes), and failure-log upload. The operational-freeze script is available but is not a configured CI step. Job `frontend` (added by Task 22, 15-minute timeout, no database and no API process): `npm ci` in `frontend/` then `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` (Vitest + Testing Library, jsdom) and `npm run build`. It deliberately does not duplicate the backend live-DB E2E coverage.

**Required branch-protection checks: UNKNOWN — REQUIRES OWNER CONFIRMATION.** A workflow job is not proof that branch protection requires it. Historical reports cite successful CI and known warnings, but no fresh CI/test/build result was observed here. Known current failing checks: UNKNOWN (none executed). Full E2E is deliberately not run for this documentation-only task; application/integration/E2E verification is delegated to GitHub Actions during a later explicitly authorized PR. No PR is opened by bootstrap.

## 3. Documentation Structure

- `STATE.md`: consolidated current state, evidence, uncertainties, workflow and next-step gates.
- `docs/decisions/ADR-*.md`: requested location for future architecture records; **no ADR created here by bootstrap**. Existing architectural records remain canonical at `docs/adr/0001-…md` etc. Existing `.vardena/agent-rules.md` AG-07 and `docs/adr/README.md` require that legacy location. Owner must decide the future location before new ADR creation (BOOT-OQ-01); do not move, duplicate, rewrite or renumber existing ADRs.
- `docs/decisions/product/`: existing product/business decision records; not architectural ADRs.
- `docs/tasks/task-NN/brief.md`: repository-verified problem, scope, questions and acceptance basis.
- `docs/tasks/task-NN/prompt.md`: received approved implementation prompt, or explicit not-ready placeholder.
- `docs/tasks/task-NN/review.md`: evidence-based review, PR/branch/commit, findings, manual verification and final decision.
- Existing reports under `docs/task-*.md`, Accounting contracts/index under `docs/accounting/`, and the OQ registry `docs/open-questions.md` remain intact; new records link to them, not replace them.

### Existing ADR inventory (statuses transcribed, not promoted)

An accepted ADR does not establish acceptance of the task implementing it. Proposed records remain Proposed even where code exists. No ADR-0027 file was found; the missing identifier is not permission to fill or renumber it. Titles summarize decision subjects; original files hold the binding detail.

| Identifier / title                                                                                                          | Recorded status                                                                                                                                                              | Decision summary / related area or task                                                                                     | Evidence path                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| ADR-0001: Modular Monolith (Not Microservices)                                                                              | Accepted                                                                                                                                                                     | Modular monolith with hard module boundaries; all modules                                                                   | `docs/adr/0001-modular-monolith.md`                     |
| ADR-0002: Technology Stack (Fixed Set)                                                                                      | Accepted                                                                                                                                                                     | Fixed backend/frontend stack; platform                                                                                      | `docs/adr/0002-technology-stack.md`                     |
| ADR-0003: Legacy ERP Isolation via Adapter Layer                                                                            | Accepted                                                                                                                                                                     | External legacy systems isolated behind adapters; integrations                                                              | `docs/adr/0003-legacy-erp-adapter-isolation.md`         |
| ADR-0004: Outbox Pattern for External Synchronization                                                                       | Accepted                                                                                                                                                                     | Transactional outbox for external delivery; integration/worker                                                              | `docs/adr/0004-outbox-pattern.md`                       |
| ADR-0005: Domain Events for Inventory → Accounting                                                                          | Accepted                                                                                                                                                                     | Inventory-to-Accounting domain event contract; event infrastructure                                                         | `docs/adr/0005-domain-events-inventory-accounting.md`   |
| ADR-0006: RBAC with Granular Permissions                                                                                    | Accepted                                                                                                                                                                     | Granular backend RBAC; Users/RBAC                                                                                           | `docs/adr/0006-rbac-granular-permissions.md`            |
| ADR-0007: Server-Side Opaque Sessions                                                                                       | Accepted                                                                                                                                                                     | Server-side opaque sessions; Identity                                                                                       | `docs/adr/0007-server-side-sessions.md`                 |
| ADR-0008: Single Database, Schema per Module, ULIDs                                                                         | Accepted                                                                                                                                                                     | One database with module schemas and ULIDs; data layer                                                                      | `docs/adr/0008-single-database-module-schemas.md`       |
| ADR-0009: Reporting via Module Views + Scoped Raw SQL                                                                       | Accepted                                                                                                                                                                     | Module-owned views and scoped raw SQL; reporting                                                                            | `docs/adr/0009-reporting-views-raw-sql.md`              |
| ADR-0010: DB-Backed Job Queue (No External Broker in v1)                                                                    | Accepted                                                                                                                                                                     | PostgreSQL-backed queue, no external broker; worker/jobs design                                                             | `docs/adr/0010-db-backed-job-queue.md`                  |
| ADR-0011: Validated Excel Import Workflow                                                                                   | Accepted                                                                                                                                                                     | Validated staged Excel import; planned import capability                                                                    | `docs/adr/0011-excel-import-workflow.md`                |
| ADR-0012: Printing Template System                                                                                          | Accepted                                                                                                                                                                     | Templates plus module-owned print data providers; planned printing                                                          | `docs/adr/0012-print-template-system.md`                |
| ADR-0013: User Preferences as Validated Key-Value                                                                           | Accepted                                                                                                                                                                     | Validated key-value preferences; planned customization                                                                      | `docs/adr/0013-user-preference-key-value.md`            |
| ADR-0014: OpenAPI as the Single API Contract                                                                                | Accepted                                                                                                                                                                     | Generated OpenAPI from DTOs; API boundary                                                                                   | `docs/adr/0014-openapi-contract.md`                     |
| ADR-0015: Backend Foundation Conventions                                                                                    | Accepted                                                                                                                                                                     | Backend conventions for errors, correlation and infrastructure; foundation                                                  | `docs/adr/0015-backend-foundation-conventions.md`       |
| ADR-0016: RBAC Enforcement and Evaluation                                                                                   | Accepted (refines ADR-0006 — permission caching)                                                                                                                             | Route + service authorization, no permission cache; RBAC                                                                    | `docs/adr/0016-rbac-enforcement-and-evaluation.md`      |
| ADR-0017: Inventory Ledger as Source of Truth with Materialized Balances                                                    | Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21)                                                                          | Immutable movement ledger and rebuildable balances; Inventory                                                               | `docs/adr/0017-inventory-ledger-as-source-of-truth.md`  |
| ADR-0018: Bounded, Versioned Workflow Configuration (No Workflow Engine)                                                    | Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21)                                                                          | Code-bounded versioned state machines; Workflow                                                                             | `docs/adr/0018-bounded-versioned-workflow.md`           |
| ADR-0019: Document Foundation — Typed Tables, Shared Mechanics, Controlled Relations                                        | Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21)                                                                          | Typed document tables with common mechanics; Documents                                                                      | `docs/adr/0019-document-foundation-and-relations.md`    |
| ADR-0020: Organizational Scope, the Organization Module and Master-Data Ownership                                           | Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21)                                                                          | Organizational scope and master-data ownership; Organization                                                                | `docs/adr/0020-organizational-scope-and-master-data.md` |
| 0021 — Organization-scoped master data (every master-data row carries `organization_id`)                                    | Proposed                                                                                                                                                                     | Organization scope on every master row; Task 6                                                                              | `docs/adr/0021-organization-scoped-master-data.md`      |
| ADR-0022: Inventory Core — Movement Ledger, Idempotent Posting and Availability Policy                                      | Accepted (implemented by Task 9.5; idempotency hardening by Task 9.6, 2026-09-13)                                                                                            | Movement posting/idempotency and availability policy; Tasks 9.5/9.6                                                         | `docs/adr/0022-inventory-core-ledger.md`                |
| ADR-0023: Document Foundation Implementation — Type Registry, Numbering, Relations                                          | Accepted (implemented by Task 8; ADR recorded during Task 9.6 hardening, 2026-09-13)                                                                                         | Document registry/numbering/relations implementation; Tasks 8/9.6                                                           | `docs/adr/0023-document-foundation-implementation.md`   |
| ADR-0024: Workflow Foundation — Reusable Platform Capability                                                                | Accepted (implemented by Task 9, 2026-09-12)                                                                                                                                 | Reusable workflow foundation; Task 9                                                                                        | `docs/adr/0024-workflow-foundation.md`                  |
| ADR-0025: Optional Single-Organization Deployment Pin                                                                       | Accepted (implemented by Task 9.6, 2026-09-13)                                                                                                                               | Optional deployment organization pin, not tenancy; Task 9.6                                                                 | `docs/adr/0025-single-organization-deployment-pin.md`   |
| ADR-0026: Accounting Bounded Context — Module Boundary, Fiscal-Calendar Ownership and the System-Posting Contract           | Accepted (accepted 2026-09-14 — the design decision from Task 10.1, before Task 10.2 writes any Accounting schema)                                                           | Accounting boundary, fiscal ownership and posting; Task 10.1                                                                | `docs/adr/0026-accounting-bounded-context.md`           |
| ADR-0028: Accounting Configuration Foundation — Versioned Root, Single ACTIVE, Operational Freeze                           | Accepted (Final 2026-09-18 — Review Fix Round 2 per D1-D7)                                                                                                                   | Versioned configuration, single ACTIVE, operational freeze; Tasks 11/13                                                     | `docs/adr/0028-accounting-configuration-foundation.md`  |
| ADR-0029: Machine/API access model — licensed API keys on the RBAC permission model                                         | Proposed (pending product-owner ratification — not Accepted)                                                                                                                 | Proposed licensed API keys on RBAC machine principals; future API access                                                    | `docs/adr/0029-machine-api-access-model.md`             |
| ADR-0030: License foundation — minimal, non-punitive, enforcement-off                                                       | Accepted for L-01 (status transcribed from the file 2026-10-11 — CF-13); extended by ADR-0045 (L-02) and ADR-0046 (L-03)                                                     | Offline-first license foundation with enforcement off; the L-02 identity/activation and L-03 retained-version import build on it | `docs/adr/0030-license-foundation.md`                   |
| ADR-0031: Accounting Balance Projection — Rebuildable Turnover-Only Materialization                                         | Proposed (2026-09-22 — vertical slice implemented as `READY FOR REVIEW`, not Accepted)                                                                                       | Turnover-only rebuildable projection; Task 12                                                                               | `docs/adr/0031-balance-projection.md`                   |
| ADR-0032: Accounting Period Close — In-Transaction Enforcement, Gate Placement and the Reopen Exception                     | Proposed (2026-09-23 — Task 14 implemented as `READY FOR REVIEW`, not Accepted)                                                                                              | Locked in-transaction period close gate with reopen exception; Task 14                                                      | `docs/adr/0032-accounting-period-close-enforcement.md`  |
| ADR-0033: Account Identity and Account Code History — `Account.id` Is Permanent, `code` Is a Business Identifier            | Proposed (2026-09-25 — Task 17C documentation consolidation; Owner decisions Q3/Q8/Q18/Q21 + Invariant 1; not Accepted, no implementation)                                   | Account identity, code history, historical code resolution, opening identity, deletion vs deactivation                      | `docs/adr/0033-account-identity-and-code-history.md`    |
| ADR-0034: Posting Account XOR Aggregation Account — One Semantic Role per Account Node                                      | Proposed (2026-09-25 — Task 17C; Owner decision Q5 + Invariant 2; records an unresolved conflict with contract §14 rule 2 / AC-I-09 `postable ⇒ leaf`, which stays in force) | POSTING vs AGGREGATION semantics, double-counting prevention, configurable posting eligibility                              | `docs/adr/0034-posting-versus-aggregation-accounts.md`  |
| ADR-0035: Accounting Code Structure Migration — Controlled, Licensed, Audited; Never Rewrites Economic Ledger History       | Proposed (2026-09-25 — Task 17C; Owner decisions Q3/Q8/Q19/Q20 + Invariant 3; the service does NOT exist and is not authorized)                                              | Code-structure migration service, licensing/approval/reconciliation gates, level-count exclusion                            | `docs/adr/0035-account-code-structure-migration.md`     |
| ADR-0036: Legal Reporting Architecture — Accounting Core → Legal Adapter / Legal Profile                                    | Proposed (2026-09-25 — Task 17C; Owner decisions Q9/Q10/Q11/Q22; architecture only, **no legal fact decided** — OQ-43 stays OPEN)                                            | Legal profile layering, independent Journal Book / General Ledger, language and monetary unit, identity for legal reporting | `docs/adr/0036-legal-reporting-architecture.md`         |
| ADR-0037: Accounting Configuration Boundary — Base Structure, Standard Control Roles, Configurability Bounded by Invariants | Proposed (2026-09-25 — Task 17C; Owner decisions Q1/Q2/Q4/Q6/Q7/Q17; base structure and control roles are NOT in code)                                                       | Hybrid configuration model, control roles, dimensions/floating detail, configurability limits                               | `docs/adr/0037-accounting-configuration-boundary.md`    |
| ADR-0038: Installation bootstrap of the pinned deployment organization and the administrator's membership           | Proposed                                                                                                                                                                     | Bootstrap of the pinned deployment organization + administrator membership; foundation                                                                    | `docs/adr/0038-installation-bootstrap-of-the-pinned-deployment-organization.md` |
| ADR-0039: Inventory Valuation Foundation — Value on the Existing Ledger, Cost-Optional Operations, Explicit Bounded Repricing | Proposed (acceptance is the Owner's decision on the PR #116 review; an implementation agent cannot promote its own ADR)                                                       | Inventory valuation on the existing ledger, cost-optional operations, bounded repricing; Inventory                                                        | `docs/adr/0039-inventory-valuation-foundation.md`                               |
| ADR-0040: Operational document edit boundary, side-effect transparency and the negative-inventory invariant          | Proposed                                                                                                                                                                     | Edit boundary, side-effect transparency, negative-inventory invariant; Inventory business documents                                                       | `docs/adr/0040-operational-document-edit-boundary-and-side-effect-transparency.md` |
| ADR-0041: Synchronous Inventory → Accounting application contract                                                     | Accepted — Product Owner decision PO-02, 2026-10-07                                                                                                                          | Synchronous Inventory→Accounting posting contract; Inventory/Accounting                                                                                   | `docs/adr/0041-synchronous-inventory-accounting-application-contract.md`        |
| ADR-0042: One Date/Time Model — UTC Instants, Calendar Days, a Configurable Calendar                                  | Accepted for the BusinessDate/Instant foundation; the organization-selectable calendar is superseded by ADR-0044                                                                 | UTC instants, calendar days, BusinessDate vs Instant; platform                                                                                            | `docs/adr/0042-datetime-calendar-architecture.md`                               |
| ADR-0043: Acyclic Organization–Inventory Calendar-Transition Coordination                                              | Superseded by ADR-0044                                                                                                                                                       | Superseded transition-coordination design; platform                                                                                                       | `docs/adr/0043-acyclic-organization-inventory-calendar-transition.md`           |
| ADR-0044: Fixed Jalali-First BusinessDate Presentation in the MVP                                                     | Accepted (PO-02, 2026-10-10)                                                                                                                                                 | Fixed Jalali-first presentation with only the organization IANA zone configurable; platform                                                               | `docs/adr/0044-fixed-jalali-first-businessdate-policy.md`                       |
| ADR-0045: Persistent installation identity and local license activation                                               | Accepted for L-02 (extends ADR-0030; renumbered from the licensing record that shared number 0036 — CF-14)                                                                    | Installation identity, signed license codes, activation endpoint, `persistent` provider; licensing                                                        | `docs/adr/0045-installation-identity-and-license-activation.md`                 |
| ADR-0046: Signed license documents, retained license versions and deterministic effective-version resolution            | Accepted for the first licensing implementation slice (extends ADR-0030/ADR-0045); Decisions 4/5/11 corrected 2026-10-11 (Product-Owner review of PR #137)                    | Signed file exchange, retained versions, replay-safe import, per-installation import lock, two-instant supersession, effective-version resolution; licensing   | `docs/adr/0046-signed-license-documents-and-version-lifecycle.md`               |

## 4. Roles and Responsibilities

### ChatGPT

Reads from GitHub; performs architecture/domain analysis; prepares task prompts; reviews PRs using repository evidence; produces review decisions and corrective prompts. Does not write directly to GitHub.

### Arena Agent

Reads from GitHub; implements authorized tasks on an independent working branch; stores the received prompt in the task directory; updates task documentation; adds and runs tests; commits implementation/documentation; opens a PR when authorized. **Bootstrap exception:** documentation only, no implementation, production tests or PR. This session stays on `arena/01a0d3e5-vardena`; existing AG-02 branch-name examples are not a reason to switch branches.

### GitHub Actions

Runs configured checks after PR creation/updates; provides automated verification evidence. It does not replace human or architectural review.

### Repository Owner

Supplies the prompt to Arena Agent; resolves Open Questions; performs required manual behavioral verification; merges an accepted PR only if verification succeeds; remains final decision-maker.

### Repository-centered handoffs

Before implementation, ChatGPT reads STATE.md, relevant task files and ADRs from GitHub and prepares the prompt. Arena records that prompt before implementation, reads the repository documentation, works on the independent branch, updates documentation, adds/executes tests and opens an authorized PR.

For review, provide ChatGPT the PR URL, branch and exact commit. ChatGPT reads the PR description, **full diff**, changed files, tests, migrations, CI results, related documentation, ADRs and STATE.md directly from GitHub. Descriptions/reports alone are not proof. The outcome is ACCEPTED or CHANGES REQUIRED; a changes-required decision includes a corrective prompt recorded by Arena.

After acceptance, the owner performs/confirms manual behavioral verification and merges only if it succeeds. Record the final review and update STATE.md after merge, then start the next task. The lifecycle below includes manual verification before the final decision; the owner must still confirm it for the exact accepted revision before merge. Any intervening code change requires appropriate re-verification.

## 5. Official Task Lifecycle

1. Kick-off
2. Repository inspection
3. Open Questions
4. Owner decisions
5. Brief documentation
6. Prompt documentation
7. Implementation on an independent branch
8. Automated CI verification
9. Pull Request review
10. Corrective iteration, if required
11. Manual behavioral verification
12. ACCEPTED or CHANGES REQUIRED decision
13. Merge by repository owner
14. Final documentation and STATE.md update
15. Next task kickoff

## 6. Review Status Rules

The only official review outcomes are **ACCEPTED** and **CHANGES REQUIRED**. READY FOR REVIEW is not acceptance; green CI is insufficient; an agent report is not proof. **ACCEPTED WITH FOLLOW-UP must not be used as a review outcome.** Non-blocking follow-ups may be recorded separately only after a valid ACCEPTED decision. Blocking defects require CHANGES REQUIRED. Merge, implementation progress and review outcome are distinct fields.

Historical nonconforming labels remain quoted as evidence, never silently normalized. This bootstrap performs no implementation acceptance/rejection and changes no existing task or ADR decision.

## 7. Task History

This is a bounded inventory of verified references, not a reconstructed complete history. UNKNOWN review means no independently established final decision in this inspection; it does not negate historical claims. Unless shown, PR/commit is NOT YET DOCUMENTED. `docs/accounting/task-index.md` §2 is the recorded merged-task evidence for 10.1–10.8; source/migrations confirm the capabilities exist at baseline. Acceptance phrases in implementation reports alone are not promoted to new review decisions.

| Task | Title / evidence                                                                                                                                                                                                     | Implementation / merge evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Review status / uncertainty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Recorded PR or commit                                                                                                                                                                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–4  | Individually NOT YET DOCUMENTED in inspected task records; `.vardena/project-context.md` collectively says Tasks 1–11 backend implemented                                                                            | Backend foundation exists; exact numbered scopes UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | UNKNOWN                                                                                                                                                                                                                                                                                                                                                          |
| 5    | Ownership/design reference in `docs/task-6-implementation-report.md` §Task 5 conflicts                                                                                                                               | Referenced design; exact formal brief/title NOT YET DOCUMENTED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | UNKNOWN                                                                                                                                                                                                                                                                                                                                                          |
| 6    | Organization & Master Data Foundation; `docs/task-6-implementation-report.md`, ADR-0021                                                                                                                              | Models/services/migrations present in organization/inventory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | UNKNOWN; report is implementation evidence, ADR-0021 Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Report base `d22419a`                                                                                                                                                                                                                                                                                                                                            |
| 7    | NOT YET DOCUMENTED as a distinct task in inspected records                                                                                                                                                           | UNKNOWN; collective Tasks 1–11 claim is insufficient to assign scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | UNKNOWN                                                                                                                                                                                                                                                                                                                                                          |
| 8    | Document Foundation; ADR-0023                                                                                                                                                                                        | Documents module/schema present; ADR explicitly attributes implementation to Task 8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | UNKNOWN; accepted ADR is not task acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | NOT YET DOCUMENTED                                                                                                                                                                                                                                                                                                                                               |
| 9    | Workflow Foundation; `docs/task-9-implementation-report.md`, ADR-0024                                                                                                                                                | Workflow module/schema/migration present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Report base `1bc0327`                                                                                                                                                                                                                                                                                                                                            |
| 9.5  | Inventory Core; ADR-0022                                                                                                                                                                                             | Ledger/balances/posting attributed to Task 9.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | NOT YET DOCUMENTED                                                                                                                                                                                                                                                                                                                                               |
| 9.6  | Idempotency/isolation hardening; ADR-0022/0023/0025                                                                                                                                                                  | Hardened operations and deployment pin present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | NOT YET DOCUMENTED                                                                                                                                                                                                                                                                                                                                               |
| 10.1 | Accounting Domain Contract; `docs/accounting/domain-contract.md`, ADR-0026                                                                                                                                           | MERGED (recorded index); documentation only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Task review UNKNOWN; ADR explicitly Accepted separately                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #15, #16                                                                                                                                                                                                                                                                                                                                                         |
| 10.2 | Financial area/year/period foundation; index §2; migration `20260914000000_accounting_foundation`                                                                                                                    | MERGED (recorded index), code present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #17                                                                                                                                                                                                                                                                                                                                                              |
| 10.3 | Coding structures/chart; index §2; migration `20260914010000_accounting_coding_structure_accounts`                                                                                                                   | MERGED (recorded index), code present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #18                                                                                                                                                                                                                                                                                                                                                              |
| 10.4 | Voucher foundation; `docs/task-10.4-implementation-report.md`                                                                                                                                                        | MERGED (recorded index), document schema/code present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | UNKNOWN; later report calls it accepted, not re-adjudicated here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #19; `51f0bcc`                                                                                                                                                                                                                                                                                                                                                   |
| 10.5 | Posting readiness; `docs/task-10.5-implementation-report.md`                                                                                                                                                         | MERGED (recorded index); readiness domain/service present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #20                                                                                                                                                                                                                                                                                                                                                              |
| 10.6 | Posting/ledger contracts; index §2; `accounting/domain/posting.ts`, `ledger-entry.ts`                                                                                                                                | MERGED (recorded index); pure contracts present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | UNKNOWN; later report calls it accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #21                                                                                                                                                                                                                                                                                                                                                              |
| 10.7 | Atomic ledger materialization; `docs/task-10.7-implementation-report.md`                                                                                                                                             | MERGED (recorded index); ledger migration/repository present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | UNKNOWN; later report calls it accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #22; `6946ea6e3892f1408212f7b6e215fbf9164f675a` recorded in 10.8 report                                                                                                                                                                                                                                                                                          |
| 10.8 | Posting orchestration; `docs/task-10.8-implementation-report.md`                                                                                                                                                     | MERGED (recorded index); PostingService present                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #23                                                                                                                                                                                                                                                                                                                                                              |
| 10.9 | Intentionally skipped / not defined; index §6                                                                                                                                                                        | NOT DOCUMENTED as an authorized task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | None recorded                                                                                                                                                                                                                                                                                                                                                    |
| 11   | Accounting Configuration Foundation; index §2/§6; `docs/task-11-{implementation,final-verification,defect-resolution}-report.md`                                                                                     | Code/migration present; merged references and remediation history in index/reports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Recorded ACCEPTED 2026-09-22 in authoritative task index**, not a new bootstrap decision; older READY FOR REVIEW records preserved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | #25, #27, #28, #29; defect-resolution head `bb0335b`                                                                                                                                                                                                                                                                                                             |
| 12   | Balance Projection; `docs/task-12-{implementation,remediation}-report.md`, `docs/task-12-final-review-fa.md`, index §6/§8                                                                                            | Code/migration present; #30 MERGED observed via GitHub; no acceptance inferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **UNKNOWN — REQUIRES OWNER CONFIRMATION:** index quotes legacy “ACCEPTED WITH FOLLOW-UP”; reports retain READY FOR REVIEW/CHANGES REQUIRED; ADR-0031 Proposed. P1 real-PG concurrency remains recorded open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | #30; `a62a13d`, `264a395`; merge `1ce8d78c91a463d921568733803bf95e18ab6b24`                                                                                                                                                                                                                                                                                      |
| 13   | Operational Freeze; `docs/task-13-implementation-report.md`; OQ-64 resolved in `docs/open-questions.md`                                                                                                              | Marker wired in repository; #31 MERGED observed; Task 14 report records #31 merge as baseline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Recorded IN PROGRESS/self-review/READY FOR REVIEW, NOT Accepted; final decision UNKNOWN                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | #31; merge `2ea11609170f7fd52916068603b02955cae819a2`                                                                                                                                                                                                                                                                                                            |
| 14   | Period Close Foundation; `docs/task-14-implementation-report.md`, ADR-0032                                                                                                                                           | Gate/locked-row checks and live test suite present; #32 MERGED observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Recorded READY FOR REVIEW — NOT ACCEPTED; final decision UNKNOWN; ADR Proposed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | #32; change `31442cf`; merge `ce223fb25001a6feed3b4f428ac69c1f3af4a955`                                                                                                                                                                                                                                                                                          |
| 15   | Accounting reversal foundation; `backend/prisma/migrations/20260923000000_accounting_document_reversal/migration.sql`, `accounting/domain/document-reversal.ts`, service/repository, reversal tests                  | Implementation present; baseline commit explicitly merges #33; GitHub confirms title/merge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | UNKNOWN; no dedicated Task 15 brief/review/report found in docs; stale no-reversal comments persist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | #33; baseline `79d69e1fa2450749302a24c2688869e9378643f0`                                                                                                                                                                                                                                                                                                         |
| 16   | Task 16 contract finalization; `docs/tasks/task-16/brief.md`, `decision-reconciliation.md`                                                                                                                           | **Contract formalized 2026-09-24; no production implementation** — Owner Direction Established; Accounting Foundations Existing                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Contract finalization: READY FOR REVIEW. Implementation authorization: BLOCKED — OWNER CONFIRMATION REQUIRED.** Not implemented, accepted or production-ready; one concrete document/amount authority gate remains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | No implementation PR/branch/commit established                                                                                                                                                                                                                                                                                                                   |
| 17   | Accounting Reporting Foundation; `docs/tasks/task-17/brief.md`, `prompt.md`; Accounting task index §2/§4                                                                                                             | **Task definition formalized 2026-09-24; no production implementation** — bounded Accounting-owned reporting inputs only                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Documentation task: READY FOR REVIEW. Implementation: FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS (OQ-25/OQ-43).** Not implemented, accepted or production-ready; Task 12 P1 remains separate and Task 14 is not treated as accepted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Documentation-only work on `arena/01a0d451-vardena`; implementation PR/commit NOT YET DOCUMENTED                                                                                                                                                                                                                                                                 |
| 17A  | Bounded first slice of Task 17 — Accounting Ledger Movement Read Source; `docs/tasks/task-17/task-17a-implementation-report.md`, `docs/tasks/task-17/task-17a-acceptance-record.md`                                  | Implementation present on `main` (PR #39 merged in `130fab9`): `domain/ledger-movement.ts`, `LedgerMovementsService`, read-only `listMovements`, `GET /api/v1/accounting/ledger-movements`, `Accounting.LedgerMovement.View`; **no schema, migration, index, aggregation or report definition**                                                                                                                                                                                                                                                                                                     | **ACCEPTED (2026-09-25)** by explicit Owner Decision. Scope: Accounting-owned read-only ledger movement source over `accounting.ledger_entries`, `GET /api/v1/accounting/ledger-movements`, `Accounting.LedgerMovement.View`, org isolation, bounded pagination, allow-listed sorting, exact Decimal strings. **Does NOT close OQ-25/OQ-43 or complete Task 17**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | PR **#39** merged in `130fab9`; CI run `36048743757` green                                                                                                                                                                                                                                                                                                       |
| 17B  | Bounded second slice of Task 17 — Account Statement read surface; `docs/tasks/task-17/task-17b-{prompt,implementation-report,acceptance-record}.md` (Owner decisions D1–D7)                                          | Implementation present on `main` (PR #43 merged in `b10e007`): `domain/account-statement.ts`, `AccountStatementsService`, read-only `AccountStatementsRepository`, `GET /api/v1/accounting/account-statements`, `Accounting.AccountStatement.View` (36th code); **no schema, migration, index, aggregation platform or report definition**                                                                                                                                                                                                                                                          | **ACCEPTED (2026-09-25)** by explicit Owner/Reviewer Decision (PR #43 reviewed before merge). Scope: bounded read-only account statement (one account + one fiscal year + optional period; debit-positive net; intra-year sequence-based opening, no carry-forward; Debit/Credit/Net only — no classification or account nature; fixed statement order; OPEN/CLOSED/SEALED readable and never mutated; org-first 404/422 scope matrix; no new per-user financial-area authorization). **Does NOT close OQ-25/OQ-43 or complete Task 17**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | PR **#43** merged in `b10e007` (merged head `1ec996e`; implementation commit `9ee46f7`); CI run `36074225037` green incl. the live-PostgreSQL suite                                                                                                                                                                                                              |
| 17C  | Accounting Decision Consolidation (documentation only); `docs/accounting/owner-decision-baseline.md`, `docs/tasks/task-17/task-17c-prompt.md`, ADR-0033…0037, `docs/accounting/domain-contract.md` §31               | **No production implementation** — documentation consolidation on `arena/01a0d7c4-vardena` (base `b10e007`, merge of PR #43; **synchronized with `main` @ `2892189`, the merge of PR #44**): Owner decisions Q1–Q22 + invariants I-1…I-3 recorded, reconciled against `main`, 13 discrepancies and 12 open implementation details registered; five ADRs created **Proposed**; OQ-25/OQ-43 annotated (still OPEN); `docs/adr/README.md`, contract §31, task index §2/§4/§5/§9 and `STATE.md` §3/§7/§8/§9/§10 synchronized                                                                            | **ACCEPTED (2026-09-25)** — documentation-only governance acceptance recorded by the **Task 17C Acceptance Sync** (acceptance record: `docs/tasks/task-17/task-17c-acceptance-record.md`). The acceptance accepts the owner decision consolidation — Q1–Q22 + invariants I-1…I-3, with discrepancies D-1…D-13 and open items O-1…O-12 preserved exactly as recorded — as authoritative, synchronizes the governance documentation, and confirms that the ADR proposals accurately reflect those decisions; **ADR-0033…0037 remain Proposed** (task acceptance ≠ ADR acceptance; each ADR remains pending its separate adoption/implementation gate). No code, API, DTO, schema, Prisma, migration, seed, permission, report, UI, dependency or behaviour change; Task 17B's implementation untouched; no ADR status promoted by the acceptance; Task 17 remains **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS** and is **NOT complete** (OQ-25/OQ-43 remain OPEN — acceptance resolves neither); no legal/statutory claim. Task 17B's status is preserved exactly as **PR #44** established it on `main` — **ACCEPTED (2026-09-25)** (PR #43 merged in `b10e007`, merged head `1ec996e`; `docs/tasks/task-17/task-17b-acceptance-record.md`) — and that acceptance authorized **no** future Task 17 slice, including 17C (Task 17C was authorized separately by the Owner's Task 17C prompt); the recorded discrepancy **D-8** is RESOLVED by the PR #44 merge (`2892189`), not by any status promotion here | Consolidation PR **#45** merged in `2565254` (work on `arena/01a0d7c4-vardena`); documentary correction PR **#48** merged in `7f8e3e8`; acceptance sync on `arena/01a0d8c0-vardena`; no implementation PR/commit                                                                                                                                                 |
| 18   | Accounting Reporting Read Foundation; `docs/tasks/task-18/task-18-implementation-report.md`, `docs/tasks/task-18/task-18-acceptance-record.md`                                                                       | Task 18 Owner Decisions D1–D20 implemented on `arena/01a0d841-vardena` and **MERGED into `main`** via PR **#46** in `e774a1c37c921ba83e4e9c23729fde6205cedb76` (reviewed implementation head `5971bed`; review-fix commits `4182346`/`0d9cf76`): shared `AccountingReadQueryRepository`; read-only Account Statement extension, General Ledger and Trial Balance controllers/services/DTOs; independent report permissions; no schema/migration/report persistence; D5 resolved Ledger-native — `accounting.ledger_entries` is authoritative and the Task 12 projection is derived/rebuildable only | **ACCEPTED (2026-09-25)** — reviewed by the Repository Owner/Reviewer before merge and formally accepted. The final review-fix addressed the D5 source-of-truth/reconciliation point: `accounting.ledger_entries` is the authoritative financial source, the Task 12 projection is a materialized turnover-only derived/rebuildable read optimization, Task 18 remains Ledger-native, introduces no second monetary source of truth and does not depend on the projection at runtime for financial truth; a focused Trial Balance reconciliation assertion verifies opening, turnover, period net and closing against the authoritative Ledger source. Evidence: focused D5 reconciliation **2 passed**; accounting unit suite **43 files / 538 tests**; full backend unit suite **97 files / 1,100 tests**; typecheck, build, format and `git diff --check` passed; lint 0 errors with 6 pre-existing unrelated warnings (**not** Task 18 failures); CI run **36133360887** on head `5971bed` `backend` completed success (Prisma validation, lint, typecheck, format, unit tests, build, migration rehearsal, live-PostgreSQL E2E) and predates the documentation/test-only review-fix commits. Task 18 was implemented against the approved D1–D20 baseline and acceptance closes none of the out-of-scope capabilities. **OQ-25/OQ-43 remain OPEN**; Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED and NOT complete; no ADR promoted                                                                         | PR **#46** **MERGED** in `e774a1c37c921ba83e4e9c23729fde6205cedb76` (implementation commits `d986c78`, `9b784f0`, `5971bed`; review-fix `4182346`, `0d9cf76`); verified CI run **36133360887** (`backend`) completed successfully on the reviewed implementation head `5971bed`; implementation = **MERGED**, Task governance status = **ACCEPTED (2026-09-25)** |
| 19   | Task 19 — Accounting Chart / Configuration Foundation; `docs/tasks/task-19/task-19-implementation-gate.md`, `docs/tasks/task-19/task-19-implementation-report.md`, `docs/tasks/task-19/task-19-acceptance-record.md` | Implementation present on `main`: PR **#54** implemented ODR-1 Explicit Configuration Coherence, ODR-2 Accounting-owned Chart Tree and ODR-3 Principal-bound Organization Authorization; PR **#55** corrected the ODR-3 membership-administration boundary without changing ODR-1/ODR-2                                                                                                                                                                                                                                                                                                             | **ACCEPTED (2026-09-26)** under Owner-authorized Acceptance Sync after final repository review. ODR-1 rejects divergent code-shape pins without silent winner/fallback and does not repair existing divergent rows; ODR-2 is the bounded organization-scoped Chart Tree read surface with inactive accounts readable and `isPostable` authoritative; ODR-3 is membership-bound organization authorization through `assertOrganizationInScope`, including the bounded first-grant bootstrap exception only for an empty organization. OQ-25/OQ-43/OQ-62/OQ-63/OQ-01/OQ-22 remain OPEN; OQ-19 remains OPEN where referenced for bootstrap provisioning; ADR-0033…0037 remain Proposed; Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED and NOT complete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | PR **#54** merged in `f15325184023ff0c7e9d34727834da19f4350eda`; PR **#55** merged in `6a69bc6c17bf0dfb69a15adc3e3203ae6098d871`; final CI run **`36238862315`** success; acceptance record `docs/tasks/task-19/task-19-acceptance-record.md`                                                                                                                    |

| 20 | Task 20 — Accounting Chart Semantics & Master Structure (Investigation, Decision Resolution + Gate); `docs/tasks/task-20/accounting-chart-semantics-investigation.md`, `docs/tasks/task-20/task-20-implementation-gate.md`, `docs/tasks/task-20/task-20-acceptance-record.md` | **No production implementation** — documentation/investigation plus Owner decision resolution only. Merged decision-resolution work: PR **#58** (`10797e1400fda6329ca481877f9bbf9eff850fcd`). The six authoritative decisions remain exactly recorded: Base Chart mechanism/adoption; consumer-first control roles; independent effective-dated mapping rather than `Account.control_role`; producer-bound code history with controlled pre-use correction and post-use immutability; leaf-only POSTING/read-time AGGREGATION; and transaction-line analytical dimensions. | **ACCEPTED (2026-09-26)** under Owner-authorized Formal Acceptance Sync. Documentation-only acceptance: no production code, TypeScript, Prisma schema, migration, SQL, API, DTO, permission, authorization behavior, dependency, UI, or production test changed. Task 19 (ODR-1/ODR-2/ODR-3) remains **ACCEPTED and unchanged**. **OQ-25/OQ-41 remain OPEN** where applicable; OQ-43/OQ-62/OQ-63/OQ-01/OQ-22 and unrelated OQs remain OPEN; ADR-0033…0037 remain Proposed and are not accepted by this task. | PR **#58** merged in `10797e1400fda6329ca481877f9bbf9eff850fcd`; acceptance record `docs/tasks/task-20/task-20-acceptance-record.md` |

| 21 | Task 21 — Base Chart Governance & OQ-25 Resolution; `docs/tasks/task-21/*` | **No production implementation** — documentation-only governance baseline; Owner acceptance ratifies the proposed governance without inventing Base Chart content | **ACCEPTED (2026-09-26)** by explicit Repository Owner decision after final static review PASS. OQ-25 remains OPEN and substantially narrowed; no ADR promoted; Task 19/20 unchanged; OQ-41/OQ-43 remain OPEN; no implementation authorization is created by this acceptance | Acceptance record: `docs/tasks/task-21/task-21-acceptance-record.md` |
| 22 | Task 22 — Frontend Vertical Slice (Login → Session → RTL Shell → Organization Context → Accounting Read Surfaces); `frontend/README.md`, `docs/architecture.md` §6/§7 | **First frontend implementation in the repository.** New `frontend/` Vite + React 19 + TypeScript SPA on the ADR-0002 stack (React Router, TanStack Query, Axios, React Hook Form + Zod, TanStack Table, Tailwind v4, shadcn/ui-style primitives, Day.js). Implements: single Axios instance with the `{code,message,details?,correlationId}` error envelope normalization and cookie session transport (ADR-0007); login/logout/protected routes/expired-session handling against the real Identity endpoints; effective-permission UX gating (AR-21, no wildcards); organization context from `GET /api/v1/organizations` following ADR-0025 (single effective organization ⇒ no switcher, several ⇒ switcher, selection in memory only); responsive RTL shell; and the four read-only Accounting surfaces — chart tree, account statement, general ledger, trial balance — with server-side filtering/paging/allow-listed sorting and exact decimal strings rendered without any frontend arithmetic. API types are generated from the OpenAPI document (ADR-0014) into `frontend/src/api/generated/vardena-api.d.ts`. CI gains a parallel `frontend` job. **No Backend production behavior changed** — no backend source, DTO, permission, schema, migration or endpoint was modified | **ACCEPTED (2026-09-26)** under Owner-authorized formal acceptance synchronization; Arena Agent did not self-accept. Local verification on the implementation head: `npm ci` (frontend) OK, `npm run lint` 0 warnings/0 errors, `npm run typecheck` clean, `npm run format:check` clean, `npm test` **11 files / 63 tests passed**, `npm run build` OK (chunked bundle, no warnings); backend `npm run build` OK and `git status` clean of backend changes. Live-database backend E2E was not run locally (delegated to the backend CI job, unchanged). No ADR promoted, no OQ closed; OQ-02 (UI language/Jalali) remains OPEN and is the reason all strings live in one dictionary and dates are displayed exactly as the API returns them; Tasks 19/20 untouched | Branch `arena/01a0ded9-vardena` (branched from `71f430c`); PR **#62**; head `772bdbb`; final CI run **36263398518** — `frontend` job **success** and `backend` job **success** (backend job unchanged, incl. live-PostgreSQL E2E); implementation report `docs/tasks/task-22/task-22-implementation-report.md` |
| Bootstrap System Administrator (unnumbered) | Real initial administrator provisioning; `docs/tasks/bootstrap-system-administrator/implementation-report.md` | **IMPLEMENTATION MERGED.** Idempotent post-migration command creates/uses the ordinary Users record and `System Administrator` role, reconciles current permission codes through ordinary RBAC rows, and is invoked by Compose/CI. Existing Identity, Argon2id, RBAC and ODR-3 membership remain authoritative; no schema/migration/endpoint/wildcard/role-name bypass/organization bypass or bootstrap organization | **READY FOR REVIEW — NOT ACCEPTED.** CI is green, but no explicit Repository Owner acceptance record exists. Forced-password-change capability is not implemented; OQ-14 remains OPEN for occupational-role baselines and OQ-19 remains OPEN for administrator-safety/lockout protection | PR **#64** **MERGED** in `21306e53fd8e4c0c8db82338a2be75d3b8477eff`; implementation head `96e6b622c33db57e9289e6caf8b2cbb0a35af2c0`; PR-head checks run **`36271122971`** backend/frontend success (implementation report records earlier run `36269856402`) |
| 23 | Task 23 — Base Chart Template + Explicit Organization Adoption; `docs/tasks/task-23/*` | **IMPLEMENTATION MERGED.** Versioned Accounting-owned Base Chart template/adoption mechanism with PostgreSQL integration and live HTTP E2E coverage. The task supplies no accounting content. Invariants preserved: **Template identity ≠ Ledger identity; Adoption = Copy; Posting = Leaf-only; Aggregation = Reporting/read-time.** | **READY FOR REVIEW — NOT ACCEPTED.** No explicit Repository Owner acceptance record exists. OQ-25/OQ-36/OQ-41/OQ-43 remain OPEN; no Base Chart content, control-role policy, or OQ closure is implied | PR **#66** **MERGED** in `7754aaa2c96766963d4619f484ae4e20f10c711a`; head `23700d03409862f574730fa2096ab00dc47de1de`; PR-head checks run **`36298005115`** backend/frontend success; implementation report `docs/tasks/task-23/task-23-implementation-report.md` |
| 24 | Task 24 — Account Management / Organization Authorization correction (R-2); `docs/tasks/task-24/*` | **IMPLEMENTATION MERGED.** R-2 reuses the existing principal-bound organization-scope chokepoint for every `GET /api/v1/accounts` list path; cross-organization regression coverage exists. No lifecycle policy, Base Chart upgrade policy, Control Role/Dimension policy, or Accounting posting behavior changed | **READY FOR REVIEW — NOT ACCEPTED.** No explicit Repository Owner acceptance record exists; the merge/green CI and the R-2 scope decision do not constitute task acceptance | PR **#67** **MERGED** in `2aae5fba99671639fec4bffeb8877d3bcad09b6a`; latest pre-merge head `1947d8388be2a4424b5300c2f83b611a0ffbcc72`; implementation CI run **`36306140879`** green and PR-head checks run **`36306360274`** backend/frontend success; implementation report `docs/tasks/task-24/task-24-implementation-report.md` |
| 25 | Task 25 — Main-Based Governance Closure; `docs/tasks/task-25/*` | **NO PRODUCTION CAPABILITY.** Evidence-based audit of `main` @ **`80944ce112dc16fd834585f8a4c2d83906547480`** (merge of PR #69; baseline CI run `36323517204` success): capability inventory, task/ADR/OQ reconciliation, documentation drift, security audit, MVP-scope verification. Seven artifacts plus this STATE synchronization. The only production edit is **comment-only** in `backend/src/modules/organization/domain/organization-permissions.ts` (+17/−7, one doc-comment block), correcting the pre-PR-#55 membership-authorization wording with zero behavioural change. No schema, migration, API, DTO, permission, guard, dependency, test or frontend change | **READY FOR REVIEW — NOT ACCEPTED.** No ADR promoted, no OQ closed, no task accepted, no architecture reopened. 22 findings (10 drift items: 1 CRITICAL, 2 HIGH, 2 MEDIUM, 2 LOW, 3 INFORMATIONAL; 12 unresolved items), **10 Owner decisions D-01…D-10 all PENDING**, **1 blocking finding (SEC-01)**. Recommended next gate: **ODR-3 list-scope completion — OWNER DECISION REQUIRED → IMPLEMENTATION REQUIRED** | Branch `arena/01a0e32b-vardena`; PR **#70**; CI run `36325486898` (backend + frontend success); audit report `docs/tasks/task-25/main-based-governance-audit-report.md`; implementation report `docs/tasks/task-25/implementation-report.md` |
| 26 | Task 26 — Complete ODR-3 Organization Read Scope & Bootstrap Organization Membership; `docs/tasks/task-26/*`, `docs/task-26-default-system-administrator-report.md` | **SECURITY REMEDIATION MERGED.** Remediated Task 25 SEC-01 across all 37 organization-scoped read surfaces (28 list + 9 detail methods across Accounting, Documents, Inventory, Organization, Workflow) by enforcing `OrganizationsService.assertOrganizationInScope` following `requireAllPermissions`. Follow-up (PR #72) completed default system administrator organization membership by provisioning the ADR-0025 pinned organization on install and granting `مدیر` ordinary ODR-3 membership (ADR-0038 Proposed). Zero schema changes, 0 migrations, 0 new permissions | **READY FOR REVIEW — NOT ACCEPTED.** All 37 surfaces verified in code and tests (`organization-read-scope-completion.spec.ts`, 38 tests PASS). Permission-first ordering verified. Global `APP_GUARD` confirmed active | PR **#71** merged in `e7fe80d04620170733ad9672d991ffd576607a5a` (CI run `36337732631` success); PR **#72** merged in `cb521f4ba2662f4a4cdac7864cf0c712b6bba816` (CI run `36340161605` success); reports: `docs/tasks/task-26/task-26-implementation-report.md`, `docs/task-26-default-system-administrator-report.md` |
| 27 | Task 27 — Main Governance Reconciliation & MVP Gate; `docs/tasks/task-27/*` | **GOVERNANCE & DOCUMENTATION RECONCILIATION ONLY.** Comprehensive post-Task-26 main-based reconciliation audit of `main` @ `cb521f4ba2662f4a4cdac7864cf0c712b6bba816`: verified 37/37 read surfaces, permission-first ordering, global guard, Base Chart mechanism vs content separation, ADR/OQ alignment, MVP boundaries (Treasury/Purchasing out of MVP), capability matrix, documentation drift resolution, Owner Decision Pack (OD-27-01..04), and next implementation gate analysis. Zero production code, schema, migration, permission, guard, or architecture changes | **READY FOR REVIEW — NOT ACCEPTED.** Baseline inventory verified: 9 modules · 46 controllers · 52 Prisma models · 8 database schemas · 17 migrations · 134 permission codes · 108 backend unit spec files (1,267 tests) · 34 E2E spec files · 11 frontend test files · 37 ADR files (22 Accepted, 15 Proposed) · OQ-01…OQ-63 OPEN, OQ-64 RESOLVED | PR **#73** **MERGED** in `ff4b9f24d1c3797712c88fcd61432c3c315dbf4f`; CI run `36341552469` success; reports: `docs/tasks/task-27/main-based-reconciliation-report.md`, `task-acceptance-matrix.md`, `adr-reconciliation.md`, `oq-reconciliation.md`, `documentation-drift-report.md`, `owner-decision-pack.md`, `implementation-report.md` |
| 28 | Task 28 — Owner Decision Closure & MVP Implementation Selection Gate; `docs/tasks/task-28/*` | **GOVERNANCE & IMPLEMENTATION SELECTION GATE ONLY.** Reconciled Owner Decisions OD-27-01..04 and OQ-25 / Base Chart invariants. Verified 0 Base Chart content rows in DB; audited MVP capability readiness matrix; formulated next implementation gate across 4 candidate tracks; confirmed Treasury and Purchasing remain strictly OUT OF MVP. Zero production code, schema, migration, permission, guard, or architecture changes | **READY FOR REVIEW — NOT ACCEPTED.** Implementation gate status: `IMPLEMENTATION BLOCKED — OWNER DECISION REQUIRED`. **Follow-up (2026-09-27): OD-27-02 recorded DECIDED by explicit Owner Decision — the MVP requires the Base Chart mechanism but does NOT require a concrete Base Chart content set** (mechanism/capability = MVP; concrete content = not MVP-required; no content may be introduced by implementation inference without a separately approved content artifact; Task 23 and Task 21 unchanged; OQ-25 stays OPEN for all content-level decisions; OD-27-01/03/04 remain PENDING; no implementation authorized). Baseline inventory verified: 9 modules · 46 controllers · 52 Prisma models · 8 database schemas · 17 migrations · 134 permission codes · 108 backend unit spec files (1,267 tests) · 34 E2E spec files · 11 frontend test files · 37 ADR files (22 Accepted, 15 Proposed) · OQ-01…OQ-63 OPEN, OQ-64 RESOLVED | PR **#74** merged in `93e0bfa`; 2026-09-27 follow-up PR **#75** merged in `862c85da7aa1fb86cb16d53341fcfd9c39dfa50a`; reports: `docs/tasks/task-28/*` |
| 29 | Task 29 — VARDENA Base Chart Reconciliation & Accounting Domain Decision Gate; `docs/tasks/task-29/*` | **GOVERNANCE & DOMAIN RECONCILIATION GATE ONLY.** Reconciled owner-provided VARDENA Base Chart artifact (`Pasted markdown(20260927-203801).md`, exactly 264 accounts: 8 Level 1 roots, 38 Level 2, 218 Level 3; 222 postable leaves including 4 childless Level 2 leaves `307`, `602`, `703`, `704`; 42 non-leaf parents; 10 columns; coding $1+2+3$). Confirmed VARDENA coding structure is **DIRECTLY COMPATIBLE** with Vardena's configurable Coding Structure mechanism ($MAX\_DEPTH = 8, MAX\_CODE\_LENGTH = 32$). Identified domain model gaps and decisions: Account Nature requires independent `DUAL` (`هردو`) (OD-29-01 `DECIDED`); Account Type requires exactly `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM` and post-first-Posting immutability (OD-29-02 `DECIDED`); `ACLTafsil1..4` informed OD-29-03, which decides a first-class organization-configurable Detail hierarchy, first-level Account relationships, backend requirement enforcement, and controlled destructive removal (`DECIDED`, physical model not implemented); English titles are not required for MVP and are non-blocking (OD-29-04 `DECIDED`); Statement Classification is an independent, Organization-configurable reporting/presentation concept (OD-29-05 `DECIDED — OPTION C`, no implementation/taxonomy authorized); MVP has no System Account concept or `isSystem` equivalent (OD-29-06 `DECIDED`). Zero production code, schema, migration, permission, guard, or architecture changes | **READY FOR REVIEW — NOT ACCEPTED.** Architecture readiness: YES; Content loading readiness: BLOCKED on domain model gaps (AccountType OD-29-02, DUAL nature OD-29-01). OD-27-02 preserved (`DECIDED`). **Owner closure follow-up (2026-09-28): OD-29-01/02/03/04/05/06 are `DECIDED`; OD-29-05 is `DECIDED — OPTION C`.** The closure defines Nature, Type, Detail hierarchy/removal constraints, English title scope, independent Organization-configurable Statement Classification, and exclusion of a System Account concept from MVP. No runtime implementation, Statement Classification implementation, Reporting Foundation implementation, destructive operation, Task 30, Base Chart content loading, FaraPayam loading, or concrete taxonomy was authorized. OQ-25 remains OPEN | Original Task 29 branch `arena/01a0e4d1-vardena`; original baseline HEAD `862c85da7aa1fb86cb16d53341fcfd9c39dfa50a`; OD-29-05 follow-up branch `arena/01a0e8fd-vardena`, baseline `280e07e2cbf3f031a4ec178341e5c617576d1189`; reports: `docs/tasks/task-29/*` |
| 30 | Task 30 — Production Implementation of Approved Task 29 Accounting Decisions (OD-29-01, OD-29-02, OD-29-03); `docs/tasks/task-30/*` | **IMPLEMENTATION READY FOR REVIEW.** Implemented approved owner decisions across engine, schema, domain, data, API, and tests: (1) OD-29-01: Account Nature supports exactly three canonical uppercase values `DEBIT`, `CREDIT`, `DUAL` with lowercase rejected fail-closed and permissive opposite-side postings; (2) OD-29-02: Account Type supports `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM` with immutability enforced strictly after reference in at least one posted ledger entry (draft/temporary lines do not freeze type); (3) OD-29-03: First-class configurable Detail Hierarchy (`DetailStructureVersion`, `DetailStructureLevel`, `Detail` with `is_postable BOOLEAN NOT NULL DEFAULT TRUE`), Account link to Level-1 Detail Group (`Account.detailGroupId`), voucher line detail allocation enforcement, and atomic controlled destructive unlinking (`confirmUnlink: true`, exact warning text, clears document line and ledger entry detail IDs, preserves monetary turnover, records audit event); (4) OD-29-06: Verified no system account bypasses exist; (5) Scope boundaries: Statement Classification deferred to Reporting Foundation; no FaraPayam seed content loaded. Added migration `20260928000000_accounting_account_semantics_and_details` | **READY FOR REVIEW — NOT ACCEPTED.** 113 backend test files and 11 frontend test files pass cleanly. Zero lint or typecheck errors | Branch `arena/01a0e90c-vardena`; baseline commit `a6ac48a78d1e4acad663c98c6573da3201e2951a`; deliverables: `docs/tasks/task-30/brief.md`, `prompt.md`, `implementation-report.md`, `acceptance-matrix.md` |

Rows with shortened paths `accounting/...` refer to `backend/src/modules/accounting/...`. The Task 11 report notation above denotes the three real separately named files, not a literal brace-named file.

## 8. Current Task and Post-Task-30 Gate

**Task 31 — Post-Task-30 Governance Reconciliation: READY FOR REVIEW — NOT ACCEPTED (2026-09-28).** Current gate: **BLOCKED — OWNER DECISION REQUIRED**. Authoritative current artifacts: `docs/tasks/task-31/governance-reconciliation-report.md`, `next-implementation-gate.md`, `documentation-drift-report.md`, `governance-state-matrix.md`, and `acceptance-matrix.md`.

**Task 30 historical implementation baseline:** Task 30 was READY FOR REVIEW before PR #80 merged; it is now **IMPLEMENTED and MERGED** at `016ecf09cdae7c64aa4774e857fd0a87e16099d1` (PR #80), with green CI run `36478305767`. No separate Owner acceptance record was identified, so its implementation/merge status remains distinct from `ACCEPTED`. The detailed Task 30 outcomes below are retained as historical evidence.

Verified inventory at Task 30: **9 modules · 48 controllers · 55 Prisma models · 8 database schemas · 18 migrations · 142 permission codes · 113 backend unit spec files (1,307 tests) · 34 E2E spec files · 11 frontend test files (63 tests) · 37 ADR files · OQ-01…OQ-63 OPEN, OQ-64 RESOLVED**.

**Key Implementation Outcomes of Task 30:**

1. **OD-29-01 (Account Nature & Permissive Postings):** `AccountNature` supports exactly three canonical uppercase domain values `DEBIT`, `CREDIT`, and `DUAL`. Lowercase values are rejected at API/domain boundaries. Permissive opposite-side postings are preserved in `AccountingDocumentsRepository` and tests.
2. **OD-29-02 (Account Type & Operational Immutability Timing):** `AccountType` supports `BALANCE_SHEET`, `INCOME_STATEMENT`, and `MEMORANDUM`. Immutability is enforced strictly after reference in at least one posted ledger entry (`ledger_entries`). Draft and temporary document lines do not freeze `accountType`.
3. **OD-29-03 (Detail Hierarchy, Validation & Destructive Unlink):** Full versioned Detail structure (`DetailStructureVersion`, `DetailStructureLevel`), hierarchical detail nodes (`Detail` with `is_postable BOOLEAN NOT NULL DEFAULT TRUE`), Level-1 Detail Group linking to Accounts, document line detail requirement enforcement, and atomic destructive unlinking with exact warning text, historical detail allocation clearance, monetary balance preservation, and audit logging.
4. **OD-29-06 (No System Accounts):** Verified complete absence of system account bypasses in MVP.
5. **Quality Gates:** 100% clean typecheck (`tsc --noEmit`), 0 lint errors (`oxlint`), full test suites passing across backend and frontend.

**OD-29-05 Statement Classification Decision Pack (2026-09-28, documentation only):** `docs/tasks/task-29/od-29-05-statement-classification-decision-pack.md` preserves the option analysis — A (no separate classification) / B (fixed built-in taxonomy) / C (organization-configurable) — and now records the Owner's final choice: **DECIDED — OPTION C**. Statement Classification is independent and Organization-configurable, separate from Chart of Accounts, Account Type, Account Nature, Detail, System Account, and Base Chart Coding Structure. The decision fixes domain direction only: OQ-25 remains OPEN; concrete taxonomy/content, Reporting Foundation runtime behavior, Cash Flow/advanced reporting, permissions/admin workflow, schema/API/UI/migration/seed, Base Chart content, and FaraPayam content remain undecided and unauthorized; Task 30 was unauthorized at the time of the decision record and was subsequently authorized and merged by PR #80; zero production code, schema, migration, permission, guard, or runtime behavior changed by the decision-pack follow-up itself. Status: OD-29-05 DECIDED — OPTION C; Statement Classification implementation remains separately gated.

The immediately preceding recorded current-task text (Task 28) is preserved below as history.

**Task 28 — Owner Decision Closure & MVP Implementation Selection Gate: READY FOR REVIEW — NOT ACCEPTED (2026-09-27, governance & implementation selection gate only).** Audited `main` commit: **`ff4b9f24d1c3797712c88fcd61432c3c315dbf4f`** (merge of PR #73 / Task 27; baseline CI run **`36341552469`** — success: `backend` in 3m48s + `frontend` in 56s). Work on `arena/01a0e42d-vardena`. Artifacts: `docs/tasks/task-28/brief.md`, `prompt.md`, `owner-decision-matrix.md`, `owner-decision-record.md`, `mvp-implementation-readiness-matrix.md`, `next-implementation-gate.md`, `adr-reconciliation.md`, `oq-reconciliation.md`, `task-acceptance-matrix.md`, `implementation-report.md`.

Verified baseline inventory at current HEAD: **9 modules · 46 controllers · 52 Prisma models · 8 database schemas · 17 migrations · 134 permission codes · 108 backend unit spec files (1,267 tests) · 34 E2E spec files · 11 frontend test files · 37 ADR files (22 Accepted, 15 Proposed; no ADR-0027) · OQ-01…OQ-63 OPEN, OQ-64 RESOLVED**.

**Key Outcomes of Task 28:**

1. **Owner Decisions Reconciled (OD-27-01..OD-27-04, OD-28-01..OD-28-06):** All audited owner decision areas remain in state **`PENDING OWNER DECISION`**. No Owner decision or task acceptance has been fabricated.
2. **Base Chart / OQ-25 Gate Formalized:** Base Chart _mechanism_ (Task 23) is verified operational on `main`. Base Chart _content_ has **0 rows** in migrations/seeds and remains decision-blocked by **OQ-25**. All four invariants (Template identity ≠ Ledger identity, Adoption = Copy, Posting = Leaf-only, Aggregation = Read-time) are confirmed in code.
3. **ADR Alignment:** 22 ADRs Accepted, 15 Proposed (8 implemented ahead of governance pending OD-27-04 promotion).
4. **MVP Scope Boundaries Confirmed:** Treasury, Purchasing, Purchasing $\rightarrow$ Accounting, and Purchasing Reports remain strictly **POST-MVP / OUT OF MVP**.
5. **Next Implementation Gate Formulated:** Determined as **`IMPLEMENTATION BLOCKED — OWNER DECISION REQUIRED`**. Four candidate tracks prepared for Owner selection: Track 1 (Phase 1A Base Chart content loading), Track 2 (Phase 3A/3C Full Inventory/Warehouse operational subsystem), Track 3 (Phase 2A Reporting Foundation design gate), Track 4 (Phase 6.2/6.3 Audit & Identity session completion).
6. **Zero production code, schema, migration, permission, guard, or architecture changes.**

**Task 28 follow-up (2026-09-27) — OD-27-02 Owner Decision recorded:** After the Task 28 audit, the Owner explicitly decided **OD-27-02 / OQ-25 (MVP scope boundary)**: **DECIDED — MVP requires the Base Chart mechanism, but does not require a concrete Base Chart content set.** The MVP shall provide and retain the mechanism (Base Chart template model; versioned template lifecycle; Draft → Approved → Published → Superseded lifecycle; organization adoption semantics; adoption by copy, not live reference; immutable published-version semantics; no silent mutation of an adopted organization chart when the template changes; Task 21 partial-adoption governance; Base Chart Template / organization-owned accounts / ledger identity separation; leaf-only posting invariant; read-time/report-time aggregation). **Explicit MVP boundary:** for MVP, no concrete standard Base Chart content set may be introduced merely by implementation inference — no standard account codes, Persian account titles, account natures, mandatory-account list, concrete control-role catalog, statutory account requirements, or assumed Iranian accounting chart content; no migration or seed may introduce such content unless a separately approved content artifact exists. **Base Chart mechanism = MVP; concrete Base Chart content = NOT MVP-required** — Base Chart functionality is neither removed nor deferred; the product must be capable of supporting a Base Chart while actual accounting content remains organization/domain-owner controlled until an explicit approved content artifact is provided. **OQ-25 is NOT fully resolved** — only its MVP-scope sub-question is decided; the content decisions remain explicitly open (concrete content values, account codes, Persian titles, account natures, mandatory-account set, concrete control-role catalog/mandatory set, and other Task 21 unresolved content items), with all prior OQ-25 history preserved in `docs/open-questions.md`. Task 23 remains the Base Chart mechanism implementation and Task 21 remains the accepted governance baseline — neither is reinterpreted; the decision only establishes the MVP boundary between mechanism/capability and concrete accounting content. This supersedes the "all audited owner decision areas remain PENDING" wording of Key Outcome 1 **for OD-27-02 only**; OD-27-01, OD-27-03, OD-27-04 and OD-28-01..06 remain `PENDING OWNER DECISION`. The follow-up was a governance/documentation update only (decision artifacts, `docs/open-questions.md`, this STATE, and the two roadmap companions reconciled); **zero production code, schema, migration, seed, permission, guard, or architecture change; no OQ closed; no ADR promoted; no next implementation task selected; no additional Owner decision fabricated.** Decision record: `docs/tasks/task-28/owner-decision-record.md` (Decision 1), `docs/tasks/task-28/owner-decision-matrix.md`, `docs/tasks/task-28/implementation-report.md` (follow-up section). Follow-up work on `arena/01a0e448-vardena`.

The immediately preceding recorded current-task text (Task 27) is preserved below as history.

**Task 27 — Main Governance Reconciliation & MVP Gate: READY FOR REVIEW — NOT ACCEPTED (2026-09-27, governance & documentation reconciliation only).** Audited `main` commit: **`cb521f4ba2662f4a4cdac7864cf0c712b6bba816`** (merge of PR #72; baseline CI run **`36340161605`** — success: `backend` in 3m48s + `frontend` in 58s). Work on `arena/01a0e41a-vardena`. Artifacts: `docs/tasks/task-27/main-based-reconciliation-report.md`, `task-acceptance-matrix.md`, `adr-reconciliation.md`, `oq-reconciliation.md`, `documentation-drift-report.md`, `owner-decision-pack.md`, `implementation-report.md`.

Verified baseline inventory at current HEAD: **9 modules · 46 controllers · 52 Prisma models · 8 database schemas · 17 migrations · 134 permission codes · 108 backend unit spec files (1,267 tests) · 34 E2E spec files · 11 frontend test files · 37 ADR files (22 Accepted, 15 Proposed; no ADR-0027) · OQ-01…OQ-63 OPEN, OQ-64 RESOLVED**.

**Key Reconciliation Outcomes of Task 27:**

1. **Task 26 / ODR-3 Read Scope (SEC-01 Remediated):** All **37 read surfaces** across Accounting, Documents, Inventory, Organization, and Workflow modules (identified in Task 25 SEC-01) now explicitly call `OrganizationsService.assertOrganizationInScope` following their permission check. Zero unenforced organization-scoped read paths exist in the repository. Verified by `organization-read-scope-completion.spec.ts` (38 tests PASS).
2. **Permission-First Ordering Verified:** Every audited endpoint requires and verifies RBAC permissions (`requireAllPermissions`) before performing the organization-scope assertion (`assertOrganizationInScope`). Organization membership cannot be used as an authorization bypass.
3. **Deployment Organization Guard & Scope (SEC-02 Reconciled):** `DeploymentOrganizationScopeGuard` is confirmed active as a global `APP_GUARD` in `organization.module.ts:81`. Task 24's finding F-3 was factually erroneous and is formally retracted.
4. **Bootstrap Administrator & ADR-0038:** PR #72 completed default system administrator organization membership by provisioning the ADR-0025 pinned deployment organization on install and granting `مدیر` ordinary ODR-3 membership through the owning service, establishing ADR-0038 (Proposed).
5. **Base Chart Invariants & Content Distinction:** The four Base Chart mechanism invariants (Template identity ≠ Ledger identity, Adoption = Copy, Posting = Leaf-only, Aggregation = read-time) are verified in code (Task 23, PR #66). Base Chart _content_ is verified not implemented (0 seed rows in 17 migrations; OQ-25 remains OPEN as an owner/domain dependency).
6. **MVP Scope Boundaries Confirmed:** Treasury and Purchasing remain strictly outside MVP scope (zero models/controllers/routes). No microservices, no workflow designer, no EAV schema, no wildcard bypass.
7. **Next Implementation Gate Analysis:** Four candidate tracks analyzed (Phase 1A Base Chart content loading, Phase 3A Full Inventory/Warehouse flow, Phase 2A Reporting Foundation Design, Phase 6.2/6.3 Security/Identity completion). Owner Decision Pack (OD-27-01..OD-27-04) prepared.

**Zero production code, schema, migration, permission, guard, or architecture changes.** No ADR was promoted, no OQ was closed, and no task was manufactured as accepted.

The immediately preceding recorded current-task text (Task 25) is preserved below as history.

**Task 25 — Main-Based Governance Closure: READY FOR REVIEW — NOT ACCEPTED (2026-09-27, documentation + one comment-only production correction).** Audited `main` commit: **`80944ce112dc16fd834585f8a4c2d83906547480`** (merge of PR #69); baseline CI run **`36323517204`** — **success** (`backend` + `frontend`). Work on `arena/01a0e32b-vardena`; PR **#70**, branch CI run **`36325486898`** on `743a063` — **`backend` success (3m46s), `frontend` success (53s)**, covering prisma validate/generate, lint, typecheck, format, unit, build, `migrate deploy`, `bootstrap:system-admin`, migration rehearsal and the E2E suites including live PostgreSQL. Artifacts: `docs/tasks/task-25/main-based-governance-audit-report.md`, `implementation-acceptance-matrix.md`, `adr-reconciliation.md`, `oq-reconciliation.md`, `documentation-drift-report.md`, `owner-decision-pack.md`, `implementation-report.md`.

Verified inventory at that commit — **9 modules · 46 controllers · 52 Prisma models · 8 database schemas · 17 migrations · 134 permission codes · 107 backend unit spec files · 34 E2E spec files · 11 frontend test files · 37 ADR files (no ADR-0027) · OQ-01…OQ-63 OPEN, OQ-64 RESOLVED** — matches `.vardena/project-context.md` and `docs/roadmap/backend-mvp-roadmap.md`; **no numeric drift**.

What Task 25 changed: the seven documentation artifacts above, this STATE synchronization, and **one comment-only edit** to `backend/src/modules/organization/domain/organization-permissions.ts` (+17/−7, entirely inside one doc-comment block, `git diff --check` clean). The `MEMBERSHIP` comment still asserted the pre-PR-#55 rule ("granting does NOT require the grantor to be a member"); PR **#55** made membership administration organization-bound with a single first-member bootstrap exception, so the comment contradicted shipped, accepted behaviour. **Zero behavioural change; no schema, migration, API, DTO, permission, guard, dependency, test or frontend change.** No ADR was promoted, no OQ was closed, no task was accepted, no architecture was reopened, and no Treasury/Purchasing/Sales/Base-Chart-content work was admitted.

**Security findings recorded by the audit (not fixed here — production capability is outside Task 25):**

- **SEC-01 — CRITICAL.** `docs/security.md` §3 states that _every_ organization-scoped read and write passes through `OrganizationsService.assertOrganizationInScope`. At `80944ce`, **28 `list*` and 9 `get*` service methods do not**: accounting (`accounting-configurations`, `accounting-periods`, `coding-structures`, `financial-areas`, `fiscal-years`), documents (`document-relations`, `numbering` allocations, plus three detail paths), inventory (all eight list surfaces), organization (`branches`, `departments`, `employees`, `parties`) and workflow (nine list + six detail paths, whose `mustFindInOrganization` helpers compare `row.organizationId` only). With `DEPLOYMENT_ORGANIZATION_ID` unset — the default — the global pin guard is a no-op and the membership binding is the only boundary, so a permission holder in one organization can read another's rows on those surfaces. This widens Task 24's recorded finding **F-2** from 4 surfaces to **37**. Classified **F6 — security remediation required**; Owner decision **D-01**; remediation changes an API contract (200/empty page → 404) exactly as Task 24's R-2 did.
- **SEC-02 — HIGH.** Task 24's finding **F-3** ("no global pin `APP_GUARD` is registered anywhere in the Nest bootstrap") is **factually wrong**: `backend/src/modules/organization/organization.module.ts:81` registers `{ provide: APP_GUARD, useClass: DeploymentOrganizationScopeGuard }` and `AppModule` imports `OrganizationModule`, so the guard is global. The spec comment F-3 calls stale is correct. The error is repeated in `docs/roadmap/backend-mvp-roadmap.md` §6.1 and `docs/roadmap/future-task-candidates.md` C-06. Classified **F1**; Owner decision **D-02**. Task 24's R-2 fix and its tests remain valid.
- **SEC-03 — LOW, fixed here.** The stale membership comment described above.

**Base Chart (Tasks 20/21/23/24) verified.** All four Task 20 invariants hold on `main` — Template identity ≠ Ledger identity, Adoption = Copy, Posting = Leaf-only, Aggregation = read-time. Task 21 governance (explicit adoption, versioning, immutable used versions, no silent mutation, organization isolation, RESTRICT-only deletion posture) is reflected in the Task 23 mechanism. **No Base Chart content exists** — verified: no `INSERT` into `accounting.base_chart_template_nodes` in any of the 17 migrations. Task 24's R-2 correction is present and correct in `accounts.service.ts::listAccounts`.

**Governance outcome.** 22 findings (10 documentation-drift items DR-01…DR-10 — 1 CRITICAL, 2 HIGH, 2 MEDIUM, 2 LOW, 3 INFORMATIONAL — plus 12 unresolved items U-01…U-12), **10 Owner decisions D-01…D-10, all PENDING**, **1 blocking finding (SEC-01)**. **Recommended next gate: ODR-3 list-scope completion** — an Owner-approved, bounded, schema-free security correction over the 37 surfaces (roadmap item 6.1 / candidate C-06, widened): **OWNER DECISION REQUIRED → then IMPLEMENTATION REQUIRED**. Task 25 itself **must not be treated as Accepted**; acceptance remains an explicit Owner act (§6).

The immediately preceding recorded current-task text is preserved below as history.

**Current accepted baseline:** Task 21 — Base Chart Governance & OQ-25 Resolution and Task 22 — Frontend Vertical Slice are **ACCEPTED (2026-09-26)** under their explicit Repository Owner acceptance records. Task 21 remains documentation-only; it did not authorize production implementation or close OQ-25/OQ-36/OQ-41/OQ-43. Task 22 remains limited to its accepted frontend vertical slice and added no backend Accounting-write capability.

**Later merged work awaiting Owner acceptance:** Bootstrap System Administrator (unnumbered, PR #64), Task 23 (PR #66), and Task 24 R-2 (PR #67) are all **IMPLEMENTATION MERGED / READY FOR REVIEW — NOT ACCEPTED**. Each has recorded green CI evidence, but no explicit Repository Owner task-acceptance record was found for any of the three. Merge, CI, scope approval, and acceptance remain distinct facts.

There is **no active implementation task selected** by this synchronization. `main` is at the latest accepted baseline plus the three merged-not-accepted work items above, and is **READY FOR NEXT MAIN-BASED AUDIT**. No Task 25 is defined or selected here.

**Backend MVP roadmap (2026-09-27, documentation only — READY FOR REVIEW — NOT ACCEPTED):** the authoritative navigation map from the current repository state to Backend MVP now exists at [`docs/roadmap/backend-mvp-roadmap.md`](docs/roadmap/backend-mvp-roadmap.md) (companions: `docs/roadmap/backend-mvp-dependency-matrix.md` and `docs/roadmap/future-task-candidates.md`). It was established against `main` @ `c654be916fe75e25ff2862900994c86aa1c20892` (merge of PR #68) from direct repository inspection, records the verified module/capability inventory and the Owner-directed scope correction: Foundation, Accounting, Full Inventory/Warehouse, Party/Customer, Sales, Sales → Accounting, Inventory → Accounting, Reporting and Electronic Books/Tax Accounting are MVP-required; Purchasing, Purchasing → Accounting, Purchasing Reports and Treasury remain post-MVP. Its phase structure (governance closure → Accounting completion → bounded reporting → Full Inventory/Warehouse and Sales → required accounting integrations → durable infrastructure → audit/security/tenant hardening → production readiness → final gate) preserves **Treasury = deferred / out of MVP**, keeps Base Chart correctly separated into _mechanism (merged, not accepted) vs content (OQ-25/OQ-36 gated)_, and creates **no** numbered task, closes **no** OQ and promotes **no** ADR. Future work items live in its Future Task Candidate Register, not as authorized tasks. The roadmap does not itself authorize implementation or accept future work; if it conflicts with the repository, the repository wins.

Task 19 remains **ACCEPTED** and unchanged: **Task 19 — Accounting Chart / Configuration Foundation: ACCEPTED (2026-09-26)** under Owner-authorized Acceptance Sync after final repository review. PR **#54** implemented exactly the three accepted slices: **ODR-1** Explicit Configuration Coherence (coherent `coding_structure_version_id` / `accounting_configuration_id` code shape, write-boundary checks and repository transaction re-check, divergent pins rejected without silent winner/fallback, existing divergence not repaired), **ODR-2** Accounting-owned Chart Tree (`GET /api/v1/accounting/chart-tree` and `GET /api/v1/accounting/chart-tree/:id`, organization-scoped, deterministic, bounded, inactive accounts readable, existing hierarchy, `isPostable` authoritative, no figures or Reporting surface), and **ODR-3** Principal-bound Organization Authorization (membership-bound access through `assertOrganizationInScope`, 404 isolation, granular membership permissions, no wildcard or super-admin bypass). PR **#55** corrected the ODR-3 membership-administration defect before acceptance: list/grant/revoke now require acting-principal membership plus the corresponding permission, except for the bounded first grant into an empty organization; list and revoke never receive that exception. ODR-1 and ODR-2 were not changed.

Final CI is **SUCCESS** on run `36238862315` with the backend job green across the configured Prisma, lint, typecheck, format, unit, build, migration, rehearsal, E2E and live-PostgreSQL gates; no required gate was skipped or continued-on-error. Local fast evidence was format:check PASS, lint PASS with 0 errors, typecheck PASS, unit tests PASS (**101 files / 1148 tests**), and build PASS. Local Prisma validate/generate and heavy E2E/live-DB/migration/concurrency execution were delegated to CI under `docs/testing/test-execution-policy.md`; no local heavy E2E/live-DB result is claimed. Acceptance record: `docs/tasks/task-19/task-19-acceptance-record.md`.

**OQ-25, OQ-43, OQ-62, OQ-63, OQ-01 and OQ-22 remain OPEN.** The merged-but-not-accepted Bootstrap System Administrator work item implements a provisioning procedure without recording a new Owner Decision. OQ-14 remains OPEN for occupational roles and future role baselines; OQ-19 remains OPEN for self-disable, self-role-removal, and last-administrator lockout protection. ADR-0033…0037 remain **Proposed**; no ADR is promoted. Task 17 remains **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS** and is **NOT complete**. Task 17A and Task 17B remain **ACCEPTED**; Task 17C remains exactly **ACCEPTED (2026-09-25)** as currently recorded; Task 18 remains **ACCEPTED**.
**Historical post-merge ODR-3 correction status at PR #55 submission — READY FOR REVIEW — NOT ACCEPTED
(2026-09-26).** On `arena/01a0dd6c-vardena` (PR **#55**, commit `86273b8`,
base `f153251`, the PR #54 merge; required CI **green** on the first run —
run `36238862315`: prisma validate/generate, lint, typecheck, format, unit
**101 files / 1148 tests**, build, `migrate deploy`, migration rehearsal, E2E
incl. live PostgreSQL) a corrective change closes the one gap the merged Task 19 left in
ODR-3: membership ADMINISTRATION was permission-only. `listMembers`,
`grantMembership` and `revokeMembership` resolved the target organization
through `requireAdministrableOrganization` (existence + deployment pin +
usability) and explicitly did not require the acting principal's membership,
so `Organization.Membership.{View,Grant,Revoke}` alone crossed organization
boundaries on that surface. After the correction all three operations run
deployment pin → membership assertion (`assertOrganizationInScope`) →
organization resolution → business operation, and the ONLY exception is the
bootstrap grant of the FIRST member of an organization whose membership set
is empty (decided by the new indexed `LIMIT 1` probe
`OrganizationMembershipsRepository.hasAnyMember`, never by loading members);
list and revoke are never exempt, and the exception re-opens only if the set
becomes empty again and closes at the next first grant. Failure semantics are
unchanged: non-member → **404** indistinguishable from an unknown
organization, missing permission → **403**, duplicate → **409**, unknown user
→ **404**, disabled organization → **422**; system context keeps the
trusted-caller posture. Tests: new `organization-memberships.service.spec.ts`
(17 tests; 8 fail against the pre-correction code) and the rewritten HTTP
suite `organization-membership.e2e-spec.ts`. **No migration, no new
membership model, no per-organization role, no wildcard permission, no
super-admin bypass, no dependency, and no functional change to ODR-1 or
ODR-2.** Report: `docs/tasks/task-19/task-19-implementation-report.md` §6.
**At that historical submission stage, Task 19 was NOT ACCEPTED; the correction itself accepted nothing. Final acceptance is recorded above.**

The immediately preceding recorded current-task text — **Task 19 — ODR-1..ODR-3
Decision Sync + Implementation Gate: READY FOR REVIEW (2026-09-25,
documentation only)** — recorded the Owner decisions **ODR-1** (Explicit
Coherence Rule), **ODR-2** (Accounting-owned Chart Tree reads) and **ODR-3**
(Principal-bound Organization Authorization) as **DECIDED** in
`docs/accounting/owner-decision-baseline.md` §11 and the implementation gate
`docs/tasks/task-19/task-19-implementation-gate.md` as **READY FOR
IMPLEMENTATION** (implementation not yet started; no production code). It is
preserved in §7 Task History. The preceding current-task text before that — **Task 17C — Accounting Decision Consolidation:
ACCEPTED (2026-09-25)** — a **documentation-only governance acceptance** recorded
by the **Task 17C Acceptance Sync** under explicit Owner authorization (acceptance
record: `docs/tasks/task-17/task-17c-acceptance-record.md`). The acceptance
accepts the owner decision consolidation (Q1–Q22 + invariants I-1…I-3, with
discrepancies D-1…D-13 and open items O-1…O-12 preserved exactly as recorded in
`docs/accounting/owner-decision-baseline.md`) as authoritative, synchronizes the
governance documentation, and confirms that ADR-0033…0037 — which accurately
reflect those decisions — remain **Proposed**: task acceptance does not promote an
ADR, and each ADR remains pending its separate adoption/implementation gate.
Task 17C introduces **no production behavior** (no code, schema, migration, API,
permission, dependency or UI change), and the acceptance **resolves no Open
Question**: **OQ-25 and OQ-43 remain OPEN**. **Task 17 overall remains
FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS (BLOCKED) and is NOT
complete** — its later implementation/governance prerequisites, especially
OQ-25 and OQ-43, remain unresolved, and this acceptance does not implement any of
the future capabilities described by ADR-0033…0037.

The immediately preceding state — **Task 18 — Accounting Reporting Read
Foundation: ACCEPTED (2026-09-25)** — is preserved below as the record of that
acceptance synchronization. PR **#46** was reviewed by the Repository
Owner/Reviewer **before merge** and is **MERGED** into `main` in merge commit
`e774a1c37c921ba83e4e9c23729fde6205cedb76` (reviewed implementation head
`5971bed`; review-fix commits `4182346`/`0d9cf76`). That synchronization
converted the repository state from implementation/merge status into formal task
acceptance: **implementation = MERGED** and **task governance status =
ACCEPTED** are two distinct facts, and both are represented deliberately.
Acceptance record:
`docs/tasks/task-18/task-18-acceptance-record.md`.

The Task 18 Owner Decisions D1–D20 are the approved baseline for this exact
bounded slice, even though older Task 17 records describe the broader Reporting
Foundation as blocked by OQ-25/OQ-43. Delivered:

- Shared Accounting-owned `AccountingReadQueryRepository` over immutable
  `accounting.ledger_entries` plus Accounting-owned document/account/calendar
  rows. The Task 17B repository name remains as a compatibility adapter, so
  accepted statement behavior and its injection seam are not redesigned.
- `GET /api/v1/accounting/account-statements` with the bounded Task 17B
  statement semantics preserved and explicit hierarchy/account-code/name/date
  filters added within one account, organization, area and fiscal year.
- `GET /api/v1/accounting/general-ledger` with immutable ledger/voucher-line
  identities, authoritative document type/source references, exact debit,
  credit and net strings, and only fields available from Accounting models.
- `GET /api/v1/accounting/trial-balance` with exact opening/debit/credit/net/
  closing strings and POSTING-to-AGGREGATION ancestor roll-up without
  parent/child double counting.
- Independent `Accounting.GeneralLedger.View` and
  `Accounting.TrialBalance.View` permissions, existing organization pin/
  authorization conventions, readable OPEN/CLOSED/SEALED periods, same-year
  period/date scope, bounded page size and 50,000-row hard bound, deterministic
  allow-listed sorting, five-second interactive read timeout and source
  references for future drill-down.

Explicit exclusions and governance boundaries:

- **OQ-25 and OQ-43 remain OPEN.** Task 18 does not resolve chart/report
  classification or statutory/legal reporting questions, and **accepting
  Task 18 closes neither OQ**.
- **Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS and
  is NOT complete.** Task 17A remains ACCEPTED and Task 17B remains ACCEPTED
  only for its previously accepted D1–D7 slice; Task 17C is now **ACCEPTED
  (2026-09-25)** by the documentation-only Acceptance Sync recorded above, which
  implements no production behavior and promotes no ADR. Task 18 does not
  promote, amend or redesign those accepted slices.
- No generic Reporting module, Report Builder, `/api/v1/reports`, universal
  report table, EAV/JSONB reporting schema, XLSX/CSV/PDF/Print export, Legal
  Books, statutory layout, financial statements, treasury/cash/bank reporting,
  classification, management dimensions, settlement/allocation, AR/AP,
  sales/purchasing or cross-year carry-forward was added.
- No ledger, voucher, account, period, financial area or document mutation is
  exposed. No schema, migration, index, view or report persistence was added.
- Task 12's P1 PostgreSQL concurrency follow-up, Task 13's review status, Task
  14's READY FOR REVIEW status and Task 16's authorization gate remain
  separate and unchanged.

Acceptance evidence is recorded in
`docs/tasks/task-18/task-18-implementation-report.md` §6/§9 and in
`docs/tasks/task-18/task-18-acceptance-record.md`: focused **D5 reconciliation
2 passed**; **accounting unit suite 43 files / 538 tests**; **full backend unit
suite 97 files / 1,100 tests**; typecheck, build, format and `git diff --check`
passed; **lint 0 errors with 6 pre-existing unrelated warnings** (not Task 18
failures); **CI run `36133360887`** on PR #46 head `5971bed` — `backend`
`completed success`, including Prisma validation, lint, typecheck, format, unit
tests, build, migration rehearsal and live-PostgreSQL E2E. The final review-fix
addressed the D5 source-of-truth/reconciliation point and was
documentation/test-only, so CI run `36133360887` predates it; the focused
reconciliation test and the local full validation covered the post-fix state,
and CI is not claimed to have executed the later review-fix commit. No
production, schema, migration, API, permission, dependency or test file was
changed by this acceptance synchronization.

## 9. Open Questions

The existing canonical product/domain registry is `docs/open-questions.md` (OQ-01…OQ-72 as of 2026-10-07; each row records its own status — several rows are marked RESOLVED in place). The following are relevant unresolved questions; other registry entries remain unchanged. BOOT identifiers below are new documentation observations, not renumbered product OQs.

| ID                    | Question / why it matters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Evidence / related area                                                                                                                                      | Decision needed                                                                                              | Status                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BOOT-OQ-01            | Should future architectural ADRs use docs/adr or docs/decisions/ADR-*? Two conventions would split decision authority                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `docs/adr/README.md`, `.vardena/agent-rules.md` AG-07, requested structure in §3                                                                             | Repository convention is canonical: use `docs/adr/`; preserve existing ADRs                                  | RESOLVED BY REPOSITORY EVIDENCE 2026-09-24                                                                                                                                                                                                                               |
| BOOT-OQ-02            | What is Task 12's valid final review outcome and disposition of P1? Legacy label is not a permitted new outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Accounting task index §6/§8 vs Task 12 reports and ADR-0031                                                                                                  | Owner/reviewer record ACCEPTED or CHANGES REQUIRED based on evidence, without erasing history                | REQUIRES OWNER CONFIRMATION                                                                                                                                                                                                                                              |
| BOOT-OQ-03            | What is the approved Task 16 objective, scope and acceptance basis? No formal baseline task record found                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Established Owner direction plus `docs/tasks/task-16/brief.md` and `decision-reconciliation.md`                                                              | Owner direction is recorded; implementation authorization remains a separate later gate                      | RESOLVED / FORMALIZED 2026-09-24                                                                                                                                                                                                                                         |
| BOOT-OQ-04            | Which CI jobs are actually required by branch protection? Workflow existence does not enforce merge gates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `.github/workflows/ci.yml`                                                                                                                                   | Owner confirms settings and records evidence                                                                 | UNKNOWN                                                                                                                                                                                                                                                                  |
| OQ-01 / OQ-22         | Confirm single-organization deployment vs eventual tenancy/branch accounting scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `docs/open-questions.md`, ADR-0025                                                                                                                           | Owner/product/architecture; do not infer membership from organizationId                                      | OPEN in registry                                                                                                                                                                                                                                                         |
| OQ-03 / OQ-47 / OQ-48 | Currency precision, FX rules and revaluation policy; numeric storage alone is not policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `docs/open-questions.md`, `docs/decisions/product/OQ-47-exchange-rate-and-multicurrency-rules.md`, `OQ-48-revaluation-and-fx-gain-loss.md` in that directory | Product/accounting expert                                                                                    | OPEN in registry                                                                                                                                                                                                                                                         |
| OQ-23 / OQ-27         | Period close/reopen authority and correction windows; existing open-scope/reopen mechanisms do not settle full policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `docs/open-questions.md`, contract §7/§15, ADR-0032                                                                                                          | Owner/accounting expert                                                                                      | OPEN                                                                                                                                                                                                                                                                     |
| OQ-25 / OQ-41 / OQ-43 | Chart/report-layout policy, dimensions and Iranian statutory/legal requirements. **Task 20 (2026-09-26):** OD-20-1…OD-20-6 resolve the Task 20 mechanism ambiguities (Base Chart artifact/adoption, consumer-first role sequencing, effective-dated role mapping, producer-bound code history, D-1 leaf-only posting, line-level dimensions). **Rows remain OPEN** for Base Chart content, role catalog/mandatory set, per-level defaults, code reuse/history details, dimension count/defaults/binding/governance and every legal fact. **Task 28 follow-up (2026-09-27):** OD-27-02 is **DECIDED for the OQ-25 MVP-scope sub-question only** — the MVP requires the Base Chart mechanism but not a concrete Base Chart content set; no content may be introduced by implementation inference without a separately approved content artifact. | `docs/accounting/task-index.md` §4, `docs/tasks/task-20/*`, contract §19 + §31/§32, `docs/accounting/owner-decision-baseline.md` §12                         | Accountant + tax/legal expert + owner; future implementation tasks require explicit scopes/content approvals | OPEN in registry; Task 20 decision resolution closes no OQ status and promotes no ADR; **the OD-27-02 follow-up likewise closes no OQ — OQ-25/OQ-41/OQ-43 remain OPEN for all content-level decisions** (decision record: `docs/tasks/task-28/owner-decision-record.md`) |
| OQ-62 / OQ-63         | Compatibility of account coding/configuration pins and legacy fallback shape; affects validation/migration semantics                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `docs/open-questions.md`, Task 11 report; default 2+3 fallback is recorded behavior, not a newly ratified decision                                           | Product/architecture                                                                                         | OPEN                                                                                                                                                                                                                                                                     |
| OQ-72                 | **NEW (opened 2026-10-07 by the C-60 Inventory → Accounting boundary audit).** Authorization of system-origin postings: is the source module's command permission (`Inventory.Document.AccountingPost`) sufficient authority for the Accounting side to create a voucher, or is a dedicated Accounting code required (alone or in addition), and what actor/source evidence must a worker-originated posting carry? No system posting exists yet, so nothing may be implemented while the row is open.                                                                                                                                                                                        | `docs/open-questions.md` OQ-72; `docs/tasks/c-60-inventory-accounting-boundary-and-decision-package.md` §18.2/§21.3; ADR-0026 §6; contract §16.5/AC-D-26 | Owner (with accountant + architecture); together with OQ-39 it gates any production system-generated posting | OPEN                                                                                                                                                                                                                                                                     |

**OQ-19 remains OPEN:** the in-review Bootstrap System Administrator task
implements the out-of-band provisioning procedure, but that implementation note
is not a new Owner Decision. Self-disable, self-role-removal, and
last-administrator lockout protection remain undecided. Task 19's bounded
first-grant exception remains unchanged.

OQ-64 is **RESOLVED 2026-09-23** in the registry: freeze the distinct configurations actually referenced by finalized voucher accounts. Some older Task 12/index paragraphs still call it open; do not re-open it based on those stale references. Task 16 questions are newly recorded bootstrap questions only, not previously approved scope.
Task 17 creates no new OQ and does not reclassify OQ-25, OQ-43, OQ-49, or any existing registry entry.

**Task 25 (2026-09-27) creates no OQ, closes none, and reclassifies none.** Its OQ reconciliation (`docs/tasks/task-25/oq-reconciliation.md`) confirms against `main` @ `80944ce` that OQ-01…OQ-63 remain OPEN and OQ-64 remains RESOLVED, and that **no merged implementation contradicts an open OQ's recorded assumption**. Explicitly: OQ-25 stays OPEN for Base Chart content, the control-role catalog and the mandatory set (Task 23 delivered the _mechanism_ only, and its merge closes nothing); OQ-36 prerequisites remain explicit and unmet (no delete operation exists for master data); OQ-39 still gates every system-generated posting path (in-memory event bus only, no outbox, no cross-module subscription); OQ-24/OQ-30/OQ-41/OQ-42/OQ-43 still gate Inventory → Accounting, Sales, dimensions, posting mode and Electronic Books respectively; OQ-62 is enforced on writes by ODR-1 while repair of divergent legacy rows stays undecided; OQ-63's documented 2+3 fallback remains observed behaviour, not a ratified decision.

## 10. Risks and Gaps

| ID             | Description / evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Impact                                                                                                                                                   | Status / recommended next step                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T25-R-01       | **SEC-01 (CRITICAL).** `docs/security.md` §3 claims every organization-scoped read and write passes through `assertOrganizationInScope`; at `main` `80944ce` **28 `list*` and 9 `get*` service methods do not** (accounting 5, documents 2+3, inventory 8, organization 4, workflow 9+6). With no `DEPLOYMENT_ORGANIZATION_ID` configured the global pin guard is a no-op, so a permission holder in one organization can read another's rows on those surfaces. Evidence: `docs/tasks/task-25/main-based-governance-audit-report.md` §11, `documentation-drift-report.md` DR-01/DR-03 | Documented security control was not universally enforced prior to Task 26                                                                                | **RESOLVED 2026-09-27 by Task 26 (PR #71).** All 37 surfaces now explicitly enforce `assertOrganizationInScope` following `requireAllPermissions`. Verified in code, AST/boundary tests (`organization-read-scope-completion.spec.ts`, 38 tests PASS), and CI run `36337732631`                                                                                                                                                                                                                                                                                                 |
| T25-R-02       | **SEC-02 (HIGH).** Task 24 finding **F-3** states no global pin `APP_GUARD` is registered; `backend/src/modules/organization/organization.module.ts:81` registers `DeploymentOrganizationScopeGuard` as `APP_GUARD` and `AppModule` imports `OrganizationModule`. The error was repeated in older roadmap references                                                                                                                                                                                                                                                                   | A future agent could register a redundant guard, mis-size the ODR-3 remediation, or wrongly believe the deployment pin is unenforced on the HTTP surface | **RESOLVED in documentation (Task 25/26/27 reconciliation).** Global `APP_GUARD` confirmed active; Task 24 F-3 claim retracted; roadmap and candidate registers reconciled                                                                                                                                                                                                                                                                                                                                                                                                      |
| T25-R-03       | **Merged-without-acceptance backlog.** Bootstrap System Administrator (PR #64/72), Task 23 (PR #66), Task 24 R-2 (PR #67), Task 25 (PR #70), Task 26 (PR #71/72), and the Backend MVP roadmap (PR #69) are all merged with green CI and **no Owner acceptance record**; Tasks 13/14 remain recorded NOT ACCEPTED and Task 15 has **no governance record at all**; Task 12's quoted “ACCEPTED WITH FOLLOW-UP” is a label `STATE.md` §6 forbids                                                                                                                                          | Merge and CI could be mistaken for acceptance; historical traceability for Task 15's reversal capability is absent                                       | **OPEN — F2.** Owner decisions **OD-27-01** (Task 27 owner pack covers bootstrap, Tasks 23–26), **D-06** (Tasks 13/14/15), **D-07** (Task 12 outcome + the open P1 real-PostgreSQL concurrency verification). Historical labels are preserved, never normalized                                                                                                                                                                                                                                                                                                                 |
| BOOT-R-01      | Root README says no business modules; backend README says no Accounting/Inventory; `.vardena/project-context.md` stops at 13 migrations and no balances/corrections, while app.module.ts and 15 migration files show otherwise                                                                                                                                                                                                                                                                                                                                                         | Incorrect onboarding/scope assumptions                                                                                                                   | OPEN documentation drift; owner-authorized follow-up to reconcile summaries, not changed here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| BOOT-R-10      | `docs/accounting/domain-contract.md` header still says Proposed/no implementation and labels ADR-0026 Proposed, while ADR-0026 itself says Accepted and Accounting code exists                                                                                                                                                                                                                                                                                                                                                                                                         | Contract status versus implemented state is ambiguous to new readers                                                                                     | OPEN; owner/architecture clarify the contract header in a separate documentation task; no silent status promotion                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| BOOT-R-02      | Task 12 legacy review label conflicts with new outcome rules and older reports; ADR-0031/0032 remain Proposed despite implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Merge mistaken for architecture/task acceptance                                                                                                          | OPEN; resolve BOOT-OQ-02 and record explicit review outcomes separately                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| BOOT-R-03      | Task index/reports still call PRs #31/#32 open; baseline/GitHub evidence shows merged; Task 15 lacks a dedicated review record                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Incomplete historical final-state traceability                                                                                                           | OPEN; owner/reviewer supply evidence-linked final records; no acceptance inferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| BOOT-R-04      | Task 12 P1 real PostgreSQL independent-connection concurrency verification remains open in index §8 and remediation report; PGlite is not equivalent                                                                                                                                                                                                                                                                                                                                                                                                                                   | Concurrency confidence is incomplete in that historical record                                                                                           | OPEN recorded follow-up; inspect actual CI/test evidence before closing; no test run here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| BOOT-R-05 (G7) | Partial ACTIVE index exists only in migration SQL/schema comments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Generated schema migrations may drop an invariant                                                                                                        | Historical ACCEPTED RISK label preserved from index §8; keep catalog/rehearsal checks; no new risk acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| BOOT-R-06      | Optional deployment pin without per-user organization membership (ADR-0025; organization guard, users/rbac schemas)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Structural isolation must not be advertised as secure multi-tenancy                                                                                      | Known limitation; confirm deployment posture before extending scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| BOOT-R-07      | Reversal exists but controller/service/repository comments still claim no reversal or finalizeChecked as sole final writer                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Future analysis could follow obsolete comments/lock narratives                                                                                           | OPEN; review Task 15 against contract and repair documentation in separately authorized work; no source edits here                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| BOOT-R-08      | Task 16 brief/decision record and ADR-location convention were incomplete at bootstrap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Premature implementation or fragmented architecture history                                                                                              | RESOLVED for contract finalization 2026-09-24; implementation remains unauthorized and is gated by the concrete document/amount authority allow-list                                                                                                                                                                                                                                                                                                                                                                                                                            |
| BOOT-R-09      | Shallow checkout; historical CI/report assertions not rerun; branch required-check settings unknown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Inventory is not a complete historical or runtime audit                                                                                                  | UNKNOWN beyond inspected evidence; retrieve further commit/check evidence for future reviews                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| BOOT-R-11      | Historical Task 17C discrepancy **D-1** asked whether configurable non-leaf POSTING could coexist with the `postable ⇒ leaf` invariant and Task 18 roll-ups.                                                                                                                                                                                                                                                                                                                                                                                                                           | A future agent could otherwise relax the leaf invariant and duplicate parent/child postings.                                                             | **RESOLVED 2026-09-26 by Task 20 OD-20-5.** Product rule is `POSTING = leaf-only` and `AGGREGATION = reporting/read-time roll-up`; parent values are derived views over leaf postings, not independent movements. Future non-leaf posting requires a new explicit architecture decision and ADR supersession/amendment.                                                                                                                                                                                                                                                         |
| BOOT-R-12      | Task 17C (`arena/01a0d7c4-vardena`, PR #45) and **PR #44** (`arena/01a0d76b-vardena`, Task 17B acceptance) both edit `STATE.md` §7/§8/§10 and `docs/accounting/task-index.md` header/§2/§9; PR #44 was not merged at the Task 17C baseline (`b10e007`) but was **MERGED 2026-09-25T09:35:22Z in `2892189`** while PR #45 stayed open                                                                                                                                                                                                                                                   | A textual merge conflict on the second PR, and a risk that one branch's Task 17B status text overwrites the other's                                      | **RESOLVED 2026-09-25** by synchronizing PR #45 with `main` @ `2892189` (merge of `main` into the branch — no rebase, no force-push, AG-04). Conflicts materialized exactly as predicted in `STATE.md` §7 and in `task-index.md` header/§2/§9 and were resolved conservatively: `main`'s Task 17B **ACCEPTED** text is preserved verbatim in all four places and every Task 17C row is preserved (Q1–Q22, I-1…I-3, ADR-0033…0037 Proposed, OQ-25/OQ-43 still OPEN, D-1…D-13 intact). Discrepancy **D-8** is recorded RESOLVED by that merge; no status was promoted by Task 17C |

**Task 16 contract finalization — 2026-09-24:** Owner directions were reconciled against the current Accounting/Document/RBAC/idempotency/transaction/concurrency repository mechanisms. `docs/tasks/task-16/brief.md` and `decision-reconciliation.md` formalize the bounded Settlement / Allocation foundation; `docs/accounting/task-index.md` now records the contract as defined. No production implementation, schema or migration is authorized by this work.

**Task 17 documentation/task definition — 2026-09-24:** `docs/tasks/task-17/brief.md` and `prompt.md` formalize the bounded Accounting Reporting Foundation while keeping implementation blocked by OQ-25/OQ-43. The accepted Reporting architecture is preserved; no Report Builder/OQ-49 work, production implementation, schema, migration, endpoint, permission, test, event, reporting infrastructure, or frontend is authorized by this documentation work.

**Task 17B Account Statement slice — 2026-09-25:** under Owner decisions D1–D7 (`docs/tasks/task-17/task-17b-prompt.md`, saved before implementation), the bounded read-only account statement was implemented on `arena/01a0d5a0-vardena` (PR **#43**, implementation commit `9ee46f7`): `GET /api/v1/accounting/account-statements`, `Accounting.AccountStatement.View` (36th code, contract §22 row under gate P-10), exact debit-positive Decimal semantics, intra-year sequence-based opening (no carry-forward), org-first 404/422 scope matrix, no schema/migration/index change. Unit 1086 passed; e2e 246 passed + 85 live-PG skipped (CI-only); `prisma validate` not runnable in the sandbox (no `DATABASE_URL`; schema unchanged). Status **ACCEPTED (2026-09-25)** — PR **#43** was reviewed by the Owner/Reviewer before merge and is **MERGED** into `main` in `b10e007` (merged head `1ec996e`), with required CI green on that head (run `36074225037`, job `backend` `completed success`, including `prisma validate`/`generate`, lint, typecheck, format, unit, build, `migrate deploy` and E2E incl. the live-DB suites on `postgres:16` where the 11-test `account-statements-live.e2e-spec.ts` executed green); no blocker remained. The acceptance is bounded to the D1–D7 slice: OQ-25/OQ-43 and Task 17's blocked status unchanged, Task 17 **NOT complete** (`docs/tasks/task-17/task-17b-implementation-report.md`, `docs/tasks/task-17/task-17b-acceptance-record.md`).

**Task 17C Accounting Decision Consolidation — 2026-09-25 (documentation only):** the Owner-approved Accounting decisions **Q1–Q22** and invariants **I-1…I-3** were consolidated as the authoritative baseline for future Accounting work on `arena/01a0d7c4-vardena` (base `b10e007`, merge of PR #43): `docs/accounting/owner-decision-baseline.md` (register + repository reconciliation + 13 discrepancies + 12 open implementation details + verification log), `docs/tasks/task-17/task-17c-prompt.md` (received prompt, verbatim), **ADR-0033/0034/0035/0036/0037 created as Proposed**, `docs/adr/README.md` index rows, `docs/accounting/domain-contract.md` **§31 pointer addendum**, `docs/open-questions.md` **OQ-25/OQ-43 annotated and still OPEN**, `docs/accounting/task-index.md` §2/§4/§5/§9 and `STATE.md` §3/§7/§8/§9/§10. Validation: `git diff --check` clean; documentation-only path audit (no `backend/`, `prisma/`, `*.ts`, `*.sql`, `package*.json`, `.github/`, `docker-compose.yml`, `.env.example` change); referenced-path and AC-/ADR-/OQ-/AR-/AG- id existence checks; markdown table integrity; no ADR or task status promoted; no legal claim. Status **READY FOR REVIEW — NOT ACCEPTED**. **Synchronization 2026-09-25:** after **PR #44** merged into `main` in `2892189` (Task 17B **ACCEPTED**), `main` was merged into `arena/01a0d7c4-vardena`; the resulting conflicts in `STATE.md` §7 and `docs/accounting/task-index.md` header/§2/§9 were resolved by preserving `main`'s Task 17B acceptance text verbatim **and** all Task 17C rows, and the stale "17B READY FOR REVIEW / PR #44 open" references in the 17C records (incl. `docs/accounting/owner-decision-baseline.md` §1/§5 D-8/§7/§8/§10) were replaced with the merged facts. Still documentation only: no production code, schema, migration, test, API, permission or dependency changed by the synchronization.

**Task 18 Accounting Reporting Read Foundation — 2026-09-25 (ACCEPTED):** the Task 18 Owner Decisions D1–D20 are the approved baseline for this separately authorized, bounded implementation slice even though older Task 17 records describe the broader Reporting Foundation as blocked by OQ-25/OQ-43. The branch adds one shared Accounting-owned read/query boundary over immutable `accounting.ledger_entries` and three explicit read-only GET APIs: `account-statements`, `general-ledger` and `trial-balance`. It adds independent General Ledger and Trial Balance permissions, organization/financial-area/fiscal-year isolation using existing deployment-pin and authorization conventions, same-year period/date semantics, readable OPEN/CLOSED/SEALED scope, exact Decimal/string calculations, POSTING/AGGREGATION roll-up without parent/child double counting, bounded pages and hard row limit, deterministic allow-listed sorting, transaction timeout and source references. Account Statement behavior remains backward-compatible through the shared repository adapter. Authoritative Accounting models were checked for General Ledger document type and source reference fields; unavailable fields were not fabricated. D5 is resolved as Ledger-native: `accounting.ledger_entries` is authoritative, while the Task 12 balance projection is a derived/rebuildable turnover-only read optimization; Task 18 reconciles opening, turnover and closing directly from exact Ledger facts and introduces no second monetary truth. No generic Reporting module, Report Builder, report persistence, EAV/JSONB schema, migration, export/print/statutory layout, cross-context calculation or other bounded-context work was added. **Governance status: ACCEPTED (2026-09-25)** — PR **#46** was reviewed by the Repository Owner/Reviewer before merge and **MERGED** into `main` in `e774a1c37c921ba83e4e9c23729fde6205cedb76` (reviewed implementation head `5971bed`; review-fix commits `4182346`/`0d9cf76`, the final review-fix addressing the D5 source-of-truth/reconciliation point and containing no production change). Acceptance record: `docs/tasks/task-18/task-18-acceptance-record.md`.

Acceptance evidence: focused D5 reconciliation **2 passed**; accounting unit suite **43 files / 538 tests**; full backend unit suite **97 files / 1,100 tests**; typecheck, build, format and `git diff --check` passed; lint zero errors with six pre-existing warnings in unrelated files (**not** Task 18 failures); CI run **36133360887** on PR #46 head `5971bed` with the `backend` job **completed success** (Prisma validation/generate, lint, typecheck, format, unit tests, build, `migrate deploy`, migration rehearsal and E2E incl. the live-DB suites on `postgres:16`). CI predates the documentation/test-only review-fix commits and is **not** claimed to have executed them; the focused reconciliation test and the local full validation covered the post-fix state. Implementation report `docs/tasks/task-18/task-18-implementation-report.md` §6/§9; acceptance record `docs/tasks/task-18/task-18-acceptance-record.md`. **OQ-25/OQ-43 remain OPEN**, Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED and NOT complete, and this acceptance closes none of Task 18's explicitly out-of-scope capabilities (Report Builder, exports, Legal Books, treasury/settlement/AR-AP/sales/purchase, cross-year carry, code migration, configurable dimensions, UI Account Overview, new monetary source of truth).

**Task 17C Acceptance Sync — 2026-09-25 (documentation-only governance acceptance):** the Owner formally accepts **Task 17C — Accounting Decision Consolidation** after the governance review and the PR **#48** factual-drift correction (merged into `main` in `7f8e3e8`). The accepted decision set is preserved exactly as recorded in `docs/accounting/owner-decision-baseline.md` — Owner decisions **Q1–Q22**, invariants **I-1…I-3**, discrepancies **D-1…D-13** (D-8 RESOLVED by the PR #44 merge in `2892189`) and open items **O-1…O-12** — with nothing reinterpreted, expanded or altered. Accepted: the owner decision consolidation; the governance documentation synchronization; the recorded decisions as authoritative; the ADR proposals as accurate reflections of those decisions; that the task introduces no production behavior; that unresolved OQs remain unresolved; and that future implementation requires separate authorized tasks. **OQ-25 and OQ-43 remain OPEN — acceptance of Task 17C resolves neither.** **ADR-0033/0034/0035/0036/0037 remain Proposed**: per the repository ADR convention, task acceptance does not promote an ADR (precedents: ADR-0031 stayed Proposed after Task 12's acceptance; the Task 17B and Task 18 acceptances promoted no ADR; the PR #48 governance review recorded “task acceptance ≠ ADR acceptance”; each ADR carries “not Accepted, no self-acceptance”) — each ADR remains pending its separate adoption/implementation gate, and the ADR subjects (account code history implementation, the code migration service, non-leaf posting, legal/statutory reporting, configurable accounting configuration implementation) remain future/controlled concepts, not implemented production capabilities. **Task 17 overall remains FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS (BLOCKED) and is NOT complete** — its later implementation/governance prerequisites, especially OQ-25 and OQ-43, remain unresolved. **No production code, TypeScript, Prisma schema, migration, API, permission, dependency, UI or test was touched by this synchronization** — it changes only `STATE.md`, `docs/accounting/task-index.md`, `docs/accounting/owner-decision-baseline.md` (status header + version entry) and adds `docs/tasks/task-17/task-17c-acceptance-record.md`. Acceptance record: `docs/tasks/task-17/task-17c-acceptance-record.md`.

**E2E hang root-cause investigation & repair gate — 2026-09-26 (test infrastructure only, pre-Task-19-implementation):** the recurring report that `npm run test:e2e` hangs was investigated diagnose-first on `arena/01a0dccb-vardena` before any Task 19 implementation. Findings (full record: `docs/testing/e2e-hang-root-cause.md`): the hang class is a test-owned Nest application whose `app.close()` — the only deterministic shutdown of the shared PrismaService `pg` pool — is reachable only on the happy path; PR **#14** (2026-09-14) root-caused and fixed this for the then-existing live suites and the harness init path, and PR **#33** (Task 15) added the CI `timeout 540` **containment** (verified via the GitHub API to have never fired: every failed CI E2E step since completed in 33–90 s with concrete assertion annotations — no CI hang has ever occurred). Fresh reproduction at current HEAD against real PostgreSQL 16.4 with all 15 migrations: **not reproducible** — 8 pre-fix and 3 post-fix full runs all terminated exit 0 (live path 334 tests / 29 files post-fix, ~60–69 s; hermetic path 249 passed / 85 skipped). Termination-envelope probes on the actual Vitest 4.1.11 forks pool established: leaked in-worker handles and teardowns blocked on PostgreSQL row locks are bounded (worker force-termination / hookTimeout); the only unbounded phase is import-time blocking, of which the repository has none. One residual defect of the root-cause class was found and fixed: `backend/test/deployment-scope.e2e-spec.ts` closed its phase-1 seed application only on the happy path (now `try/finally`). Regression protection added: `backend/test/harness-lifecycle.e2e-spec.ts` (3 tests pinning pool release on `app.close()`, provider destruction after failed `app.init()`, and zero residual TCP handles), passing under both the generated client and the committed stub. No production code, schema, migration, API, permission, dependency, vitest configuration or CI behavior changed; no `.skip`/`.only`/force-exit/timeout-increase workaround introduced; the CI `timeout 540` is retained and documented as a detection tripwire, not a fix. PostgreSQL verification: after the final run `pg_stat_activity`/`pg_locks` showed zero leftover test connections and zero waiting locks. Limitations recorded in the report §8 (sandbox cannot run `prisma migrate deploy`; migrations applied as raw SQL in order; CI verification of this branch is its PR run). **Task 19 implementation remains NOT YET STARTED and is unblocked by this repair gate.**

## 10.5 Post-Task-30 Current Governance State — Task 31 Reconciliation (2026-09-28)

This dated addendum is the current post-Task-30 reference; the dated task-history records above remain historical. Audit baseline is `main` / `016ecf09cdae7c64aa4774e857fd0a87e16099d1` (merge of PR #80).

- **Task 30:** implemented and merged at `016ecf09cdae7c64aa4774e857fd0a87e16099d1`; PR #80 is merged. CI run `36478305767` is green for backend and frontend. Task 30's implementation report/acceptance matrix record its checks as passed; no separate Owner acceptance record was found, so `MERGED`/green CI is not silently relabeled `ACCEPTED`.
- **Owner Decisions:** OD-27-02 and OD-29-01..OD-29-06 are decided (OD-29-05 = Option C). OD-27-01, OD-27-03, OD-27-04 and OD-28-01..OD-28-06 remain pending. Task 31's matrix distinguishes DECIDED, IMPLEMENTED, MERGED and ACCEPTED.
- **Task 30 semantics:** Account Nature is exactly `DEBIT`, `CREDIT`, `DUAL`; `DUAL` is legitimate and Nature does not prohibit opposite-side posting. Account Type is exactly `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`, independent from Nature, and Draft/Temporary references do not freeze it; posted-ledger evidence does. Detail is first-class, organization-configurable, hierarchical and linked from Account to a Level-1 Detail Group; boundary validation and confirmed atomic unlink semantics are implemented.
- **Statement Classification:** OD-29-05 Option C is decided but not implemented. It is independent from Chart, Account Type, Nature, Detail and System Account; it is not required by Accounting Core. Reporting Foundation is the future implementation area.
- **Base Chart:** the mechanism exists and remains MVP-required; concrete content is not MVP-required and no FaraPayam chart content, account seeds, Persian titles or codes have been loaded. OQ-25 remains open for content-level questions.
- **Open Questions:** OQ-25, OQ-36, OQ-41 and OQ-43 remain open in the affected areas; Task 30 did not falsely close them. Other OQs retain registry statuses.
- **ADR status:** no ADR was promoted by Task 30 or Task 31; Proposed ADRs remain Proposed and Accepted ADRs remain Accepted.
- **MVP boundary:** Treasury, Purchasing, Purchasing→Accounting and Purchasing Reports remain outside MVP/post-v1; no implementation is authorized by this addendum.
- **Current implementation gate:** `docs/tasks/task-31/next-implementation-gate.md` is authoritative after Task 30. The next production direction is **BLOCKED — OWNER DECISION REQUIRED**; a roadmap candidate, green CI, or this addendum is not authorization.

## 10.6 Current Repository State — 2026-09-29 Reconciliation

This is the current-state addendum. It supersedes §10.5 only as a snapshot; it does not rewrite Task 31 or any other historical record. Exact audited baseline: `main` / `34dddfd60d6ce2f9d4599bd05b440556a80aa847` (merge of PR #88). Full evidence, Documentation Truth Matrix, OQ/ADR reconciliation and drift log: [`docs/current-state-reconciliation.md`](docs/current-state-reconciliation.md).

- **Inventory:** nine backend modules, eight PostgreSQL schemas, 55 Prisma models, 18 migrations, 48 controllers, 142 permissions, 113 backend unit-spec files and 34 backend E2E-spec files.
- **Task 30:** PR #80 is merged. Nature (`DEBIT`, `CREDIT`, `DUAL`), Type (`BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`), posted-ledger Type immutability, and the bounded configurable Detail hierarchy/account-link/line-allocation/unlink foundation exist. This does not implement every conceptual multi-dimension feature or close OQ-41. No separate Owner acceptance record was found.
- **Task 32:** PR #85 is historical initial implementation; corrective PR #86 (`721aec5`) is current. It provides complete balances pagination through one cancellable query, exact signed presentation aggregation, cross-row period aggregation, periods-with-turnover KPI, independent period permission gating, complete widget states, backend-supported `onHand:asc` inventory ordering, formatting fixes and tests. No separate Owner acceptance record was found.
- **Frontend governance:** Standards v2.2 is active. FE-ARCH-01 retains TanStack Query for server state and records that a global store is not needed now. FE-UX-01 is documentation/UX contract only and adds no backend or frontend capability.
- **Authority boundaries:** Dashboard reference HTML is visual only. FaraPayam is reference/compatibility/migration/testing evidence only. Neither is production architecture or Base Chart content authority.
- **Base Chart:** mechanism/configuration exists; concrete content is absent and not MVP-required; validation exists only where implementation/tests prove it. OQ-25 remains Open.
- **Governance:** no OQ is closed and no ADR is promoted by this reconciliation. ADR-0027 still does not exist. Proposed ADR subjects that are implemented remain an explicit Owner governance backlog.
- **Scope:** Treasury remains outside MVP. Purchasing, Purchasing→Accounting and Purchasing Reports remain post-MVP. Inventory Warehouse Receipt/Issue remain distinct MVP Inventory capabilities.
- **Gate:** no new task number is created. The next production direction still requires explicit Owner authorization and satisfaction of its recorded OQ/ADR/domain gates.

## 11. Maintenance Rules

Update STATE.md after task kickoff, important architecture decisions, new Open Questions, scope changes, risk changes, ACCEPTED, CHANGES REQUIRED, merge and task closure. Each update must preserve the complete current state, not only a patch or the latest task. Keep dated evidence and uncertainty; do not erase historical decisions or silently change statuses. Record PR, branch, reviewed commit, tests actually executed, manual verification and owner decision in task records. A fresh report must distinguish observed results from old reports.

No workflow automation or GitHub integration was added by this bootstrap. Repository-centered handoffs still require the roles above to read/write approved records. No push or PR is authorized by this bootstrap.

### Bootstrap preservation register

The following pre-existing documentation files were inventoried and preserved unchanged. Inspection depth varied: root/onboarding, task status, Accounting contracts/code and ADR decision/status sections were targeted; unrelated product/domain documents were title/path inventoried, not re-reviewed or re-approved. Existing evidence logs under `docs/accounting/task-12-evidence/` and `task-13-evidence/` were located and preserved, not treated as fresh results.

- `README.md`
- `backend/README.md`
- `.vardena/agent-rules.md`
- `.vardena/architecture-rules.md`
- `.vardena/project-context.md`
- `docs/accounting/configuration.md`
- `docs/accounting/domain-contract.md`
- `docs/accounting/lock-order-matrix.md`
- `docs/accounting/task-11-mark-operationally-used-decision-note.md`
- `docs/accounting/task-12-balance-projection-promotion-package-fa.md`
- `docs/accounting/task-index.md`
- `docs/adr/0001-modular-monolith.md`
- `docs/adr/0002-technology-stack.md`
- `docs/adr/0003-legacy-erp-adapter-isolation.md`
- `docs/adr/0004-outbox-pattern.md`
- `docs/adr/0005-domain-events-inventory-accounting.md`
- `docs/adr/0006-rbac-granular-permissions.md`
- `docs/adr/0007-server-side-sessions.md`
- `docs/adr/0008-single-database-module-schemas.md`
- `docs/adr/0009-reporting-views-raw-sql.md`
- `docs/adr/0010-db-backed-job-queue.md`
- `docs/adr/0011-excel-import-workflow.md`
- `docs/adr/0012-print-template-system.md`
- `docs/adr/0013-user-preference-key-value.md`
- `docs/adr/0014-openapi-contract.md`
- `docs/adr/0015-backend-foundation-conventions.md`
- `docs/adr/0016-rbac-enforcement-and-evaluation.md`
- `docs/adr/0017-inventory-ledger-as-source-of-truth.md`
- `docs/adr/0018-bounded-versioned-workflow.md`
- `docs/adr/0019-document-foundation-and-relations.md`
- `docs/adr/0020-organizational-scope-and-master-data.md`
- `docs/adr/0021-organization-scoped-master-data.md`
- `docs/adr/0022-inventory-core-ledger.md`
- `docs/adr/0023-document-foundation-implementation.md`
- `docs/adr/0024-workflow-foundation.md`
- `docs/adr/0025-single-organization-deployment-pin.md`
- `docs/adr/0026-accounting-bounded-context.md`
- `docs/adr/0028-accounting-configuration-foundation.md`
- `docs/adr/0029-machine-api-access-model.md`
- `docs/adr/0030-license-foundation.md`
- `docs/adr/0031-balance-projection.md`
- `docs/adr/0032-accounting-period-close-enforcement.md`
- `docs/adr/README.md`
- `docs/architecture/domain/README.md`
- `docs/architecture/domain/accounting-domain-analysis.md`
- `docs/architecture/domain/configurability-architecture.md`
- `docs/architecture/domain/document-architecture.md`
- `docs/architecture/domain/domain-blueprint.md`
- `docs/architecture/domain/domain-decisions.md`
- `docs/architecture/domain/domain-glossary.md`
- `docs/architecture/domain/inventory-domain-analysis.md`
- `docs/architecture/domain/master-data-strategy.md`
- `docs/architecture/domain/workflow-architecture.md`
- `docs/architecture.md`
- `docs/database-strategy.md`
- `docs/decisions/product/OQ-44-multi-device-offline-sync.md`
- `docs/decisions/product/OQ-45-license-expiry-behavior.md`
- `docs/decisions/product/OQ-46-customer-data-export-format.md`
- `docs/decisions/product/OQ-47-exchange-rate-and-multicurrency-rules.md`
- `docs/decisions/product/OQ-48-revaluation-and-fx-gain-loss.md`
- `docs/decisions/product/OQ-49-report-builder-mvp-depth.md`
- `docs/decisions/product/OQ-50-webhooks-and-api-surface.md`
- `docs/decisions/product/OQ-51-taxpayer-release-boundary.md`
- `docs/decisions/product/OQ-52-backup-rpo-rto-targets.md`
- `docs/decisions/product/OQ-53-disaster-recovery-and-restore.md`
- `docs/decisions/product/OQ-54-finalized-document-deletion-editing.md`
- `docs/decisions/product/OQ-55-branch-as-cost-center.md`
- `docs/decisions/product/OQ-56-two-book-accounting.md`
- `docs/decisions/product/OQ-57-marketplace-extension-security.md`
- `docs/decisions/product/OQ-58-public-release-vs-internal-only.md`
- `docs/decisions/product/OQ-59-product-family-vs-consolidation.md`
- `docs/decisions/product/OQ-60-mvp-acceptance-thresholds.md`
- `docs/decisions/product/OQ-61-crm-ticketing-timing-ownership.md`
- `docs/decisions/product/README.md`
- `docs/integrations.md`
- `docs/modules.md`
- `docs/open-questions.md`
- `docs/product/development-roadmap-v1.md`
- `docs/product/execution-report-v1.md`
- `docs/product/mvp-scope-proposal-v1.md`
- `docs/product/product-business-decision-baseline-v1.md`
- `docs/reporting-strategy.md`
- `docs/security.md`
- `docs/task-10.4-implementation-report.md`
- `docs/task-10.5-implementation-report.md`
- `docs/task-10.7-implementation-report.md`
- `docs/task-10.8-implementation-report.md`
- `docs/task-11-defect-resolution-report.md`
- `docs/task-11-final-verification-report.md`
- `docs/task-11-implementation-report.md`
- `docs/task-12-final-review-fa.md`
- `docs/task-12-implementation-report.md`
- `docs/task-12-remediation-report.md`
- `docs/task-13-implementation-report.md`
- `docs/task-14-implementation-report.md`
- `docs/task-6-implementation-report.md`
- `docs/task-9-implementation-report.md`

## 12. Frontend Standards v2.1 Governance Update

This addendum records the frontend governance task without rewriting or removing any historical project state above. The official frontend/UI rulebook is `docs/frontend/standards.md`; before any frontend/UI implementation, modification, refactor, component creation, page creation, frontend dependency decision, or UI review, the complete standard must be read and treated as an engineering contract.

### UI Open Questions

UI: OQ-1 — Jalali DatePicker
UI: OQ-2 — Dark mode
UI: OQ-3 — Default density
UI: OQ-4 — OpenAPI type generator
UI: OQ-5 — Unauthorized capability behavior
UI: OQ-6 — Device target
UI: OQ-7 — Token transport
UI: OQ-8 — Error monitoring / Web Vitals
UI: OQ-9 — React Compiler

These frontend Open Questions remain open and require the owner's decision through the appropriate ADR/decision process. No ADR or implementation decision is created by this task.

### Task State

Task: docs/frontend-standards (v2.1)
Status: ACCEPTED-PENDING-OWNER
Owner Behavioral Verification: PENDING

## 13. Task 33 — Organization Provisioning & First-Login Readiness (2026-09-30)

This addendum records a focused implementation task without rewriting or
removing any historical project state above. Full findings, root cause,
decision and verification: `docs/task-33-organization-first-login-provisioning-report.md`.

- **Reported symptom:** the bootstrap administrator (`مدیر`) authenticates
  successfully but the frontend reaches the terminal "no organization
  available" screen with no recovery path besides logging out.
- **Root cause (verified, not assumed):** the repository's default
  configuration is **unpinned** (`DEPLOYMENT_ORGANIZATION_ID` unset — commented
  out in `backend/.env.example`, empty-default in `docker-compose.yml`).
  Unpinned mode intentionally invents no organization (ADR-0021 structural
  mode; Task 26 / ADR-0038 only provisions an organization + membership in
  **pinned** mode). The backend has always allowed an authorized principal
  (one holding `Organization.Organization.Create` and
  `Organization.Membership.Grant` — which the bootstrap administrator's full
  RBAC role already holds) to create the first organization and self-grant the
  first membership through the existing, unmodified
  `POST /organizations` + `POST /organizations/:id/members` endpoints and the
  existing first-member bootstrap exception. **The frontend's `empty`
  organization state offered no way to reach that path** — this was the actual
  defect: a missing frontend integration of an existing, architecturally
  correct backend capability.
- **Decision:** Option C (both modes), matching what was already implemented.
  Pinned mode (Task 26 / ADR-0038) is unchanged. Unpinned mode gets a small,
  additive frontend capability only.
- **Backend changes:** **none.** No schema, migration, endpoint, permission
  code, or guard changed. Re-ran the full backend suite (113 unit spec files /
  1,319 tests; 20 e2e spec files / 278 tests, 14 live-DB files correctly
  skipped without `VARDENA_TEST_DATABASE_URL`) to confirm zero regression from
  a zero-line backend diff.
- **Frontend changes:** `OrganizationGate`'s `empty` state now renders a
  first-organization bootstrap form (`CreateFirstOrganizationForm`) instead of
  the unconditional terminal explainer, but **only** for a session holding
  both `Organization.Organization.Create` and `Organization.Membership.Grant`
  (UX-only gating, AR-21; the backend re-checks both permissions on both
  calls). Every other session sees the unchanged terminal explainer. 3 new
  frontend files, 8 files touched, +206/−10 lines; 5 new frontend tests (217/217
  total frontend tests pass); frontend typecheck/lint/format/build all pass.
- **No wildcard, bypass, frontend-only organization state, hardcoded
  organization id, or new deployment model was introduced.**
- **Scope:** frontend-only capability addition plus documentation; no
  Financial Area, Fiscal Year, Accounting Period, RBAC, or organization-role
  redesign was touched.
- **Not accepted by this addendum:** as with every other entry in this file,
  merge/CI-green is not Owner acceptance.

### 13.1 PR #96 follow-up — rebase onto L-01 licensing foundation (2026-10-01)

PR #97 ("L-01: licensing foundation and entitlement architecture",
`docs/adr/0030-license-foundation.md`) merged into `main` after PR #96 (this
Task 33 work) was opened, adding an installation License → Entitlement →
assignable Permission catalog layer in front of RBAC. This follow-up rebased
PR #96 onto the new `main`, audited §13's implementation against it, and
applied the one compatibility fix the audit found necessary — full findings
in `docs/task-33-organization-first-login-provisioning-report.md` §17–§25.

- **No backend contract PR #96 depends on changed.**
  `CreateOrganizationDto`/`GrantMembershipDto`/`OrganizationResponseDto` and
  the whole membership module are byte-for-byte unchanged by L-01.
- **Most of L-01's effect on PR #96 is already transparent.**
  `AuthorizationService.effectivePermissionCodes` now intersects stored RBAC
  grants with licensed modules, and PR #96's frontend already reads that
  exact filtered set through the pre-existing `GET /permissions/effective`
  contract — no code change was needed for `Organization.Organization.Create`
  / `Organization.Membership.Grant` to stay license-aware.
- **The one compatibility fix:** ADR-0030 explicitly calls out that "PR #96's
  first-organization UX must call the license-state endpoint before offering
  organization provisioning." Before this fix, a session holding both
  organization permissions but blocked only because the installation license
  was inactive saw the same generic "you lack permission" explainer as a
  session with no permission at all. The frontend now reads the existing
  `GET /license/current` self-read (already shipped by L-01, no RBAC
  permission required, no new backend endpoint added) before evaluating the
  RBAC-gated first-organization affordance, and shows a distinct "license is
  not active" explainer when appropriate. This is read-only UX routing, not
  enforcement — no count/limit comparison was added client-side, and
  `OrganizationsService.createOrganization` remains the sole enforcement
  point.
- **No frontend-side license enforcement of any kind was added** — no
  threshold checks, no reading license state from storage/env, no
  admin/role/NODE_ENV bypass, no second "licensed permissions" mechanism.
- Rebased cleanly (no conflicts) onto `main` `841b685`. The rebase itself
  produced intermediate commit `f9477b6b770787cd5745a04323d38481b98c238f`
  (the compatibility-fix implementation), verified at the time by GitHub
  Actions CI run `36830490998` (backend incl. live-DB E2E, frontend, all
  passing). A subsequent documentation-only commit moved the branch/PR HEAD
  to `487d363c3bfe397f7480e992dbf6027c9108cbb9` — see §13.2 for the current,
  authoritative head/CI evidence; `f9477b6`/`36830490998` are historical only
  and are not the current state of PR #96.
- **Not accepted by this addendum either** — same rule as every other entry
  in this file.

### 13.2 Documentation/evidence correction (2026-10-01)

Follow-up to §13.1: after §13.1 was written, a documentation-only commit
(adding `docs/task-33-organization-first-login-provisioning-report.md`,
this §13.1/§13.2 addendum, and the `docs/security.md`/`frontend/README.md`
clarifications) was pushed, moving PR #96's HEAD from `f9477b6` to
`487d363`. §13.1's closing bullet still named `f9477b6`/`36830490998` as the
"final"/current state after that happened; this entry corrects that without
rewriting §13.1's history.

- **Current PR #96 HEAD:** `487d363c3bfe397f7480e992dbf6027c9108cbb9`
  (confirmed via `git rev-parse HEAD` and `gh pr view 96 --json
headRefOid`).
- **Current PR #96 base:** `841b68545b6be36aeb65f523474b4261973875b8`
  (`main`'s current tip — unchanged since §13.1; PR #96 was not re-rebased
  for this correction, only a new commit was added on top).
- **Current authoritative CI:** GitHub Actions run `36831107322`
  (`.github/workflows/ci.yml`), confirmed tied to commit `487d363` via
  `gh run view 36831107322 --json headSha`. Both jobs `success`: `backend`
  (incl. Prisma validate/generate, unit tests, and **E2E tests incl.
  live-DB suites**) and `frontend` (lint/typecheck/format/tests/build).
- `f9477b6` and CI run `36830490998` remain valid as the historical record
  of the compatibility-fix implementation commit (§13.1) but are
  **superseded** as "current" evidence by the above.
- **No production code, backend source, or implementation file changed** in
  this correction — documentation only.

### 13.3 Second evidence correction (2026-10-01, same day)

Writing §13.2 itself required a commit, which moved PR #96's HEAD from
`487d363` to `abd5134d793ef4b87088afad0f7f9fe04ace9127` — the same
mechanical effect §13.2 corrected for `f9477b6`→`487d363`. Documenting a
branch's own HEAD always trails by exactly the commit doing the documenting;
see `docs/task-33-organization-first-login-provisioning-report.md` §27 for
the full explanation and the rule adopted going forward (describe the
implementation commit `f9477b6` as the verified baseline, treat every commit
after it as an independently-CI-verified, production-behavior-unchanged
documentation correction, and read `git rev-parse HEAD` /
`gh pr view 96 --json headRefOid` for the literal current value instead of
trusting a frozen SHA in prose).

- **Current PR #96 HEAD at time of writing:**
  `abd5134d793ef4b87088afad0f7f9fe04ace9127`.
- **Current authoritative CI:** GitHub Actions run `36840117957`, tied to
  `abd5134` (`gh run view 36840117957 --json status,conclusion,headSha` →
  success/completed/`abd5134...`). Both jobs `success`, backend incl.
  E2E/live-DB suites.
- `487d363`/run `36831107322` (§13.2) and `f9477b6`/run `36830490998`
  (§13.1) remain valid historical records, superseded only as "current."
- `git diff --stat -- backend/` and `-- frontend/src/` between `487d363` and
  `abd5134` are both empty — documentation-only, same as every correction in
  this chain.

## 14. FE-ORG-01 — Organization & Master Data Administration, frontend (2026-10-01)

This addendum records a focused frontend task without rewriting or removing any
historical project state above. Full audit evidence, decisions and verification:
`docs/task-fe-org-01-implementation-report.md`.

- **Scope:** a frontend vertical slice over the organization module's
  **existing** HTTP contracts — organization profile, Branch, Department,
  Employee and Party: list / detail / create / edit / enable / disable, with
  server-side pagination, filtering, search and sorting, permission gating and
  organization scoping.
- **Backend changes: none.** No controller, service, DTO, permission code,
  guard, schema or migration was touched (`git diff --stat -- backend/ prisma/`
  on the implementation commit is empty). Every surface was built from the
  contracts read out of
  `backend/src/modules/organization/api/*.controller.ts` and their DTOs — not
  from documentation and not from a service or Prisma-model name.
- **No delete was invented.** None of these controllers exposes `DELETE`; the
  lifecycle is the `is_active` flag
  (`docs/architecture/domain/master-data-strategy.md` §7.4, OQ-36), so the UI
  offers exactly enable/disable, on the detail pages, behind `ConfirmDialog`.
- **Permission alignment follows the endpoints, not convention:** `…/new`
  requires only `*.Create` (the `POST` routes enforce no `View`), while
  `…/:id/edit` requires `View` + `Edit` because the screen reads before it
  writes. Gates remain UX only (AR-21); the backend authorizes every request.
- **Organization scope** always comes from the existing `OrganizationContext`
  (no id input, no URL id, no organization browser, no second context
  implementation), and an organization write also invalidates the
  session-global organization list the switcher renders.
- **Registered contract gap (no workaround applied):** the organization
  services raise `AppException.businessRule(...)` / `.conflict(...)` **without**
  a `details` payload, so a 409/422 carries no machine-readable discriminator.
  The frontend therefore maps failures by error **code × resource × operation**
  and never parses the backend `message`. No backend change was requested for
  it in this slice.
- **Deferred, recorded, not built:** organization **membership** administration
  (deferred by design), a second organization-creation path (`POST
/organizations` is owned by the PR #96 first-login bootstrap), bulk import,
  Excel export, advanced search builder, custom columns, saved filters,
  audit-history UI, attachments, notes, org-chart visualization, drag/drop
  hierarchy, bulk enable/disable, and every party field the DTOs do not declare
  (national id, economic code, tax classification, address, bank account —
  OQ-30, OQ-38).
- **Frontend changes:** 29 new files under
  `frontend/src/features/organization/admin/` plus 8 touched files
  (`api/contracts.ts`, `api/organization.api.ts`, `api/query-keys.ts`,
  `app/router.tsx`, `app/navigation.ts`, `features/permissions/permission-codes.ts`,
  `lib/i18n.ts`, `test/fixtures.ts`). No accounting route, component or test was
  modified; unknown routes behave exactly as before.
- **Local verification (executed):** `npm run lint` 0/0, `npm run typecheck`
  exit 0, `npm run format:check` clean, `npm test` **39 files / 277 tests
  passed** (baseline before the change: 33 files / 218 tests — 6 new test files,
  59 new cases, no pre-existing test modified or skipped), `npm run build`
  exit 0. E2E was **not** run locally; the backend job of GitHub Actions is the
  authoritative E2E signal, per `docs/testing/test-execution-policy.md`.
- **No wildcard, admin/NODE_ENV/storage/email bypass, frontend-only
  authorization, hard-coded license limit, mock endpoint, generic
  `crudApi<Entity>`, second HTTP client or new state library was introduced.**
- **Not accepted by this addendum:** as with every other entry in this file,
  merge/CI-green is not Owner acceptance.

## 15. FE-LICENSE-BOOTSTRAP — Licensing bootstrap & organization flow integration, frontend (2026-10-01)

This addendum records a focused frontend task without rewriting or removing any
historical project state above.

- **Scope:** insert the licensing stage into the authenticated frontend
  bootstrap, between the session and the existing organization stage, so the
  fixed order is `login → session → license → organization → organization
context → workspace`. No new product surface, no license administration.
- **Backend changes: none.** `git diff --stat -- backend/ prisma/` on the
  implementation commit is empty. `GET /api/v1/license/current` was consumed
  exactly as `LicenseStateController.current()` already returns it — not
  renamed, not extended, no parallel endpoint, no DTO change. The frontend
  contract type `LicenseState` (`frontend/src/api/contracts.ts`) was already
  present and was not modified either.
- **One license source.** `features/licensing/use-license-state.ts` remains the
  only license abstraction (`queryKeys.licenseState()`, one query, read once
  per authenticated session). No `useLicense()`/`useCurrentLicense()`, no
  second context or API client, no entitlement registry, no `localStorage`/env
  copy and no development fallback were introduced. The hook was extended
  minimally: a four-value `status` (`loading | active | inactive | error`) so
  the states cannot be conflated, and the raw `LicenseState` so the contract's
  own `entitlements` collection can be consumed as-is.
- **The misleading-message defect this fixes.** Because
  `AuthorizationService.effectivePermissionCodes` filters stored grants through
  `LicensingService.filterLicensedPermissions`, an inactive license yields an
  empty effective permission set; the organization gate therefore reported
  "you lack permission" for an installation whose license was simply not
  active, and the license check added by §13.1 sat in a branch that state
  could not reach. The licensing stage now answers first and owns its own
  Persian copy, so license and permission are never confused.
- **No client-side enforcement was added** (AR-21, ADR-0030): no count is
  compared against `organizationLimit`/`userLimit`, no "remaining
  organizations" math, no entitlement semantics invented, no
  Customer/Installation/License identifier surfaced (the controller
  deliberately does not serialize them), and no admin/role/NODE_ENV/storage
  bypass. A failed license read is a retryable error state — never assumed
  active and never reported as inactive.
- **FE-ORG-01 / PR #96 preserved.** `OrganizationGate` is still the
  organization boundary and still owns the first-organization bootstrap; the
  licensing branches were removed from it (they moved up one stage, not
  duplicated), and the create/membership sequence is unchanged and covered by
  a regression test behind an active license.
- **Frontend changes:** 3 new files (`app/layouts/license-gate.tsx`,
  `app/layouts/bootstrap-states.tsx`, `app/layouts/license-gate.test.tsx`) and
  9 touched (`app/layouts/app-shell.tsx`, `app/layouts/organization-gate.tsx`,
  `features/licensing/use-license-state.ts`, `lib/i18n.ts`, plus five test
  files that now mock the licensing read the shell performs). No backend,
  no route, no accounting surface and no organization administration file was
  touched.
- **Local verification (executed):** `npm run lint` 0/0, `npm run typecheck`
  exit 0, `npm run format:check` clean, `npm test` **40 files / 286 tests
  passed** (baseline 39/277: +10 licensing-stage cases, 1 relocated),
  `npm run build` exit 0. There is no frontend E2E suite in
  `.github/workflows/ci.yml`; GitHub Actions is the authoritative signal.
- **No new ADR.** ADR-0030 already decided that the backend is authoritative
  and that the frontend must read the license state before offering
  organization provisioning; this task implements that decision, so
  `docs/licensing-architecture.md` (the owning document) and
  `frontend/README.md` were updated instead of adding a competing record.
- **Not accepted by this addendum:** as with every other entry in this file,
  merge/CI-green is not Owner acceptance.

## 16. C-46 — Inventory Warehouse Master Completion, backend (2026-10-01)

This addendum records a focused backend task without rewriting or removing any
historical project state above. Full findings, gap matrix, implemented
changes and verification: `docs/tasks/task-33/`.

- **Numbering note (read before anything else in this section).** The work
  order that authorized this task titled it **"Task 33 — Inventory /
  Warehouse Master Completion"** and asked for a `docs/tasks/task-33/` folder.
  That number collides with the **already-merged, unrelated** §13 record
  above (**"Task 33 — Organization Provisioning & First-Login Readiness"**,
  PR #96, `docs/task-33-organization-first-login-provisioning-report.md`).
  Per AG-17 ("record, don't assume"), this section does **not** renumber §13,
  does **not** claim to be "the" Task 33, and does **not** edit
  `docs/accounting/task-index.md` (this is Inventory, not Accounting — forcing
  it there would misfile it, and the task's own instructions say so
  explicitly). The repository's actual cross-domain registry for this kind of
  item is the Future Task Candidate Register
  (`docs/roadmap/future-task-candidates.md`), where this work is **candidate
  `C-46` (Warehouse coding / master completion)**. The `docs/tasks/task-33/`
  folder exists because the work order required that exact path; its content
  refers to the work as "Task 33 (= roadmap candidate C-46)" throughout so a
  reader cannot confuse it with §13.
- **Scope:** verify the existing Inventory Warehouse master-data vertical
  slice (list/get/create/update/enable/disable) against the current
  repository contract and close genuine gaps only. Reconnaissance found the
  production implementation (`backend/src/modules/inventory/{domain,
application,data,api}/warehouse*.ts`) **already complete and correct**:
  organization scope via `OrganizationsService.assertOrganizationInScope` /
  `requireUsableOrganization`, branch validation via
  `BranchesService.requireUsableBranchInOrganization` (no cross-module Prisma
  access), organization-scoped code uniqueness (`uq_warehouses_organization_
id_code`, pre-check + unique-violation fallback), the two ADR-0022 lifecycle
  freeze guards (branch cannot change once `inventory_movements` exist for the
  warehouse; a warehouse cannot be disabled while `inventory_balances` still
  shows stock), explicit per-operation permissions
  (`Inventory.Warehouse.{View,Create,Edit,Enable,Disable}`), domain events
  (`Warehouse.{Created,Updated,Enabled,Disabled}`) fired only after a
  successful write, and a schema that already supports every required
  capability (**zero migration**).
- **The genuine gap was test coverage, not implementation.** `WarehousesService`
  had no dedicated unit spec at all; the two freeze guards had no test
  anywhere (in any module) that ever drove them into their blocking branch;
  no live-PostgreSQL suite existed for Warehouse (or for master data
  generally) to prove the organization-scoped unique constraint survives a
  real concurrent write race; and the hermetic HTTP suite
  (`master-data.e2e-spec.ts`) covered the warehouse journey once but never
  exercised duplicate-code 409, warehouse-specific cross-organization
  GET/PATCH IDOR, or a PATCH onto a foreign-organization branch.
- **Backend production changes: NONE.** `git diff --stat` touches only test
  files; no controller, DTO, service, repository, domain file, permission
  code, event, or Prisma schema/migration was changed.
- **Test changes (regression coverage only):**
  - New `backend/src/modules/inventory/application/warehouses.service.spec.ts`
    (24 cases): create/update normalization and validation, organization-scoped
    duplicate-code conflict and cross-organization code reuse, foreign-branch
    rejection on create and on update, **both freeze guards driven into their
    blocking branch** (via a controllable fake movements/balances seam) and
    confirmed non-blocking when the branch is unchanged or the balance clears,
    enable/disable idempotency and event-on-real-change-only,
    `requireUsableWarehouseInOrganization` (`allowInactive`), and
    list pagination/branch filter/active filter/search/sort allowlist.
  - Extended `backend/src/modules/organization/application/master-data-
authorization.spec.ts` with a new `WarehousesService authorization &
cross-organization IDOR` block (3 cases) driven through the REAL
    `AuthorizationService` + real RBAC repositories: anonymous 401, a
    distinct permission required per Warehouse operation (View+Create does
    not imply Edit/Enable/Disable), and a member of both organizations still
    cannot read/update/enable/disable a warehouse or reuse a branch belonging
    to the other organization (genuine IDOR, not a scope rejection).
  - Extended the hermetic `backend/test/master-data.e2e-spec.ts` (4 cases):
    duplicate warehouse code 409 within one organization, the same code
    allowed in a different organization, cross-organization GET/PATCH 404 by
    id (no-disclosure), and PATCH rejecting a foreign-organization branch.
  - New `backend/test/warehouse-master-live.e2e-spec.ts`
    (`describe.skipIf` on `VARDENA_TEST_DATABASE_URL`, the same opt-in
    pattern as `workflow-live.e2e-spec.ts` / `licensing-persistence-live.
e2e-spec.ts`): 5 cases against **real PostgreSQL** — organization-scoped
    code uniqueness surviving 8 concurrent `createWarehouse` calls for the
    identical `(organizationId, code)` (exactly one winner, the database
    unique index is authoritative, not the application pre-check), the same
    code reused across two organizations, organization isolation on real
    committed rows, branch isolation on create/update, and both lifecycle
    freeze guards exercised against real `inventory_movements`/
    `inventory_balances` rows produced by
    `InventoryMovementsService.postMovement` (including the disable guard
    lifting once the real balance is driven back to zero, and the branch
    guard staying permanent afterward).
- **No wildcard permission, role-name/username/system-admin/NODE_ENV bypass,
  second tenant-check mechanism, new schema, new migration, new module, new
  Item/Product/valuation/costing/Receipt/Issue/Material-Request/Purchasing/
  Treasury capability, or frontend change was introduced.** OQ-22, OQ-33 (and
  OQ-11, OQ-24, OQ-29, OQ-36, OQ-39, OQ-41, OQ-42, OQ-43, OQ-54) are preserved
  OPEN, none resolved implicitly.
- **Local fast verification (executed):** `npm run typecheck` clean,
  `npm run lint` 0 errors (1 pre-existing unrelated warning), `npm run
format:check` clean, `npm run build` OK, focused specs (`warehouses.
service.spec.ts` 24/24, `master-data-authorization.spec.ts` 25/25,
  `master-data.e2e-spec.ts` 41/41) all pass, and the full hermetic unit suite
  (`npm test`) **120 files / 1391 tests passed** (no pre-existing test
  modified or weakened). The new live-database spec was confirmed to be
  correctly **skipped** locally (no `VARDENA_TEST_DATABASE_URL`); it is
  wired into the existing `test:e2e` glob so GitHub Actions' `backend` job
  (which already provisions Postgres and sets `VARDENA_TEST_DATABASE_URL`)
  executes it for real — see `docs/tasks/task-33/test-evidence.md` for the
  actual CI run once available.
- **Not accepted by this addendum:** as with every other entry in this file,
  implementation/merge/CI-green is not Owner acceptance. This section also
  does not accept, re-accept, or alter the status of §13 (the other "Task
  33"), C-01..C-45, or any other candidate in the Future Task Candidate
  Register beyond updating C-46's own row.

## 17. C-47 — Inventory Item Master Readiness, Regression Hardening & Decision Preparation (2026-10-02)

This addendum records a focused backend hardening task without rewriting or
removing any historical project state above. Full findings, gap matrix,
defects/fixes, OQ-29/OQ-33 decision briefs and verification:
`docs/tasks/c-47-item-master-readiness-hardening-report.md` (companion to the
merged `docs/tasks/c-47-item-master-preflight-investigation.md`, PR #106).

- **Naming note.** The work order titled this task "C-47 — Inventory Item
  Master Completion". As with §16, the repository registry for this candidate
  is `docs/roadmap/future-task-candidates.md` row **C-47 (Product/item master
  completion)**; the preflight investigation (§-titled report referenced
  above) established that the item-master surface (items, eight-item kind
  taxonomy with capability defaults, item groups, units, global +
  item-specific effective-dated unit conversions, ledger freeze guards) was
  **already implemented and merged** — so this task was executed as bounded
  reconnaissance + regression hardening, exactly mirroring the C-46 pattern,
  not as a new implementation.
- **Scope:** verify the existing item-master vertical against the current
  contract, close demonstrable decision-independent defects only, and prepare
  OQ-29/OQ-33 for explicit Owner decision without selecting any option.
- **Three verified defects fixed (production code, decision-independent):**
  (1) **conversion supersession race** — version planning ran outside the
  write transaction; the repository now takes a pair-scoped
  `pg_advisory_xact_lock` inside the transaction, re-reads, re-plans with the
  same already-approved invariant, closes + inserts, and maps a stale plan to
  the same stable 422/409 contract (typed `ConversionPlanRejectedError`;
  raw-SQL documented in `docs/modules.md` per AR-11);
  (2) **`resolveConversion` cross-organization leak** — the item-scoped
  history was resolvable by an identifier of another organization's item; the
  path now enforces `assertOrganizationInScope` +
  `requireUsableItemInOrganization` (allowInactive, so disabled-item history
  stays resolvable exactly as before for searches; unauthorized scope remains
  an opaque boundary proven via the real auth path);
  (3) **generated frontend contract drift** — `CreateItemDto.requiresLot`/
  `requiresSerial`/`requiresExpiry` were emitted REQUIRED in
  `frontend/src/api/generated/vardena-api.d.ts` while the backend treats them
  as optional (kind-defaulted at create); DTO metadata corrected (no business
  semantics changed) and the types were **regenerated through the real
  pipeline** with a diff of exactly the three property blocks. Regression
  finding for the record: **no CI step checks OpenAPI/frontend-type drift**;
  the work recommends, but does not install, one (tooling policy).
- **Coverage added without changing business behavior:** new hermetic specs
  `units.service.spec.ts` (12), `item-groups.service.spec.ts` (14);
  `items.service.spec.ts` +9 (freeze guards — seams previously stubbed to
  never fire); `unit-conversions.service.spec.ts` +3 (window boundary, Fix-2);
  `inventory-posting-support.spec.ts` +8 (`resolveEnteredToBase`);
  `master-data-authorization.spec.ts` +5 (item-master IDOR);
  `master-data.e2e-spec.ts` +7 (47/47); new opt-in live-suite
  `backend/test/item-master-live.e2e-spec.ts` (**9 cases**: concurrent item
  code uniqueness, cross-org addressing with real rows, same-instant and
  supersession conversion races with pair-invariant assertions, backdated
  factor snapshot, no-conversion rejection, >4dp fail-closed rejection, real
  freeze guards). No pre-existing test was modified, weakened or skipped.
- **Deliberately unchanged (decision pending):** OQ-29 (per-unit precision,
  fractional rounding — current fail-closed >4dp rejection stays an
  implementation decision pending Owner sign-off; options A–D in the report),
  OQ-33 (kind list completeness + per-item vs per-kind capabilities; options
  A–D), barcode policy (no uniqueness/validation added), OQ-36 (item
  deletion/code-reuse), no new kinds/flags/columns/migrations.
- **Verification:** `npm test` 122 files / 1443 passed; full hermetic e2e
  328 passed + 132 deterministically skipped (live suites, no
  `VARDENA_TEST_DATABASE_URL` locally); typecheck/lint/prettier clean;
  frontend 305 tests passed + typecheck/lint/prettier/build green.
  Live-DB assertions are wired into the existing CI backend job
  (postgres:16 service + `VARDENA_TEST_DATABASE_URL`, `test:e2e` glob) and
  were **not** executed locally; CI is the authoritative execution
  environment. **No heavy E2E/live-DB test was executed locally unless
  explicitly authorized.** CI (PR #107): run `36991377976` executed the live
  suite and caught a real `$queryRaw`-on-PostgreSQL-`void` defect in the
  advisory-lock call (fixed via `$executeRaw` — exactly the defect class the
  live suite exists to catch); run `36992098706` backend + frontend **green**,
  live suite executed (`VARDENA_TEST_DATABASE_URL` is set in the backend job;
  previous-run failure annotations prove the skip gates were inactive).
- **Not accepted by this addendum:** implementation/merge/CI-green is not
  Owner acceptance. C-47 remains **BLOCKED BY OQ (OQ-29/OQ-33)** in the
  candidate register; this section does not accept, re-accept, or alter the
  status of §13/§16, C-01..C-46, or any other candidate.

## 18. C-47 — Owner Decisions, Status Reconciliation & Inventory Dependency Review (2026-10-02)

Documentation/governance addendum recorded after §17, at baseline `main` /
`4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107). It rewrites or
removes nothing above. Full record:
`docs/tasks/c-47-owner-decision-and-dependency-reconciliation.md`.

- **Scope:** documentation/governance and dependency reconciliation only. **No
  production code, Prisma schema, migration, API/DTO, generated type,
  permission or test was changed.** No warehouse operational implementation
  (receipt, issue, opening balances, other operational documents) was started.
  No full E2E, live-PostgreSQL, migration or migration-rehearsal command was
  executed.
- **Four explicit Owner decisions recorded** (records:
  `docs/decisions/product/PDR-01…PDR-04`, registry annotations in
  `docs/open-questions.md`):
  - **OD-C47-01 — OQ-29, Option A:** quantity precision fixed at **four
    fractional decimal places**; conversion results that cannot be represented
    exactly at the supported precision are **rejected**; **no rounding and no
    silent truncation**; conversion-factor changes use **effective-dated
    versions**; historical conversion versions and the data needed to interpret
    prior transactions are **preserved**. No production delta identified — the
    decided rule equals shipped behavior (`domain/quantities.ts`,
    `domain/unit-conversion.ts`, `numeric(18,4)`/`numeric(18,6)` columns).
    Independent sub-questions (per-unit entry precision, global-vs-item-specific
    precedence, reverse-pair derivation, the exactness boundary for future
    consumers, valuation precision, back-dated-version authority) are **not**
    closed.
  - **OD-C47-02 — OQ-33, Option D:** new item kinds or capability flags may be
    introduced **only** through an identified and accepted concrete need in the
    project's decision/governance process. **Option A is NOT recorded as
    approved:** the Owner has not confirmed the existing eight kinds or the
    current per-item configurable capability model, and that confirmation stays
    **OPEN**. The model is frozen, not approved.
  - **OD-C47-03 — Barcode, Option A (confirmed):** barcode optional; uniqueness
    enforced within an organization; two active items in one organization must
    not share a barcode; different organizations may; multiple formats with no
    strict symbology validation unless separately approved; no
    multi-barcode-per-item support. **No production code or schema changed.**
    Canonical-wording inspection found the deactivated-item case unresolved, so
    it is recorded, not inferred, as new **OQ-65** (reuse after deactivation,
    comparison semantics, inactive-vs-inactive collisions, re-activation,
    clear-and-reassign). Current `main` enforces **no** barcode uniqueness at
    all.
  - **OD-C47-04 — OQ-36, Option C:** physical deletion permitted **only** for an
    item never referenced by any operational, ledger or historical record; a
    referenced item must never be physically deleted; history and
    organization-scoped identity constraints are preserved. **The item-code
    reuse policy is NOT inferred from Option C** — reuse after physical deletion
    of a never-referenced item stays **OPEN**, as do case-sensitivity policy,
    soft-vs-hard delete shape, the reference-proof obligation, the delete
    permission/audit model and cross-entity scope.
- **OQ status after this addendum:** OQ-29, OQ-33 and OQ-36 are each
  **PARTIALLY RESOLVED and remain OPEN**; **OQ-65 is new and OPEN**. OQ-64
  remains the only Resolved row in the registry. No ADR was promoted.
- **C-47 status reconciliation:** PR #107 is merged and CI is green; **this is
  not Owner acceptance of the item master** (STATE.md §6). C-47 remains
  **NOT ACCEPTED** and **BLOCKED BY OQ**, with its blocking set narrowed from
  "OQ-29 + OQ-33" to "OQ-33 confirmation + OQ-65 + OQ-36 reuse".
- **Dependency review C-47…C-54 (verified against code, not identifiers):**
  OQ-11 is an _Accounting_ question (opening balance **import** + inventory
  **costing method**) and does not describe quantity-opening mechanics; OQ-24
  gates every valued/rial flow and its negative-stock half has an implemented
  fail-closed default that is not a decided policy; OQ-39/OQ-42 gate the
  accounting effect only; **OQ-23 and OQ-54 are genuine, previously unlisted
  prerequisites** of the opening and receipt/issue flows; **OQ-49 blocks only a
  generic report builder**, not bounded code-defined inventory reports. The
  inventory ledger has **no cost column**, there is deliberately **no `opening`
  movement type**, and Inventory has registered **no** document type (only
  Accounting uses the Documents type registry).
- **C-50 (Material Request) investigation complete — implementation BLOCKED.**
  The evidence/decision brief is
  `docs/tasks/c-50-material-request-investigation.md`. C-50 remains the only
  C-48…C-54 candidate with no valuation, costing or durable-posting gate, but
  implementation still requires OQ-54, OQ-13/OQ-26, an explicit reservation/C-52
  answer, the minimum domain contract, and separate Owner admission.
- **Bounded C-47 implementation follow-up:** justified in principle for barcode
  uniqueness (candidate **C-55**) and item physical deletion (candidate
  **C-56**), but **both are blocked** — C-55 by OQ-65 (every index shape
  silently answers it) and C-56 by the open code-reuse semantics. The only
  non-blocked C-47 work was documentation, completed here.
- **Not accepted by this addendum:** it accepts nothing, authorizes nothing, and
  makes no claim of Owner acceptance for its own pull request.

## 19. Post-C-50 Dependency Reconciliation & Next-Slice Readiness (2026-10-03)

Documentation/governance addendum at current `main` /
`ca981018ddc027306da8f28805ded22c2fbd1d19`, merge of PR #112. Full report:
`docs/tasks/post-c-50-dependency-reconciliation-and-next-slice-readiness.md`.

- **C-50 current state corrected:** PR #112 is **MERGED**. Exact-main push CI
  run `37100066679` completed successfully for backend and frontend, including
  backend Prisma validation/generation, migration deployment, migration
  rehearsal and E2E/live-DB execution. C-50 is **IMPLEMENTED AND MERGED — NOT
  ACCEPTED**; no acceptance record exists and merge/green CI is not acceptance.
- **Implemented C-50 boundary:** Inventory owns Material Request header/line/
  event persistence, a code-registered Documents type, numbering, bounded
  lifecycle/API, 11 permissions, optional exact per-line reservation and
  invocation traceability/consumption. It remains non-valued and non-posting:
  no Receipt/Issue movement, valuation or Accounting effect is created.
- **Decisions made versus still open:** Material Request's own lifecycle and
  approval-authority/self-approval/return rules are decided and implemented
  (`docs/tasks/c-50-material-request-investigation.md` §§20.2–20.3). They do
  **not** resolve platform-wide OQ-54 or OQ-13/OQ-26, all of which remain OPEN.
  OQ-66 remains **RESOLVED**; reservation consumption on invocation is decided,
  implemented and must not be reopened.
- **Remaining C-48…C-54 dependency split:** OQ-11/OQ-24 gate valued/rial
  portions; OQ-39/OQ-42 gate Accounting integration, not quantity-only
  behavior; OQ-23 plus OQ-54/OQ-13/OQ-26 gate opening and future operational
  documents as applicable; OQ-49 gates only a generic builder. C-49 remains
  deeply blocked. C-51 quantity Receipt is the least blocked next operational
  document but requires its own Owner decisions. C-53 quantity reads are
  partially implemented.
- **Recommended next action:** a bounded **C-54 quantity Kardex investigation**
  is **READY FOR INVESTIGATION**. No business-policy OQ blocks the quantity
  half; the investigation must settle its ADR-0009/C-14 placement and exact
  running-balance contract. Rial Kardex remains blocked by OQ-11/OQ-24. This is
  a recommendation, not a task number or implementation authorization.
- **Known current contract/doc gaps:** `docs/modules.md` does not yet catalogue
  C-50, and the committed frontend generated API declaration has no Material
  Request operations/schemas. This reconciliation changes neither production
  code nor generated clients.
- **Verification boundary:** current refs/GitHub merge/CI and static source,
  schema, migration, test and documentation evidence were inspected. No local
  heavy E2E, live-PostgreSQL, migration or migration-rehearsal suite was run.
- **Status:** **READY FOR REVIEW — NOT ACCEPTED.** This addendum closes no OQ,
  promotes no ADR, accepts no implementation and authorizes no production work.

## 20. Inventory Valuation Foundation & Cost-Optional Warehouse Operations (2026-10-04)

Backend implementation slice on branch `arena/01a107dc-vardena`, branched from
`main` @ `1e3d407fd3f08650e0e70353f96b277e80ef03fd` (merge of PR #115, C-54
quantity Kardex). Architecture record: **ADR-0039 (Proposed)** — an
implementation agent cannot promote its own ADR; acceptance is the Owner's
decision on PR #116. Owner decision record: **PDR-05 / OD-VAL-01…OD-VAL-19**
(business decisions only — it accepts no implementation and promotes no ADR)
(`docs/decisions/product/PDR-05-inventory-valuation-and-cost-optional-operations.md`).

- **Owner decisions recorded (19).** Perpetual inventory; Moving Weighted
  Average as the **only** active MVP method; method configuration scoped to
  **organization + item** and effective-dated; valuation **state** keyed at the
  physical stock granularity **organization + warehouse + item**; **cost is NOT
  required on a warehouse receipt** and is never entered on an issue; Warehouse
  Operations and Inventory Accounting are two workspaces over the **same**
  records; purchase price ≠ inventory cost; backdated documents allowed only
  behind **two independent explicit confirmations**, with "do not reprice"
  honestly persisting a **stale** state; recalculation deterministic,
  transaction-safe and **bounded to one key per command**; valuation never
  gates a quantity posting; opening balance stays calculated; entered money is
  exact-or-reject; negative stock stays rejected; no fake method options;
  returns costing neither built nor foreclosed.
- **Implemented (backend only).** Migration
  `20261006000000_inventory_valuation_foundation`: three new tables
  (`item_valuation_methods`, `inventory_valuation_states`,
  `inventory_valuation_runs`) plus five columns on the existing
  `inventory_movements` (`total_cost` **signed**, `valuation_status`,
  `valuation_source`, `valued_at`, `valuation_run_id`). **No `unit_cost`
  column, no second ledger, no duplicated document, no accounting/journal field
  on an inventory movement.** Pure domain engine
  (`money.ts`, `valuation-method.ts`, `inventory-valuation.ts`,
  `moving-weighted-average.ts`, `backdating.ts`), repositories, two application
  services, one controller with **9 routes** under
  `/api/v1/inventory/valuation/*`, **4 permissions**
  (`Inventory.Valuation.{View,Configure,AssignCost,Recalculate}`,
  taking Inventory's registered total to 47), two events carrying identifiers
  and counts only, and server-side redaction of monetary fields for callers
  without `Inventory.Valuation.View`.
- **Invariants asserted by tests.** (1) `balance.onHand == valuedQuantity +
uncostedQuantity` always; (2) `SUM(movement.totalCost) == state.totalValue`
  for every key that is not `stale`.
- **Scope framing (corrected after review).** This is a **valuation
  foundation**, not a finished Inventory Accounting capability: there is no
  Receipt document, no Issue document, no Inventory → Accounting posting, no
  returns costing and no UI. OQ-24 is **partially** answered and stays OPEN.
- **Documentation reconciled, not duplicated.** OQ-24 updated **in place**
  (stays **OPEN** — returns costing, COGS posting, landed cost and valuation
  precision explicitly undecided); new **OQ-67** (transfer average divergence),
  **OQ-68** (reversal at original vs current cost), **OQ-69** (per-movement
  valuation history); D-06 annotated with an "as built" correction (**the
  engine is Inventory-owned, not Accounting-owned**);
  `inventory-domain-analysis.md` §2.1/§5, `docs/modules.md`, the three roadmap
  documents (C-49/C-51/C-52/C-53/C-54 reconciled; C-57 backend operational
  hardening added 2026-10-05 while Inventory UI remains future work) and the
  four Persian UX documents updated.
- **Deliberately not implemented.** Inventory → Accounting posting/COGS
  (OQ-39/OQ-42/OQ-25), returns costing (OD-VAL-19), landed cost, FIFO/LIFO/
  specific identification, lot/serial-level valuation, Receipt/Issue
  _documents_ (OQ-54), and **any frontend** — the UX documents specify the
  target flows and classify them as `SUPPORTED API / FUTURE UI` (candidate
  C-57).
- **Local validation (after the correction round).** `npm run format:check`,
  `npm run lint` (1 pre-existing accounting warning, unchanged),
  `npm run typecheck`, `npm test` (**133 files / 1602 tests**, +71 over the
  1531 baseline), hermetic `test:e2e` (**26 files / 360 passed / 160 skipped**)
  including `test/inventory-valuation.e2e-spec.ts` (**32 tests**) and the
  unchanged `inventory-core.e2e-spec.ts` (10), `npm run build`; frontend
  `lint`, `typecheck`, `format:check`, `test`, `build` (untouched by this
  slice). **Not runnable in the authoring sandbox and delegated to CI:**
  `prisma validate`/`generate` (engine download blocked), `prisma:deploy`,
  migration rehearsal and the live-PostgreSQL E2E suites.
- **Pull request:** **#116** — `feat(inventory): establish valuation foundation
and cost-optional warehouse operations`, head `7b4b825`, branch
  `arena/01a107dc-vardena`, **left OPEN for architectural review** (not
  merged). The mandatory A–K implementation report and the OD-VAL-01…19
  decision mapping are recorded in the PR description; the canonical decision
  record is PDR-05.
- **CI:** run **`37224093994`** — **backend and frontend both success**,
  including `prisma:validate`, `prisma:generate`, `prisma:deploy`, the
  migration rehearsal and the **live-PostgreSQL E2E suites** that cannot run in
  the authoring sandbox. The first run (`37223668345`) failed at the live-DB
  step: three live suites tore down `movements → warehouses → items` and the
  new `ON DELETE RESTRICT` valuation rows blocked the warehouse delete. Fixed
  by extending the teardown of `item-master-live`, `material-requests-live` and
  `warehouse-master-live` only — **no assertion was changed, relaxed or
  removed**. This was a genuine integration finding the hermetic test doubles
  could not surface.
- **Owner review 1 (2026-10-04): CHANGES REQUIRED.** The official outcome on
  the first submission (§6 vocabulary). Two classes of finding:
  1. **Technical defect — historical method resolution.** A recalculation
     resolved ONE valuation method (the one in force at a single instant) and
     replayed the key's whole history under it, so a past period could be
     restated under a method that only became effective later. That
     contradicts the effective dating OD-VAL-14 exists to provide. **Fixed:**
     the replay driver moved to `domain/valuation-replay.ts`, every
     `ReplayFact` now carries the method resolved at **its own**
     `movement_date` (`buildReplayFacts` reads the item's versions inside the
     replay transaction and reuses `resolveValuationMethodAt`), and the driver
     asks for a strategy once per fact through a closed `switch` — no registry,
     no EAV, no second engine. A period configured with a method this build
     cannot execute now fails closed with
     `inventory.valuation_method_not_implemented`, naming the method and the
     movement, instead of being silently valued as Moving Weighted Average.
     Proven by `domain/valuation-replay.spec.ts` (14 unit tests, including the
     1404/1405 resolution case) and one e2e case that is verified to FAIL
     against the previous behaviour. The run/state `method` column is now
     documented as _the method in force for the key when the run executed_,
     not the per-movement methods applied — recorded against **OQ-69**.
  2. **Governance overreach in the documentation.** ADR-0039 had been written
     as `Accepted` and quoted that way in 7 documents; the roadmap read as if
     the slice had moved C-51/C-52 forward. **Corrected:** ADR-0039 is
     `Proposed` everywhere, PDR-05 is scoped to the Owner's business decisions
     (it accepts nothing and promotes nothing), the roadmap states plainly that
     **no Receipt or Issue document exists** and that OQ-54 lifecycle/
     correction/deletion, OQ-13/OQ-26 approval and Inventory → Accounting
     posting remain their blockers — valuation removed exactly one blocker from
     those rows and nothing else.
- **CI after the corrections:** run **`37225470067`** (head `ecf10b0`) —
  **backend ✅ and frontend ✅**, including `prisma:validate`,
  `prisma:generate`, `prisma:deploy`, the migration rehearsal and the
  live-PostgreSQL E2E suites. (Run `37224462262`, the docs-only commit
  `c72e4a5`, also succeeded.) The migration itself was not modified in the
  correction round and no new migration was added.
- **Owner review 2 (2026-10-05): CHANGES REQUIRED — one technical defect.**
  The valuation-method configuration was read with
  `take: Number.MAX_SAFE_INTEGER`, i.e. "fetch the item's entire configuration
  history", on both the replay path and the single-instant posting path. It
  produced correct answers but is an unbounded read inside a command whose
  whole premise (OD-VAL-12) is that it is bounded. **Corrected without
  changing a single resolved method:**
  1. **Replay path** — the versions were read for the replay **horizon**
     (`validFrom <= lastMovementDate AND (validTo IS NULL OR validTo >
firstMovementDate)`), derived from the already-bounded movement read,
     and capped at `RECALCULATION_MOVEMENT_LIMIT + 1`. **That cap was itself
     wrong and was replaced in round 3 of the corrections (see below);** the
     horizon filter is no longer what bounds the read.
  2. **Posting path** — `findEffectiveVersionAt` asks PostgreSQL for the one
     version in force (`ORDER BY valid_from DESC LIMIT 1`) instead of the
     whole history. Both paths now map their result through the single domain
     function `resolveValuationMethodFrom`, so the list-based and single-row
     resolutions cannot drift; the unused `findVersions` was removed.
  3. **Configuration WRITE path keeps the unbounded read, deliberately and
     with the reasoning in the code.** `planNewVersion` decides by testing the
     candidate against **every** existing window; a truncated series would
     miss an overlap and admit two versions covering one instant, making
     historical resolution permanently ambiguous. It runs once per
     configuration write, under the item-scoped advisory lock, over one
     (organization, item) pair's admin-created history — the same shape as the
     accepted C-47 `unit-conversions.repository.ts` write path.
     **Historical resolution is unchanged** (`ReplayFact.method` is still the
     method effective at each movement's own date), there is no fallback to a
     current/latest/first method, unsupported methods still fail closed, and the
     closed `switch` dispatch is untouched. Proven by **14 new unit tests** in
     `domain/valuation-method.spec.ts` — including a 60-version five-year history
     where every replayed date resolves identically against the filtered and
     the complete series — and **one new e2e case**
     (`inventory-valuation.e2e-spec.ts`) that drives a four-version history
     through the real API, resolves each date to its own version, and shows the
     same unsupported window being ignored when it sits outside the replayed
     period and refusing the replay when it sits inside it. Both window edges
     were mutation-tested: inverting either comparison fails the suite.
- **Validation after round 2 of corrections (local, 2026-10-05):**
  `format:check` ✅, `lint` ✅ (1 pre-existing warning in Accounting),
  `typecheck` ✅, unit **133 files / 1616 tests** ✅, hermetic e2e **26 files /
  361 passed / 160 skipped** ✅, `build` ✅. No migration, schema, API contract,
  permission or frontend file changed in this round.
- **Owner review 3 (2026-10-05): CHANGES REQUIRED — one technical defect.**
  The round-2 correction bounded the configuration read by the replay horizon
  and then capped it at `RECALCULATION_MOVEMENT_LIMIT + 1`, justified as "at
  most one version can be consumed per movement". The premise is true but
  does not support the cap: the horizon query returns every version
  _intersecting_ the span, a count driven by **configuration density**, not
  by movement count. Two movements eleven months apart therefore dragged in
  every version configured during those eleven months, and an item with more
  versions than the movement limit had its two-movement replay **refused**
  with a limit that is about movements. A correctness defect, not a
  performance one.
  **Corrected by selecting on relevance instead of on span.** The replay now
  reads the versions in force at the **distinct movement dates** it is
  replaying — one window branch per date in a single set-based query
  (`WHERE org = ? AND item = ? AND ((valid_from <= d1 AND (valid_to IS NULL
OR valid_to > d1)) OR …)`) — so every row returned governs at least one
  replayed movement, and the result is bounded by the number of distinct
  dates, which the movement limit already bounds. Distinct dates, not
  movements: a hundred movements sharing five dates ask five questions. The
  movement-count cap is gone; `RECALCULATION_MOVEMENT_LIMIT` limits movements
  again and nothing else, and `RecalculationTooLargeError` is back to its
  original single-purpose shape (the round-2 `subject` discriminator was
  removed). A read returning more rows than there are distinct dates means
  two versions are in force at one instant — the overlap invariant the write
  path enforces has been violated in stored data — and the replay fails
  closed rather than resolving against whichever row happened to arrive.
  **Completeness is now trivial to see:** every version covering a replayed
  date satisfies that date's branch, so resolution against the result equals
  resolution against the item's whole history; future and expired
  configuration are excluded because they govern no replayed movement, not as
  special cases; an unsupported method in force at a replayed date is still
  loaded and still fails the replay closed. Historical resolution, the
  default-when-unconfigured rule, the half-open `[validFrom, validTo)`
  boundary and every API contract are unchanged.
  Evidence: the e2e regression test (two movements, `RECALCULATION_MOVEMENT_LIMIT
  - 1`contiguous versions) was **verified to fail against the round-2
implementation** with 422`inventory.recalculation_too_large` and to pass
    after the fix; a second e2e replays two movements across twelve monthly
    versions and proves determinism and future-version isolation; a third —
    new, there was none before — proves the movement limit itself still refuses
    a key with more movements than the limit. Unit coverage adds distinct-date
    collapsing, density independence (600 versions, two movements, two rows
    read), the hundred-movements/five-dates case, boundary selection at the
    exact instant a window closes, and loaded-but-unsupported versus
    excluded-future methods.
- **Validation after round 3 of corrections (local, 2026-10-05):**
  `format:check` ✅, `lint` ✅ (1 pre-existing warning in Accounting),
  `typecheck` ✅, unit **133 files / 1618 tests** ✅, hermetic e2e **26 files /
  364 passed / 160 skipped** ✅, `build` ✅. No migration, schema, API contract,
  permission or frontend file changed in this round.
- **Owner review 4 (2026-10-05): CHANGES REQUIRED — one technical defect.**
  The round-3 correction detected overlapping configuration by comparing two
  global counts (`rows.length > instants.length`). That is not an ambiguity
  check: two versions in force on one movement date and none on another
  returns exactly as many rows as there are dates, so the comparison passes
  while a date resolves ambiguously — and the replay then silently used
  whichever version sorted later. **Corrected:** ambiguity is evaluated **per
  distinct movement date** (`findAmbiguousInstant`); any date with more than
  one version in force fails the replay closed with
  `AmbiguousValuationMethodError`, naming the item, the date and the
  conflicting version ids. The same rule now applies to the single-instant
  resolver, which read `LIMIT 1` and would otherwise have preferred the later
  window; it reads one row more and refuses instead. The error is
  deliberately **not** mapped to a business-rule response: the write path
  forbids overlaps, so reaching it means stored data is invalid and an
  engineer must look — the same treatment as the "unknown stored method"
  guard beside it. Dates with **no** configured version are untouched and
  still resolve to the code-defined default; an overlap outside the replayed
  dates is ignored because no movement resolves there.
  Evidence: the e2e case (two windows in force on the first movement date,
  none on the second, so rows == dates) was **verified to return 201 against
  the round-3 implementation** — it silently picked a version — and now
  returns 500 with the valuation state provably unchanged; removing the
  conflicting row makes the identical replay succeed. A companion e2e
  re-asserts that the configuration endpoint still **refuses to create** an
  overlapping version, so the read-side guard supplements the write-side
  invariant rather than replacing it. Unit coverage adds the count-equals-
  dates regression, earliest-ambiguous-date reporting, adjacent windows at a
  shared boundary (not ambiguous), unconfigured dates (not ambiguous) and
  overlaps outside the replayed dates (ignored).
- **Validation after round 4 of corrections (local, 2026-10-05):**
  `format:check` ✅, `lint` ✅ (1 pre-existing warning in Accounting),
  `typecheck` ✅, unit **133 files / 1626 tests** ✅, hermetic e2e **26 files /
  366 passed / 160 skipped** ✅, `build` ✅. No migration, schema, API contract,
  permission or frontend file changed in this round.
- **Correction to an earlier claim in this record.** The round-2 entry said the
  live-PostgreSQL job verifies the new valuation query shapes. It does not:
  **no live suite exercises the valuation endpoints.** What CI verifies is
  schema validity, migration application and the build; valuation behaviour is
  verified hermetically. Because `PrismaService.getClient<T>()` casts with
  `as unknown as T`, the compiler does not check these query objects against
  the generated Prisma types either. The recommended follow-up for this slice
  is a live-PostgreSQL valuation suite; it is not part of this corrective
  round.
- **Status:** **CHANGES REQUIRED (Owner, 2026-10-05) — fourth round of
  corrections pushed, awaiting re-review.** The PR stays **open**; it is not
  merged and not accepted. Merge and green CI are not acceptance (§6).
  ADR-0039 remains **Proposed**, PDR-05 closes no OQ beyond the partial OQ-24
  answer it records, OQ-24 stays **OPEN** with OQ-67/68/69 unresolved, and
  nothing here authorizes further Inventory production work.

## 21. Product & Architecture Governance Re-Baseline + OQ-54 Resolution (2026-10-05)

- **Type:** documentation/governance only. **Production code changed: NONE.**
  No migration, schema, API, permission, frontend component or test changed.
  Branch `arena/01a10d2c-vardena`, baseline `main` @
  `ff8a01a8c8bc767629f5ba0e2bbdbc51abeda251`.
- **Purpose:** write the Owner-approved product, backend, frontend, inventory,
  accounting, licensing, reporting, deployment, backup and MVP decisions into
  their canonical repository locations so Git — not conversation history — is
  the source of truth.
- **Owner decisions recorded (canonical records, no duplication):**
  - **OQ-54 RESOLVED (Option B, OD-54-01…11)** — a document remains editable
    **until Accounting Post**; pre-post edits are validated against
    operational side effects and **no material side effect may occur
    silently**; negative physical inventory from an edit is a **hard block**
    (business error naming item/warehouse/business date; no partial
    mutation); valuation-impacting edits require explicit acknowledgement
    (Continue+Reprice / Continue without Repricing / Cancel; never-silent
    repricing; skipped repricing persists an honest stale state + admin
    alert); after Accounting Post: no direct edit/delete — correction/
    reversal/counter-document only; no physical deletion with business
    history; cancelled documents stay visible/auditable; **numbering is never
    reused** (ADR-0023 boundary preserved). Record:
    `docs/decisions/product/OQ-54-finalized-document-deletion-editing.md`;
    registry row moved to Resolved. The earlier Option A recommendation is
    labeled historical, not erased.
  - **ADR-0040 created (Proposed — NOT self-accepted):** operational document
    edit boundary, explicit/testable side-effect detection, negative-inventory
    invariant, alert/event requirement; lifecycle vocabulary preserved
    (`draft`/`temporary`/`final` + posting boundary — no new states). Detailed
    contract: `docs/architecture/domain/document-architecture.md` §6/§6.1.
  - **Frontend UX contracts created** (documentation only):
    `docs/frontend/ux/document-editing-and-system-alerts.md` — edit/warning
    UX, negative-inventory block message, reprice/continue/cancel choice,
    stale-valuation alert, future management-alert surface, Report Builder UX
    scope, license Grace/Read-Only UX. No UI implemented.
  - **OQ-49 DECIDED:** MVP = standard ERP reports + controlled customization
    (filters, date ranges, permitted columns, sorting, limited grouping,
    saved configurations, Excel export); no unrestricted designer/SQL/BI.
  - **PDR-06 created — MVP completion re-based:** "MVP complete" = **Initial
    Usable Product / V1** (end-to-end usable by a real customer incl.
    frontend, licensing, installation, deployment, backup, export,
    administration), NOT "backend code complete"; no calendar deadline;
    existing MVP catalogue remains the checklist source. OQ-60 numeric
    thresholds stay OPEN.
  - **OQ-65 reuse DECIDED (OD-65-01):** a barcode is **never reusable within
    the organization** (entire organization lifetime); comparison semantics
    stay OPEN and still gate C-55. PDR-03 updated with a dated pointer.
  - **OQ-45 shape decided:** expiry → Grace → Read-Only (read-only blocks all
    mutation); durations/override OPEN; enforcement still not implemented.
  - **OQ-46 distinction decided:** Business Export = Excel ≠ Disaster/
    Technical Backup = full backup; completeness boundary OPEN.
  - **Backup/restore policy recorded:** `docs/operations/backup-and-restore.md`
    — Vardena provides backup capability + Runbook (verification, restore,
    app/db startup, validation, post-restore checks — commands not invented);
    customer admin owns operational backups; **normal ERP users never get
    in-product Restore**; future destinations (local/Google Drive/S3/cloud)
    documented, not implemented; Backup ≠ Restore ≠ Disaster Recovery.
  - **OQ-52 stays OPEN** (RPO/RTO concepts documented; no numbers); **OQ-53
    stays OPEN** for DR topologies/license re-activation/drills.
  - **OQ-51 boundary decided:** taxpayer Stage 1 prep in scope; Stage 2 full
    integration deferred until after the complete MVP; roadmap retained.
  - **OQ-47 deferred by Owner ("do nothing for now")** — no FX work, seams
    dormant; **OQ-41 Detail Dimensions deferred** (operational scope stays;
    no EAV/JSONB/speculative dimension fields); **OQ-59 Product Family
    deferral confirmed** (ERP core is the priority).
- **Stale documentation corrected** (living documents only; dated historical
  task reports untouched): `docs/open-questions.md` (header + rows + OQ-54 →
  Resolved), `docs/decisions/product/README.md`, roadmap + dependency-matrix
  addenda and the OQ-54 row, `mvp-scope-proposal-v1.md` (addendum, D-03/D-05),
  `document-architecture.md` §6, `reporting-strategy.md`,
  `database-strategy.md` §14, `licensing-architecture.md`, `README.md`.
- **Acceptance tests documented (future work — none exist and none are
  claimed):** lifecycle edit/post/correction tests, negative-stock rejection
  with unchanged DB, valuation warning/choice/stale-alert tests, cancelled
  visibility, numbering no-reuse, no-silent-side-effect, retired-barcode
  no-reuse, Grace/Read-Only behavior, Business-Export-vs-Backup distinction.
- **Governance safety:** no ADR self-accepted (ADR-0040 and all previously
  Proposed ADRs stay Proposed); no OQ closed beyond the explicit Owner
  decisions above; no implementation authorized; MERGED ≠ ACCEPTED unchanged;
  history preserved (superseded recommendations labeled historical).
- **Correction round (2026-10-06, same PR #117, review findings):**
  - **OQ-65:** an earlier wording in this re-baseline presented a plain
    current-row unique index `(organization_id, barcode)` as the natural
    shape of the decided never-reuse rule. **That was incorrect**: the Owner
    invariant is defined over **assignment history** (a cleared, replaced,
    deactivated or retired assignment does NOT release the barcode), and a
    current-value uniqueness constraint alone cannot enforce it. OQ-65 now
    records the business invariant with its explicit cases
    (active/cleared/retired/replaced/historical assignment), states the
    enforcement implication (history-aware persistent consumption/assignment
    record or equivalent immutable reservation mechanism — **concrete design
    deliberately NOT chosen**; future implementation task, gated on Q2), and
    keeps **Q2 comparison/normalization semantics OPEN**. Registry row,
    PDR-03 note, dependency-matrix rows and the C-55 candidate row corrected
    to match. Nothing was implemented.
  - **OQ-49:** the record still carried active-looking pre-decision prompts
    ("Questions requiring product owner confirmation", "Exact decision
    required", Stage-0 deadline). These are now explicitly marked
    **historical/superseded** by the 2026-10-05 Owner decision (A + controlled
    subset of B); the exclusion list is completed (adds unrestricted
    calculated fields, arbitrary data-source joining, unrestricted
    user-defined reporting logic) and the record states it is a governance
    decision, not an implementation claim. The matrix OQ-49 row is updated.
  - Production code changed in this round: **NONE**.
- **Status:** READY FOR REVIEW — NOT ACCEPTED (Owner review required).

## 22. FE-VAL — Inventory Warehouse Operations UI, frontend (2026-10-05)

Frontend implementation slice on branch `arena/678f7774-vardena`, branched from
`main` @ `7f8d36f0511365323f0951c7b11f259d3e2c6d05` (merge of PR #118). This is
the UI half of slice #20's backend: no backend behavior, permission, migration
or API contract changed (only enrichment of `inventory.insufficient_stock`
error `details` with measured `onHand`/`requested` decimal strings, and the
e2e spec asserting it).

- **Implemented (frontend only).** Six surfaces under `/app/inventory`:
  landing page, movements ledger (URL-owned filters/paging/sorting, default
  `pageSize` 50 / `movementDate:desc`), receipt/issue posting form
  (`?type=`), warehouse-to-warehouse transfer form, quantity-only Kardex
  (snapshot paging: page-1 token replayed unchanged), and the valuation-state
  worklist with the bounded recalculate command. New API layer
  (`api/inventory.api.ts` over the regenerated OpenAPI types), inventory
  query keys, i18n section, permission codes, labels, error mapping and
  mutations with targeted invalidation (`movements`/`balances`/`kardex`/
  `valuation-states` of the active organization only).
- **Contract rules kept.** Cost input exists ONLY on a receipt and only with
  `Inventory.Valuation.AssignCost`; a receipt still posts without it; an
  issue NEVER offers cost. The frontend computes no valuation numbers — every
  figure is a backend string; missing cost renders `«—»`, never `۰`. Backdate
  posting is the two-step explicit flow (counts/dates only; no default; the
  resubmission carries `backdateConfirmed:true` + chosen `repricing`); the
  POST-side 422 refusals re-open the same dialogs (check→post race). After
  «انجام نشود» a persistent stale notice with an explicit (permission-gated)
  recalculate action remains. Transfers have no cost and no backdate
  confirmation: `inventory.backdated_transfer_valuation_unresolved` renders
  its canonical refusal copy (OQ-67 stays OPEN). One `operationKey` per form
  intent, reused across dialog round-trips/retries, minted anew after success.
- **Licensing/permissions.** UX gates mirror the exact backend codes
  (`RequirePermission` on routes, `PermissionGate` in navigation); module
  licensing needs no new frontend code — an unlicensed `inventory` module
  arrives as a permission set with every `Inventory.*` code filtered
  server-side, so navigation and surfaces disappear by themselves.
- **Tests added (frontend).** 28 Vitest cases across five files: receipt
  without cost, cost permission gating, issue without cost input,
  insufficient-stock canonical copy with measured quantities, two-step
  backdate with no-default choice + resubmission payload + POST-race re-open,
  skip→stale-notice→(permission-denied) recalculate, unvalued≠zero (`—`),
  stale visibility, money-column gating, CTA gating, license-filtered home
  surfaces, targeted query invalidation, transfer refusals (equal warehouses,
  backdated transfer) and Kardex snapshot replay. Suite total: 333 passing
  (47 files). `tsc --noEmit`, oxlint, prettier clean. Backend: unchanged,
  in-memory e2e suites (`inventory-core`, `inventory-valuation`) green at
  implementation time (slice #20/#21 records).
- **CI (PR #119):** green on head `ed39859` — run
  **37377001303** (backend 5m18s incl. live-DB e2e suites ✓, frontend
  2m6s ✓). The same code head was also green on run **37376098223**
  (head `8e217ad`: backend 4m42s ✓, frontend 2m25s ✓ — the intermediate
  `ed39859` was the STATE.md record of that run). Four earlier attempts
  (runs 37366549949, 37368220600, 37372111150, 37374484055) were
  cancelled by a GitHub hosted-runner acquisition outage ("job was not
  acquired by Runner") with no code executed; the code passed on every
  attempt that did get a runner (frontend ✓ on 37368220600, backend ✓ on
  37374484055).
- **Docs reconciled.** `feedback-standard.md` §5.3/§6.2/§11.7 and
  `persian-ux-writing-standard.md` appendix note now record the implemented
  copy (type-specific success toasts, provisional label
  `ارزش‌گذاری نامعتبر (موقت)`, new movement-type labels, insufficient-stock
  numbers, backdated-transfer refusal) and keep late-cost assignment,
  reversal, reservations and reconciliation explicitly UI-less.
- **Out of scope (deliberately).** No adjustments form, no late-cost
  assignment UI, no reservations/reconciliation UI, no valuation-method
  configuration UI, no GL/COGS posting, no Persian (Jalali) date display
  beyond the existing ISO input conventions. OQ-67/68/69 remain OPEN.
- **Status:** READY FOR REVIEW — NOT ACCEPTED (Owner review required).

## 23. C-59D/C-59E/C-59E+ — Returns, Periodic Pricing, Reverse Pricing & Concurrency Hardening (2026-10-07)

- **Scope delivered (backend, branch `arena/99c8b15c-vardena`):** Purchase
  Return and Sales Return documents with the full basis/manual-amount
  valuation rules (PDR-08 OD-RET-01…07); the Periodic Pricing Operation
  batch (OD-PRC-05…07, OD-PDP-01…05) with per-key outcome reporting; Reverse
  Pricing (OD-RVP-01…08) as a run-scoped compensating run; the OD-REV-07
  no-reversal-after-Accounting-Post guard; and the Accounting Post ↔ pricing
  concurrency hardening (one transaction: document row lock → key
  valuation-state locks in the fixed order → eligibility re-derived under the
  locks → write). Additive migration
  `20261008000000_inventory_returns_and_pricing_runs`; new permissions
  `Inventory.Valuation.RunPricing` / `Inventory.Valuation.ReversePricing`;
  new endpoints under `/v1/inventory/pricing`.
- **Domain decisions:** recorded in
  `docs/tasks/c-59-returns-pricing-execution-report.md` §4.1–4.8 (basis
  pro-rata = one division + one sanctioned rounding; unvalued basis exits
  valueless with `return_basis` recorded, never the average and never zero;
  sales return re-enters at the current average, amount only with a basis;
  pricing runs are audit records, per-key arithmetic stays the existing
  whole-key replay; reversal compensations fold preserved values and leave
  the key stale; runs are never deleted, only marked reversed).
- **Verified locally:** `npm ci`, `tsc --noEmit`, oxlint (0 errors; 1
  pre-existing warning on main), prettier, and the full unit suite
  **136 files / 1702 tests PASS**. `prisma validate` could not run in the
  sandbox (no network for the schema engine) — CI is authoritative.
- **NOT done in this slice (named):** dedicated unit/integration specs for
  the new behavior, live-DB concurrency tests, the narrative
  valuation/pricing documentation pass, the coupled backdated-transfer
  replay (DEFERRED, still fail-closed), and the
  `backdateConfirmed`/`acknowledgeSideEffects` split (recorded debt).
- **CI:** GREEN on PR #126 head `eaa8c2a` — run 37537658703 (backend 3m44s
  incl. `migrate deploy` of the new migration, the migration rehearsal and
  the live-DB e2e suites; frontend 2m23s). Two in-flight fixes: the
  one-to-one reversal self-relation needed its unique constraint
  (`uq_inventory_pricing_runs_reverses_run` — the at-most-once-reversed
  invariant, now DB-enforced), and two closed-vocabulary e2e assertions
  were updated for the registry growth (document types 6→8, valuation
  permissions 4→6).
- **Status:** READY FOR REVIEW — implementation complete, CI green,
  dedicated new-behavior tests still owed (named above). NOT ACCEPTED
  (Owner review required). The dedicated-tests debt was closed the same
  day by the correction sprint — see §24.

## 24. C-59 Correction Sprint — Audit, Fixes, Dedicated Tests & Live Concurrency Evidence (2026-10-07)

- **Scope delivered (backend, branch `arena/99c8b15c-vardena`):** the owner's
  five-axis correction sprint on PR #126. Three real defects found by auditing
  the code and fixed: (1) Reverse Pricing folded the pre-update snapshot raw,
  producing the post-run position instead of the pre-run fold — fixed by the
  pure `toCompensationFacts` bridge in `domain/valuation-compensation.ts`;
  (2) a run with failed keys (or a reversed run) advanced the scope's
  from-date, permanently skipping the failed movements — fixed by the
  completed-run definition in `findLastRunForScope`
  (`keysFailed = 0 AND reversedByRunId IS NULL`; re-cover is safe because
  whole-key replay is idempotent); (3) `finalizeDocument` dropped
  `basisMovementId` when re-resolving lines, so drafted basis-linked returns
  posted basis-less — fixed to carry the basis like `updateDocument` already
  did. Audited-and-proven-correct (no fix, per instruction): transfer-leg
  replay preservation, all reverse guards, both commands' idempotency,
  quantity invariance, lock ordering.
- **Domain clarification (recorded in the report, not a new policy):** the
  completed-run definition operationalizes OD-PDP-01's existing "last
  completed run" wording. Details in
  `docs/tasks/c-59-correction-sprint-report.md` §5.
- **Dedicated tests (three levels):** +40 unit tests
  (`valuation-compensation.spec.ts` 9, `inventory-pricing.service.spec.ts`
  18, thirteen returns tests in the business-documents spec) and a new
  16-test live suite `test/inventory-pricing-live.e2e-spec.ts` covering both
  axes end-to-end on real PostgreSQL, the four concurrency scenarios
  (pricing↔pricing, pricing↔reverse, post↔reverse, reverse↔reverse — one
  domain outcome each, no duplicate/torn artifacts, no deadlock), accounting
  eligibility/immutability, and the full receipt → issue → returns →
  transfer → pricing → accounting-post pipeline.
- **Final correction round (same day, owner's follow-up order):** CI on the
  first correction head (`0a23956`) was red — every Reverse Pricing call 500. Root causes, found by reproducing the live suite locally (embedded
  PostgreSQL 18.4, clean database, real generated client) and each fixed:
  (1) the PR-local migration created `inventory_pricing_runs` and
  `inventory_pricing_run_key_outcomes` WITHOUT the `created_by`/`updated_by`
  audit columns every sibling inventory table carries and the repository's
  row types and `lockRunRow` raw SELECT expect — corrected IN PLACE
  (branch-local migration, repo precedent `5cd4763`), with the models
  gaining `createdBy`/`updatedBy` and the write paths stamping them like
  every sibling; (2) `reverseRunWithin` stamped movements with the
  compensating run id BEFORE creating the compensating valuation-run row —
  FK violation inside the transaction, fixed by statement order (same
  transaction, fold unchanged); (3) an EMPTY pricing run (the
  pricing↔reverse interleaving where the reverse empties the concurrent
  run's window) advanced the from-date past a STALE key's movements,
  making the repricing OD-RVP-06 demands unreachable — the completed-run
  definition now also requires `keysExamined > 0`; (4) the HTTP line DTO
  lacked `basisMovementId`, making the whole returns feature unreachable
  over HTTP — field added (the pipeline test had caught it as a 400).
  Three live-test expectations were corrected against the established
  contracts, reasons recorded in the sprint report §1a.5.
- **Verified locally (final):** `tsc --noEmit` clean, oxlint 0 errors (1
  pre-existing warning on main), prettier clean, `prisma validate` +
  `prisma generate` pass, unit suite **138 files / 1743 tests PASS**, and
  the FULL e2e config against a real PostgreSQL (all 28 migrations from
  zero, audit columns verified in information_schema): **48 files / 562
  tests PASS**, including the new 16-test pricing live suite (three
  consecutive green runs) and every other live suite.
- **CI:** **GREEN on the final correction head `325c099`** —
  [run 37582663933](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37582663933)
  (backend 4m24s incl. `migrate deploy` of the corrected migration, the
  migration rehearsal and the full live-DB e2e suites; frontend 1m46s). The
  prior heads `30ca7b2` (green, runs 37537658703 / 37538284793) and
  `0a23956` (red — the migration defect above) frame the loop.
- **Status:** see the sprint report's single verdict.

## 25. C-59C — Coupled Backdated Transfer Valuation Replay (2026-10-07)

- **Scope delivered (backend + frontend, branch `arena/6e2e35f1-vardena`,
  PR [#127](https://github.com/MR-AliEsmaeili/Vardena/pull/127)):** the
  OD-TRF-08/09 gap assigned to C-59C. A backdated transfer is no longer
  fail-closed: `POST /inventory/transfers` and the Transfer document finalize
  accept `backdateConfirmed` (the OD-VAL-10 acknowledgement, same
  `inventory.backdated_document` code, now naming BOTH keys and their latest
  movement dates), a confirmed backdated transfer additionally requires
  `Inventory.Valuation.Recalculate` before any write, and the pair is valued by
  the **coupled two-key replay** — both keys' histories folded in canonical
  ledger order with the pair at its own position, the destination leg
  receiving exactly the source-derived value (OD-TRF-01/02/05) — inside the
  posting transaction. No migration, no API break, no new permission.
- **New code:** `domain/transfer-replay.ts` (pure driver),
  `data/inventory-transfer-replay.ts` (in-transaction orchestration: run rows
  with the existing `backdated_document` trigger, `writeValuationState`, the
  same bounded read as a recalculation). `domain/valuation-replay.ts` now
  exports the shared unpaired-leg guard and fact dispatch, so the single-key
  and coupled drivers cannot disagree.
- **Fail-closed residuals stay named:** `inventory.recalculation_too_large`
  (OD-VAL-12 bound), `inventory.valuation_method_not_implemented` (OD-VAL-18),
  `inventory.transfer_replay_unpaired_leg` (a stored unvalued leg of another
  transfer, whose counterpart key is not in this replay). The retired
  `inventory.backdated_transfer_valuation_unresolved` code is emitted by no
  path; OQ-67's "known implementation gap" is closed in
  `docs/open-questions.md`, and PDR-05/PDR-08/ADR-0039/`modules.md`/
  `feedback-standard.md` were updated in the same change. The interpretation
  that a transfer gets NO OD-VAL-11 repricing choice is recorded in the task
  doc §3; no new business rule was invented.
- **Tests:** `domain/transfer-replay.spec.ts` (new, 11), three new hermetic
  service tests replacing the retired gate test (confirmation refusal,
  confirmed-with-authority posting incl. the permission pre-check, and a
  refusing replay mapping to its named 422), the in-memory HTTP journey in
  `test/inventory-valuation.e2e-spec.ts` (44, incl. the two-key rollback), and
  a live-PostgreSQL coupled-replay test in the documents live suite (18).
- **Defect found by CI and fixed on the same branch:** the first head
  (`1b5af2b`) returned 500 for a confirmed backdated transfer because the
  orchestration patched movement rows pointing at a valuation run it had not
  inserted yet — a real FK (`fk_inventory_movements_valuation_run`) the
  constraint-free fake could not see. Fixed in `2c7186f` by writing the run row
  first (the `applyReplay` order); the in-memory mirror now enforces the same
  FK order.
- **Verified locally:** backend unit **139 files / 1756 tests**, frontend
  **48/342**, typecheck/lint/format clean, `git diff --check` clean; and the
  FULL live-DB e2e config **48 files / 566 tests PASS** against an embedded
  PostgreSQL 18.4 instance (all 28 migrations, generated client, system-admin
  bootstrap) — the first time this slice's live assertions ran in the sandbox.
- **CI:** **GREEN on `2c7186f`** — run
  [37597572636](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37597572636)
  (backend 5m41s incl. `migrate deploy`, migration rehearsal and the live-DB
  e2e suites; frontend 2m49s). The prior head `1b5af2b` is the red run that
  exposed the FK-order defect (37595239576).
- **Record:** `docs/tasks/c-59c-transfer-coupled-backdated-replay.md`
  (§9 carries the evidence and §9.2 the implementation report).

## 26. Post-C-59 Valuation Correctness — `forceUnvalued` Replay Propagation (2026-10-07)

- **Defect fixed (branch `arena/f4b20873-vardena`):** a recalculation
  re-derived a **basis-linked unvalued purchase return** from the current
  Moving Weighted Average. The posting path records the exit as
  `valuation_status = 'unvalued'`, `total_cost = NULL`,
  `valuation_source = 'return_basis'` (OD-RET-02/04) and `toReplayFact` rebuilt
  that fact — but the replay's shared fact→strategy dispatch
  (`toStrategyInput` in `domain/valuation-replay.ts`) dropped `forceUnvalued`,
  so every replay driver — the one-key `Recalculate`, the document backdating
  path (`repricing: "recalculate"`), the Pricing Operation batch and the
  coupled backdated-transfer replay — rewrote the row as
  `valued`/`average_cost`. After the first recalculation the intent was
  unrecoverable from the stored row. The defect was recorded as a pre-existing,
  out-of-scope observation in
  [`docs/tasks/c-59c-transfer-coupled-backdated-replay.md`](docs/tasks/c-59c-transfer-coupled-backdated-replay.md)
  §10 and contradicted the documented contract in
  [`docs/tasks/c-59-returns-pricing-execution-report.md`](docs/tasks/c-59-returns-pricing-execution-report.md)
  §4.1 ("preserved verbatim by every replay").
- **Fix:** the shared dispatch propagates `forceUnvalued` verbatim (typed
  options object, the repository's conditional-spread convention), and both
  drivers now keep the key stale from the strategy's own `marksStale` instead
  of comparing `status === 'provisional'` — the forced exit that consumed
  valued stock is the only case where the two disagree, and the posting path
  already flags that key. No schema, migration, API, permission, ledger,
  ordering or MWA-arithmetic change.
- **Tests:** a domain suite for the flag (exit stays `unvalued`; identical
  quantities and canonical order; the key stays stale; no stale flag when
  nothing left the valued pool; absent/`false` flag keeps the average-derived
  behaviour), the coupled driver's identical answer, a new data-chain spec
  (`buildReplayFacts` → `replay` → `valuationChanged` reports no write), and a
  live-PostgreSQL recalculation of a real purchase-return key asserting
  `movementsRevalued = 0`, a `stale` state and unchanged on-hand.
- **Verified locally:** the three touched unit specs, `typecheck`, `lint`,
  `format:check`, `git diff --check`. Heavy verification (live PostgreSQL e2e,
  migration rehearsal) stays with CI under the standing local-test policy.
- **Verified in CI:** PR #128 — both jobs green on `caa0b31` (run
  [37651803989](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37651803989)),
  including unit tests, the live-PostgreSQL e2e suites and the migration
  rehearsal.
- **Record:** [`docs/tasks/post-c-59-force-unvalued-replay-propagation.md`](docs/tasks/post-c-59-force-unvalued-replay-propagation.md).

## 27. C-60 — Inventory → Accounting Boundary & Decision Package (2026-10-07)

- **Type:** Audit + decision/architecture package. **DOCUMENTATION ONLY** — no backend or
  frontend source change, no Prisma schema, no migration, no API, no permission, no event
  consumer, no posting rule, no test, no CI or dependency change.
- **Baseline:** `main` @ `24474ac6b28f89e5799057370d86fb603bb89897` (merge of PR #128).
  Branch `arena/6f3fecd4-vardena`. 27 migrations / 140 unit specs / 48 e2e suites / 49
  Accounting permission codes (unchanged by this sprint).
- **Deliverable:**
  [`docs/tasks/c-60-inventory-accounting-boundary-and-decision-package.md`](docs/tasks/c-60-inventory-accounting-boundary-and-decision-package.md)
  — 22 sections: current-state matrix per inventory flow; the inventory→accounting gap
  matrix including the **four ledger writers that are not business documents**
  (`InventoryMovementsService`, `InventoryTransfersService`, `MaterialRequestsService.invoke`,
  and the business-document path itself); the OQ dependency matrix; the accounting boundary
  (value ownership A1–A3, journal-creation options B1–B5, transaction boundary and forbidden
  partial states, idempotency identity); the four transaction questions; event/integration
  options O1–O5 with one recommendation; idempotency options I1–I3; **sixteen failure
  scenarios** plus extras; per-flow analysis (Receipt, Issue, Transfer, Purchase Return, Sales
  Return, Reversal/Correction); Pricing/Reverse-Pricing ↔ Accounting with the post-boundary
  mutation models P1–P4; the OQ-69 valuation-history audit (gaps M1–M6); the
  `accountingEligible` two-axis semantics; frontend surfaces (MVP/later/deferred); security and
  organization isolation; a dependency graph; six proposed epics **C-61…C-66**; the Product
  Owner decision register **PO-01…PO-12**; and the C-60 final report.
- **Key verified findings (evidence in the package):** `accountingPostDocument` writes a
  boundary flag and creates **no** accounting effect, stores **no** accounting reference, and
  publishes a post-commit event; `accountingEligible` reads the document flag and the
  movements' `valuation_status` but **not** the key-level
  `inventory_valuation_states.status = 'stale'` (**E-1**); after Accounting Post only
  `reversePricing` refuses a valuation change — `runPricing`, one-key `recalculate`, backdated
  repricing and `assignCost` have no accounting awareness; the kernel event bus is in-memory,
  unpersisted and **swallows subscriber errors**, and the Inventory document path publishes
  **after** commit; there is exactly one subscriber in the repository; `AccountingModule`
  exports `AccountingDocumentsService` with no caller; and **PDR-08 §8's OD-PRC-11 row is
  stale** (the eligibility gate it assigns to C-59F was implemented by PR #125) — recorded,
  not edited, because a decision record is the Owner's to change.
- **Open Questions:** **OQ-72 opened** (authority for system-origin postings; also recorded in
  this file §9 and in `docs/open-questions.md`). No OQ is closed, narrowed or reclassified;
  OQ-24/25/27/30/39/42/69/70/71 remain OPEN and are mapped to what they block.
- **Decisions requested (not taken):** PO-01 value ownership (recommend A2) · PO-02 journal
  creation/delivery (recommend B3/O3 transactional in-process subscription) · PO-03 boundary
  subject (recommend documents only) · PO-04 voucher granularity · PO-05 key-stale blocking
  (recommend yes) · PO-06 transfer journal (recommend T1 no journal) · PO-07 post-boundary
  valuation change (recommend P1 block) · PO-08 cancellation/reversal linkage · PO-09
  idempotency identity (recommend I3) · PO-10 ratify the two-axis rule · PO-11 purchase-return
  posting (recommend blocked until OQ-70/counterparty) · PO-12 sales-return posting (recommend
  deferred until Sales).
- **Verified locally:** `git diff --check` clean; documentation-only diff; every OQ/PDR/ADR
  identifier and code anchor in the package checked against the tree. Heavy verification
  (suites, live PostgreSQL, E2E, migration rehearsal) is delegated to CI under the standing
  local-test policy; the PR pipeline runs the standard gates.
- **Record:** [`docs/tasks/c-60-inventory-accounting-boundary-and-decision-package.md`](docs/tasks/c-60-inventory-accounting-boundary-and-decision-package.md).
  **READY FOR REVIEW — documentation only; this sprint authorizes no implementation.**

## 28. C-61 — Approved Inventory → Accounting Decision Package (2026-10-07)

- **Status:** Documentation-only decision package recorded on the C-61 working branch. Review/merge and live GitHub CI status are reported from the actual PR/check state, not inferred from this state entry. **Implementation remains pending.** C-61 authorizes no Accounting posting integration and does not start C-62.
- **Sequence:** C-59 Inventory Valuation → C-60 Boundary Analysis → C-61 Approved Decision Package → **future C-62 Accounting Core Implementation**. C-62 is the recommended next epic after review and applicable OQ gates; it is not authorized or started by this record.
- **Authority:** [PDR-09](docs/decisions/product/PDR-09-inventory-accounting-posting-boundary.md) is the Owner decision register for PO-01…PO-12; [ADR-0041](docs/adr/0041-synchronous-inventory-accounting-application-contract.md) records the synchronous public-contract architecture; [C-61 package](docs/tasks/c-61-approved-inventory-accounting-decision-package.md) carries the decision crosswalk, OQ status and implementation gaps. C-60 recommendations are not adopted unless PDR-09 explicitly says so.
- **PO status:** PO-01 through PO-11 are Product Owner decisions; PO-06 is limited to same-Legal-Entity warehouse transfers; PO-11 allows a Purchase Return at authoritative Inventory cost and blocks only the agreed-price variance pending OQ-70. PO-12 is an Owner-approved **Deferred** decision: Sales Return Accounting waits for a Sales Accounting contract. See PDR-09 for exact language.
- **Open questions:** OQ-24, OQ-25, OQ-39, OQ-42, OQ-69, OQ-70, OQ-71 and OQ-72 remain OPEN. OQ-70 is narrowed to Accounting policy/account mapping for the Purchase Return agreed-price variance; cost-based return posting is not blocked by OQ-70. OQ-69's Ledger Authority + Immutable Valuation History conceptual architecture is recorded, but accountant/auditor sufficiency remains open. OQ-71's Inventory Reverse Pricing constraints are decided; Accounting correction/reversal behavior remains open. OQ-72 system-origin authority, permission model and worker/system actor semantics remain open.
- **Decision boundary:** Inventory owns quantity, movement, valuation and history; Accounting owns account mapping, journal construction, voucher policy and financial posting. PO-02 selects a synchronous in-process application-service call through explicit public contracts in the Modular Monolith, not microservices or event/outbox primary delivery. Only explicitly approved Inventory Business Documents may initiate posting. The chain is Business Document → Accounting Posting Operation → Voucher → Journal Lines; eligibility is not posting evidence, and any relevant stale valuation key blocks eligibility.
- **Implementation discrepancies:** current `accounting_posted` Inventory state is not proof of an Accounting Voucher; key-level stale valuation must gate eligibility; valuation changes after actual Accounting Post must be blocked; transaction/failure behavior and system-origin authority remain open. These are recorded for future gated implementation and are not fixed here.
- **Production code:** **No production code changed.** No services/controllers/repos/domain implementation, Prisma schema/migration, API/DTO, permissions, event consumer, posting rule, voucher, journal line, correction engine or UI was changed. `git diff --check` passed; a lightweight local-link check passed for 272 local Markdown links across the 32 changed Markdown files. No tests, E2E, database, migration, or CI checks were run locally; report GitHub CI only from the actual PR/check state.
- **Documentation set:** PDR-09, ADR-0041, C-61 task package, OQ registry, this state record, ADR/product indexes, `.vardena` rules/context, architecture/module/accounting indexes, and domain-contract/analysis/blueprint/glossary/decision references are reconciled to the Owner decisions. Complete file list and actual lightweight-check/CI status belong in the C-61 completion report.

**Implementation pending — C-61 is not C-62.**

## 29. C-62 dependency and decision readiness (2026-10-07)

Documentation-only post-C-61 merge analysis: [C-62 readiness package](docs/tasks/c-62-dependency-decision-readiness.md) classifies OQ-24/25/39/42/69/70/71/72 against a conditional first Receipt posting slice and prepares six unanswered Owner decision cards. No OQ is closed, no production posting authorized. Current Inventory `accounting_posted` flag is not an Accounting voucher reference; C-62 implementation remains gated by the package's hard blockers.

### C-62 Owner decision approval (2026-10-08; PR #131 continuation)

Product Owner Ali Esmaeili approved C62-OD-01…06, recorded in [PDR-10](docs/decisions/product/PDR-10-c62-inventory-accounting-posting-modes.md) and reconciled in the [C-62 package](docs/tasks/c-62-dependency-decision-readiness.md). This supersedes the package's earlier recommendations, not PDR-09. Atomic posting is preferred **only if cleanly feasible**; the current service transaction seams are **NOT CLEANLY FEASIBLE** for direct shared atomic composition, and a reviewed feasibility/design gate remains pending (otherwise use the approved durable pending fallback). Both Warehouse-configured direct-final and Accounting-owned draft modes are approved; draft is not posted. C-62 production implementation is **not performed**; OQ-24/25/39/42/69/70/71/72 remain OPEN for their residual scope. The C-61 historical working-branch entry above describes its original writing, not current merge status: PR #130 merged at `18c8e2a`. Next implementation slice remains pending feasibility and remaining policy gates.

## 30. OQ-73 — BusinessDate persisted as PostgreSQL `date` (2026-10-09)

- **Status:** Implemented on the C-63 stacked branch (PR #134 over PR #133). BusinessDate and Instant are now separate persistence types: every business-day column (`movement_date`, `business_date`, valuation/pricing run bounds, the C-62 posting-snapshot `document_date`, balance `last_movement_date` renamed from `last_movement_at`) is PostgreSQL `date` carrying the canonical Gregorian day; audit/event instants (`*_at`, `valued_at`, `posting_timestamp`) remain `timestamptz`; at this section's initial writing, Inventory validity windows were still `timestamptz` (the later Owner decision is recorded in §31).
- **Migration:** `20261011000000_business_date_persistence` converts each legacy day column with the deterministic policy `(column AT TIME ZONE 'UTC')::date` — byte-for-byte the UTC calendar day the previous `timestamptz` read path returned, so no row changes its business date and nothing is lost. The migration is verified by GitHub CI only (local Prisma engines/database are unavailable in this environment); no local migration rehearsal was run.
- **Contract:** the API keeps `{ calendar, value }` input and `{ gregorian, jalali }` output for business dates; day fields render canonical `YYYY-MM-DD`. Day filters are true `date` comparisons (inclusive bounds, index-friendly). Kardex order stays (business day, entry time, id); backdating, valuation/pricing replay and the C-61/C-62 posting semantics are preserved. Idempotency hashes use the canonical client day, never a clock.
- **Docs:** `docs/datetime.md` (§1–§4, §7–§11), ADR-0042 (Accepted, PO-02 2026-10-09), `docs/open-questions.md` (OQ-73 moved to Resolved), ADR index and `docs/modules.md` reconciled.

## 31. Date/time hardening and Inventory validity windows (2026-10-09)

This is a follow-up to §30, not a reopening of OQ-73. ADR-0042 and `docs/datetime.md` remain the single normative policy.

- **Owner-approved compatibility boundary:** existing Inventory BusinessDate inputs that historically received transformed `Date`/ISO-Instant values keep that compatibility. A legacy ISO instant resolves to its UTC calendar day, independent of the written offset and organization zone. Keep this isolated to the existing Inventory boundaries; canonical day-only filters and new contracts remain day-only.
- **Owner-approved validity classification:** global and item-specific unit-conversion windows and item-valuation-method windows are BusinessDate `[valid_from, valid_to)` ranges; `NULL valid_to` is open-ended. Adjacent versions remain valid. No other `valid_*` columns are reclassified. Migration `20261012000000_inventory_business_date_validity_windows` converts the UTC calendar day and fails before conversion on collapsed/reversed windows, duplicate starts, overlaps, or dates outside the general four-digit BusinessDate/API range. It does not read `organization.calendar_system`, enforce Jalali renderability, or lock Organization.
- **Data evidence boundary:** `backend/prisma/rehearsal/business-date-validity-windows/audit.sql` is the aggregate-only target report; `rehearse.mjs` applies the migration to representative synthetic rows in a uniquely named disposable PostgreSQL database, including a valid Gregorian day outside the Jalali rendering envelope. CI migration/rehearsal results are not evidence about customer history. Before deployment, establish shared apply/checksum history independently, run and retain the report on the pre-migration target, review non-midnight endpoint counts and exceptions, rehearse against a restorable target-like copy, and verify backup/recovery. Do not deploy with unresolved collisions, overlaps or out-of-range dates; do not claim production-data safety from code review or fixtures.
- **Migration 130 indexes:** retain the movement date and six validity-window indexes tied to current Inventory filter/order paths; remove indexes over run dates, balance last-movement date, and posting-snapshot document date where no current filter/order consumer exists. Query-plan performance has not been independently established by the fixture.
- **Migration 110 history:** worktree SQL is restored byte-for-byte to `main`; standard Inventory input resolved old ISO instants in the organization zone before the writer stored the BusinessDate as a UTC-midnight carrier. Raw/alternate writers and actual historical target rows remain uninspected. Preserve this as an explicit limitation, not a customer-data guarantee.
- **Verification:** GitHub CI on the exact head of existing PR #135 is authoritative for test/rehearsal status; never reuse results from an earlier SHA or claim a test that did not run.

## 32. Licensing product requirements — canonical source of truth (2026-10-11)

- **Status:** [PDR-11](docs/decisions/product/PDR-11-vardena-licensing-product-requirements.md) is the Owner-approved licensing product requirements reference (transcribed from the Owner brief of 2026-10-11; traceability by section, no new decision IDs). It is a product record, not an implementation specification. Its conflicts with accepted ADRs were reconciled on 2026-10-11 (PDR-11 §19) instead of being silently rewritten, and no pending product policy was decided.
- **Reconciliation:** [docs/tasks/pdr-11-conflict-reconciliation.md](docs/tasks/pdr-11-conflict-reconciliation.md) holds the CF-1…CF-22 matrix (affected records, resolution, evidence, status) and the U-1…U-9 / PQ-1…PQ-9 audit. Resolved: CF-1, CF-2, CF-3, CF-5, CF-13, CF-14, CF-15, CF-16, CF-17, CF-18, CF-20, CF-21, CF-22. Partially resolved (behaviour defined, policy registered): CF-6 → OQ-82, CF-7 → OQ-78, CF-8 → OQ-74, CF-12 → OQ-81, CF-19 → OQ-85. Still OPEN and preserved: CF-4 and CF-10 → OQ-78, CF-9 → OQ-45, CF-11 → OQ-79.
- **Open items preserved and registered:** the genuinely undecided PDR-11 §15 items now have registry rows in [docs/open-questions.md](docs/open-questions.md): U-1→OQ-74, U-5→OQ-75, U-6→OQ-76, U-7→OQ-77, U-9→OQ-82/OQ-83, PQ-3→OQ-78, PQ-4→OQ-79, PQ-5→OQ-80, PQ-6→OQ-83, PQ-7→OQ-85, PQ-8→OQ-81, PQ-9→OQ-84; U-2 stays a design item behind the installation identity key, and U-3/U-4/U-8 are answered by ADR-0046 plus `docs/licensing/version-model-and-file-exchange.md`. **OQ-45 and OQ-53 stay Open.** No listed policy was decided: signing-key emergency handling, Owner permission matrix, Grace duration/override, clock-rollback thresholds, audit retention, and the remaining commercial trade-offs.
- **Accepted records that carry the resolution:** **ADR-0045** (persistent installation identity and local license activation — the licensing record renumbered from the duplicate 0036) and **ADR-0046** (signed license documents, retained license versions, deterministic effective-version resolution), both accepted for their stated slices with the scope written in the file.
- **Implemented in PR #137 (L-03 first slice) — MERGED to `main` at `345047abec5a6af6760b05ad36b570ee5ed3a5f9` (2026-10-11; PR head `2ecd8396f0edcc1c34b3724c79cd767b3401c96d`; merge-commit CI run `38171112633` success). Merged is not Owner-accepted.** Scope as merged: retained license versions — `licensing.license_versions`, `licensing.license_version_entitlements`, typed append-only `licensing.license_audit_events` — through migration `20261014000000_licensing_version_model_and_import`, which backfills every existing license row non-lossily (statuses copied verbatim; `replaced_at` → `superseded_at`; entitlements keep their ids); `POST /api/v1/license/import` (signed `VLIC2` file envelope, bare artifact, or legacy `VLIC1` code) behind `Licensing.License.Activate` with a strict rejection order; replay-safe `operationId`; future-dated renewals retained without invalidating the governing version; deterministic effective-version resolution with signed-supersession-only overlap; `GET /api/v1/license/current` reporting the effective and scheduled versions; a file-first frontend import path (license gate + a permission-gated renewal card on the dashboard); and the migration rehearsal `backend/prisma/rehearsal/licensing-version-model/rehearse.mjs`, wired into CI as `Migration rehearsal (Licensing version model and import)`.
- **Corrective review of that slice (2026-10-11, Product-Owner review of PR #137, same branch/PR):** (1) supersession is now two facts — `superseded_at` records *when* it was recorded, `governs_until` (new column, new ordered migration `20261015000000_licensing_supersession_governs_until`, which backfills from the recorded successor and thereby repairs versions retired prematurely) records *from when* the predecessor stops governing = the successor's own `validFrom`; a future-dated supersession therefore no longer interrupts the license that is valid now, and it hands over exactly at its start. (2) The import transaction now takes a per-installation `SELECT … FOR UPDATE` row lock and re-runs the conflict evaluation under it (READ COMMITTED), so concurrent imports of one installation cannot commit incompatible windows; the loser gets the documented 409 and writes nothing. The overlapping-future-dated-document rule is unchanged (still refused without an explicit signed supersession), and CF-1/CF-2 in the reconciliation matrix were re-stated so they no longer rest on the non-overlapping-renewal case alone.
- **Temporal invariant (2026-10-11, Product-Owner temporal directive, same branch/PR):** the ambiguity between a signed license's `validFrom`, the import instant and the predecessor's `governsUntil` is registered as **OQ-86** (PDR-11 §3.2 settles only future-dated renewals; §3.4 hands overlap/gaps to PQ-5/OQ-80, which stays Open and untouched). Interim behaviour is fail-closed and technical, with no schema change and therefore no migration: the single conflict authority (`evaluateImportConflicts`, run as the read-side pre-check and again inside the import transaction under the installation row lock) refuses a supersession whose hand-over would remove governance the retired version already exercised before the import instant — `backdated-supersession`, 422, nothing written, the operation id stays unused — via the exported predicate `supersessionRewritesPastGovernance`. A hand-over at or after the import instant, the correction of a version that had already ended (the stamp moves no effective window) and backdated documents that retire nothing keep their documented behaviour; the two supersession instants (`superseded_at`, `governs_until`) are unchanged. Consequence registered with the question: the legacy `VLIC1` replacement of a still-governing version is refused by the same rule, while legacy renewals by adjacency (the code starts at or after the end of the version it follows) keep working.
- **Evidence boundary:** unit suites (`backend/src/modules/licensing/domain/license-document.spec.ts`, `license-version.spec.ts` — including the two-instant supersession rules, the single conflict authority, the temporal refusal predicate and the disjoint-window invariant — and `application/license-import.service.spec.ts` — including the future-dated-supersession timeline on a pinned clock, the hand-over boundary at the import instant and the refused backdated supersession with its rollback), the hermetic e2e suite `backend/test/license-import.e2e-spec.ts`, the live PostgreSQL suite `backend/test/licensing-persistence-live.e2e-spec.ts` (runs on GitHub CI; also executed locally against PostgreSQL 16.4 on 2026-10-11 as non-CI evidence — see the post-merge bullet) — which is the **only** accepted evidence that concurrent imports cannot commit conflicting windows — the frontend suite `frontend/src/features/licensing/license-import.test.tsx`, and the rehearsal above (runs on GitHub CI, now with an extra database carrying the premature-retirement defect that the corrective migration must repair). GitHub CI on the exact PR head is authoritative; no result from an earlier SHA is reused — the temporal directive's code head is `df41f73`, whose run `38169257077` is green (backend and frontend, including `Prisma validate`, `Migrate test database` with the new ordered migration, the licensing version-model rehearsal and the live-DB e2e step where the reworked legacy-refusal case and the concurrency suite executed), and the run that carried the corrective-review evidence was `38164310367` on head `fae7f8c`; the earlier failure on this branch (`38163440380`, head `8887dae`) came from one over-broad assertion of the live concurrency suite's audit count, which now asserts the installation's applied events instead of the whole audit table. `frontend/src/api/generated/vardena-api.d.ts` could not be regenerated locally (`npm run api:types` needs a booted API and a database) — recorded as an open tooling gap, not as done.
- **Not implemented (decision-gated):** full revocation/reactivation and any login-blocking state, Grace/Read-Only enforcement, server replacement and activation receipts, the installation identity key, client-device licensing, clock-rollback detection, audit retention, and the Owner-side system. Home location, CRM/billing and every commercial trade-off stay with the Owner.
- **Authority note:** an implementation agent cannot promote product decisions; ADR-0045/ADR-0046 are recorded as **Accepted for their slices** with explicit scope. Acceptance of this work, of any §15 answer and of any OQ row remains the Owner's decision.
- **Post-merge verification (2026-10-11, branch `arena/f0ddc379-vardena`; report [docs/tasks/licensing-post-merge-reconciliation.md](docs/tasks/licensing-post-merge-reconciliation.md)):** at that date `main` was the PR #137 merge commit `345047a`, whose merge-commit CI is green (run `38171112633`; backend job `114563738873`, 27 steps; frontend job `114563738695`). `345047a` is no longer the tip of `main`: this verification round's fixes reached `main` only through the PR #138 merge `d283744` (§33), and `git grep license-binding-conflict 345047a -- backend/src` returns nothing, so the refusal described below is **not** present at `345047a`. A live probe on the merged code found two defects, both fixed with one retained-state refusal, `license-binding-conflict` (409, nothing written — **an interpretation pending Product Owner ratification**): (a) a renewal naming an existing `licenseId` under another customer was applied and re-attributed every retained version (PDR-11 §2.1); (b) a `licenseId` owned by another installation surfaced as an unmapped database error (HTTP 500). The generated OpenAPI client lacked `/license/import` and was regenerated (additive only). Gap C — a non-superseding backdated document accepted against a retired version's past window, with an `ambiguous` as-of read that contradicts the ADR-0046 D4 wording — is **open and unchanged**: it is the OQ-86 decision (with OQ-80), see [docs/tasks/licensing-oq-80-oq-86-decision-brief.md](docs/tasks/licensing-oq-80-oq-86-decision-brief.md). Local results on the final tree (non-CI): backend unit 1962/1962; licensing unit 115/115; licensing live + e2e 55/55; full e2e 616/616; BusinessDate live under Asia/Tehran and America/Los_Angeles 24/24 each; four migration/operational rehearsals rc 0; frontend 397/397, build rc 0. No OQ status changed.
- **Follow-up on PR #138 (2026-10-12, same branch `arena/f0ddc379-vardena`; report §13 of [docs/tasks/licensing-post-merge-reconciliation.md](docs/tasks/licensing-post-merge-reconciliation.md)):** two installations claiming one unused license identifier at the same moment was not classified as a conflict: the license row was written by an upsert, which silently adopted the other installation's row, and the composite foreign key then failed as an unmapped error (reproduced live: `P2003`). A plain `INSERT` now claims a new identifier, the primary key arbitrates, and the loser is refused as `license-binding-conflict` (409) inside the transaction. The generic unique-violation → `duplicate-operation` mapping is narrowed to the version's own identity constraints. The import response has a documented schema (`LicenseImportResultDto`), and the generated client was regenerated from the live document. `GET /license/current` and `POST /license/activate` still have no response schema (F-6, open). OQ-80 and OQ-86 are unchanged and OPEN. **Merge state (verified 2026-10-12):** this round was written while `arena/f0ddc379-vardena` was still unmerged; it reached `main` as PR #138, merge commit `d283744b4098346b6ef2e0b91922266f10cdabd1`, and its merge-commit CI is green (§33).
- **Next gate:** Owner acceptance of PR #137 **and** PR #138 (both merged, neither accepted); Owner decisions on OQ-80, OQ-86, renewal identity (Q3) and installation customer change (Q4) per the decision brief; ratification of `license-binding-conflict`; the open follow-ups F-6 (`GET /license/current` and `POST /license/activate` have no OpenAPI response schema) and F-7 (no CI drift check for the generated client). Revocation, expiry enforcement (Grace/Read-Only, OQ-45), replacement and device licensing each need their own Owner decisions and ADR-gated design before implementation (PB-BASELINE §11.2; AR-29). The candidate next slice is L-04, capacity-change conflicts (PDR-11 §8.4/§8.6); it is not started and waits for the Owner decisions it depends on — readiness assessed in §33.

## 33. Post-merge verification of PR #138 and L-04 readiness (2026-10-12)

- **Status:** verification and records-only pass. Full report: [docs/tasks/licensing-pr-138-post-merge-verification-and-l-04-readiness.md](docs/tasks/licensing-pr-138-post-merge-verification-and-l-04-readiness.md). **No product decision was taken, no OQ status changed, no product code changed, no PR merged.**
- **Verified `main`:** `git ls-remote origin refs/heads/main` and `git rev-parse origin/main` both return `d283744b4098346b6ef2e0b91922266f10cdabd1` — the merge commit of PR #138 (`Licensing: refuse license re-binding; post-merge audit of PR #137`), `state=MERGED`, `mergedAt=2026-10-12T06:03:27Z`, base `main`, head branch `arena/f0ddc379-vardena`, `headRefOid=4bdd97048002dede854d3925c3a182854ed93988`, parents `345047a` (PR #137 merge) and `4bdd970`. The merge commit's tree is **identical** to the PR head's tree (`git rev-parse d283744^{tree} 4bdd970^{tree}` → both `f9dd36f5b5a273dbc0e24ae79c3d9e1a0b0da487`; `git diff --stat 4bdd970 d283744` is empty), so the merge added no content beyond the reviewed head.
- **CI evidence, kept apart by SHA.** Merge commit `d283744`: run `38210710188` (`CI`, `push` to `main`), `completed / success` — backend job `114683993213` (27 steps, all `success`, including `Migrate test database`, `Bootstrap system administrator`, both BusinessDate live suites, all three migration rehearsals and `E2E tests (incl. live-DB suites)`), frontend job `114683993419` (13 steps, `success`). **This run is the only evidence that verifies `main`.** PR head runs, recorded for history only and never reused as merge-commit evidence: `38208790250` (`pull_request`, final head `4bdd970`, backend `114678096343` + frontend `114678095992`, `success`) and `38174043699` (`pull_request`, round-1 head `8a8e637`, backend `114572514150` + frontend `114572513981`, `success`). The local test counts in the reports are **local claims**, not CI results: they were produced against PostgreSQL 16.4 binaries with `apply-migrations.mjs` and Prisma engine substitutions, not the CI service container and `prisma migrate deploy` (report finding F-14). The legacy combined-status endpoint for `d283744` reports `pending` with zero statuses, as it did for `345047a`; this repo's gates are Actions check runs, and the check-runs API reports `backend: success` and `frontend: success`. The legacy endpoint is not used as evidence. Per-test counts inside the CI log are not quotable from the sandbox (the log blob host is unreachable), so only step- and job-level conclusions are cited.
- **Record inconsistencies found and corrected (reconciliation only).** (1) §32's post-merge bullet stated in the present tense that "`main` and the PR #137 merge commit are `345047a`"; `main` is now `d283744`, and `license-binding-conflict` does not exist at `345047a` (`git grep license-binding-conflict 345047a -- backend/src` → no match), so every record describing that refusal as landed had to be scoped to the PR #138 merge. Corrected in §32, in `docs/tasks/licensing-post-merge-reconciliation.md` (header, findings F-1/F-2/F-5/F-9, new §14), `docs/tasks/pdr-11-conflict-reconciliation.md` (Status row) and `docs/decisions/product/PDR-11-…md` §19.4 (merge-state sentence only; §1–§18 policy text untouched). (2) PR #138's own merged description quotes the **round-1** local counts (backend unit 1962/1962, licensing unit 115/115, licensing live+e2e 55/55, full e2e 616/616, client diff "84 lines") while the merged tree's final round is report §13.3 (1965/1965, 118/118, 58/58, **619/619**, client diff 67 added / 1 removed). Both are local claims; §13.3 describes the merged tree and is the one to read. A PR description cannot be re-scoped by an agent, so the discrepancy is recorded here rather than edited.
- **Reconciled implementation state (each verified against the tree at `d283744`, not against prose).** `license-binding-conflict` is implemented as rule 2a of the single conflict authority `evaluateImportConflicts` (`domain/license-version.ts`) plus the cross-installation guard under the installation lock and the plain-`INSERT` claim in `data/licenses.repository.ts`, mapped to 409 in `application/license-import.service.ts`; **its name and 409 class are still an implementation interpretation pending Owner ratification** (report §9 item 1, decision brief §7). OQ-80 and OQ-86 are **OPEN** in the register with their post-merge evidence notes, and Gap C still reproduces by code reading: `overlappingVersions` filters on `isEligibleAt(version, at)`, so a retired version is never counted as an overlap — pinned by the unit test "never counts a superseded version as an overlap" (`license-version.spec.ts`). Renewal identity (Q3/F-8) is unchanged: `buildLicensePayload` does `licenseId: options.licenseId ?? generateId()` and `issue-development-license.ts` parses no `--license-id` flag, so the CLI can only ever mint a new identifier. Installation customer transfer (Q4/F-4) is unchanged: a successful import still executes `tx.installation.update({ … data: { customerId: command.customerId } })`. OpenAPI response schemas: `POST /license/import` documents `LicenseImportResultDto` (present in the generated client), while `GET /license/current` and `POST /license/activate` still carry `@ApiOkResponse({ description })` with **no `type`**, and the generated client renders `content?: never` for both 200 responses (F-6, open). Generated-client drift verification in CI: **absent** — `.github/workflows/ci.yml` has no step that regenerates or diffs `frontend/src/api/generated/vardena-api.d.ts`, and `frontend/package.json` exposes `api:types` without any CI caller (F-7, open); what exists instead is the server-side e2e contract case and the client-side `LICENSE_IMPORT_RECEIPT_MATCHES_OPENAPI` assignability check. Initial administrator credential (F-12, **blocker for any non-development deployment**, pre-existing): `BOOTSTRAP_SYSTEM_ADMINISTRATOR_INITIAL_PASSWORD = '1'` is a hardcoded constant in `bootstrap/system-administrator-bootstrap.service.ts` with no environment override (`.env.example` has no such variable) and no forced change; `README.md` documents `مدیر` / `1` and states forced password change is not implemented.
- **L-04 readiness: NOT READY — blocked on Product Owner decisions, not on engineering.** L-04 (capacity-change conflicts, PDR-11 §8.3/§8.4/§8.6) is not started. §8.3 is implemented (`LicensingService.assertCanActivateUser`, `assertCanCreateOrganization`); §8.4 and §8.6 are not — the import path persists `organizationLimit`/`userLimit` without ever comparing them to current usage. PDR-11's own row 59 marks the §8.6 algorithm a design item (§16 item 3). The blocking dependencies are the Owner decisions in the prioritized list of the report: which version's capacity governs on a given day cannot be answered before OQ-80 (overlap/gap) and OQ-86 (retroactivity) are decided, and whether a reducing version applies at its `validFrom` with a conflict state or is held until the administrator resolves the excess is undecided policy (§8.6 admits both readings). Q3 (renewal identity) must be settled because capacity attaches to a license identity. Heavy live/E2E suites are **not** a blocker: they run in CI and are green on `d283744`. F-6, F-7 and F-12 are follow-ups that do not gate L-04's start, though F-12 gates any deployment.
- **This pass's own commit and CI:** the corrections above are commit `ca33a8266d83c47b53c77d51392a8a3ac83455f7` on branch `arena/050ebc8c-vardena`, opened as **PR #139** (base `main`, **not merged** by this pass). Its CI is green on the exact SHA: run `38213183679` (`pull_request` at `ca33a82`), backend job `114691779064` (27 steps) and frontend job `114691779170` (13 steps), `completed / success`. Documentation-only diff (six Markdown files); no local suite was run or claimed, since neither `node_modules` exists, no PostgreSQL or Docker is available, and root Markdown is covered by neither Prettier gate.
- **Next gate:** Owner acceptance of PR #137 and PR #138 (both merged, neither accepted), then the prioritized decisions D-1…D-6 in the report. Until D-1/D-2 (OQ-80, OQ-86) and D-4 (Q3) are recorded by the Owner in `docs/open-questions.md` and the decision brief's §7 table, L-04 must not be started; the implementation agent will not close either question or ratify `license-binding-conflict` on its own.

## 34. F-6 / F-7 OpenAPI contracts and generated-client CI (2026-10-12)

- **Status:** engineering follow-up on branch `arena/d4469d29-vardena`. Full record: [docs/tasks/licensing-f6-f7-openapi-and-client-drift.md](docs/tasks/licensing-f6-f7-openapi-and-client-drift.md). **No product decision, no OQ status change, no migration, L-04 not started.**
- **Base:** `main` `9ac2cc58d3fef2659feaa867a2565a99e8e77102` (merge of PR #139). PR #139 remains documentation-only; this section does not rewrite §33's CI evidence.
- **F-6:** `GET /api/v1/license/current` documents `LicenseStateDto`; `POST /api/v1/license/activate` documents `LicenseImportResultDto` (same mutation receipt as import). Verified by `license-openapi.contract.spec.ts` against `SwaggerModule.createDocument`, plus e2e assertions on `/api/docs-json`. The generated client 200 bodies are those schemas, not `content?: never`.
- **F-7:** job `generated-api-client` dumps OpenAPI via `npm run openapi:dump` (Nest boot, no listen, no Postgres query) and regenerates `frontend/src/api/generated/vardena-api.d.ts` with pinned `openapi-typescript@7.13.0`, then `git diff --exit-code HEAD`. Developer path: `./scripts/check-generated-api-client.sh`.
- **Limitation:** dump may log a permission-registry sync warning when Prisma client engines are missing; the document is still written. Heavy e2e/live suites are GitHub CI only.

## 35. Owner decisions on OQ-80 / OQ-86 / Q3 / Q4 and their implementation (2026-10-12)

- **Status:** decisions recorded + implementation recorded on branch `arena/ff87e27d-vardena`; **not yet CI-verified and not Owner-accepted**. Records: [docs/tasks/licensing-oq-80-oq-86-decision-brief.md](docs/tasks/licensing-oq-80-oq-86-decision-brief.md) §7/§8, [docs/open-questions.md](docs/open-questions.md) (OQ-80/OQ-86 rows + dated log + new OQ-87), [docs/tasks/licensing-post-merge-reconciliation.md](docs/tasks/licensing-post-merge-reconciliation.md) §9/§15, ADR-0046 dated addendum, PDR-11 §19.4 dated addendum (§1–§18 untouched). This section does not rewrite §33's or §34's CI evidence.
- **Base verified before the change:** `cdf21e4d6bd5da7e5d95f98f88302122425ec6b1` (`git rev-parse origin/main`; the merge commit of PR #140, the F-6/F-7 OpenAPI/client-drift slice).
- **Decisions (Product Owner, 2026-10-12):** OQ-80 overlap = **Option B** (the later starting version governs in the overlap); OQ-80 gap = **G2** (a renewal may not leave a gap; adjacency is contiguous); OQ-86 = **Option C** (the candidate is checked against the full retained effective history, retired windows included — the previous Gap C is closed); legacy `VLIC1` restriction preserved (no bypass); import tolerance **strict**; as-of reads **recomputation** from retained records; Q3 renewal identity = **same `licenseId`**; Q4 installation customer change = **explicit, authorized, audited operation only**; `license-binding-conflict` **ratified** (name, HTTP 409, nothing written).
- **Implementation (same branch):** `license-version.ts` — overlap against effective windows of all retained versions, Option B hand-over (`overlapping-range` when the start cannot take precedence, ambiguity refused), G2 `renewal-gap`, PDR-11 §8.6 guard `reduction-requires-resolution` for an implicit hand-over that shrinks the retained grant, customer-binding rules with `installation-customer-mismatch` / `transfer-not-applicable`. `licenses.repository.ts` — the lock returns the installation's customer; the evaluation is authoritative under the lock; the transfer intent is authorized by an explicit operation and audited with a typed `license.installation.customer-transferred` event (new additive migration `20261016000000_licensing_customer_transfer_audit`). `license-import.service.ts` — `transferCustomer` entry point; the import path never re-binds silently. New route `POST /api/v1/license/customer-transfer` under the new permission `Licensing.Installation.TransferCustomer`.
- **Verification recorded so far (local, this branch):** focused unit suites for the licensing module pass; `tsc --noEmit` clean; the licensing e2e suites (including the live-PostgreSQL persistence suite) pass against a local PostgreSQL 16 cluster created for this session. **CI on this exact commit has not run yet**, and the migration has not been rehearsed in CI; both are required before any claim of completion.
- **Blocked:** **OQ-87** (registered 2026-10-12) — may a NEW license identity cover a lapse for the same customer + installation? OQ-80 G2 + Q3 leave post-gap recovery undefined; no rule grants or refuses it (the pre-decision behaviour is preserved) and no workflow may claim recoverability until the Product Owner answers. The L-04 capacity slice stays behind its gate (decisions recorded, but OQ-87 open and CI pending).
- **Next gate:** CI on the exact head of this branch, then Product Owner review of the records (which are the deliverable of this phase) — the decisions are recorded, not accepted.
- **Review fix (PR #141, 2026-10-12): a reduction can no longer hide behind an explicit supersession.** `evaluateImportConflicts` applied the PDR-11 §8.6 guard only to the implicit hand-over, so a signed document carrying `supersedesOperationId` could reduce `organizationLimit`, reduce `userLimit` or remove an entitlement without passing through it. The capacity/entitlement guard (`reducesCapacityOrEntitlements`) now runs on **every** path that retires a version — explicit supersession, implicit precedence, legacy `VLIC1` replacement — and refuses with `reduction-requires-resolution` (409, nothing written, no stamp, no version, operation id not retained) until L-04 implements §8.6's check/explain/preserve/explicit-resolution flow. Closing an **open end** (perpetual → time-limited) stays guarded only where the document does not name the version it retires; a signed supersession that names it keeps its documented behaviour, recorded as an interim reading in the decision brief §8.7 and the design doc §3.3. **L-04 remains outstanding and OQ-87 remains OPEN.**
- **Owner decision recorded (2026-10-12): the license-term question is decided — explicit signed supersession may convert a perpetual grant into a time-limited one, and that is the only reduction-adjacent change it authorizes.** Recorded as **[PDR-12](docs/decisions/product/PDR-12-license-term-supersession.md)** (decision id **OD-LIC-01**, index row in `docs/decisions/product/README.md`, registry log entry in `docs/open-questions.md`), with the interim reading in the decision brief §8.7 and the design doc §3.3 replaced by the decision. Policy: explicit, valid, signed `supersedesOperationId` may change the term (perpetual → time-limited) while `organizationLimit`, `userLimit` and the granted entitlements are **not reduced**; naming the version to retire never unlocks a capacity or entitlement reduction (`reduction-requires-resolution`, 409, nothing written — unchanged reason and contract). Implicit precedence (OQ-80 Option B) and the legacy `VLIC1` transport keep the stricter guard (an open end is a reduction there) and gain no bypass. **L-04 (§8.6 capacity-conflict detection + resolution flow) remains outstanding and is not completed by this decision; OQ-87 stays OPEN.** Status: decision recorded · implementation recorded in PR #141 · tests passed locally · CI verification and Product Owner acceptance outstanding.

