# Task 24 — Account Management & Chart Lifecycle — Scope / Design / Dependency Gate

- **Status:** `READY FOR OWNER REVIEW` (bounded Scope A) — **design/documentation only**
- **Type:** scope design, dependency gate, pre-implementation analysis
- **Produced on:** branch `arena/01a0e18c-vardena`, baseline `main` @ `7754aaa2c96766963d4619f484ae4e20f10c711a` (merge of PR #66, Task 23)
- **Implements:** nothing. No production code, Prisma schema, migration, SQL, API, DTO,
  permission, seed, frontend, test or refactor is added or authorized by this document.
- **Self-acceptance:** none. Acceptance is the Repository Owner's decision
  (`STATE.md` §6, `docs/accounting/task-index.md` §7).

> **Evidence rule used throughout.** Every "current state" claim below is a checkout
> fact with a file path. Anything not verifiable in the checkout is marked
> `UNKNOWN — REPOSITORY EVIDENCE REQUIRED`, `OWNER / DOMAIN DECISION REQUIRED`, or
> `DEFERRED — NOT A TASK 24 BLOCKER`.

---

## 1. Executive Summary

**The single most important finding: the capability Task 24 is named after already
exists in `main`.** The organization-owned Account read surface, the create/edit
surface, and the enable/disable lifecycle verbs were shipped by Task 10.3 and
hardened by Tasks 11, 19 and 23. `accounting.accounts` carries `is_active`, the
hierarchy invariants are enforced under row locks, and posting is already
leaf-only + active-only at both the pre-flight and the locked write boundary.

Therefore Task 24 **must not** be framed as "build Account management". Framed that
way it would either (a) re-implement existing behaviour, or (b) invent lifecycle
policy that `docs/accounting/domain-contract.md` §8.6 explicitly assigns to **OQ-25**
and `docs/tasks/task-21/task-21-governance-baseline.md` §10 explicitly assigns to
**OQ-36**.

What the repository actually shows as *missing or inconsistent* falls into three
buckets:

| Bucket | Nature | Task 24 verdict |
|---|---|---|
| **A. Organization-isolation gap on the Accounts LIST surface** | `AccountsService.listAccounts` never calls `assertOrganizationInScope` (deployment pin + ODR-3 membership) unless a `parentId` filter is supplied. Every other Accounting by-id path does. | **Candidate IN-SCOPE (Scope A)** — security correction inside Account's own slice, but it **changes an existing API contract** (200 → 404), so it needs explicit Owner approval. |
| **B. Unguarded deactivate/activate transitions** | `enable`/`disable` flip `is_active` with **no** precondition: no children check, no parent-state check, no usage check. | **BLOCKED / OUT OF SCOPE** — adding any guard here is exactly the policy §8.6 defers to OQ-25 and §10 of the Task 21 baseline defers to OQ-36. |
| **C. Governance-state drift** | Task 23 is merged in `main` but has **no row in `STATE.md` §7 and no row in `docs/accounting/task-index.md` §2**, and no Task 23 acceptance record exists. Task 24 itself is not admitted to the task index at all. | **PREREQUISITE** — recorded, not reconciled by this document. |

**Recommended shape of Task 24 (Scope A — bounded, implementable today):** an
Account *read-surface integrity and organization-isolation* slice plus a
*lifecycle-semantics documentation and regression-locking* slice, with **zero new
lifecycle policy**, **zero schema change**, **zero new permission code**, and
**zero new endpoint**. Everything that would require a new accounting rule is
pushed into the OQ dependency matrix (§6) as an explicit blocker for a later
Task 24B.

**Implementation risk of Scope A:** `LOW`, with one `MEDIUM` item (the list
contract change in bucket A).

---

## 2. Repository Reality Report

### 2.1 Account domain — what physically exists

| Artifact | Path | Facts |
|---|---|---|
| Table / model | `backend/prisma/schema/accounting.prisma` → `model Account` → `accounting.accounts` | `id`, `organization_id`, `code VarChar(32)`, `title VarChar(200)`, `parent_id` (self-FK, `RESTRICT`), `level Int`, `coding_structure_version_id`, `accounting_configuration_id`, `account_nature VarChar(8)`, `is_postable`, `is_active`, `created_at/updated_at/created_by/updated_by`. Unique `(organization_id, code)`. Indexes: `(organization_id, parent_id)`, `(organization_id, level)`, `(organization_id, is_active)`, `coding_structure_version_id`, `accounting_configuration_id`. |
| Domain rules | `backend/src/modules/accounting/domain/account.ts` | `ACCOUNT_NATURES = ['debit','credit']`; `planAccountPlacement` (problems: `parent_not_found`, `self_parent`, `cross_organization`, `cycle`, `parent_disabled`, `parent_postable`, `depth_exceeded`, `version_mismatch`, `restructure_with_children`, plus code-shape problems); `planPostabilityChange` (`postable_with_children`); `planAccountEdit`; `planPinCoherence`; `ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS = ['parentId','level','accountNature','isPostable']`. |
| Code rules | `backend/src/modules/accounting/domain/account-code.ts` | digits-only, per-level segment widths, parent-prefix extension, length cap `MAX_ACCOUNT_CODE_LENGTH`. |
| Hierarchy helper | `backend/src/modules/accounting/domain/hierarchy.ts` | `collectDescendantIds` (cycle/descendant closure input). |
| Service | `backend/src/modules/accounting/application/accounts.service.ts` | `listAccounts`, `getAccount`, `createAccount`, `updateAccount`, `enableAccount`, `disableAccount` (both via private `setActive`), `requireUsableAccountInOrganization`, private `mustFindInOrganization`. |
| Repository | `backend/src/modules/accounting/data/accounts.repository.ts` | `findById`, `findByCode`, `findChild`, `listHierarchyEdges`, `list`, `createChecked` (locks parent / pinned version / configuration), `updateChecked` (locks node + new parent ascending by id; re-runs the placement table; counts children under the node lock; re-checks the after-use predicate under `FOR UPDATE`), and a **plain unguarded `update(id, patch)`**. |
| Controller | `backend/src/modules/accounting/api/accounts.controller.ts` | six routes (§2.2). Explicit comment: *"There is deliberately NO DELETE endpoint and no `Accounting.Account.Delete` permission."* |
| DTOs | `backend/src/modules/accounting/api/dto/account.dto.ts` | `CreateAccountDto`, `UpdateAccountDto` (**no `code` field**), `ListAccountsQueryDto`, `AccountResponseDto`. |
| Events | `backend/src/modules/accounting/domain/accounting.events.ts` | `ACCOUNT_CREATED/UPDATED/ENABLED/DISABLED`, published on the in-memory bus (no outbox table exists — `.vardena/project-context.md`). |
| Audit fields | schema | `created_by` / `updated_by` written from `getPrincipal()`; there is **no Audit module** (`.vardena/project-context.md`: "Not implemented at all: Audit …"). |
| "Used" marker | — | **There is no `operationally_used_at` (or equivalent) column on `accounts`.** That column exists only on `accounting.accounting_configurations` (Task 13). Usage is derived (§2.4). |

### 2.2 Existing API surface (Account-related)

| Method + path | Purpose | Permission | Org scope enforcement | Task 24 verdict |
|---|---|---|---|---|
| `GET /api/v1/accounts` | list + filter (`parentId`, `level`, `isActive`, `isPostable`, `codingStructureVersionId`, `search`) + allow-listed sort (`code`,`title`,`level`,`createdAt`,`updatedAt`; default `code asc`) + paging | `Accounting.Account.View` | **PARTIAL** — `assertOrganizationInScope` runs **only when `parentId` is supplied** | **Candidate completion (Scope A / F-1)** |
| `GET /api/v1/accounts/:id?organizationId` | detail | `Accounting.Account.View` | full (`mustFindInOrganization` → `assertOrganizationInScope`) | no change |
| `POST /api/v1/accounts` | create (level, pins, code shape derived/validated) | `Accounting.Account.Create` | full (`requireUsableOrganization`) | no change |
| `PATCH /api/v1/accounts/:id?organizationId` | edit `title`, `accountNature`, `isPostable`, `parentId` — **never `code`** | `Accounting.Account.Edit` | full | no change |
| `POST /api/v1/accounts/:id/enable` | `is_active = true` | `Accounting.Account.Enable` | full | no policy change (§11) |
| `POST /api/v1/accounts/:id/disable` | `is_active = false` | `Accounting.Account.Disable` | full | no policy change (§11) |
| `GET /api/v1/accounting/chart-tree`, `…/:id` | ODR-2 read projection: flat tree nodes, fixed `code asc`, inactive included, explicit `sort` rejected | `Accounting.Account.View` | full (`requireUsableOrganization`) | **must not change** |
| `POST /api/v1/accounting/adopt-base-chart[/preview]`, `GET /api/v1/accounting/base-chart-adoptions[/:id]` | Task 23 adoption | `Accounting.BaseChart.Adopt` / `.View` | full | **must not change** |
| *(absent)* `DELETE /api/v1/accounts/:id` | — | — | — | **must stay absent** |
| *(absent)* dedicated "account tree with nesting", "account usage", "bulk lifecycle" | — | — | — | not required by Scope A |

### 2.3 Permissions / RBAC

- `backend/src/modules/accounting/domain/accounting-permissions.ts` registers **41
  Accounting codes**, of which the Account family is exactly five:
  `Accounting.Account.{View,Create,Edit,Enable,Disable}`. No `Delete` code exists.
- Naming convention: `Module.Entity.Action`. The file states the rule: *"ONLY the
  codes the module enforces are registered"*, and *"No wildcards, no superuser, no
  implicit bypass (OQ-21)"*.
- Enforcement is two-layer and exact-match: `@RequirePermission` +
  `AuthorizationGuard` (fails **closed** with 500 when a route declares no
  permission) at transport, and
  `AuthorizationService.requireAllPermissions([...])` inside every application
  service method (so a direct service caller is bounded like an HTTP caller).
- Organization authority is **ODR-3**: `OrganizationsService.assertOrganizationInScope`
  = deployment pin (ADR-0025) → principal→`organization_memberships` binding →
  otherwise `EntityNotFound` (404, never 403). `requireUsableOrganization` wraps it
  and adds existence + `is_active`.

### 2.4 Ledger interaction — and how "used" is actually detected

| Consumer | Reference | Delete posture |
|---|---|---|
| `accounting.accounting_document_lines.account_id` | FK → `accounts.id` | `RESTRICT` |
| `accounting.ledger_entries.account_id` | FK → `accounts.id`, index `(organization_id, account_id)` | `RESTRICT` |
| `accounting.account_balance_projections.account_id` | FK → `accounts.id` | `RESTRICT` |
| Reports (General Ledger, Trial Balance, Account Statement) | `accounting-read-query.repository.ts` joins `accounts` and derives `role = CASE WHEN is_postable THEN 'POSTING' ELSE 'AGGREGATION' END` | read-only |

**Usage predicate (critical, and different from the wording used in Tasks 20/21).**
The repository has **no ledger-based** "account was used" predicate. The only
predicate is document-line based:

- `AccountingDocumentLinesRepository.countForAccount(accountId)` — service pre-check;
- `countReferencingLinesInTx(...)` — re-counted **under the account's `FOR UPDATE`
  lock** inside `AccountsRepository.updateChecked`.

Consequences that Task 24 must state rather than re-decide:

1. A **draft** voucher line already freezes `parentId`/`level`/`accountNature`/`isPostable`.
   That is **stricter** than the Task 20/21 wording "after accounting use".
2. A ledger-used account is necessarily document-line-referenced
   (`ledger_entries.voucher_line_id` is a unique FK to a document line, and final
   documents are never deleted), so ledger-used accounts are already frozen for the
   four structural fields. This is an **inference from FKs**, not an explicit rule
   in code — it is not covered by a dedicated regression test today.
3. `code` is stricter still: immutable from creation, with **no field on the update
   DTO at all** — stricter than OD-20-4, which permits pre-use correction. ADR-0033
   records this as baseline discrepancy **D-2**.

**Posting-path account checks (already implemented, must not be weakened):**

- `AccountingDocumentsService.requireUsableAccounts` — pre-flight: in-organization +
  active (`requireUsableAccountInOrganization`) + `isPostable`, else 422
  `account_not_postable`.
- `lockAccountsForLinesInTx` in `accounting-documents.repository.ts` — authoritative,
  under `FOR SHARE`, on **four** write paths (compose, replace-lines, finalize,
  reverse): rejects `account_not_found`, `account_not_postable`, `account_disabled`.
- `PostingReadinessService` / `domain/posting-readiness.ts` deliberately **excludes**
  `isActive` from readiness ("`isActive` is deliberately absent (§8.6)").

So today: **deactivating an account blocks finalization of an already-composed
voucher that references it.** That is existing, tested behaviour, not a Task 24
decision.

### 2.5 Task 23 (Base Chart) — implemented state

Merged in the baseline commit (PR #66). Five tables (`base_chart_templates`,
`…_template_versions`, `…_template_levels`, `…_template_nodes`,
`base_chart_adoptions`), migration `20260926010000_accounting_base_chart`, three
permissions (`Accounting.BaseChart.{View,Configure,Adopt}`), adoption = copy into
ordinary `accounts` rows, adoption refused into a non-empty chart (409),
`(organization, template_version)` unique. **`accounts` received no template FK,
no provenance column, and no `is_mandatory` column** (Task 23 report §5, §11).

### 2.6 Documentation ↔ code discrepancies found (recorded, NOT reconciled)

| # | Discrepancy | Evidence | Task 24 handling |
|---|---|---|---|
| **D-1** | **Task 23 is merged but ungoverned.** No row in `STATE.md` §7, no row in `docs/accounting/task-index.md` §2, `STATE.md` §8 still says the current item is Task 22, and no `task-23-acceptance-record.md` exists. Its own report says `READY FOR REVIEW — NOT ACCEPTED`. | `grep "Task 23" STATE.md` → 0 hits; `docs/tasks/task-23/task-23-implementation-report.md` §1 | Prerequisite for the Owner; **Task 24 must not self-reconcile it.** |
| **D-2** | **Task 24 is not admitted to the task index.** `docs/accounting/task-index.md` §7 makes index admission a hard precondition for any implementation agent. | task-index §7 | Listed in Required Decisions (§16). |
| **F-1** | **Accounts LIST skips the ODR-3 chokepoint.** `listAccounts` calls only `requireAllPermissions`; `assertOrganizationInScope` runs only on the `parentId` branch. A principal holding `Accounting.Account.View` who is **not** a member of organization X receives X's accounts by passing `organizationId=X`. The deployment pin is skipped on this path too. | `accounts.service.ts` `listAccounts` body; `authorization.guard.ts` (permission only); `app.module.ts` (no global guard) | **Candidate IN-SCOPE, Owner decision required** (§4.1). |
| **F-2** | The same list posture exists in `financial-areas`, `fiscal-years`, `accounting-periods`, `coding-structures` services. The Organization module's `/branches` list **does** 404 for a foreign organization (`backend/test/deployment-scope.e2e-spec.ts`). So Accounting lists deviate from the accepted module posture. | services above; deployment-scope e2e | **OUT OF SCOPE for Task 24** (drive-by refactor). Recommend a dedicated ODR-3 completion task. |
| **F-3** | A source comment in `coding-structure-accounts.spec.ts` claims "the HTTP surface is confined by the global pin guard". **No global pin guard exists** (`app.module.ts` registers no `APP_GUARD`). The test passes only because the foreign fixture organization owns no rows. | `app.module.ts`; spec comment near the pinned-organization test | Recorded; correction belongs with F-1/F-2, not invented here. |
| **F-4** | `enable`/`disable` route through `AccountsRepository.update()` — the **unguarded** patch method — so they bypass the `updateChecked` lock/validation path entirely. | `accounts.service.ts` `setActive` → `repository.update` | Recorded. Any guard added here is OQ-25 policy → **not Task 24**. |
| **F-5** | Task 21 §5/§9 proposes "a mandatory account cannot be deactivated", but Task 23 deliberately did **not** copy `is_mandatory` onto `accounts` and added no provenance column. The rule is therefore **not expressible** against current data. | task-21 baseline §5/§9; Task 23 report §11, §20 | `OWNER / DOMAIN DECISION REQUIRED`; excluded from Task 24 (§5). |
| **F-6** | `ACCOUNT_*` domain events are published to an in-memory bus with no outbox/`core.domain_events` table, so "lifecycle is auditable" cannot be claimed end-to-end. | `.vardena/project-context.md`; `kernel/events` | Recorded; no audit redesign in Task 24 (§5). |

### 2.7 Capability table (the requested matrix — only verified capabilities)

| Capability | Current State | Existing API / Code | Task 24 Need |
|---|---|---|---|
| Account list | **EXISTS** | `GET /api/v1/accounts`; `AccountsService.listAccounts`; `AccountsRepository.list` | Organization-scope completion (F-1) + regression lock; otherwise none |
| Account filtering | **EXISTS** (`parentId`, `level`, `isActive`, `isPostable`, `codingStructureVersionId`) | `ListAccountsQueryDto` | none |
| Account search | **EXISTS** (case-insensitive substring on code or title, ≤120 chars) | `ListAccountsQueryDto.search`; `accounts.repository.ts` filter builder | none |
| Account sort | **EXISTS**, allow-listed, default `code asc` | `resolveSort(..., SORTABLE_FIELDS, [{code:'asc'}])` | none |
| Account pagination | **EXISTS**, bounded | `PageQueryDto`, `toOffset`, `toPaginatedResult` | none |
| Account detail | **EXISTS** | `GET /api/v1/accounts/:id` | none |
| Account tree | **EXISTS as ODR-2 flat projection** (fixed order, inactive included, explicit `sort` rejected). There is **no nested/materialized tree endpoint**. | `GET /api/v1/accounting/chart-tree[/:id]`; `ChartTreeService` | **must not change** |
| Account create | **EXISTS** | `POST /api/v1/accounts`; `createChecked` under locks | none |
| Account update | **EXISTS** (title, nature, postability, parent; **no code**) | `PATCH /api/v1/accounts/:id`; `updateChecked` under locks | none |
| Activate / deactivate | **EXISTS, UNGUARDED** | `POST /:id/enable`, `POST /:id/disable`; `setActive` → unguarded `update` | **document + regression-lock only**; new guards are OQ-25 |
| Account deletion | **DOES NOT EXIST BY DESIGN** | no endpoint, no permission, FKs `RESTRICT` | **must stay absent** |
| Parent validation | **EXISTS** | `planAccountPlacement` (`parent_not_found`, `parent_disabled`, `parent_postable`, `version_mismatch`, `depth_exceeded`) | none |
| Self-parent prevention | **EXISTS** | `self_parent` problem | regression lock |
| Cycle prevention | **EXISTS** | `cycle` problem + `collectDescendantIds`, re-checked under locks | regression lock |
| Level derivation/consistency | **EXISTS** (root = 1, child = parent+1, never client input) | `planAccountPlacement`; DTO has no `level` | none |
| Leaf-only posting invariant | **EXISTS, two-sided** (`parent_postable` on create/move; `postable_with_children` on flip) | `planPostabilityChange`; child count under node lock | regression lock |
| Posting-time validation | **EXISTS** (active + postable + in-organization, pre-flight and under `FOR SHARE`) | `requireUsableAccounts`; `lockAccountsForLinesInTx` | must not weaken |
| Pin coherence (ODR-1) | **EXISTS** | `planPinCoherence`; `AccountPinsIncoherentError` → 422; existing divergent rows **not repaired** (OQ-62) | must not repair |
| Organization isolation (by-id paths) | **EXISTS** | `mustFindInOrganization` → `assertOrganizationInScope`; foreign id → 404 | none |
| Organization isolation (list path) | **PARTIAL — GAP (F-1)** | `listAccounts` | **candidate IN-SCOPE** |
| Immutability after use | **EXISTS**, predicate = document-line reference (incl. drafts) | `planAccountEdit`; `countForAccount` / `countReferencingLinesInTx` | document + regression lock |
| Code immutability | **EXISTS, stricter than OD-20-4** (immutable from creation; no DTO field) | `UpdateAccountDto`; ADR-0033 D-2 | **must not relax** (needs OQ-36 + a producer) |
| Audit fields | **EXISTS** (`created_by`/`updated_by`) | schema + `getPrincipal()` | none |
| Audit trail / event durability | **DOES NOT EXIST** (in-memory bus only) | `kernel/events` | out of scope (§5) |
| Account ↔ template provenance | **DOES NOT EXIST BY DESIGN** | Task 23 report §5/§11 | out of scope (§5) |
| Mandatory-account marker on `accounts` | **DOES NOT EXIST** | Task 23 report §11 | out of scope (F-5) |

---

## 3. Problem Statement

### 3.1 The proposed framing, tested against the repository

> *"After Base Chart adoption an organization owns real, ledger-owned Accounts and
> needs a bounded, safe lifecycle for exactly those Accounts, without Task 24
> becoming Base Chart content governance, chart upgrade, an accounting transaction
> engine, or a master-data redesign."*

The **boundary half** of that framing is correct and is fully supported by
OD-20-1/OD-20-5, the Task 21 three-layer baseline, and the four Task 23 invariants.

The **need half** is **only partially correct**, and the repository says why: the
bounded lifecycle already exists (`create`, `edit`, `enable`, `disable`, freeze-over-delete,
leaf-only posting, `RESTRICT` everywhere). What does **not** exist is either
(a) already-deferred *policy* (OQ-25 / OQ-36), or (b) an *isolation/regression* gap.

### 3.2 Corrected Problem Statement (repository-grounded)

> After Base Chart adoption, an organization's chart consists of ordinary
> `accounting.accounts` rows that are already ledger identity
> (`ledger_entries.account_id → accounts.id`). The **mechanism** for managing those
> rows exists and is lock-guarded; the **two real defects** are that
> (1) the Account **list** surface does not pass through the accepted ODR-3
> organization chokepoint, and (2) the actually-enforced lifecycle semantics —
> especially "used" meaning *document-line referenced (including drafts)* rather
> than *ledger-posted*, and deactivation having **no** preconditions — are neither
> documented as the authoritative contract nor locked by regression tests, so a
> later change could silently break Task 23's invariants or the posting path.
>
> Task 24 therefore closes the isolation gap on its own slice and converts the
> *de facto* lifecycle into an explicitly documented, regression-locked contract.
> It **introduces no new lifecycle rule**: every candidate new rule (deactivate a
> used account, cascade to children, block activation under an inactive parent,
> protect mandatory accounts, delete, reuse codes, pre-use code correction) is an
> open accounting decision and is registered as a dependency, not implemented.

---

## 4. Proposed Scope

Scope is split into **Scope A** (implementable today, no open decision required) and
**Scope B** (explicitly deferred, dependency-gated). Task 24 = Scope A only.

### 4.1 IN-SCOPE (Scope A)

Each item satisfies all five admission rules: applies to organization-owned accounts,
is meaningful after adoption, preserves ledger identity, is consistent with Task 20 /
Task 21, and needs no new Open-Question decision.

**A-1 — Account read surface: organization-isolation completion (F-1).**
`GET /api/v1/accounts` is routed through the same `assertOrganizationInScope`
chokepoint every by-id Account path already uses, before any row is read.
- Behavioural effect: a non-member (or out-of-pin) `organizationId` answers **404
  `EntityNotFound`** instead of `200 {items: [], total: 0}` / instead of the foreign
  organization's rows.
- This is a **documented API contract change** (§8.1) and the only reason Scope A is
  not risk-`LOW` end to end. **Owner approval required** before implementation.
- Bounded to `AccountsController`/`AccountsService`. The identical posture in
  financial areas / fiscal years / periods / coding structures (**F-2**) is **NOT**
  touched — that would be drive-by refactor; it is recorded as a separate finding.

**A-2 — Account read surface: no functional change otherwise.**
List/search/filter/sort/paging, detail, and the ODR-2 chart tree are confirmed
sufficient and are **frozen** by regression tests (§12). No new read endpoint.

**A-3 — Lifecycle semantics: documentation + regression locking, no policy change.**
The currently enforced matrix (§11) is written down as the authoritative Task 24
contract and locked by tests:
- who may act: `Accounting.Account.Enable` / `Accounting.Account.Disable` **plus**
  ODR-3 membership of the owning organization;
- validations that exist: existence + organization scope only; idempotent no-op when
  the flag already holds the target value;
- a ledger-used account **is** deactivatable today;
- deactivation does **not** cascade to children;
- a parent **is** deactivatable today;
- an inactive account **cannot** receive new document lines and **cannot** be part of
  a finalization (`account_disabled`), and **cannot** receive new children
  (`parent_disabled`); it remains fully readable in lists, tree and all reports.

**A-4 — Account integrity regression suite (no behaviour change).**
Executable coverage for rules that exist but are under-tested at the boundary:
self-parent, cycle, `parent_disabled`, `parent_postable`, `postable_with_children`,
`depth_exceeded`, `version_mismatch`, `restructure_with_children`, level derivation,
ODR-1 pin coherence on create/move, and cross-organization 404 on every Account verb.

**A-5 — Account identity protection: assertion, not new mechanism.**
Locks by test that `Account.id` is never rewritten by any Account verb, that
`ledger_entries.account_id` still resolves to the same `accounts.id` after
title/nature/postability/parent edits and after enable/disable, that no Account row
carries a template identity, and that `code` remains absent from the update surface.
Explicitly per **OD-20-4** and **OQ-36**: no code-mutation capability is added
(see B-5).

**A-6 — Documentation deliverables** (§15): the pre-implementation report, the
implementation report, the task-index row, and the `STATE.md` update — **no**
acceptance record.

### 4.2 Scope B — identified, designed, NOT implemented by Task 24

| ID | Candidate capability | Why it is not in Task 24 |
|---|---|---|
| **B-1** | Refuse deactivation of an account with ledger activity / non-zero balance / activity in an open year | `domain-contract.md` §8.6 assigns this verbatim to **OQ-25** |
| **B-2** | Cascade or block deactivation when children are active; block activation while an ancestor is inactive | No decision exists anywhere in the repository — `OWNER / DOMAIN DECISION REQUIRED` |
| **B-3** | Protect mandatory Base Chart accounts from deactivation (Task 21 §5) | Not expressible: no `is_mandatory` / provenance on `accounts` (**F-5**); needs OQ-25 content + a provenance decision |
| **B-4** | Ledger-based "used" predicate distinct from the document-line predicate | Changing the freeze predicate changes accepted AC-I-11 behaviour; needs an Owner decision |
| **B-5** | Pre-use `code` correction (OD-20-4 / ADR-0033 D-2) | Requires **OQ-36** (reuse/uniqueness interaction) and a producer-bound history design (ADR-0033 §5) |
| **B-6** | Account deletion of unused accounts (ADR-0033 §7 / Q21) | **OQ-36**; and ADR-0033 is only *Proposed* |
| **B-7** | Cross-module ODR-3 completion on the other Accounting list surfaces (**F-2**, **F-3**) | Drive-by refactor relative to Task 24's slice; deserves its own task |
| **B-8** | Durable audit/outbox for Account lifecycle events (**F-6**) | Generic audit redesign — explicitly non-scope (§5) |

---

## 5. Explicit NON-SCOPE

Each line is refused with its repository basis. **None of these may be implemented by
Task 24 under any interpretation.**

| Excluded | Basis |
|---|---|
| Base Chart Template creation / content design | OD-20-1; Task 21 §14.2; Task 23 owns the mechanism |
| Account code catalog, Persian accounting titles, account nature assignments | Task 21 §14.2 ("MUST NOT invent"); OQ-25 |
| Mandatory-account catalog / list | OQ-25; Task 21 §5 (list = DEFERRED) |
| Control Role catalog, Control Role implementation, `Account.control_role` | OD-20-2, OD-20-3; `accounting.prisma` header ("no control-role column anywhere") |
| Dimensions (detail dimensions, groups, items, line assignment) | OD-20-6; OQ-41 |
| Base Chart upgrade / re-adoption / template synchronization (silent or explicit) | Task 21 §4.2; Task 23 report §20/§23 |
| Account deletion; `Accounting.Account.Delete`; soft delete; `deleted_at` | contract §8.6; OQ-36; `accounts.controller.ts` header |
| Account code reuse; code mutation; account-code history table | OD-20-4; OQ-36; ADR-0033 §5 ("no speculative history table") |
| Ledger identity migration; changing `ledger_entries.account_id`; ADR-0035 re-coding service | ADR-0033/0035 (both *Proposed*); Task 23 invariant 1 |
| Voucher posting engine changes; `PostingService`; `finalizeChecked`; reversal | Tasks 10.4–10.8, 14, 15 |
| Accounting transaction UI; any new frontend screen | Task 22 slice is read-only and accepted; no justification exists for a UI in Scope A |
| Treasury (cash/bank/payment/receipt/cheque/settlement) | `.vardena/project-context.md` + task-index scope boundary |
| Inventory accounting integration; source-module posting triggers | not implemented; ADR-0005 territory |
| Financial closing / fiscal-period redesign | Tasks 10.2, 14, ADR-0032 |
| Workflow / approval engine for account changes | OQ-13, OQ-26; ADR-0024 owns workflow |
| Generic audit redesign; outbox; `core.domain_events` | no Audit module exists; ADR-0004 is unimplemented |
| Generic master-data framework; EAV; generic JSONB metadata | AR-29; `accounting.prisma` header; OD-20-6 |
| Microservice extraction | ADR-0001 |
| Repair of divergent ODR-1 pins; LEGACY-configuration reshaping | OQ-62, OQ-63 (both OPEN) |
| Reconciling **D-1** (Task 23 governance rows) or self-admitting Task 24 to the task index | task-index §7; `STATE.md` §6 — Owner authority |
| Promoting any ADR (0031–0037 remain *Proposed*) | Task 20 acceptance record §4 |

**Frontend justification test:** Scope A changes no response *shape*; only the
failure code of one list call for out-of-scope organizations (404 instead of 200).
The Task 22 SPA reads the chart tree, not `GET /api/v1/accounts`, and always operates
inside the principal's own organization context. Therefore **no frontend work is
justified** and none is in scope.

---

## 6. OQ Dependency Matrix

| OQ | Description (abridged from `docs/open-questions.md`) | Does Task 24 (Scope A) depend on it? | Exact dependency boundary | Can Task 24 proceed without resolving it? |
|---|---|---|---|---|
| **OQ-25** | Chart of accounts: coding scheme/levels, mandatory control accounts/roles, restructuring above control level, dimension requirements, statutory layouts. Contract §8.6 explicitly parks here: *"whether an additional guard refuses deactivation while the account has a non-zero balance or activity in an open year"*. | **PARTIAL** | Blocks **B-1, B-2, B-3** only. Does **not** block A-1…A-6, because Scope A adds **no** deactivation guard and **no** chart content. | **YES** for Scope A. **NO** for any new deactivation policy. |
| **OQ-36** | Master-data lifecycle: is `is_active` sufficient forever; deletion eligibility (soft/hard); code reuse after deactivation; code case-sensitivity. Current posture: no deletion, no `*.Delete`, plain unique indexes, codes never reused. | **PARTIAL** | Blocks **B-5** (pre-use code correction) and **B-6** (deletion of unused accounts) *only*. A-5 depends on OQ-36's **existing posture**, not on its resolution: it merely asserts that the posture is preserved. Per the task instruction, OQ-36 must **not** be escalated to a whole-task blocker because of the code-history question. | **YES** for Scope A. **NO** for code mutation / deletion / reuse. |
| **OQ-41** | Detail dimensions: count, requiredness, master-data binding, ownership, area scoping. | **NO** | Scope A touches no dimension artifact; OD-20-6 keeps dimensions at transaction-line level and off `accounts`. | **YES** |
| **OQ-43** | Iranian statutory constraints on the accounting model and its reports (legal books, sealing, retention, Taxpayer System). | **NO** | Scope A produces no report, no layout, no legal claim; ADR-0036 keeps statutory semantics outside `modules/accounting`. | **YES** |
| **OQ-62** | Must an account's two pins describe the same level shape; which wins on disagreement. ODR-1 rejects divergence; **existing divergent rows are not repaired**. | **PARTIAL (read-only)** | Scope A must **not** repair, migrate or block reads of divergent rows; A-4 only regression-locks the existing 422-on-write behaviour. | **YES**, provided no repair is attempted. |
| **OQ-63** | LEGACY fallback level shape for organizations with accounts but no ACTIVE coding version. | **NO** | No migration/backfill in Scope A. | **YES** |
| **OQ-40** | One chart per organization vs per financial area; would widen code uniqueness to `(organization, area, code)`. | **NO** | Scope A adds no `financial_area_id` to `accounts` and no area applicability table; uniqueness untouched. | **YES** |
| **OQ-01 / OQ-22** | Product tenancy (single-organization deployment?) and organizational scope/branches. | **NO** (security invariant already decided) | ODR-3 is implemented and accepted; A-1 *applies* it, it does not decide tenancy. | **YES** |
| **OQ-14 / OQ-19** | Occupational role baselines; administrator self-protection/lockout. | **NO** | Scope A adds no permission code and no role; it uses the five existing Account codes. | **YES** |
| **OQ-21** | Wildcards / superuser. Posture: none. | **NO** (constraint, not dependency) | Scope A must preserve "no wildcard, no bypass". | **YES** |
| **OQ-13 / OQ-26** | Approval workflows, separation of duties. | **NO** | No approval flow for account changes in Scope A. | **YES** |

**Blocking summary for Scope A: none.**
**Blocking for Scope B: OQ-25 (B-1/B-2/B-3), OQ-36 (B-5/B-6), plus Owner decisions
for B-2/B-3/B-4.**

---

## 7. Decision Dependencies

```text
OD-20-1 — Base Chart = versioned Accounting-owned product/database template; adoption = copy
→ Task 24 relies on: adopted rows being ORDINARY organization-owned `accounts` rows,
  manageable by the ordinary Account surface with no template coupling.
→ Task 24 must NOT change: template ownership, adoption-as-copy, or introduce any
  template reference/provenance on `accounts`.

OD-20-2 — Control roles are consumer-first
→ Task 24 relies on: the absence of a role catalog, so lifecycle rules need not
  consider "role-backed account" protection.
→ Task 24 must NOT change: no catalog, no speculative role surface, no role-aware
  deactivation guard.

OD-20-3 — Role assignment is an independent effective-dated artifact
→ Task 24 relies on: `Account.control_role` never existing.
→ Task 24 must NOT change: must not add such a column or an implicit equivalent.

OD-20-4 — Pre-use code correction permitted; post-use code immutable; history producer-bound
→ Task 24 relies on: `code` staying out of the update surface (repository is stricter —
  ADR-0033 D-2) and immutability being preserved.
→ Task 24 must NOT change: must not implement pre-use correction, must not add a code
  history table, must not relax `uq_accounts_organization_id_code`.

OD-20-5 — POSTING = leaf-only; AGGREGATION = reporting/read-time
→ Task 24 relies on: the two-sided leaf invariant (`parent_postable`,
  `postable_with_children`) and the read-time `CASE WHEN is_postable` roll-up.
→ Task 24 must NOT change: no postable parent, no stored aggregation, no double
  counting, no write-time roll-up.

OD-20-6 — Dimensions are transaction-line level
→ Task 24 relies on: `accounts` carrying no dimension column.
→ Task 24 must NOT change: no dimension column, no JSONB/EAV, no ledger widening.

Task 21 baseline (ACCEPTED 2026-09-26) — three-layer boundary, adoption semantics,
mandatory semantics, customization classification, OQ-36 boundary
→ Task 24 relies on: §9's classification (titles always editable; structural edits
  pre-use only) and §10's stage table matching the implemented behaviour.
→ Task 24 must NOT change: must not implement §5's mandatory-deactivation rule
  (not expressible — F-5), must not silently mutate adopted charts, must not
  hardcode four levels.

Task 23 invariants (implementation MERGED; governance NOT ACCEPTED)
  1 Template identity ≠ Ledger identity · 2 Adoption = Copy ·
  3 Posting = Leaf-only · 4 Aggregation = Reporting/read-time
→ Task 24 relies on: all four; they become explicit regression assertions (§12).
→ Task 24 must NOT change: none of them, in any direction.

Task 19 — ODR-1 Explicit Configuration Coherence
→ Task 24 relies on: `planPinCoherence` rejecting divergent pins on create/move.
→ Task 24 must NOT change: must not repair existing divergent rows (OQ-62), must not
  block reads, must not pick a winning pin.

Task 19 — ODR-2 Accounting-owned Chart Tree
→ Task 24 relies on: `GET /api/v1/accounting/chart-tree` as THE tree surface.
→ Task 24 must NOT change: its fixed order, inactive-inclusion, sort rejection, or
  create a second Account master / tree endpoint.

Task 19 — ODR-3 Principal-bound Organization Authorization
→ Task 24 relies on: `assertOrganizationInScope` as the single chokepoint and the
  404-not-403 non-disclosure posture.
→ Task 24 must NOT change: the chokepoint's semantics; A-1 only *routes one more
  path through it*.

ADR-0025 — Single-organization deployment pin
→ Task 24 relies on: the pin being asserted inside `assertOrganizationInScope`.
→ Task 24 must NOT change: pin semantics.

ADR-0006 / ADR-0016 — Granular RBAC, exact-match evaluation, fail-closed guard
→ Task 24 relies on: the five existing Account codes and `requireAllPermissions`.
→ Task 24 must NOT change: no wildcard, no new code, no route without
  `@RequirePermission`.

ADR-0009 — Reporting views / raw SQL policy
→ Task 24 relies on: reports staying read-only consumers of `accounts`.
→ Task 24 must NOT change: no new report, no second read model.

ADR-0033 (Proposed) — `Account.id` permanent; `code` a business identifier
→ Task 24 relies on: id-based references everywhere (lines, ledger, projections).
→ Task 24 must NOT change: must not promote the ADR, must not implement §3 (pre-use
  edit), §5 (history) or §7 (deletion).

ADR-0034 (Proposed) — POSTING vs AGGREGATION accounts
→ Task 24 relies on: `is_postable` being the only exposed posting semantic.
→ Task 24 must NOT change: no `account_type`, no classification vocabulary (OQ-25).

Contract AC-I-11 / §8.4 — structural fields freeze once referenced by a document line
→ Task 24 relies on: `planAccountEdit` + the locked re-count.
→ Task 24 must NOT change: the predicate (document-line based, drafts included)
  without an explicit Owner decision (B-4).

Contract §8.6 — Freeze, never delete
→ Task 24 relies on: `is_active` being the whole lifecycle.
→ Task 24 must NOT change: no delete, no code reuse, and no *new* deactivation guard
  (§8.6 parks that in OQ-25).
```

Task 24 reopens **no** Task 19 / 20 / 21 decision. The only repository-level
contradictions found are **F-1/F-2/F-3** (implementation incompletely realizing the
accepted ODR-3 posture on list surfaces) and **D-1/D-2** (governance records), and
both are reported rather than unilaterally resolved.

---

## 8. API Contract Design

**Design conclusion first: Task 24 proposes ZERO new endpoints and ZERO new
permission codes.** The mutation API already exists; the read API already exists. The
only proposed change is the authorization path of one existing endpoint, plus two
strictly optional additive response fields the Owner may reject without affecting the
rest of the task.

### 8.1 CHANGED — `GET /api/v1/accounts` (A-1, the only contract change)

```text
Method                  GET
Path                    /api/v1/accounts
Purpose                 Paged, filtered, searchable list of ONE organization's accounts
Auth requirement        Authenticated session (AuthGuard, ADR-0007)
Organization scope      MANDATORY `organizationId` query param — UNCHANGED shape.
                        CHANGED enforcement: `assertOrganizationInScope(organizationId)`
                        (deployment pin ADR-0025 → ODR-3 membership) runs BEFORE any
                        repository read, on every request — not only when `parentId`
                        is supplied.
Request shape           UNCHANGED — ListAccountsQueryDto
                        { organizationId: ULID (required),
                          page, pageSize (PageQueryDto bounds),
                          parentId?: ULID, level?: 1..MAX_CODING_STRUCTURE_DEPTH,
                          isActive?: boolean, isPostable?: boolean,
                          codingStructureVersionId?: ULID,
                          search?: string(≤120),
                          sort?: allow-list code|title|level|createdAt|updatedAt }
Response shape          UNCHANGED — PaginatedResponse<AccountResponseDto>
                        (default order `code asc`)
Validation              UNCHANGED (class-validator DTO + allow-listed sort)
Failure cases           401 not authenticated                              (unchanged)
                        403 PermissionDenied — missing Accounting.Account.View (unchanged)
                        400 ValidationFailed — malformed query             (unchanged)
                        404 EntityNotFound — organizationId outside the deployment pin
                            OR the principal holds no membership of it
                            *** CHANGED: previously 200 with the organization's rows
                            (for a non-member) or 200 with an empty page ***
                        404 EntityNotFound — `parentId` not resolvable in scope (unchanged)
Permission              Accounting.Account.View (exact match, unchanged)
Idempotency             N/A (safe GET)
Breaking-change note    Documented in the implementation report and in the OpenAPI
                        description. A client that today probes foreign organizations
                        and expects 200 will receive 404 — which is the accepted
                        ODR-3 non-disclosure posture, identical to
                        GET /api/v1/branches (backend/test/deployment-scope.e2e-spec.ts).
```

### 8.2 UNCHANGED — confirmed sufficient, re-verified, not reopened

| Endpoint | Verdict |
|---|---|
| `GET /api/v1/accounts/:id?organizationId` | already chokepoint-bound; no change |
| `POST /api/v1/accounts` | already chokepoint-bound + lock-guarded; no change |
| `PATCH /api/v1/accounts/:id?organizationId` | freeze semantics correct for Scope A; **no `code` field added**; no change |
| `POST /api/v1/accounts/:id/enable` | semantics documented in §11; **no new precondition** |
| `POST /api/v1/accounts/:id/disable` | semantics documented in §11; **no new precondition** |
| `GET /api/v1/accounting/chart-tree[/:id]` | ODR-2; frozen |
| Task 23 adoption endpoints | frozen |

### 8.3 OPTIONAL, additive — `OWNER DECISION REQUIRED` (default: DEFER)

Two purely additive, backward-compatible response fields on `AccountResponseDto`,
proposed **only** because today a client can discover "this account can no longer be
restructured" *solely by receiving a 422*:

```text
hasChildren:            boolean — derived (EXISTS child) — makes the leaf/aggregation
                        state explicit without a second request
isStructurallyFrozen:   boolean — derived from the EXISTING predicate
                        (countForAccount(accountId) > 0) — i.e. "referenced by at
                        least one accounting document line (drafts included)"
```

Constraints if approved: derived at read time, **no column, no migration, no cache,
no new permission** (both are Account facts already covered by
`Accounting.Account.View`), and both must be computed with bounded queries on the
existing `(organization_id, parent_id)` and `account_id` indexes.
**Default recommendation: DEFER** — no consumer exists today (the Task 22 SPA is
read-only over the chart tree), and AR-29 forbids speculative surface.

A `GET /api/v1/accounts/:id/usage` endpoint was considered and **rejected as
speculative**: it would expose ledger/document counts with no approved consumer and
would blur the Account slice into the reporting surface (ADR-0009).

---

## 9. Permission Matrix

No new code. No wildcard. No bypass. Backend remains the authorization authority
(the frontend's permission awareness is UX only — AR-21).

| Operation | Permission | Organization Scope | Notes |
|---|---|---|---|
| List accounts (`GET /accounts`) | `Accounting.Account.View` | **`assertOrganizationInScope` (A-1 — newly enforced on this path)** | 403 for missing permission; 404 for out-of-scope organization; the two are never conflated |
| Search / filter accounts | `Accounting.Account.View` | same as list | search is a parameter of the same endpoint, not a separate authority |
| Get account detail | `Accounting.Account.View` | `mustFindInOrganization` → `assertOrganizationInScope` | foreign id → 404 |
| Read chart tree (list + node) | `Accounting.Account.View` | `requireUsableOrganization` | ODR-2 surface; unchanged |
| Create account | `Accounting.Account.Create` | `requireUsableOrganization` | unchanged |
| Edit account (title, nature, postability, parent) | `Accounting.Account.Edit` | `mustFindInOrganization` | `code` is not editable at all |
| Activate account | `Accounting.Account.Enable` | `mustFindInOrganization` | distinct code — enabling is not implied by `Edit` |
| Deactivate account | `Accounting.Account.Disable` | `mustFindInOrganization` | distinct code — disabling is not implied by `Edit` |
| Delete account | **NONE — the operation does not exist** | — | no endpoint, no code; FKs `RESTRICT` (contract §8.6, OQ-36) |
| Adopt base chart (context) | `Accounting.BaseChart.Adopt` | scope-bound | Task 23; **must not** be widened to cover account authoring |

Evaluation semantics to preserve: `AuthorizationGuard` fails **closed** (500) when a
route declares no permission; `requireAllPermissions` re-checks inside the service so
direct service callers are bounded identically.

---

## 10. Domain Invariants

Authoritative invariant set for Task 24. Each is already enforced unless marked.

| # | Invariant | Enforcement today | Task 24 action |
|---|---|---|---|
| **I-1 Organization ownership** | Every account belongs to exactly one organization; cross-organization access answers 404, never 403 | by-id paths ✔ · **list path ✘ (F-1)** | A-1 closes the gap; A-4 locks it |
| **I-2 Identity** | `Account.id` (ULID) is the permanent accounting identity; template node identity is never account identity and never ledger identity | ✔ (no template FK on `accounts`; Task 23) | assert (A-5) |
| **I-3 Ledger identity stability** | `ledger_entries.account_id → accounts.id` with `RESTRICT`; no Account operation may repoint or orphan it | ✔ | assert (A-5) |
| **I-4 Hierarchy validity** | Parent must exist, be in the same organization, be active, be non-postable, belong to the same pinned version, and its code must be a prefix; `level` is derived | ✔ `planAccountPlacement` | regression lock (A-4) |
| **I-5 Acyclicity** | No self-parent; no move under one's own descendant | ✔ (`self_parent`, `cycle`, re-checked under locks) | regression lock |
| **I-6 Leaf-only posting** | A postable account can never have children, and an account with children can never become postable | ✔ two-sided | regression lock |
| **I-7 Aggregation is read-time** | Parents/groups have no stored activity; roll-up happens in the read layer | ✔ (`CASE WHEN is_postable`) | assert; no stored aggregation |
| **I-8 Posting eligibility** | Only an in-organization, active, postable account may receive a document line, enforced pre-flight and under `FOR SHARE` on all four write paths | ✔ | must not weaken |
| **I-9 Immutability after use** | Once a document line references the account (drafts included), `parentId`/`level`/`accountNature`/`isPostable` are refused | ✔ `planAccountEdit` + locked re-count | document the exact predicate; do not change it (B-4) |
| **I-10 Code immutability** | `code` is immutable from creation; codes are unique per organization and never reused | ✔ (no DTO field; unique index) | must not relax (OD-20-4 / OQ-36) |
| **I-11 Pin coherence (ODR-1)** | An account's coding-structure version and accounting configuration must describe the same level shape at write time | ✔ pre-flight + under lock | regression lock; **no repair** (OQ-62) |
| **I-12 Freeze over delete** | Accounts are never deleted; `is_active` is the whole lifecycle; history stays readable | ✔ | must not add deletion |
| **I-13 Inactive semantics** | Inactive ⇒ no new children, no new/edited document line, no finalization; still fully readable in list/tree/reports | ✔ | document + regression lock |
| **I-14 Adoption independence** | Organization accounts are independent of the template after adoption; publishing a new template version never mutates them | ✔ (Task 23) | regression lock |
| **I-15 Deactivation preconditions** | Whether usage / children / open-year activity restrict deactivation | **NOT ENFORCED** | **OPEN DECISION → OQ-25 / B-1,B-2** |
| **I-16 Activation preconditions** | Whether an account may be activated while an ancestor is inactive | **NOT ENFORCED** | **OPEN DECISION → B-2** |
| **I-17 Mandatory-account protection** | Whether a mandatory adopted account may be deactivated | **NOT EXPRESSIBLE** (no marker/provenance — F-5) | **OPEN DECISION → OQ-25 / B-3** |

---

## 11. Lifecycle Matrix

Legend — **ENFORCED**: current, verified code behaviour that Task 24 documents and
regression-locks. **OPEN DECISION**: no rule exists; Task 24 implements nothing.

| Current State | Action | Allowed? | Preconditions | Result |
|---|---|---|---|---|
| Active | Deactivate | **YES — ENFORCED** | `Accounting.Account.Disable` + ODR-3 membership + account resolvable in organization. *No* usage/children/balance precondition exists | `is_active=false`; `updated_by/updated_at` set; `Account.Disabled` event (in-memory); new children refused (`parent_disabled`); new/edited document lines and finalization refused (`account_disabled`); all history/reports unchanged and readable |
| Inactive | Activate | **YES — ENFORCED** | `Accounting.Account.Enable` + membership + resolvable. *No* ancestor-state precondition exists | `is_active=true`; `Account.Enabled` event |
| Active | Deactivate (already inactive requested) | **YES, idempotent no-op — ENFORCED** | same | current DTO returned; no write, no event |
| **Used** (document-line referenced, incl. drafts) | Deactivate | **YES — ENFORCED** | same as Active → Deactivate | deactivated. Whether this *should* be refused is **OPEN DECISION — OQ-25** (contract §8.6) |
| **Used** (ledger-posted) | Deactivate | **YES — ENFORCED** (no ledger-based guard exists) | same | deactivated; ledger rows and reports unaffected. **OPEN DECISION — OQ-25 / B-1** |
| Used | Activate | **YES — ENFORCED** | same as Inactive → Activate | activated |
| Parent (has children) | Deactivate | **YES — ENFORCED, no cascade** | same | parent inactive; children keep their own `is_active`; an active postable descendant remains postable. Cascade/blocking is **OPEN DECISION — B-2** |
| Leaf | Deactivate | **YES — ENFORCED** | same | leaf inactive; refused for new lines/finalization |
| Account with active children | Deactivate | **YES — ENFORCED** (see Parent row) | same | as above; **OPEN DECISION — B-2** |
| Child of an inactive parent | Activate | **YES — ENFORCED** (no ancestor check) | same | child active under an inactive ancestor — a state the create path would refuse (`parent_disabled`). **OPEN DECISION — B-2** |
| Inactive | Receive a new child | **NO — ENFORCED** | — | 422 `parent_disabled` |
| Inactive | Be used on a new/edited document line | **NO — ENFORCED** | — | 422 `account_disabled` |
| Inactive | Be part of a finalization | **NO — ENFORCED** (`lockAccountsForLinesInTx`) | — | finalization refused |
| Inactive | Appear in list / chart tree / reports | **YES — ENFORCED** | — | inactive rows are always readable (ODR-2 includes them) |
| Account **with** document-line usage | Modify `title` | **YES — ENFORCED** | `Accounting.Account.Edit` + membership | title updated (identity is `Account.id`) |
| Account **with** document-line usage | Modify `parentId`/`level`/`accountNature`/`isPostable` | **NO — ENFORCED** | — | 422 listing the refused fields ("Create a new account and disable this one instead") |
| Account **without** document-line usage | Modify `title`/`accountNature`/`isPostable`/`parentId` | **YES — ENFORCED, invariant-bounded** | placement table + postability rule + ODR-1 coherence re-checked under locks | updated, or 422 with the specific rule (`cycle`, `parent_postable`, `postable_with_children`, `restructure_with_children`, `depth_exceeded`, `version_mismatch`, …) |
| Any account | Modify `code` | **NO — ENFORCED** (no field exists) | — | request rejected by DTO validation. Pre-use correction = **OPEN DECISION — OD-20-4 + OQ-36 (B-5)** |
| Any account | Delete | **NO — ENFORCED** (endpoint and permission do not exist; FKs `RESTRICT`) | — | not possible. Deletion of unused accounts = **OPEN DECISION — OQ-36 (B-6)** |
| Mandatory adopted account | Deactivate | **YES today** (no marker exists) | same as Active → Deactivate | **OPEN DECISION — OQ-25 / B-3 (F-5: not expressible without provenance)** |

---

## 12. Test / Verification Strategy

Aligned with `docs/testing/test-execution-policy.md`. Heavy PostgreSQL work is **CI's
job**; the agent must not stall on local E2E (`docs/testing/e2e-hang-root-cause.md`).

### 12.1 Fast local gates (FAST-LOCAL — always run by the agent)

| Gate | Command |
|---|---|
| Format | `npm run format:check` |
| Lint | `npm run lint` (0 errors; pre-existing warnings unchanged) |
| Typecheck | `npm run typecheck` |
| Unit / application tests (hermetic) | `npm test` |
| Focused re-run | `npx vitest run src/modules/accounting/...` |
| Build | `npm run build` |
| Prisma validate/generate | `npm run prisma:validate` / `prisma:generate` — delegate to CI if the engine cannot be downloaded, and say so |

Focused application-service tests run against the existing contract-faithful
in-memory fixtures (`coding-structure-accounts.spec.ts`,
`accounting-authorization.spec.ts`, `accounts.repository.spec.ts`).

### 12.2 CI gates (authoritative)

`.github/workflows/ci.yml` `backend` job, in order: prisma validate → generate → lint
→ typecheck → format:check → unit → build → `migrate deploy` (postgres:16) →
`bootstrap:system-admin` → E2E incl. live-DB suites (`VARDENA_TEST_DATABASE_URL`).
The `frontend` job must remain green and untouched.

### 12.3 Task 24 test matrix

| # | Area | Level | Assertion |
|---|---|---|---|
| T-1 | Organization isolation — list | application + live API E2E | A member of Org A with `Account.View` listing `organizationId=OrgB` receives **404 `EntityNotFound`**, and Org B rows are never returned. A member of Org B receives its own rows |
| T-2 | Organization isolation — pin | application | Under a deployment pin, a list naming a non-pinned organization answers 404 |
| T-3 | Organization isolation — by-id verbs | application | get/update/enable/disable with a foreign `organizationId` all answer 404, never 403 (regression) |
| T-4 | Permission enforcement | application + E2E | Each of the five Account codes is required exactly: missing code → 403; `View` never implies `Edit`/`Enable`/`Disable`; no wildcard grants access |
| T-5 | Route protection | unit | Every Account route declares `@RequirePermission` (guard fails closed otherwise) |
| T-6 | List / search / filter | application | `search` matches code and title case-insensitively; `isActive`/`isPostable`/`level`/`parentId`/`codingStructureVersionId` filters work; unknown `sort` falls back to `code asc`; paging bounds respected |
| T-7 | Tree | E2E | `GET /accounting/chart-tree` keeps fixed `code asc`, includes inactive nodes, rejects explicit `sort` (regression, ODR-2) |
| T-8 | Deactivation | application + live | Deactivate → `is_active=false`; new child refused `parent_disabled`; new document line refused `account_disabled`; finalization of an existing draft referencing it refused; reports/statement still return its history |
| T-9 | Activation | application | Activate restores child creation and posting eligibility; repeated activation is an idempotent no-op with no event |
| T-10 | Parent/child integrity | application | `parent_not_found`, `parent_postable`, `version_mismatch`, `depth_exceeded`, `restructure_with_children` each produce their specific 422 rule code |
| T-11 | Cycle prevention | application + live | Self-parent and move-under-own-descendant refused, including under concurrent moves (live) |
| T-12 | Leaf-only posting | application + live | A postable account cannot get a child; an account with children cannot become postable; the ledger contains no entry against a non-leaf account |
| T-13 | Used-account restrictions | application + live | With one document line (draft) present: `title` still editable; `parentId`/`level`/`accountNature`/`isPostable` refused with the exact refused-field list |
| T-14 | Ledger-used ⇒ frozen | live | An account with a finalized voucher line is frozen for the four structural fields (the FK-derived inference made explicit) |
| T-15 | Identity preservation | live | After title/nature/postability/parent edits and after enable/disable, `ledger_entries.account_id` still equals the same `accounts.id`; no row's `id` changed |
| T-16 | Task 23 invariant regression | live | (1) no template identity on `accounts`; (2) publishing template v2 leaves an adopted v1 chart byte-identical; (3) posting stays leaf-only; (4) parent figures come only from read-time roll-up |
| T-17 | ODR-1 coherence | application | Divergent pins still 422 on create/move; **existing divergent rows are still readable and are not repaired** |
| T-18 | No deletion surface | unit | No `DELETE /accounts/*` route and no `Accounting.Account.Delete` code is registered |
| T-19 | Accounting regression | CI | Existing accounting unit + live suites remain green, notably `account-structure*.e2e-spec.ts`, `chart-tree.e2e-spec.ts`, `accounting-documents*-live`, `ledger-entries-live`, `base-chart-*-live` |

**Tests deliberately NOT written, with reason:**
- no test asserting deactivation is refused for used accounts — **no such rule exists**
  (OQ-25 / B-1);
- no cascade/ancestor-activation test — **no such rule exists** (B-2);
- no mandatory-account protection test — **not expressible** (F-5 / B-3);
- no code-mutation or deletion test — **capabilities intentionally absent** (OQ-36);
- no new mutation-API test beyond the existing verbs — **no new mutation API is
  proposed** (§8).

---

## 13. Acceptance Criteria

Every criterion is binary (`PASS` / `FAIL`) and checkable from the repository or a CI
run.

**Functional**
1. `GET /api/v1/accounts` returns 404 `EntityNotFound` for an organization the
   principal is not a member of, and for an organization outside the deployment pin.
2. `GET /api/v1/accounts` returns the caller's own organization's accounts unchanged
   in shape, order and paging.
3. Existing filters (`parentId`, `level`, `isActive`, `isPostable`,
   `codingStructureVersionId`), `search`, allow-listed `sort` and paging behave
   exactly as before.
4. `GET /accounts/:id`, `POST /accounts`, `PATCH /accounts/:id`,
   `POST /accounts/:id/enable`, `POST /accounts/:id/disable` behave exactly as before
   (no new precondition, no new failure code).
5. `GET /api/v1/accounting/chart-tree[/:id]` behaviour is bit-for-bit unchanged.
6. The lifecycle matrix of §11 is reproduced by executable tests, with every
   `OPEN DECISION` row asserted as *current behaviour* and labelled as unresolved in
   the implementation report.

**Accounting correctness**
7. No `accounts` row carries a template identity or provenance reference.
8. No ledger entry, document line or projection row references a template id.
9. Every ledger entry references an `is_postable = true` leaf account.
10. No parent/group account receives stored activity; parent figures are produced
    only at read time.
11. `ledger_entries.account_id` values are unchanged by every Task 24 operation.

**Security**
12. Each Account operation requires exactly its declared permission; none implies
    another.
13. No wildcard, superuser, role-name check or test-only authorization path exists.
14. Cross-organization access answers 404 (never 403, never 200) on **every** Account
    route, list included.
15. No route lacks `@RequirePermission`.

**Data integrity**
16. No cycle, self-parent or level inconsistency is creatable through any Account
    verb.
17. No invalid parent relation (foreign, inactive, postable, wrong pinned version,
    depth-exceeding) is creatable.
18. No `Account.id` is mutated; no `code` mutation path exists.
19. No divergent ODR-1 pin row is modified or repaired.
20. Zero schema change: `git diff` contains no file under `backend/prisma/schema/` or
    `backend/prisma/migrations/`.

**Regression**
21. `npm test` (unit) fully green, with no pre-existing test deleted, skipped or
    weakened.
22. CI `backend` job green end to end, including live PostgreSQL suites; no step
    skipped or `continue-on-error`.
23. CI `frontend` job green and unmodified.
24. Task 23 live suites (`base-chart-live`, `base-chart-api-live`) green.
25. The only documented API contract change is the `GET /api/v1/accounts`
    authorization outcome; the OpenAPI document records it.

**Documentation**
26. `docs/tasks/task-24/task-24-pre-implementation-report.md` exists.
27. `docs/tasks/task-24/task-24-implementation-report.md` exists and separates local
    from CI evidence.
28. `docs/accounting/task-index.md` §2 gains a Task 24 row (after Owner admission per §7).
29. `STATE.md` §7 gains a Task 24 row and §8 is updated.
30. OQ-25 / OQ-36 / OQ-41 / OQ-43 / OQ-62 / OQ-63 are referenced and explicitly
    recorded as **still OPEN**; no OQ is closed and no ADR is promoted.
31. **No acceptance record is produced** by the implementing agent.

---

## 14. Definition of Done

Task 24 is done when **all** of the following hold:

1. **Implementation** — only the approved Scope A change is present; `git diff` shows
   no unrelated file; no drive-by refactor (F-2/F-3 untouched).
2. **Migrations** — **none.** Scope A requires no schema change; the presence of a
   migration is itself a DoD failure (AG-08 applies only if a DB change were truly
   required, and it is not).
3. **OpenAPI** — the `GET /api/v1/accounts` description documents the 404 scope
   outcome; generated types remain consistent (ADR-0014).
4. **Permissions** — the five Account codes unchanged; no code added or removed; the
   registry count changes by zero.
5. **Tests** — the §12.3 matrix implemented at the stated levels; denial paths tested
   alongside success paths (AG-06, AG-13); no `.only`, no `.skip` beyond the
   established `skipIf(VARDENA_TEST_DATABASE_URL === undefined)` live convention.
6. **CI** — one linked run with `backend` and `frontend` both green, no skipped
   required step; the run id recorded in the implementation report.
7. **Local fast gates** — format, lint, typecheck, unit, build recorded as executed
   locally; anything delegated to CI stated explicitly as delegated, never claimed.
8. **Documentation** — AG-07 satisfied: `docs/modules.md` Accounting entry and any
   affected accounting doc updated in the same change; the implementation report
   follows the Task 23 report structure.
9. **Implementation report** — includes baseline commit, files changed, the exact
   behavioural delta, evidence table (local vs CI), scope exclusions, remaining OQs,
   known limitations, and an explicit "acceptance NOT performed" statement.
10. **No unresolved blocking OQ** — Scope A has none; every Scope B item is recorded
    with its blocking OQ/decision and is demonstrably absent from the diff.
11. **No accidental scope expansion** — none of the §5 exclusions appears anywhere in
    the diff (checked by an explicit grep list in the report: `control_role`,
    `is_mandatory` on accounts, `DELETE`, `deleted_at`, `dimension`, `template_node_id`,
    `code` on the update DTO).
12. **No self-acceptance** — status ends at `READY FOR REVIEW — NOT ACCEPTED`; no
    acceptance record file is created; `STATE.md` §6 language respected.
13. **Governance prerequisites honoured** — Task 24 was admitted to
    `docs/accounting/task-index.md` §2 by the Owner *before* implementation started
    (§7 of that document).

---

## 15. Required Deliverables

Repository convention check: `docs/tasks/task-NN/` is the established layout
(task-16 … task-23). Task 23 used `task-23-draft-brief.md`,
`task-23-decision-analysis.md`, `task-23-pre-implementation-report.md`,
`task-23-implementation-report.md`; Tasks 19/20 added `*-implementation-gate.md` and
`*-acceptance-record.md`. The proposal below is consistent with both.

```text
docs/tasks/task-24/
├── task-24-scope-design-gate.md          ← THIS DOCUMENT (exists, review stage)
├── task-24-pre-implementation-report.md  ← produced at implementation kickoff:
│                                            re-verified baseline, final scope,
│                                            decision log, risk register
├── task-24-implementation-report.md      ← produced at completion: evidence,
│                                            local vs CI, exclusions, OQ status
└── task-24-acceptance-record.md          ← ONLY after Owner acceptance.
                                             MUST NOT be created by the agent.
```

Additional required (non-`docs/tasks/`) updates at implementation time:

| Artifact | Update |
|---|---|
| `docs/accounting/task-index.md` | §2 Task 24 row + status; §8 follow-ups gain F-2/F-3 (the cross-module list posture) as recorded findings |
| `STATE.md` | §7 Task 24 row; §8 current-task update; §10 risk entry for the `GET /accounts` contract change |
| `docs/modules.md` | Accounting entry: the Account lifecycle contract as documented in §11 |
| `docs/open-questions.md` | **No question opened or closed.** Reference-only annotations for OQ-25/OQ-36 if the Owner asks; otherwise untouched |
| OpenAPI | regenerated/annotated for the single description change |

Explicitly **not** produced: any ADR (none is required — no architecture changes), any
acceptance record, any seed, any migration, any frontend artifact.

---

## 16. Task 24 Design Gate

```text
TASK 24 DESIGN GATE
===================

Status:
  READY FOR OWNER REVIEW   — for Scope A (bounded)
  BLOCKED                  — for Scope B (lifecycle policy), pending OQ-25 / OQ-36
                             and three Owner/domain decisions

In-Scope (Scope A):
  A-1  Route GET /api/v1/accounts through assertOrganizationInScope
       (ODR-3 + deployment pin) on EVERY request — closes finding F-1.
       Documented API contract change: out-of-scope organization → 404.
  A-2  Confirm and FREEZE the existing read surface
       (list/search/filter/sort/paging, detail, ODR-2 chart tree) — no new endpoint.
  A-3  Document the ACTUAL lifecycle semantics (§11) as the authoritative
       contract — activate/deactivate keep exactly today's preconditions.
  A-4  Regression-lock account integrity: parent validity, self-parent, cycles,
       level derivation, leaf-only posting (both sides), ODR-1 pin coherence,
       cross-organization 404 on every verb.
  A-5  Assert identity protection: Account.id immutable, ledger_entries.account_id
       stable, no template identity on accounts, code not mutable.
  A-6  Documentation deliverables (§15) — no acceptance record.

Non-Scope:
  Base Chart template creation/content; account codes, Persian titles, natures,
  mandatory catalog; Control Role catalog/implementation/Account.control_role;
  Dimensions; Base Chart upgrade or any template synchronization; account deletion;
  code mutation, code reuse, code-history table; ledger identity migration;
  posting/voucher engine; accounting transaction UI; ANY frontend; Treasury;
  Inventory accounting integration; closing/fiscal-period redesign; workflow or
  approval engine; generic audit/outbox redesign; generic master-data framework;
  EAV or generic JSONB; microservice extraction; ODR-1 pin repair (OQ-62/OQ-63);
  the identical list-scope gap in financial areas / fiscal years / periods /
  coding structures (finding F-2 — separate task); reconciliation of the Task 23
  governance records (finding D-1 — Owner authority).

Blocking OQs:
  For Scope A: NONE.
  For Scope B:
    OQ-25 → B-1 (deactivate a used / non-zero-balance / open-year-active account)
            B-2 (children cascade + ancestor-aware activation, jointly with an
                 Owner decision — no OQ text covers it today)
            B-3 (mandatory-account deactivation protection)
    OQ-36 → B-5 (pre-use code correction, OD-20-4 / ADR-0033 D-2)
            B-6 (deletion of unused accounts, ADR-0033 §7)

Non-Blocking OQs:
  OQ-41 (dimensions), OQ-43 (statutory), OQ-40 (per-area charts),
  OQ-01 / OQ-22 (tenancy), OQ-14 / OQ-19 (roles, admin protection),
  OQ-21 (wildcards — a constraint, already satisfied),
  OQ-62 / OQ-63 (pin coherence + legacy shape — non-blocking ONLY while Task 24
  performs no repair and blocks no read).

Required Decisions (Owner, before implementation):
  R-1  Admit Task 24 to docs/accounting/task-index.md §2 (§7 makes this mandatory
       before any implementation agent may start).
  R-2  Approve A-1 and its API contract change (GET /api/v1/accounts →
       404 for a non-member / out-of-pin organization), OR reject it and reduce
       Task 24 to documentation + regression locking only.
  R-3  Decide the optional additive response fields hasChildren /
       isStructurallyFrozen (§8.3). Default recommendation: DEFER.
  R-4  Confirm that NO new lifecycle guard is expected from Task 24 (i.e. B-1/B-2/B-3
       stay deferred), OR resolve OQ-25 first and commission Task 24B.
  R-5  Decide how findings F-2/F-3 are handled (dedicated ODR-3 completion task
       recommended) — they must not be absorbed into Task 24.
  R-6  Decide the governance handling of Task 23 (finding D-1): merged implementation
       with no task-index row, no STATE.md row and no acceptance record.

Implementation Risk:
  LOW overall for Scope A.
  MEDIUM for A-1 alone — it is a behavioural contract change on an existing
  endpoint (200 → 404 for out-of-scope organizations). Mitigations: it restores
  the accepted ODR-3 posture, mirrors the already-tested /branches behaviour,
  is confined to one service method, changes no response shape, and is covered
  by T-1/T-2/T-3.
  Residual risk if R-2 is rejected: the cross-organization read exposure on
  GET /api/v1/accounts remains open and must be tracked as a security risk in
  STATE.md §10.

Repository Contradictions (recorded, NOT reconciled here):
  D-1  Task 23 implementation is merged in main, but has no STATE.md §7 row, no
       task-index §2 row, and no acceptance record; its own report says
       "READY FOR REVIEW — NOT ACCEPTED", while STATE.md §8 still names Task 22
       as the current item.
  D-2  Task 24 is not admitted to the task index, which §7 requires before
       implementation.
  F-1  AccountsService.listAccounts enforces permission only; the ODR-3 /
       deployment-pin chokepoint runs only on the parentId branch.
  F-2  The same posture exists in financial-areas, fiscal-years,
       accounting-periods and coding-structures list services, while the
       Organization module's /branches list answers 404 for a foreign
       organization — an inter-module inconsistency.
  F-3  A spec comment asserts a "global pin guard" on the HTTP surface;
       app.module.ts registers no global guard.
  F-4  enable/disable write through the UNGUARDED AccountsRepository.update(),
       bypassing the locked updateChecked path.
  F-5  Task 21 §5's "mandatory accounts cannot be deactivated" is not expressible:
       Task 23 deliberately stores no is_mandatory / provenance on accounts.
  F-6  Account lifecycle events are in-memory only (no outbox, no audit module),
       so end-to-end lifecycle auditability cannot be claimed.
  D-3  Terminology drift: Tasks 20/21 say "after accounting use", while the code's
       freeze predicate is "referenced by any document line, drafts included",
       and `code` is stricter still (immutable from creation — ADR-0033 D-2).

Recommended Next Step:
  1. Owner resolves R-1 and R-2 (and ideally R-3…R-6).
  2. If R-2 = APPROVED → implement Scope A exactly as specified, on this branch,
     with no schema change and no new permission code, then open a PR at
     READY FOR REVIEW — NOT ACCEPTED.
  3. If R-2 = REJECTED → Task 24 becomes documentation + regression locking only
     (A-2…A-6), and F-1 is escalated to STATE.md §10 as an open security risk.
  4. Scope B stays closed until OQ-25 and OQ-36 receive Owner/accountant decisions;
     it should then be commissioned as Task 24B, not folded back into Task 24.
```

---

### Appendix — Evidence index

| Claim area | Primary evidence |
|---|---|
| Account model / indexes / FKs | `backend/prisma/schema/accounting.prisma` |
| Placement, edit, postability, pin rules | `backend/src/modules/accounting/domain/account.ts`, `account-code.ts`, `hierarchy.ts` |
| Service behaviour incl. the F-1 gap | `backend/src/modules/accounting/application/accounts.service.ts` |
| Lock discipline | `backend/src/modules/accounting/data/accounts.repository.ts`, `accounting-locks.ts` |
| Routes + "no DELETE" | `backend/src/modules/accounting/api/accounts.controller.ts` |
| Permissions | `backend/src/modules/accounting/domain/accounting-permissions.ts` |
| ODR-3 chokepoint | `backend/src/modules/organization/application/organizations.service.ts` |
| Guard semantics | `backend/src/modules/rbac/application/authorization.guard.ts`, `authorization.service.ts`; `backend/src/app.module.ts` (no global guard) |
| Posting-time account checks | `backend/src/modules/accounting/application/accounting-documents.service.ts`; `data/accounting-documents.repository.ts` (`lockAccountsForLinesInTx`) |
| Usage predicate | `backend/src/modules/accounting/data/accounting-document-lines.repository.ts` |
| Read-time aggregation | `backend/src/modules/accounting/data/accounting-read-query.repository.ts` |
| Chart tree (ODR-2) | `backend/src/modules/accounting/api/chart-tree.controller.ts`, `application/chart-tree.service.ts` |
| Task 23 | `docs/tasks/task-23/task-23-implementation-report.md`; migration `20260926010000_accounting_base_chart` |
| Task 21 governance | `docs/tasks/task-21/task-21-governance-baseline.md` §5, §9, §10, §14 |
| Task 20 decisions | `docs/tasks/task-20/task-20-acceptance-record.md` §2 |
| Contract | `docs/accounting/domain-contract.md` §8.3–§8.7, §9.2, §14 |
| Open questions | `docs/open-questions.md` (OQ-25, 36, 40, 41, 43, 62, 63) |
| Testing policy / CI | `docs/testing/test-execution-policy.md`, `.github/workflows/ci.yml` |
| Governance state | `STATE.md` §6, §7, §8; `docs/accounting/task-index.md` §2, §7, §8 |
