# Task 23 — Base Chart Implementation & Adoption: Pre-Implementation Report (§19)

- **Document type:** pre-implementation inspection report — **DOCUMENTATION ONLY**
- **Date:** 2026-09-26
- **Task status:** **NOT ADMITTED / NOT IMPLEMENTED — stopped at the §19 / §22 boundary**
- **Branch:** `arena/01a0df43-vardena` · **Baseline:** `main` @ `b0d9337` (merge of PR #62)
- **Task 21 status re-baselined:** 2026-09-27 against current `main` — Task 21 is **ACCEPTED (2026-09-26)**; documentation-consistency correction only (see §0.1). No plan, scope, decision request or classification in §1–§7 was changed by that correction.
- **Produced against:** [`task-23-draft-brief.md`](./task-23-draft-brief.md) (the received draft, verbatim)
- **Canonical predecessors:** `docs/accounting/owner-decision-baseline.md` §11 (ODR-1…ODR-3) and §12 (OD-20-1…OD-20-6); `docs/tasks/task-21/task-21-governance-baseline.md`; `docs/accounting/domain-contract.md`; ADR-0021/0025/0026/0028/0031/0033/0034/0035/0036/0037.

> This report authorizes **no implementation** and invents **no accounting
> content**. It is the output required by §19 of the received draft
> (*“Before coding, inspect … Then report: 1…7”*), produced because the draft
> itself records **“Implementation authorization: NOT GRANTED by this draft”**
> (§22). It does not admit Task 23, accept Task 21, promote an ADR, close
> OQ-25/OQ-36/OQ-41/OQ-43, reopen Task 19/Task 20, or self-accept anything.

```text
Status:                 NOT IMPLEMENTED — STOPPED AT THE §19 / §22 BOUNDARY
Admission:              NOT ADMITTED (docs/accounting/task-index.md §7 items 7 & 8 unmet)
Primary dependency:     Task 21 — ACCEPTED (2026-09-26); governance/documentation
                        acceptance only, it does NOT authorize implementation (§0.1)
Production changes:     NONE
Schema / migration:     NONE created
ADR promotion:          NONE
OQ closure:             NONE (OQ-25 / OQ-36 / OQ-41 / OQ-43 remain OPEN)
Self-acceptance:        NOT PERFORMED
```

---

## 0. Pre-flight admission findings (why implementation did not start)

### 0.1 Task 21 is accepted — the dependency is satisfied, but it does not authorize implementation

*Status corrected 2026-09-27 against current `main`. The original run of this report (baseline `b0d9337`) recorded Task 21 as “READY FOR REVIEW — NOT ACCEPTED”; that state has been superseded by the Owner acceptance recorded on `main`.*

| Source | Recorded status |
|---|---|
| `docs/tasks/task-21/task-21-acceptance-record.md` | **ACCEPTED (2026-09-26)** — Repository Owner, after final repository review **PASS**; *“Scope: Governance/design documentation only”* |
| `docs/accounting/task-index.md` status header | **“Task 21: ACCEPTED (2026-09-26)”** — design/governance documentation only; **OQ-25 substantially narrowed but stays OPEN**; OQ-41/OQ-43 not closed; no ADR promoted |
| `STATE.md` §7 row 21 + §8 | **ACCEPTED (2026-09-26)**; Task 21 is the current accepted work item; *“no implementation is authorized by this acceptance alone”* |
| `docs/open-questions.md` OQ-25 | *“Task 21 note (2026-09-26) — **ACCEPTED GOVERNANCE BASELINE**; OQ-25 remains OPEN and substantially narrowed”* |
| `docs/tasks/task-21/task-21-governance-baseline.md` header | **“Task status: ACCEPTED (2026-09-26)”** |
| Acceptance boundaries (acceptance record) | Base Chart content **values not approved**; **no** control-role catalog/mandatory set approved; **OQ-25/OQ-36/OQ-41/OQ-43 remain OPEN**; ADR-0033…0037 remain **Proposed**; Task 19/Task 20 unchanged; *“no production implementation … is authorized by this acceptance alone”* |

The draft declares `Depends on: … Accepted Task 21` and §22 `Primary dependency: Accepted Task 21 governance baseline`. That dependency is now **satisfied**. Task 21 §14.1 nevertheless states a two-limb gate:

> *“Only after this governance baseline is accepted **and** the required content is explicitly approved by the Owner/accountant, and only through a task admitted to `docs/accounting/task-index.md` §7.”*

The **first limb is satisfied**; the **second limb is not** — Base Chart content remains unapproved (OQ-25 OPEN) — and the admission limb is covered by §0.2. Task 21's acceptance therefore ratifies the governance baseline that bounds Task 23; it is **not** an authorization to implement Task 23.

**Observation only (not corrected by this report — registry files are out of its scope):** four locations on `main` still carry pre-acceptance wording for Task 21 — `docs/accounting/task-index.md` §2 row 21, its §5 candidate-table row and its §9 history row, and `docs/tasks/task-21/task-21-governance-baseline.md` §17. The acceptance record, `STATE.md`, the `task-index.md` status header and the OQ-25 note are treated as authoritative.

### 0.2 Task 23 is not admitted

`docs/accounting/task-index.md` §7 (future task definition rule) lists eight conditions that must all exist in the repository before an implementation agent may implement:

| §7 condition | State |
|---|---|
| 1. Objective defined | ✅ (draft §1) |
| 2. Domain scope defined | ✅ (draft §3) |
| 3. Non-goals defined | ✅ (draft §21) |
| 4. Dependencies identified | ✅ (draft §2) — the Task 21 dependency is now **satisfied**; content approval and implementation authorization remain outstanding (§0.1) |
| 5. Blocking Open Questions identified | ✅ (OQ-25/36/41/43) |
| 6. Required ADR / domain decisions exist where necessary | ❌ — D-R-1, D-R-2 (§7 of this report) |
| 7. Acceptance Criteria defined | ❌ — the draft has an *acceptance gate* (§20) but no acceptance criteria |
| 8. Explicitly added to the §2 table | ❌ — §2 rows end at `21` (11, 12, 13, 14, 15, 16, 17, 17B, 17C, 18, 19, 20, 21) |

### 0.3 Consequence

Per the draft's own §18/§19 and §22, the correct agent action is this report. Sections 1–6 are the plan that becomes executable once the Owner closes the gates still outstanding in §0.1 (content approval + implementation authorization) and §0.2 (admission), and resolves the decision requests in §7.

---

## 1. Implementation interpretation

Task 23 is an **empty-container implementation**: a product-side versioned template store plus a one-way, organization-scoped **copy** operation. It implements *mechanism only*. Every value that would make the mechanism useful in production (codes, Persian titles, natures, the mandatory set, any control role) is **content**, and content is OQ-25-DEFERRED and expert-gated (Task 21 §2 “values DEFERRED”, §12 row *“Base Chart content values → Open → must be accountant-approved before build”*; draft §10).

The identity chain is not negotiable and its lower two layers already exist:

```text
BaseChartTemplateVersion.id        (product asset — NEW, non-tenant)
        │ adoption = COPY, one transaction, explicit, ODR-3-bound, ODR-1-coherent
        ▼
accounting.accounts.id             (EXISTING table, organization-owned — shape unchanged)
        │
        ▼
accounting.ledger_entries.account_id → accounts.id   (EXISTING, untouched)
```

| # | Interpretation | Basis |
|---|---|---|
| I-1 | Adoption writes **ordinary `accounting.accounts` rows** through the existing placement/coherence rules — no parallel account hierarchy, no new account table | draft §13; Task 21 §14.1; ODR-2 |
| I-2 | **Full-version adoption only.** Ancestor-closure and mandatory-inclusion are implemented as *enforced validators*, but no subset-selection API is exposed, because any selection policy is the OPEN part of Task 21 §4.3 | draft §4 (*“stop at the smallest explicitly governed capability and report the unresolved boundary”*) |
| I-3 | Adoption **option A** (reference an existing organization configuration); refuse fail-closed when no ACTIVE, coherent `(coding_structure_version, accounting_configuration)` pair exists. Option B (create one) is not implemented | Task 21 §3 (A/B DEFERRED to the implementation task, bounded by: never mutate an operationally frozen configuration — ADR-0028 §3 — and must produce an ODR-1-coherent pin pair) |
| I-4 | Adoption is refused into a **non-empty chart** (any existing `accounts` row for that organization) — no merge, no upsert, no silent creation | `docs/tasks/task-20/accounting-chart-semantics-investigation.md` (*“never a seed that silently creates accounts in an existing organization”*); ADR-0037 §3. **Interim assumption — recorded as D-R-5** |
| I-5 | `is_postable` on every produced row is **derived, never trusted**: a template node with children is written `false` regardless of its template default; a leaf takes the template default, itself seeded from the pinned configuration level's `default_is_postable` | OD-20-5; the `postable ⇒ leaf` invariant enforced on both write paths (`data/accounts.repository.ts`, `domain/account.ts` `planAccountPlacement`) |
| I-6 | **No provenance column on `accounts`.** The adoption *record* references the published version; per-account template provenance stays OPEN | Task 21 §4.2, §8; AR-29 (no speculative columns) |
| I-7 | **No `Account.control_role`, no role catalog, no role table.** The template's optional control-role reference field is **absent**, because no approved role exists | OD-20-2/OD-20-3; Task 21 §2 (*“Absent any approved role, the field is absent”*), §6 |
| I-8 | Nothing is added to `LedgerEntry`, `AccountBalanceProjection`, the posting path or the Task 18 read surfaces | draft §5/§13; invariant I-3 of the owner-decision baseline (a chart change never rewrites ledger history) |

---

## 2. Exact files / modules expected to change

All work confined to `backend/` and the Accounting module; no frontend file (draft §16).

**New — domain (`backend/src/modules/accounting/domain/`)**

| File | Content |
|---|---|
| `base-chart-template.ts` | Version lifecycle status list + transition table (`draft → approved → published → superseded`), published-immutability predicate, template/version/node types + DTO mappers |
| `base-chart-adoption.ts` | Pure planners: `planTemplateCompatibility` (level shape vs pinned coding structure), `planAdoptionSelection` (ancestor closure + mandatory inclusion), `deriveAdoptedPostability` (leaf-only), topological node ordering, `AdoptionProblem` union + message map |
| `base-chart-template.spec.ts`, `base-chart-adoption.spec.ts` | Unit tests for the above |

**New — data (`.../data/`)**

| File | Content |
|---|---|
| `base-chart-templates.repository.ts` | Template/version/node/level reads and lifecycle writes under row locks |
| `base-chart-adoptions.repository.ts` | The single adoption transaction (lock order + bulk `accounts` insert + adoption record) |
| `base-chart-errors.ts` | `BaseChartVersionNotPublishedError`, `BaseChartVersionImmutableError`, `BaseChartIncompatibleWithConfigurationError`, `BaseChartAncestorClosureError`, `BaseChartMandatoryOmittedError`, `OrganizationChartNotEmptyError` — following `data/accounting-structure-errors.ts` conventions |

**New — application (`.../application/`)**

| File | Content |
|---|---|
| `base-chart-templates.service.ts` | Permission check → version read/lifecycle; **write surface blocked by D-R-2** |
| `base-chart-adoption.service.ts` | `assertOrganizationInScope` → permission → configuration resolution → compatibility → repository transaction → events |
| matching `*.spec.ts` | Application specs with in-memory fakes (existing pattern: `accounting-configurations.spec.ts`, `chart-tree.service.spec.ts`) |

**New — api (`.../api/`)**

`base-chart-templates.controller.ts`, `base-chart-adoption.controller.ts`, `api/dto/base-chart.dto.ts` — transport-only (AR-03), `@UseGuards(AuthGuard, AuthorizationGuard)` + `@RequirePermission(...)`, full Swagger decoration (pattern: `api/chart-tree.controller.ts`).

**Modified (small, additive)**

| File | Change |
|---|---|
| `backend/src/modules/accounting/accounting.module.ts` | register 2 repositories, 2 services, 2 controllers |
| `backend/src/modules/accounting/domain/accounting-permissions.ts` | add the new permission constants + definitions (§4) |
| `backend/prisma/schema/accounting.prisma` | add 4–5 models (§3) — **no change to `Account`, `LedgerEntry`, `AccountBalanceProjection`, `CodingStructure*`, `AccountingConfiguration*`** |
| `backend/prisma/migrations/2026MMDD000000_accounting_base_chart_template/migration.sql` | one additive migration |
| `backend/test/base-chart-adoption*.e2e-spec.ts` (+ `-live`) | new suites only; no existing suite edited |
| `docs/` | task documents, `docs/accounting/task-index.md` §2/§9, `STATE.md` §7/§8, `docs/modules.md`, contract §28.2 pointer — **only after admission** |

**Explicitly NOT touched:** `posting.service.ts`, `ledger-entries.repository.ts`, `trial-balance.*`, `general-ledger.*`, `account-statements.*`, `accounting-balances.*`, `frontend/**`, any existing migration (AR-08/AR-10).

---

## 3. Schema / migration plan

One additive migration, `accounting` schema, Prisma-generated (AR-10/AG-08), no destructive statement, no change to any existing column, index or FK.

```text
accounting.base_chart_templates            id, code, title, is_active, timestamps, created_by/updated_by
                                           uq(code)
accounting.base_chart_template_versions    id, template_id FK RESTRICT, version_number,
                                           status TEXT ('draft'|'approved'|'published'|'superseded'),
                                           max_depth, approved_at, published_at, superseded_at,
                                           superseded_by_version_id FK RESTRICT (nullable), timestamps
                                           uq(template_id, version_number)
                                           idx(template_id, status)
accounting.base_chart_template_levels      id, version_id FK RESTRICT, level_index, digit_length,
                                           default_is_postable
                                           uq(version_id, level_index)
accounting.base_chart_template_nodes       id, version_id FK RESTRICT, node_key, parent_node_key
                                           (self-FK within version), code, title, account_nature,
                                           is_postable, is_mandatory, default_is_active, level
                                           uq(version_id, node_key), uq(version_id, code)
                                           idx(version_id, parent_node_key), idx(version_id, level)
accounting.base_chart_adoptions            id, organization_id FK RESTRICT, template_version_id FK RESTRICT,
                                           accounting_configuration_id FK RESTRICT,
                                           coding_structure_version_id FK RESTRICT,
                                           adopted_at, adopted_by, account_count
                                           uq(organization_id)            ← see D-R-5
                                           idx(organization_id, template_version_id)
```

Design notes, each tied to an existing repository convention:

- **Status values are TEXT, no enum, no CHECK constraint** — the accounting schema's documented reason: value rules Prisma cannot represent are dropped by the next generated migration, so they live in the domain layer (`backend/prisma/schema/accounting.prisma` header).
- **`base_chart_template_levels` mirrors `coding_structure_levels`** (`level_index`, `digit_length`, `default_is_postable`) and deliberately carries **no level title** — level titles are organization configuration (contract §8.1), not template content.
- **Published immutability is enforced in the application/repository layer** under `SELECT … FOR UPDATE` on the version row, the same way “exactly one ACTIVE coding-structure version”, calendar overlap and the postable-leaf invariant are enforced today (AR-11). No trigger, no PL/pgSQL, no `btree_gist`.
- **`base_chart_adoptions` is the only tenant-scoped new table** and follows the tenancy convention (`organization_id` NOT NULL, FK RESTRICT, scope-leading indexes — ADR-0021 §3).
- **The four template tables carry no `organization_id`.** This would be the first non-tenant table in the `accounting` schema (all 13 existing accounting models carry `organization_id`; the only global-table precedent in the repository is `rbac.permissions`). **AR-29-gated → D-R-1.**
- **Deliberately absent columns** (AR-29): `accounts.base_chart_template_node_id` (provenance — OPEN, Task 21 §4.2/§8), `accounts.is_mandatory` (→ D-R-4), any `control_role` column (OD-20-3), any dimension column (OD-20-6/OQ-41), any statutory/legal column (ADR-0036/OQ-43), `reserved_ranges`, `account_type`, `is_temporary`.

Migration name follows the date convention (latest applied: `20260926000000_organization_membership`).

---

## 4. API / permission plan

**Permissions** — registered only because an implemented surface enforces them (`docs/security.md` §3; `domain/accounting-permissions.ts`: *“any code not enforced by code must not exist”*, *“No wildcards, no superuser, no implicit bypass (OQ-21)”*):

| Code | Enforced by |
|---|---|
| `Accounting.BaseChartTemplate.View` | template/version read endpoints |
| `Accounting.BaseChartTemplate.Configure` | draft create/edit + lifecycle transitions — following the `Accounting.CodingStructure.{View,Configure}` precedent, which deliberately does not split draft/publish into separate authorities |
| `Accounting.BaseChartAdoption.Adopt` | the adoption write endpoint |
| `Accounting.BaseChartAdoption.View` | reading an organization's adoption record |

No `.Delete` code (freeze-over-delete, contract §8.6). No approval-specific authority is invented: *who* may approve/publish is **OWNER DECISION (pending)** per Task 21 §8 → D-R-2.

**Endpoints** (REST/OpenAPI, `/api/v1`, transport-only controllers):

| Method | Path | Permission | Scope |
|---|---|---|---|
| `GET` | `/api/v1/accounting/base-chart-templates` | `BaseChartTemplate.View` | product-global list |
| `GET` | `/api/v1/accounting/base-chart-templates/:templateId/versions/:versionNumber` | `BaseChartTemplate.View` | version + level shape + nodes (paginated) |
| `POST` | `/api/v1/accounting/base-chart-adoptions` | `BaseChartAdoption.Adopt` | body `{ organizationId, templateVersionId }` → `assertOrganizationInScope` first |
| `GET` | `/api/v1/accounting/base-chart-adoptions?organizationId=…` | `BaseChartAdoption.View` | organization-scoped |
| *(lifecycle writes)* | `POST …/versions/:id/{approve,publish,supersede}` | `BaseChartTemplate.Configure` | **NOT IMPLEMENTABLE TODAY — D-R-2** |

**Reading the resulting organization chart introduces no endpoint**: the accepted ODR-2 surface `GET /api/v1/accounting/chart-tree[/:id]` already returns it (draft §14's “Reading the resulting organization-owned chart” is already satisfied).

**Failure semantics** reuse the established Accounting posture: unknown/foreign organization → **404** (indistinguishable, AC-I-16 / no IDOR); missing permission → **403**; disabled organization → **422**; non-published version, incompatible level shape, ancestor-closure or mandatory-inclusion violation → **422** with a typed code; duplicate adoption / code collision → **409**.

**Authorization ordering** is the repository-wide chokepoint order proven by PR #55: deployment pin → `assertOrganizationInScope` (membership) → permission → business operation. No bypass; adoption receives no bootstrap exception.

---

## 5. Adoption transaction / invariant plan

One `prisma.$transaction`, fail-closed, all-or-nothing.

**Pre-transaction (service):**

1. `assertOrganizationInScope(organizationId)` → 404 for non-member/unknown (ODR-3).
2. `requireAllPermissions([Accounting.BaseChartAdoption.Adopt])`.
3. `requireUsableOrganization` → 422 if disabled.
4. Load the template version; refuse unless `status = 'published'` (422).
5. Resolve the organization's ACTIVE `AccountingConfiguration` + ACTIVE `CodingStructureVersion` (option A, I-3); refuse with the existing `NoActiveAccountingConfigurationError` / `CodingStructureVersionNotActiveError` if absent.
6. `planPinCoherence({ codingLevels, configurationLevels })` — the existing ODR-1 decision table; incoherent pins → `AccountPinsIncoherentError` (422), no silent winner, no repair.
7. `planTemplateCompatibility` — template `max_depth` ≤ configuration depth, per-level `digit_length` equality, every template code valid under the pinned shape and prefix-extending its parent (contract §9.3).
8. `planAdoptionSelection` — ancestor closure (every node's `parent_node_key` present) and mandatory inclusion (every `is_mandatory` node present); in the full-adoption slice these are assertions over the complete node set, not a filter.

**Inside the transaction, lock order identical to the existing root-account path** (`data/accounts.repository.ts`: `lockCodingStructureVersionRow` → `lockAccountingConfigurationRow` → account rows), so no new deadlock class is introduced:

1. Lock the coding-structure version row; re-assert `active`.
2. Lock the accounting configuration row; re-assert `active` and not operationally frozen (ADR-0028 §3 — adoption must never mutate a frozen configuration).
3. Re-apply `assertSnapshotCoherence` (ODR-1 re-checked at the authoritative write boundary — the established two-call-site pattern).
4. Emptiness guard (I-4 / D-R-5): refuse if any `accounts` row exists for the organization.
5. Insert nodes **in topological order (level ascending, code ascending)**, each through the same derivation rules the manual create path uses: `level = parent.level + 1`, code = parent code + segment, pins inherited from the parent, `isPostable` derived per I-5, ids from `generateId()` (ULID). `uq_accounts_organization_id_code` remains the hard backstop for concurrent races.
6. Insert the `base_chart_adoptions` record referencing the immutable published version + both pins.
7. Commit; publish `ACCOUNT_CREATED` events after commit (existing `publishEvent` pattern). **Volume note:** a large chart produces one event per account; per-row vs batched publication is an implementation detail to raise in review, not to decide silently.

**Invariants asserted by construction:**

| Invariant | Enforcement |
|---|---|
| Template id never becomes ledger identity | No FK from `ledger_entries`/`accounting_document_lines` to any template table; no template id column on `accounts` |
| Copy, not reference | Adopted rows are plain `accounts` rows; no read path resolves an account through a template row |
| No silent mutation on template change | Only the explicit adoption operation writes `accounts`; publishing/superseding a version touches template tables only |
| Published immutability | Version row locked; any write to a `published`/`superseded` version → `BaseChartVersionImmutableError` |
| `postable ⇒ leaf` | I-5 derivation + the existing repository invariant + `planAccountPlacement` |
| ODR-1 coherence | `planPinCoherence` at both call sites |
| Organization isolation | `assertOrganizationInScope` + `organization_id` on every insert |
| Ledger unchanged | No write outside `accounts` and the new template/adoption tables |

---

## 6. Test plan

Per `docs/testing/test-execution-policy.md` — local **FAST-LOCAL** gates only; heavy verification delegated to CI as the authoritative environment (draft §15).

**Unit (hermetic, `src/**/*.spec.ts`, local):**

- lifecycle transition table: every legal and illegal transition of `draft → approved → published → superseded`; published/superseded terminal for edits;
- compatibility planner: depth mismatch, digit-length mismatch, invalid prefix, depth > `max_depth`;
- selection planner: missing ancestor, omitted mandatory node, valid full set;
- postability derivation: a parent with children forced non-postable even when the template default says `true`; a leaf inherits the configuration default;
- topological ordering determinism; error-message map completeness.

**Application specs (in-memory fakes, local):**

- adoption denied without permission (AR-21 denial test) and for a non-member principal (404, not a 403 leak);
- refusal for a non-published version; for a missing/incoherent configuration pair (ODR-1); for a frozen configuration; for a non-empty chart;
- successful adoption produces org-owned rows with correct pins, derived levels/codes, and an adoption record;
- after adoption, superseding the template version changes **no** `accounts` row (copy-not-reference / no-silent-mutation).

**E2E + live PostgreSQL (CI only — CI-HEAVY / CI-LIVE-DB):**

- full HTTP pipeline adoption, 404/403/422/409 matrix;
- organization isolation: two organizations, same template version, no cross-contamination;
- template identity ≠ account identity asserted on raw rows;
- concurrent double-adoption resolved by the unique index (one 409, no partial chart);
- `migrate deploy` + migration rehearsal.

**Authoritative CI requirement:** the `backend` job of `.github/workflows/ci.yml` (Prisma validate/generate, lint, typecheck, format:check, unit, build, `migrate deploy`, migration rehearsal, E2E incl. live-DB suites on `postgres:16`) must be `completed success` on the PR head, with the run id recorded in the implementation report — the evidence standard used by Task 19 (run `36238862315`) and Task 22 (run `36263120844`). No local heavy E2E run would be attempted or claimed.

---

## 7. Unresolved decisions required before implementation

Seven decision requests. **None may be resolved by the Agent** (draft §7/§11/§18; AR-31/AG-09; AG-15).

| Id | Decision request | Class | Blocks |
|---|---|---|---|
| **D-R-1** | **Where does a product-global Accounting table live?** Every existing `accounting` model carries `organization_id` NOT NULL as the tenant/security boundary (AC-D-01/AC-I-01), yet the Base Chart template is by definition not organization data (OD-20-1; Task 21 §2a excludes organization ids). Four non-tenant tables in the `accounting` schema is a new cross-module data pattern → **AR-29 requires an ADR first (or in the same PR)**. Sub-questions: `accounting` schema or a new product/catalog schema? How does it interact with the ADR-0025 single-organization deployment pin (is the “product” template per-deployment data in a pinned deployment)? | ARCHITECTURE / PLATFORM — ADR-gated | §3 entirely |
| **D-R-2** | **Who may author, approve and publish a template version?** Task 21 §8 classifies this as **OWNER DECISION (pending)** and states *“An agent may not approve content.”* Additionally the repository has **no authorization model for a non-organization-scoped write surface**: every Accounting service passes `assertOrganizationInScope`; there is no platform/product-admin scope, no wildcard, no superuser (OQ-21); and system context is explicitly *“not reachable from HTTP”* (`organizations.service.ts`). A `POST …/publish` endpoint has no principal model today. | SECURITY / OWNER DECISION (pending) | draft §3.2 lifecycle writes and the §14 template-management API (read + adoption unaffected) |
| **D-R-3** | **May a content-less foundation be built at all?** Task 21 §14.1 permits implementation only after acceptance **and** explicit Owner/accountant approval of “the required content”; the acceptance limb is satisfied (§0.1) while content stays OQ-25-DEFERRED. Task 23 would therefore ship a mechanism with **no publishable production template**, exercisable only with the “minimal technical fixtures clearly identified as test data” of draft §10. | OWNER DECISION / ACCOUNTING DOMAIN | the value of the whole slice |
| **D-R-4** | **Where does mandatoriness live after adoption?** Task 21 §5's mandatory **semantics** are ratified by the Task 21 acceptance (§0.1), while the mandatory **list** stays unapproved content (OQ-25) and their post-adoption **representation** was left undecided. Rule 1 (must exist at adoption) is enforceable in the adoption transaction; rules 2–3 (cannot delete, cannot deactivate while mandatory) are post-adoption guards on the existing `Account` disable path and require the adopted row to know it is mandatory. The only two mechanisms are (a) an `accounts.is_mandatory` column — a new column whose *representation* Task 21 did not decide (AR-29 speculative-column risk), or (b) account-level template provenance — explicitly **OPEN** (Task 21 §4.2/§8). | ACCOUNTING DOMAIN / ARCHITECTURE | draft §3.1's mandatory marker beyond the template side; enforcement of Task 21 §5 rules 2–3 |
| **D-R-5** | **Adoption into a non-empty chart, and re-adoption.** Task 21 governs neither; `uq_accounts_organization_id_code` guarantees a collision and merge/upsert semantics would be an invented rule. The fail-closed interim assumption I-4 (refuse if any account exists; `uq(organization_id)` on the adoption record) is conservative and aligned with *“never a seed that silently creates accounts in an existing organization”* (Task 20 investigation; ADR-0037 §3) — but it forecloses “adopt a second template” and “upgrade to a newer version” without a further decision. | ACCOUNTING DOMAIN | the adoption precondition set; any future upgrade path |
| **D-R-6** | **OQ-36 prerequisites that Task 21 itself declares due *before* implementation.** Task 21 §10 states verbatim *“Prerequisites Task 21 needs from OQ-36 **before Base Chart implementation**”* — (1) code-reuse policy for superseded codes and its interaction with `uq_accounts_organization_id_code`; (2) deletion eligibility for *unused adopted* accounts; (3) coexistence of a future code-history producer with the never-reuse rule. OQ-36 is OPEN and draft §6 forbids deciding it. The Owner must resolve them **or explicitly waive them for this bounded slice** (defensible: the minimal slice exposes no deletion, no code change and no reuse path). | DEFERRED (OQ-36) — governance gate | formal start of implementation |
| **D-R-7** | **Partial adoption is not implemented; confirm the boundary.** Per draft §4 and I-2 the implementation stops at full-version adoption with both invariants enforced. Draft §4 requires this boundary to be reported — it is hereby reported; the Owner should confirm that “no subset-selection API” is the accepted reading rather than a gap. | OPEN QUESTION (Task 21 §4.3) | scope confirmation only |

**Scope-creep classification (draft §18):** template store → PLATFORM + ACCOUNTING DOMAIN (ADR-gated, D-R-1); lifecycle write surface → SECURITY (D-R-2, blocked); adoption operation → CORE; adoption record → CORE; mandatory post-adoption guards → ACCOUNTING DOMAIN (D-R-4, blocked); account provenance → DEFERRED (AR-29); control roles → DEFERRED (OD-20-2/3); dimensions → DEFERRED (OQ-41); statutory content → DEFERRED (OQ-43); content values → OPEN QUESTION (OQ-25).

---

## 8. Confirmations

- **No production implementation was performed.** No TypeScript, Prisma schema, migration, SQL, seed, API, DTO, permission, production test or frontend file was created or modified by this report; the only files added are the two documents in `docs/tasks/task-23/`.
- **No registry was modified.** `docs/accounting/task-index.md`, `docs/open-questions.md`, `docs/accounting/owner-decision-baseline.md`, `STATE.md` and every ADR are untouched — **no admission is implied or performed.**
- **Task 19 (ODR-1…ODR-3) and Task 20 (OD-20-1…OD-20-6) were not reopened or reinterpreted**; both remain ACCEPTED (2026-09-26) and unchanged.
- **Task 21 was not accepted, re-accepted, modified or self-accepted by this report**; its status is reported as recorded in the repository — **ACCEPTED (2026-09-26)**, governance/documentation acceptance only, which does **not** authorize Task 23 implementation (§0.1).
- **OQ-25, OQ-36, OQ-41 and OQ-43 remain OPEN.**
- **No ADR was promoted** — ADR-0033…0037 remain Proposed.
- **No accounting content was invented:** no account code, Persian title, account nature, mandatory-account list or control-role catalog appears in this report.
- **Task 23 is neither admitted nor accepted**, and the Agent does not self-accept.

## 9. What is required to proceed past this boundary

1. ~~Owner acceptance of Task 21~~ — **satisfied: Task 21 is ACCEPTED (2026-09-26)**. What remains from Task 21 §14.1 is its second limb: explicit Owner/accountant approval of the required Base Chart content, plus an explicit authorization to implement Task 23 (the acceptance grants none).
2. Admission of Task 23 into `docs/accounting/task-index.md` §2 with Acceptance Criteria (§7 items 7–8).
3. Decisions on **D-R-1 … D-R-6**. D-R-1 and D-R-2 are the two that make the template store unbuildable today; adoption mechanics alone could proceed against a template store whose rows are provisioned out-of-band, if the Owner prefers that sequencing.
4. Optionally, authorization to draft the ADR that D-R-1 requires (as **Proposed**, unpromoted).
