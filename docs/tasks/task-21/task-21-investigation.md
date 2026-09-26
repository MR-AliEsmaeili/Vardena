# Task 21 — Base Chart Governance & OQ-25 Resolution — Investigation

- **Document type:** investigation — **DESIGN / GOVERNANCE ONLY (DOCUMENTATION ONLY)**
- **Date:** 2026-09-26
- **Task status:** **ACCEPTED (2026-09-26)**
- **Branch:** `arena/01a0de9b-vardena`
- **Baseline:** `main` @ `10797e1400fda6329ca481877f9bbf9eff850fcd`
- **Method:** read-only inspection of governance documents **and** production code
  at the baseline commit. No runtime behaviour was exercised. No production file
  was modified. Where a claim can be answered by repository code, code is cited.

> The authoritative *conclusions* of Task 21 live in
> [`task-21-governance-baseline.md`](./task-21-governance-baseline.md). This
> document records what was read and what was found, so that the conclusions are
> traceable and no accounting content is invented.

---

## 1. Sources read

### 1.1 Accounting contract / architecture / governance

- `docs/accounting/domain-contract.md` (chart/coding sections §8/§9/§14; non-goal §1.2; §10/§11 dimensions; §19 reporting; §25 invariants)
- `docs/accounting/configuration.md`
- `docs/accounting/owner-decision-baseline.md` (Q2/Q4/Q5/Q7/Q18; §3 invariants I-1…I-3; §5 discrepancies D-1…D-5; §6 open items O-1…O-5; §11 ODR-1…ODR-3; §12 OD-20-1…OD-20-6)
- `docs/accounting/task-index.md` (§2 task table, §4 future-capability map, §5 OQs, §7 future-task rule, §9 document history)
- `docs/open-questions.md` (OQ-25, OQ-36, OQ-40, OQ-41, OQ-43, OQ-62/OQ-63)

### 1.2 Task 19 / Task 20 records

- `docs/tasks/task-19/task-19-acceptance-record.md` (ACCEPTED; three slices; explicit non-scope keeps OQ-25 OPEN)
- `docs/tasks/task-19/task-19-implementation-report.md`
- `docs/tasks/task-19/task-19-implementation-gate.md`
- `docs/tasks/task-19/accounting-chart-configuration-investigation.md`
- `docs/tasks/task-20/accounting-chart-semantics-investigation.md` (Domains A–E; the primary predecessor)
- `docs/tasks/task-20/task-20-implementation-gate.md` (READY FOR REVIEW — NOT ACCEPTED; OD-20-1…OD-20-6 DECIDED)
  - *Note:* the brief referenced a `task-20-acceptance-record.md`. At Task 21's
    branch-point (`10797e1`) that file did not yet exist and Task 20 was recorded
    as READY FOR REVIEW — NOT ACCEPTED. It has since merged from `main` (PR #59,
    `docs/tasks/task-20/task-20-acceptance-record.md`), so **Task 20 is now
    ACCEPTED** under Owner-authorized Formal Acceptance Sync. Either way, Task 21
    treats OD-20-1…OD-20-6 (canonical in `owner-decision-baseline.md` §12) as the
    authoritative, DECIDED predecessor decisions.

### 1.3 ADRs

- ADR-0026 Accounting Bounded Context (**Accepted**) — one `accounting` module/schema owns the chart, control-role mappings, dimensions, ledger, projections.
- ADR-0033 Account Identity / Code History (**Proposed — amended by OD-20-4**).
- ADR-0034 Posting vs Aggregation (**Proposed — amended by OD-20-5**, D-1 resolved leaf-only).
- ADR-0035 Account Code Structure Migration (**Proposed**) — sole sanctioned post-use re-coding path.
- ADR-0036 Legal Reporting Architecture (**Proposed**) — Core → Legal Adapter/Profile; statutory content stays OQ-43.
- ADR-0037 Accounting Configuration Boundary (**Proposed — amended by OD-20-1/2/3/6**).

### 1.4 Implementation inspected (read-only)

| Area | File(s) | What was verified |
|---|---|---|
| Account model | `backend/prisma/schema/accounting.prisma` (`model Account`, lines ~334–405) | Columns: `id`, `organizationId`, `code` (VarChar 32, `uq_accounts_organization_id_code`), `title` (VarChar 200), `parentId` (self-FK RESTRICT), `level` (derived), `codingStructureVersionId` (NOT NULL), `accountingConfigurationId` (NOT NULL), `accountNature` (VarChar 8), `isPostable` (default false), `isActive` (default true), audit columns. **No `control_role` column. No template/base-chart column. No dimension column. No code-history column.** |
| Coding structure | `CodingStructureVersion` / `CodingStructureLevel`; `backend/src/modules/accounting/domain/coding-structure.ts` | Versioned `draft→active→superseded`, `max_depth` 1..8 (`MAX_CODING_STRUCTURE_DEPTH = 8`), per-level `digit_length`, `level_kind` informational-only closed list `['group','general','subsidiary','detail']`, `title` free text. **No hardcoded four-level hierarchy.** |
| Configuration | `AccountingConfiguration` / `AccountingConfigurationLevel`; `accounting-configuration.ts` | Versioned root, exactly one ACTIVE per organization (raw-SQL partial unique index), `operationally_used_at` freeze marker (Task 13), per-level `default_is_postable`. |
| Account rules | `backend/src/modules/accounting/domain/account.ts` | `code` immutable from creation (no code field on update path); `parentId`/`level`/`accountNature`/`isPostable` immutable **after use** (`ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS`, behind `isReferencedByDocumentLine`); `title` and lifecycle always editable; `postable ⇒ leaf` enforced both directions (`planPostabilityChange` → `postable_with_children`; placement → `parent_postable`). |
| Pin coherence | `accounts.repository.ts`, ODR-1 `planPinCoherence` | Level-count + per-level digit-length coherence checked at root/child create and move, re-checked in the locked transaction; divergent pins rejected (no silent winner). |
| Chart tree | ODR-2 `ChartTreeService`, `GET /api/v1/accounting/chart-tree[/:id]` | Read-only, organization-scoped, fixed `code ASC` order, inactive included. |
| Reporting roll-up | `accounting-read-query.repository.ts`, `trial-balance.ts` (Task 18) | `role = CASE WHEN isPostable THEN 'POSTING' ELSE 'AGGREGATION' END`; parent totals are read-time roll-ups over leaf postings. |
| Ledger identity | `ledger-entry.ts`, `ledger-entries.repository.ts`, `balance-projection.ts` | Ledger/projection key on `account_id`; no code stored on historical rows; insert-only ledger; dimension seam materializes `[]` (OQ-41). |

### 1.5 Negative findings (verified absences)

- **No** `control_role` field/table/enum/service (schema + `src/` grep clean; only deferral comments in `accounting.prisma` header §8.7).
- **No** Base Chart / template / adoption table, migration, seed, service, API, or DTO anywhere.
- **No** dimension model, code-history model, or statutory/legal profile model.
- **No** hardcoded four-level hierarchy; levels are configurable data.
- Contract §1.2 non-goal 1 explicitly refuses to define account codes/titles/chart content/control-role content.

---

## 2. What is already decided (the fixed floor Task 21 builds on)

| Ref | Decided fact Task 21 must respect |
|---|---|
| **OD-20-1** | Base Chart = versioned Accounting-owned database/product template; explicit adoption creates organization-owned `Account` identities; template identities never become ledger references; future versions exist independently from adopted charts; **content is expert-gated, not agent-invented**. |
| **OD-20-2** | Control roles are **consumer-first**; no speculative generic catalog. |
| **OD-20-3** | Control-role association is an **independent effective-dated mapping**, not `Account.control_role`. |
| **OD-20-4** | `Account.id` permanent identity; `Account.code` business address; pre-use code correction permitted; post-use immutable; history is producer-bound (no speculative table). |
| **OD-20-5** | `POSTING = leaf-only`; `AGGREGATION = reporting/read-time roll-up`. (D-1 resolved.) |
| **OD-20-6** | Dimensions are line-level analytical assignments; aggregation via read layer; OQ-41 owns the rest. |
| **ODR-1** | `coding_structure_version_id` + `accounting_configuration_id` must stay coherent; divergence rejected (no silent fallback). |
| **ODR-2** | Accounting owns the canonical chart/tree read surface. |
| **ODR-3** | Organization-scoped writes/reads pass the principal-bound membership chokepoint. |
| **I-1/I-2/I-3** | Account identity is id-keyed; posting XOR aggregation; code migration never rewrites economic ledger history. |
| **ADR-0028** | Versioned configuration, single ACTIVE, `operationally_used_at` freeze — never mutate a used configuration in place. |
| **Repository invariants** | `code` immutable from creation; structural fields immutable after use; `postable ⇒ leaf`; codes never reused; freeze-over-delete (no delete endpoint / no `*.Delete` permission). |

**Consequence for Task 21:** the *mechanism, ownership, sequencing and artifact
shape* of the Base Chart are already decided. What remains open under OQ-25 is
(a) **content** (codes/titles/natures/mandatory list/role catalog) — which Task 21
must **not** invent — and (b) **governance detail** (content model, mandatory
semantics, adoption/version/customization rules, posting-default role, and the
OQ-36 boundary) — which is exactly what Task 21 may decide *as governance*.

---

## 3. Per-question findings

Each finding cites evidence and states whether Task 21 can conclude it, and how it
is classified. The conclusions themselves are consolidated in
[`task-21-governance-baseline.md`](./task-21-governance-baseline.md).

### 3.1 Base Chart definition — template ≠ organization chart ≠ ledger identity

**Evidence:** OD-20-1 (template identities never become ledger references; adoption
creates organization-owned `Account.id`); ADR-0033 §1 (`Account.id` is the only
ledger identity); ADR-0031 §2 (`LedgerEntry.accountId`); ADR-0037 §3.

**Finding:** the layering

```text
Base Chart Template  ── adoption ──▶  Organization-owned Chart / Accounts  ──▶  Ledger identity
```

is a strict consequence of the accepted decisions. A future implementation MUST
NOT store ledger postings against a Base Chart template identifier. → **IMPLEMENTATION
CONSTRAINT** (derived, not new).

### 3.2 Base Chart content model (which fields exist)

**Evidence:** the `Account` model columns (§1.4); AR-29 (no speculative columns
before a consumer); OD-20-1 content boundary; OD-20-3 (role via mapping, not
column); OD-20-6 / OQ-41 (dimensions out); OD-20-4 (code history producer-bound);
ODR-1 (code shape bound to configuration).

**Finding:** Task 21 can decide the *conceptual field set* of a Base Chart entry
(a data-model boundary), because that does not require inventing values. It
**cannot** decide the values. Field-by-field reasoning is in the governance
baseline §3. Every included field maps to an existing `Account`/configuration
concept or to a versioning requirement; every excluded field maps to an accepted
prohibition (org-specific data, ledger data, dimensions/OQ-41, code-history
producer, statutory/OQ-43). → **IMPLEMENTATION CONSTRAINT** for the field set;
**DEFERRED** for the values.

### 3.3 Hierarchy / configurable levels

**Evidence:** configurable levels are implemented (§1.4); no four-level hardcode;
ODR-1 coherence; §9.3 child-code-extends-parent rule; ADR-0028 freeze; A6 of the
Task 20 investigation (a template is bound to a level shape or must be
parameterized by one).

**Finding:** a Base Chart version cannot be shape-agnostic — its codes only exist
relative to a level shape (digit lengths). Therefore adoption must yield an
**ODR-1-coherent `(coding_structure_version, accounting_configuration)` pair**, and
a **compatibility validation before adoption is mandatory** (option **C**). Whether
adoption references an existing organization configuration (A) or creates/adopts a
compatible one (B) is bounded by the constraint that it must never mutate a frozen
configuration (ADR-0028 §3); the A-vs-B choice is **DEFERRED** to implementation.
→ compatibility-validation-required = **IMPLEMENTATION CONSTRAINT**; A-vs-B =
**DEFERRED**.

### 3.4 Adoption semantics

**Evidence:** OD-20-1 (adoption creates organization-owned identities; template
versions independent of adopted charts); ADR-0037 §3 ("never a seed that silently
creates accounts in an existing organization"); ADR-0028 freeze; I-3; ADR-0033.

**Findings:**
- **Copy, not reference.** Adoption copies template definitions into org-owned
  `Account` rows; organizations own the resulting records; runtime dependency of
  organization accounts on mutable template rows is **rejected**. Direct
  consequence of OD-20-1. → **IMPLEMENTATION CONSTRAINT**.
- **Version pinning / no silent mutation.** An adoption is against one immutable,
  published Base Chart version; a newer Base Chart version MUST NOT silently mutate
  an existing organization's chart; upgrades are explicit migration/adaptation
  operations. Rationale: adopted accounts are organization-owned (OD-20-1), a used
  configuration is frozen (ADR-0028 §3), and the ledger is never rewritten by a
  chart change (I-3). → **IMPLEMENTATION CONSTRAINT**. Whether the *account* row
  carries template provenance is a speculative column today (AR-29) → **OPEN**.
- **Partial adoption.** Selectable subsets risk breaking accounting consistency
  (orphaned nodes if an ancestor is omitted; missing mandatory or role-backed
  accounts). The safe invariant is **ancestor-closure** (no adopted node without
  its ancestors) plus **mandatory-inclusion**; beyond that, full-vs-subset-vs-staged
  is **OPEN** (accountant). Building a generic chart designer is a non-goal.
  → ancestor-closure + mandatory-inclusion = **IMPLEMENTATION CONSTRAINT**; the
  adoption-shape choice = **OPEN**.

### 3.5 Mandatory account semantics

**Evidence:** freeze-over-delete (repository); OD-20-2 (roles mandatory *when
consumed*); ADR-0033 §7 (used account deactivated not deleted); the four distinct
requirement sources (chart / organization / control-role / statutory).

**Finding:** Task 21 can define the *meaning* of the `is_mandatory` flag (governance
semantics), not the *list*. A safe **minimal** meaning is: a mandatory account
(a) must exist after adoption, (b) cannot be deleted, (c) cannot be deactivated
while it remains mandatory. Titles remain editable (title ≠ identity). Code change
stays governed by OD-20-4 (mandatoriness adds no extra code rule). Move / nature
change / structural-compatibility restrictions are **OPEN** because they depend on
which consumers exist. The *list* of mandatory accounts is content → **DEFERRED**.
Task 21 also records the four distinct requirement sources so they are not
conflated. → semantics = **IMPLEMENTATION CONSTRAINT (minimal)** + **OPEN**
(extended restrictions); list = **DEFERRED**.

### 3.6 Control roles

**Evidence:** OD-20-2 (consumer-first), OD-20-3 (effective-dated mapping),
ADR-0037 §4/§5 (code-defined vocabulary, demand-driven mandatoriness), contract
§8.7 (the listed roles are explicitly *placeholders, not a decision*).

**Finding:** Task 21 defines the **governance contract** (what qualifies as a role,
who may introduce one, evidence required, how a consumer binds, whether Base Chart
entries may optionally reference a role, and how role-backed mandatory accounts
differ from mandatory chart accounts). The **catalog stays OPEN** — Task 21
introduces **no** roles (no Cash/Bank/AR/AP/Inventory/Tax/Sales), because no
concrete approved consumer currently requires a specific role. → governance
contract = **ACCOUNTING DOMAIN / ARCHITECTURAL governance (proposed, pending owner
acceptance)**; catalog = **OPEN**.

### 3.7 Per-level posting defaults

**Evidence:** OD-20-5 (leaf-only / read-time aggregation); implemented
`postable ⇒ leaf` (both directions); configuration-level `default_is_postable`;
Task 18 roll-up.

**Finding:** `is_postable` is an explicit per-account Base Chart property, seeded
from the configuration-level `default_is_postable`, and **hard-bounded by the
leaf-only invariant** — a template node with children must be non-postable, so a
Base Chart can never produce `parent postable AND child postable`. There are **no
exceptions**: non-leaf posting would require a new explicit decision reopening
ADR-0034. Task 18 reporting logic is unchanged. → **IMPLEMENTATION CONSTRAINT**.

### 3.8 Account lifecycle / code validity boundary (vs OQ-36)

**Evidence:** OD-20-4 (pre-use correction / post-use immutable); repository (code
immutable from creation, structural fields immutable after use, codes never reused,
no delete endpoint); OQ-36 (owns deletion/reuse policy); ADR-0033 §3 (history
producer-bound); baseline O-1 (code reuse × unique index undecided).

**Finding:** Task 21 defines only the **dependency boundary**, it does not
duplicate or override OQ-36. Deactivation guards for mandatory / in-use role-backed
accounts belong to Base Chart governance; deletion eligibility, code reuse of
superseded codes, and the interaction with `uq_accounts_organization_id_code`
belong to OQ-36 and are recorded as **prerequisites** the Base Chart
implementation needs from OQ-36. → boundary = **IMPLEMENTATION CONSTRAINT**;
deletion/reuse policy = **OPEN (OQ-36)**.

### 3.9 Base Chart vs statutory chart

**Evidence:** ADR-0036 (Core → Legal Adapter/Profile; statutory content stays
OQ-43); contract §2.3 (reported legal inputs, not rules); no legal profile model
exists.

**Finding:** `Vardena Base Chart ≠ Iran statutory reporting profile`. A Base Chart
may be *designed to support* future statutory reporting but must not hardcode or
invent legal requirements. No legal compliance claim is made. OQ-43 stays OPEN and
out of scope. → **IMPLEMENTATION CONSTRAINT** + **OUT OF SCOPE (OQ-43)**.

### 3.10 Organization customization

**Evidence:** repository edit rules (§1.4: `title`/lifecycle always editable;
`parentId`/`level`/`accountNature`/`isPostable` mutable pre-use, immutable
post-use; `code` immutable from creation, OD-20-4 permits future pre-use edit);
ODR-1; leaf-only; ADR-0033 identity; OD-20-2/3; OQ-41.

**Finding:** post-adoption the organization owns its chart and may customize within
the accepted invariants. Task 21 provides an Allowed / Conditionally allowed /
Forbidden / Not yet decided classification (governance baseline §9) that cannot
silently invalidate ODR-1, leaf-only posting, historical identity, future
control-role consumers, or mandatory Base Chart semantics. → classification =
**IMPLEMENTATION CONSTRAINT** where derived; **OPEN** where consumer-dependent.

### 3.11 Versioning and upgrades

**Evidence:** ADR-0028 versioning pattern; OD-20-1 (versioned, independent
versions); the "no silent mutation" constraint (§3.4); ADR-0035 (post-use
re-coding path); §7 future-task rule (approval is a governance act).

**Finding:** a **Draft → Approved → Published → Superseded** lifecycle fits the
repository's existing versioning conventions. Published versions are immutable;
upgrades are explicit and require a compatibility/migration plan; upgrade after
operational use is only via a controlled migration/adaptation that never silently
mutates organization accounts (ADR-0028 freeze, ADR-0035 for code, I-3). Who may
approve is a **governance role** (accounting/domain expert + product owner); an
agent may not approve content. No upgrade engine is built. → lifecycle/immutability/
explicit-upgrade = **IMPLEMENTATION CONSTRAINT / ARCHITECTURAL governance
(proposed)**; approval authority = **OWNER DECISION (pending)**.

---

## 4. Repository consistency checks performed

| Check | Result |
|---|---|
| No contradiction with Task 19 (ODR-1/2/3) | **PASS** — Task 21 reuses and depends on them; changes none. |
| No contradiction with Task 20 (OD-20-1…OD-20-6) | **PASS** — Task 21 refines the OPEN portions only. |
| No unresolved D-1 statement introduced | **PASS** — D-1 stays resolved (OD-20-5, leaf-only). |
| No hardcoded four-level hierarchy | **PASS** — levels remain configurable data; §3.3/§3.7 forbid a four-level assumption. |
| No `Account.control_role` claim | **PASS** — roles via effective-dated mapping only (OD-20-3). |
| No Base Chart production implementation | **PASS** — documentation only; no schema/migration/seed/API/DTO/permission/UI. |
| No OQ-41 closure | **PASS** — dimensions out of scope; OQ-41 stays OPEN. |
| No OQ-43 closure | **PASS** — statutory out of scope; OQ-43 stays OPEN; no legal claim. |
| No ADR promoted to Accepted | **PASS** — no ADR changed. |
| No production-file modification | **PASS** — only `docs/**` changed. |

---

## 5. Known limitations

1. **Static inspection only.** All implementation claims are read-only code/schema
   inspection at the baseline commit; no runtime behaviour was exercised and no
   heavy E2E / live PostgreSQL was run (documentation-only task).
2. **Content deliberately absent.** No account code, title, nature, mandatory-list
   entry, or control role is proposed as content. Task 21 approves *governance and
   a content model*, never *content*.
3. **Predecessor acceptance state.** Task 20 is READY FOR REVIEW — NOT ACCEPTED at
   the baseline; Task 21's conclusions therefore also remain NOT ACCEPTED and
   depend on Task 20's Owner decisions standing.
4. **Governance proposals need owner ratification.** Conclusions marked as
   proposed governance (mandatory semantics, adoption/version/customization rules,
   control-role governance contract) are logically derived but require Owner /
   accountant acceptance to become binding policy.
