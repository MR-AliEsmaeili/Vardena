# Task 25 — Main-Based Governance Audit Report

| | |
|---|---|
| Task | **Task 25 — Main-Based Governance Closure** |
| Type | Governance / repository audit / documentation closure |
| Status | **READY FOR REVIEW — NOT ACCEPTED** (acceptance is the Repository Owner's act — `STATE.md` §6) |
| Date | 2026-09-27 |
| **Audited `main` commit** | **`80944ce112dc16fd834585f8a4c2d83906547480`** (merge of PR **#69** — *docs: refine Vardena backend MVP roadmap with full inventory scope*, merged 2026-09-27T13:45:42Z) |
| Baseline CI evidence | GitHub Actions **CI** run [`36323517204`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/36323517204) on `80944ce` — **success** (`backend` + `frontend`) |
| Working branch | `arena/01a0e32b-vardena` |
| Production code changed | **1 file, comment-only** (`backend/src/modules/organization/domain/organization-permissions.ts`) — Workstream F, §9 |
| Database / migration / API / schema / frontend changes | **NONE** |

> **This report does not accept anything.** It records what is *implemented*, what is
> *merged*, what is *verified*, and what is *accepted* — as four distinct facts. Where
> documentation and the repository disagree, the repository wins for implementation state
> and the explicit acceptance record wins for acceptance state (task spec §10).

**Companion artifacts:** [implementation-acceptance-matrix.md](./implementation-acceptance-matrix.md) ·
[adr-reconciliation.md](./adr-reconciliation.md) · [oq-reconciliation.md](./oq-reconciliation.md) ·
[documentation-drift-report.md](./documentation-drift-report.md) ·
[owner-decision-pack.md](./owner-decision-pack.md) · [implementation-report.md](./implementation-report.md)

---

## 1. Audit scope

### 1.1 In scope

Workstreams A–F of the Task 25 specification, executed against the checkout of `main` @ `80944ce`:

| Workstream | Subject | Section |
|---|---|---|
| A | Main-based repository inventory (structure, modules, schema, migrations, controllers, services, repositories, guards, permissions, boundaries, tests, CI, OpenAPI, docs, ADRs, OQs, task reports, acceptance records) | §3, §4 |
| B | Task acceptance reconciliation (13, 14, 15, 20, 21, 23, 24, Bootstrap System Administrator, all later merged work) | §5 + matrix |
| C | ADR reconciliation (37 ADR files; backlog ADR-0017…0021, 0031, 0032) | §6 + ADR matrix |
| D | Open Question reconciliation against implementation | §7 + OQ matrix |
| E | Documentation vs code audit, severity-classified | §8 + drift report |
| F | The one authorized comment-only production correction | §9 |
| Special | Base Chart (Tasks 20/21/23/24), Security, MVP scope | §10, §11, §12 |

### 1.2 Explicitly NOT in scope (task spec §12, §21)

No Base Chart content, account-lifecycle policy, Control Roles, Dimensions, posting rules,
valuation, Inventory completion, Sales, Sales → Accounting, Inventory → Accounting, Reporting
Builder, Electronic Books, Tax, Treasury, Purchasing, Outbox, worker infrastructure, new
security model, new permission, or new database structure was designed, authorized or
implemented. No ADR was promoted, no OQ was closed, no task was accepted.

### 1.3 Evidence standard applied

Every claim below carries a repository path, a Prisma/migration artifact, a test file, a CI run
id, a merged PR number, or an explicit governance record. Where evidence is insufficient the
audit writes **UNKNOWN — OWNER/REPOSITORY EVIDENCE REQUIRED** and invents nothing. The local
checkout is **shallow** (`git rev-list --count HEAD` = 1); historical ancestry claims are taken
from GitHub PR metadata (`gh pr list`) and existing governance records, not from local history.

---

## 2. Audited repository state

```
repository        MR-AliEsmaeili/Vardena
default branch    main
audited commit    80944ce112dc16fd834585f8a4c2d83906547480  (merge of PR #69)
working branch    arena/01a0e32b-vardena  (branched from 80944ce)
working tree      clean at audit start (git status --porcelain: empty)
local history     shallow (.git/shallow present; 1 reachable commit)
root entries      .env.example .github .gitignore .vardena README.md STATE.md
                  backend/ docker-compose.yml docs/ frontend/
```

### 2.1 Verified quantitative inventory (counted at `80944ce`)

| Fact | Value | How it was counted |
|---|---|---|
| Application modules registered in `app.module.ts` | **9** (`health` + `users, identity, rbac, organization, inventory, documents, workflow, accounting`) | `backend/src/app.module.ts` |
| HTTP controllers | **46** | `grep -rl "@Controller" backend/src --include=*.ts \| wc -l` |
| Prisma models | **52** | `grep -rh "^model " backend/prisma/schema/*.prisma \| wc -l` |
| SQL migrations | **17** (`20260910000000_init` … `20260926010000_accounting_base_chart`) | `ls backend/prisma/migrations` (18 entries incl. `migration_lock.toml`) |
| Database schemas | **8** (identity, users, rbac, organization, inventory, documents, workflow, accounting) | `backend/prisma/schema/*.prisma` |
| Registered permission codes | **134** (Accounting 41 · Inventory 32 · Organization 28 · Workflow 10 · Documents 9 · RBAC 8 · Users 6) | per-module `domain/*permissions*.ts` definition arrays |
| Backend unit spec files | **107** | `find backend/src -name '*.spec.ts' \| wc -l` |
| Backend E2E spec files | **34** | `find backend/test -name '*.e2e-spec.ts' \| wc -l` |
| Frontend test files | **11** | `find frontend/src -name '*.test.ts*' \| wc -l` |
| CI workflows / jobs | **1 workflow** (`.github/workflows/ci.yml`), **2 jobs** (`backend`, `frontend`) | file inspection |

**These numbers match** the figures recorded in `.vardena/project-context.md`, `STATE.md` §2 and
`docs/roadmap/backend-mvp-roadmap.md` §1.2. No numeric drift was found.

---

## 3. Implementation inventory (Workstream A)

Evidence paths are relative to the repository root. `CI` evidence is the `backend` job of run
`36323517204` on the audited commit unless a task-specific run is cited.

| Capability | Code evidence (on `main` @ `80944ce`) | Test evidence | CI evidence | Task | Acceptance record | Status |
|---|---|---|---|---|---|---|
| **Foundation / kernel** | `backend/src/kernel/{config,correlation,errors,events,http,ids,jobs,logging,pagination,prisma,rate-limit}`, `backend/src/main.ts`, `kernel/http/configure-app.ts` | `backend/test/{errors,validation,correlation,rate-limit,health,db}.e2e-spec.ts` | run `36323517204` backend job | Tasks 1–4 (undocumented individually) | none | **MERGED — acceptance UNKNOWN** |
| **Identity / sessions** | `modules/identity/**` (opaque 256-bit tokens, SHA-256 at rest, Argon2id via `users/domain/password.service.ts`) | `backend/test/auth.e2e-spec.ts` | run `36323517204` | Tasks 1–4 | none | **MERGED — acceptance UNKNOWN; PARTIAL capability** (no session list/revoke, no self-service password change, no forced first-login change) |
| **Users** | `modules/users/**`; 6 permission codes | `users.service.spec.ts`, `backend/test/rbac.e2e-spec.ts` | run `36323517204` | Tasks 1–4 | none | **MERGED — acceptance UNKNOWN** |
| **RBAC** | `modules/rbac/**`; code registry → `rbac.permissions` mirror; `application/authorization.guard.ts` fails closed; no cache; no wildcard | `authorization.guard.spec.ts`, `permission-registry.spec.ts`, `backend/test/rbac.e2e-spec.ts` | run `36323517204` | Tasks 1–4 | none (ADR-0006/0016 Accepted) | **MERGED — acceptance UNKNOWN** |
| **Organization & master data** | `modules/organization/**`; `organization.organizations/branches/departments/employees/parties`; migration `20260911000000_organization_master_data` | `hierarchy.spec.ts`, `master-data-authorization.spec.ts`, `backend/test/master-data.e2e-spec.ts` | run `36323517204` | Task 6 | none; ADR-0021 **Proposed** | **MERGED — acceptance UNKNOWN; PARTIAL** (no tax definitions / custom fields) |
| **Deployment organization pin (ADR-0025)** | `organization/application/deployment-scope.guard.ts` registered as a **global `APP_GUARD`** in `organization/organization.module.ts:81`; `OrganizationsService.assertDeploymentOrganizationPin` | `deployment-scope.guard.spec.ts`, `backend/test/deployment-scope.e2e-spec.ts` | run `36323517204` | Task 9.6 | ADR-0025 **Accepted** | **IMPLEMENTED — no-op unless `DEPLOYMENT_ORGANIZATION_ID` is configured** |
| **Organization membership / ODR-3** | `organization.organization_memberships` (migration `20260926000000_organization_membership`); `OrganizationsService.assertOrganizationInScope`; `OrganizationMembershipsService`; `MEMBERSHIP_PERMISSIONS` | `organization-memberships.service.spec.ts` (17 tests), `backend/test/organization-membership.e2e-spec.ts` | PR #55 run `36238862315`; run `36323517204` | Task 19 (+ PR #55 correction) | `docs/tasks/task-19/task-19-acceptance-record.md` | **ACCEPTED 2026-09-26 — but see §11 SEC-01: the chokepoint is NOT applied on 37 read surfaces** |
| **Inventory master data** | `modules/inventory/**`; migration `20260911010000_inventory_master_data` | `inventory-core-permissions.spec.ts`; `backend/test/inventory-core.e2e-spec.ts` | run `36323517204` | Task 6 / 9.5 | none; ADR-0022 **Accepted** | **MERGED — acceptance UNKNOWN** |
| **Inventory core (movements / balances / reservations / transfers)** | `modules/inventory/application/inventory-{movements,balances,reservations,transfers}.service.ts`; migration `20260911020000_inventory_core` | `backend/test/inventory-core.e2e-spec.ts` + inventory unit specs | run `36323517204` | Task 9.5 / 9.6 | none; ADR-0022 **Accepted**, ADR-0017 **Proposed** | **MERGED — acceptance UNKNOWN; PARTIAL** (no costing/valuation — OQ-24/OQ-11) |
| **Documents foundation** | `modules/documents/**`; migration `20260912000000_documents_foundation`; 9 permissions | `backend/test/{documents,documents-live}.e2e-spec.ts` | run `36323517204` | Task 8 | none; ADR-0023 **Accepted**, ADR-0019 **Proposed** | **MERGED — acceptance UNKNOWN** |
| **Workflow foundation** | `modules/workflow/**`; migration `20260912010000_workflow_foundation`; 10 permissions | `backend/test/{workflow,workflow-live}.e2e-spec.ts` | run `36323517204` | Task 9 | none; ADR-0024 **Accepted**, ADR-0018 **Proposed** | **MERGED — acceptance UNKNOWN** |
| **Accounting foundation (area / year / period)** | `modules/accounting/application/{financial-areas,fiscal-years,accounting-periods}.service.ts`; migration `20260914000000_accounting_foundation` | `backend/test/{accounting,accounting-live}.e2e-spec.ts` | run `36323517204` | Task 10.2 | index §2 records MERGED; review UNKNOWN | **MERGED — acceptance UNKNOWN** |
| **Coding structures + chart of accounts** | `coding-structures.service.ts`, `accounts.service.ts`, `domain/account{,-code,-placement}.ts`; migration `20260914010000_accounting_coding_structure_accounts` | `account-code.spec.ts`, `account-placement.spec.ts`, `coding-structure-accounts.spec.ts`, `backend/test/account-structure{,-live}.e2e-spec.ts` | run `36323517204` | Task 10.3 | index §2 MERGED; review UNKNOWN | **MERGED — acceptance UNKNOWN** |
| **Accounting documents (vouchers)** | `accounting-documents.service.ts`, `domain/accounting-document.ts`; migration `20260915000000_accounting_documents` | `accounting-document.spec.ts`, `backend/test/accounting-documents{,-live}.e2e-spec.ts` | run `36323517204` | Task 10.4 | index §2 MERGED; review UNKNOWN | **MERGED — acceptance UNKNOWN** |
| **Posting / immutable ledger** | `posting.service.ts`, `posting-readiness.service.ts`, `domain/posting.ts`, `domain/ledger-entry.ts`, `data/ledger-entries.repository.ts`; migration `20260916000000_accounting_ledger` | `posting.service.spec.ts`, `posting-readiness.spec.ts`, `backend/test/ledger-entries-live.e2e-spec.ts` | run `36323517204` | Tasks 10.5–10.8 | index §2 MERGED; review UNKNOWN | **MERGED — acceptance UNKNOWN** |
| **Accounting configuration foundation** | `accounting-configurations.service.ts`, `domain/accounting-configuration{,-freeze}.ts`; migration `20260920000000_accounting_configuration_foundation` | `accounting-configurations.spec.ts`, `accounting-configuration-usage.spec.ts`, `backend/test/accounting-configuration-live.e2e-spec.ts`; `npm run test:migration-rehearsal` | run `36323517204` (rehearsal is a CI step) | Task 11 | index §2 **ACCEPTED 2026-09-22** | **ACCEPTED** |
| **Balance projection** | `data/account-balance-projections.repository.ts`, `domain/balance-projection.ts`, `accounting-balances.service.ts`; migration `20260922000000_accounting_balance_projection` | `balance-projection.spec.ts`, `balance-lock-order.spec.ts`, `balance-pagination-regression.spec.ts` | run `36323517204` | Task 12 | index quotes legacy **“ACCEPTED WITH FOLLOW-UP”** (a label `STATE.md` §6 forbids as a review outcome) | **MERGED — acceptance DISPUTED (BOOT-OQ-02); P1 real-PostgreSQL concurrency verification OPEN** |
| **Operational freeze marker (D4)** | freeze wiring inside finalization (`accounting-configuration-freeze.ts`, `accounting-documents.service.ts`); rehearsal `backend/prisma/rehearsal/task-13-operational-freeze` | `accounting-configuration-usage.spec.ts`; `npm run test:operational-freeze-rehearsal` (**not a CI step**) | run `36323517204` (freeze rehearsal NOT executed) | Task 13 | none — recorded **IN PROGRESS (self-review)** | **MERGED — NOT ACCEPTED** |
| **Period close enforcement** | period gate + locked-row checks in finalization/posting; `domain/accounting-period.ts` | `accounting-period.spec.ts`, `backend/test/accounting-period-lifecycle-live.e2e-spec.ts` | run `36323517204` | Task 14 | none — **READY FOR REVIEW**; ADR-0032 **Proposed** | **MERGED — NOT ACCEPTED** |
| **Document reversal** | `domain/document-reversal.ts`, reversal paths in service/repository, `Accounting.Document.Reverse`; migration `20260923000000_accounting_document_reversal` | `document-reversal.spec.ts`, `accounting-documents.repository.spec.ts` | run `36323517204` | Task 15 | **none found** (no brief, no review, no acceptance record) | **MERGED — acceptance UNKNOWN** |
| **Ledger movement read source** | `domain/ledger-movement.ts`, `ledger-movements.service.ts`, `GET /accounting/ledger-movements` | `ledger-movements.service.spec.ts`, `backend/test/{accounting-ledger-movements,ledger-movements-live}.e2e-spec.ts` | run `36323517204` | Task 17A | `docs/tasks/task-17/task-17a-acceptance-record.md` | **ACCEPTED 2026-09-25** |
| **Account statement read surface** | `domain/account-statement.ts`, `account-statements.service.ts`, `GET /accounting/account-statements` | `account-statements.service.spec.ts`, `backend/test/{accounting-account-statements,account-statements-live}.e2e-spec.ts` | run `36323517204` | Task 17B | `docs/tasks/task-17/task-17b-acceptance-record.md` | **ACCEPTED 2026-09-25** |
| **Reporting read foundation (GL + Trial Balance)** | `data/accounting-read-query.repository.ts`, `general-ledger.service.ts`, `trial-balance.service.ts`, `accounting-report-support.ts`; `Accounting.GeneralLedger.View`, `Accounting.TrialBalance.View` | `general-ledger.service.spec.ts`, `trial-balance.service.spec.ts`, `accounting-read-query.repository.spec.ts` | PR #46 run `36133360887`; run `36323517204` | Task 18 | `docs/tasks/task-18/task-18-acceptance-record.md` | **ACCEPTED 2026-09-25** |
| **ODR-1 pin coherence + ODR-2 chart tree + ODR-3 binding** | `application/account-pin-coherence.spec.ts`, `domain/configuration-coding-consistency.spec.ts`, `chart-tree.service.ts` + `GET /accounting/chart-tree`, `assertOrganizationInScope` | `chart-tree.service.spec.ts`, `backend/test/chart-tree.e2e-spec.ts`, `organization-membership.e2e-spec.ts` | PR #54/#55 run `36238862315` | Task 19 | `docs/tasks/task-19/task-19-acceptance-record.md` | **ACCEPTED 2026-09-26** |
| **Frontend vertical slice** | `frontend/src/{app,api,features,ui,lib,styles,test}` — login/session, permission gating, organization context, RTL shell, 4 read-only Accounting surfaces | 11 frontend test files (Vitest + Testing Library) | `frontend` job of run `36323517204` | Task 22 | Task 22 acceptance recorded (PR #65) | **ACCEPTED 2026-09-26** |
| **Bootstrap System Administrator** | `backend/src/bootstrap/system-administrator-bootstrap.service.ts`, `npm run bootstrap:system-admin`, invoked by Compose + CI | `system-administrator-bootstrap.service.spec.ts`, `backend/test/bootstrap-system-administrator-live.e2e-spec.ts` | CI step “Bootstrap system administrator” in run `36323517204` | unnumbered (PR #64) | **none** | **MERGED — READY FOR REVIEW — NOT ACCEPTED** |
| **Base Chart template + explicit adoption (mechanism only)** | `domain/base-chart-{template,adoption}.ts`, `application/base-chart-{templates,adoptions}.service.ts`, `data/base-chart-{templates,adoptions}.repository.ts`, 3 controllers, 5 Prisma models, 3 permissions; migration `20260926010000_accounting_base_chart` | `base-chart-template.spec.ts`, `base-chart-adoption.spec.ts`, `base-chart-{templates,adoptions}.service.spec.ts`, `backend/test/base-chart-live.e2e-spec.ts`, `backend/test/base-chart-api-live.e2e-spec.ts` | PR #66 checks `36298005115`; run `36323517204` | Task 23 | **none** | **MERGED — READY FOR REVIEW — NOT ACCEPTED. No Base Chart CONTENT exists** (verified: no INSERT into `base_chart_template_nodes` in any migration) |
| **Account-list organization scope (R-2)** | one statement in `accounts.service.ts::listAccounts` + OpenAPI 404 annotation in `accounts.controller.ts` | 9 new cases in `coding-structure-accounts.spec.ts` (suite 41 passed) | PR #67 run `36306140879`; checks `36306360274`; run `36323517204` | Task 24 | **none** | **MERGED — READY FOR REVIEW — NOT ACCEPTED** |
| **Backend MVP roadmap** | `docs/roadmap/{backend-mvp-roadmap,backend-mvp-dependency-matrix,future-task-candidates}.md` | n/a (documentation) | run `36323517204` | PR #69 | **none** | **MERGED — READY FOR REVIEW — NOT ACCEPTED** |
| **Audit module** | **NOT PRESENT** — no module, schema, table | — | — | — | — | **NOT IMPLEMENTED** |
| **Outbox / durable events / job runner** | **NOT PRESENT** — in-memory `kernel/events/domain-event-bus.ts` only; `worker.service.ts` explicitly defers dispatch loops; no `sync.outbox_events`, no `jobs.job_runs` | — | — | — | ADR-0004/0005/0010 Accepted **as decisions**, unimplemented | **NOT IMPLEMENTED** |
| **Sales / Purchasing / Treasury / Reporting Builder / Tax / Integration / Print / Excel / Notifications / Customization** | **NOT PRESENT** — no module, schema, migration, API or permission | — | — | — | — | **NOT IMPLEMENTED** (Treasury and Purchasing are explicitly out of MVP — §12) |

---

## 4. Boundaries, guards and public-service surfaces (verified)

- **Layering:** every module under `backend/src/modules/<m>/` carries `api/`, `application/`,
  `domain/`, `data/` (except `health`, which has no data layer) — consistent with ADR-0001/0015.
- **Cross-module access** is through injected *services*, never foreign repositories: e.g.
  Accounting services inject `OrganizationsService`; `OrganizationMembershipsService` proves the
  user side through a database foreign key rather than reading the Users tables (AR-07).
- **Route guards:** controllers declare `@UseGuards(AuthGuard, AuthorizationGuard)` +
  `@RequirePermission(...)`; `authorization.guard.ts` **fails closed** when permission metadata
  is absent.
- **Global guard:** `DeploymentOrganizationScopeGuard` is registered as `APP_GUARD` in
  `organization/organization.module.ts:81` and therefore applies to every route. It compares the
  configured `DEPLOYMENT_ORGANIZATION_ID` against `organizationId` in the body, the query string
  and the marked path param, answering 404 on a mismatch. **It is a complete no-op when no pin is
  configured**, and it never checks membership.
- **System context:** `AuthorizationService.requireAllPermissions` and
  `OrganizationsService.assertOrganizationInScope` both treat “no HTTP request in flight” as
  trusted system context. This is the established, documented posture; it is also the path used
  by the bootstrap command, migrations rehearsals and tests.
- **OpenAPI:** DTO-driven Swagger contract served under `/api/docs`, routes versioned `/api/v1`
  (`backend/src/main.ts`, `kernel/http/configure-app.ts`) — ADR-0014 holds.

---

## 5. Task reconciliation (Workstream B) — summary

Full detail: [implementation-acceptance-matrix.md](./implementation-acceptance-matrix.md).

| Governance state | Work items |
|---|---|
| **ACCEPTED** (explicit Owner record) | Task 11, Task 17A, Task 17B, Task 17C, Task 18, Task 19 (+PR #55), Task 20, Task 21, Task 22 |
| **IMPLEMENTED BUT NOT ACCEPTED** | **Bootstrap System Administrator (PR #64)**, **Task 23 (PR #66)**, **Task 24 R-2 (PR #67)**, **Backend MVP roadmap (PR #69)**, **Task 13 (PR #31)**, **Task 14 (PR #32)** |
| **MERGED — ACCEPTANCE UNKNOWN** (no record found either way) | Tasks 1–9.6, 10.1–10.8, **Task 15 (PR #33)** |
| **ACCEPTANCE DISPUTED** | **Task 12 (PR #30)** — the index quotes the legacy label “ACCEPTED WITH FOLLOW-UP”, which `STATE.md` §6 explicitly forbids as a review outcome (BOOT-OQ-02) |
| **NOT IMPLEMENTED / BLOCKED** | Task 16 (contract only, implementation authorization BLOCKED), Task 17 umbrella (FORMALIZED / BLOCKED by OQ-25 + OQ-43) |
| **READY FOR REVIEW (this task)** | **Task 25** |

**No task is represented as Accepted without an acceptance-record path.** Four work items are
explicitly recorded as **IMPLEMENTED BUT NOT ACCEPTED** and remain so after this audit.

---

## 6. ADR reconciliation (Workstream C) — summary

Full detail: [adr-reconciliation.md](./adr-reconciliation.md). 37 ADR files exist
(`docs/adr/0001…0037`, **no ADR-0027**).

| Class | ADRs |
|---|---|
| **Accepted** | 0001–0016, 0022, 0023, 0024, 0025, 0026, 0028 (22 ADRs) |
| **Proposed while the subject IS implemented in `main`** (governance backlog) | **0017** (inventory ledger), **0018** (workflow), **0019** (documents), **0020** (organizational scope), **0021** (organization-scoped master data), **0031** (balance projection), **0032** (period close) |
| **Proposed, subject NOT implemented** | 0029 (machine API), 0030 (license), 0033 (account identity/code history), 0034 (posting vs aggregation), 0035 (code-structure migration service — *not authorized*), 0036 (legal reporting), 0037 (configuration boundary) |
| **Accepted as a decision, unimplemented in code** | 0003, 0004, 0005, 0009, 0010, 0011, 0012, 0013 |
| **Missing identifier** | **ADR-0027 does not exist.** The gap is recorded; it must not be filled or renumbered. |

**No ADR was promoted by this audit.** The seven-ADR backlog is preserved exactly as governance
backlog and is carried into the Owner Decision Pack as **D-03**.

---

## 7. OQ reconciliation (Workstream D) — summary

Full detail: [oq-reconciliation.md](./oq-reconciliation.md). The registry
`docs/open-questions.md` holds **OQ-01…OQ-63 OPEN** and **OQ-64 RESOLVED (2026-09-23, Task 13)**.

- **No OQ was closed, reworded, renumbered or reclassified by this audit.**
- The eighteen OQs the task spec highlights (OQ-23, 24, 25, 27, 30, 34, 35, 36, 38, 39, 40, 41,
  42, 43, 49, 54, 62, 63) are **all still OPEN in the registry** and are reconciled individually
  against implementation in the OQ matrix.
- **OQ-25** remains OPEN and substantially narrowed by Tasks 20/21: the *mechanism* is decided and
  now implemented (Task 23), the *content* (values, role catalog, mandatory set, per-level
  defaults) is not.
- **OQ-36** remains OPEN with explicit Task 21 prerequisites; the repository still has no delete
  operation for master data (`is_active` lifecycle only) — consistent with the OQ.
- **OQ-39** remains OPEN and continues to gate every system-generated posting path; the absence of
  an outbox in `main` is consistent with that.
- **Implementation-ahead-of-OQ conflicts: none found.** No merged capability decides an OQ that
  the registry still calls open.

---

## 8. Documentation drift (Workstream E) — summary

Full detail and per-item corrections: [documentation-drift-report.md](./documentation-drift-report.md).

| Severity | Count | Items |
|---|---|---|
| CRITICAL | **1** | DR-01 — `docs/security.md` §3 states that *every* organization-scoped read and write passes through `assertOrganizationInScope`; **37 read surfaces do not** (§11 SEC-01) |
| HIGH | **2** | DR-02 — Task 24 finding **F-3** asserts no global pin `APP_GUARD` exists; one **is** registered (`organization.module.ts:81`), so F-3 is factually wrong and its downstream repetitions inherit the error. DR-03 — the recorded scope of finding **F-2** (four Accounting list surfaces) understates a 37-surface class |
| MEDIUM | **2** | DR-04 — Task 24 gate §1 says Task 23 has “no row in `STATE.md` §7 and no row in `docs/accounting/task-index.md` §2”; both rows now exist (PR #68) — the gate text is stale. DR-05 — `STATE.md` §8 states “No Task 25 is defined or selected here”; Task 25 now exists |
| LOW | **2** | DR-06 — the `MEMBERSHIP` doc comment in `organization-permissions.ts` described the pre-PR-#55 rule (**corrected by this task**, §9). DR-07 — `docs/accounting/domain-contract.md` header still reads Proposed/no-implementation while the contract's foundation/document/posting/read layers are implemented (pre-existing BOOT-R-10) |
| INFORMATIONAL | **3** | DR-08 — Task 13's operational-freeze rehearsal exists but is not a CI step. DR-09 — required branch-protection checks remain UNKNOWN (BOOT-OQ-04). DR-10 — the local checkout is shallow, so historical ancestry is recorded, not revalidated |

**No numeric drift** was found: migrations (17), controllers (46), models (52), permissions (134),
unit specs (107), E2E specs (34) all match `STATE.md`, `.vardena/project-context.md` and the
roadmap.

---

## 9. Workstream F — the authorized comment-only correction

**File:** `backend/src/modules/organization/domain/organization-permissions.ts`
**Change class:** comment-only. Zero behavioral change, no refactor, no import change, no
permission change, no formatting churn beyond the replaced comment block.

**Why it qualified.** The `MEMBERSHIP` block stated:

> *“Granting deliberately does NOT require the GRANTOR to already be a member of the target
> organization … The permission is the authority, exactly as `Rbac.UserRole.Assign` is …”*

That is the **pre-PR-#55 rule**. PR **#55** (merged in `6a69bc6c17bf0dfb69a15adc3e3203ae6098d871`,
the ODR-3 post-merge correction accepted as part of Task 19) made membership administration
organization-bound. The shipped code contradicts the old comment:

- `OrganizationMembershipsService.listMembers` → `authorizeMembershipAdministration(orgId, { allowBootstrap: false })`
- `OrganizationMembershipsService.grantMembership` → `authorizeMembershipAdministration(orgId, { allowBootstrap: true })`
- `revokeMembership` → membership-bound, no exception
- the service class doc, `docs/security.md` §3 and `STATE.md` §8 all describe the corrected rule

The comment was therefore the **only** artifact still asserting the superseded rule. It has been
replaced with a description of the shipped rule plus the single bootstrap exception. The exported
constants, descriptions and code strings are byte-identical.

**Verification:** `git diff --stat` = 1 file, +17 / −7, all inside a `/** … */` block;
`git diff --check` clean. Behaviour is unchanged by construction (no executable token touched).

---

## 10. Special audit — Base Chart

### 10.1 Task 20 invariants (all four VERIFIED on `main`)

| Invariant | Verification evidence |
|---|---|
| **Template identity ≠ Ledger identity** | `BaseChartTemplateNode.nodeKey` is documented and used as *template-internal* identity; `accounts` rows created by adoption carry **no** template reference column; `LedgerEntry.accountId → Account.id` is untouched (`backend/prisma/schema/accounting.prisma`, `base-chart-adoptions.service.ts` header) |
| **Adoption = Copy** | `BaseChartAdoptionsService.adopt` materializes the published version as ordinary organization-owned `accounts` rows in one guarded transaction; the adoption row records `templateVersionId`, `accountCount` and the resolved ODR-1 pin pair — the accounts themselves are indistinguishable from hand-authored ones |
| **Posting = Leaf-only** | `BaseChartTemplateNode.isPostable` is explicitly *“HARD-BOUNDED by leaf-only: the publish gate refuses a postable parent and the adoption derivation forces `false` on every node that has children in the adopted set (OD-20-5)”*; the account domain enforces `postable_with_children` via `planPostabilityChange` |
| **Aggregation = Read-time** | No aggregate is stored for parents: `trial-balance.service.ts` performs POSTING→AGGREGATION ancestor roll-up at read time over `accounting.ledger_entries`; the only persisted derivation is the Task 12 turnover projection, documented as rebuildable and not a second monetary truth |

### 10.2 Task 21 governance (VERIFIED as implemented mechanism)

| Governance requirement | Evidence |
|---|---|
| Explicit adoption (never implicit/automatic) | `POST /api/v1/accounting/adopt-base-chart` + `Accounting.BaseChart.Adopt`; nothing adopts on migration, on organization creation, or on startup |
| Versioning | `BaseChartTemplateVersion.versionNumber` (1-based per template), status `draft \| approved \| published \| superseded` |
| Immutable used versions | published/superseded versions are immutable except the lifecycle stamps; `supersededByVersionId` uses `onDelete: Restrict` — *“history is never removed”* |
| No silent mutation | adoption is validated entirely before any write; a repeated adoption of the same (organization, published version) is a deterministic **409**, never a duplicate hierarchy and never a silent no-op |
| Organization isolation | `listAdoptions`/`getAdoption`/`adopt` each call `assertOrganizationInScope`; the adoption row is organization-keyed |
| Controlled upgrade semantics | adoption requires an EMPTY chart; no upgrade/merge path exists — an upgrade remains an unimplemented, OQ-gated concept |
| Code-reuse & deletion constraints | no delete endpoint for templates/versions/nodes; `RESTRICT` FKs throughout; master-data deletion remains OQ-36 |
| Code-history producer requirement (OD-20-4) | recorded in ADR-0033/0035 (**Proposed**); **no code-history mechanism is implemented** — correctly absent, not silently claimed |

### 10.3 Task 23 mechanism (VERIFIED)

Implementation exists (5 models, 3 controllers, 3 permissions, migration
`20260926010000_accounting_base_chart`, live HTTP E2E in `base-chart-api-live.e2e-spec.ts`).
**Base Chart CONTENT does not exist** — verified by the absence of any `INSERT` into
`accounting.base_chart_template_nodes` in every migration. Task 23 is **NOT ACCEPTED**.

### 10.4 Task 24 (VERIFIED)

`AccountsService.listAccounts` asserts `assertOrganizationInScope(query.organizationId)` before
any read, on every path, independent of optional filters; principal binding and the deployment
pin are both restored on that surface; a foreign organization answers **404**, never 403 and never
an empty page; cross-organization regression coverage exists (9 cases). Task 24 is **NOT
ACCEPTED**. Its recorded findings **F-2…F-6** remain open, and **F-3 is factually incorrect**
(§8 DR-02).

### 10.5 Base Chart content

**Not implemented and not authorized.** OQ-25 remains OPEN for content values, the control-role
catalog and the mandatory set; OQ-36 prerequisites remain explicit; OQ-41/OQ-43 remain OPEN.

---

## 11. Security findings (Workstream A/E + task spec §15)

> Task spec §15: *any* security discrepancy is at least HIGH and must not be downgraded because
> the feature is already merged.

### SEC-01 — **CRITICAL** — ODR-3 principal binding is absent on 37 organization-scoped read surfaces

**Claim under audit:** `docs/security.md` §3 — *“every organization-scoped read and write passes
through `OrganizationsService.assertOrganizationInScope` (deployment pin → principal →
membership), so a caller without a membership row gets 404”*.

**Actual repository state at `80944ce`:** 28 `list*` methods and 9 `get*` methods accept a
caller-supplied `organizationId` (or resolve a row only *structurally* by `organizationId`) and
never reach the chokepoint. Verified by static call-graph resolution over
`backend/src/modules/*/application/*.service.ts` (constructor-field → imported class → method
body, depth 4), then hand-confirmed on representative samples.

| Module | List surfaces without the chokepoint |
|---|---|
| accounting (5) | `accounting-configurations.listConfigurations`, `accounting-periods.listAccountingPeriods`, `coding-structures.listVersions`, `financial-areas.listFinancialAreas`, `fiscal-years.listFiscalYears` |
| documents (2) | `document-relations.listRelations`, `numbering.listAllocations` |
| inventory (8) | `inventory-balances.listBalances`, `inventory-movements.listMovements`, `inventory-reservations.listReservations`, `item-groups.listItemGroups`, `items.listItems`, `unit-conversions.listConversions`, `units.listUnits`, `warehouses.listWarehouses` |
| organization (4) | `branches.listBranches`, `departments.listDepartments`, `employees.listEmployees`, `parties.listParties` |
| workflow (9) | `workflow-approvals.listApprovals`, `workflow-automations.listAutomations`, `workflow-definitions.listDefinitions`, `workflow-instances.listInstances`, `workflow-instances.listAvailableTransitions`, `workflow-instances.listHistory`, `workflow-states.listStates`, `workflow-transitions.listTransitions`, `workflow-versions.listVersions` |

| Module | Detail surfaces without the chokepoint (structural `organizationId` match only) |
|---|---|
| documents (3) | `document-relations.getRelation`, `numbering-series.getNumberingSeries`, `numbering.getAllocation` |
| workflow (6) | `workflow-{automations,definitions,instances,states,transitions,versions}.get*` (each via a private `mustFindInOrganization` that compares `row.organizationId !== organizationId` and nothing else) |

**Exposure.** With `DEPLOYMENT_ORGANIZATION_ID` **unset** (the default — the variable appears in
neither `.env.example` nor `docker-compose.yml`), the global pin guard is a no-op and the
membership binding is the only boundary. A principal holding, say, `Inventory.Item.View` in
Org A can then read Org B's items by changing one query parameter. With a pin **set**, the global
`APP_GUARD` blocks a foreign `organizationId` in the query/body at HTTP level, so a
single-organization deployment is protected against this class *through the pin only* — not
through ODR-3, and not for any direct service caller.

**Relation to the recorded backlog.** Task 24's finding **F-2** records this class for the four
Accounting list surfaces only (`docs/tasks/task-24/task-24-scope-design-gate.md`,
`docs/roadmap/backend-mvp-roadmap.md` §6.1, `future-task-candidates.md` C-06). This audit finds
the same class on **33 further surfaces across inventory, organization, workflow and documents**.

**Classification:** **F6 — Security remediation required** (+ **F1** for the `docs/security.md`
wording and **F5** for the implementation task). Fixing it changes an existing API contract
(200-with-foreign-rows / empty page → 404) and therefore requires explicit Owner approval exactly
as Task 24's R-2 did. **Task 25 does not fix it** (production capability is prohibited).
Carried as Owner decision **D-01**.

### SEC-02 — **HIGH** — a security-relevant governance record is factually wrong (Task 24 F-3)

`docs/tasks/task-24/task-24-scope-design-gate.md` §F-3 and
`docs/tasks/task-24/task-24-implementation-report.md` §0/#3 state: *“**No global pin guard
exists** (`app.module.ts` registers no `APP_GUARD`)”*, and conclude that a spec comment claiming
one is *“wrong”*. **`backend/src/modules/organization/organization.module.ts:81` registers
`{ provide: APP_GUARD, useClass: DeploymentOrganizationScopeGuard }`**, and `OrganizationModule`
is imported by `AppModule` — Nest applies such a provider globally. The spec comment is correct
and F-3 is not. The reasoning attached to F-3 (that the missing `listAccounts` call also bypassed
the deployment pin) is therefore true only at the *service* layer, not on the HTTP surface.
**Classification: F1 — documentation-only correction** (the correction itself is an Owner decision
because it edits an accepted-pending governance record → **D-02**).

### SEC-03 — **LOW (resolved by this task)** — stale authorization comment

The `MEMBERSHIP` comment in `organization-permissions.ts` asserted the superseded pre-PR-#55 rule.
**Corrected here, comment-only** (§9). **Classification: F1 — done.**

### Security controls VERIFIED as consistent with the accepted decisions

| Control | Verified evidence |
|---|---|
| Fail-closed authorization | `rbac/application/authorization.guard.ts` throws when permission metadata is missing |
| No wildcard / superuser / implicit bypass (OQ-21) | no `*` code in any registry; the bootstrap role is an ordinary role holding the enumerated 134 codes |
| Two-layer enforcement (route guard + service re-check) | every audited service method begins with `requireAllPermissions([...])` |
| Non-disclosure posture | scope failures answer `AppException.notFound('Organization', id)` → 404, never 403 |
| Membership administration is organization-bound | `authorizeMembershipAdministration` with the single first-member bootstrap exception, `hasAnyMember` probe; 17 unit tests + HTTP suite |
| Sessions | opaque 256-bit tokens, SHA-256 at rest, Argon2id passwords, idle/absolute expiry, revocation |
| Immutability of the ledger | `accounting.ledger_entries` has no update/delete path; corrections are reversal documents (Task 15) |
| Cross-module boundaries | no module reads another module's Prisma tables; verified by import inspection |
| Denial logging | denials logged with actor/codes/route/correlation id; **no Audit module exists** — documented as such, not overstated |

---

## 12. MVP scope verification (task spec §16)

`docs/roadmap/backend-mvp-roadmap.md` §2 records the **Owner-directed scope correction of
2026-09-27**, and this audit confirms the repository is consistent with it:

- **IN MVP:** Foundation · Accounting + Accounting Completion · Party/Customer · Full
  Inventory/Warehouse · Sales · Inventory Effects · Inventory → Accounting · Sales → Accounting ·
  Operational Reporting · Electronic Books / Tax Accounting.
- **OUT (post-MVP):** Purchasing · Purchasing → Accounting · Purchasing Reports · **Treasury**.
- **Treasury is NOT present** in `main` in any form: no module, schema, migration, endpoint,
  permission or cash/bank semantics on `accounting.accounts` (verified by search). It is **not**
  reintroduced by this audit.
- **Purchasing is NOT an implicit dependency of Inventory Receipt/Issue.** No purchasing artifact
  exists; the inventory movement model is self-contained. Warehouse Receipt/Issue remain Inventory
  documents. Nothing in this audit changes that.

---

## 13. CI and test evidence

| Evidence | Value |
|---|---|
| Baseline CI on the audited commit | run **`36323517204`** on `80944ce` — **success** (`backend` + `frontend`) |
| Task 24 (PR #67) | implementation run `36306140879`; PR-head checks `36306360274` — success |
| Task 23 (PR #66) | PR-head checks `36298005115` — success |
| Task 19 / PR #55 | run `36238862315` — success (unit: 101 files / 1148 tests at the time) |
| Task 18 (PR #46) | run `36133360887` — success |
| Backend CI gates | prisma validate → generate → lint → typecheck → format:check → unit → build → `migrate deploy` → `bootstrap:system-admin` → migration rehearsal → E2E (`timeout 540`, incl. live-PostgreSQL suites) |
| Frontend CI gates | lint → typecheck → format:check → test → build (no database, no API) |
| Not executed in CI | `npm run test:operational-freeze-rehearsal` (Task 13) — the script exists but is not a configured step |
| **Not executed locally by Task 25** | `npm test`, `npm run test:e2e`, `npm run build` — `backend/node_modules` is absent in this sandbox and the task's §11 policy prefers CI for expensive suites. The only production change is comment-only; verification is delegated to the branch's CI run (recorded in the implementation report) |
| Branch protection requirements | **UNKNOWN — REQUIRES OWNER CONFIRMATION** (BOOT-OQ-04) |

---

## 14. Unresolved issues carried forward

| # | Item | Class |
|---|---|---|
| U-01 | SEC-01 — ODR-3 binding missing on 37 read surfaces | F6 / F5 |
| U-02 | SEC-02 — Task 24 F-3 is factually wrong; its repetitions inherit the error | F1 |
| U-03 | Four work items merged without acceptance (Bootstrap SysAdmin, Task 23, Task 24, roadmap PR #69) | F2 |
| U-04 | Task 13 / Task 14 merged, recorded NOT ACCEPTED | F2 |
| U-05 | Task 15 merged with **no** governance record at all | F2 |
| U-06 | Task 12's invalid “ACCEPTED WITH FOLLOW-UP” label + open P1 real-PostgreSQL concurrency verification | F2 / F7 |
| U-07 | Seven ADRs Proposed while implemented (0017–0021, 0031, 0032) | F3 |
| U-08 | Eighteen+ load-bearing OQs OPEN, notably OQ-25/36/39/41/43 | F4 |
| U-09 | Operational-freeze rehearsal is not a CI step | F7 |
| U-10 | Branch-protection required checks UNKNOWN | F2 |
| U-11 | `docs/accounting/domain-contract.md` header still says Proposed/no-implementation (BOOT-R-10) | F1 |
| U-12 | Task 16 implementation authorization remains BLOCKED; Task 17 umbrella remains BLOCKED | F2 / F4 |

---

## 15. Owner decisions required

Isolated, with options and framing, in [owner-decision-pack.md](./owner-decision-pack.md):
**D-01 … D-10** (all `Owner decision: PENDING`). None is decided here.

---

## 16. Recommended next implementation gate

> The recommendation is evidence-based and does **not** authorize anything.

**Recommended next gate: `ODR-3 list-scope completion` — an Owner-approved, bounded security
correction task extending the accepted ODR-3 chokepoint to the 37 organization-scoped read
surfaces identified in SEC-01** (the roadmap's item 6.1 / candidate C-06, widened by this audit
from 4 surfaces to 37).

| Dimension | Verdict |
|---|---|
| Technical readiness | **READY** — the mechanism exists, is accepted (Task 19), and has a shipped precedent (Task 24 R-2: one statement + regression tests, no schema, no new permission) |
| Governance readiness | **OWNER DECISION REQUIRED** — it changes an existing API contract (200/empty page → 404) on surfaces the accepted frontend consumes as scope pickers; Task 24's R-2 set the precedent that such a change needs explicit approval (**D-01**) |
| Type of work | **IMPLEMENTATION REQUIRED** (application-layer only; no migration, no schema, no API shape change, no new permission) |
| Blocking dependencies | None technical. Governance: the Owner should also settle the outstanding acceptance decisions **D-04…D-06** so the next task starts from a clean baseline |

**Sequenced recommendation**

| Order | Gate | Classification |
|---|---|---|
| 1 | **D-04 / D-05 / D-06** — Owner acceptance decisions for Bootstrap SysAdmin, Task 23, Task 24 (and this Task 25) | **DOCUMENTATION ONLY** (Owner act) |
| 2 | **ODR-3 list-scope completion** (SEC-01) | **OWNER DECISION REQUIRED → then IMPLEMENTATION REQUIRED** |
| 3 | Documentation corrections DR-02/DR-03/DR-04 (F-3 retraction, F-2 rescoping, stale gate text) | **DOCUMENTATION ONLY** |
| 4 | Base Chart **content** / control roles | **BLOCKED** — OQ-25 content values, OQ-41, OQ-36 prerequisites |
| 5 | Any Inventory → Accounting or Sales → Accounting integration | **BLOCKED** — OQ-39 (durable integration semantics), OQ-42, OQ-24 |

---

## 17. Follow-up classification of every finding (task spec §13)

| Finding | Class |
|---|---|
| SEC-01 ODR-3 list/detail scope gap (37 surfaces) | **F6** (+ F5 for the task, F1 for the `security.md` wording) |
| SEC-02 Task 24 F-3 false claim | **F1** |
| SEC-03 stale membership comment | **F1 — completed by this task** |
| DR-03 F-2 recorded scope understated | **F1** |
| DR-04 stale Task 24 gate text about missing Task 23 rows | **F1** |
| DR-05 `STATE.md` §8 “no Task 25” | **F1 — completed by this task** |
| DR-07 accounting contract header | **F1** |
| Bootstrap SysAdmin / Task 23 / Task 24 / roadmap acceptance | **F2** |
| Task 13 / 14 / 15 governance status | **F2** |
| Task 12 label + P1 concurrency | **F2** + **F7** |
| ADR-0017/0018/0019/0020/0021/0031/0032 backlog | **F3** |
| ADR-0029/0030/0033–0037 adoption gates | **F3** |
| OQ-23/24/25/27/30/34/35/36/38/39/40/41/42/43/49/54/62/63 | **F4** |
| Operational-freeze rehearsal not in CI | **F7** |
| Branch protection UNKNOWN | **F2** |
| Base Chart four invariants preserved | **F8** |
| Treasury/Purchasing absence consistent with MVP boundary | **F8** |
| Numeric inventory (17/46/52/134/107/34) consistent | **F8** |

---

## 18. Statement of limits

- The checkout is **shallow**; ancestry and historical CI claims are transcribed from GitHub PR
  metadata and existing records, not re-executed.
- No runtime verification was performed by this task: `backend/node_modules` is absent, and the
  task's CI policy (§11) prefers GitHub CI for expensive suites.
- SEC-01 was established by **static call-graph analysis plus manual confirmation of samples**
  (`branches.listBranches`, `items.listItems`, `financial-areas.listFinancialAreas`,
  `accounting-periods.listAccountingPeriods`, `coding-structures.listVersions`,
  `workflow-definitions.mustFindInOrganization`). It is a code-reading result, not a penetration
  test. A remediation task must re-verify each surface with a test before changing it.
- This report accepts nothing, promotes nothing, closes nothing.
