# Task 20 — Implementation Gate

- **Document type:** implementation decision gate — **DOCUMENTATION ONLY**
- **Date:** 2026-09-26
- **Task status:** **READY FOR REVIEW — NOT ACCEPTED** (the Agent does not self-accept)
- **Gate status:** **BLOCKED — OWNER DECISION REQUIRED**
- **Branch:** `arena/01a0ddc4-vardena`
- **Baseline:** `main` @ `3deb5a5d32641fa78438b9a96d9ca45f3558e707` (post-Task-19)
- **Investigation:** [`accounting-chart-semantics-investigation.md`](./accounting-chart-semantics-investigation.md)

> This gate authorizes **no implementation**. It does not promote an ADR, does
> not close an Open Question, does not reopen Task 19 and does not reinterpret
> any Owner decision. Production changes in this task: **NONE**.

---

## 1. Gate verdict

```text
BLOCKED — OWNER DECISION REQUIRED
```

**Why this and not another status.** All four statuses were evaluated:

| Candidate status | Applicable? | Reason |
|---|---|---|
| READY FOR IMPLEMENTATION | **No** | Criteria 2, 3, 4 and 12 of §16 of the Task 20 brief fail (see §2) |
| **BLOCKED — OWNER DECISION REQUIRED** | **Yes — selected** | Six Owner decisions (OD-20-1…OD-20-6) are missing, and every other blocker is downstream of them: the required ADR work cannot even be scoped until the Owner answers |
| BLOCKED — ADR / ARCHITECTURE REQUIRED | Applies, but weaker | ADR-0033/0034/0035/0037 are all **Proposed** and ADR-0034 §3 additionally needs an amendment — but which ADR work is needed depends on OD-20-5 and OD-20-3 |
| DEFERRED — DEPENDENCY NOT READY | Applies to one item only | The ADR-0035 migration service is additionally blocked by ADR-0030/OQ-45 and OQ-52/OQ-53 — a dependency, not the governing blocker |

The strongest applicable blocker is therefore **BLOCKED — OWNER DECISION
REQUIRED**.

---

## 2. READY-criteria assessment

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | Scope is bounded | **Partial** | Five candidate slices are bounded in shape (investigation §14) but none has a decided scope |
| 2 | Required Owner decisions already exist | **FAIL** | OD-20-1…OD-20-6 do not exist in the repository |
| 3 | No unresolved architecture contradiction blocks implementation | **FAIL** | **D-1** (Q5 non-leaf posting vs AC-D-19/AC-I-09) and **T20-C-1** (control-role artifact shape: contract §8.3 column vs §8.7/ADR-0037 §4 effective-dated mapping) |
| 4 | Required ADRs appropriately resolved | **FAIL** | ADR-0033, ADR-0034, ADR-0035, ADR-0037 all **Proposed**; ADR-0034 §6 additionally requires an accepted amendment before §3 may be used |
| 5 | No implementation would silently change Task 19 | **PASS** | Two forward dependencies recorded (T20-T19-DEP-1, T20-T19-DEP-2); ODR-1/ODR-2/ODR-3 unchanged |
| 6 | No unresolved security/tenant boundary introduced | **PASS** | Every future surface reuses `OrganizationsService.assertOrganizationInScope`; no new bypass proposed |
| 7 | Data ownership is clear | **Partial** | Clear for dimensions and code history (Accounting); **unclear** for base-chart templates (deployment vs organization) and role mappings (account attribute vs configuration object) |
| 8 | Migration strategy is understood | **Partial** | Additive-only is established; base-chart adoption semantics and code-history back-fill are undecided |
| 9 | Historical accounting integrity is protected | **PASS** | Ledger insert-only and id-keyed; no ledger row stores a code; version pinning + operational freeze; no proposed slice rewrites history (Invariant I-3) |
| 10 | Testing strategy is defined | **Partial** | `docs/testing/test-execution-policy.md` defines where tests run; per-slice test design awaits scope |
| 11 | Cross-module ownership is explicit | **Partial** | Accounting ownership is explicit; the first control-role **consumer** (Inventory→Accounting posting rules) is not authorized (OQ-24/OQ-25/OQ-30/OQ-39) |
| 12 | No dangerous invariant is left implicit | **FAIL** | The own-vs-descendant measure semantics that any non-leaf posting would require remain implicit until OD-20-5 |

---

## 3. Blockers

### BLOCKER B-20-1 — Vardena Base Chart has no decided delivery form, adoption semantics or content

- **Question:** In what artifact form is the base structure delivered, what does adoption do, and who supplies its content?
- **Why implementation cannot safely start:** Q2 commits Vardena to a base structure but ADR-0037 §3 fixes only its *form constraints* and leaves the content expert-gated; contract §1.2 non-goal 1 explicitly refuses to define codes, titles or a chart template. Any implementation would have to invent accounting content (AG-09/AR-31). Additionally, an incoherent pin pair would be correctly rejected by ODR-1, so adoption mechanics must be decided, not discovered.
- **Evidence:** `owner-decision-baseline.md` Q2 + D-5 · ADR-0037 §3 · contract §1.2 non-goal 1 · `backend/prisma/` (no seed, no template artifact) · `accounting/domain/account.ts` `planPinCoherence`
- **Owner decision required:** **OD-20-1**
- **ADR required? YES** — ADR-0037 must be adopted before a base-structure task may execute
- **Options:** A versioned template tables + explicit adoption operation · B reviewable versioned file artifact + import operation · C defer until a consuming need exists
- **Recommended option:** **A**, with content deferred to a separate accountant-approved deliverable

### BLOCKER B-20-2 — Control Role catalog, mandatory set and sequencing are undecided

- **Question:** Which roles exist, which are mandatory, and does a role foundation ship before its first consuming operation?
- **Why implementation cannot safely start:** There is no `control_role` column, table or service; contract §8.7's role names are explicitly "placeholders … not a decision"; ADR-0037 §5 makes mandatory-ness demand-driven, and AR-29 forbids speculative schema before a consumer exists. Building the catalog now would both invent accounting content and violate the consumer-first rule.
- **Evidence:** contract §8.7 (AC-D-09) · ADR-0037 §4/§5 · `prisma/schema/accounting.prisma` header ("deferred with the posting task that consumes them") · task-index §4 (control roles and posting rules are Candidates blocked by OQ) · OQ-25 OPEN
- **Owner decision required:** **OD-20-2**
- **ADR required? YES** — ADR-0037 adoption
- **Options:** A consumer-first · B foundation-first with an expert-approved catalog · C mechanism now with an empty catalog
- **Recommended option:** **A**

### BLOCKER B-20-3 — Control Role artifact shape contradicts itself (T20-C-1)

- **Question:** Is a control role a nullable column on `accounts`, or an effective-dated, audited mapping object?
- **Why implementation cannot safely start:** Contract §8.3 and contract §8.7 / ADR-0037 §4 describe two artifacts that cannot be the same thing — a nullable column cannot carry effective dating or its own audit trail. Choosing silently would pre-empt an ADR amendment and would fix the schema, permissions and audit surface by accident.
- **Evidence:** contract §8.3 attribute table row vs contract §8.7 · ADR-0037 §4 · `prisma/schema/accounting.prisma` header (defers it as a *column*)
- **Owner decision required:** **OD-20-3**
- **ADR required? YES** — an ADR-0037 amendment or an explicit contract precision
- **Options:** A effective-dated mapping relation · B nullable account column · C mapping owned by the accounting configuration version
- **Recommended option:** **A**

### BLOCKER B-20-4 — Account Code History has no producer and a circular ADR dependency

- **Question:** Does code history ship before any producer of a code change exists, and does a pre-use code edit write history?
- **Why implementation cannot safely start:** `accounts.code` is immutable from creation, so a history store built today would hold exactly one row per account forever (speculative schema, AR-29). ADR-0035 (the durable producer) requires ADR-0033 §3 (history), while history's only post-use producer is ADR-0035 — a circular dependency the Owner must break. ADR-0033 §3 also leaves the pre-use question explicitly undecided, and code reuse (baseline O-1) is governed by OQ-25/OQ-36, both OPEN.
- **Evidence:** ADR-0033 §3/§4/§6 + Consequences · ADR-0035 §1/§3/§4 · baseline D-2/D-3/D-7/O-1 · `accounting/domain/account.ts` ("NO code field on the update path") · `accounting/data/accounting-read-query.repository.ts` (renders and sorts by the current `a."code"`)
- **Owner decision required:** **OD-20-4**
- **ADR required? YES** — ADR-0033 adoption (and ADR-0035 if the migration service is chosen as the producer, itself blocked by ADR-0030/OQ-45 and OQ-52/OQ-53)
- **Options:** A producer-first · B store-first with back-fill · C bounded pre-use code edit first, then history
- **Recommended option:** **A**, with **C** as the preferred first producer

### BLOCKER B-20-5 — Non-leaf posting conflict (D-1) is unresolved

- **Question:** Does Vardena keep `postable ⇒ leaf` permanently, or open the ADR-0034 amendment path?
- **Why implementation cannot safely start:** Q5 says configuration "may allow posting at another level"; contract §14 rule 2 / AC-I-09 make it unrepresentable; ADR-0034 §6 keeps the strict rule in force and records the conflict as unresolved. The shipped Trial Balance / General Ledger roll-up (`account_rollup` → `trial_rows`) would merge a non-leaf POSTING node's own postings with its descendants' into a single undifferentiated row, while the Account Statement would report own-only for the same account — i.e. relaxation without ADR-0034 §4's separated measures is a double-counting defect.
- **Evidence:** `owner-decision-baseline.md` Q5 + I-2 + D-1 · ADR-0034 §3/§4/§5/§6 · contract §14 rule 2, §8.5, AC-I-09 · `accounting/domain/account.ts` (`planPostabilityChange`, `parent_postable`) · `accounting/data/accounting-read-query.repository.ts` (TB/GL roll-up CTEs) · `accounting/application/account-statements.service.ts` lines 130–135
- **Owner decision required:** **OD-20-5**
- **ADR required? YES if the Owner chooses relaxation** — an accepted ADR amendment superseding AC-D-19 rule 2 / AC-I-09 and amending contract §8.5. **NO additional ADR if the Owner keeps the strict rule** (a recorded decision suffices)
- **Options:** A keep `postable ⇒ leaf` permanently · B open the amendment path · C leave D-1 open
- **Recommended option:** **A** now, with **B** reachable by a later explicit decision

### BLOCKER B-20-6 — Dimension foundation scope and aggregation basis are undecided

- **Question:** Does the first dimension slice include floating details + line assignment + posting validation, and are assignments persisted on the document line only or also on the ledger entry (and is dimension aggregation ledger-native or a new projection key)?
- **Why implementation cannot safely start:** OQ-41 is OPEN for all dimension content. Separately, the repository is internally silent on persistence: contract §10.6 specifies a *document-line* child table, `accounting/domain/ledger-entry.ts` carries a ledger-side `dimensionAssignments` seam, and `accounting/domain/balance-projection.ts` excludes dimensions from the projection key by construction. No OQ owns this boundary.
- **Evidence:** contract §10.1–§10.7, §11.1–§11.4 · ADR-0037 §6/§7 · `accounting/domain/ledger-entry.ts` "Deferred dimension seam (OQ-41)" · `accounting/data/ledger-entries.repository.ts` lines 240–242 · `accounting/domain/balance-projection.ts` lines 15/243 · Task 18 D5 · OQ-41, OQ-22/OQ-55 OPEN
- **Owner decision required:** **OD-20-6** (scope/boundary only — content stays with OQ-41)
- **ADR required? YES** — ADR-0037 §6/§7 adoption; ADR-0031 if a dimension projection is chosen
- **Options:** A line-only persistence + ledger-native aggregation · B ledger-side persistence · C line persistence + a separate dimension projection
- **Recommended option:** **A**

---

## 4. What is explicitly NOT blocked

The following are already implemented and accepted, and nothing in Task 20
changes, weakens or re-opens them:

- ODR-1 Explicit Configuration Coherence (new account writes)
- ODR-2 Accounting-owned Chart Tree read surface
- ODR-3 Principal-bound Organization Authorization
- The configurable coding structure / accounting configuration mechanism and its
  version pinning
- `postable ⇒ leaf` and the POSTING/AGGREGATION role as surfaced by Task 18
- `Account.id` as permanent identity; the insert-only, id-keyed ledger

---

## 5. Sequencing recommendation (non-binding)

*Agent recommendation, not an authorization.* Once the Owner answers, the safest
order — derived from the dependency chains in the investigation, not from a
delivery preference — is:

```text
OD-20-5  (settle D-1: cheapest, removes a standing ambiguity, documentation-only if option A)
   ↓
OD-20-1  (base chart form + adoption; content continues in parallel with the accountant)
   ↓
OD-20-2 + OD-20-3  (control roles: sequencing then artifact shape, with the first consumer)
   ↓
OD-20-6  (dimension boundary, then OQ-41 content)
   ↓
OD-20-4  (code history, after a producer is authorized)
```

Each resulting task must still pass `docs/accounting/task-index.md` §7 admission
before any implementation agent may touch production code.

---

## 6. Governance statements

- **Production changes in Task 20:** **NONE.** No TypeScript, Prisma schema,
  migration, API, DTO, permission, authorization rule, index, dependency,
  frontend or existing test changed.
- **Task 19:** **UNCHANGED / NO REOPEN.** ODR-1, ODR-2 and ODR-3 remain exactly
  as accepted; two forward dependencies are recorded as constraints on future
  work only.
- **Open Questions:** none closed, narrowed or reclassified. **OQ-25, OQ-41,
  OQ-36, OQ-62, OQ-63, OQ-01, OQ-22, OQ-19, OQ-43, OQ-45, OQ-52, OQ-53 all
  remain OPEN.**
- **ADRs:** none promoted, amended or self-accepted. **ADR-0033, ADR-0034,
  ADR-0035, ADR-0036 and ADR-0037 all remain Proposed.**
- **Owner decisions:** none reinterpreted. Six new decisions are **proposed**, not
  taken.
- **Acceptance:** this gate is submitted **READY FOR REVIEW**. The Agent does not
  self-accept Task 20.

---

## 7. Verification performed

| Check | Result |
|---|---|
| `git diff --check` (whitespace/conflict markers) | **PASS** — no errors |
| Production file diff (`backend/`, Prisma, migrations, tests) | **EMPTY** — documentation only |
| Markdown reference/path validation for both Task 20 documents | **PASS** — every referenced repository path exists |
| Static documentation consistency (statuses of ADR-0033…0037, OQ-25/OQ-41/OQ-62/OQ-63/OQ-01/OQ-22/OQ-19/OQ-43, Task 17/18/19 statuses) | **PASS** — restated exactly as `main` records them |
| Heavy tests (`npm run test:e2e`, live PostgreSQL, migration rehearsal, CI-equivalent) | **NOT RUN** — prohibited for this documentation-only task by the brief §20 and `docs/testing/test-execution-policy.md`; no result is claimed, no test was skipped, weakened or force-exited |
