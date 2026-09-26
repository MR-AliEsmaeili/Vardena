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

React/TypeScript/Vite/Tailwind/shadcn is the fixed frontend stack (ADR-0002). Updated by Task 22 — **ACCEPTED 2026-09-26**: `frontend/` now exists as a Vite React SPA package (`frontend/package.json`, `frontend/src/{app,api,features,ui,lib,styles,test}`) implementing ONE vertical slice — login/session against `POST /api/v1/auth/login` + `GET /auth/me` + `POST /auth/logout`, effective-permission UX gating (`GET /api/v1/permissions/effective`), organization context from `GET /api/v1/organizations`, an RTL application shell, and the read-only Accounting surfaces (chart tree, account statement, general ledger, trial balance). Do **not** describe any other shipped UI: there is no create/edit/finalize screen, no Inventory, Workflow, Documents, RBAC-admin, Treasury, reporting, export or notification UI, and the frontend is not part of `docker-compose.yml`.

`backend/src/worker.ts`, `worker.module.ts`, `worker.service.ts` establish a separate worker and database startup check. Actual dispatch loops are explicitly deferred in `worker.service.ts`; a production jobs/outbox runner is **not verified**. Docker Compose defines PostgreSQL 16, migration initialization, API and worker (`docker-compose.yml`, `backend/Dockerfile`). Architecture diagrams describe more capabilities than are implemented.

In the following table, module paths are relative to `backend/src/modules/`; model lists are extracted from `backend/prisma/schema/<module>.prisma`. API resource names come from controller declarations, not inferred folder responsibilities. Tests are present, not executed here.

| Module / directory | Verified responsibility | HTTP surface (controller resource paths) | Related models | Test evidence |
|---|---|---|---|---|
| `health/` | Liveness/readiness probes | `health` | None | backend/test/health.e2e-spec.ts |
| `identity/` | Login/session authentication | `auth` | Session | backend/test/auth.e2e-spec.ts |
| `users/` | User administration and credentials | `users` | User | application/users.service.spec.ts; backend/test/rbac.e2e-spec.ts |
| `rbac/` | Permission registry, roles and user-role evaluation | `permissions`, `roles` | Permission, Role, RolePermission, UserRole | application/authorization.guard.spec.ts; backend/test/rbac.e2e-spec.ts |
| `organization/` | Organizations, branches, departments, employees and party master data | `branches`, `departments`, `employees`, `organizations`, `parties` | Organization, Branch, Department, Employee, Party | domain/hierarchy.spec.ts; backend/test/master-data.e2e-spec.ts; backend/test/deployment-scope.e2e-spec.ts |
| `inventory/` | Item/unit/warehouse master data; movements, balances, reservations and transfers | `inventory/balances`, `inventory/movements`, `inventory/reservations`, `inventory/transfers`, `inventory/item-groups`, `inventory/items`, `inventory/unit-conversions`, `inventory/units`, `inventory/warehouses` | Unit, UnitConversion, ItemUnitConversion, ItemGroup, Item, Warehouse, InventoryMovement, InventoryBalance, InventoryReservation, InventoryOperation | backend/test/inventory-core.e2e-spec.ts |
| `documents/` | Document type configuration, numbering allocation and typed relations | `documents/relations`, `documents/types`, `documents/numbering-series` | DocumentTypeConfig, NumberingSeries, NumberingAllocation, DocumentRelation | backend/test/documents-live.e2e-spec.ts |
| `workflow/` | Versioned definitions, states/transitions, instances, approvals and automation bindings | `workflow`, `workflow/definitions`, `workflow/instances` (nested routes in each controller) | WorkflowDefinition, WorkflowVersion, WorkflowState, WorkflowTransition, WorkflowInstance, WorkflowTransitionHistory, WorkflowApproval, WorkflowAutomationBinding | backend/test/workflow-live.e2e-spec.ts |
| `accounting/` | Fiscal scope, accounts/configurations, vouchers, posting/ledger, balance projection/reversal and bounded read-only reporting | `accounting/balances`, `accounting-configurations`, `accounting-documents`, `accounting-periods`, `accounts`, `coding-structures`, `financial-areas`, `fiscal-years`, `accounting/account-statements`, `accounting/general-ledger`, `accounting/trial-balance` | FinancialArea, FiscalYear, AccountingPeriod, CodingStructureVersion, CodingStructureLevel, Account, AccountingConfiguration, AccountingConfigurationLevel, AccountingDocument, AccountingDocumentLine, AccountingPostingOperation, LedgerEntry, AccountBalanceProjection | domain/money.spec.ts; domain/document-reversal.spec.ts; accounting report service/domain specs; backend/test/accounting-documents-live.e2e-spec.ts; backend/test/accounting-period-lifecycle-live.e2e-spec.ts |

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

- Monetary debit/credit and projection amounts use Decimal/numeric(18,2); inventory quantities use numeric(18,4) (`accounting.prisma`, `inventory.prisma`). Accounting APIs/domain use exact decimal strings and BigInt-scaled arithmetic; excessive input precision is rejected, not silently rounded (`accounting/domain/money.ts`). Multi-currency/FX behavior is not established by this storage type (OQ-03/47/48).

### Security inventory and limits

- **Verified implementation (static):** opaque random 256-bit sessions, SHA-256 token storage and Argon2id passwords (`identity/domain/session-token.service.ts`, `identity/application/auth.guard.ts`, `users/domain/password.service.ts`, paths under `backend/src/modules/`). Session model has idle/absolute expiry and revocation fields; authentication service and config control cookie/session behavior.
- **Verified implementation (static):** `rbac/application/authorization.guard.ts` fails closed for missing permission metadata; `authorization.service.ts` checks the database-backed union of flat role permissions without a permission cache. Route checks plus application-service checks exist, including reversal's `Accounting.Document.Reverse` (`accounting/api/accounting-documents.controller.ts`, `accounting/application/accounting-documents.service.ts`). Absence of a request context is explicitly treated as trusted system context by the authorization service: future non-HTTP entrypoints require review.
- **Partially verified isolation:** explicit organization parameters and scoped lookups/locked-row checks appear in Accounting repositories/services. The optional deployment pin is enforced by `organization/application/deployment-scope.guard.ts` and organization services. ADR-0025 explicitly distinguishes this from tenant authorization. (Bootstrap-era statement; **superseded on `main` by Task 19 ODR-3**, which added `organization.organization_memberships` and the principal-bound `assertOrganizationInScope` chokepoint, and by the 2026-09-26 post-merge correction, which extended the binding to membership administration itself with a single bootstrap exception — see §7/§8 and `docs/security.md` §3.) User-to-organization membership and full multi-tenant security were **not found** in the schema inspected at bootstrap; when the pin is unset, structural scoping alone is not proof of authority.
- **Sensitive operations inspected:** finalization/posting, reversal, close/reopen/seal, configuration freeze. Transactional checks, permission codes, reason requirements and audit fields/events are present; end-to-end enforcement has **not been runtime verified** in this bootstrap. Durable audit/outbox delivery is **not verified** merely because events/logs exist (`worker.service.ts`, ADR-0004/0005, `docs/task-9-implementation-report.md`).

### Testing and CI inventory

All commands below are defined in `backend/package.json` and run from `backend/`; listed commands were **not executed** during bootstrap.

| Purpose | Command / configuration |
|---|---|
| Unit | `npm test` (Vitest; `vitest.config.ts`, `src/**/*.spec.ts`); `npm run test:cov` |
| HTTP/E2E including opt-in live DB | `npm run test:e2e` (Vitest + Supertest; `vitest.config.e2e.ts`, `test/**/*.e2e-spec.ts`) |
| Integration | No separately named `test:integration` script; live integration cases are in `test/*-live.e2e-spec.ts` and `test/db.e2e-spec.ts` |
| Migration fixture rehearsal | `npm run test:migration-rehearsal` |
| Operational freeze rehearsal | `npm run test:operational-freeze-rehearsal` |
| Quality | `npm run lint` (Oxlint), `npm run typecheck`, `npm run format:check` (Prettier) |
| Build | `npm run build` (Nest) |
| DB setup | `npm run prisma:validate`, `npm run prisma:generate`, `npm run prisma:deploy` |

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

| Identifier / title | Recorded status | Decision summary / related area or task | Evidence path |
|---|---|---|---|
| ADR-0001: Modular Monolith (Not Microservices) | Accepted | Modular monolith with hard module boundaries; all modules | `docs/adr/0001-modular-monolith.md` |
| ADR-0002: Technology Stack (Fixed Set) | Accepted | Fixed backend/frontend stack; platform | `docs/adr/0002-technology-stack.md` |
| ADR-0003: Legacy ERP Isolation via Adapter Layer | Accepted | External legacy systems isolated behind adapters; integrations | `docs/adr/0003-legacy-erp-adapter-isolation.md` |
| ADR-0004: Outbox Pattern for External Synchronization | Accepted | Transactional outbox for external delivery; integration/worker | `docs/adr/0004-outbox-pattern.md` |
| ADR-0005: Domain Events for Inventory → Accounting | Accepted | Inventory-to-Accounting domain event contract; event infrastructure | `docs/adr/0005-domain-events-inventory-accounting.md` |
| ADR-0006: RBAC with Granular Permissions | Accepted | Granular backend RBAC; Users/RBAC | `docs/adr/0006-rbac-granular-permissions.md` |
| ADR-0007: Server-Side Opaque Sessions | Accepted | Server-side opaque sessions; Identity | `docs/adr/0007-server-side-sessions.md` |
| ADR-0008: Single Database, Schema per Module, ULIDs | Accepted | One database with module schemas and ULIDs; data layer | `docs/adr/0008-single-database-module-schemas.md` |
| ADR-0009: Reporting via Module Views + Scoped Raw SQL | Accepted | Module-owned views and scoped raw SQL; reporting | `docs/adr/0009-reporting-views-raw-sql.md` |
| ADR-0010: DB-Backed Job Queue (No External Broker in v1) | Accepted | PostgreSQL-backed queue, no external broker; worker/jobs design | `docs/adr/0010-db-backed-job-queue.md` |
| ADR-0011: Validated Excel Import Workflow | Accepted | Validated staged Excel import; planned import capability | `docs/adr/0011-excel-import-workflow.md` |
| ADR-0012: Printing Template System | Accepted | Templates plus module-owned print data providers; planned printing | `docs/adr/0012-print-template-system.md` |
| ADR-0013: User Preferences as Validated Key-Value | Accepted | Validated key-value preferences; planned customization | `docs/adr/0013-user-preference-key-value.md` |
| ADR-0014: OpenAPI as the Single API Contract | Accepted | Generated OpenAPI from DTOs; API boundary | `docs/adr/0014-openapi-contract.md` |
| ADR-0015: Backend Foundation Conventions | Accepted | Backend conventions for errors, correlation and infrastructure; foundation | `docs/adr/0015-backend-foundation-conventions.md` |
| ADR-0016: RBAC Enforcement and Evaluation | Accepted (refines ADR-0006 — permission caching) | Route + service authorization, no permission cache; RBAC | `docs/adr/0016-rbac-enforcement-and-evaluation.md` |
| ADR-0017: Inventory Ledger as Source of Truth with Materialized Balances | Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21) | Immutable movement ledger and rebuildable balances; Inventory | `docs/adr/0017-inventory-ledger-as-source-of-truth.md` |
| ADR-0018: Bounded, Versioned Workflow Configuration (No Workflow Engine) | Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21) | Code-bounded versioned state machines; Workflow | `docs/adr/0018-bounded-versioned-workflow.md` |
| ADR-0019: Document Foundation — Typed Tables, Shared Mechanics, Controlled Relations | Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21) | Typed document tables with common mechanics; Documents | `docs/adr/0019-document-foundation-and-relations.md` |
| ADR-0020: Organizational Scope, the Organization Module and Master-Data Ownership | Proposed (needs accept/reject — see the gate in `docs/architecture/domain/domain-blueprint.md` §21) | Organizational scope and master-data ownership; Organization | `docs/adr/0020-organizational-scope-and-master-data.md` |
| 0021 — Organization-scoped master data (every master-data row carries `organization_id`) | Proposed | Organization scope on every master row; Task 6 | `docs/adr/0021-organization-scoped-master-data.md` |
| ADR-0022: Inventory Core — Movement Ledger, Idempotent Posting and Availability Policy | Accepted (implemented by Task 9.5; idempotency hardening by Task 9.6, 2026-09-13) | Movement posting/idempotency and availability policy; Tasks 9.5/9.6 | `docs/adr/0022-inventory-core-ledger.md` |
| ADR-0023: Document Foundation Implementation — Type Registry, Numbering, Relations | Accepted (implemented by Task 8; ADR recorded during Task 9.6 hardening, 2026-09-13) | Document registry/numbering/relations implementation; Tasks 8/9.6 | `docs/adr/0023-document-foundation-implementation.md` |
| ADR-0024: Workflow Foundation — Reusable Platform Capability | Accepted (implemented by Task 9, 2026-09-12) | Reusable workflow foundation; Task 9 | `docs/adr/0024-workflow-foundation.md` |
| ADR-0025: Optional Single-Organization Deployment Pin | Accepted (implemented by Task 9.6, 2026-09-13) | Optional deployment organization pin, not tenancy; Task 9.6 | `docs/adr/0025-single-organization-deployment-pin.md` |
| ADR-0026: Accounting Bounded Context — Module Boundary, Fiscal-Calendar Ownership and the System-Posting Contract | Accepted (accepted 2026-09-14 — the design decision from Task 10.1, before Task 10.2 writes any Accounting schema) | Accounting boundary, fiscal ownership and posting; Task 10.1 | `docs/adr/0026-accounting-bounded-context.md` |
| ADR-0028: Accounting Configuration Foundation — Versioned Root, Single ACTIVE, Operational Freeze | Accepted (Final 2026-09-18 — Review Fix Round 2 per D1-D7) | Versioned configuration, single ACTIVE, operational freeze; Tasks 11/13 | `docs/adr/0028-accounting-configuration-foundation.md` |
| ADR-0029: Machine/API access model — licensed API keys on the RBAC permission model | Proposed (pending product-owner ratification — not Accepted) | Proposed licensed API keys on RBAC machine principals; future API access | `docs/adr/0029-machine-api-access-model.md` |
| ADR-0030: License foundation — minimal, non-punitive, enforcement-off | Proposed (pending product-owner ratification — not Accepted) | Proposed offline-first license foundation with enforcement off; future licensing | `docs/adr/0030-license-foundation.md` |
| ADR-0031: Accounting Balance Projection — Rebuildable Turnover-Only Materialization | Proposed (2026-09-22 — vertical slice implemented as `READY FOR REVIEW`, not Accepted) | Turnover-only rebuildable projection; Task 12 | `docs/adr/0031-balance-projection.md` |
| ADR-0032: Accounting Period Close — In-Transaction Enforcement, Gate Placement and the Reopen Exception | Proposed (2026-09-23 — Task 14 implemented as `READY FOR REVIEW`, not Accepted) | Locked in-transaction period close gate with reopen exception; Task 14 | `docs/adr/0032-accounting-period-close-enforcement.md` |
| ADR-0033: Account Identity and Account Code History — `Account.id` Is Permanent, `code` Is a Business Identifier | Proposed (2026-09-25 — Task 17C documentation consolidation; Owner decisions Q3/Q8/Q18/Q21 + Invariant 1; not Accepted, no implementation) | Account identity, code history, historical code resolution, opening identity, deletion vs deactivation | `docs/adr/0033-account-identity-and-code-history.md` |
| ADR-0034: Posting Account XOR Aggregation Account — One Semantic Role per Account Node | Proposed (2026-09-25 — Task 17C; Owner decision Q5 + Invariant 2; records an unresolved conflict with contract §14 rule 2 / AC-I-09 `postable ⇒ leaf`, which stays in force) | POSTING vs AGGREGATION semantics, double-counting prevention, configurable posting eligibility | `docs/adr/0034-posting-versus-aggregation-accounts.md` |
| ADR-0035: Accounting Code Structure Migration — Controlled, Licensed, Audited; Never Rewrites Economic Ledger History | Proposed (2026-09-25 — Task 17C; Owner decisions Q3/Q8/Q19/Q20 + Invariant 3; the service does NOT exist and is not authorized) | Code-structure migration service, licensing/approval/reconciliation gates, level-count exclusion | `docs/adr/0035-account-code-structure-migration.md` |
| ADR-0036: Legal Reporting Architecture — Accounting Core → Legal Adapter / Legal Profile | Proposed (2026-09-25 — Task 17C; Owner decisions Q9/Q10/Q11/Q22; architecture only, **no legal fact decided** — OQ-43 stays OPEN) | Legal profile layering, independent Journal Book / General Ledger, language and monetary unit, identity for legal reporting | `docs/adr/0036-legal-reporting-architecture.md` |
| ADR-0037: Accounting Configuration Boundary — Base Structure, Standard Control Roles, Configurability Bounded by Invariants | Proposed (2026-09-25 — Task 17C; Owner decisions Q1/Q2/Q4/Q6/Q7/Q17; base structure and control roles are NOT in code) | Hybrid configuration model, control roles, dimensions/floating detail, configurability limits | `docs/adr/0037-accounting-configuration-boundary.md` |

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

| Task | Title / evidence | Implementation / merge evidence | Review status / uncertainty | Recorded PR or commit |
|---|---|---|---|---|
| 1–4 | Individually NOT YET DOCUMENTED in inspected task records; `.vardena/project-context.md` collectively says Tasks 1–11 backend implemented | Backend foundation exists; exact numbered scopes UNKNOWN | UNKNOWN | UNKNOWN |
| 5 | Ownership/design reference in `docs/task-6-implementation-report.md` §Task 5 conflicts | Referenced design; exact formal brief/title NOT YET DOCUMENTED | UNKNOWN | UNKNOWN |
| 6 | Organization & Master Data Foundation; `docs/task-6-implementation-report.md`, ADR-0021 | Models/services/migrations present in organization/inventory | UNKNOWN; report is implementation evidence, ADR-0021 Proposed | Report base `d22419a` |
| 7 | NOT YET DOCUMENTED as a distinct task in inspected records | UNKNOWN; collective Tasks 1–11 claim is insufficient to assign scope | UNKNOWN | UNKNOWN |
| 8 | Document Foundation; ADR-0023 | Documents module/schema present; ADR explicitly attributes implementation to Task 8 | UNKNOWN; accepted ADR is not task acceptance | NOT YET DOCUMENTED |
| 9 | Workflow Foundation; `docs/task-9-implementation-report.md`, ADR-0024 | Workflow module/schema/migration present | UNKNOWN | Report base `1bc0327` |
| 9.5 | Inventory Core; ADR-0022 | Ledger/balances/posting attributed to Task 9.5 | UNKNOWN | NOT YET DOCUMENTED |
| 9.6 | Idempotency/isolation hardening; ADR-0022/0023/0025 | Hardened operations and deployment pin present | UNKNOWN | NOT YET DOCUMENTED |
| 10.1 | Accounting Domain Contract; `docs/accounting/domain-contract.md`, ADR-0026 | MERGED (recorded index); documentation only | Task review UNKNOWN; ADR explicitly Accepted separately | #15, #16 |
| 10.2 | Financial area/year/period foundation; index §2; migration `20260914000000_accounting_foundation` | MERGED (recorded index), code present | UNKNOWN | #17 |
| 10.3 | Coding structures/chart; index §2; migration `20260914010000_accounting_coding_structure_accounts` | MERGED (recorded index), code present | UNKNOWN | #18 |
| 10.4 | Voucher foundation; `docs/task-10.4-implementation-report.md` | MERGED (recorded index), document schema/code present | UNKNOWN; later report calls it accepted, not re-adjudicated here | #19; `51f0bcc` |
| 10.5 | Posting readiness; `docs/task-10.5-implementation-report.md` | MERGED (recorded index); readiness domain/service present | UNKNOWN | #20 |
| 10.6 | Posting/ledger contracts; index §2; `accounting/domain/posting.ts`, `ledger-entry.ts` | MERGED (recorded index); pure contracts present | UNKNOWN; later report calls it accepted | #21 |
| 10.7 | Atomic ledger materialization; `docs/task-10.7-implementation-report.md` | MERGED (recorded index); ledger migration/repository present | UNKNOWN; later report calls it accepted | #22; `6946ea6e3892f1408212f7b6e215fbf9164f675a` recorded in 10.8 report |
| 10.8 | Posting orchestration; `docs/task-10.8-implementation-report.md` | MERGED (recorded index); PostingService present | UNKNOWN | #23 |
| 10.9 | Intentionally skipped / not defined; index §6 | NOT DOCUMENTED as an authorized task | UNKNOWN | None recorded |
| 11 | Accounting Configuration Foundation; index §2/§6; `docs/task-11-{implementation,final-verification,defect-resolution}-report.md` | Code/migration present; merged references and remediation history in index/reports | **Recorded ACCEPTED 2026-09-22 in authoritative task index**, not a new bootstrap decision; older READY FOR REVIEW records preserved | #25, #27, #28, #29; defect-resolution head `bb0335b` |
| 12 | Balance Projection; `docs/task-12-{implementation,remediation}-report.md`, `docs/task-12-final-review-fa.md`, index §6/§8 | Code/migration present; #30 MERGED observed via GitHub; no acceptance inferred | **UNKNOWN — REQUIRES OWNER CONFIRMATION:** index quotes legacy “ACCEPTED WITH FOLLOW-UP”; reports retain READY FOR REVIEW/CHANGES REQUIRED; ADR-0031 Proposed. P1 real-PG concurrency remains recorded open | #30; `a62a13d`, `264a395`; merge `1ce8d78c91a463d921568733803bf95e18ab6b24` |
| 13 | Operational Freeze; `docs/task-13-implementation-report.md`; OQ-64 resolved in `docs/open-questions.md` | Marker wired in repository; #31 MERGED observed; Task 14 report records #31 merge as baseline | Recorded IN PROGRESS/self-review/READY FOR REVIEW, NOT Accepted; final decision UNKNOWN | #31; merge `2ea11609170f7fd52916068603b02955cae819a2` |
| 14 | Period Close Foundation; `docs/task-14-implementation-report.md`, ADR-0032 | Gate/locked-row checks and live test suite present; #32 MERGED observed | Recorded READY FOR REVIEW — NOT ACCEPTED; final decision UNKNOWN; ADR Proposed | #32; change `31442cf`; merge `ce223fb25001a6feed3b4f428ac69c1f3af4a955` |
| 15 | Accounting reversal foundation; `backend/prisma/migrations/20260923000000_accounting_document_reversal/migration.sql`, `accounting/domain/document-reversal.ts`, service/repository, reversal tests | Implementation present; baseline commit explicitly merges #33; GitHub confirms title/merge | UNKNOWN; no dedicated Task 15 brief/review/report found in docs; stale no-reversal comments persist | #33; baseline `79d69e1fa2450749302a24c2688869e9378643f0` |
| 16 | Task 16 contract finalization; `docs/tasks/task-16/brief.md`, `decision-reconciliation.md` | **Contract formalized 2026-09-24; no production implementation** — Owner Direction Established; Accounting Foundations Existing | **Contract finalization: READY FOR REVIEW. Implementation authorization: BLOCKED — OWNER CONFIRMATION REQUIRED.** Not implemented, accepted or production-ready; one concrete document/amount authority gate remains | No implementation PR/branch/commit established |
| 17 | Accounting Reporting Foundation; `docs/tasks/task-17/brief.md`, `prompt.md`; Accounting task index §2/§4 | **Task definition formalized 2026-09-24; no production implementation** — bounded Accounting-owned reporting inputs only | **Documentation task: READY FOR REVIEW. Implementation: FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS (OQ-25/OQ-43).** Not implemented, accepted or production-ready; Task 12 P1 remains separate and Task 14 is not treated as accepted | Documentation-only work on `arena/01a0d451-vardena`; implementation PR/commit NOT YET DOCUMENTED |
| 17A | Bounded first slice of Task 17 — Accounting Ledger Movement Read Source; `docs/tasks/task-17/task-17a-implementation-report.md`, `docs/tasks/task-17/task-17a-acceptance-record.md` | Implementation present on `main` (PR #39 merged in `130fab9`): `domain/ledger-movement.ts`, `LedgerMovementsService`, read-only `listMovements`, `GET /api/v1/accounting/ledger-movements`, `Accounting.LedgerMovement.View`; **no schema, migration, index, aggregation or report definition** | **ACCEPTED (2026-09-25)** by explicit Owner Decision. Scope: Accounting-owned read-only ledger movement source over `accounting.ledger_entries`, `GET /api/v1/accounting/ledger-movements`, `Accounting.LedgerMovement.View`, org isolation, bounded pagination, allow-listed sorting, exact Decimal strings. **Does NOT close OQ-25/OQ-43 or complete Task 17** | PR **#39** merged in `130fab9`; CI run `36048743757` green |
| 17B | Bounded second slice of Task 17 — Account Statement read surface; `docs/tasks/task-17/task-17b-{prompt,implementation-report,acceptance-record}.md` (Owner decisions D1–D7) | Implementation present on `main` (PR #43 merged in `b10e007`): `domain/account-statement.ts`, `AccountStatementsService`, read-only `AccountStatementsRepository`, `GET /api/v1/accounting/account-statements`, `Accounting.AccountStatement.View` (36th code); **no schema, migration, index, aggregation platform or report definition** | **ACCEPTED (2026-09-25)** by explicit Owner/Reviewer Decision (PR #43 reviewed before merge). Scope: bounded read-only account statement (one account + one fiscal year + optional period; debit-positive net; intra-year sequence-based opening, no carry-forward; Debit/Credit/Net only — no classification or account nature; fixed statement order; OPEN/CLOSED/SEALED readable and never mutated; org-first 404/422 scope matrix; no new per-user financial-area authorization). **Does NOT close OQ-25/OQ-43 or complete Task 17** | PR **#43** merged in `b10e007` (merged head `1ec996e`; implementation commit `9ee46f7`); CI run `36074225037` green incl. the live-PostgreSQL suite |
| 17C | Accounting Decision Consolidation (documentation only); `docs/accounting/owner-decision-baseline.md`, `docs/tasks/task-17/task-17c-prompt.md`, ADR-0033…0037, `docs/accounting/domain-contract.md` §31 | **No production implementation** — documentation consolidation on `arena/01a0d7c4-vardena` (base `b10e007`, merge of PR #43; **synchronized with `main` @ `2892189`, the merge of PR #44**): Owner decisions Q1–Q22 + invariants I-1…I-3 recorded, reconciled against `main`, 13 discrepancies and 12 open implementation details registered; five ADRs created **Proposed**; OQ-25/OQ-43 annotated (still OPEN); `docs/adr/README.md`, contract §31, task index §2/§4/§5/§9 and `STATE.md` §3/§7/§8/§9/§10 synchronized | **ACCEPTED (2026-09-25)** — documentation-only governance acceptance recorded by the **Task 17C Acceptance Sync** (acceptance record: `docs/tasks/task-17/task-17c-acceptance-record.md`). The acceptance accepts the owner decision consolidation — Q1–Q22 + invariants I-1…I-3, with discrepancies D-1…D-13 and open items O-1…O-12 preserved exactly as recorded — as authoritative, synchronizes the governance documentation, and confirms that the ADR proposals accurately reflect those decisions; **ADR-0033…0037 remain Proposed** (task acceptance ≠ ADR acceptance; each ADR remains pending its separate adoption/implementation gate). No code, API, DTO, schema, Prisma, migration, seed, permission, report, UI, dependency or behaviour change; Task 17B's implementation untouched; no ADR status promoted by the acceptance; Task 17 remains **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS** and is **NOT complete** (OQ-25/OQ-43 remain OPEN — acceptance resolves neither); no legal/statutory claim. Task 17B's status is preserved exactly as **PR #44** established it on `main` — **ACCEPTED (2026-09-25)** (PR #43 merged in `b10e007`, merged head `1ec996e`; `docs/tasks/task-17/task-17b-acceptance-record.md`) — and that acceptance authorized **no** future Task 17 slice, including 17C (Task 17C was authorized separately by the Owner's Task 17C prompt); the recorded discrepancy **D-8** is RESOLVED by the PR #44 merge (`2892189`), not by any status promotion here | Consolidation PR **#45** merged in `2565254` (work on `arena/01a0d7c4-vardena`); documentary correction PR **#48** merged in `7f8e3e8`; acceptance sync on `arena/01a0d8c0-vardena`; no implementation PR/commit |
| 19 | Task 19 — Accounting Chart / Configuration Foundation; `docs/tasks/task-19/task-19-implementation-gate.md`, `docs/tasks/task-19/task-19-implementation-report.md`, `docs/tasks/task-19/task-19-acceptance-record.md` | Implementation present on `main`: PR **#54** implemented ODR-1 Explicit Configuration Coherence, ODR-2 Accounting-owned Chart Tree and ODR-3 Principal-bound Organization Authorization; PR **#55** corrected the ODR-3 membership-administration boundary without changing ODR-1/ODR-2 | **ACCEPTED (2026-09-26)** under Owner-authorized Acceptance Sync after final repository review. ODR-1 rejects divergent code-shape pins without silent winner/fallback and does not repair existing divergent rows; ODR-2 is the bounded organization-scoped Chart Tree read surface with inactive accounts readable and `isPostable` authoritative; ODR-3 is membership-bound organization authorization through `assertOrganizationInScope`, including the bounded first-grant bootstrap exception only for an empty organization. OQ-25/OQ-43/OQ-62/OQ-63/OQ-01/OQ-22 remain OPEN; OQ-19 remains OPEN where referenced for bootstrap provisioning; ADR-0033…0037 remain Proposed; Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED and NOT complete | PR **#54** merged in `f15325184023ff0c7e9d34727834da19f4350eda`; PR **#55** merged in `6a69bc6c17bf0dfb69a15adc3e3203ae6098d871`; final CI run **`36238862315`** success; acceptance record `docs/tasks/task-19/task-19-acceptance-record.md` |
| 18 | Accounting Reporting Read Foundation; `docs/tasks/task-18/task-18-implementation-report.md`, `docs/tasks/task-18/task-18-acceptance-record.md` | Task 18 Owner Decisions D1–D20 implemented on `arena/01a0d841-vardena` and **MERGED into `main`** via PR **#46** in `e774a1c37c921ba83e4e9c23729fde6205cedb76` (reviewed implementation head `5971bed`; review-fix commits `4182346`/`0d9cf76`): shared `AccountingReadQueryRepository`; read-only Account Statement extension, General Ledger and Trial Balance controllers/services/DTOs; independent report permissions; no schema/migration/report persistence; D5 resolved Ledger-native — `accounting.ledger_entries` is authoritative and the Task 12 projection is derived/rebuildable only | **ACCEPTED (2026-09-25)** — reviewed by the Repository Owner/Reviewer before merge and formally accepted. The final review-fix addressed the D5 source-of-truth/reconciliation point: `accounting.ledger_entries` is the authoritative financial source, the Task 12 projection is a materialized turnover-only derived/rebuildable read optimization, Task 18 remains Ledger-native, introduces no second monetary source of truth and does not depend on the projection at runtime for financial truth; a focused Trial Balance reconciliation assertion verifies opening, turnover, period net and closing against the authoritative Ledger source. Evidence: focused D5 reconciliation **2 passed**; accounting unit suite **43 files / 538 tests**; full backend unit suite **97 files / 1,100 tests**; typecheck, build, format and `git diff --check` passed; lint 0 errors with 6 pre-existing unrelated warnings (**not** Task 18 failures); CI run **36133360887** on head `5971bed` `backend` completed success (Prisma validation, lint, typecheck, format, unit tests, build, migration rehearsal, live-PostgreSQL E2E) and predates the documentation/test-only review-fix commits. Task 18 was implemented against the approved D1–D20 baseline and acceptance closes none of the out-of-scope capabilities. **OQ-25/OQ-43 remain OPEN**; Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED and NOT complete; no ADR promoted | PR **#46** **MERGED** in `e774a1c37c921ba83e4e9c23729fde6205cedb76` (implementation commits `d986c78`, `9b784f0`, `5971bed`; review-fix `4182346`, `0d9cf76`); verified CI run **36133360887** (`backend`) completed successfully on the reviewed implementation head `5971bed`; implementation = **MERGED**, Task governance status = **ACCEPTED (2026-09-25)** |

| 20 | Task 20 — Accounting Chart Semantics & Master Structure (Investigation, Decision Resolution + Gate); `docs/tasks/task-20/accounting-chart-semantics-investigation.md`, `docs/tasks/task-20/task-20-implementation-gate.md`, `docs/tasks/task-20/task-20-acceptance-record.md` | **No production implementation** — documentation/investigation plus Owner decision resolution only. Merged decision-resolution work: PR **#58** (`10797e1400fda6329ca481877f9bbf9eff850fcd`). The six authoritative decisions remain exactly recorded: Base Chart mechanism/adoption; consumer-first control roles; independent effective-dated mapping rather than `Account.control_role`; producer-bound code history with controlled pre-use correction and post-use immutability; leaf-only POSTING/read-time AGGREGATION; and transaction-line analytical dimensions. | **ACCEPTED (2026-09-26)** under Owner-authorized Formal Acceptance Sync. Documentation-only acceptance: no production code, TypeScript, Prisma schema, migration, SQL, API, DTO, permission, authorization behavior, dependency, UI, or production test changed. Task 19 (ODR-1/ODR-2/ODR-3) remains **ACCEPTED and unchanged**. **OQ-25/OQ-41 remain OPEN** where applicable; OQ-43/OQ-62/OQ-63/OQ-01/OQ-22 and unrelated OQs remain OPEN; ADR-0033…0037 remain Proposed and are not accepted by this task. | PR **#58** merged in `10797e1400fda6329ca481877f9bbf9eff850fcd`; acceptance record `docs/tasks/task-20/task-20-acceptance-record.md` |

| 21 | Task 21 — Base Chart Governance & OQ-25 Resolution; `docs/tasks/task-21/*` | **No production implementation** — documentation-only governance baseline; Owner acceptance ratifies the proposed governance without inventing Base Chart content | **ACCEPTED (2026-09-26)** by explicit Repository Owner decision after final static review PASS. OQ-25 remains OPEN and substantially narrowed; no ADR promoted; Task 19/20 unchanged; OQ-41/OQ-43 remain OPEN; no implementation authorization is created by this acceptance | Acceptance record: `docs/tasks/task-21/task-21-acceptance-record.md` |
| 22 | Task 22 — Frontend Vertical Slice (Login → Session → RTL Shell → Organization Context → Accounting Read Surfaces); `frontend/README.md`, `docs/architecture.md` §6/§7 | **First frontend implementation in the repository.** New `frontend/` Vite + React 19 + TypeScript SPA on the ADR-0002 stack (React Router, TanStack Query, Axios, React Hook Form + Zod, TanStack Table, Tailwind v4, shadcn/ui-style primitives, Day.js). Implements: single Axios instance with the `{code,message,details?,correlationId}` error envelope normalization and cookie session transport (ADR-0007); login/logout/protected routes/expired-session handling against the real Identity endpoints; effective-permission UX gating (AR-21, no wildcards); organization context from `GET /api/v1/organizations` following ADR-0025 (single effective organization ⇒ no switcher, several ⇒ switcher, selection in memory only); responsive RTL shell; and the four read-only Accounting surfaces — chart tree, account statement, general ledger, trial balance — with server-side filtering/paging/allow-listed sorting and exact decimal strings rendered without any frontend arithmetic. API types are generated from the OpenAPI document (ADR-0014) into `frontend/src/api/generated/vardena-api.d.ts`. CI gains a parallel `frontend` job. **No Backend production behavior changed** — no backend source, DTO, permission, schema, migration or endpoint was modified | **ACCEPTED (2026-09-26)** under Owner-authorized formal acceptance synchronization; Arena Agent did not self-accept. Local verification on the implementation head: `npm ci` (frontend) OK, `npm run lint` 0 warnings/0 errors, `npm run typecheck` clean, `npm run format:check` clean, `npm test` **11 files / 63 tests passed**, `npm run build` OK (chunked bundle, no warnings); backend `npm run build` OK and `git status` clean of backend changes. Live-database backend E2E was not run locally (delegated to the backend CI job, unchanged). No ADR promoted, no OQ closed; OQ-02 (UI language/Jalali) remains OPEN and is the reason all strings live in one dictionary and dates are displayed exactly as the API returns them; Tasks 19/20 untouched | Branch `arena/01a0ded9-vardena` (branched from `71f430c`); PR **#62**; head `772bdbb`; final CI run **36263398518** — `frontend` job **success** and `backend` job **success** (backend job unchanged, incl. live-PostgreSQL E2E); implementation report `docs/tasks/task-22/task-22-implementation-report.md` |
| Bootstrap System Administrator (unnumbered) | Real initial administrator provisioning; `docs/tasks/bootstrap-system-administrator/implementation-report.md` | Post-migration command creates the ordinary Users record, `System Administrator` role, all 131 code-registered role-permission rows and the user-role row; Docker Compose and CI run the same idempotent built command. Existing Identity authentication, Argon2id hashing, RBAC guards and ODR-3 membership remain authoritative; no schema/migration/endpoint/wildcard/bypass and no bootstrap organization | **READY FOR REVIEW — NOT ACCEPTED.** Local fast evidence and authoritative CI are green as recorded in the implementation report. Forced password change is not implemented; the operator must reset the initial password. The role and provisioning mechanism are implementation facts, not new Owner Decisions: OQ-14 remains OPEN for occupational and future role baselines, and OQ-19 remains OPEN for self-disable, self-role-removal, and last-administrator lockout protection | Branch `arena/01a0df57-vardena`; implementation head `96e6b622c33db57e9289e6caf8b2cbb0a35af2c0`; PR **#64** open; CI run **`36269856402`** success |

Rows with shortened paths `accounting/...` refer to `backend/src/modules/accounting/...`. The Task 11 report notation above denotes the three real separately named files, not a literal brace-named file.

## 8. Current Task

The current accepted work item is **Task 22 — Frontend Vertical Slice: ACCEPTED (2026-09-26)**. Task 21 remains accepted under explicit Repository Owner acceptance after final static review PASS. Task 21 is documentation-only: it ratifies the governance baseline for the Base Chart content model, adoption/version/customization governance, mandatory-account semantics, consumer-first control-role governance, per-level posting defaults under OD-20-5, and the OQ-36 boundary, without inventing accounting content or implementing production capability. **OQ-25 remains OPEN and substantially narrowed**; Base Chart content values, concrete control-role catalog/mandatory set, OQ-36 deletion/code-reuse policy, account-level template provenance and other explicitly deferred items remain open. No ADR is promoted, Task 19 and Task 20 remain accepted and unchanged, and no implementation is authorized by this acceptance alone.

**In review (not accepted): Bootstrap System Administrator (unnumbered task).** On branch `arena/01a0df57-vardena`, the implementation adds a migration-safe, idempotent post-migration command that provisions the real Users-domain account `مدیر`, hashes its fixed initial password through the existing Argon2id service, creates/uses the ordinary `System Administrator` role, assigns every one of the 131 currently registered permission codes, and inserts the normal user-role relation. Docker Compose and CI invoke the same built command. Runtime authentication, database-backed RBAC and ODR-3 Organization membership checks are unchanged: there is no hardcoded login/password check, wildcard, role-name runtime semantic, hidden endpoint, permission bypass, organization bypass, bootstrap Organization, schema change or migration. A fresh administrator creates the initial organization and uses the accepted first-member grant; organization-scoped paths 404 before that membership. Forced password change is not implemented, so the initial credential must be reset immediately through the existing API. The bootstrap role and procedure are implementation facts, not new Owner Decisions: OQ-14 remains OPEN for occupational roles and future role baselines, and OQ-19 remains OPEN for self-disable, self-role-removal, and last-administrator lockout protection. Implementation report: `docs/tasks/bootstrap-system-administrator/implementation-report.md`. PR **#64** is open at implementation head `96e6b622c33db57e9289e6caf8b2cbb0a35af2c0`; CI run **`36269856402`** passed both backend and frontend jobs, including the live-PostgreSQL bootstrap/E2E coverage. Status is **READY FOR REVIEW — NOT ACCEPTED**; the agent does not accept the task.

**Task 22 — Frontend Vertical Slice: ACCEPTED (2026-09-26).** The first frontend implementation of the repository was delivered on branch `arena/01a0ded9-vardena` from `71f430c` and is **ACCEPTED** under Owner-authorized formal acceptance synchronization. PR **#62** (head `772bdbb`, final CI run **36263398518**: `frontend` success, `backend` success). It adds the `frontend/` package only: authentication and session handling against the existing Identity endpoints, permission-aware navigation from `GET /api/v1/permissions/effective` (UX only — AR-21), organization context from `GET /api/v1/organizations` under ADR-0025, an RTL application shell, and the read-only Accounting surfaces (chart tree, account statement, general ledger, trial balance) bound to the Task 18/19 endpoints. Supporting changes: a parallel `frontend` CI job, `frontend/README.md`, and status corrections in `README.md`, `.vardena/project-context.md`, `docs/architecture.md` §6/§7 and `docs/modules.md` (the PR #61 over-absolute ADR-0017–0020 sentence). **No Backend production behavior changed**; no ADR status changed; no OQ closed; Task 19 and Task 20 are not reopened. Accounting figures are never computed in the frontend — every amount is rendered from the exact decimal strings the API returns. Known follow-ups recorded with the task: OpenAPI annotation gaps (`PaginatedResponseClass` name collision, untyped `nullable: true` fields, the un-introspected account-statement envelope), the missing self-service organization-context endpoint for principals without `Organization.Organization.View`, and frontend Docker/Compose integration.

Task 19 remains **ACCEPTED** and unchanged: **Task 19 — Accounting Chart / Configuration Foundation: ACCEPTED (2026-09-26)** under Owner-authorized Acceptance Sync after final repository review. PR **#54** implemented exactly the three accepted slices: **ODR-1** Explicit Configuration Coherence (coherent `coding_structure_version_id` / `accounting_configuration_id` code shape, write-boundary checks and repository transaction re-check, divergent pins rejected without silent winner/fallback, existing divergence not repaired), **ODR-2** Accounting-owned Chart Tree (`GET /api/v1/accounting/chart-tree` and `GET /api/v1/accounting/chart-tree/:id`, organization-scoped, deterministic, bounded, inactive accounts readable, existing hierarchy, `isPostable` authoritative, no figures or Reporting surface), and **ODR-3** Principal-bound Organization Authorization (membership-bound access through `assertOrganizationInScope`, 404 isolation, granular membership permissions, no wildcard or super-admin bypass). PR **#55** corrected the ODR-3 membership-administration defect before acceptance: list/grant/revoke now require acting-principal membership plus the corresponding permission, except for the bounded first grant into an empty organization; list and revoke never receive that exception. ODR-1 and ODR-2 were not changed.

Final CI is **SUCCESS** on run `36238862315` with the backend job green across the configured Prisma, lint, typecheck, format, unit, build, migration, rehearsal, E2E and live-PostgreSQL gates; no required gate was skipped or continued-on-error. Local fast evidence was format:check PASS, lint PASS with 0 errors, typecheck PASS, unit tests PASS (**101 files / 1148 tests**), and build PASS. Local Prisma validate/generate and heavy E2E/live-DB/migration/concurrency execution were delegated to CI under `docs/testing/test-execution-policy.md`; no local heavy E2E/live-DB result is claimed. Acceptance record: `docs/tasks/task-19/task-19-acceptance-record.md`.

**OQ-25, OQ-43, OQ-62, OQ-63, OQ-01 and OQ-22 remain OPEN.** The in-review Bootstrap System Administrator task implements a provisioning procedure without recording a new Owner Decision. OQ-14 remains OPEN for occupational roles and future role baselines; OQ-19 remains OPEN for self-disable, self-role-removal, and last-administrator lockout protection. ADR-0033…0037 remain **Proposed**; no ADR is promoted. Task 17 remains **FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS** and is **NOT complete**. Task 17A and Task 17B remain **ACCEPTED**; Task 17C remains exactly **ACCEPTED (2026-09-25)** as currently recorded; Task 18 remains **ACCEPTED**.
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

The existing canonical product/domain registry is `docs/open-questions.md` (OQ-01…OQ-63 in the open table; OQ-64 in Resolved). The following are relevant unresolved questions; other registry entries remain unchanged. BOOT identifiers below are new documentation observations, not renumbered product OQs.

| ID | Question / why it matters | Evidence / related area | Decision needed | Status |
|---|---|---|---|---|
| BOOT-OQ-01 | Should future architectural ADRs use docs/adr or docs/decisions/ADR-*? Two conventions would split decision authority | `docs/adr/README.md`, `.vardena/agent-rules.md` AG-07, requested structure in §3 | Repository convention is canonical: use `docs/adr/`; preserve existing ADRs | RESOLVED BY REPOSITORY EVIDENCE 2026-09-24 |
| BOOT-OQ-02 | What is Task 12's valid final review outcome and disposition of P1? Legacy label is not a permitted new outcome | Accounting task index §6/§8 vs Task 12 reports and ADR-0031 | Owner/reviewer record ACCEPTED or CHANGES REQUIRED based on evidence, without erasing history | REQUIRES OWNER CONFIRMATION |
| BOOT-OQ-03 | What is the approved Task 16 objective, scope and acceptance basis? No formal baseline task record found | Established Owner direction plus `docs/tasks/task-16/brief.md` and `decision-reconciliation.md` | Owner direction is recorded; implementation authorization remains a separate later gate | RESOLVED / FORMALIZED 2026-09-24 |
| BOOT-OQ-04 | Which CI jobs are actually required by branch protection? Workflow existence does not enforce merge gates | `.github/workflows/ci.yml` | Owner confirms settings and records evidence | UNKNOWN |
| OQ-01 / OQ-22 | Confirm single-organization deployment vs eventual tenancy/branch accounting scope | `docs/open-questions.md`, ADR-0025 | Owner/product/architecture; do not infer membership from organizationId | OPEN in registry |
| OQ-03 / OQ-47 / OQ-48 | Currency precision, FX rules and revaluation policy; numeric storage alone is not policy | `docs/open-questions.md`, `docs/decisions/product/OQ-47-exchange-rate-and-multicurrency-rules.md`, `OQ-48-revaluation-and-fx-gain-loss.md` in that directory | Product/accounting expert | OPEN in registry |
| OQ-23 / OQ-27 | Period close/reopen authority and correction windows; existing open-scope/reopen mechanisms do not settle full policy | `docs/open-questions.md`, contract §7/§15, ADR-0032 | Owner/accounting expert | OPEN |
| OQ-25 / OQ-41 / OQ-43 | Chart/report-layout policy, dimensions and Iranian statutory/legal requirements. **Task 20 (2026-09-26):** OD-20-1…OD-20-6 resolve the Task 20 mechanism ambiguities (Base Chart artifact/adoption, consumer-first role sequencing, effective-dated role mapping, producer-bound code history, D-1 leaf-only posting, line-level dimensions). **Rows remain OPEN** for Base Chart content, role catalog/mandatory set, per-level defaults, code reuse/history details, dimension count/defaults/binding/governance and every legal fact. | `docs/accounting/task-index.md` §4, `docs/tasks/task-20/*`, contract §19 + §31/§32, `docs/accounting/owner-decision-baseline.md` §12 | Accountant + tax/legal expert + owner; future implementation tasks require explicit scopes/content approvals | OPEN in registry; Task 20 decision resolution closes no OQ status and promotes no ADR |
| OQ-62 / OQ-63 | Compatibility of account coding/configuration pins and legacy fallback shape; affects validation/migration semantics | `docs/open-questions.md`, Task 11 report; default 2+3 fallback is recorded behavior, not a newly ratified decision | Product/architecture | OPEN |

**OQ-19 remains OPEN:** the in-review Bootstrap System Administrator task
implements the out-of-band provisioning procedure, but that implementation note
is not a new Owner Decision. Self-disable, self-role-removal, and
last-administrator lockout protection remain undecided. Task 19's bounded
first-grant exception remains unchanged.

OQ-64 is **RESOLVED 2026-09-23** in the registry: freeze the distinct configurations actually referenced by finalized voucher accounts. Some older Task 12/index paragraphs still call it open; do not re-open it based on those stale references. Task 16 questions are newly recorded bootstrap questions only, not previously approved scope.
Task 17 creates no new OQ and does not reclassify OQ-25, OQ-43, OQ-49, or any existing registry entry.

## 10. Risks and Gaps

| ID | Description / evidence | Impact | Status / recommended next step |
|---|---|---|---|
| BOOT-R-01 | Root README says no business modules; backend README says no Accounting/Inventory; `.vardena/project-context.md` stops at 13 migrations and no balances/corrections, while app.module.ts and 15 migration files show otherwise | Incorrect onboarding/scope assumptions | OPEN documentation drift; owner-authorized follow-up to reconcile summaries, not changed here |
| BOOT-R-10 | `docs/accounting/domain-contract.md` header still says Proposed/no implementation and labels ADR-0026 Proposed, while ADR-0026 itself says Accepted and Accounting code exists | Contract status versus implemented state is ambiguous to new readers | OPEN; owner/architecture clarify the contract header in a separate documentation task; no silent status promotion |
| BOOT-R-02 | Task 12 legacy review label conflicts with new outcome rules and older reports; ADR-0031/0032 remain Proposed despite implementation | Merge mistaken for architecture/task acceptance | OPEN; resolve BOOT-OQ-02 and record explicit review outcomes separately |
| BOOT-R-03 | Task index/reports still call PRs #31/#32 open; baseline/GitHub evidence shows merged; Task 15 lacks a dedicated review record | Incomplete historical final-state traceability | OPEN; owner/reviewer supply evidence-linked final records; no acceptance inferred |
| BOOT-R-04 | Task 12 P1 real PostgreSQL independent-connection concurrency verification remains open in index §8 and remediation report; PGlite is not equivalent | Concurrency confidence is incomplete in that historical record | OPEN recorded follow-up; inspect actual CI/test evidence before closing; no test run here |
| BOOT-R-05 (G7) | Partial ACTIVE index exists only in migration SQL/schema comments | Generated schema migrations may drop an invariant | Historical ACCEPTED RISK label preserved from index §8; keep catalog/rehearsal checks; no new risk acceptance |
| BOOT-R-06 | Optional deployment pin without per-user organization membership (ADR-0025; organization guard, users/rbac schemas) | Structural isolation must not be advertised as secure multi-tenancy | Known limitation; confirm deployment posture before extending scope |
| BOOT-R-07 | Reversal exists but controller/service/repository comments still claim no reversal or finalizeChecked as sole final writer | Future analysis could follow obsolete comments/lock narratives | OPEN; review Task 15 against contract and repair documentation in separately authorized work; no source edits here |
| BOOT-R-08 | Task 16 brief/decision record and ADR-location convention were incomplete at bootstrap | Premature implementation or fragmented architecture history | RESOLVED for contract finalization 2026-09-24; implementation remains unauthorized and is gated by the concrete document/amount authority allow-list |
| BOOT-R-09 | Shallow checkout; historical CI/report assertions not rerun; branch required-check settings unknown | Inventory is not a complete historical or runtime audit | UNKNOWN beyond inspected evidence; retrieve further commit/check evidence for future reviews |
| BOOT-R-11 | Historical Task 17C discrepancy **D-1** asked whether configurable non-leaf POSTING could coexist with the `postable ⇒ leaf` invariant and Task 18 roll-ups. | A future agent could otherwise relax the leaf invariant and duplicate parent/child postings. | **RESOLVED 2026-09-26 by Task 20 OD-20-5.** Product rule is `POSTING = leaf-only` and `AGGREGATION = reporting/read-time roll-up`; parent values are derived views over leaf postings, not independent movements. Future non-leaf posting requires a new explicit architecture decision and ADR supersession/amendment. |
| BOOT-R-12 | Task 17C (`arena/01a0d7c4-vardena`, PR #45) and **PR #44** (`arena/01a0d76b-vardena`, Task 17B acceptance) both edit `STATE.md` §7/§8/§10 and `docs/accounting/task-index.md` header/§2/§9; PR #44 was not merged at the Task 17C baseline (`b10e007`) but was **MERGED 2026-09-25T09:35:22Z in `2892189`** while PR #45 stayed open | A textual merge conflict on the second PR, and a risk that one branch's Task 17B status text overwrites the other's | **RESOLVED 2026-09-25** by synchronizing PR #45 with `main` @ `2892189` (merge of `main` into the branch — no rebase, no force-push, AG-04). Conflicts materialized exactly as predicted in `STATE.md` §7 and in `task-index.md` header/§2/§9 and were resolved conservatively: `main`'s Task 17B **ACCEPTED** text is preserved verbatim in all four places and every Task 17C row is preserved (Q1–Q22, I-1…I-3, ADR-0033…0037 Proposed, OQ-25/OQ-43 still OPEN, D-1…D-13 intact). Discrepancy **D-8** is recorded RESOLVED by that merge; no status was promoted by Task 17C |

**Task 16 contract finalization — 2026-09-24:** Owner directions were reconciled against the current Accounting/Document/RBAC/idempotency/transaction/concurrency repository mechanisms. `docs/tasks/task-16/brief.md` and `decision-reconciliation.md` formalize the bounded Settlement / Allocation foundation; `docs/accounting/task-index.md` now records the contract as defined. No production implementation, schema or migration is authorized by this work.

**Task 17 documentation/task definition — 2026-09-24:** `docs/tasks/task-17/brief.md` and `prompt.md` formalize the bounded Accounting Reporting Foundation while keeping implementation blocked by OQ-25/OQ-43. The accepted Reporting architecture is preserved; no Report Builder/OQ-49 work, production implementation, schema, migration, endpoint, permission, test, event, reporting infrastructure, or frontend is authorized by this documentation work.

**Task 17B Account Statement slice — 2026-09-25:** under Owner decisions D1–D7 (`docs/tasks/task-17/task-17b-prompt.md`, saved before implementation), the bounded read-only account statement was implemented on `arena/01a0d5a0-vardena` (PR **#43**, implementation commit `9ee46f7`): `GET /api/v1/accounting/account-statements`, `Accounting.AccountStatement.View` (36th code, contract §22 row under gate P-10), exact debit-positive Decimal semantics, intra-year sequence-based opening (no carry-forward), org-first 404/422 scope matrix, no schema/migration/index change. Unit 1086 passed; e2e 246 passed + 85 live-PG skipped (CI-only); `prisma validate` not runnable in the sandbox (no `DATABASE_URL`; schema unchanged). Status **ACCEPTED (2026-09-25)** — PR **#43** was reviewed by the Owner/Reviewer before merge and is **MERGED** into `main` in `b10e007` (merged head `1ec996e`), with required CI green on that head (run `36074225037`, job `backend` `completed success`, including `prisma validate`/`generate`, lint, typecheck, format, unit, build, `migrate deploy` and E2E incl. the live-DB suites on `postgres:16` where the 11-test `account-statements-live.e2e-spec.ts` executed green); no blocker remained. The acceptance is bounded to the D1–D7 slice: OQ-25/OQ-43 and Task 17's blocked status unchanged, Task 17 **NOT complete** (`docs/tasks/task-17/task-17b-implementation-report.md`, `docs/tasks/task-17/task-17b-acceptance-record.md`).

**Task 17C Accounting Decision Consolidation — 2026-09-25 (documentation only):** the Owner-approved Accounting decisions **Q1–Q22** and invariants **I-1…I-3** were consolidated as the authoritative baseline for future Accounting work on `arena/01a0d7c4-vardena` (base `b10e007`, merge of PR #43): `docs/accounting/owner-decision-baseline.md` (register + repository reconciliation + 13 discrepancies + 12 open implementation details + verification log), `docs/tasks/task-17/task-17c-prompt.md` (received prompt, verbatim), **ADR-0033/0034/0035/0036/0037 created as Proposed**, `docs/adr/README.md` index rows, `docs/accounting/domain-contract.md` **§31 pointer addendum**, `docs/open-questions.md` **OQ-25/OQ-43 annotated and still OPEN**, `docs/accounting/task-index.md` §2/§4/§5/§9 and `STATE.md` §3/§7/§8/§9/§10. Validation: `git diff --check` clean; documentation-only path audit (no `backend/`, `prisma/`, `*.ts`, `*.sql`, `package*.json`, `.github/`, `docker-compose.yml`, `.env.example` change); referenced-path and AC-/ADR-/OQ-/AR-/AG- id existence checks; markdown table integrity; no ADR or task status promoted; no legal claim. Status **READY FOR REVIEW — NOT ACCEPTED**. **Synchronization 2026-09-25:** after **PR #44** merged into `main` in `2892189` (Task 17B **ACCEPTED**), `main` was merged into `arena/01a0d7c4-vardena`; the resulting conflicts in `STATE.md` §7 and `docs/accounting/task-index.md` header/§2/§9 were resolved by preserving `main`'s Task 17B acceptance text verbatim **and** all Task 17C rows, and the stale "17B READY FOR REVIEW / PR #44 open" references in the 17C records (incl. `docs/accounting/owner-decision-baseline.md` §1/§5 D-8/§7/§8/§10) were replaced with the merged facts. Still documentation only: no production code, schema, migration, test, API, permission or dependency changed by the synchronization.

**Task 18 Accounting Reporting Read Foundation — 2026-09-25 (ACCEPTED):** the Task 18 Owner Decisions D1–D20 are the approved baseline for this separately authorized, bounded implementation slice even though older Task 17 records describe the broader Reporting Foundation as blocked by OQ-25/OQ-43. The branch adds one shared Accounting-owned read/query boundary over immutable `accounting.ledger_entries` and three explicit read-only GET APIs: `account-statements`, `general-ledger` and `trial-balance`. It adds independent General Ledger and Trial Balance permissions, organization/financial-area/fiscal-year isolation using existing deployment-pin and authorization conventions, same-year period/date semantics, readable OPEN/CLOSED/SEALED scope, exact Decimal/string calculations, POSTING/AGGREGATION roll-up without parent/child double counting, bounded pages and hard row limit, deterministic allow-listed sorting, transaction timeout and source references. Account Statement behavior remains backward-compatible through the shared repository adapter. Authoritative Accounting models were checked for General Ledger document type and source reference fields; unavailable fields were not fabricated. D5 is resolved as Ledger-native: `accounting.ledger_entries` is authoritative, while the Task 12 balance projection is a derived/rebuildable turnover-only read optimization; Task 18 reconciles opening, turnover and closing directly from exact Ledger facts and introduces no second monetary truth. No generic Reporting module, Report Builder, report persistence, EAV/JSONB schema, migration, export/print/statutory layout, cross-context calculation or other bounded-context work was added. **Governance status: ACCEPTED (2026-09-25)** — PR **#46** was reviewed by the Repository Owner/Reviewer before merge and **MERGED** into `main` in `e774a1c37c921ba83e4e9c23729fde6205cedb76` (reviewed implementation head `5971bed`; review-fix commits `4182346`/`0d9cf76`, the final review-fix addressing the D5 source-of-truth/reconciliation point and containing no production change). Acceptance record: `docs/tasks/task-18/task-18-acceptance-record.md`.

Acceptance evidence: focused D5 reconciliation **2 passed**; accounting unit suite **43 files / 538 tests**; full backend unit suite **97 files / 1,100 tests**; typecheck, build, format and `git diff --check` passed; lint zero errors with six pre-existing warnings in unrelated files (**not** Task 18 failures); CI run **36133360887** on PR #46 head `5971bed` with the `backend` job **completed success** (Prisma validation/generate, lint, typecheck, format, unit tests, build, `migrate deploy`, migration rehearsal and E2E incl. the live-DB suites on `postgres:16`). CI predates the documentation/test-only review-fix commits and is **not** claimed to have executed them; the focused reconciliation test and the local full validation covered the post-fix state. Implementation report `docs/tasks/task-18/task-18-implementation-report.md` §6/§9; acceptance record `docs/tasks/task-18/task-18-acceptance-record.md`. **OQ-25/OQ-43 remain OPEN**, Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED and NOT complete, and this acceptance closes none of Task 18's explicitly out-of-scope capabilities (Report Builder, exports, Legal Books, treasury/settlement/AR-AP/sales/purchase, cross-year carry, code migration, configurable dimensions, UI Account Overview, new monetary source of truth).

**Task 17C Acceptance Sync — 2026-09-25 (documentation-only governance acceptance):** the Owner formally accepts **Task 17C — Accounting Decision Consolidation** after the governance review and the PR **#48** factual-drift correction (merged into `main` in `7f8e3e8`). The accepted decision set is preserved exactly as recorded in `docs/accounting/owner-decision-baseline.md` — Owner decisions **Q1–Q22**, invariants **I-1…I-3**, discrepancies **D-1…D-13** (D-8 RESOLVED by the PR #44 merge in `2892189`) and open items **O-1…O-12** — with nothing reinterpreted, expanded or altered. Accepted: the owner decision consolidation; the governance documentation synchronization; the recorded decisions as authoritative; the ADR proposals as accurate reflections of those decisions; that the task introduces no production behavior; that unresolved OQs remain unresolved; and that future implementation requires separate authorized tasks. **OQ-25 and OQ-43 remain OPEN — acceptance of Task 17C resolves neither.** **ADR-0033/0034/0035/0036/0037 remain Proposed**: per the repository ADR convention, task acceptance does not promote an ADR (precedents: ADR-0031 stayed Proposed after Task 12's acceptance; the Task 17B and Task 18 acceptances promoted no ADR; the PR #48 governance review recorded “task acceptance ≠ ADR acceptance”; each ADR carries “not Accepted, no self-acceptance”) — each ADR remains pending its separate adoption/implementation gate, and the ADR subjects (account code history implementation, the code migration service, non-leaf posting, legal/statutory reporting, configurable accounting configuration implementation) remain future/controlled concepts, not implemented production capabilities. **Task 17 overall remains FORMALIZED / IMPLEMENTATION BLOCKED BY OPEN QUESTIONS (BLOCKED) and is NOT complete** — its later implementation/governance prerequisites, especially OQ-25 and OQ-43, remain unresolved. **No production code, TypeScript, Prisma schema, migration, API, permission, dependency, UI or test was touched by this synchronization** — it changes only `STATE.md`, `docs/accounting/task-index.md`, `docs/accounting/owner-decision-baseline.md` (status header + version entry) and adds `docs/tasks/task-17/task-17c-acceptance-record.md`. Acceptance record: `docs/tasks/task-17/task-17c-acceptance-record.md`.

**E2E hang root-cause investigation & repair gate — 2026-09-26 (test infrastructure only, pre-Task-19-implementation):** the recurring report that `npm run test:e2e` hangs was investigated diagnose-first on `arena/01a0dccb-vardena` before any Task 19 implementation. Findings (full record: `docs/testing/e2e-hang-root-cause.md`): the hang class is a test-owned Nest application whose `app.close()` — the only deterministic shutdown of the shared PrismaService `pg` pool — is reachable only on the happy path; PR **#14** (2026-09-14) root-caused and fixed this for the then-existing live suites and the harness init path, and PR **#33** (Task 15) added the CI `timeout 540` **containment** (verified via the GitHub API to have never fired: every failed CI E2E step since completed in 33–90 s with concrete assertion annotations — no CI hang has ever occurred). Fresh reproduction at current HEAD against real PostgreSQL 16.4 with all 15 migrations: **not reproducible** — 8 pre-fix and 3 post-fix full runs all terminated exit 0 (live path 334 tests / 29 files post-fix, ~60–69 s; hermetic path 249 passed / 85 skipped). Termination-envelope probes on the actual Vitest 4.1.11 forks pool established: leaked in-worker handles and teardowns blocked on PostgreSQL row locks are bounded (worker force-termination / hookTimeout); the only unbounded phase is import-time blocking, of which the repository has none. One residual defect of the root-cause class was found and fixed: `backend/test/deployment-scope.e2e-spec.ts` closed its phase-1 seed application only on the happy path (now `try/finally`). Regression protection added: `backend/test/harness-lifecycle.e2e-spec.ts` (3 tests pinning pool release on `app.close()`, provider destruction after failed `app.init()`, and zero residual TCP handles), passing under both the generated client and the committed stub. No production code, schema, migration, API, permission, dependency, vitest configuration or CI behavior changed; no `.skip`/`.only`/force-exit/timeout-increase workaround introduced; the CI `timeout 540` is retained and documented as a detection tripwire, not a fix. PostgreSQL verification: after the final run `pg_stat_activity`/`pg_locks` showed zero leftover test connections and zero waiting locks. Limitations recorded in the report §8 (sandbox cannot run `prisma migrate deploy`; migrations applied as raw SQL in order; CI verification of this branch is its PR run). **Task 19 implementation remains NOT YET STARTED and is unblocked by this repair gate.**

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
