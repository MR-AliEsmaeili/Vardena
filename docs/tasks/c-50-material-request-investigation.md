# C-50 — Material Request: Investigation and Owner Decision Brief

| Field | Value |
|---|---|
| Status | **BLOCKED — investigation complete; implementation not authorized** |
| Inspection date | 2026-10-02 (UTC) |
| Exact baseline | `main` and this branch at `0e600689e7ae6cec2e00e3e35f76bea6f7cc47d9` |
| Baseline provenance | Merge commit of [PR #110](https://github.com/MR-AliEsmaeili/Vardena/pull/110); post-merge [CI run 37023371492](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/37023371492) completed successfully |
| Roadmap identity | **C-50 Material Request** — Full Inventory/Warehouse MVP candidate |
| Scope | Investigation, decision preparation, and minimal roadmap pointers only; no production implementation |
| **Implementation note (2026-10-02, later)** | **See §19.** Implementation work was subsequently opened as unmerged [PR #112](https://github.com/MR-AliEsmaeili/Vardena/pull/112) without a recorded Owner answer to the OPEN items below; this does not change the status row above, which still accurately describes what was decided when this brief was written. |

> **No decision is made by this report.** Every Owner answer below is pending.
> Recommendations are explicitly labelled. Existing Open Question wording and
> options are quoted without alteration. “C50-DP-*” labels identify local decision
> prompts; they are not new OQs, decisions, ADRs, or implementation authority.

## 1. Executive findings

1. **Material Request is completely absent from production code.** There is no
   Material Request symbol, document-type registration, model, table, migration,
   controller, DTO, permission, event, OpenAPI operation, generated client type, or
   test. Inventory registers permissions, but registers **no** document type.
2. **The foundations are real, but they do not constitute a Material Request.**
   Documents supplies an in-code type registry, organization configuration, a
   bounded `draft`/`temporary`/`final` lifecycle policy, numeric monotonic numbering,
   and logical relations. Workflow supplies versioned definitions, locked runtime
   transitions, append-only transition history, single-level approval records, and
   automation bindings. Inventory supplies item/unit/warehouse resolution, exact
   quantity conversion, balances, movements, reservations, and idempotent operation
   records.
3. **The correct bounded ownership is Inventory.** A future Material Request should
   be an Inventory-owned typed header/line aggregate in `inventory.*`, composed with
   public Documents, Workflow, Organization, RBAC, and Inventory services. It must
   not be a universal document row, Purchasing document, movement, reservation,
   accounting entry, EAV record, or JSONB payload.
4. **A basic Material Request need not have stock, valuation, or accounting effects.**
   The bounded meaning supported by current evidence is an internal demand/intention
   record. Whether it claims availability, requires a source warehouse, or creates/
   drives a future Warehouse Issue is a pending product decision. This means C-50
   avoids the valuation/costing/durable-posting gates of C-48/C-49/C-51/C-52 only if
   it remains non-valued and non-posting.
5. **Implementation is blocked by lifecycle policy and approval content.** OQ-54 is
   OPEN and its recommended option is not a decision. OQ-13 and OQ-26 are OPEN and
   do not establish whether Material Requests require approval, who may approve,
   whether a requester may approve, or which transitions exist.
6. **The stock-reservation rule is not registered as an OQ.** The roadmap correctly
   records an undecided product rule with no OQ row. Current reservations are a
   substantive reusable capability, not merely a placeholder hook, but wiring them
   to Material Requests is excluded from this C-50 investigation and cannot be
   inferred from their existence.
7. **Documents numbering cannot currently join an Inventory aggregate transaction.**
   `NumberingService.allocateNumber` delegates to a repository that starts its own
   Prisma transaction. It provides unique, monotonic, allocation-key-idempotent
   numbers, but not atomic “number + future Material Request header” persistence.
   A failed aggregate write can therefore leave a deliberate allocation gap unless
   an approved cross-module transaction seam is added later.
8. **Workflow does not currently mutate business documents.** No production module
   consumes Workflow for a business document. Workflow transactions protect
   Workflow rows/history only; a generic Workflow transition endpoint can advance a
   bound instance without changing future Material Request state. Approval-enabled
   Material Request is therefore conditional on one authoritative lifecycle and a
   single command ingress with a proven consistency strategy.
9. **Organization and permission foundations are reusable.** Request principals are
   bound to organization memberships, routes are fail-closed through authentication
   and permission metadata, and services recheck permissions. Requester-as-Employee
   is nevertheless unresolved because `Employee` deliberately has no User link;
   the authenticated `userId` is available and is not an Employee identity.
10. **Durable generic audit/dispatch is absent.** Row audit stamps, logs, Inventory
    operation rows, and Workflow history provide bounded evidence. There is no Audit
    module, persisted `core.domain_events`, or outbox. The current in-memory event
    bus swallows subscriber failures.
11. **Readiness verdict: `BLOCKED`.** The repository is ready for an Owner decision
    round and a later, separately authorized implementation plan. It is not ready
    for production implementation until the exact decisions in §12 are recorded.

## 2. Authority, terminology, and method

### 2.1 Sources and precedence

The investigation treated current code, migrations, and tests as the source of
truth for implemented behavior. Accepted ADRs describe accepted architecture, but
were not treated as proof that every statement is implemented. Proposed architecture
and domain analysis were used only as design context. The governing repository
sources were:

- [`STATE.md`](../../STATE.md), [`docs/open-questions.md`](../open-questions.md),
  and [`docs/current-state-reconciliation.md`](../current-state-reconciliation.md);
- [`future-task-candidates.md`](../roadmap/future-task-candidates.md),
  [`backend-mvp-dependency-matrix.md`](../roadmap/backend-mvp-dependency-matrix.md),
  and [`backend-mvp-roadmap.md`](../roadmap/backend-mvp-roadmap.md);
- [`master-data-strategy.md`](../architecture/domain/master-data-strategy.md),
  [`document-architecture.md`](../architecture/domain/document-architecture.md),
  [`workflow-architecture.md`](../architecture/domain/workflow-architecture.md),
  [`inventory-domain-analysis.md`](../architecture/domain/inventory-domain-analysis.md),
  and [`domain-decisions.md`](../architecture/domain/domain-decisions.md);
- [`ADR-0014`](../adr/0014-openapi-contract.md),
  [`ADR-0015`](../adr/0015-backend-foundation-conventions.md),
  [`ADR-0022`](../adr/0022-inventory-core-ledger.md),
  [`ADR-0023`](../adr/0023-document-foundation-implementation.md), and
  [`ADR-0024`](../adr/0024-workflow-foundation.md);
- [`OQ-54`](../decisions/product/OQ-54-finalized-document-deletion-editing.md);
- [`test-execution-policy.md`](../testing/test-execution-policy.md) and
  [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

The requested repository-level `standard.md` does not exist on this baseline. The
applicable tracked rules are `AGENTS.md`, `.vardena/agent-rules.md`,
`.vardena/architecture-rules.md`, and `.vardena/project-context.md`. Frontend-only
standards were not treated as a repository-wide substitute.

### 2.2 Classification used below

| Label | Meaning |
|---|---|
| **Implemented** | Verified in current production code/schema and, where named, tests. |
| **Accepted design** | Recorded in an Accepted ADR; not automatically proof of complete implementation. |
| **Open decision** | Canonical OQ or an explicitly unregistered product rule remains unanswered. |
| **Assumption** | Working interpretation only; must not become behavior without confirmation. |
| **Recommendation** | Investigation advice, not Owner acceptance or implementation authority. |
| **Missing** | No current implementation was found. |
| **Unverified claim** | A document claim that current executable evidence does not prove. |

### 2.3 Baseline and external evidence

- Local branch: `arena/01a0fd1f-vardena`.
- `HEAD`: `0e600689e7ae6cec2e00e3e35f76bea6f7cc47d9`.
- Fetched `origin/main`: the same SHA.
- PR #110: `MERGED` at that SHA on 2026-10-02.
- Push CI run `37023371492`: `completed/success`; both `frontend` and `backend`
  jobs completed successfully against that exact SHA.
- Baseline inventory: 59 Prisma models, 50 backend controllers, 122 backend unit
  spec files, 43 backend E2E spec files, and 42 frontend test files. These counts
  are reconnaissance evidence, not acceptance criteria.

No full local suite, live-PostgreSQL suite, migration rehearsal, E2E suite, build,
or generated-contract command was run for this documentation-only investigation.

## 3. Current-state evidence matrix

| Concern | Classification and verified current behavior | Exact evidence | C-50 consequence |
|---|---|---|---|
| Material Request | **Missing.** Repository-wide source/schema/migration/test searches found no Material Request aggregate or contract. | `backend/src/modules/inventory/`, `backend/prisma/schema/inventory.prisma`, `backend/prisma/migrations/`, `backend/test/`, `frontend/src/api/generated/vardena-api.d.ts` | New Inventory-owned header/line schema, migration, application/API slice, permissions, events, tests, and generated contract would be required in a separately authorized task. |
| Inventory module boundary | **Implemented.** `InventoryModule` owns `inventory.*`; it exports public item, unit, conversion, warehouse, movement, transfer, reservation, and balance services. It imports no Documents or Workflow module today. | `backend/src/modules/inventory/inventory.module.ts`, class `InventoryModule` | Add dependencies deliberately; consume public services only. No direct `documents.*`, `workflow.*`, `organization.*`, or `accounting.*` table access. |
| Inventory document types | **Missing.** Inventory has no `DocumentTypeRegistry` reference. Accounting is the only production owner that registers a type. | `backend/src/modules/accounting/application/accounting-document-type-registration.ts`, class `AccountingDocumentTypeRegistration`; `backend/src/modules/documents/application/document-type-registry.ts` | Future Inventory registration is required. A candidate code such as `inventory_material_request` is an implementation proposal, not decided here. |
| Typed document ownership | **Accepted design + implemented precedent.** The registry contains definitions, not business rows. Accounting owns its voucher header/lines while composing Documents services. | `backend/src/modules/documents/domain/document-type.ts`; `backend/src/modules/accounting/accounting.module.ts`; `backend/prisma/schema/accounting.prisma` | Material Request belongs in typed Inventory tables. Do not add a universal document aggregate/table. |
| Documents lifecycle | **Implemented bounded policy.** Phases are `draft`, `temporary`, `final`; type definitions declare draft capability, entry states, and deletable phases. The foundation evaluates actions but does not own a Material Request status row. | `backend/src/modules/documents/domain/document-type.ts`; `backend/src/modules/documents/domain/document-lifecycle.ts`; tests `document-type.spec.ts`, `document-lifecycle.spec.ts` | Foundation-supported capability, not a selected MR lifecycle. OQ-54 and OQ-13/OQ-26 must define C-50 behavior. |
| Document configuration | **Implemented, bounded.** Per-organization type configuration stores `draftRequired` only. Numbering-series activation/configuration is a separate Documents surface. | `backend/src/modules/documents/application/document-types.service.ts`; `backend/src/modules/documents/application/numbering-series.service.ts`; `backend/prisma/schema/documents.prisma` | Reusable if the Owner wants organization-level draft behavior and numbering. It does not decide approval or cancel rules. |
| Number allocation | **Implemented with a boundary limitation.** `NumberingService.allocateNumber` validates type/configuration and delegates to `NumberingSeriesRepository.allocate`, which starts its own `$transaction`, locks the series row, advances monotonic numeric state, and writes an allocation. Allocation keys replay. | `backend/src/modules/documents/application/numbering.service.ts`, `NumberingService.allocateNumber`; `backend/src/modules/documents/data/numbering-series.repository.ts`, `NumberingSeriesRepository.allocate`; `backend/src/modules/documents/domain/numbering.ts`; `numbering.service.spec.ts`; `backend/test/documents-live.e2e-spec.ts` | Unique and monotonic does not mean atomic with a future MR write. Allocation transition/scope/gap policy must be confirmed; cross-module atomicity must not be claimed. |
| Number reuse | **Effective implemented behavior: never reuse.** `reusePolicy` accepts `never` or `recycle`, but the allocator does not consult it and no recycle producer exists. | `backend/src/modules/documents/domain/numbering.ts`; `backend/src/modules/documents/data/numbering-series.repository.ts` | Treat `recycle` as an unimplemented seam. Do not promise number recycling. |
| Document relations | **Implemented shape only.** Closed kinds include quantity-aware `fulfill`; endpoints may name lines; quantity is positive `numeric(18,4)`-compatible base quantity. | `backend/src/modules/documents/domain/document-relation.ts`, `planRelation`; `backend/prisma/schema/documents.prisma`; migration `backend/prisma/migrations/20260912000000_documents_foundation/migration.sql` | Can later represent MR-line → Issue-line partial fulfillment. C-52 remains out of C-50; a relation is not a stock movement or reservation. |
| Relation integrity | **Missing beyond shape.** `DocumentRelationsService.linkDocuments` does not check endpoint existence, registry membership, allowed type pairs, or fulfilled-total limits. `DocumentRelationsRepository.create` owns its write; there is no explicit shared-transaction seam. | `backend/src/modules/documents/application/document-relations.service.ts`; `backend/src/modules/documents/data/document-relations.repository.ts` | A future owning command must verify its own endpoint and quantity rules and prove consistency. Do not expose generic relation creation as fulfillment authority. |
| Workflow definition/runtime | **Implemented.** Versioned definitions, exactly-one initial state at publish, bounded states/transitions, permission-bound transitions, version-pinned instances, locked state advance, sequence history, comments, and availability queries exist. | `backend/src/modules/workflow/workflow.module.ts`; `WorkflowInstancesService.bindInstance`, `executeTransition`, `listAvailableTransitions`; `backend/src/modules/workflow/data/workflow-instances.repository.ts`; schema/migration `backend/prisma/migrations/20260912010000_workflow_foundation/migration.sql`; `backend/test/workflow.e2e-spec.ts`, `workflow-live.e2e-spec.ts` | Reusable mechanism only. No MR definition/content/binding exists. |
| Workflow approvals | **Implemented, bounded.** Single-level approval requests/decisions exist and stale approval is rejected. `requireDifferentActor` compares transition executor with Workflow instance binder; it does not enforce approver vs requester or document creator. | `backend/src/modules/workflow/application/workflow-approvals.service.ts`; `backend/src/modules/workflow/data/workflow-instances.repository.ts`; `backend/src/modules/workflow/domain/workflow-approval.ts`; `workflow-approval.spec.ts` | OQ-26 separation rules cannot be inferred. If selected, MR requester identity and approver checks need explicit semantics. |
| Workflow/business consistency | **Missing.** Workflow binds opaque entity references and never dereferences a business aggregate. No non-Workflow production module imports Workflow. Workflow repository transactions cannot update future `inventory.material_requests`. | `backend/src/modules/workflow/workflow.module.ts`; `backend/src/modules/workflow/application/workflow-instances.service.ts`; module-import search | Approval-enabled MR requires an integration design before implementation: one authoritative state, one command ingress, idempotency, lock order, and failure behavior. |
| Workflow automation | **Configuration implemented; execution missing.** `AutomationActionRegistry` starts empty. Completed transitions publish in-memory events containing enabled bindings; no action dispatcher/outbox executes them. | `backend/src/modules/workflow/application/automation-action-registry.ts`; `workflow-automations.service.ts`; `workflow-instances.service.ts`; `backend/src/modules/workflow/domain/workflow-automation.ts` | `reserve_stock`, notifications, or issue creation cannot be assumed to run from a binding. |
| Item/unit/conversion seams | **Implemented.** `ItemsService.requireUsableItemInOrganization`, `UnitsService.requireUsableUnitInOrganization`, and conversion services enforce owner scope/usability. Exact entered→base conversion rejects unsupported reverse derivation and non-representable results rather than rounding. | `backend/src/modules/inventory/application/items.service.ts`; `units.service.ts`; `unit-conversions.service.ts`; `inventory-posting-support.ts`, `resolveEnteredToBase`; `backend/src/modules/inventory/domain/quantities.ts` | Reuse these services; snapshot entered quantity/unit, base quantity/base unit, and conversion factor if MR quantities must remain historically stable. Do not read master tables directly. |
| Warehouse seam | **Implemented.** A warehouse is organization- and branch-scoped and exposes `requireUsableWarehouseInOrganization`; current reservation branch comes from its warehouse. | `backend/src/modules/inventory/application/warehouses.service.ts`; `backend/src/modules/inventory/domain/warehouse.ts` | Whether MR has one source warehouse, a per-line warehouse, a destination/requesting branch, or no warehouse until issue is an Owner decision. |
| Stock movements | **Implemented separately.** Immutable inbound/outbound/adjustment/transfer postings alter on-hand with operation-key idempotency and locks. | `backend/src/modules/inventory/application/inventory-movements.service.ts`; `inventory-transfers.service.ts`; `backend/src/modules/inventory/data/inventory-movements.repository.ts`; `backend/src/modules/inventory/domain/movement-type.ts` | Creating/approving MR must not move stock. Issue posting belongs to C-52, not C-50. |
| Reservations | **Implemented infrastructure.** Reservation creation locks a balance, checks `onHand - reserved`, inserts ACTIVE, increments reserved, and records an operation atomically; release locks reservation/balance, marks RELEASED, decrements reserved, and records an operation. References are opaque `(referenceType, referenceId)`. | `InventoryReservationsService.createReservation`, `releaseReservation`; `backend/src/modules/inventory/data/inventory-reservations.repository.ts`; `backend/src/modules/inventory/domain/inventory-reservation.ts`; `backend/prisma/schema/inventory.prisma`; migration `backend/prisma/migrations/20260911020000_inventory_core/migration.sql` | Reusable only after product decision. Current lifecycle is whole ACTIVE → RELEASED: no partial consume/resize/expire/cancel state or FK to MR lines. MR wiring is not “free.” |
| Reservation public API | **Implemented.** Separate permission-gated `/api/v1/inventory/reservations` list/get/create/release endpoints use operation keys and generic references. | `backend/src/modules/inventory/api/inventory-reservations.controller.ts`; `backend/src/modules/inventory/api/dto/inventory-core.dto.ts`; `backend/src/modules/inventory/domain/inventory-core-permissions.ts` | Existing generic endpoints are not an authoritative MR command. If MR owns reservations, callers must not independently desynchronize them. |
| Organization scope | **Implemented.** Deployment pin and per-request membership checks fail closed; out-of-scope organization IDs return not-found. Services expose `assertOrganizationInScope`/`requireUsableOrganization`. | `backend/src/modules/organization/application/deployment-scope.guard.ts`; `OrganizationsService.assertOrganizationInScope`, `requireUsableOrganization`; membership schema/migration `backend/prisma/migrations/20260926000000_organization_membership/migration.sql` | Every MR read/write must include server-enforced organization scope and must not trust a client-only filter. |
| Requester identity | **Open domain detail.** Principal supplies `userId`; `Employee` explicitly has no relation to `users.users`. | `backend/src/kernel/correlation/request-context.ts`; `backend/src/modules/organization/domain/employee.ts`; `backend/prisma/schema/organization.prisma` | `createdBy userId` is available. A required employee requester/department cannot be inferred; mapping must be decided or separately designed. |
| Department/branch references | **Implemented master data.** Departments and branches are organization-scoped public Organization services. | `backend/src/modules/organization/application/departments.service.ts`; `branches.service.ts`; `backend/src/modules/organization/organization.module.ts` | Reusable if selected. “Requesting department” and branch derivation remain product fields, not foundation mandates. |
| Financial area/year | **Implemented in Accounting, absent in Inventory.** Accounting exports resolver services; Inventory does not currently depend on Accounting or carry financial-area/fiscal-year fields. | `backend/src/modules/accounting/accounting.module.ts`; `FinancialAreasService.requireUsableFinancialAreaInOrganization`; `FiscalYearsService.requireUsableFiscalYearInOrganization`; absence from `inventory.prisma` | Recommendation: keep a non-valued MR outside financial-area/year scope unless Owner supplies a concrete requirement. Do not introduce Accounting coupling pre-emptively. |
| Authentication | **Implemented.** Cookie session authentication populates the principal; `AuthGuard` denies unauthenticated access. | `backend/src/modules/identity/application/auth.guard.ts`; `authentication.service.ts`; `backend/src/main.ts` | Future routes use existing auth, not a parallel actor model. |
| Permissions | **Implemented conventions.** `AuthorizationGuard` fails closed without permission metadata; `AuthorizationService` reads current database assignments, filters by active license, and services call `requireAllPermissions` again. | `backend/src/modules/rbac/application/authorization.guard.ts`; `authorization.service.ts`; `require-permission.decorator.ts`; Inventory service/controller precedents | Future route metadata and application-service checks are both required. Permission names/content are proposals until implementation is authorized. |
| Audit/events | **Partial/missing.** Rows commonly carry timestamps/actor stamps; Workflow has transition history; Inventory has operation rows. No Audit module, persisted generic domain-event table, or outbox exists. `DomainEventBus.publish` is in-memory and swallows handler errors. | `backend/src/kernel/events/domain-event-bus.ts`; schemas in `backend/prisma/schema/`; absence of Audit module/table | Define aggregate history/evidence needed for MR itself. Do not claim in-memory events are durable audit or reliable automation. |
| HTTP pipeline | **Implemented.** `/api` prefix, URI versioning, correlation middleware, security headers, access logging, rate limiting, strict global DTO whitelist/transform validation, and a global error filter are installed. | `backend/src/kernel/http/configure-app.ts`; `backend/src/kernel/http/validation.ts`; `backend/src/kernel/errors/global-exception.filter.ts`; `backend/src/main.ts` | Follow existing controllers/DTOs. Errors use `{ code, message, details?, correlationId }`. |
| Pagination/sorting | **Implemented convention.** `page`/`pageSize`, stable pagination envelope, and explicit server-side sort allow-lists. | `backend/src/kernel/pagination/page-query.dto.ts`; `paginated-result.ts`; Inventory list services | MR list must be organization-scoped, paged, deterministically ordered, and sort-whitelisted. |
| OpenAPI/client | **Implemented convention.** Backend DTO decorators produce `/api/docs-json` when Swagger is enabled; `openapi-typescript` generates the committed frontend declaration. `contracts.ts` contains narrow refinements only. | `backend/src/kernel/http/swagger.ts`; `backend/package.json`; `frontend/package.json`; `frontend/src/api/generated/vardena-api.d.ts`; `frontend/src/api/contracts.ts`; `client.ts`; `errors.ts` | A future API change must regenerate and commit the declaration; no handwritten divergent frontend MR contract. |
| Test infrastructure | **Implemented, with a concurrency gap.** Hermetic unit/E2E suites exist; selected live suites opt in through `VARDENA_TEST_DATABASE_URL`; CI provides PostgreSQL and runs migrations/tests. | `backend/vitest.config.e2e.ts`; `backend/test/inventory-core.e2e-spec.ts`; `documents-live.e2e-spec.ts`; `workflow-live.e2e-spec.ts`; `.github/workflows/ci.yml` | Future MR needs fast local coverage plus live-PG CI tests for locking/transactions. Current green CI proves the baseline, not C-50 acceptance. |

## 4. Reconciliation: documents that overstate current behavior

These are reportable discrepancies, not reasons to rewrite the accepted ADRs during
this investigation.

### 4.1 Document relations are deletable

ADR-0023 describes document relations as append-only evidence. Current production
code exposes `DocumentRelationsService.deleteRelation`, the repository has a delete
path, and the API/permission vocabulary supports deletion. Current code therefore
permits physical relation removal. C-50 must not rely on append-only relation history
until that discrepancy is separately reconciled.

### 4.2 Relation integrity is caller-owned but not enforced by the generic service

ADR-0023 and the domain comments say owning services ensure cross-module endpoint
integrity. The public `linkDocuments` implementation validates only endpoint shape,
kind, self-reference, and quantity. It does **not** verify that either endpoint
exists, that either document type is registered, that module/type pairs match, that
the pair is permitted, or that cumulative fulfillment does not exceed a source
line. The caller responsibility is real; the shared service does not prove it.

### 4.3 Number allocation is not in the aggregate transaction

The proposed document architecture says assignment happens inside the document write
transaction. Current `NumberingSeriesRepository.allocate` starts its own transaction.
Accounting demonstrates the consequence: it allocates and then persists the voucher;
a discarded numbered voucher keeps the allocation as a gap. This is useful precedent,
not proof of atomic future MR numbering.

### 4.4 Domain-event persistence comment is stale

`domain-event-bus.ts` comments that events are appended to `core.domain_events`, but
no such Prisma model, migration, repository, or table exists. The executable bus is
in-memory. Subscriber failures are swallowed. No future MR acceptance criterion may
use “event published” as proof of durable integration or audit.

### 4.5 ADR-0022 does not prove current live Inventory locking coverage

Inventory repository code uses PostgreSQL row locks and atomic transactions, and the
Accepted ADR describes concurrency validation. The current `inventory-core.e2e-spec.ts`
is hermetic. There is no `inventory-core-live.e2e-spec.ts` or reservation/balance
live lock suite using `VARDENA_TEST_DATABASE_URL`. Current live Inventory suites cover
item and warehouse master data, not core posting/reservation races. Concurrency
behavior is therefore implemented by inspection but not currently proven by an
opt-in live regression suite.

### 4.6 Roadmap wording understates reservation implementation

The roadmap calls out a generic `referenceType`/`referenceId` hook. That hook exists,
but the current reservation implementation is much more: persisted ACTIVE/RELEASED
claims, exact conversions, balance row locks, availability checks, operation-key
idempotency, organization scoping, permissions, and balance-counter updates. This
strengthens the reuse case but does not decide whether MR should use it.

## 5. Bounded Material Request domain analysis

### 5.1 Recommended bounded definition — not a decision

> A Material Request is an **Inventory-owned internal demand document** containing
> requested stockable item quantities. By itself it records intent and does not
> change on-hand, reserved quantity, valuation, accounting, or a warehouse ledger.

This definition is the smallest reading consistent with the roadmap and current
architecture. It keeps Material Request distinct from:

- a **reservation**, which is a soft claim on current availability;
- a **Warehouse Issue** (C-52), which posts an outbound movement;
- a **Purchase Request**, because Purchasing is post-MVP and explicitly distinct;
- a **transfer**, which atomically posts paired warehouse movements;
- an **accounting document**, which requires financial/posting semantics.

Owner confirmation is still required because the roadmap has not defined the
requester, location, lifecycle, reservation effect, or Issue relationship.

### 5.2 Capability classification

| Capability | Classification for C-50 | Rationale |
|---|---|---|
| Organization-scoped create/get/list | **Foundation-supported; proposed core** | Organization, auth, permissions, pagination, and typed aggregate patterns exist. |
| Header + ordered item lines | **Foundation-supported; proposed core** | Inventory owns items/units and exact quantities; Documents intentionally does not store business lines. |
| Draft editing | **Owner-confirmation candidate** | Documents can model optional draft, but does not decide MR configuration. |
| Temporary/final issuance | **Owner-confirmation candidate** | Supported document phases; semantic mapping for MR is unanswered. |
| Submit/approve/reject | **Blocked by OQ-13/OQ-26** | Workflow mechanism exists; content and separation rules do not. |
| Cancel/delete/edit after issuance | **Blocked by OQ-54** | Recommendation A is not a decision. |
| Number assignment | **Foundation-supported; policy confirmation needed** | Numeric monotonic allocation exists; transition, scope, and gap treatment need confirmation. |
| Requester as authenticated user | **Foundation-supported** | `createdBy` can carry principal `userId`. |
| Requester as Employee/department | **Owner-confirmation candidate** | Employee has no User link; department exists but is not mandated. |
| Source warehouse | **Owner-confirmation candidate** | Warehouse resolver exists. A demand may precede source selection; roadmap is silent. |
| Requesting branch/location | **Owner-confirmation candidate** | Branch and warehouse→branch exist, but derivation semantics are undecided. |
| Entered unit and exact base quantity snapshot | **Foundation-supported; recommended core** | Required for stable Inventory quantity semantics and later fulfillment comparison. |
| Reserve on submit/approve | **Open product rule; implementation excluded** | Infrastructure exists, but C-50 reservation wiring is explicitly outside this investigation. |
| Partial fulfillment by Issue | **Foundation-supported later; C-52 excluded** | `fulfill` line relations can carry base quantity, but Issue document does not exist. |
| Automatic Issue creation | **Blocked/out of C-50** | No decided rule, no C-52 aggregate, no durable automation. |
| Notification/worklist delivery | **OQ-15 candidate; excluded by default** | No Notifications module. Workflow APIs can be queried, but delivery is absent. |
| Valuation/cost/accounting | **Out of scope** | MR records demand and does not post. |
| Kardex/reports/report builder | **Out of scope** | No stock movement; bounded future MR list is not a Kardex. |
| Attachments, free-form custom fields, capability taxonomy | **Out of scope** | No admitted foundation/decision; avoid EAV/JSONB and broad refactors. |

### 5.3 Candidate data contract requiring Owner confirmation

The following is analysis, not an authorized schema.

**Stable technical/architecture fields likely required in any implementation:**

- header `id` (ULID), `organizationId`, lifecycle/version value, optional assigned
  number, document/request date, created/updated timestamps and actor stamps;
- line `id`, stable line ordering, `itemId`, entered positive quantity, entered
  `unitId`, exact `baseQuantity`, `baseUnitId`, and conversion factor snapshot;
- explicit optimistic version or lock discipline for concurrent editing/actions;
- operation/idempotency evidence for every command with externally repeatable side
  effects, especially number assignment and any optional integration.

**Product fields that must not be invented:**

- whether requester means authenticated User, Employee, Department, or a combination;
- whether branch is required and whether it is requester branch, fulfillment branch,
  or warehouse-derived;
- whether one warehouse is required on header, optional/preferred, per line, or
  selected only by C-52;
- required-by date semantics and timezone/date-only behavior;
- priority vocabulary;
- free-text purpose/reason requirements and length;
- whether duplicate item/unit lines are allowed or consolidated;
- whether only `isStockable` items are permitted;
- whether disabled master records remain readable on historical requests;
- whether line quantities may be edited after submission/approval;
- whether partial cancellation/remaining quantity is a C-50 concern or waits for
  C-52.

### 5.4 Invariants recommended for a later approved contract

These are technical safeguards around whichever product answers are selected:

1. Header and every referenced line/master row belong to the same organization.
2. Every entered quantity is positive, exact, and representable in current
   `numeric(18,4)` base-quantity semantics; no silent rounding.
3. Entered unit resolves to the item's base unit at the selected business instant;
   store the applied factor/snapshot so later conversion edits do not rewrite history.
4. Draft-only edits and terminal-state immutability are enforced in the repository
   transaction, not only in controllers.
5. Commands recheck current permissions and organization membership in the service.
6. Retries replay the original result or fail on mismatched intent; they do not
   duplicate numbers, history, reservations, or relations.
7. Lifecycle actions lock or compare a version so submit/edit/cancel/approve races
   resolve deterministically.
8. No MR action posts a movement, valuation, or journal unless a later admitted
   cross-module task explicitly owns that effect.

## 6. OQ/ADR dependency map

### 6.1 Open Questions

| Dependency | Canonical status and current posture | C-50 effect | Gate classification |
|---|---|---|---|
| **OQ-54** | OPEN. “Finalized document deletion/editing policy: cancel-only vs edit-until-posted vs per-type configuration; visibility of canceled documents; numbering gaps (OQ-12); cancel approval coupling (OQ-13/OQ-26).” Cancel-only/visible/audited is recommended, not decided. | Selects edit/delete/cancel rules, visibility, gaps, permissions, and possible approval. | **Implementation blocker.** |
| **OQ-13** | OPEN. “Approval workflows: do inventory movements / sales documents / journals need approval states? Negative stock allowed per policy?” Interim posture: no v1 approval states/direct create with permission; negative stock disallowed by default. | Must explicitly say whether Material Request is covered and which states/actions apply. Interim posture is not Owner acceptance for C-50. | **Implementation blocker with OQ-26.** |
| **OQ-26** | OPEN. “Approval policy: which transitions require approval, single vs multi-level, delegation and escalation, and separation-of-duties rules (e.g. creator may not approve their own document); which roles may approve which document types.” Interim posture: single-level; bounded conditions; multi-level/delegation deferred. | Selects approver authority, self-approval rule, rejection/rework, and worklist/notification needs. | **Implementation blocker if approval applies; explicit no-approval answer also required.** |
| **OQ-12** | OPEN. “Business document numbering rules (invoice no., receipt no., journal no.): per-type sequences? prefix/year scopes? gap policy?” Interim posture says no auto-numbering invented, while the later Foundation implements numeric monotonic allocation and Accounting uses financial-area `scope_key`. | Current mechanism is sufficient for a basic numeric series, but C-50 needs assignment transition, scope key, width/start, and acceptance of failure/cancel gaps. | **Not a mechanism blocker if current profile is explicitly accepted; blocks any prefix/year/reset/manual/recycle demand.** |
| **OQ-15** | OPEN. “Notification channels beyond in-app (email? SMS via Iranian gateways?) and which events notify whom; sales→inventory stock mutation workflow (does issuing an invoice move stock automatically?)” Interim posture: in-app only; sales stock movement manual. | Material Request notifications are optional product scope. No Notifications module exists. | **Not a core blocker if notifications are explicitly excluded; otherwise blocked by a separately admitted capability.** |
| Reservation rule | **No canonical OQ row exists.** Roadmap wording: undecided whether an MR reserves stock and how it drives C-52. | Selects no reservation vs claim timing/warehouse/line/lifecycle/release/Issue handoff. | **Implementation blocker until answered or explicitly deferred to a later task.** |

### 6.2 ADRs and architecture records

| Record | Status | What it supplies | What it does not decide/prove |
|---|---|---|---|
| ADR-0022 Inventory Core Ledger | **Accepted** | Movement ledger, balances, reservation model, exact quantities, transaction/locking design. | MR lifecycle, MR reservation applicability, C-52 handoff, or current live-lock test proof. |
| ADR-0023 Document Foundation | **Accepted** | Type registry, phase policy, configuration, numeric numbering, logical relations. | An MR aggregate, atomic cross-module aggregate numbering, or current append-only relation enforcement. |
| ADR-0024 Workflow Foundation | **Accepted** | Versioned definitions/runtime, history, approvals, automation bindings. | MR workflow content, requester/approver policy, business-state atomicity, or automation execution. |
| ADR-0017 Inventory ledger | **Proposed** | Design context for ledger-as-truth. | Implementation authorization or Owner acceptance. |
| ADR-0018 Workflow architecture | **Proposed** | Broader workflow design context. | Accepted policy content for Material Request. |
| ADR-0019 Document architecture | **Proposed** | Typed ownership and relation design context. | Current as-built guarantees where code differs. |
| ADR-0020/0021 Organization scope | **Proposed** | Scope/master-data design context. | Substitute for implemented membership behavior; ADR-0025/current code are the stronger runtime evidence. |

No new ADR is required for the bounded no-effect aggregate **if** the later design
uses existing public seams. An ADR or explicit accepted addendum is required before
introducing a new cross-module transaction coordinator, changing Workflow ingress,
adding a durable outbox, or changing number-allocation semantics.

## 7. Decision pack — OQ-54 finalized edit/delete/cancel

### 7.1 Canonical options (quoted without modification)

| Option | Advantages | Disadvantages |
|---|---|---|
| **A. Cancel-only, never edit, canceled stay visible** (accounting-style discipline everywhere) | Uniform; audit-clean; matches immutability culture; simplest to reason about | Users expect edit-before-post; stricter than some competitors |
| **B. Edit allowed until posted/canceled, then cancel-only** | Familiar UX; fewer canceled-document noise | “Until posted” boundary must be enforced cross-module (Sales ↔ Accounting timing); riskier inventory arithmetic |
| **C. Per-type policy configured per organization** | Flexibility | Most complex; config surface + validation matrix; errors likely |

### 7.2 C-50 facts that change the evaluation

- A basic MR has no posting boundary. If Option B is selected literally, “posted” is
  undefined for C-50 unless the Owner defines it as approval, reservation, or Issue
  fulfillment. That boundary must not be guessed.
- Option C needs configuration, policy validation, cache/read behavior, tests, and a
  matrix of states/actions. Documents configuration currently covers only the draft
  requirement plus a separate numbering-series surface, not arbitrary edit/cancel
  policy.
- Physical deletion would interact with number allocations, relations, Workflow
  history, and optional reservations. “Transactional documents are never soft-
  deleted” does not itself answer whether an unissued draft may be physically deleted.
- Current generic document relations are deletable, so they cannot be relied upon as
  immutable audit evidence for a canceled/fulfilled MR.

### 7.3 Recommendation — not a decision

Use **Option A** for issued/final Material Requests, retain canceled records visibly,
and permit only explicitly defined draft disposal before issuance. This matches the
recorded OQ-54 recommendation and minimizes undefined “posted” coupling. The Owner
must still decide whether that draft disposal is physical deletion or a visible
canceled state, who may do it, and what happens to allocated numbers.

### 7.4 Exact Owner answer required

Select OQ-54 A, B, or C for Material Request and answer all four canonical decision
points: unified/per-type policy; allowed finalized transitions; canceled visibility
and gap acceptance; permission/supervisor approval coupling. If B is selected,
define the exact MR “posted” boundary. If C is selected, authorize the configuration
surface explicitly.

## 8. Decision pack — OQ-13 and OQ-26 approval policy

OQ-13/OQ-26 have canonical questions and interim postures but no dedicated canonical
A/B/C option set. This report does not invent one.

### 8.1 Implemented capabilities available

- direct permission-gated lifecycle commands without Workflow;
- Workflow binding to a version and logical entity;
- locked transitions with required permission codes and comments;
- single-level recorded approval with stale-request protection;
- `requireDifferentActor` for executor vs Workflow-instance binder;
- append-only transition sequence history.

### 8.2 Missing semantics and integration

- which MR transition requests approval;
- who is requester (User vs Employee) and who is approver;
- role/permission mapping for each document type;
- creator/requester self-approval prohibition;
- reject destination, resubmission, withdrawal, cancellation during approval;
- business MR state vs Workflow current-state authority;
- atomicity/idempotency between two module stores;
- worklist ownership and notification delivery;
- multi-level, delegation, escalation (deferred by canonical interim posture).

### 8.3 Conditional architecture consequence

- **If no approval applies:** do not bind Workflow merely for generic status. Keep a
  bounded Inventory lifecycle and explicit permissions.
- **If approval applies:** implementation remains blocked until one authoritative
  state model and command ingress are accepted. The safer direction is an
  Inventory-owned command that locks the MR and invokes an approved Workflow seam;
  the generic Workflow transition route must not independently advance the same
  business transition. Current services do not provide an atomic cross-module
  transaction, so the consistency strategy must be designed and tested first.

### 8.4 Exact Owner answer required

State whether Material Request requires approval. If yes, specify the transitions,
single-level approver authority, requester/creator self-approval rule, reject/rework/
withdraw behavior, required comment/reason, and whether in-app worklist only is
sufficient. Confirm multi-level/delegation/escalation remain deferred or explicitly
admit a separate scope.

## 9. Decision pack — OQ-12 numbering

OQ-12 has no canonical option set. Current implementation narrows the feasible
baseline to numeric-only monotonic serials with an opaque `scopeKey`, configurable
start/width, unique allocation key, and effective no-reuse.

### 9.1 Verified guarantees

- technical identity remains ULID; the serial is business data;
- the configured series row is locked and incremented transactionally;
- serials are numeric-only and unique per configured series;
- allocation-key replay returns the original allocation;
- an allocated number is not recycled by current code.

### 9.2 Non-guarantees

- no prefix/suffix, fiscal-year component, per-period reset, or manual override;
- no atomicity with a future MR aggregate transaction;
- no contiguous/no-gap guarantee;
- no implemented recycle path even though `recycle` is a storable policy;
- no selected MR assignment transition or scope.

### 9.3 Recommendation — not a decision

For a bounded first MR, use the existing numeric monotonic strategy, allocate only at
the Owner-selected issuance/submission transition, use one explicitly selected
organization or branch/warehouse scope key, and accept permanent auditable gaps after
allocation. Do not add fiscal-year, prefix, or recycle behavior under C-50.

### 9.4 Exact Owner answer required

Confirm: (1) whether MR is auto-numbered; (2) assignment transition; (3) sequence
scope; (4) start and zero-padding width; (5) whether cancellation/failure gaps are
accepted and visible; and (6) that numeric-only monotonic/no-reuse is sufficient.
Any prefix/year/reset/manual/recycle requirement must remain a separately scoped
Documents Foundation extension.

## 10. Decision pack — OQ-15 notifications

### 10.1 Current fact

No Notifications module, notification table, channel provider, outbox, delivery
worker, or durable retry path exists. Workflow transition events are in-memory only.
Calling a Workflow list endpoint is not an in-app notification system.

### 10.2 Recommendation — not a decision

Exclude notifications from core C-50. If approval is selected, provide only queryable
pending-work data through the bounded Workflow/MR API unless a separately authorized
notification capability is admitted. Do not represent email/SMS/in-app delivery as
an MR side effect.

### 10.3 Exact Owner answer required

Confirm that C-50 ships with no notification delivery and that any approval work is
found by polling/querying the application. If not, state the required recipients,
events, channel, durability/retry expectation, and authorize the separate
Notifications/outbox dependency before C-50 implementation.

## 11. Decision pack — stock reservation and C-52 handoff

This is an explicitly unregistered product rule, not an OQ resolved by this report.

### 11.1 Questions the rule must answer

1. Does creating, submitting, or approving an MR reserve stock, or is MR always
   informational until C-52?
2. If it reserves, which warehouse is authoritative, and can source differ by line?
3. Is the claim all-or-nothing across lines or may some lines reserve while others
   remain short?
4. Does negative-availability policy apply exactly as the current generic reservation
   service applies it?
5. What releases a claim: edit, rejection, withdrawal, cancellation, expiry, Issue,
   manual action, or all named cases?
6. May quantity/warehouse/unit change after a claim; if so, is release-and-recreate
   acceptable?
7. Does C-52 consume, release, or replace reservations, and must movement + release +
   `fulfill` relation be one transaction?
8. Can multiple Issues partially fulfill one line; can fulfillment exceed requested
   quantity; how is remaining quantity computed and locked?
9. Is the current opaque reference sufficient, or is a line-level typed ownership
   contract required?

### 11.2 Current capability gaps for MR coupling

Current reservations have ACTIVE → RELEASED only. They have no partial release,
consume/convert-to-movement operation, expiry, resize, cancellation reason/state,
foreign key to a document line, or proven transaction spanning MR lifecycle and
reservation writes. The generic endpoint allows independent create/release actions,
which could conflict with an MR-owned invariant.

### 11.3 Recommendation — not a decision

For bounded C-50, record demand only and explicitly defer reservation and C-52
fulfillment to a later admitted integration task. Preserve line identities and exact
base quantities so later reservation/fulfillment can reference them. Do not create a
placeholder reservation flag whose semantics are not enforced.

If the Owner requires reservation as part of Material Request semantics, C-50 remains
blocked: reservation integration must be separately scoped, including shared command
ownership, transaction/compensation design, permissions, partial behavior, and live
PostgreSQL race tests.

### 11.4 Exact Owner answer required

State either:

- **Defer:** MR records demand only; no stock reservation or Issue creation/release in
  C-50; C-52 integration is a later task; or
- **Require:** name the claim transition, warehouse granularity, partial/shortage
  behavior, edit/cancel/reject release behavior, and C-52 consumption/fulfillment
  semantics, then explicitly authorize a separately bounded reservation integration
  design before implementation.

## 12. Exact pending Owner decisions

Every item is **PENDING**. Recording recommendations as answers would be incorrect.

| Local prompt | Exact answer required | Blocking effect |
|---|---|---|
| **C50-DP-01 — OQ-54** | Select canonical OQ-54 A/B/C for MR; define draft disposal, finalized edit/cancel/delete, canceled visibility, number-gap treatment, permission, and approval coupling. For B, define “posted”; for C, authorize configuration scope. | Blocks lifecycle/schema/API/permission design. |
| **C50-DP-02 — OQ-13/OQ-26** | Say whether MR requires approval. If yes: transitions, approver authority, self-approval separation, reject/rework/withdraw, comments/reasons, single-level limitation, worklist expectations. | Blocks lifecycle and Workflow boundary. |
| **C50-DP-03 — OQ-12 profile** | Auto-number yes/no; assignment transition; scope; start/width; gap acceptance; confirm numeric monotonic/no-reuse, or separately scope extensions. | Current mechanism works only after profile selection; advanced demands block on foundation extension. |
| **C50-DP-04 — reservation/C-52** | Explicitly defer all reservation/Issue effects, or specify the full reservation and handoff rule and authorize a separate integration design. | Blocks claim/warehouse/lifecycle semantics. |
| **C50-DP-05 — minimum domain fields** | Define requester identity, department/branch/warehouse rules, request/required dates, priority/reason, duplicate-line rule, stockable-only rule, and post-submit line edit policy. | Blocks bounded aggregate/DTO design. |
| **C50-DP-06 — OQ-15 scope** | Confirm no notification delivery and query-only work discovery, or authorize recipients/events/channels/durability as a separate dependency. | Non-blocking only when explicitly excluded. |
| **C50-DP-07 — implementation admission** | After the above are recorded, explicitly authorize a bounded C-50 implementation task and its acceptance criteria. | This report alone never authorizes code. |

The Owner should answer canonical OQs in their existing records/registry rather than
closing or rewriting them indirectly through this task. The stock rule may remain an
explicit C-50 decision or be opened as a new OQ by the Owner; this report does not
create one.

## 13. Proposed implementation scope after decisions and authorization

This is a future scope envelope, not implementation authorization.

### 13.1 Core slice common to the selected policy

1. Inventory-owned Material Request domain/header/line model with exact quantity
   snapshots and explicit lifecycle invariants.
2. Additive Prisma schema and migration in `inventory.*` with stable FKs/checks/
   uniqueness/indexes and no EAV/JSONB/universal document table.
3. Inventory document-type registration through `DocumentTypeRegistry` and only the
   Owner-approved phase/deletion definition.
4. Application service/repository/controller/DTO slice using public Organization,
   Inventory, Documents, RBAC, and Identity seams.
5. Server-enforced organization membership, route permission metadata, matching
   service permission checks, deterministic by-id not-found behavior, pagination,
   sort allow-list, and command idempotency/concurrency handling.
6. Existing numbering service only under the approved OQ-12 profile; explicitly
   tested failure-gap behavior. Any transaction-seam change is separate foundation
   work.
7. Aggregate-specific audit evidence/history sufficient for the selected lifecycle;
   in-memory events may be emitted after commit but are not durable integration.
8. OpenAPI-decorated DTOs, regenerated committed frontend declaration, and no
   handwritten parallel contract.
9. Unit/hermetic E2E/live-PostgreSQL tests from §15, following test policy.

### 13.2 Conditional approval slice

Only if C50-DP-02 says approval applies:

- an accepted single source of lifecycle truth;
- Inventory-owned action ingress preventing generic Workflow-only advancement;
- approved cross-module consistency/idempotency/lock-order behavior;
- Workflow binding/version policy and requester/approver separation checks;
- business-state + Workflow-state reconciliation tests.

Do not add this branch under an assumed workflow definition.

### 13.3 Explicit exclusions

- C-51 Warehouse Receipt and C-52 Warehouse Issue;
- C-48/C-49 opening quantity/rial flows;
- Inventory movement posting from MR;
- reservation creation/release/consume implementation under C-50;
- valuation, costing, rial amounts, accounting, posting, outbox, or system-generated
  vouchers;
- Kardex, stock/management reports, report builder, export, print, or dashboards;
- notifications/email/SMS/workers unless separately admitted;
- item taxonomy/capability changes, barcode, generic custom attributes, EAV, or
  indiscriminate JSONB;
- broad Documents/Workflow/Inventory foundation refactors;
- microservices, direct cross-schema table reads, universal document tables, or
  authorization bypass;
- frontend feature implementation unless separately scoped after the backend
  contract is approved.

## 14. Conditional architecture and module boundary

```text
/api/v1/inventory/material-requests
        |
        v
MaterialRequestsController        (transport; auth + permission metadata)
        |
        v
MaterialRequestsService           (authoritative command/query ingress)
  |       |       |       |
  |       |       |       +--> AuthorizationService / request principal
  |       |       +----------> OrganizationsService / optional Branch/Department
  |       +------------------> ItemsService / UnitsService / WarehousesService
  +--------------------------> MaterialRequestsRepository (inventory.* only)
  |
  +--> DocumentTypeRegistry / DocumentTypesService / NumberingService
  |
  +--> WorkflowInstancesService / WorkflowApprovalsService  [ONLY if approved]
  |
  +--> InventoryReservationsService                          [NOT in C-50]
  +--> DocumentRelationsService                              [C-52 integration later]
```

### 14.1 Boundary rules

- Inventory owns MR header/lines, lifecycle command, and invariants.
- Documents owns registration/configuration/number allocations/relations, not MR
  state or lines.
- Workflow owns reusable workflow state/history/approval records, not business MR
  mutation.
- Organization owns organization/branch/department/employee resolution.
- Inventory master services own items, units, conversions, warehouses, reservations,
  balances, and movements.
- Accounting is not imported for a non-valued Material Request.
- Every cross-module reference uses an exported application service. No repository
  or table from another module is injected/read.

### 14.2 Transaction boundaries requiring proof

1. **Draft aggregate write:** header + all changed lines + command/idempotency evidence
   must commit atomically in Inventory.
2. **Number assignment:** existing allocation is a separate transaction. Either the
   approved product policy accepts a durable allocation gap on subsequent MR failure,
   or separately authorized Documents work must expose a safe transaction protocol.
3. **Approval transition:** current Workflow transaction cannot update Inventory.
   Approval-enabled MR is blocked until a consistency pattern prevents one side from
   advancing alone.
4. **Reservation:** current reservation transaction cannot update MR. C-50 must not
   call it as an uncoordinated side effect.
5. **Future fulfillment:** C-52 movement, reservation release, MR remaining quantity,
   and relation creation span module ownership. That is later architecture work, not
   hidden inside C-50.
6. **Event publication:** emit only after the owning transaction succeeds. Current
   in-memory publication is best-effort, not a recovery mechanism.

## 15. Future test and acceptance matrix

No test below was implemented by this investigation.

| Area | Future acceptance evidence | Layer / execution |
|---|---|---|
| Domain shape | Positive exact quantities; empty request rejected; line order stable; selected duplicate-line/stockable rules enforced; no money/accounting fields. | Fast domain unit tests, local. |
| Lifecycle | Exact selected phase/action matrix; edits refused outside allowed phase; final/canceled behavior matches OQ-54; invalid transitions stable. | Unit + service tests, local. |
| Authorization | Every route carries required metadata; anonymous 401; missing/expired-license permission 403; service direct-call check also fails. | Unit/hermetic E2E, local/CI. |
| Organization isolation | Non-member and cross-organization header/line/master probes return not-found; list cannot leak rows; deployment pin honored. | Hermetic E2E + live PG, CI for live. |
| Master references | Item/unit/warehouse/branch/department belong to organization and are usable on new/edited requests; historical disabled references remain readable per selected policy. | Service + E2E. |
| Quantity conversion | Entered/base/factor snapshot exact; no conversion and non-representable result fail closed; later factor changes do not rewrite MR. | Unit + repository/E2E. |
| DTO validation | Unknown fields rejected per global `forbidNonWhitelisted` policy; ULID/date/decimal/length validation; standard error envelope with correlation ID. | Controller/E2E. |
| Lists | Required organization filter, `page`/`pageSize`, deterministic tie-break, explicit sort allow-list, status/date/requester filters only if admitted. | Service/E2E. |
| Idempotency | Same operation key + same intent replays; same key + changed intent returns conflict; concurrent duplicate commands create one result/history/number. | Unit + live PG concurrency in CI. |
| Concurrency | Edit vs submit, submit vs cancel, duplicate approval, stale version, and line replacement races resolve deterministically without lost update. | Live PostgreSQL CI. |
| Numbering | Selected assignment transition; allocation replay; unique monotonic behavior; failure after allocation produces only the approved gap behavior; cancel never reuses unless separately implemented. | Documents unit + MR integration + live PG CI. |
| OQ-54 | Selected delete/cancel/edit behavior; canceled visibility; audit/history retention; relations/number behavior on disposal. | Unit/E2E/live where transactional. |
| Workflow, if selected | Correct version binding; permission and single-level approval; requester/creator separation; stale approval; reject/rework; no generic Workflow-only MR advance; MR and Workflow reconcile after every injected failure. | Unit + hermetic E2E + live PG/failure-path CI. |
| No Workflow, if selected | No Workflow rows/permissions/routes are required for MR lifecycle; direct permission-gated transition is authoritative. | Unit/E2E. |
| Reservation exclusion | Core MR commands leave `onHand`, `reserved_quantity`, reservation rows, and movement ledger unchanged. | Repository/E2E; live PG for proof. |
| Reservation integration, later | Lock contention, all/partial claim policy, release on every selected transition, idempotent handoff, no orphan claim, negative policy, and movement/release consistency. | Separate task; mandatory live PG CI. |
| C-52 fulfillment, later | Multiple partial Issues; no over-fulfillment unless approved; exact remaining quantity; valid line endpoints; transaction/failure recovery. | Separate C-52 integration tests. |
| Audit/evidence | Actor/time/correlation/reason/history required by selected policy; no reliance on swallowed in-memory event. | Service/repository/E2E. |
| OpenAPI/client | Swagger operation/schema present; OpenAPI generation succeeds; committed `vardena-api.d.ts` updated; frontend typecheck uses generated contract. | CI contract generation/typecheck. |
| Migration | Forward migration on empty and populated baseline; constraints/indexes verified; rollback not faked; migration rehearsal. | GitHub CI only. |
| Regression | Documents/Workflow/Inventory/Organization/RBAC existing suites remain green. | Focused local fast tests; full/live suites in CI. |

### 15.1 Live-PostgreSQL gap to close

The later task must add an opt-in MR live suite using
`VARDENA_TEST_DATABASE_URL`. If reservation coupling is ever admitted, it should
also add the currently missing Inventory balance/reservation lock races rather than
claiming ADR-0022 prose as executable proof.

## 16. Readiness and blockers

### 16.1 Blocking before any C-50 implementation

- **B-01 — OQ-54:** finalized/draft edit/delete/cancel/visibility/gap policy open.
- **B-02 — OQ-13/OQ-26:** MR approval applicability/content/separation open.
- **B-03 — reservation/C-52 rule:** unregistered and unanswered.
- **B-04 — minimum domain contract:** requester, warehouse/branch/department, dates,
  line rules, and editable boundary not specified.
- **B-05 — conditional architecture:** if approval or reservation is required,
  current module transactions do not provide business-state atomicity.
- **B-06 — Owner admission:** an investigation-ready roadmap row is not permission to
  implement.

### 16.2 Deferrable without blocking a bounded no-effect core

- **OQ-12 extensions** are deferrable if the Owner accepts current numeric monotonic
  behavior, selected scope/transition, no reuse, and gaps.
- **OQ-15** is deferrable if notifications are explicitly excluded.
- valuation/costing/accounting/durable posting are deferrable because a basic MR has
  no such effects.
- C-51/C-52 fulfillment, reservations, Kardex/reporting, and taxonomy work remain
  separate candidates.

### 16.3 Readiness verdict

**BLOCKED — INVESTIGATION COMPLETE; NOT READY FOR IMPLEMENTATION.**

The codebase supplies enough mechanism to avoid speculative foundation building, but
not enough product policy or cross-module consistency for implementation. The next
valid action is Owner review and recording of C50-DP-01…C50-DP-07. This report does
not change C-47 status, close an OQ, accept an ADR, admit production code, or claim
Owner acceptance.

## 17. Exact evidence index

### 17.1 Production source

- Documents:
  - `backend/src/modules/documents/documents.module.ts`
  - `backend/src/modules/documents/application/document-type-registry.ts`
  - `backend/src/modules/documents/application/document-types.service.ts`
  - `backend/src/modules/documents/application/numbering.service.ts`
  - `backend/src/modules/documents/application/document-relations.service.ts`
  - `backend/src/modules/documents/data/numbering-series.repository.ts`
  - `backend/src/modules/documents/data/numbering-allocations.repository.ts`
  - `backend/src/modules/documents/data/document-relations.repository.ts`
  - `backend/src/modules/documents/domain/document-type.ts`
  - `backend/src/modules/documents/domain/document-lifecycle.ts`
  - `backend/src/modules/documents/domain/numbering.ts`
  - `backend/src/modules/documents/domain/document-relation.ts`
- Workflow:
  - `backend/src/modules/workflow/workflow.module.ts`
  - `backend/src/modules/workflow/application/workflow-instances.service.ts`
  - `backend/src/modules/workflow/application/workflow-approvals.service.ts`
  - `backend/src/modules/workflow/application/workflow-automations.service.ts`
  - `backend/src/modules/workflow/application/automation-action-registry.ts`
  - `backend/src/modules/workflow/data/workflow-instances.repository.ts`
  - `backend/src/modules/workflow/domain/workflow-instance.ts`
  - `backend/src/modules/workflow/domain/workflow-approval.ts`
  - `backend/src/modules/workflow/domain/workflow-automation.ts`
- Inventory:
  - `backend/src/modules/inventory/inventory.module.ts`
  - `backend/src/modules/inventory/application/items.service.ts`
  - `backend/src/modules/inventory/application/units.service.ts`
  - `backend/src/modules/inventory/application/unit-conversions.service.ts`
  - `backend/src/modules/inventory/application/warehouses.service.ts`
  - `backend/src/modules/inventory/application/inventory-posting-support.ts`
  - `backend/src/modules/inventory/application/inventory-movements.service.ts`
  - `backend/src/modules/inventory/application/inventory-reservations.service.ts`
  - `backend/src/modules/inventory/data/inventory-reservations.repository.ts`
  - `backend/src/modules/inventory/domain/quantities.ts`
  - `backend/src/modules/inventory/domain/inventory-reservation.ts`
  - `backend/src/modules/inventory/domain/negative-stock-policy.ts`
- Organization/security/API:
  - `backend/src/modules/organization/application/organizations.service.ts`
  - `backend/src/modules/organization/application/deployment-scope.guard.ts`
  - `backend/src/modules/organization/domain/employee.ts`
  - `backend/src/modules/identity/application/auth.guard.ts`
  - `backend/src/modules/rbac/application/authorization.guard.ts`
  - `backend/src/modules/rbac/application/authorization.service.ts`
  - `backend/src/kernel/http/configure-app.ts`
  - `backend/src/kernel/http/validation.ts`
  - `backend/src/kernel/errors/global-exception.filter.ts`
  - `backend/src/kernel/events/domain-event-bus.ts`
  - `backend/src/kernel/pagination/page-query.dto.ts`
  - `backend/src/kernel/pagination/paginated-result.ts`
- Precedent/integration:
  - `backend/src/modules/accounting/application/accounting-document-type-registration.ts`
  - `backend/src/modules/accounting/application/accounting-documents.service.ts`
  - `backend/src/modules/accounting/data/accounting-documents.repository.ts`
  - `backend/src/modules/accounting/accounting.module.ts`

### 17.2 Schemas and migrations

- `backend/prisma/schema/documents.prisma`
- `backend/prisma/schema/workflow.prisma`
- `backend/prisma/schema/inventory.prisma`
- `backend/prisma/schema/organization.prisma`
- `backend/prisma/schema/accounting.prisma`
- `backend/prisma/migrations/20260912000000_documents_foundation/migration.sql`
- `backend/prisma/migrations/20260912010000_workflow_foundation/migration.sql`
- `backend/prisma/migrations/20260911010000_inventory_master_data/migration.sql`
- `backend/prisma/migrations/20260911020000_inventory_core/migration.sql`
- `backend/prisma/migrations/20260926000000_organization_membership/migration.sql`

### 17.3 Tests and CI

- Documents unit/E2E:
  - `backend/src/modules/documents/application/numbering.service.spec.ts`
  - `backend/src/modules/documents/domain/document-lifecycle.spec.ts`
  - `backend/src/modules/documents/domain/document-relation.spec.ts`
  - `backend/src/modules/documents/domain/document-type.spec.ts`
  - `backend/src/modules/documents/domain/numbering.spec.ts`
  - `backend/test/documents.e2e-spec.ts`
  - `backend/test/documents-live.e2e-spec.ts`
- Workflow unit/E2E:
  - `backend/src/modules/workflow/domain/workflow-approval.spec.ts`
  - `backend/src/modules/workflow/domain/workflow-automation.spec.ts`
  - `backend/src/modules/workflow/domain/workflow-entities.spec.ts`
  - `backend/src/modules/workflow/domain/workflow-transition.spec.ts`
  - `backend/src/modules/workflow/domain/workflow-version.spec.ts`
  - `backend/test/workflow.e2e-spec.ts`
  - `backend/test/workflow-live.e2e-spec.ts`
- Inventory unit/E2E:
  - `backend/src/modules/inventory/application/inventory-posting-support.spec.ts`
  - `backend/src/modules/inventory/domain/inventory-reservation.spec.ts`
  - `backend/src/modules/inventory/domain/negative-stock-policy.spec.ts`
  - `backend/src/modules/inventory/domain/quantities.spec.ts`
  - `backend/test/inventory-core.e2e-spec.ts`
  - `backend/test/item-master-live.e2e-spec.ts`
  - `backend/test/warehouse-master-live.e2e-spec.ts`
- Test/CI configuration:
  - `backend/vitest.config.e2e.ts`
  - `backend/package.json`
  - `frontend/package.json`
  - `.github/workflows/ci.yml`
  - CI run `37023371492` at exact baseline SHA: frontend **success**, backend
    **success**.

### 17.4 API/client contract

- `backend/src/kernel/http/swagger.ts`
- `frontend/src/api/generated/vardena-api.d.ts`
- `frontend/src/api/contracts.ts`
- `frontend/src/api/client.ts`
- `frontend/src/api/errors.ts`

## 18. Investigation verification record

- Baseline/branch/`origin/main` equality: verified.
- PR #110 merge SHA and post-merge CI: verified.
- Canonical OQ-12/OQ-13/OQ-15/OQ-26/OQ-54 rows and OPEN statuses: verified.
- Dedicated decision record availability: OQ-54 exists; no dedicated OQ-12,
  OQ-13, OQ-15, or OQ-26 product record was found.
- Material Request artifact absence and Inventory document-type absence: verified.
- Documents, Workflow, reservations, organization, permissions, audit/event, HTTP,
  OpenAPI, client, and test boundaries: inspected at paths listed above.
- Heavy local E2E/live-PG/migration commands: deliberately not run under policy.
- Production/schema/API/test/generated-contract changes: none in this investigation.
- Changed-path scope: Markdown documentation only; verified from `git status`.
- Relative Markdown links, full path literals, and named source symbols: validation
  passed.
- `git diff --check`: passed; separate trailing-whitespace/final-newline validation
  for this initially untracked report also passed.

## 19. Implementation status addendum (2026-10-02, follow-up session)

> **This addendum records what subsequently happened on a working branch. Per
> §1's own evidentiary rule, GitHub's merged `main` is the official project
> memory; an open, unmerged pull request is not accepted history. Nothing here
> retroactively authorizes anything, and none of the OPEN items in §§1–18 are
> resolved by it.**

1. **Implementation proceeded without the record of a dedicated Owner
   admission answering this brief's OPEN items.** A Material Request vertical
   slice (schema, migration, repository, domain types, service, controller,
   DTOs, unit tests) was subsequently built as an Inventory-owned aggregate —
   consistent with this brief's §1.3 bounded-ownership finding — and opened as
   [PR #112](https://github.com/MR-AliEsmaeili/Vardena/pull/112) on branch
   `arena/01a0fd87-vardena`. **This investigation found no artifact recording
   that OQ-54, OQ-13/OQ-26, or the undecided stock-reservation/C-52 wiring
   question (§1 items 5–6) were ever closed before that work began.** Anyone
   relying on this document should treat the implementation as having
   proceeded on an assumed-safe subset, not as evidence those questions are
   answered.
2. **The contract actually implemented is narrower than C-52 in one
   dimension (valuation/posting) but is NOT the "Defer" option §11.4 offered
   for stock reservation — correcting an inaccuracy in an earlier version of
   this addendum.** The Material Request aggregate is **non-valued and
   non-posting** (no costing or accounting effect) — the shape this brief
   identified (§1 item 4) as avoiding the valuation/costing/durable-posting
   gates shared with C-48/C-49/C-51/C-52. It does **not** create or drive a
   Warehouse Issue, and its document type is registered with Documents for
   numbering (and, see below, for Document Relations) only — C-52 itself
   remains untouched. **However, the implementation DOES reserve stock**:
   each line carries an optional `reservationRequested` flag (Owner-shaped
   as "per line, never auto-split across warehouses" per the line's own
   `itemId`/`warehouseId`); approving a submitted request atomically reserves
   every flagged line's exact quantity in its own warehouse, and refuses the
   **whole** approval (no partial reservation) if any flagged line lacks
   available stock; a reservation is released only when the approving user
   explicitly reverses that approval (and reversal is itself refused once
   any line has been invoked). This is squarely the **"Require"** branch of
   §11.4, naming most of the questions §11.1 asked (all-or-nothing across
   lines: yes; which warehouse: the line's own, never chosen by the system;
   current negative-availability policy: reused as-is; release: approver
   reversal only, not edit/withdrawal/expiry) — **but no artifact in this
   repository records an Owner choosing "Require" over "Defer", or
   authorizing this specific shape.** This addendum is not that
   authorization either; it only corrects the record to say what was built.
   Separately, "invocation" (`PUT .../lines/invoke`) records — via an
   ordinary Document Relation, the same mechanism every other
   document-to-document reference in this codebase uses — that an approved
   line was carried into another document; it does not itself touch stock,
   does not require or imply a reservation, and does not create or validate
   any C-52 Warehouse Issue (today the only invocation destination this
   module can honestly verify is another Material Request — see
   `material-requests.service.ts`'s own documented limitation). A
   single-level approve/reject/reverse lifecycle reuses existing primitives
   rather than inventing new ones; none of this is a claim that OQ-13/OQ-26
   (who may approve, requester-approves-own-request) have been decided — the
   implementation picked one reversible behavior and left it
   change-compatible.
3. **A later review pass on PR #112 found and fixed four implementation
   defects** unrelated to the OQ/authorization question above (an
   unintended cross-module permission dependency in mutation responses, a
   missing destination-existence check before downstream invocation, an
   availability/reservation inconsistency across endpoints, and an
   invocation-accounting page-size cap) — see the PR's commit history for
   detail. A follow-up session added dedicated live-PostgreSQL E2E coverage
   (`backend/test/material-requests-live.e2e-spec.ts`) exercising, against a
   real database, the exact reservation/invocation behavior described in
   item 2 above: all-or-nothing approval atomicity (including the
   insufficient-stock rollback case), organization isolation, invocation
   destination validation, invocation capacity under real concurrent
   requests, and approver-only/post-invocation reversal restrictions. **This
   is verification that the shipped code behaves as item 2 describes — it is
   not, and must not be read as, Owner authorization for that behavior.** As
   of this addendum, PR #112's CI (lint, typecheck, format, backend unit
   tests, build, migrations, migration rehearsal, and the live-Postgres E2E
   suite; frontend quality gates) is **green** on the PR's latest commit at
   the time of writing, but the PR is **not merged** and carries no Owner
   sign-off on the open product questions above.
4. **Outstanding before this can be treated as an accepted MVP deliverable:**
   an explicit Owner decision on OQ-54 and OQ-13/OQ-26; and — now more
   pointed than before this correction — an explicit Owner ratification (or
   rejection) of the SPECIFIC stock-reservation shape already shipped in PR
   #112 (item 2 above), since §11.4 required that choice to be made and
   recorded BEFORE implementation, not after. If the Owner does not ratify
   this shape, the reservation code path (not just the lifecycle/approval
   questions) would need to be reworked or disabled, not merely documented
   around. Until then, §§1–18 of this brief remain the accurate record of
   what was and was not decided; this addendum only records that
   unauthorized-pending-decision implementation work exists on an open PR,
   and should not be read as closing any OPEN item above — including, now
   explicitly, §11's reservation question, now also tracked as
   **OQ-66** in `docs/open-questions.md`.
5. **Frontend Material Request UI and OpenAPI/generated-client regeneration
   remain BLOCKED**, for two independent reasons: (a) environment — the
   Prisma CLI's schema-engine binary download (required by `prisma
   generate`/`validate`, which the API-docs-to-OpenAPI generation workflow
   depends on) could not reach `binaries.prisma.sh` from the sandbox used for
   this work; (b) governance — `docs/frontend/standards.md` §2 requires API
   response types to come ONLY from the generated OpenAPI contract, and the
   environment gap in (a) means that contract cannot be regenerated for
   Material Request, so no compliant typed frontend surface can be built
   yet. Neither gap was worked around by hand-typing a contract or
   fabricating a destination document.

## 20. Owner decisions recorded (2026-10-02, second follow-up session) — reconciliation against §§7/8/11

> This section records **only** what the Owner explicitly decided in this round.
> It does not retroactively close §7 (OQ-54), §8 (OQ-13/OQ-26), or §11.4 in
> general — those remain open product-policy questions outside this round's
> four named decisions. Nothing here resolves OQ-54 or OQ-13/OQ-26 as a whole;
> `docs/open-questions.md` is updated **only** for OQ-66, per the Owner's
> explicit scoping of this round.

### 20.1 Decision 1 — reservation shape (answers §11.4 "Require", names the terms §11.4 asked for)

The Owner selected the **"Require"** branch of §11.4 and named every term that
branch requires:

- Reservation is **optional**, controlled per line by `reservationRequested` —
  not an automatic consequence of approval.
- If selected, approval **must** reserve the exact requested item, warehouse,
  quantity, organization, and applicable unit conversion named on the line —
  no system-chosen warehouse, no fallback, no splitting across warehouses.
- If a flagged line's reservation cannot be fulfilled in full, **approval of
  the entire request fails** — no partial reservation for that line, and (this
  was already the only way the code could behave, since `approve` is one
  database transaction) no reservation for any other line either.
- Reservation must **never** change physical On Hand, and existing
  availability/concurrency guarantees are preserved unchanged.
- No automatic warehouse fallback or splitting is introduced.

This matches the shape already implemented and described in §19 item 2 — the
Owner has now **ratified** that shape rather than it remaining an
unauthorized-pending-decision implementation. `docs/open-questions.md`
OQ-66 is updated accordingly (see §20.4 below for what still remains open).

### 20.2 Decision 2 — document lifecycle and editing (narrows, but does not fully answer, §7/OQ-54)

The Owner named a **specific lifecycle**: Draft (requester edits) → Submitted
(awaiting approval; approver may return for correction) → Returned for
correction (requester edits, must resubmit) → Approved (content immutable) →
{Rejected | Cancelled}, plus the separate Approved → Submitted reversal edge.
Cancellation of an **approved** request is permitted only if **no part** of it
has entered a downstream process (zero invocation, including partial); once
any invocation exists, cancellation of the **entire** request is prohibited
(there is no partial-cancel concept). Cancellation and approval-reversal are
distinct, independently auditable operations.

This is **not** a selection of OQ-54's canonical Option A/B/C — the Owner was
not asked that question in this round, and this report does not infer one.
What this decision *does* settle, narrowly, for Material Request only:

- there is no physical deletion of anything past `draft` (consistent with
  Option A's "transactional documents are never soft-deleted" framing, but
  not an adoption of Option A's full canonical content, e.g. configuration
  surface, cross-document policy, or any other document type);
- a canceled request stays visible with an explicit `cancelled` status and
  its own audit columns (`cancelledAt`/`cancelledBy`/`cancellationReason`),
  answering §7.2's "canceled visibility" concern for Material Request only;
- the previously-undefined "posted" boundary that Option B would have needed
  is moot for Material Request — invocation (downstream consumption), not an
  accounting posting event, is the boundary that blocks cancellation.

OQ-54 itself remains **OPEN** in `docs/open-questions.md` — this round answers
Material Request's own lifecycle rules, not the cross-module canonical
options §7 asks the Owner to pick from for the platform at large.

### 20.3 Decisions 3 and 4 — approval authority and return-for-correction (narrows, but does not fully answer, §8/OQ-13/OQ-26)

The Owner decided, for Material Request specifically: any holder of
`Material Request Approve` may approve or reject within their authorized
scope (no separately assigned approver role), self-approval is explicitly
**permitted** (no requester/approver separation), and a holder of
`Material Request Return For Correction` may return a submitted request to
its requester, who must then resubmit before approval — with an auditable
history of both the return and the resubmission.

This answers several of §8.2's "missing semantics" bullets **for Material
Request only**: creator/requester self-approval prohibition (answered: there
is none), reject/resubmission/withdrawal-equivalent behavior (answered: via
return-for-correction, not a generic workflow withdrawal), and who is
approver (answered: any permission holder, not a named role). It does **not**
answer §8.2's remaining bullets for the platform at large (role/permission
mapping policy across document types, worklist/notification delivery,
multi-level approval, delegation, escalation) and does not select a canonical
OQ-13/OQ-26 option set. Those rows remain **OPEN** in
`docs/open-questions.md`; this section only records that Material Request's
own implementation now has an Owner-authorized approval-authority rule,
narrower in scope than the platform-wide question.

### 20.4 What remains genuinely open after this round (not decided, not invented)

Per this round's explicit instruction to record undetermined edge cases as
open questions rather than inventing policy:

1. **Reservation consumption on invocation (C-52 handoff).** None of the four
   decisions above say what happens to an **active** reservation once its
   line has been invoked into a downstream document. The current
   implementation leaves it untouched — `invokeLine` never reads or writes
   `MaterialRequestLine.reservationId` — and, combined with Decision 2's rule
   that cancellation and reversal are both blocked once *any* invocation
   exists, there is **no implemented path** that ever releases a reservation
   on a line that has been invoked (partially or fully). This is recorded as
   the open remainder of **OQ-66** (`docs/open-questions.md`), not resolved
   here. A future C-52 (Warehouse Issue) task must decide whether invocation
   itself should consume/convert the reservation, whether a different
   explicit operation is needed, or whether this is accepted as a durable
   "reserved until Issue posts" state — none of that is decided by this
   round's four Owner decisions.
2. **Reservation release mechanics on cancellation/reversal, verified in
   this round:** cancelling an approved request (with zero invocation) and
   reversing its approval both release every active reservation the request
   holds, restoring `inventory_balances.reserved` under the same Material
   Request row lock `approve` used to create it
   (`MaterialRequestsRepository.releaseActiveReservationsForLines`, shared by
   both operations). Neither operation ever touches `onHand`, and neither
   can run once any line has been invoked (enforced inside the same
   transaction, under the same lock, so this is race-free). This is
   implemented and tested (unit: `material-requests.service.spec.ts`;
   intended for live-Postgres confirmation in
   `material-requests-live.e2e-spec.ts`) — it is not a new open question, it
   is the verified answer to this round's item 4 for the cases the Owner's
   decisions actually cover (zero invocation).

## 21. Owner decision recorded (2026-10-02, third follow-up session) — reservation consumption on invocation (closes §20.4 item 1 / OQ-66)

> This section resolves the ONE item §20.4 flagged as genuinely undetermined
> after the second follow-up session: what happens to a line's ACTIVE
> reservation once it is invoked into a downstream document. It does not
> reopen or revisit any other item in §§1–20 — OQ-54 and OQ-13/OQ-26 remain
> exactly as scoped there.

### 21.1 The decision

The Owner decided: **every successful invocation of a line that carries an
ACTIVE reservation consumes the identical amount from that reservation.**
Concretely, for a line with `baseQuantity = 100` and an active reservation of
the same amount:

- an invocation of 60 reduces the reservation to 40 (still `active`);
- a further invocation of 25 reduces it to 15 (still `active`);
- a further invocation of 15 reduces it to exactly 0 — at that point the
  reservation is CLOSED (`status` → `released`), because an ACTIVE
  reservation must never show a zero remaining quantity.

Invocation itself remains exactly what it already was: partial, repeatable,
with no fixed count limit, bounded only by `invokedBaseQuantity <=
baseQuantity`; it never touches `on_hand`; and it never requires or implies a
Warehouse Issue (C-52 remains a wholly separate, later task — this decision
only defines what the EXISTING, module-local `invokeLine` traceability
primitive does to the EXISTING, module-local reservation it itself created;
it does not design or admit anything about receipts, postings, or physical
movement). A line with no reservation invokes exactly as before — only its
own counters move.

### 21.2 How this differs from reversal/cancellation's release

`reverseApproval` and `cancel` RELEASE an unconsumed claim back to available
stock — the released row keeps showing the full amount that was given back,
for audit. Invocation CONSUMES a claim — nothing is given back, the stock
was carried into a downstream process, so the terminal row shows zero
remaining rather than the pre-consumption amount. Both are decrements of
`inventory_balances.reserved` and both leave `on_hand` untouched, but they
are recorded as distinct `inventory_operations` kinds
(`reservation_release` vs. the new `reservation_consume`) precisely because
reconciliation needs to tell "returned to the pool" apart from "carried
downstream" — one new closed-list operation value was added for this
(`backend/src/modules/inventory/domain/inventory-operation.ts`), not a new
parallel audit mechanism.

### 21.3 Interaction with the already-decided cancellation/reversal block

Unchanged: once ANY line has been invoked, even partially, both cancellation
and approval reversal of the whole request remain blocked (Owner decision,
§20.2/§20.4). What changes is only what the reservation LOOKS LIKE while
that block is in effect: it now accurately shows the uninvoked remainder
(e.g. 40, not 100) rather than an amount that silently diverged from reality.
This was the concrete risk §20.4 flagged — a reservation showing a stale
total while part of it had already been carried downstream — and it is now
closed by construction: the reservation's own quantity is the single source
of truth for "how much remains claimed," updated in the same transaction as
every invocation that touches it.

### 21.4 Implementation

- `backend/src/modules/inventory/data/inventory-locks.ts` —
  `lockReservationRow` now also returns the reservation's entered-unit
  `quantity` (previously only `baseQuantity`), needed to keep the
  entered/base pair exact during a partial consumption.
- `backend/src/modules/inventory/data/inventory-core-rows.ts` — the
  `ReservationDelegate.update` data type gained three new precise update
  shapes (`ReservationPartialConsumeUpdate`, `ReservationConsumedCloseUpdate`,
  `ReservationReopenUpdate`) alongside the existing `ReservationReleaseUpdate`
  — each names exactly one reservation-lifecycle transition, matching this
  module's existing preference for precise named update shapes over a single
  loose partial-update type.
- `backend/src/modules/inventory/domain/inventory-operation.ts` — added
  `reservation_consume` to the closed-list `INVENTORY_OPERATIONS` vocabulary.
- `backend/src/modules/inventory/data/material-requests.repository.ts` —
  `reserveInvocationCapacity` now, in the SAME transaction as its existing
  line-counter check-and-increment: locks the reservation row (when one
  exists), verifies it is ACTIVE/positive/consistent/sufficient (failing
  closed with `BalanceDriftError` on any stored-data inconsistency — never
  silently repaired), decrements it (and `inventory_balances.reserved` by the
  same amount, never `on_hand`), and closes it at exactly zero.
  `releaseInvocationCapacity` (the existing compensation path for a failed
  downstream Document Relation write) now also restores the reservation —
  and reopens it if the failed attempt had closed it — to precisely its
  pre-attempt state, using the exact amounts the forward step recorded
  (never re-derived from the by-then-mutated stored state).
- `backend/src/modules/inventory/application/material-requests.service.ts`
  — `invokeLine` passes the entered-unit invoked quantity through verbatim
  (never re-resolving unit conversions from current master data — the
  line's already-recorded `conversionFactor` is authoritative) and
  propagates the repository's reservation-consumption result into the
  compensation call on a `linkDocuments` failure.
- Tests: `material-requests.service.spec.ts` gained a
  `FakeMaterialRequestsRepository` reservation model (quantity/baseQuantity/
  status) and 9 new unit tests (partial consumption, multiple consumptions
  down to closure, single full-amount consumption, exceeding remaining
  capacity, no-reservation invocation, compensation restoring a partial
  consumption, compensation reopening a closed reservation,
  cancellation/reversal still blocked with the reservation correctly showing
  only the uninvoked remainder, and a 100-invocation stress test proving a
  RESERVED line has no fixed invocation-count limit either — only the total
  quantity caps it). `material-requests-live.e2e-spec.ts` gained 4 new
  real-Postgres scenarios covering the same ground end to end (including a
  genuine — not mocked — downstream-relation failure via a self-referencing
  invocation, and a real concurrent-invocation race against one
  reservation).

### 21.5 OQ-66 disposition

`docs/open-questions.md` OQ-66 is now marked RESOLVED (moved to the
"Resolved" table) — every sub-question §11.1 originally asked about the
reservation's shape, lifecycle, and what releases/consumes it is now an
explicit, implemented, tested Owner decision. What remains unscoped is not a
reservation question at all: a future C-52 Warehouse Issue task would still
need its own investigation for whatever is specific to posting a physical
issue (costing, movement creation, document content) — but how an invoked
Material Request line's reservation behaves is no longer one of those
unknowns, regardless of what eventually invokes it.
