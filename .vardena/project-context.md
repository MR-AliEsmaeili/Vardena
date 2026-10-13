# Vardena — Project Context (AI Agent Onboarding)

> **Read this first.** If you are an AI coding agent (or human) starting work in this
> repository, this file is your entry point. Required reading order:
> 1. This file
> 2. `docs/architecture.md`
> 3. `.vardena/architecture-rules.md` and `.vardena/agent-rules.md`
> 4. The specific `docs/*.md` for the area you are working in
> 5. Related ADRs in `docs/adr/`

## What Vardena Is

Vardena is a modern, **modular ERP** for organizations and businesses (primary market:
Iran). It must be extensible — new ERP modules must be addable without architectural
change. It must work **on-premise / local-network** today and remain suitable for
future **cloud** deployment.

Planned capabilities: authentication, user management, roles/permissions (RBAC),
accounting, inventory/warehouse, purchasing (planned), sales, reporting, Excel
import/export, printing, UI/dashboard customization, external integrations,
background jobs, synchronization, audit logging, notifications.

**Vardena is fully independent from any legacy ERP.** A legacy FaraPayam-style ERP
web service is an *external system* integrated through an adapter layer — never the
core of Vardena. Vardena owns its own database, business logic, authentication,
authorization, and API. The frontend talks only to the Vardena API.

## Current Repository State

*Current-state synchronization verified against `main` at
`34dddfd60d6ce2f9d4599bd05b440556a80aa847` (2026-09-29). The current
cross-repository audit is `docs/current-state-reconciliation.md`; the
2026-09-26 `docs/repository-documentation-audit.md` is historical. Task/acceptance state is
recorded in `STATE.md` and `docs/accounting/task-index.md` — implementation
existing in `main` is **not** the same as a task or ADR being accepted.*

- **The backend is implemented.** `backend/` is a NestJS modular monolith:
  `backend/src/kernel` (config, correlation, errors, HTTP pipeline, ids, jobs
  registry, logging, pagination, Prisma service, rate limiting) plus nine
  modules under `backend/src/modules` — `health` and the eight domain modules
  `{users,identity,rbac,organization,inventory,documents,workflow,accounting}`
  (the order `app.module.ts` registers them); 48 controllers under `/api/v1`;
  Prisma schemas in `backend/prisma/schema/` (schema-per-module, 8 database
  schemas, 55 models) and **18 migrations** in `backend/prisma/migrations/`;
  **142 registered permission codes** (Accounting 49, Inventory 32,
  Organization 28, Workflow 10, Documents 9, RBAC 8, Users 6).
- **Installation bootstrap:** the post-migration
  `npm run bootstrap:system-admin` command provisions the real Users/RBAC
  account `مدیر` and the ordinary `System Administrator` role with the
  permission registry available when it runs. Docker Compose and CI invoke the
  same idempotent command; it creates no endpoint, wildcard, or organization
  bypass. No organization is invented: ODR-3 membership remains required. PR
  #64 is **MERGED** (`21306e53fd8e4c0c8db82338a2be75d3b8477eff`), with green
  backend/frontend PR checks; its work item remains **READY FOR REVIEW — NOT
  ACCEPTED** because no explicit Owner acceptance record exists.
- **Accounting** is the most advanced module: financial areas / fiscal years /
  periods, coding structures + chart of accounts, accounting configurations
  (Task 11, D1–D7) with the operational freeze wired at finalization (Task 13),
  vouchers + lines, posting readiness, the posting/ledger contract, immutable
  `ledger_entries`, `PostingService` orchestration, period-close enforcement
  inside finalization (Task 14, ADR-0032 *Proposed*), the balance projection +
  derived views + audited rebuild (Task 12, ADR-0031 *Proposed*), document
  reversal as a counter-document (`POST /accounting-documents/:id/reverse`),
  the read layer — ledger movements (17A), account statements (17B), General
  Ledger and Trial Balance over one shared read-query repository (Task 18) —
  and the Accounting-owned Chart Tree read surface plus explicit configuration
  pin coherence (Task 19, ODR-1/ODR-2). Task 23 adds a versioned Base Chart
  template and explicit organization adoption mechanism; template identity stays
  separate from Ledger identity, adoption copies into organization-owned
  accounts, posting remains leaf-only, and aggregation remains read-time. Task
  24 R-2 makes `GET /api/v1/accounts` assert the existing principal-bound
  organization scope on every list path. Task 30 then adds Account Nature
  (`DEBIT`, `CREDIT`, `DUAL`), Account Type, and a bounded configurable Detail
  hierarchy/account-to-Level-1-group/line-allocation foundation. Task 23, Task
  24 and Task 30 are merged and CI-green but have no separate Owner acceptance
  record. Still **not** implemented: posting rules / automatic mapping, control
  roles, the older contract's full generic multi-dimension model, cross-year
  opening carry-forward, statutory/legal books, exports and any source-module
  posting trigger.
- **Inventory** has both halves: master data (Task 6) **and** the core movement
  ledger, balances, reservations and transfers (Tasks 9.5/9.6, ADR-0022).
  **Documents** (ADR-0023) and **Workflow** (ADR-0024) are implemented modules.
  **Organization** additionally owns principal→organization memberships and the
  `assertOrganizationInScope` chokepoint (Task 19, ODR-3).
- **Not implemented at all:** Audit, Notifications, Sales, Purchasing,
  Reporting, Excel, Print, Customization, Integration, Sync and Jobs modules;
  the worker has no dispatch loop; the domain-event bus is in-memory only (no
  `core.domain_events`, no outbox table, no jobs table).
- **Tests:** unit specs live beside the code (113 `backend/src/**/*.spec.ts`);
  34 e2e specs in `backend/test/**/*.e2e-spec.ts`. Live-database suites are
  opt-in via `VARDENA_TEST_DATABASE_URL`; two migration rehearsals exist
  (`npm run test:migration-rehearsal` — Task 11 backfill;
  `npm run test:operational-freeze-rehearsal` — Task 13).
- **The frontend contains the accepted Task 22 vertical slice and the merged
  Task 32 Dashboard corrected by PR #86:** login/session, RTL shell, organization
  context, permission-aware navigation, four read-only Accounting surfaces, and
  a Dashboard over real bounded Accounting/Inventory/Workflow reads. There is
  still no create/edit UI, Inventory/Workflow administration UI, RBAC admin or
  Treasury UI. No separate Task 32 Owner acceptance record was found. Setup and conventions:
  `frontend/README.md`. Its CI job (`frontend` in `.github/workflows/ci.yml`)
  runs install → lint → typecheck → format:check → tests → build.
- **Governance:** `STATE.md` is the consolidated project memory (task history,
  review status, risks); the authoritative accounting task sequence is
  `docs/accounting/task-index.md`; per-task evidence lives in `docs/tasks/` and
  `docs/task-*.md`. Any ambiguity about business behavior: see
  `docs/open-questions.md` (OQ-01…OQ-64). **Do not invent business rules**
  (numbering, tax, ledger behavior, approval flows, policies).

## Scope Boundary — Treasury (خزانه‌داری) is deferred

**Treasury is NOT part of the current MVP implementation scope.** Treasury
capabilities — cash (صندوق), bank (بانک), payment (پرداخت), receipt (دریافت),
cheque (چک) and settlement (تسویه) workflows and financial instruments — are
future-phase capabilities. **No Treasury module, schema, migration, API or
permission exists in this repository**, and none may be implemented implicitly
by Accounting or by any other existing module. Existing Treasury references in
the accounting contract, ADRs and product documents are future/deferred
architectural context, not an authorization to build. Any future Treasury work
requires its own explicitly authorized task and Owner Decision.

## Technology (fixed — see ADR-0002)

| Layer | Technology |
|---|---|
| Backend | NestJS, TypeScript |
| Database | PostgreSQL, Prisma ORM |
| API | REST + generated OpenAPI/Swagger |
| Deployment | Docker (compose: API app, worker app, PostgreSQL) |
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Frontend libs | React Router, TanStack Query, Axios, React Hook Form, Zod, TanStack Table, Day.js |

No additional major technologies without an ADR (`AG-12`, `AR-30`).

## Repository Map

```
.vardena/            ← agent context & rules (this folder)
STATE.md             ← consolidated project memory: task history, review status, risks
docs/
  architecture.md    ← system architecture, module anatomy, event model
  modules.md         ← module catalog: responsibilities, boundaries, events
  security.md        ← authn/authz, audit, API security, integration security
  integrations.md    ← external systems, adapter layer, outbox/sync design
  database-strategy.md ← schema-per-module, conventions, migrations, raw SQL policy
  reporting-strategy.md ← reporting architecture, raw SQL policy, export/print
  open-questions.md  ← registered open architectural/business questions (OQ-xx)
  current-state-reconciliation.md ← current doc↔code/governance reconciliation (2026-09-29)
  repository-documentation-audit.md ← historical doc↔code audit (2026-09-26)
  adr/               ← architecture decision records (ADR-xxxx)
  accounting/        ← accounting contract, task index, configuration, decision notes
  architecture/domain/ ← domain blueprint, glossary, per-domain analyses
  product/           ← MVP scope proposal, roadmap, product decision baseline
  decisions/product/ ← per-OQ product decision records
  tasks/             ← briefs, gates, implementation reports, acceptance records
  testing/           ← test-execution policy, e2e notes
  task-*.md          ← earlier per-task implementation reports (A–J format)
backend/
  src/kernel/        ← cross-cutting kernel (config, errors, ids, logging, Prisma)
  src/modules/       ← health + the eight domain modules (domain/application/data/api)
  test/              ← e2e specs + support harness (live suites opt-in)
  prisma/schema/     ← schema-per-module Prisma sources (base + 8 modules)
  prisma/migrations/ ← 17 applied migrations
  prisma/rehearsal/  ← Task 11 / 12 / 13 migration & freeze rehearsal fixtures
frontend/            ← React SPA (Task 22 slice; see frontend/README.md)
  src/app/           ← providers, router, route guards, app shell
  src/api/           ← single Axios instance, error envelope, generated OpenAPI types
  src/features/      ← auth, permissions, organization, accounting (read surfaces)
  src/ui/            ← shadcn/ui-style primitives + reusable patterns
  src/lib/           ← i18n dictionary, formatters, Day.js, helpers
docker-compose.yml   ← API + worker + PostgreSQL
```

## Golden Rules (the 10 that matter most)

1. **Modular monolith.** One backend deployable; each module is a self-contained
   domain unit. No microservices (ADR-0001).
2. **Layer purity.** Controllers = transport only. Business logic lives in
   application/domain layers, never in controllers (AR-03/04).
3. **Module boundaries are law.** No cross-module table access. Inventory →
   Accounting posting uses the synchronous public application/domain contract
   (ADR-0041); independent reactions may use domain events. Cross-module reads use
   the owning module's public service or module-owned views (AR-07).
4. **Backend authorization is mandatory.** Every endpoint declares a permission;
   frontend checks are UX only (AR-21).
5. **External integrations only through adapters**, driven by the **Outbox pattern**:
   local transaction → outbox row → worker → adapter → retry → terminal state
   (AR-14, ADR-0004).
6. **Inventory does not own Accounting policy or write Accounting tables.** An
   approved Inventory Business Document calls Accounting through the synchronous
   public application/domain contract; Inventory supplies valuation facts and
   Accounting owns mapping and journal policy (AR-16, ADR-0041, PDR-09). The
   integration is not implemented; OQ-39 still gates transaction/failure semantics.
7. **Database changes only via Prisma migrations.** Raw SQL only where documented
   (module views, reporting, perf-critical paths) — always parameterized (AR-10/11).
8. **Architecture changes require an ADR** before or with the change (AR-29).
9. **Never invent business rules.** Register an OQ in `docs/open-questions.md` and
   ask (AG-09).
10. **Keep changes focused.** No unrelated refactors, no drive-by edits, one concern
    per branch (AG-02/03).

## How to Work Here

Full workflow rules: `.vardena/agent-rules.md`. Architecture rules with rationale:
`.vardena/architecture-rules.md`. In short: feature branch → focused change → tests
for business rules → docs kept in sync → ADR if architecture changed → PR against
`main` (never push to `main` directly).
