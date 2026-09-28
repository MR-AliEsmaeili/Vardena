# Vardena — Repository Documentation & Code Consistency Audit

Status: **READY FOR REVIEW — NOT ACCEPTED** · Date: 2026-09-26 · Type:
documentation / governance synchronization only (no production change)

|                                     |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch                              | `arena/01a0dea5-vardena`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Inspection baseline                 | `d46bb4e859b44582f7c83051d581cb93b2139fed` (merge of PR #59 on `main`; the local clone is shallow)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Rebased onto                        | `1dca53a` (merge of PR #60 — **Task 21**, documentation only), merged into this branch after the audit was written. **Re-verified: Task 21 changed no file under `backend/`** (`git diff --stat d46bb4e origin/main -- backend` is empty), so every code fact in §B and every status in §C stands unchanged. Task 21 — _Base Chart Governance & OQ-25 Resolution_ — is **READY FOR REVIEW — NOT ACCEPTED**, design/governance documentation only; it narrows but does **not** close OQ-25, promotes no ADR and reopens neither Task 19 nor Task 20. This audit neither accepts nor reinterprets it. |
| Scope decision carried by this task | **Treasury / خزانه‌داری is OUT OF MVP — deferred to a future phase** (§E)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Source of truth                     | current repository code, schema and migrations (§11 of the task brief)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Production code changed             | **NO** (§I)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

> **This audit closes no Owner Decision, promotes no ADR, resolves no Open
> Question and authorizes no implementation.** Where code and governance
> disagree, the code is preserved, the discrepancy is reported, and the
> documentation is corrected only where the intended governance is already
> unambiguous.

---

## A. Audit Scope

### A.1 Documentation inspected

- `.vardena/project-context.md`, `.vardena/architecture-rules.md`, `.vardena/agent-rules.md`
- `README.md`, `backend/README.md`
- `STATE.md` (project memory / task history)
- `docs/architecture.md`, `docs/modules.md`, `docs/open-questions.md`,
  `docs/security.md`, `docs/database-strategy.md`, `docs/reporting-strategy.md`,
  `docs/integrations.md`
- `docs/accounting/`: `task-index.md`, `domain-contract.md`, `configuration.md`,
  `lock-order-matrix.md`, `owner-decision-baseline.md`, decision notes
- `docs/adr/` (all 37 present records, status lines transcribed — §C.16)
- `docs/tasks/task-16` … `docs/tasks/task-21` (briefs, gates, reports, acceptance records; `task-21/` arrived on `main` during this task and was reviewed for code impact — there is none)
- `docs/task-6/9/10.4/10.5/10.7/10.8/11/12/13/14-*.md` implementation reports
- `docs/product/` (MVP scope proposal, roadmap, product-business decision baseline)
- `docs/testing/test-execution-policy.md`

### A.2 Code inspected

- `backend/src/app.module.ts`, `backend/src/worker.ts`, `worker.service.ts`, `backend/src/kernel/**`
- `backend/src/modules/{health,users,identity,rbac,organization,inventory,documents,workflow,accounting}/**`
  (controllers, DTOs, application services, domain files, repositories, permission registries)
- `backend/prisma/schema/*.prisma` (9 files), `backend/prisma/migrations/**` (16 migrations),
  `backend/prisma/rehearsal/**`
- `backend/test/**` (31 e2e specs + support harness), `backend/src/**/*.spec.ts` (101 unit spec files)
- `backend/package.json`, `.github/workflows/ci.yml`, `docker-compose.yml`

### A.3 Not inspected / not executed

- No runtime execution of the application, no live PostgreSQL, no E2E suite, no
  CI run was triggered by this task (documentation-only work; see §J).
- GitHub PR/issue state was **not** re-queried; PR/merge facts quoted in this
  report come from repository records (`STATE.md` §7, task acceptance records),
  which this audit treats as _recorded_, not independently re-verified.
- Git history is shallow in this clone (`git log` exposes only the baseline
  merge), so ancestry claims rely on the recorded task history, not on local
  `git log` traversal.

---

## B. Repository Snapshot (verified against code at `d46bb4e`)

| Fact                                                                   | Verified value                                                                                                                                                             | Evidence                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Backend framework                                                      | NestJS 12 / TypeScript 6 / Prisma 7 / PostgreSQL, ESM, Node ≥ 22.12                                                                                                        | `backend/package.json`                                                       |
| Registered application modules                                         | 9 — `health` + `users, identity, rbac, organization, inventory, documents, workflow, accounting` (plus `KernelModule`, `PrismaModule`)                                     | `backend/src/app.module.ts`                                                  |
| HTTP controllers                                                       | 43 (`accounting` 13, `inventory` 9, `workflow` 7, `organization` 6, `documents` 3, `rbac` 2, `users` 1, `identity` 1, `health` 1), all versioned `/api/v1`                 | `@Controller(...)` declarations                                              |
| Prisma schema files                                                    | 9 (`base` + 8 module schemas)                                                                                                                                              | `backend/prisma/schema/`                                                     |
| Database schemas                                                       | 8: `identity, users, rbac, organization, inventory, documents, workflow, accounting` — **no `core` schema exists**                                                         | `base.prisma` `datasource.schemas`                                           |
| Prisma models                                                          | 47 (accounting 13, inventory 10, workflow 8, organization 6, documents 4, rbac 4, identity 1, users 1)                                                                     | `grep '^model' prisma/schema/*.prisma`                                       |
| Migrations                                                             | **16**, `20260910000000_init` … `20260926000000_organization_membership`                                                                                                   | `backend/prisma/migrations/`                                                 |
| Registered permission codes                                            | **131** — Accounting 38, Inventory 32 (20 master + 2 unit-conversion + 10 core), Organization 28 (25 master + 3 membership), Workflow 10, Documents 9, RBAC 8, Users 6     | module `domain/*permissions*.ts` + `application/*permission-registration.ts` |
| Unit spec files                                                        | 101 (`backend/src/**/*.spec.ts`)                                                                                                                                           | filesystem count                                                             |
| E2E spec files                                                         | 31 (`backend/test/*.e2e-spec.ts`), live-DB suites opt-in via `VARDENA_TEST_DATABASE_URL`                                                                                   | `backend/test/`, `vitest.config.e2e.ts`                                      |
| Migration rehearsals                                                   | 2 npm scripts (`test:migration-rehearsal` — Task 11; `test:operational-freeze-rehearsal` — Task 13)                                                                        | `backend/package.json`, `backend/prisma/rehearsal/`                          |
| Frontend                                                               | **Does not exist.** No `frontend/` directory, no frontend package                                                                                                          | filesystem                                                                   |
| Worker                                                                 | Entrypoint + DB startup gate only; **no dispatch loop**, no outbox table, no jobs table                                                                                    | `backend/src/worker.service.ts`, `kernel/jobs/jobs.registry.ts`              |
| Domain events                                                          | In-process, in-memory bus only; **no `core.domain_events` persistence**                                                                                                    | `backend/src/kernel/events/domain-event-bus.ts`, migrations                  |
| CI                                                                     | one workflow `CI` / job `backend` (Prisma validate/generate → lint → typecheck → format → unit → build → `migrate deploy` → Task 11 rehearsal → E2E incl. live PostgreSQL) | `.github/workflows/ci.yml`                                                   |
| Treasury / Cash / Bank / Payment / Cheque / Settlement production code | **None** (§E)                                                                                                                                                              | repository-wide search                                                       |

### B.1 Accounting capability snapshot (code-verified)

Implemented and reachable over HTTP:

| Capability                                                                     | Code evidence                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Financial areas, fiscal years, accounting periods (+ close/reopen/seal/unseal) | `financial-areas                                                                                                                                                                                           | fiscal-years | accounting-periods.controller.ts`, `20260914000000_accounting_foundation` |
| Coding structures (versioned) + chart of accounts                              | `coding-structures.controller.ts`, `accounts.controller.ts`, `20260914010000_...`                                                                                                                          |
| Accounting configurations (DRAFT/ACTIVE/SUPERSEDED, operational freeze)        | `accounting-configurations.controller.ts`, `data/accounting-configuration-usage.ts`, `20260920000000_...`                                                                                                  |
| Accounting documents + lines, `draft → temporary → final`                      | `accounting-documents.controller.ts`, `20260915000000_accounting_documents`                                                                                                                                |
| Posting readiness, posting contract, `PostingService`                          | `application/posting-readiness.service.ts`, `domain/posting.ts`, `application/posting.service.ts`                                                                                                          |
| Immutable ledger entries (1:1 per posted line)                                 | `data/ledger-entries.repository.ts`, `20260916000000_accounting_ledger`                                                                                                                                    |
| **Balance projection** + derived views + audited rebuild                       | `data/account-balance-projections.repository.ts`, `accounting-balances.controller.ts` (`GET /`, `GET /reconciliation`, `GET /:accountId`, `POST /rebuild`), `20260922000000_accounting_balance_projection` |
| **Document reversal** (counter-document, `Accounting.Document.Reverse`)        | `domain/document-reversal.ts`, `POST /accounting-documents/:id/reverse`, `20260923000000_accounting_document_reversal`                                                                                     |
| **Period-close enforcement inside finalization**                               | `application/accounting-documents.service.ts`, `data/accounting-locks.ts`, ADR-0032 (Proposed)                                                                                                             |
| **Ledger movement read source**                                                | `accounting-ledger-movements.controller.ts`, `application/ledger-movements.service.ts`                                                                                                                     |
| **Account statements**                                                         | `account-statements.controller.ts`, `domain/account-statement.ts`                                                                                                                                          |
| **General Ledger** read surface                                                | `general-ledger.controller.ts`, `application/general-ledger.service.ts`                                                                                                                                    |
| **Trial Balance** read surface                                                 | `trial-balance.controller.ts`, `application/trial-balance.service.ts`                                                                                                                                      |
| **Accounting Read Query Layer** (shared read repository)                       | `data/accounting-read-query.repository.ts`                                                                                                                                                                 |
| **Chart Tree read surface** (Task 19 ODR-2)                                    | `chart-tree.controller.ts` (`GET /accounting/chart-tree`, `GET /:id`), `application/chart-tree.service.ts`                                                                                                 |
| **Configuration/version pin coherence** (Task 19 ODR-1)                        | `application/account-pin-coherence.spec.ts`, `planPinCoherence` in the accounts write path                                                                                                                 |

Still absent in code (verified): posting rules / automatic mapping engine,
detail dimensions, control roles, base chart templates, cross-year opening
carry-forward, statutory/legal books, exports, print, a Reporting module, and
any source-module (Inventory/Sales) → Accounting posting trigger.

---

## C. Documentation vs Code Matrix

Status vocabulary is the task brief's: MATCH · STALE (documentation stale) ·
CONTRADICTS (documentation contradicts code) · CODE AHEAD (code ahead of
documentation) · CLAIMS-UNIMPLEMENTED (documentation claims an unimplemented
feature) · MISSING (documentation missing an implemented feature) ·
SCOPE/GOVERNANCE MISMATCH · DEFERRED · NEEDS OWNER DECISION · NEEDS
ARCHITECTURAL DECISION.

### C.1 Repository overview

| Area                                                     | Documentation claim                                                                                                                                                                             | Code evidence                                                                                                | Status                                                 | Required fix                                                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `README.md` status block                                 | “**Status: architecture + backend foundation.** … No business modules exist yet”                                                                                                                | 8 domain modules, 43 controllers, 16 migrations, 131 permissions                                             | **CONTRADICTS**                                        | Rewrite the status block against verified state — **FIXED** (§F)                       |
| `README.md` documentation index                          | Accounting Domain Contract described as “contract only, nothing implemented”                                                                                                                    | Accounting is the most advanced implemented module                                                           | **CONTRADICTS**                                        | Correct the one-line description — **FIXED** (§F)                                      |
| `README.md`                                              | No pointer to `STATE.md` (the project memory) or `docs/tasks/`                                                                                                                                  | Both exist and are authoritative for task state                                                              | **MISSING**                                            | Add pointers — **FIXED** (§F)                                                          |
| `.vardena/project-context.md` “Current Repository State” | “Tasks 1–11”, “13 migrations”, “nothing past the ledger (no posting rules, dimensions, balances, corrections or reports)”, “current task’s evidence is `docs/task-11-implementation-report.md`” | Tasks through 20 recorded; 16 migrations; balances, reversal, statements, GL, TB, chart tree all implemented | **CONTRADICTS** (multiple)                             | Rewrite the state section against verified code — **FIXED** (§F)                       |
| `.vardena/project-context.md` repository map             | Omits `STATE.md`, `docs/tasks/`, `docs/testing/`, `docs/product/`, `docs/decisions/`, `docs/architecture/`                                                                                      | All present                                                                                                  | **STALE**                                              | Update the map — **FIXED** (§F)                                                        |
| `backend/README.md` scope note                           | “Scope: foundation + Identity (auth), Users and RBAC modules. Accounting, Inventory, Sales, … do not exist yet”                                                                                 | 8 domain modules exist                                                                                       | **CONTRADICTS**                                        | Rewrite the scope note — **FIXED** (§F)                                                |
| `backend/README.md` Prisma section                       | “Current state: `base.prisma` … one migration creating the kernel-owned `core` schema. No tables yet.”                                                                                          | 9 schema files, 8 DB schemas, **no `core` schema**, 16 migrations, 47 models                                 | **CONTRADICTS**                                        | Correct — **FIXED** (§F)                                                               |
| `backend/README.md` layout block                         | `modules/` lists only health/identity/users/rbac                                                                                                                                                | 9 modules                                                                                                    | **STALE**                                              | Correct — **FIXED** (§F)                                                               |
| `STATE.md` §2 database inventory                         | “There are **15 SQL migrations**, from `20260910000000_init` through `20260923000000_accounting_document_reversal`”                                                                             | 16 migrations; newest is `20260926000000_organization_membership` (Task 19 ODR-3)                            | **STALE** (bootstrap-era count, superseded by Task 19) | Append a dated correction annotation, preserving the bootstrap record — **FIXED** (§F) |
| `STATE.md` §2 module inventory (organization row)        | Models listed as Organization, Branch, Department, Employee, Party                                                                                                                              | `OrganizationMembership` also exists                                                                         | **STALE**                                              | Covered by the same dated annotation — **FIXED** (§F)                                  |

### C.2 Architecture

| Area                                                                                               | Documentation claim                                                                                                          | Code evidence                                                                                                                                                                            | Status                                                                 | Required fix                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/architecture.md` §6                                                                          | “> The repository currently contains **documentation only**. This is the target layout for the first implementation phase.”  | Full backend implemented                                                                                                                                                                 | **CONTRADICTS**                                                        | Replace the note with the verified state, keep the target layout — **FIXED** (§F)                                                                        |
| `docs/architecture.md` §5/§8 event model                                                           | Domain events “persisted in `core.domain_events` in the same transaction”; outbox `sync.outbox_events`; jobs `jobs.job_runs` | In-memory bus only; **no `core` schema, no outbox table, no jobs table**; `WorkerService` explicitly defers dispatch loops                                                               | **CLAIMS-UNIMPLEMENTED** (target architecture stated in present tense) | Add a dated implementation-status note; do **not** change the target architecture — **FIXED** (§F)                                                       |
| `docs/architecture.md` §4 module anatomy (`events/`, `reports/`, `imports/`, `documents/` folders) | Prescribed anatomy                                                                                                           | Implemented modules use `api/application/domain/data`; event schemas live in `domain/*.events.ts`; no `events/`, `reports/`, `imports/` folders exist                                    | **CODE AHEAD / divergent convention**                                  | **NOT FIXED** — AR-02 is a binding rule; whether the shipped convention supersedes it is an architectural decision (§G/§H, NEEDS ARCHITECTURAL DECISION) |
| `docs/architecture.md` §10 deployment                                                              | Docker Compose: postgres + api + worker                                                                                      | `docker-compose.yml` matches (+ a `migrate` init service)                                                                                                                                | **MATCH**                                                              | —                                                                                                                                                        |
| `docs/architecture.md` §9 API conventions                                                          | `/api/v1`, kebab-case, `{items,total,page,pageSize}`, `{code,message,details?,correlationId}`                                | Matches `kernel/http`, `kernel/pagination`, `kernel/errors`                                                                                                                              | **MATCH**                                                              | —                                                                                                                                                        |
| `.vardena/architecture-rules.md` AR-01…AR-31                                                       | Binding rules                                                                                                                | Spot-checked: modular monolith (AR-01) ✔, controllers transport-only (AR-03) ✔, per-endpoint permission (AR-21) ✔, migrations-only schema changes (AR-10) ✔, schema-per-module (AR-09) ✔ | **MATCH** (spot-check, not an exhaustive boundary audit)               | —                                                                                                                                                        |

### C.3 Modules (catalog-level)

| Module                                                    | Documentation (`docs/modules.md`)                                                                                                                                   | Code                                                                                                                                                       | Result                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Identity                                                  | “v1 core”, sessions/login                                                                                                                                           | `identity` module, `Session` model, `/auth`                                                                                                                | **MATCH** (documented API is broader than implemented: no list/revoke-sessions endpoints; see C.8) |
| Users                                                     | “v1 core”, API + 6 permissions                                                                                                                                      | `/users`, 6 permission codes                                                                                                                               | **MATCH**                                                                                          |
| RBAC                                                      | “v1 core”, roles/permissions, 8 codes, no cache                                                                                                                     | `/roles`, `/permissions`, 8 codes, `AuthorizationGuard` + service re-check                                                                                 | **MATCH**                                                                                          |
| Organization                                              | “structure + party master implemented (Task 6); configuration half pending”                                                                                         | Also owns `organization_memberships` + `/organizations/:id/members` + 3 membership codes (Task 19 ODR-3)                                                   | **MISSING** (implemented membership absent from the entry) → **FIXED**                             |
| Accounting                                                | Status string stops at Tasks 10.x/11/12(READY FOR REVIEW)/17A/17B/18                                                                                                | Adds reversal (Task 15), period-close enforcement (Task 14), chart tree + pin coherence (Task 19)                                                          | **STALE / MISSING** → **FIXED**                                                                    |
| Inventory                                                 | “the master-data half is implemented (Task 6). The transactional half (movements, balances, reservations, valuation) is **not implemented** and waits on ADR-0017.” | `inventory_movements`, `inventory_balances`, `inventory_reservations`, `inventory_operations` + 9 controllers + 10 core permissions, ADR-0022 **Accepted** | **CONTRADICTS** → **FIXED**                                                                        |
| **Documents**                                             | **Absent from the catalog entirely**                                                                                                                                | Implemented module: `documents` schema, 4 models, 3 controllers, 9 permissions, ADR-0023 Accepted                                                          | **MISSING** → **FIXED** (concise entry added)                                                      |
| **Workflow**                                              | **Absent from the catalog entirely**                                                                                                                                | Implemented module: `workflow` schema, 8 models, 7 controllers, 10 permissions, ADR-0024 Accepted                                                          | **MISSING** → **FIXED** (concise entry added)                                                      |
| Audit                                                     | “v1 core”, `audit.audit_logs`                                                                                                                                       | **No module, no schema, no table**                                                                                                                         | **CLAIMS-UNIMPLEMENTED** (planned catalog entry) → status column clarified                         |
| Notifications                                             | “v1 core”                                                                                                                                                           | Not implemented                                                                                                                                            | **CLAIMS-UNIMPLEMENTED** → status column clarified                                                 |
| Sales                                                     | “v1 core”                                                                                                                                                           | Not implemented                                                                                                                                            | **CLAIMS-UNIMPLEMENTED** → status column clarified                                                 |
| Purchasing                                                | “planned” (OQ-16)                                                                                                                                                   | Not implemented                                                                                                                                            | **MATCH**                                                                                          |
| Reporting                                                 | “v1 core”                                                                                                                                                           | Not implemented; Accounting owns its own bounded read surfaces (Task 18/19)                                                                                | **CLAIMS-UNIMPLEMENTED** → status column clarified                                                 |
| Excel / Print / Customization / Integration / Sync / Jobs | “v1 core”                                                                                                                                                           | Not implemented (kernel has a `JobsRegistry` stub only)                                                                                                    | **CLAIMS-UNIMPLEMENTED** → status column clarified                                                 |
| **Treasury**                                              | Not a catalog module; appears only as a _future/consumer_ concept                                                                                                   | **No code of any kind**                                                                                                                                    | **DEFERRED / NOT IMPLEMENTED — OUT OF MVP** → explicit scope row added (§E)                        |

> The catalog’s `Status` column used “v1 core” for both implemented and
> not-yet-existing modules. That single word carried the whole implemented /
> planned distinction and was the largest governance risk in the file: a future
> Agent could read “v1 core” as “exists”. The fix adds an explicit
> implemented/planned marker to the map without rewriting the catalog.

### C.4 Accounting — foundation

| Claim                                                                                                                                               | Code evidence                                                                                                                                          | Status                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Financial areas / fiscal years / periods with permission-gated transitions, stored scope resolution                                                 | `financial-areas                                                                                                                                       | fiscal-years                                                        | accounting-periods`controllers + services +`20260914000000_accounting_foundation` | **MATCH** |
| Coding structures versioned `draft → active → superseded`, one active per organization                                                              | `coding-structures.controller.ts`, `domain/coding-structure.ts`                                                                                        | **MATCH**                                                           |
| Chart of accounts = one `accounts` table (`parent_id` + integer `level`), code immutable, no DELETE                                                 | `domain/account.ts`, `accounts.controller.ts`, `accounting.prisma`                                                                                     | **MATCH**                                                           |
| Accounting configurations D1–D7, exactly one ACTIVE per organization, partial unique index as DB backstop, operational freeze wired at finalization | `accounting-configurations.*`, `data/accounting-configuration-usage.ts`, `20260920000000_...`                                                          | **MATCH**                                                           |
| “Root creation and moves validate **only** against the account’s own configuration/version pair”                                                    | Task 19 ODR-1 added `planPinCoherence`: level count + per-level digit length must agree between the two pins, re-applied inside the locked transaction | **STALE** (pre-Task-19 wording) → **FIXED** in the Accounting entry |
| “No tree endpoint (the chart-of-accounts/tree reads are reporting projections)”                                                                     | `GET /api/v1/accounting/chart-tree` and `/:id` exist (Task 19 ODR-2, Accounting-owned, read-only)                                                      | **CONTRADICTS** → **FIXED**                                         |

### C.5 Accounting — documents & posting

| Claim                                                                                                                                                            | Code evidence                                                                                                                                                                  | Status                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Voucher header + lines, `draft                                                                                                                                   | temporary                                                                                                                                                                      | final`, dense `line_no`, exactly one side non-zero, Σ debit = Σ credit                                                                                     | `domain/accounting-document.ts`, `domain/voucher-lines.ts`, `accounting.prisma` | **MATCH** |
| Finalization is the single posting act; ledger entries materialized in the same transaction; operation row written last; 1:1 `uq_ledger_entries_voucher_line_id` | `data/accounting-documents.repository.ts` (`finalizeChecked`), `20260916000000_accounting_ledger`                                                                              | **MATCH**                                                                                                                                                  |
| `PostingService` orchestration, no transaction/lock/row of its own                                                                                               | `application/posting.service.ts`                                                                                                                                               | **MATCH**                                                                                                                                                  |
| Posting identity / idempotency via `(organization_id, operation_key)`                                                                                            | `accounting_posting_operations`, `data/accounting-posting-operations.repository.ts`                                                                                            | **MATCH**                                                                                                                                                  |
| Ledger immutability (insert-only, RESTRICT FKs)                                                                                                                  | `data/ledger-entries.repository.ts`, migration SQL                                                                                                                             | **MATCH**                                                                                                                                                  |
| “No correction, reversal, reopen, approval or reporting route” (Task 10.4 API paragraph)                                                                         | `POST /accounting-documents/:id/reverse` exists with `Accounting.Document.Reverse`; reversal migration + domain module present (recorded as Task 15 / PR #33 in `STATE.md` §7) | **CONTRADICTS** → **FIXED**                                                                                                                                |
| Closed/sealed periods reject posting                                                                                                                             | Enforced inside the finalization transaction (Task 14, ADR-0032 _Proposed_)                                                                                                    | **MATCH** in behavior; **governance note**: the ADR is still Proposed and Task 14 is still recorded READY FOR REVIEW — **CODE AHEAD OF GOVERNANCE** (§D-4) |

### C.6 Accounting — read/report layer

| Claim                                                                                                                         | Code evidence                                                                                                                                                                                                           | Status                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `.vardena/project-context.md`: “**nothing past the ledger** (no posting rules, dimensions, balances, corrections or reports)” | Balances (Task 12), corrections/reversal (Task 15), ledger movements (17A), account statements (17B), General Ledger + Trial Balance + shared read query layer (Task 18), chart tree (Task 19) all exist                | **CONTRADICTS** → **FIXED**                                                                   |
| `docs/modules.md`: “balances **READY FOR REVIEW as Task 12**”                                                                 | Task 12 is recorded **ACCEPTED WITH FOLLOW-UP (2026-09-23)** in `docs/accounting/task-index.md` and `STATE.md`; ADR-0031 remains Proposed and the P1 real-PostgreSQL concurrency verification remains an open follow-up | **STALE** → **FIXED** (status corrected; the P1 follow-up and the Proposed ADR are preserved) |
| `docs/modules.md` “API (still planned): … the remaining ledger/trial-balance/movement report shapes”                          | Trial Balance and General Ledger read surfaces exist (Task 18)                                                                                                                                                          | **STALE** → **FIXED** (remaining planned items narrowed to what is actually absent)           |
| Accounting permissions “36 codes”                                                                                             | **38** registered codes (adds `Accounting.GeneralLedger.View`, `Accounting.TrialBalance.View`)                                                                                                                          | **STALE** → **FIXED**                                                                         |
| Task 18 read foundation is Ledger-native; projection is derived/rebuildable, never a second truth                             | `data/accounting-read-query.repository.ts` reads `ledger_entries`; projection repository is separate and rebuildable                                                                                                    | **MATCH**                                                                                     |
| `docs/accounting/task-index.md` §3 “Current architecture”                                                                     | Lists Tasks 10.x, 12, 17A, 18 — omits reversal (Task 15) and the Task 19 ODR-1/ODR-2 outcomes                                                                                                                           | **MISSING** → **FIXED** (two factual bullets added)                                           |

### C.7 Inventory

| Claim                                                                      | Code evidence                                                                                                                                                                                                                                                                                                                    | Status                                                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `docs/modules.md`: transactional half “not implemented, waits on ADR-0017” | `inventory_movements` / `inventory_balances` / `inventory_reservations` / `inventory_operations`, movements/balances/reservations/transfers controllers, 10 core permissions, `InventoryMovement.Posted` / `InventoryTransfer.Posted` / `InventoryReservation.{Created,Released}` events; ADR-0022 **Accepted (Task 9.5 + 9.6)** | **CONTRADICTS** → **FIXED**                                                                                       |
| Inventory never calls Accounting (AR-16)                                   | No Accounting import in `inventory/`; no posting call                                                                                                                                                                                                                                                                            | **MATCH**                                                                                                         |
| Inventory→Accounting event consumption (ADR-0005)                          | Inventory publishes; **Accounting subscribes to nothing** — no consumer exists                                                                                                                                                                                                                                                   | **CLAIMS-UNIMPLEMENTED** in the event catalog (“Consumed by: Accounting (journal)”) → flagged, catalog note added |

### C.8 Identity / Users / RBAC

| Claim                                                                                                                      | Code evidence                                                                                                       | Status                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity API: login, logout, current session, **list/revoke sessions (self + admin)**, password change (own), forced reset | `/auth` controller implements login/logout/me; session list/revoke and self password change are **not** implemented | **CLAIMS-UNIMPLEMENTED** → flagged, **not silently rewritten** (the catalog documents the intended module surface; narrowing it is a scope statement, not a fact fix) |
| Users: 6 permissions, no DELETE endpoint (OQ-18)                                                                           | Matches code                                                                                                        | **MATCH**                                                                                                                                                             |
| RBAC: 8 codes, registry→DB mirror, no cache (ADR-0016), fail-closed guard                                                  | Matches code                                                                                                        | **MATCH**                                                                                                                                                             |
| `GET /permissions/effective` documented AR-21 exception                                                                    | Present in the controller                                                                                           | **MATCH**                                                                                                                                                             |

### C.9 Organization

| Claim                                                                                                                                        | Code evidence                                                                                                                                                                 | Status                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25 permission codes                                                                                                                          | **28** (adds `Organization.Membership.{View,Grant,Revoke}`)                                                                                                                   | **STALE** → **FIXED**                                                                                                                                                                                                                        |
| “No principal→organization binding” (as documented in OQ-01’s assumption)                                                                    | `organization_memberships` + `OrganizationsService.assertOrganizationInScope` chokepoint awaited by 45 non-test call sites across accounting/inventory/documents/organization | **CONTRADICTS the factual clause** (the _product_ tenancy question stays open) → assumption text corrected, **OQ-01 stays OPEN**                                                                                                             |
| Configuration half (tax definitions, custom fields) not implemented                                                                          | Confirmed absent                                                                                                                                                              | **MATCH**                                                                                                                                                                                                                                    |
| Membership administration requires acting-principal membership except the bounded first grant into an empty organization (PR #55 correction) | `OrganizationMembershipsService.authorizeMembershipAdministration` + `hasAnyMember`                                                                                           | **MATCH** in service code; **but** the doc comment in `backend/src/modules/organization/domain/organization-permissions.ts` still states the superseded rule (“Granting deliberately does NOT require the GRANTOR to already be a member …”) | **CONTRADICTS (in-code comment)** → **NOT FIXED here** (production file; §G/§H) |

### C.10 Documents & Workflow

| Claim                                               | Code evidence                                                                                                                                 | Status                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| No catalog entry for either module                  | Both fully implemented (ADR-0023 / ADR-0024 Accepted; migrations `20260912000000_documents_foundation`, `20260912010000_workflow_foundation`) | **MISSING** → **FIXED** (concise entries + map rows) |
| Accounting numbering reuses the Document Foundation | `documents` numbering allocation used by accounting document issuance                                                                         | **MATCH**                                            |

### C.11 Reporting

| Claim                                                             | Code evidence                                                                                                   | Status                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| “Reporting (v1 core)” module with registry + pipeline + export    | No module, no code                                                                                              | **CLAIMS-UNIMPLEMENTED** → status marker clarified                                                    |
| `docs/reporting-strategy.md` describes a generic reporting engine | Not implemented; Accounting owns bounded read surfaces instead (Task 18 D1–D20 and ADR-0009 module-view policy) | **CLAIMS-UNIMPLEMENTED** (strategy document, no implementation claim of its own) → no change; flagged |

### C.12 Treasury

See §E. Summary: **no documentation asserts Treasury is in MVP**, and **no
Treasury code exists**. The only references are future/consumer mentions
(accounting contract, product roadmap, MVP scope proposal listing Treasury as
explicitly out of the MVP). The gap was that no document stated the boundary in
one unambiguous place; that statement is now added.

### C.13 Frontend

| Claim                                                                                                  | Code evidence                                               | Status                                             |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------- |
| `.vardena/project-context.md`: “The frontend has not started; `frontend/` is still the target layout.” | No `frontend/` directory                                    | **MATCH**                                          |
| `README.md`: “React + TypeScript (Vite, Tailwind, shadcn/ui) frontend” in the opening sentence         | Not implemented; stack is fixed by ADR-0002 as the _target_ | **STALE phrasing** → **FIXED** (marked as planned) |
| `docs/architecture.md` §7 frontend architecture                                                        | Target design, self-evidently not implemented               | **MATCH** (as a target)                            |

### C.14 Testing

| Claim                                                                                              | Code evidence                                                                     | Status                                                    |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Unit specs beside code, e2e in `backend/test/`, live suites opt-in via `VARDENA_TEST_DATABASE_URL` | 101 unit spec files, 31 e2e specs, `vitest.config.e2e.ts` unreachable default URL | **MATCH**                                                 |
| `backend/README.md`: “`test/db.e2e-spec.ts` is **the** live-database suite”                        | Many `*-live.e2e-spec.ts` suites exist                                            | **STALE** → **FIXED**                                     |
| Task 11 migration rehearsal proves the backfill                                                    | `prisma/rehearsal/task-11-configuration-foundation/` + npm script                 | **MATCH**                                                 |
| Task 13 operational-freeze rehearsal exists but is **not** a CI step                               | `package.json` script present; `.github/workflows/ci.yml` does not run it         | **MATCH** with `STATE.md`; flagged as a standing gap (§K) |
| Test counts quoted in reports (e.g. “101 files / 1148 tests”)                                      | Not re-executed by this audit                                                     | **UNVERIFIED** — quoted as recorded, not re-proved        |

### C.15 Database / migrations

| Claim                                                                                                  | Code evidence                                                                                           | Status                                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Schema-per-module, one `.prisma` per module, ULIDs, `numeric(18,2)` money / `numeric(18,4)` quantities | Matches                                                                                                 | **MATCH**                                                   |
| “13 migrations” (`project-context.md`) / “15 SQL migrations” (`STATE.md`)                              | **16**                                                                                                  | **STALE** → **FIXED** in both                               |
| `docs/database-strategy.md` outbox DDL / `core` schema / audit tables                                  | Not implemented                                                                                         | **CLAIMS-UNIMPLEMENTED** (target DDL) → flagged, no rewrite |
| Raw SQL confined to module-owned data/reporting paths (AR-11)                                          | Accounting views + partial unique index + read queries are inside `accounting/data/` and its migrations | **MATCH**                                                   |

### C.16 Task status, ADRs and Open Questions

| Claim                                                                                                                                        | Evidence                                                                                                                                 | Status                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/accounting/task-index.md` header: “Task 13: **IN PROGRESS (self-review, 2026-09-23)** — PR #31 **open**”                               | PR #31 is **merged** (`2ea1160…`, recorded in `STATE.md` §7 and the Task 14 report base commit); the code is on `main`                   | **STALE FACT, correct governance status** → merge fact corrected; **status stays “not accepted”**                                                                   |
| Same header: “Task 14: READY FOR REVIEW — NOT ACCEPTED — PR **#32** **open**”                                                                | PR #32 is **merged** (`ce223fb…`, `STATE.md` §7)                                                                                         | **STALE FACT, correct governance status** → merge fact corrected; **status stays READY FOR REVIEW — NOT ACCEPTED**                                                  |
| Accounting task index has **no Task 15 row**                                                                                                 | Reversal is implemented and merged (PR #33; `STATE.md` §7 row 15) and is an Accounting capability                                        | **MISSING** → factual row added, with review status recorded as **UNKNOWN / no acceptance record found** (no acceptance invented)                                   |
| Tasks 17A/17B/17C/18/19/20 statuses                                                                                                          | Cross-checked against `STATE.md` §7, the acceptance records in `docs/tasks/`, and code                                                   | **MATCH**                                                                                                                                                           |
| Task 21 (Base Chart Governance & OQ-25 Resolution), merged on `main` in `1dca53a` after this audit's baseline                                | Documentation only — no `backend/` file changed; recorded **READY FOR REVIEW — NOT ACCEPTED**; OQ-25 narrowed but still **OPEN**         | **MATCH** — no code fact in this report is affected; not accepted or reinterpreted here                                                                             |
| ADR-0017/0018/0019/0020/0021 still **Proposed** while implemented (Inventory ledger, workflow, documents, org scope/master data)             | ADR files + shipped code                                                                                                                 | **CODE AHEAD OF GOVERNANCE** → reported only (§D-3); **no ADR status changed**                                                                                      |
| ADR-0031 (balance projection) and ADR-0032 (period close) **Proposed** while implemented                                                     | ADR files + shipped code                                                                                                                 | **CODE AHEAD OF GOVERNANCE** → reported only (§D-4)                                                                                                                 |
| ADR-0033…0037 **Proposed**; Task 17C/20 accepted without promoting them                                                                      | ADR headers say exactly this                                                                                                             | **MATCH**                                                                                                                                                           |
| ADR-0027 does not exist                                                                                                                      | Confirmed absent; `STATE.md` records the gap and forbids refilling the number                                                            | **MATCH**                                                                                                                                                           |
| `docs/accounting/domain-contract.md` header: “**Proposed** (domain contract — nothing is implemented)” and companion “ADR-0026 … (Proposed)” | ADR-0026 is **Accepted (2026-09-14)**; most of the contract’s foundation is implemented                                                  | **CONTRADICTS** → header annotated with a dated implementation-status note; the contract body and its DECIDED/EXPERT-GATED markers are untouched                    |
| `docs/open-questions.md` OQ-01 assumption: “ODR-3 is not implemented; membership is not modeled”                                             | Membership **is** modeled and enforced (Task 19)                                                                                         | **CONTRADICTS the factual clause** → clause corrected; **OQ-01 stays OPEN**                                                                                         |
| `docs/open-questions.md` OQ-62 assumption: “**No compatibility rule is enforced.**”                                                          | `planPinCoherence` enforces coherence on root create / child create / move, pre-flight and inside the locked transaction (Task 19 ODR-1) | **CONTRADICTS the factual clause** → clause corrected; **OQ-62 stays OPEN** (repair of existing divergent rows and the authoritative-pin question remain undecided) |
| OQ-63 (legacy fallback shape), OQ-64 (resolved by Task 13), OQ-25/OQ-41/OQ-43                                                                | Consistent with code and records                                                                                                         | **MATCH** — untouched                                                                                                                                               |

---

## D. Critical Mismatches

**D-1 — `README.md` and `backend/README.md` describe a repository that no
longer exists.** Both stated that no business modules exist. An agent or
newcomer reading only the READMEs would conclude the backend is empty and could
“re-implement” existing modules. _Fixed._

**D-2 — `.vardena/project-context.md`, the mandatory first read, is a
pre-Task-12 snapshot.** “Tasks 1–11”, “13 migrations”, “nothing past the
ledger” are all false at `d46bb4e`. This is the single most dangerous stale
document in the repository because `AG-01` makes it the entry point. _Fixed._

**D-3 — `docs/modules.md` omits two implemented modules (Documents, Workflow)
and denies an implemented half of a third (Inventory core).** ADR-0022/0023/0024
are Accepted and the code is on `main`. _Fixed (catalog entries added /
corrected)._ Separately, ADR-0017/0018/0019/0020/0021 remain **Proposed** while
their subject matter is implemented — **CODE AHEAD OF GOVERNANCE**, reported,
**not** resolved here.

**D-4 — Accounting behavior is materially ahead of several governance
records.** Balance projection (ADR-0031, Proposed; Task 12 accepted _with
follow-up_), period-close enforcement (ADR-0032, Proposed; Task 14 recorded
READY FOR REVIEW) and the reversal capability (no acceptance record found) are
all live in `main`. The documentation is corrected to describe what exists; the
acceptance/ADR statuses are **preserved unchanged**.

**D-5 — The accounting task index recorded merged PRs as “open”.** Tasks 13 and
14 were described as having open PRs (#31, #32) although both are merged. The
governance verdicts (“not accepted”) remain correct and unchanged; only the
merge facts were corrected.

**D-6 — Two Open Question assumption cells asserted facts the code disproves**
(OQ-01 “membership is not modeled”, OQ-62 “no compatibility rule is enforced”).
Corrected as facts; **both questions remain OPEN** — implementation is not an
Owner Decision.

**D-7 — An in-code doc comment contradicts the shipped authorization
behavior.** `backend/src/modules/organization/domain/organization-permissions.ts`
still documents the pre-PR-#55 rule (“granting deliberately does NOT require the
grantor to already be a member”), which PR #55 explicitly corrected. Because
this is a production source file, **this audit did not change it** — it is
listed in §G/§H as a required follow-up in a separately authorized change.

**D-8 — Architecture documents state unimplemented infrastructure in the
present tense** (`core.domain_events`, `sync.outbox_events`, `jobs.job_runs`,
Audit/Notifications/Reporting/Excel/Print modules). Not wrong as _targets_, but
readable as existing capability. Mitigated with dated status notes and an
explicit implemented/planned marker in the module map; the target architecture
itself is untouched.

---

## E. Treasury Scope — **Treasury = Deferred / Not MVP / Not Implemented**

### E.1 What was searched

Repository-wide, case-insensitive, English **and** Persian:
`treasury`, `خزانه‌داری`, `cash`, `صندوق`, `bank`, `بانک`, `payment`, `پرداخت`,
`receipt`, `دریافت`, `cheque`, `check`, `چک`, `settlement`, `تسویه`,
`financial instruments` — across `backend/src`, `backend/prisma`,
`backend/test`, `docs/`, `.vardena/`, `README.md`, `STATE.md`.

### E.2 Findings in code

| Question                                                             | Answer                                                                                                                                    |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Treasury module (`backend/src/modules/treasury`)?                    | **No**                                                                                                                                    |
| Treasury/cash/bank/payment/cheque/settlement Prisma model or schema? | **No** — the 8 DB schemas are identity, users, rbac, organization, inventory, documents, workflow, accounting                             |
| Treasury migration?                                                  | **No**                                                                                                                                    |
| Treasury API/DTO/permission?                                         | **No** — none of the 131 registered permission codes is a Treasury/Cash/Bank/Payment code                                                 |
| Cash/bank accounts?                                                  | **No.** `accounting.accounts` is a generic chart-of-accounts node; it has no cash/bank semantics, no control role, no bank-account master |
| Payment/receipt/cheque workflow?                                     | **No**                                                                                                                                    |
| Settlement/allocation engine?                                        | **No.** Task 16 (settlement/allocation foundation) is recorded **contract-finalization only, implementation authorization BLOCKED**       |

The hits the search returned are all unrelated to Treasury as a domain:
`receipt`/`issue` are **inventory movement types**; `party` master data carries
generic contact fields; `Check`/`checked` appear as verbs (`finalizeChecked`,
`checkHealth`); “settlement” appears only in accounting/product prose about
future capability.

### E.3 Findings in documentation

| Document                                                  | Treasury mention                                                                                                         | Nature                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `docs/product/mvp-scope-proposal-v1.md`                   | “Purchasing (C-01) · **Treasury/cash management** · Payroll/HR (C-02) …” listed among items **outside** the proposed MVP | consistent with the decision                          |
| `docs/product/development-roadmap-v1.md`                  | “Fixed assets; treasury/cash management; costing extensions per demand” — post-MVP/on-demand                             | consistent                                            |
| `docs/product/product-business-decision-baseline-v1.md`   | Treasury listed among post-MVP capabilities and as a _future event producer_                                             | consistent                                            |
| `docs/accounting/domain-contract.md`, ADR-0026            | Treasury named as a **future source module** that would post through the source-posting contract (§16.3)                 | future/deferred architectural context — **preserved** |
| `docs/modules.md` §Accounting “Consumes”                  | “inventory/sales/purchasing/**treasury** facts only through the source-posting contract”                                 | future consumer statement — **preserved**             |
| `docs/accounting/task-index.md` (Task 18 acceptance text) | “Cash Book, Treasury/Bank/Receipts-payments operational reports … remain unimplemented and unclosed”                     | consistent                                            |

**No document claims Treasury is part of the MVP or that Treasury code exists.**
No documentation correction was required to _remove_ an MVP claim; the required
action was to state the boundary explicitly, which was previously implicit.

### E.4 Recorded scope boundary (added verbatim to the documentation)

> **Treasury (خزانه‌داری) is deferred and is not part of the current MVP
> implementation scope.** Treasury capabilities — cash (صندوق), bank (بانک),
> payment (پرداخت), receipt (دریافت), cheque (چک) and settlement (تسویه)
> workflows and financial instruments — are future-phase capabilities. They must
> not be implemented implicitly by Accounting or by any other existing module.
> Existing references to Treasury in the accounting contract, ADRs and product
> documents are **future/deferred architectural context** and are preserved as
> such; they are not an authorization to build.

This statement was added to `.vardena/project-context.md`, `docs/modules.md`
(module map row + a short scope note) and `docs/accounting/task-index.md`. It
defines **no** Treasury domain model, **no** APIs and **no** architecture.

---

## F. Documentation Fixes Applied (file by file)

Every change below has exactly one justification: _the document was factually
stale or inconsistent with the verified repository state at `d46bb4e`_.

| File                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Why                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `docs/repository-documentation-audit.md` | **New** — this report                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Required deliverable                                                                                        |
| `.vardena/project-context.md`            | Rewrote “Current Repository State” (modules, 16 migrations, accounting capability list through Task 19/20, test/frontend state, governance pointers); refreshed the repository map (adds `STATE.md`, `docs/tasks/`, `docs/testing/`, `docs/product/`, `docs/decisions/`, `docs/architecture/`); added the Treasury scope boundary                                                                                                                                                                                                                                                                                              | “Tasks 1–11”, “13 migrations”, “nothing past the ledger”, “latest evidence = Task 11 report” were all false |
| `README.md`                              | Replaced the status block with the verified state; marked the frontend as planned; corrected the Accounting Domain Contract description; added `STATE.md` + `docs/tasks/` + this audit to the index                                                                                                                                                                                                                                                                                                                                                                                                                            | “No business modules exist yet” contradicted 8 implemented modules                                          |
| `backend/README.md`                      | Replaced the scope note; corrected the Prisma “current state” paragraph (16 migrations, 8 schemas, **no `core` schema**); updated the `modules/` layout block; corrected the live-DB test description                                                                                                                                                                                                                                                                                                                                                                                                                          | Claimed only Identity/Users/RBAC exist and that the DB has “no tables yet”                                  |
| `docs/architecture.md`                   | §6: replaced “the repository currently contains documentation only” with the verified state (target layout kept); §8: added a dated implementation-status note (in-memory bus; no `core.domain_events`, no outbox/jobs tables; worker has no dispatch loop)                                                                                                                                                                                                                                                                                                                                                                    | The first statement was false; the second presented target infrastructure in the present tense              |
| `docs/modules.md`                        | Module map: added an explicit _implemented / planned_ marker, added **Documents** and **Workflow** rows, added the **Treasury — deferred, not MVP** row; corrected the Organization row (membership) and the Accounting row (through Task 19); added concise **Documents** and **Workflow** sections; corrected the **Inventory** status (core ledger implemented, ADR-0022 Accepted); corrected the Accounting entry (reversal exists, chart-tree endpoint exists, pin coherence enforced, Task 12 status, 38 permissions, GL/TB shipped); added an event-catalog note that no Accounting consumer of Inventory events exists | Missing implemented modules; contradicted implemented behavior; stale counts and statuses                   |
| `docs/accounting/task-index.md`          | Header: corrected the Task 13 / Task 14 PR facts (merged, not open) while **preserving** their non-accepted governance status; §3: added the reversal capability and the Task 19 ODR-1/ODR-2 outcomes; §2: added a factual Task 15 (reversal) row with review status **UNKNOWN — no acceptance record found**; added the Treasury scope boundary note                                                                                                                                                                                                                                                                          | Index described merged PRs as open and omitted an implemented accounting capability                         |
| `docs/open-questions.md`                 | OQ-01: corrected “ODR-3 is not implemented; membership is not modeled” to the verified state, **question stays OPEN**; OQ-62: corrected “No compatibility rule is enforced” to the verified state, **question stays OPEN**                                                                                                                                                                                                                                                                                                                                                                                                     | Both cells asserted facts the code disproves; neither correction closes the question                        |
| `docs/accounting/domain-contract.md`     | Added a dated implementation-status note under the header (ADR-0026 is Accepted; the foundation/documents/posting/ledger/read layers are implemented; the contract text below is unchanged and still binding)                                                                                                                                                                                                                                                                                                                                                                                                                  | Header said “nothing is implemented” and called ADR-0026 Proposed                                           |
| `STATE.md`                               | Appended a dated correction annotation to the §2 database/module inventory (16 migrations; `OrganizationMembership`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Bootstrap-era inventory superseded by Task 19; the original record is preserved, not rewritten              |

Not changed (deliberately): all ADR files, all task acceptance records, all
implementation reports, `docs/security.md`, `docs/database-strategy.md`,
`docs/reporting-strategy.md`, `docs/integrations.md`, `docs/product/**`,
`docs/architecture/domain/**`, `.vardena/architecture-rules.md`,
`.vardena/agent-rules.md`, and every file under `backend/`.

---

## G. Remaining Mismatches (intentionally left unresolved)

| #    | Mismatch                                                                                                                                                          | Why not fixed here                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| G-1  | **AR-02 module anatomy vs shipped structure** — no `events/`, `reports/`, `imports/`, `documents/` folders; event schemas live in `domain/*.events.ts`            | AR-02 is a binding architecture rule; reconciling it is an **architectural decision (ADR)**, not a documentation fix |
| G-2  | **Stale doc comment in `organization-permissions.ts`** contradicting PR #55’s membership-administration rule                                                      | Production source file — outside this task’s permitted scope; must be corrected by a separately authorized change    |
| G-3  | **ADR-0017/0018/0019/0020/0021 Proposed while implemented**                                                                                                       | Changing an ADR status is a governance act; requires the owner’s acceptance decision                                 |
| G-4  | **ADR-0031 / ADR-0032 Proposed while implemented**; Task 14 recorded READY FOR REVIEW although merged; Task 13 never formally accepted                            | Same — acceptance is an Owner Decision; code presence is not acceptance                                              |
| G-5  | **Task 15 (reversal) has no brief, report, gate or acceptance record**                                                                                            | Cannot be invented. Recorded in the index as implemented with review status UNKNOWN                                  |
| G-6  | **Identity catalog API is broader than the implementation** (session list/revoke, self password change)                                                           | The catalog documents intended module surface; narrowing it is a scope decision, not a fact correction               |
| G-7  | **Planned-module documentation (Audit, Notifications, Sales, Reporting, Excel, Print, Customization, Integration, Sync, Jobs) is written as if specified for v1** | Legitimate target documentation; only the implemented/planned marker was clarified                                   |
| G-8  | **`docs/database-strategy.md` / `docs/integrations.md` / `docs/reporting-strategy.md` describe unimplemented DDL and pipelines**                                  | Target design documents; no factual claim about current state was found that required correction                     |
| G-9  | **Test/CI numbers quoted in reports were not re-executed**                                                                                                        | Documentation-only task; heavy suites delegated to CI (`docs/testing/test-execution-policy.md`)                      |
| G-10 | **Task 12 P1 follow-up** (real-PostgreSQL concurrency verification) still open                                                                                    | Recorded as open; not this task’s subject                                                                            |

---

## H. Governance Risks

Ordered by the likelihood that a future Agent implements something that is not
actually approved.

1. **“v1 core” in the module map (mitigated, not eliminated).** Ten catalog
   entries describe modules that do not exist. An Agent that reads a section
   without the map marker can still mistake the specification for a contract to
   implement. Recommended durable fix: a per-section status line (owner decision
   on wording).
2. **Treasury by osmosis.** Treasury is named as a future _source module_ in the
   accounting contract, and “Cash Book / Treasury reports” appear in exclusion
   lists. Without the explicit boundary (now added), an Agent could treat a
   cash/bank account in the chart of accounts, a settlement helper, or a
   “payment” document type as legitimate incremental work. **Treasury is out of
   MVP; nothing about it may be implemented implicitly.**
3. **Code-ahead-of-governance normalization.** Several capabilities shipped
   while their ADRs stayed Proposed and their tasks stayed non-accepted
   (G-3/G-4). The repository’s own rule is that implementation is not
   acceptance; if that pattern is treated as precedent, ADR gating becomes
   decorative.
4. **Stale in-code comments (D-7/G-2).** An Agent following AG-18 (“prefer the
   existing pattern”) may read the superseded comment and re-introduce
   permission-only cross-organization administration — a security regression.
5. **Event-driven Accounting posting looks half-wired.** The event catalog says
   Inventory events are “consumed by Accounting (journal)”, and ADR-0005 is
   Accepted, but **no consumer exists** and OQ-39 (delivery semantics) is OPEN.
   An Agent could add a subscriber and believe it is completing an approved
   design. It is not: OQ-39 gates it.
6. **Two competing “current state” documents.** `STATE.md` (accurate, detailed)
   and `.vardena/project-context.md` (was badly stale) both claim entry-point
   status. After this audit they agree; keeping them in sync must be part of
   every future task’s definition of done (AG-07).
7. **Reporting expectations.** `docs/reporting-strategy.md` promises a generic
   reporting engine while Task 18 deliberately delivered _Accounting-owned_
   bounded read surfaces. An Agent could build a Reporting module believing it
   is required; the accepted decision is the bounded slice, and anything beyond
   it needs its own authorization (OQ-25/OQ-43 remain OPEN).

---

## I. Production-Code Integrity

```text
Production code changed:            NO
Prisma schema changed:              NO
Migration added/changed:            NO
API changed:                        NO
DTO changed:                        NO
Permission changed:                 NO
Business logic changed:             NO
RBAC / authorization behavior:      NO
Accounting behavior changed:        NO
Inventory behavior changed:         NO
Documents behavior changed:         NO
Workflow behavior changed:          NO
Architecture implementation:        NO
Tests changed:                      NO
Dependencies changed:               NO
Treasury code created:              NO
Cash/Bank/Payment/Cheque code:      NO
```

Nothing under `backend/` was modified. The complete change set is Markdown
documentation and governance files (§F).

---

## J. Verification

| Command                                                                                           | Result                                               |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `git diff --check`                                                                                | **PASS** (no whitespace errors, no conflict markers) |
| `git status --porcelain`                                                                          | only the documentation files listed in §F            |
| `git diff --stat -- backend`                                                                      | **empty** — no backend file touched                  |
| Documentation-only scope check (`git diff --name-only` ∩ `backend/`, `*.ts`, `*.prisma`, `*.sql`) | **empty**                                            |

Not run, deliberately: `npm test`, `npm run test:e2e`, live-PostgreSQL suites,
migration rehearsals, `prisma validate/generate`. This is a documentation-only
change; per `docs/testing/test-execution-policy.md` heavy suites are delegated
to CI. The repository CI workflow (`CI` / `backend`) validates the backend on
pull requests to `main` and will run on this branch’s PR; this audit does not
wait on it and claims no CI result.

---

## K. Recommendations (factual next steps only)

1. **Owner decision on the pending acceptances** — Tasks 13, 14 and the reversal
   work (Task 15) are merged but not accepted; ADR-0031 and ADR-0032 are
   Proposed while implemented. Accept, reject or explicitly record the backlog.
   (Governance only; no new capability.)
2. **Owner/architect decision on ADR-0017/0018/0019/0020/0021** — all Proposed
   while implemented. The domain-blueprint §21 gate they reference should be
   closed one way or the other.
3. **Authorize a minimal code-comment correction** for
   `organization-permissions.ts` (D-7/G-2) so the source no longer documents a
   superseded authorization rule. Comment-only; no behavior change.
4. **Decide the AR-02 anatomy question** (G-1): either update AR-02 to the
   shipped convention or record the deviation. Requires an ADR.
5. **Consider adding a per-section implemented/planned status line** to
   `docs/modules.md` sections (the map marker added here is a partial mitigation).
6. **Consider adding the Task 13 operational-freeze rehearsal to CI** — the
   script exists but is not a configured step.
7. **Keep `.vardena/project-context.md` and `STATE.md` in the definition of
   done** for every future task (AG-07); this audit exists because they drifted.
8. **Do not implement Treasury.** Treasury remains out of MVP and deferred; any
   future Treasury work requires its own explicitly authorized task, brief and
   Owner Decision.

---

## Final status

**READY FOR REVIEW — NOT ACCEPTED.** This audit does not self-accept, closes no
Open Question, promotes no ADR and authorizes no implementation.
