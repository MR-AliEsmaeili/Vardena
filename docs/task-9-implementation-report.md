# Task 9 — Workflow Foundation: Implementation Report

Date: 2026-09-12 · Branch: `arena/01a096e9-vardena` · Base: `1bc0327`

---

## 1. Implemented

### Entities (8 tables, 1 new PostgreSQL schema)

| Schema | Table | Notes |
|---|---|---|
| `workflow` | `workflow_definitions` | org-scoped unique `code`; the workflow identity |
| `workflow` | `workflow_versions` | `draft → active → superseded`; unique `(definition_id, version_number)` |
| `workflow` | `workflow_states` | unique `(version_id, code)`; `is_initial` / `is_terminal` flags |
| `workflow` | `workflow_transitions` | explicit source/target FKs; unique `(version_id, code)`; bounded condition columns |
| `workflow` | `workflow_instances` | logical entity binding `(entity_module, entity_type, entity_id)`; unique; pins `version_id` |
| `workflow` | `workflow_transition_history` | append-only; 1-based `sequence` per instance; unique `(instance_id, sequence)` |
| `workflow` | `workflow_approvals` | single-level; `base_sequence` staleness pin |
| `workflow` | `workflow_automation_bindings` | unique `(transition_id, action)`; actions are code-registered, never stored code |

All 27 foreign keys are `ON DELETE RESTRICT ON UPDATE CASCADE`. There are no
FKs from `workflow` into any business schema — bindings are logical references
(ADR-0024 §2). Closed code-defined lists (statuses, code formats) are TEXT with
no CHECK constraints, the same decision Tasks 6/7/8 made (AR-24: rules live in
the framework-free domain layer and are unit-tested).

### Module

**`workflow`** — domain (11 files + 6 specs) / data (11) / application (10) /
api (7 controllers + 7 DTO files). Registered in `AppModule`; imports the RBAC,
Organization and (forward-ref) Identity modules.

### API (all under `/api/v1/workflow`, OpenAPI-documented — 18 paths)

- `/definitions` — `GET` (list), `POST`, `GET /:id`, `PATCH /:id`
- `/definitions/:definitionId/versions` — `GET`, `POST`
- `/versions/:id` — `GET`; `/versions/:id/publish` — `POST → 200`
- `/versions/:versionId/states`, `/states/:id` — `GET`, `POST`, `GET`, `PATCH`, `DELETE → 204`
- `/versions/:versionId/transitions`, `/transitions/:id` — same five
- `/instances` — `GET`, `POST` (bind); `/instances/:id` — `GET`
- `/instances/:id/available-transitions` — `GET` (state + permitted preview)
- `/instances/:id/transitions` — `POST → 200` (execute)
- `/instances/:id/history` — `GET` (append-only: no `PUT`/`PATCH`/`DELETE` exists)
- `/instances/:instanceId/approvals` — `GET`, `POST` (request)
- `/approvals/:approvalId/decide` — `POST → 200`
- `/transitions/:transitionId/automations`, `/automations/:id` — `GET`, `POST`, `GET`, `PATCH`, `DELETE → 204`

Conventions: collection POSTs (`definitions`, `instances`) carry
`organizationId` in the body; every route with path parameters takes it as a
query parameter. Response dates are ISO strings (the branch/documents
convention). There is deliberately NO `PATCH /versions/:id` (versions are
immutable; behaviour changes ship as a new version) and no state `code` /
transition endpoint updates (verified: unknown properties → 400 via
`forbidNonWhitelisted`).

### Authorization

10 permission codes registered at startup through the existing
`PermissionRegistry` and mirrored to `rbac.permissions` by the existing
`PermissionSyncService`:

- `Workflow.Definition.{View,Create,Edit}` — 3
- `Workflow.Version.{View,Create,Edit,Publish}` — 4
- `Workflow.Instance.{View,Bind,Execute}` — 3

Endpoint guards check these codes; execution additionally requires the
transition's OWN `required_permission` (any registered RBAC code), re-checked
in the service layer (AR-04/AR-21). Approval decisions require the effective
approval permission (explicit `approval_permission`, else the transition
permission). No wildcard, no superuser, no bypass code (OQ-21) — asserted by
`workflow-permissions.spec.ts` over all 10 codes and proven end-to-end by the
operator journey (§5).

### Domain events (existing bus, no second architecture)

`WorkflowVersion.Published`, `WorkflowInstance.Bound`,
`WorkflowTransition.Completed`, `WorkflowApproval.Decided` — published on the
kernel `DomainEventBus` with ambient correlation ids. The Completed event
carries the transition's enabled automation bindings as
`[{ action, parameters }]` (v1 reports, never runs — ADR-0024 §8).

---

## 2. Architectural Decisions

1. **Logical binding, not a universal documents table.** Task 9 §6's "bind any
   entity" is satisfied by `(entity_module, entity_type, entity_id)` with a
   ULID id — no cross-module FKs, no coupling (ADR-0024 §2, ADR-0019 prior art).
2. **Draft checks happen twice.** The service pre-checks draft status for a fast
   422; every config-write transaction re-checks under the version lock and a
   lost race surfaces as 409 (`WorkflowVersionLockedError`). Same pattern as
   publish-vs-configure and transition-vs-transition: races are retryable, never
   silent.
3. **Stale approvals fail, never authorize.** `base_sequence` pins each request
   to its history length; the request path maps `not_in_source_state` to 422
   (fresh validation) while the execute path maps it to 409 (lost race) — the
   same problem, different caller semantics.
4. **The `available-transitions` preview is advisory.** `permitted` is computed
   from effective codes for UI rendering; enforcement always happens at
   execution (and in the locked transaction, which re-validates everything
   including `actorPermitted` as defense in depth).
5. **Automation catalogue starts empty.** Task 9 registers zero actions; the
   mechanism (registry → binding → event envelope) is exercised by tests with a
   fixture action. Executing effects via outbox/worker is future work.
6. **In-memory e2e doubles mirror contracts, not mechanisms.** The fakes honour
   unique violations, draft re-checks and serialized transactions (via a
   promise-chain mutex); real `SELECT … FOR UPDATE` behaviour is proven by the
   live suite. Both suites assert the same observable outcomes.
7. **No new ADR beyond ADR-0024.** The design decisions were already taken in
   ADR-0018; ADR-0024 records only the implementation binding (AR-29).

---

## 3. Open Questions

None opened by this task. Touched, unchanged:

- **OQ-21** (no wildcard/bypass) — upheld; asserted by test.
- **OQ-26** (multi-level approval, delegation) — stays out; single-level only.
- **OQ-01/OQ-22** (caller-supplied `organizationId`) — same exposure as Tasks
  6–8; must be closed before multi-tenant use (§6.1).
- **OQ-20 pattern** (registered actions never removed at runtime) — followed by
  `AutomationActionRegistry` (no removal API).

---

## 4. Files Changed

Modified (3):

- `backend/prisma/schema/base.prisma` — `workflow` added to `schemas`
- `backend/prisma/schema/organization.prisma` — 8 back-relation arrays on `Organization`
- `backend/src/app.module.ts` — `WorkflowModule` registered

Added (52):

- `backend/prisma/schema/workflow.prisma` + `backend/prisma/migrations/20260912010000_workflow_foundation/migration.sql`
- `backend/src/modules/workflow/` — 45 files (domain 17 incl. 6 specs, data 11,
  application 10, api 14 incl. 7 DTO files, `workflow.module.ts`)
- `backend/test/workflow.e2e-spec.ts` (29 tests), `backend/test/workflow-live.e2e-spec.ts`
  (4 tests), `backend/test/support/workflow-repositories.ts` (in-memory doubles)
- `docs/adr/0024-workflow-foundation.md`, this report, §10 of
  `docs/architecture/domain/workflow-architecture.md`

No applied migration was edited (AR-10). No kernel file was touched (AR-06).

---

## 5. Validation — actual results

| Gate | Command | Result |
|---|---|---|
| Lint | `npx oxlint .` | **0 warnings, 0 errors** on 333 files |
| Format | `npx prettier --write` on touched files | clean |
| Typecheck | `npx tsc --noEmit` | **clean**, no output |
| Unit | `npm run test` | **51 files, 541 tests passed** (of which workflow: 6 files / 74 tests) |
| E2E | `npm run test:e2e` | **10 files passed, 135 tests passed, 11 skipped** (of which workflow: 29 passed; the 4 workflow-live skips need `VARDENA_TEST_DATABASE_URL`) |
| Build | `npm run build` (`nest build`) | **exit 0** |
| OpenAPI | app booted, `GET /api/docs-json` | **200**; 94 paths total, **all 18 `/workflow/` paths present** |
| Migration DDL | all 8 migrations in order on PGlite | `ALL MIGRATIONS APPLIED CLEANLY`: **8 tables, 27 indexes, 27 FKs — all `ON DELETE RESTRICT` + `ON UPDATE CASCADE`**, 7 unique indexes |

The e2e suite covers the Task 9 §20 journey list: definition/version/state/
transition lifecycles, publish validation, the full publish freeze (all 9
config writes → 422, reads → 200), version supersession with pinned bindings,
bind/rebind rules, available-transitions preview, execution (happy path, wrong
source → 409, wrong version → 422, missing comment → 422), history pagination,
the approval journey (request → approve → execute, duplicate → 409, rejected
unusable, stale decide → 422), automation bindings (unknown action → 422,
envelope on the Completed event), terminal behaviour, concurrent A→B vs A→C
(one 200 + one 409, exactly one history row), org isolation (every row type →
404 cross-org), and the authorization surface (anonymous → 401, viewer writes →
403, operator Publish-gated execute → **403 from the service layer**).

### Prisma validation — and its honest limits

`prisma validate`, `prisma format` and `prisma migrate diff` **could not be run
in this sandbox.** They fail downloading the schema engine from
`binaries.prisma.sh` (`Client network socket disconnected before secure TLS
connection was established`); `@prisma/engines/` ships no binaries here. There
is no local `psql`, `postgres`, `pg_ctl`, `initdb` or `docker` either, and no
`VARDENA_TEST_DATABASE_URL` — so the live suite (real row locks, real publish
race) is **skipped here and must run in CI**.

What was run instead (same approach as Task 6 §5): all eight migration files,
in order, against an in-memory **PGlite** database (PostgreSQL 17.x compiled
to WASM, already present as a transitive dependency) — see the table above.

**This is not `prisma migrate deploy` and must not be reported as
Prisma-verified.** Two things it does not prove: (a) that
`prisma migrate diff` finds zero drift between the Prisma schema and the
hand-written DDL, and (b) that the real Prisma engine accepts the schema (the
Task 6 addendum shows this check catches real P1012 errors). Mitigation
applied: the 8 `Organization` back-relation arrays required by the new models
were added, relations were manually cross-checked both directions, and every
constraint name follows the existing migrations' pattern. Both checks are
follow-up §6.2.

---

## 6. Risks & Follow-ups

1. **`organization_id` is not enforced against the caller** (same as Tasks
   6–8). Any principal holding the permission may pass any `organizationId`.
   Must be closed by binding principals to organizations before any
   multi-tenant use (OQ-01/OQ-22, ADR-0021).
2. **Prisma schema↔DDL drift is unverified** (see §5). Highest-priority
   follow-up: run `prisma validate`, `prisma migrate diff` and the
   `workflow-live` suite in a networked CI job with Postgres.
3. **Events are in-memory only.** The transition Completed event is the seam a
   future dispatcher will consume; until dispatch moves behind the outbox
   (AR-14), a crash between commit and consumption loses the effect. No v1
   consumer exists, so nothing is lost today — but the first consumer must
   close this before automations execute effects.
4. **Disabled transitions are publishable.** `planPublish` validates enabled
   transitions only; a disabled transition can ship in an active version and
   fails at execution with 422. Deliberate (disable is a kill-switch, not a
   draft state) but worth knowing when reading version contents.
5. **No integrity job for orphan bindings.** A binding whose business entity was
   deleted (through a bug — no API deletes bound entities today) is detectable
   only by a periodic report, as with ADR-0019 links. No job exists yet.

---

## 7. Final Review Checklist

| # | Question | Answer |
|---|---|---|
| 1 | Did you inspect the repository before changing code? | Yes — kernel, all modules, migrations, ADRs, domain docs, test support and configs before the first edit. |
| 2 | Did you follow AR-02 module anatomy? | Yes — `domain/`, `data/`, `application/`, `api/` in the new module. |
| 3 | Are controllers transport-only (AR-03)? | Yes — guards + DTO mapping only; no business logic, no Prisma. |
| 4 | Are use cases in application services (AR-04)? | Yes — all 7 services; authorization is the first statement of every use case. |
| 5 | Is the domain framework-free (AR-05)? | Yes — no Nest imports in any `domain/` file; the 74 domain specs run without a Nest context (vitest unit config). |
| 6 | Is `kernel/` still technical-only (AR-06)? | Yes — no kernel file was touched. |
| 7 | Do modules cross only via public services (AR-07)? | Yes — Organization via `OrganizationsService`, RBAC via `AuthorizationService`/`PermissionRegistry`, Identity via forward-ref; business entities referenced logically, never read. |
| 8 | One schema per module (AR-09)? | Yes — `workflow`. |
| 9 | Migration-only schema changes (AR-10)? | Yes — 1 new migration; no applied migration edited. |
| 10 | Standard entity columns (AR-12)? | Yes — `created_at`, `updated_at`, `created_by`, `updated_by` on all 8 tables (plus `occurred_at` on history, `requested/decided` stamps on approvals). |
| 11 | Soft delete (AR-13)? | Not applicable — definitions use `is_active`; versions/instances/history are never deleted by design. |
| 12 | Outbox (AR-14)? | No external delivery in Task 9; events use the in-process bus. The gap is recorded in ADR-0024 and §6.3. |
| 13 | Authorization in the service, not just guards (AR-21/22)? | Yes — guard + service re-check on both the workflow permission and the transition's own permission; proven by the operator e2e (guard passes, service returns 403). |
| 14 | Audit (AR-23)? | Actor ids + correlation ids persisted on history/approvals; 4 event types published with correlation ids. |
| 15 | Validation (AR-24)? | DTOs never expose Prisma models; dates/names normalized in services; whitelist + `forbidNonWhitelisted`; no hash/actor leakage. |
| 16 | OpenAPI (AR-26)? | Yes — `/api/docs-json` returns 200 with all 18 workflow paths. |
| 17 | ADR only for genuinely new decisions (AR-29)? | Yes — exactly one, ADR-0024, for the implementation binding the migration header references. |
| 18 | Are ULIDs used for PKs? | Yes, generated in the application layer (`generateId()`), never DB defaults; entity ids must be ULIDs (DTO + domain validated). |
| 19 | UTC timestamps? | Yes — `timestamptz(6)`, `DEFAULT CURRENT_TIMESTAMP`. |
| 20 | No `*` / SuperAdmin / wildcard permissions? | None — asserted by `workflow-permissions.spec.ts` over all 10 codes. |
| 21 | No universal documents table / cross-module table coupling? | None — 8 workflow-owned tables; entity binding is `(module, type, id)` with no FK. |
| 22 | Did you invent business rules? | No. Every rule traces to Task 9 / ADR-0018 / `workflow-architecture.md` D-15…D-18; judgement calls (§2) are recorded above and in code comments. |

**Not done (out of scope, correctly):** Accounting/Inventory/Sales/Purchasing
workflows, multi-level approval, delegation/escalation, a rules/scripting
engine, a workflow designer UI, executing automations (outbox/worker),
Redis/microservices, per-state or per-transition RBAC entities.
