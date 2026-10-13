# Task 19 (candidate) — Accounting Chart & Configuration Foundation: Investigation and Implementation-Gate Report

- **Document type:** investigation + decision gate — **DOCUMENTATION ONLY**
- **Date:** 2026-09-25
- **Investigating agent:** Vardena Arena Agent (Repository Architect / Accounting Domain Investigator / DB-Prisma Investigator / Security & Tenant-Isolation Reviewer / Implementation-Gate Analyst)
- **Branch:** `arena/01a0da8b-vardena` (base `8b22068783e318600d87cbe76b8c80dcf632a2d0`, merge of PR #49)
- **Repository baseline inspected:** the working tree at the base commit, plus `STATE.md`, `docs/accounting/*`, `docs/adr/0033…0037`, `docs/tasks/task-17/*`, `docs/tasks/task-18/*`, `docs/open-questions.md`, the Accounting Prisma schema, all 15 migrations and the Accounting module source.

> **Status banner — investigation record (historical).** Written 2026-09-25 as
> documentation-only investigation. **Superseding governance (same date):** the Owner
> decided **ODR-1 / ODR-2 / ODR-3** (see
> [`owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md) §11).
> The implementation gate is
> [`task-19-implementation-gate.md`](./task-19-implementation-gate.md)
> (**READY FOR IMPLEMENTATION**; production **not started**). Owner ODR numbering
> **supersedes** this file's §21 labels (mapping in the gate). §20's
> `BLOCKED — OWNER DECISION REQUIRED` was correct **at investigation time**; it is
> **not** the current Task 19 gate.

> **No production change.** No TypeScript, Prisma schema, migration, SQL, API contract,
> permission, seed, dependency, refactor, test or UI change was made by this investigation.
> The only file added is this report.

---

## 1. Executive Summary

The repository already contains a **working, tested, version-pinned chart-of-accounts
foundation** (Task 10.3 + Task 11 + Task 13), and a separately accepted reporting read
foundation (Tasks 17A/17B/18). What it does **not** contain is almost everything the brief
calls "Accounting Chart & Configuration Foundation" *content*: no base/template chart, no
control roles, no account-code history, no dimensions, no floating detail, no
`account_type`/`is_temporary`, no account deletion, and no unified configuration root.

Findings in one paragraph each:

1. **Identity is already correct and id-based.** `Account.id` (ULID) is the permanent
   identity; ledger entries, document lines and the balance-projection key store
   `account_id` and **no** code. `Account.code` is unique per organization and **immutable
   from creation** — there is no code field on the update path at all.
2. **The `POSTING ⇒ leaf` invariant is real, enforced and tested** — in pure domain
   functions, re-applied inside locked transactions in the repository, and re-checked at
   posting time. A node can never be both POSTING and AGGREGATION today, because a node
   with children cannot be postable. There is **no stored role column**: AGGREGATION is
   *derived* (`is_postable = false`), and Task 18's Trial Balance derives the
   `POSTING`/`AGGREGATION` label at read time.
3. **Two parallel, versioned level roots exist** (`coding_structure_versions/_levels` from
   Task 10.3 and `accounting_configurations/_levels` from Task 11). Every account pins
   *both*. Account code-shape validation today reads **only the accounting-configuration
   levels**; the coding-structure version is pinned and required to be `active` but its
   digit lengths are **not consulted**. This is a foundation-level coherence gap
   (OQ-62 is OPEN and does not answer it).
4. **Every substantive "next" capability is gated by OQ-25, which is still OPEN.** The
   Task 17C Owner decisions (Q1–Q22, accepted 2026-09-25) decide the *model* but
   explicitly leave the *content* (base-structure codes/titles, control-role list and
   mandatory set, per-level posting policy, code-history/reuse shape, deletion guards)
   EXPERT-GATED under OQ-25.
5. **Organization scoping is structural, not enforced** (no principal → organization
   binding; OQ-01/OQ-22 OPEN; the only hard guard is the ADR-0025 deployment pin). Any
   principal holding `Accounting.Account.View` can read another organization's chart by
   supplying its `organizationId`. Financial-area scoping applies to books (documents,
   periods, ledger, balances), **not** to the chart: accounts carry no
   `financial_area_id`, there is no applicability table and no user↔area grants.

### Gate (argued in §20, stated once there)

The single verdict of this investigation is recorded in **§20 Implementation Gate**:
**`BLOCKED — OWNER DECISION REQUIRED`**.

---

## 2. Repository Evidence

Everything below was read in the working tree; where documentation and code disagree,
**code/schema evidence is recorded as the current implementation status** and the
discrepancy is named.

### 2.1 Governance documents read

| Document | Why it matters here |
|---|---|
| [`STATE.md`](../../../STATE.md) §3/§7/§8/§9/§10 | ADR inventory, task history, current task, OQ state |
| [`.vardena/agent-rules.md`](../../../.vardena/agent-rules.md) | AG-01 reading order, AG-07 (ADR required for architecture change), AG-09 (no invented rules), AG-17 (record, don't assume), AR-29 (no speculative columns) |
| [`docs/adr/README.md`](../../adr/README.md) | ADR lifecycle: immutable once Accepted; Proposed → Accepted is an Owner/Reviewer act; no self-acceptance |
| [`docs/accounting/task-index.md`](../../accounting/task-index.md) | §2 task register, §4 capability map, §5 OQ map, §7 future-task definition rule, §8 follow-ups |
| [`docs/accounting/owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md) | The authoritative Q1–Q22 + I-1…I-3 register, discrepancies D-1…D-13, open items O-1…O-12 |
| [`docs/accounting/domain-contract.md`](../../accounting/domain-contract.md) | §5.4/5.5, §8, §9, §10, §11, §14, §22, §25 (AC-I-01…AC-I-22), §31 addendum |
| [`docs/accounting/configuration.md`](../../accounting/configuration.md) | Task 11 configuration foundation data model and non-goals |
| [`docs/accounting/lock-order-matrix.md`](../../accounting/lock-order-matrix.md) | Rows A1–A5 (chart writes), CS1–CS3, AC11-1…AC11-3, D1–D5 |
| [`docs/open-questions.md`](../../open-questions.md) | OQ-25, OQ-43 (both OPEN), plus OQ-01/02/03/23/27/36/39/40/41/42/62/63/64 |
| [`docs/tasks/task-17/*`](../task-17) | 17A/17B/17C acceptance records, 17B investigation, next-step recommendation |
| [`docs/tasks/task-18/*`](../task-18) | Task 18 implementation report + acceptance record (the accepted reporting read foundation) |
| [`docs/adr/0033…0037`](../../adr) | The five Proposed ADRs that carry the chart/configuration decisions |

### 2.2 Code and schema read

| Path | Evidence extracted |
|---|---|
| `backend/prisma/schema/accounting.prisma` (L1–80 header, L334–402 `Account`, L243–317 coding structure, L447–511 configuration, L653–692 document lines, L784–856 `LedgerEntry`, L878–911 projection) | Model shape, deferred-column rationale, indexes, FK directions |
| `backend/prisma/migrations/20260914010000_accounting_coding_structure_accounts/migration.sql` | The `accounts` DDL: columns, `uq_accounts_organization_id_code`, FK RESTRICT, no area column, no delete path |
| `backend/prisma/migrations/20260920000000_accounting_configuration_foundation/migration.sql` | Task 11 configuration root + `accounts.accounting_configuration_id` NOT NULL |
| `backend/src/modules/accounting/domain/account.ts` | `ACCOUNT_NATURES` (L39), `ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS` (L120), `planAccountEdit` (L140), `planAccountPlacement` (L231), `planRootAccountPin` (L337), `planAccountMovePin` (L379), `planPostabilityChange` (L441), `defaultIsPostableForLevel` (L450) |
| `backend/src/modules/accounting/domain/coding-structure.ts` | `ACCOUNT_LEVEL_KINDS` (L73), `MAX_CODING_STRUCTURE_DEPTH = 8` (L92), `MAX_ACCOUNT_CODE_LENGTH = 32` (L93), `planCodingStructure` |
| `backend/src/modules/accounting/domain/accounting-configuration.ts` | `ACCOUNTING_CONFIGURATION_STATUSES` (L32), `MAX_ACCOUNTING_CONFIGURATION_DEPTH = 8` (L50), `MAX_LEVEL_KIND_LENGTH = 20` (L65), `planAccountingConfiguration` |
| `backend/src/modules/accounting/domain/account-code.ts` | `checkAccountCode`: digits-only, length = Σ segments, child code = parent code + segment |
| `backend/src/modules/accounting/domain/hierarchy.ts` | `collectDescendantIds` — the in-memory cycle/descendant walk |
| `backend/src/modules/accounting/data/accounts.repository.ts` | `createChecked` (L211), `updateChecked` (L342), `immutableRefusals` (L510), `countReferencingLinesInTx` (L397) |
| `backend/src/modules/accounting/application/accounts.service.ts` | The whole chart lifecycle; no delete method |
| `backend/src/modules/accounting/api/accounts.controller.ts` | GET list / GET one / POST / PATCH / enable / disable — no DELETE, no tree endpoint |
| `backend/src/modules/accounting/domain/accounting-permissions.ts` | 38 registered Accounting codes; no `Accounting.Account.Delete`, no `Accounting.ControlRole.*`, no `Accounting.FinancialAreaAccess.*` |
| `backend/src/modules/accounting/data/accounting-documents.repository.ts` (L1149–1172) | `lockAccountsForLinesInTx` — AC-I-09 at posting time (`account_not_postable`, `account_disabled`) |
| `backend/src/modules/accounting/data/accounting-read-query.repository.ts` (L708–824) | Task 18 Trial Balance: `posting_accounts` (= `is_postable = true`) rolled up to ancestors; `CASE WHEN "isPostable" THEN 'POSTING' ELSE 'AGGREGATION'` |
| `backend/src/modules/rbac/application/authorization.service.ts` | No wildcards; system-context (no request context) skips the check |
| `backend/src/modules/organization/application/organizations.service.ts` (L262–290) | `requireUsableOrganization` / `assertOrganizationInScope` — the ADR-0025 deployment pin only |

---

## 3. Current Account Model

### 3.1 Identity

| Question | Answer (code/schema evidence) | Status |
|---|---|---|
| Primary key | `accounts.id` — ULID, assigned by the application (`generateId()` in `AccountsService.createAccount`), never derived from a business field | IMPLEMENTED |
| Is `Account.id` stable? | Yes. No update path touches `id`; every historical row references it. Invariant **I-1** (identity half) | IMPLEMENTED — CONFIRMED |
| Code uniqueness scope | **Per organization**: `uq_accounts_organization_id_code` on `(organization_id, code)`. Not global, not per tree, not per area | IMPLEMENTED |
| Is code mutable? | **No.** `UpdateAccountDto` has no `code` field; `account.ts` states "There is therefore NO code field on the update path at all"; `PATCH /api/v1/accounting/accounts/:id` documents "The code is immutable" | IMPLEMENTED (stricter than Q3 — discrepancy **D-2**) |
| Code history | **None.** No history table, no validity columns, no as-at resolution | **NOT IMPLEMENTED** (see §7) |
| Code normalization/reuse | Trim only; digits-only; never reused (nothing is deleted) | IMPLEMENTED |

Historical rows carry no code at all: `accounting_document_lines` and `ledger_entries`
store `account_id` only, and the Task 12 projection key is
`(organization, area, year, period, account_id)`. **Invariant I-3 (a code migration
cannot rewrite economic history) is therefore structurally protected.**

### 3.2 Classification fields — implemented vs absent

| Field (contract §8.3) | Current status | Evidence |
|---|---|---|
| `organization_id` | **IMPLEMENTED** (NOT NULL, FK RESTRICT) | `accounting.prisma` L336 |
| `code` | **IMPLEMENTED** (`varchar(32)`, digits-only, unique per org, immutable) | `accounting.prisma` L341; `account-code.ts` |
| `title` | **IMPLEMENTED** (`varchar(200)`, Persian-capable, always editable) | `accounting.prisma` L343 |
| `parent_id` | **IMPLEMENTED** (nullable self-FK, `ON DELETE RESTRICT`) | `accounting.prisma` L346 |
| `level` | **IMPLEMENTED** (integer, always derived: root = 1, child = parent + 1; never a client input) | `account.ts` `planAccountPlacement`; `accounting.prisma` L349 |
| `coding_structure_version_id` | **IMPLEMENTED** (NOT NULL pin, Task 10.3 D2) | `accounting.prisma` L352 |
| `accounting_configuration_id` | **IMPLEMENTED** (NOT NULL pin, Task 11 D1/D3) | `accounting.prisma` L355 |
| `account_nature` (`debit` or `credit`) | **IMPLEMENTED** — a closed, decided, stored list (`ACCOUNT_NATURES`). Reporting-only: it does **not** restrict which side a line may use (§13.4) | `account.ts` L39; `accounting.prisma` L359 |
| `is_postable` | **IMPLEMENTED** — validated attribute, default from the level row, immutable after use | `account.ts` L441/L450; `accounting.prisma` L363 |
| `is_active` | **IMPLEMENTED** — the *whole* lifecycle; blocks new children and (via AC-I-09) new posting lines | `accounting.prisma` L366 |
| `account_type` | **NOT IMPLEMENTED** — deliberately deferred; vocabulary is EXPERT-GATED (OQ-25). No column | `accounting.prisma` L44–47 header |
| `is_temporary` | **NOT IMPLEMENTED** — no column, no derivation (`account_type` does not exist) | `accounting.prisma` L44–47 header |
| `control_role` | **NOT IMPLEMENTED** — no column, no enum, no mapping table | `accounting.prisma` L48–51 header; §9 below |
| `financial_area_applicability` | **NOT IMPLEMENTED** — no `financial_area_id` on accounts, no applicability table (OQ-40) | `accounting.prisma` L37–43 header; §10 below |
| `path` projection | **NOT IMPLEMENTED** — §8.2 allows it as a rebuildable projection; deliberately absent | `accounting.prisma` L322–325 |
| Detail dimensions | **NOT IMPLEMENTED** | §11 table |
| Audit columns | **IMPLEMENTED** (`created_at/updated_at/created_by/updated_by`, AR-12) | `accounting.prisma` L367–370 |

### 3.3 The dual-pin finding (material)

Every account pins **two** independently versioned configuration roots:

```text
accounts.coding_structure_version_id  → coding_structure_versions (+ coding_structure_levels)
accounts.accounting_configuration_id  → accounting_configurations (+ accounting_configuration_levels)
```

Both pins are NOT NULL, both must match the parent's pins on create and on move
(`planAccountPlacement` → `version_mismatch`), and a new root requires **both** rows to be
`active`/`ACTIVE` under lock (`planRootAccountPin`).

**But the two level sets are not interchangeable and only one is used:**

- `AccountsService.createAccount` builds the validation structure from the **accounting
  configuration**: `structure = { maxDepth: <config>.levels.length, levels: <config>.levels }`
  for both the root path and the child path. That structure is what
  `planAccountPlacement` → `checkAccountCode` consumes, so **an account's code length and
  per-level segment widths are governed by `accounting_configuration_levels`.**
- `coding_structure_version_id` is resolved, required to be `active`, locked on the root
  write path and compared for equality — **its `digit_length` values are never read during
  account code validation.**

Consequences recorded here, not resolved:

- Task 11's D2 ("`coding_structure_version_id` … remains the code-shape pin") is **not
  true of the code path**: the shape actually enforced comes from the configuration levels.
- `coding_structure_levels.level_kind` is a **closed** list
  (`group|general|subsidiary|detail`); `accounting_configuration_levels.level_kind` is
  **free text ≤ 20 characters**. Two contracts for the same conceptual label.
- Publishing a new version of one root does not supersede the other, so a live
  organization can hold accounts whose two pins describe different depths or digit
  lengths. **`OQ-62` (pin compatibility) is OPEN and does not answer which root wins.**
  The Task 11 rehearsal already produced such a divergence in a legacy organization.

This is recorded as **NEW-OQ-CANDIDATE-A** (§16) and as a repository-foundation risk
(§13.4, §20).

---

## 4. Current Hierarchy

### 4.1 Representation

One table, adjacency plus an integer level (contract §8.2, AC-D-07). There are **no**
`groups` / `generals` / `subsidiaries` / `details` tables and no level constant: `گروه /
کل / معین / تفصیلی` is the `level_kind` **vocabulary** (`ACCOUNT_LEVEL_KINDS`), stored for
display only, with duplicates allowed and no behavioural effect.

| Aspect | Implementation | Status |
|---|---|---|
| Parent relation | `accounts.parent_id` self-FK, `ON DELETE RESTRICT` (an ancestor can never vanish under a subtree) | IMPLEMENTED |
| Root structure | `parent_id IS NULL` ⇔ `level = 1`; a root is validated against the ACTIVE configuration + ACTIVE coding version, both locked (`planRootAccountPin`) | IMPLEMENTED |
| Level representation | Integer column, **always derived** (never accepted from a client; there is no `level` field on any DTO) | IMPLEMENTED |
| Depth enforcement | `level > maxDepth` → `depth_exceeded`. `maxDepth` is the accounting-configuration level count; the architecture caps are `MAX_CODING_STRUCTURE_DEPTH = 8` and `MAX_ACCOUNTING_CONFIGURATION_DEPTH = 8` | IMPLEMENTED |
| Depth configurability (Q1) | Configurable **per organization, per configuration version**; never hardcoded to four. Raising the cap is a code change with an ADR note, not configuration | IMPLEMENTED — CONFIRMED (Q1) |
| Sibling constraints | No uniqueness rule beyond the global `(organization_id, code)`; the code-prefix rule (child = parent code + the level's segment) makes two siblings unable to share a code | IMPLEMENTED (implicitly, by the code rule) |
| Cycle prevention | `descendantIds.includes(parent.id)` → `cycle`; `self_parent` → refused. `collectDescendantIds` terminates on already-corrupt data via a `seen` set. Re-checked **inside** the move transaction against locked rows in ascending id order | IMPLEMENTED |
| Orphan prevention | FK `RESTRICT` on `parent_id`, plus nothing is ever deleted (§8.6) | IMPLEMENTED |
| Active/inactive behaviour | `parent.isActive === false` → `parent_disabled` (blocks new children); the existing subtree stays fully readable | IMPLEMENTED |
| Subtree/version isolation | A move is validated only against the pair the account is **already pinned** to (`planAccountMovePin` → `pin_mismatch`); a parent under another configuration or coding version → `version_mismatch` | IMPLEMENTED |
| Re-levelling guard | `restructure_with_children` — moving a node that has children may not change its level, because descendants keep immutable codes (policy = OQ-25) | IMPLEMENTED |
| Tree read endpoint | **None.** `accounts.controller.ts` states tree reads are reporting projections, not part of this module's API. Task 18 performs hierarchy roll-up in report SQL | NOT IMPLEMENTED (deliberate) |
| Code ⇄ hierarchy consistency | `checkAccountCode` enforces digits-only, `length = Σ segments`, and child = parent + exactly one segment. The FK is the authority; the prefix is the proof | IMPLEMENTED |

---

## 5. POSTING / AGGREGATION Analysis

The eight questions of §7 of the brief, answered from code:

| # | Question | Answer |
|---|---|---|
| 1 | How is POSTING represented? | `accounts.is_postable BOOLEAN` — a stored, validated account attribute (contract §14 rule 1). Its default comes from the level row (`default_is_postable`, `defaultIsPostableForLevel`). A document line may reference only a postable **and** active account (`lockAccountsForLinesInTx` → `account_not_postable` / `account_disabled`). |
| 2 | How is AGGREGATION represented? | **Implicitly / by derivation.** There is no role column. A non-postable account's movement and balance are the roll-up of its descendants (§8.5), computed at read time. Task 18 labels it at read time: `CASE WHEN "isPostable" THEN 'POSTING' ELSE 'AGGREGATION' END AS "role"`. |
| 3 | Is `postable ⇒ leaf` enforced structurally? | **Yes, on both write paths.** (a) `planAccountPlacement` refuses a child under a postable parent (`parent_postable`); (b) `planPostabilityChange` refuses `is_postable = true` on a node that has children (`postable_with_children` → `AccountPostabilityRejectedError`). A leaf may still be non-postable (contract §14 rule 3) — this is not "postable ⇔ leaf". |
| 4 | Can a parent currently receive ledger entries? | **No.** To be a parent an account must be non-postable, and a non-postable account is refused at posting time. |
| 5 | Can an account both aggregate and post? | **No.** A node with children cannot be postable, so "postable parent + children roll-up" is unrepresentable. Double counting is therefore impossible today. |
| 6 | Where is this enforced? | Four places: (i) pure domain — `domain/account.ts`; (ii) application pre-flight — `AccountsService.assertPlacement` (fast 422 feedback); (iii) **authoritative** — `AccountsRepository.createChecked` / `updateChecked` re-run the same decision table inside the transaction against `SELECT … FOR UPDATE` rows (children counted under the node's own lock); (iv) posting time — `lockAccountsForLinesInTx` under `FOR SHARE`. |
| 7 | Application-level, database-level, or both? | **Application-level, by design.** The migration header states why: exclusion constraints, recursive CHECKs and triggers are invisible to Prisma and would be **dropped by the next generated migration**, silently losing the invariant. The unique indexes are backstops for *identity* races (code uniqueness, one ACTIVE version per organization), not for the tree invariants. |
| 8 | What tests prove the invariant? | `domain/account-placement.spec.ts`: "refuses a child under a postable parent (double-count guard)", "refuses making an account with children postable", "allows making a leaf postable and allows removing postability", "keeps a leaf non-postable when the organization wants a placeholder", "takes the default from the level definition, not from a level name". `application/coding-structure-accounts.spec.ts`: "enforces the postable ⇄ leaf invariant on both write paths". Live PostgreSQL: `backend/test/account-structure-live.e2e-spec.ts` — "serialises a postability flip against the first child create". |

### 5.1 The recorded D-1 conflict — subsequently resolved by Task 20

At this investigation's baseline, Owner decision **Q5** said configuration *may* allow
posting at another level while contract §14 rule 2 (AC-D-19) and invariant AC-I-09 made
`postable ⇒ leaf` structural. **Task 20 OD-20-5 subsequently resolved D-1** by selecting
that leaf-only rule: `POSTING = leaf-only` and `AGGREGATION = reporting/read-time roll-up`.
ADR-0034 now records the authoritative decision. A future non-leaf-posting exception
would require a new explicit decision that reopens/supersedes the rule, together with
ADR/read-model redesign, explicit transition rules, report disclosure, and denial-path
tests. **None of that exception work exists or is authorized.** Therefore:

- `POSTING`/`AGGREGATION` as a *stored, configurable role*: **NOT IMPLEMENTED / NOT
  AUTHORIZED**.
- `POSTING` as `is_postable` + `AGGREGATION` as derived roll-up: **IMPLEMENTED AND
  ENFORCED**.
- Per-level posting policy content (which levels a business posts to): **EXPERT-GATED,
  OQ-25 (open item O-3)**.

---

## 6. Account Identity

Already covered in §3.1; the normative summary:

```text
Account.id (ULID) ── permanent ──→ accounting_document_lines.account_id
                               ──→ ledger_entries.account_id
                               ──→ account_balance_projections.account_id
Account.code ── business/display identifier, unique per organization, immutable, no history
```

- Historical reporting resolves identity by id (§19.2 rule 3 filters on **stored**
  `fiscal_year_id`/`accounting_period_id` and joins `account_id`).
- Opening/carry-forward semantics (ADR-0031 §4/§9, Task 17B D2) key on `Account.id`, so a
  code change could never split or orphan an opening balance.
- Integrations must treat a code as a controlled business reference only where an
  integration contract explicitly says so, and must state whether it means the current or
  the as-at-date code (ADR-0033 §8). **No integration surface exists today.**

---

## 7. Code History

### 7.1 Current state: `NOT IMPLEMENTED`

| Element | Status |
|---|---|
| Code-history table | **NOT IMPLEMENTED** — no `account_code_history`, no validity columns |
| Effective-dated codes | **NOT IMPLEMENTED** |
| As-at historical code resolution | **NOT IMPLEMENTED** — Task 17A/17B/18 read surfaces render the **current** code |
| Historical → current mapping exposure | **NOT IMPLEMENTED** |
| Audit of a code change | **NOT IMPLEMENTED** (no code change is possible at all) |
| Backstop that keeps the gap harmless | IMPLEMENTED — no historical row stores a code, and a code can never change, so Q18's rule is today *vacuously* satisfied |

This is discrepancy **D-3** in the Owner baseline: "Today the rule is *vacuously*
satisfied (a code never changes), so no report is wrong — but the mechanism the Owner
decided (history + as-at resolution) must be built additively."

### 7.2 Minimum future contract (design target, NOT implemented, NOT authorized)

Derived from ADR-0033 §3/§4, contract §9.2/§9.5 and baseline open items **O-1**:

| Element | Minimum contract the future task must state |
|---|---|
| Old code / new code | The superseded value and the new value, both stored; never a mutation in place |
| Validity | A time-scoped fact with an explicit validity axis — **whether that axis is `document_date`, a fiscal-year/period boundary or a wall-clock effective date is NOT decided** (this is part of O-1/OQ-25) |
| Historical resolution | `report date → Account.id → historical code → report`, with the current code and the mapping available as an explicit **alternative view**, never a silent rewrite |
| Uniqueness | How a history table coexists with `uq_accounts_organization_id_code`, and whether the unique key becomes `(organization_id, code)` over *current* codes only |
| Reuse | Whether a superseded code may ever be re-issued to another account — **UNDECIDED**, OQ-25 + OQ-36 (O-1) |
| Auditability | Actor, timestamps, and the reference check that proves the account was unused (or the ADR-0035 migration run that authorized the change) |
| Identity | `Account.id` never changes; opening logic, projections and correction links stay id-based |
| Migration boundary | Writing history must never rewrite economic ledger history (I-3, ADR-0035 §4) |

**No schema, migration, column or endpoint is proposed or authorized by this report.**

---

## 8. Account Lifecycle

### 8.1 The lifecycle as implemented

```text
Create (POST /accounts)
   │   level derived, code validated, both pins locked + required ACTIVE,
   │   is_postable defaulted from the level row, is_active = true
   ▼
Configure / restructure (PATCH /accounts/:id)   ── only while NO document line references it
   │   title (always), accountNature, isPostable, parentId
   ▼
Use / post (voucher finalization)
   │   account locked FOR SHARE, must be postable + active
   ▼
Historical usage (immutable document lines + ledger entries)
   │   structural fields freeze (AC-I-11)
   ▼
Deactivate (POST /accounts/:id/disable)  ── and re-enable (…/enable)
```

### 8.2 Transition matrix (actual code behaviour)

| Transition | Allowed? | Where / rule | Status |
|---|---|---|---|
| **Delete before use** | **No** | No `DELETE` route (`accounts.controller.ts`), no `Accounting.Account.Delete` code (`accounting-permissions.ts`), no repository delete method. An HTTP `DELETE` on `/accounts/:id` returns 404 (asserted by `account-structure.e2e-spec.ts`) | NOT IMPLEMENTED (stricter than Q21 — discrepancy **D-4**) |
| **Delete after use** | **No** | Same; additionally backed by AC-D-08 / §8.6 freeze-over-delete | NOT IMPLEMENTED (correct per Q21) |
| **Deactivate after use** | **Yes** | `POST /accounts/:id/disable` → `is_active = false`. No guard exists for a non-zero balance or for activity in an open year (that guard is open item **O-4**, OQ-25). Existing children and history remain fully readable; new children (`parent_disabled`) and new posting lines (`account_disabled`) are refused | **PARTIAL** — mechanism implemented, guard policy undecided |
| **Code change before use** | **No** | No code field on the update path; `code` immutable **from creation** (stricter than Q3 — **D-2**) | NOT IMPLEMENTED |
| **Code change after use** | **No** | Same; and ADR-0035 §1 makes the migration service the only sanctioned future path | NOT IMPLEMENTED (correct per Q3/I-3) |
| **Parent change before use** | **Yes** | `PATCH` with `parentId`; full placement re-validation under lock: exists, same org, active, not postable, no cycle, same pinned pair, depth OK, code still extends the new parent's code, level unchanged if the node has children | IMPLEMENTED |
| **Parent change after use** | **No** | `planAccountEdit` refuses `parentId` + `level` once `countReferencingLinesInTx > 0` (evaluated under the account's `FOR UPDATE` lock, so it interlocks with a voucher's `FOR SHARE` lock) | IMPLEMENTED (AC-I-11) |
| **POSTING/AGGREGATION change before use** | **Yes, within the leaf rule** | `is_postable` may flip while unreferenced; refused if the node has children | IMPLEMENTED (bounded) |
| **POSTING/AGGREGATION change after use** | **No** | `ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS` includes `isPostable` | IMPLEMENTED (AC-I-11) |
| **Nature change before use** | **Yes** | `accountNature` ∈ `debit`/`credit`, freely editable while unreferenced | IMPLEMENTED |
| **Nature change after use** | **No** | `ACCOUNT_IMMUTABLE_AFTER_USE_FIELDS` includes `accountNature` | IMPLEMENTED (AC-I-11) |
| **Title change any time** | **Yes** | Titles are governance; codes and structure are not | IMPLEMENTED |
| **Non-leaf POSTING** | **No** | Blocked by `postable ⇒ leaf` (§5, D-1) | NOT IMPLEMENTED / NOT AUTHORIZED |
| **Account type / temporary change** | n/a | `account_type` and `is_temporary` do not exist | NOT IMPLEMENTED |

### 8.3 The "usage" predicate

`referencedByDocumentLine` is **data, not a flag**: `countReferencingLinesInTx(tx, id) > 0`
over `accounting_document_lines`, evaluated inside the account's locked transaction. There
is deliberately no `used_at` column and no usage counter (a denormalized flag could drift).
Q21's rule that "a zero current balance is not evidence of no usage"
(`+100M / −100M = 0`) is satisfied by construction: the test counts **references**, never
balances.

Note the scope limit: the freeze predicate counts **document lines**, not ledger entries. A
`draft`/`temporary` voucher line therefore already freezes the account's structure, while a
`final` voucher always has lines. This is stricter than "has ledger history" and is the
shipped behaviour — recorded here, not changed.

---

## 9. Control Roles

| Element | Domain decision | Current implementation |
|---|---|---|
| Control-role enum | Decided as a **code-defined closed list** whose vocabulary is EXPERT-GATED (contract §8.7 AC-D-09; ADR-0037 §4). The contract's examples (`receivable`, `payable`, `inventory`, `cogs`, `revenue`, `tax_payable`, `cash`, `bank`, `opening_equity`, `retained_earnings`, `closing_clearing`) are **explicitly placeholders, not a decision** | **NOT IMPLEMENTED** — no enum, no constant, no table |
| `control_role` column on accounts | Contract §8.3 lists it as nullable | **NOT IMPLEMENTED** — deliberately deferred in `accounting.prisma` L48–51 |
| Organization-level role → account mapping | Decided: organizations map their own accounts to roles once, effective-dated, permission-gated, audited (AC-D-09) | **NOT IMPLEMENTED** — no mapping table |
| Bootstrap / base-structure mappings | Decided as a Vardena commitment (Q2/ADR-0037 §3) whose content is OQ-25 | **NOT IMPLEMENTED** — no template artifact, no seed script anywhere under `backend/prisma` |
| Validation that mandatory operational roles are mapped | Decided: demand-driven — a role becomes mandatory when a shipped operation consumes it (Q4, ADR-0037 §5) | **NOT IMPLEMENTED** — and **no consuming operation exists**: no posting rules, no year-transition operation, no control report. So the mandatory set is empty by the Owner's own rule |
| Permission vocabulary | Contract §22 lists `Accounting.ControlRole.{View, Map}` | **NOT REGISTERED** — `accounting-permissions.ts` registers only codes the code enforces (`docs/security.md` §3) |

**No role is invented by this investigation** (AR-31/AG-09). The control-role list, the
mandatory set and the base structure's content remain EXPERT-GATED under **OQ-25**
(baseline **D-5**, open item **O-2**).

---

## 10. Organization / Financial Area Scope

| Question | Answer | Status |
|---|---|---|
| Organization ownership | `accounts.organization_id` NOT NULL, FK RESTRICT. Every list is org-filtered; every by-id read resolves through `mustFindInOrganization` (404 for a foreign id, never 403 — AC-I-01/16) | IMPLEMENTED |
| Is account configuration organization-specific? | **Yes** — the chart, the coding-structure versions and the accounting configurations are all organization-scoped; `code` is unique per organization | IMPLEMENTED |
| Financial-area relationship | **None on the account row.** Accounts carry no `financial_area_id`. Contract §5.4 (AC-D-04): the chart and coding structure are **organization-scoped**, with an *applicability* relation to areas; **areas scope years, periods, documents, numbering and balances** | BY DESIGN (contract) |
| Can one account exist across multiple financial areas? | **Yes — one account row serves every area of the organization** (there is no per-area chart and no area column). Per-area *restriction* would be an applicability relation | NOT IMPLEMENTED (applicability table absent; OQ-40) |
| Is financial-area isolation implemented for the chart? | **No.** There is no applicability table, no per-account area predicate, and no account-level area check at posting time (`lockAccountsForLinesInTx` checks org + postable + active only) | NOT IMPLEMENTED |
| User ↔ financial-area access grants | Contract §5.5 (AC-D-05) target model with `Accounting.FinancialAreaAccess.{View,Grant,Revoke}`; interim posture = **structural scoping only** (caller-supplied area, exactly like `organizationId`) | NOT IMPLEMENTED (OQ-40). No `FinancialAreaAccess` permission code is registered |
| Does `organization_id` alone solve area authorization? | **No — and the repository already says so.** ADR-0021 §3 and contract §5.5: "structural scoping is not security". Areas are validated for existence/scope, never for caller entitlement | DOCUMENTED GAP |

Task 18's read APIs require one organization **+ one financial area + one fiscal year** per
request and filter `ledger_entries.financial_area_id`, so the *books* are area-scoped while
the *chart* is not. That split is deliberate (AC-D-04) and is a dependency, not a defect.

---

## 11. Configuration Boundaries

Status vocabulary: **IMPLEMENTED** (in code, tested) · **PARTIAL** (mechanism only, or
mechanism without policy) · **NOT IMPLEMENTED** · **DEFERRED/EXCLUDED** (decided out of
scope).

| Capability | Current Status | Authorized Next Step | Future / Deferred |
|---|---|---|---|
| **Coding levels** | **IMPLEMENTED.** Configurable count, titles, digit lengths, `level_kind` labels and per-level posting defaults in **two** versioned roots; caps are code constants (depth ≤ 8, code ≤ 32); one ACTIVE per organization; publish is immutable. **Caveat: dual-pin, §3.3** | **None without an Owner decision.** Unifying or subordinating the two level roots is an architecture decision (ADR territory, AR-29) and touches OQ-62 | Level-count **migration** of existing accounts is **EXCLUDED** (Q20/ADR-0035 §8). A *new* version with a different depth for *newly created* accounts is ordinary configuration and already works |
| **Code lengths** | **IMPLEMENTED.** `digit_length` per level; total ≤ 32; validated via **accounting-configuration** levels; changeable only by publishing a new version (existing accounts stay pinned, §9.4) | **None.** A pre-use code edit (Q3/D-2) needs its own task + the O-1 reuse answer | Post-use code-length / re-coding → **Vardena Code Structure Migration Service** (ADR-0035). Not authorized; needs ADR-0033 §3 (history), ADR-0030/OQ-45 (licensing), OQ-52/53 (backup), OQ-62/63 (pin divergence) |
| **Group structure** | **PARTIAL / VOCABULARY ONLY.** `level_kind = 'group'` is stored as an informational label; **nothing** derives behaviour from it | **None.** No group entity is wanted (contract §8.2 rejects four tables) | Group *semantics* (report grouping, roll-up level) is a reporting concern, OQ-25 |
| **General structure** | **PARTIAL / VOCABULARY ONLY** — same as above (`level_kind = 'general'`) | **None** | As above |
| **Subsidiary structure** | **PARTIAL / VOCABULARY ONLY** — same (`level_kind = 'subsidiary'`) | **None** | As above |
| **Detail structure (tree detail)** | **PARTIAL.** A "detail" account is simply the deepest configured level of the tree — an ordinary account node with an informational `level_kind`. No marker distinguishes it, and no report keys off it | **None.** Any stronger notion (mandatory detail level, detail-level validation) is OQ-25 policy content | Detail *dimensions* attached to postable accounts (§14 rule 6, AC-I-18) |
| **Floating Detail** | **NOT IMPLEMENTED.** No `accounting_detail_items`, no dimension tables, no assignment table. Contract §11 (AC-D-15) is contract-only | **None** — blocked by **OQ-41** (count, defaults, binding, governance) and depends on the dimension model (ADR-0037 §6) | A dimensions + floating-detail task after OQ-41 |
| **POSTING** | **IMPLEMENTED** (`is_postable` + posting-time check + leaf invariant) | **None needed for today's semantics** | A **stored, configurable role attribute** and non-leaf POSTING require an accepted ADR amendment superseding AC-D-19/AC-I-09 + §8.5 (D-1, ADR-0034 §5/§6) and separated own-vs-descendant measures |
| **AGGREGATION** | **IMPLEMENTED as derivation** (non-postable ⇒ roll-up of descendants; computed at read time, labelled by Task 18's Trial Balance) | **None needed** | Stored role attribute; explicit inclusion disclosure in reports (ADR-0034 §4/§7) |
| **Account Nature** | **IMPLEMENTED** (`debit`/`credit`, closed list, stored, frozen after use) | **None** | `account_type` / `is_temporary` / statement classification — EXPERT-GATED, **OQ-25**; no column may be added speculatively (AR-29) |
| **Control roles** | **NOT IMPLEMENTED** (§9) | **None** — role list and mandatory set are OQ-25 (D-5, O-2); no consuming operation exists to make a role mandatory | A base-structure + control-role task after OQ-25 |
| **Account code history** | **NOT IMPLEMENTED** (§7) | **None** — needs the O-1 reuse answer and the validity-axis decision | An additive schema task with its own migration (AR-10/AR-29), recorded by ADR-0033 §3 |
| **Code migration** | **NOT IMPLEMENTED / EXCLUDED from this investigation** | **None.** The service needs its own task and cannot be licensed yet (ADR-0030 Proposed, enforcement OFF, no `license` schema; OQ-45 open) | Vardena Code Structure Migration Service (ADR-0035) |
| **Level-count migration** | **EXCLUDED** by Q20 / ADR-0035 §8 | **None** | Requires its own Owner decision + ADR |
| **Dimensions** | **NOT IMPLEMENTED.** `ledger-entries.repository.ts` hardcodes `dimensionAssignments: []` because OQ-41 is unresolved | **None** | Dimensions task after OQ-41; never EAV, never a giant JSONB (ADR-0037 §7, contract §10.6) |
| **Financial Area (chart)** | **PARTIAL.** Areas exist and scope books; the chart is org-scoped with **no** applicability relation | **None** — applicability is entangled with OQ-40 | Per-account area applicability + user↔area grants, after OQ-40 |
| **Account deletion** | **NOT IMPLEMENTED.** No route, no permission, no repository method; freeze-over-delete for every account (D-4, stricter than Q21) | **None** — needs the O-4 blocking-reference list, the O-1 code-reuse answer and a granular permission | A deletion task for provably unused accounts (Q21 first half) |
| **Account deactivation** | **IMPLEMENTED** (`is_active`; blocks new children and new posting lines; history stays readable) | **None** | The guard "refuse deactivation while a balance is non-zero or activity exists in an open year" is open item **O-4** / OQ-25 |

---

## 12. Security Review

Findings are **recorded, not fixed** (per the task's no-implementation rule).

### 12.1 What is correctly implemented

| Control | Evidence |
|---|---|
| Double authorization (route guard + application service) — AC-I-21, AR-21 | `@UseGuards(AuthGuard, AuthorizationGuard)` + `@RequirePermission(...)` on every route, **and** `authorization.requireAllPermissions([...])` as the first statement of every service method |
| Granular codes, no wildcards | `accounting-permissions.ts` — 38 explicit codes; `Accounting.Account.*` = `View/Create/Edit/Enable/Disable`; the header states "No wildcards, no superuser, no implicit bypass (OQ-21)". `AuthorizationService` has no wildcard, no prefix matching, no admin escape |
| No dormant permissions | Only codes the code enforces are registered (`docs/security.md` §3). No `Accounting.Account.Delete`, no `ControlRole.*`, no `FinancialAreaAccess.*` |
| Cross-organization references answer **404**, not 403 — AC-I-16 | `mustFindInOrganization`; `placementException` maps `cross_organization` and `parent_not_found` to `notFound` so a foreign id is indistinguishable from a missing one |
| Deployment pin | ADR-0025: `assertOrganizationInScope` refuses any organization other than `DEPLOYMENT_ORGANIZATION_ID` (404) |
| Organization predicate inside raw SQL | `accounting-configuration-usage.ts`: the marker `UPDATE` carries `organization_id` in the `WHERE`, "not an afterthought" |
| Disabled organization blocks writes | `requireUsableOrganization` on every account write path (asserted by `coding-structure-accounts.spec.ts`: "refuses every write for a disabled organization or a pinned-out-of-scope one") |

### 12.2 Findings (recorded, not fixed)

| # | Finding | Severity / class | Evidence |
|---|---|---|---|
| **S-1** | **Organization isolation is structural, not enforced.** There is no principal → organization binding (OQ-01/OQ-22 OPEN). `organizationId` is **caller-supplied** on every account route (query for read/list, body for create). Any principal holding `Accounting.Account.View` can list or read **any** organization's chart by supplying its ULID; the same holds for `Create/Edit/Enable/Disable` where the pin is unset. | HIGH — tenant-isolation / IDOR by design-until-OQ-01 | `AccountingScopeQueryDto`, `ListAccountsQueryDto`, `OrganizationsService.assertOrganizationInScope` (pin only), `docs/open-questions.md` OQ-01 |
| **S-2** | **Financial-area authorization does not exist.** Areas are validated for existence and scope, never for caller entitlement (contract §5.5 interim posture). Combined with S-1, area-scoped reads are protected only by organization-level RBAC. | MEDIUM — documented gap, OQ-40 | contract §5.5; no `FinancialAreaAccess` codes; no grant table |
| **S-3** | **Direct repository use bypasses organization scoping.** `AccountsRepository.findById(id)` and `findByCode(organizationId, code)` are exported and unscoped by caller; the organization check lives in the **service** (`mustFindInOrganization`). Any future caller that reaches the repository directly (a job, an integration, a new service) inherits no isolation. | MEDIUM — latent bypass path | `accounts.repository.ts` L134/L141 vs `accounts.service.ts` `mustFindInOrganization` |
| **S-4** | **System context skips authorization entirely.** `AuthorizationService.requireAllPermissions` returns immediately when there is no request context ("bootstrap, worker, direct service use in tests"). Correct for bootstrap, but it means a non-HTTP caller of `AccountsService` is unauthenticated by design. | LOW / accepted (documented) — becomes MEDIUM for any future job/integration caller | `authorization.service.ts` `requireAllPermissions` |
| **S-5** | **No audit module.** Contract §23 (AC-D-35) requires Accounting to *emit* sensitive-write audit facts; persistent audit storage is a separate, unimplemented module (AR-23). Chart writes publish in-memory domain events (`Account.Created/Updated/Enabled/Disabled`) but persist no audit trail. | MEDIUM — auditability gap | `docs/accounting/domain-contract.md` §23; `accounting.events.ts` |
| **S-6** | **Event bus is in-memory.** A chart event lost on crash is unrecoverable; there is no outbox for Accounting (OQ-39 OPEN). | LOW / accepted risk | ADR-0024 §9, OQ-39 |
| **S-7** | **Hierarchy guards are application-level only.** A defect, a hand-written SQL script or a future migration could create a postable parent or a cycle, because no database constraint backstops them. Mitigated (not eliminated) by locked transactions and tests. | LOW / accepted (documented, deliberate — Prisma drift) | migration header; `accounting.prisma` L66–78 |
| **S-8** | **`levelKind` is free text in the accounting-configuration root** (≤ 20 chars, non-blank) while the coding-structure root's `levelKind` is a closed list. Free text in a configuration surface that reports consume is a display/injection-adjacent surface (bounded by the width check, never truncated). | LOW / inconsistency | `accounting-configuration.ts` L65, `planAccountingConfiguration` |
| **S-9** | **No rate-limit or abuse control specific to the chart** beyond the global kernel rate limit; a `search` filter over code/title is an unindexed `ILIKE` on large charts. | LOW / performance-adjacent | `accounts.repository.ts` `toWhere` (`contains … mode: 'insensitive'`) |

No wildcard permission behaviour was found. No hidden bypass path other than S-3/S-4
(system context) was found.

---

## 13. Database Review

**No migration was created and none may be created by this investigation.**

### 13.1 What exists

| Model / table (schema `accounting`) | Purpose |
|---|---|
| `financial_areas` | Bookkeeping scope; `uq_financial_areas_organization_id_code` |
| `fiscal_years`, `accounting_periods` | Calendar; period rows are explicit, with `sequence` |
| `coding_structure_versions`, `coding_structure_levels` | Task 10.3 coding structure (depth, digit lengths, separator, `level_kind`, `default_is_postable`) |
| `accounting_configurations`, `accounting_configuration_levels` | Task 11 versioned configuration root (`DRAFT→ACTIVE→SUPERSEDED`, one ACTIVE per org, `operationally_used_at`, `effective_from`) |
| `accounts` | The whole chart: `parent_id`, `level`, both pins, nature, `is_postable`, `is_active` |
| `accounting_documents`, `accounting_document_lines` | Voucher aggregate, `draft→temporary→final` |
| `accounting_posting_operations` | Idempotency ledger, `uq_accounting_posting_operations_org_key` |
| `ledger_entries` | Immutable, insert-only; stores `account_id`, **no code**; both date axes; stored year/period/area |
| `account_balance_projections` (+ `vw_account_balance_derived`, `vw_balance_reconciliation`) | Task 12 derived turnover projection |
| rbac / identity / organization / inventory / documents / workflow schemas | Out of scope except as dependencies |

15 migrations, applied in order; `migration_lock.toml` present.

### 13.2 What can be extended safely

| Extension | Safe? | Why |
|---|---|---|
| Additive **nullable** columns on `accounts` | Yes | No backfill required; Prisma-safe |
| New tables under `accounting` with `organization_id` NOT NULL + FK RESTRICT | Yes | Matches every existing table; module-schema isolation (ADR-0008) |
| New unique indexes / indexes | Yes | Additive |
| New views over `accounts` + `ledger_entries` | Yes | ADR-0009 view-first reporting |
| Widening or re-scoping `uq_accounts_organization_id_code` | **No** | It is the hard backstop for code identity; a code-history model must re-express it deliberately (ADR-0033 Consequences) |
| Making `accounts.code` mutable | **No** | Would break I-1/I-3, the after-use freeze and the never-reuse rule at once |
| Adding `control_role`, `account_type`, `is_temporary`, dimension columns | **No — not yet** | AR-29 forbids speculative columns before a consuming operation exists; content is OQ-25/OQ-41 |
| Triggers, CHECK constraints, exclusion constraints | **No** | Every migration header records that Prisma cannot represent them and a later generated migration would silently `DROP` them |

### 13.3 Are existing ledger rows protected?

- **Structurally.** `ledger_entries` has `UNIQUE (voucher_line_id)`, FK `RESTRICT` to
  documents, lines and accounts, and **no update or delete repository method and no route**
  (AC-I-05/06). Reversal creates a new counter-document (Task 15); only `reversal` is
  implemented.
- **Could a migration rewrite accounting history?** Only if someone wrote one that does.
  The module's own invariants (I-3, ADR-0035 §4) forbid it, and no current migration touches
  `ledger_entries` after the initial backfill. **The risk is future, not present.**
- **Historical rows store no code**, so even a code-shape change cannot orphan them.

### 13.4 Constraints, FKs, indexes — sufficiency for a future chart slice

| Concern | Assessment |
|---|---|
| Organization boundaries encoded | Yes for ownership (`organization_id` NOT NULL + FK RESTRICT on every table). **No** for *authorization* (S-1) |
| Unique constraints sufficient | Yes for identity (`code` per org, one ACTIVE version per org via locked transaction + optional partial index, projection key, posting-operation key). **Not** for tree invariants (S-7) — by design |
| Foreign keys appropriate | Yes. All `RESTRICT` except `accounting_document_lines → document` (CASCADE, correct: a pre-final discard removes the aggregate's parts) and the version-level `DELETE` for a DRAFT configuration workspace |
| Indexes for a future chart slice | `idx_accounts_organization_id_parent_id` (children/tree walk), `…_level`, `…_is_active`, `idx_accounts_coding_structure_version_id`, `idx_accounts_accounting_configuration_id`, `uq_accounts_organization_id_code` — adequate for the current write and list paths. **Gaps:** no composite index leading with `(organization_id, is_active, parent_id)`; no index supporting a code-history as-at lookup (no table); a tree-walk at scale relies on a recursive CTE over `parent_id` and **no `path` projection exists** (§8.2 permits one as a rebuildable projection — a decision, not a defect) |
| **Dual-pin integrity** | **No constraint or validation guarantees the two pins describe the same shape** (§3.3). A future slice that touches coding levels must decide this first — OQ-62 |

---

## 14. Testing Gap Analysis

Executed-test claims are **not** made here; this section inventories what the repository
*contains*, and marks invariants without sufficient evidence.

| Invariant / behaviour | Existing evidence | Verdict |
|---|---|---|
| Code immutability (no update field; PATCH cannot change it) | `coding-structure-accounts.spec.ts` "edits title and nature, and has no way to change the code"; `account-structure.e2e-spec.ts` "renames accounts and toggles lifecycle, but never edits a code" | COVERED |
| `postable ⇒ leaf` (both write paths) | `account-placement.spec.ts` (4 cases) + `coding-structure-accounts.spec.ts` + live "serialises a postability flip against the first child create" | COVERED (incl. concurrency) |
| Level derivation / depth | `account-placement.spec.ts` "level is derived, never supplied" (4 cases) | COVERED |
| Code ⇄ hierarchy consistency | `account-code.spec.ts`; `account-placement.spec.ts` "code ⇄ hierarchy consistency (§9.3)"; e2e "refuses a re-parent that breaks the code-prefix proof" | COVERED |
| Cycle prevention | `account-placement.spec.ts` (4 cases, incl. corrupt-data termination); live "leaves an acyclic graph after concurrent cycle-forming re-parentings" | COVERED |
| Cross-organization parent/account ⇒ 404 | `coding-structure-accounts.spec.ts` "reports a missing or foreign parent as 404"; e2e "answers 404 (never 403) for every foreign-organization id" | COVERED |
| Organization scoping of reads/writes | `coding-structure-accounts.spec.ts` "scopes every account read and write by organization"; live suite | COVERED for **structural** scoping. **TEST GAP** for principal→organization authorization (nothing to test — S-1) |
| Permission enforcement + denial paths | `accounting-authorization.spec.ts`; `coding-structure-accounts.spec.ts` "enforces one permission per operation (the service check, not the route)"; e2e "lets a read-only principal read but not write the chart" + "rejects anonymous calls … 401 (not 403)" | COVERED |
| Immutability after use (AC-I-11) | `account-placement.spec.ts` "AC-I-11 immutability after use" (5 cases); `coding-structure-accounts.spec.ts` "keeps structural edits available while no document line exists (the AC-I-11 seam)" | PARTIAL — the **domain** decision table is fully tested; an end-to-end test that a real finalized voucher freezes `parentId`/`nature`/`isPostable` through `PATCH` was **not found**. **TEST GAP** |
| Deactivation (disable/enable) | e2e "renames accounts and toggles lifecycle …" (blocks new children, subtree stays readable) | COVERED |
| Deletion does not exist | e2e asserts `DELETE /accounts/:id` → 404 and `DELETE /coding-structures/:id` → 404 | COVERED (absence) |
| **Delete an unused account (Q21 first half)** | Nothing — no capability | **TEST GAP** (capability absent; needs the O-4 reference list first) |
| **Code change before use (Q3/D-2)** | Nothing — no path | **TEST GAP** (capability absent; needs O-1) |
| **Code history / as-at resolution (Q18/D-3)** | Nothing — no capability | **TEST GAP** (capability absent) |
| **Historical report renders the historical code** | Nothing — a code can never change, so no fixture can exercise it | **TEST GAP** (blocked on the capability) |
| **Control roles / mapping / mandatory-role validation** | Nothing — no capability | **TEST GAP** (capability absent; OQ-25) |
| **Dimensions / floating detail / AC-I-18** | Nothing — no capability (repository hardcodes `dimensionAssignments: []`) | **TEST GAP** (capability absent; OQ-41) |
| **Financial-area applicability of accounts** | Nothing — no capability | **TEST GAP** (capability absent; OQ-40) |
| **Non-leaf POSTING / separated own-vs-descendant measures** | Nothing — unrepresentable by design | **TEST GAP** (blocked on D-1) |
| Hierarchy roll-up without double counting | Task 18: `trial-balance.spec.ts` + the focused D5 Ledger-native reconciliation (2 passed) | COVERED (Task 18) |
| Ledger compatibility (account referenced by id, no code stored) | `ledger-entry.spec.ts`, `posting.spec.ts`, live ledger suites | COVERED |
| **Dual-pin coherence** (§3.3) | `configuration-coding-consistency.spec.ts`, `level-kind-contract.spec.ts`, `coding-structure-accounts.spec.ts` "follows a DIFFERENT published configuration without a code change" — all test the intended paths; **no test asserts what happens when the two pins disagree in shape** | **TEST GAP** (OQ-62) |

---

## 15. ADR Review

Repository ADR lifecycle ([`docs/adr/README.md`](../../adr/README.md)): ADRs are
**immutable once Accepted**; numbering is sequential and never reused; an architecture
change without an ADR must be rejected (AG-07/AR-29). **Nothing in the repository
documents a process by which an agent may promote `Proposed → Accepted`.** The consistent
precedent is that the **Owner/Reviewer** accepts an ADR (or an implementation task that
carries it), never the implementing agent:

- **ADR-0031** (Balance Projection) — still **Proposed** although Task 12 is
  ACCEPTED WITH FOLLOW-UP.
- **ADR-0032** (Period Close) — still **Proposed** although Task 14 is implemented and
  READY FOR REVIEW.
- **ADR-0033…0037** — **Proposed**; Task 17C's acceptance explicitly did **not** promote
  them ("task acceptance ≠ ADR acceptance").
- **Task 18** — implemented against an explicit Owner Decision baseline **D1–D20** with
  **no new ADR**, and accepted. This is the controlling precedent: a bounded slice may
  proceed on an explicit Owner decision set **without** an Accepted ADR, provided the slice
  needs nothing the ADR still gates.

| ADR | Status | Exact purpose (relevant to this investigation) | Does its status block implementation? | Must it become Accepted first? |
|---|---|---|---|---|
| **ADR-0033** — Account identity & code history | **Proposed** | Records I-1: `Account.id` permanent, `code` a time-scoped business identifier; defines the future code-history + as-at resolution contract (§3/§4) and the deletion-vs-deactivation rule (§7) | **Its identity half needs no promotion** — it is already the shipped behaviour. **Its code-history half (§3/§4) is an unimplemented capability** and cannot be implemented on a Proposed ADR alone without an Owner task/ADR adoption | **YES for the code-history slice** — a schema change of this kind is an architecture change (AR-29) and needs an Accepted ADR or an explicit Owner decision set |
| **ADR-0034** — POSTING XOR AGGREGATION | **Proposed** | Records I-2 and the D-1 conflict; keeps `postable ⇒ leaf` in force; requires an amendment + separated measures before any relaxation | **No** — today's behaviour is unchanged and already implemented. **Yes for any non-leaf POSTING work** | **YES for the relaxation** (an amendment superseding AC-D-19/AC-I-09 and §8.5) |
| **ADR-0035** — Code Structure Migration | **Proposed** | Defines the future controlled/licensed/audited migration service; excludes level-count migration (§8) | **No** — nothing about today's behaviour changes. **Yes for the service** (and it is unbuildable until ADR-0030/OQ-45, OQ-52/53, OQ-62/63 resolve — baseline D-7) | **YES for the service** |
| **ADR-0036** — Legal reporting architecture | **Proposed** | `Accounting Core → Legal Adapter / Legal Profile`; keeps statutory semantics out of the Core | **No** — out of scope for a chart slice. **Yes for any legal/statutory work** | **YES for legal books / profiles**; OQ-43 stays OPEN (LEGAL VALIDATION REQUIRED) |
| **ADR-0037** — Configuration boundary | **Proposed** | Q1/Q2/Q4/Q6/Q7/Q17: configurable bounded levels, hybrid model, base structure as versioned data, Vardena-standard control roles, tree + floating detail, typed capped dimensions, configurability bounded by invariants | **Yes for content** — base-structure content, the control-role list and the mandatory set are EXPERT-GATED under OQ-25 and are explicitly *not* decided by the ADR ("no role is invented here") | **Owner decision set required** for any base-structure or control-role implementation; ADR adoption desirable but the Task 18 precedent shows an explicit decision set can substitute for a bounded slice |

**Conclusion:** no ADR status blocks *today's* behaviour, and no ADR may be self-accepted
by an agent. Three of the five (0033 history, 0034 relaxation, 0035 service) gate their
respective future slices; two (0036, 0037) are boundary records. **The promotion of any
Proposed → Accepted is an Owner/Reviewer act and is recorded here as
`OWNER DECISION REQUIRED`.**

---

## 16. Open Questions

### 16.1 OQ-25 — OPEN

**Does it block the proposed Accounting Chart Foundation? YES — for every core slice.**

OQ-25 was annotated by Task 17C: the *model* is OWNER DECIDED (Q1–Q8, Q18–Q21 →
ADR-0033/0034/0035/0037, all Proposed); the **row stays OPEN** because the following
*content/implementation details* are undecided:

1. the base structure's content (codes, Persian titles, level shape);
2. the control-role list and which roles are mandatory (O-2);
3. per-level posting-eligibility policy content and the exact validation rules for a
   non-leaf POSTING node (O-3);
4. whether a pre-use code edit is added at all (D-2);
5. the code-history shape and whether a superseded code may ever be re-issued (O-1, with
   OQ-36);
6. deactivation guards on a non-zero balance and the exact blocking-reference list for
   deletion (O-4);
7. statutory report layouts (OQ-43).

Items 1–2 gate the base-structure/control-role slice; 4–5 gate the code-history slice;
6 gates the deletion slice; 3 gates the POSTING-role slice.

### 16.2 OQ-43 — OPEN

**Does it block the proposed Accounting Chart Foundation? NO — provided the slice makes no
legal claim.** OQ-43 gates legal books, statutory column sets, layouts, retention and
e-ledger formats. ADR-0036 (Proposed) fixes the *architecture*; every legal fact stays
LEGAL VALIDATION REQUIRED. A chart slice that adds no statutory semantics, no legal-book
layout and no compliance claim does not consume OQ-43. **Nothing in this investigation
makes a legal, tax, statutory or compliance claim.**

### 16.3 Neither OQ is closed by this report

### 16.4 New candidate questions (not official OQ numbers)

Assigned per the brief's instruction; no OQ id is created, because `docs/open-questions.md`
ids are issued by the repository's own process (AG-09).

| Id | Question | Why it matters | Governing |
|---|---|---|---|
| **NEW-OQ-CANDIDATE-A** | **Which pinned root defines an account's code shape?** `coding_structure_version_id` is pinned and required `active`, but `checkAccountCode` validates against `accounting_configuration_levels`. Is the coding structure now decorative, or should the configuration delegate to it — and what happens to existing accounts when the two disagree? | It determines what "code length configuration" means, what an ADR-0035 preflight must compare, and whether the chart's two pins can silently diverge. The Task 11 rehearsal already produced a diverging legacy organization. | OQ-62 (pin compatibility) + OQ-63 (legacy fallback shape); architecture decision — ADR territory (AR-29) |
| **NEW-OQ-CANDIDATE-B** | **Is a read-only chart-of-accounts tree surface an Accounting module read surface, an ADR-0009 reporting projection, or a future Reporting-platform concern?** | `accounts.controller.ts` says tree reads are reporting projections and deliberately exposes none; Task 18 built roll-up SQL instead. Without this answer, the narrowest candidate slice (§17.3) has no agreed home. | ADR-0009, `docs/reporting-strategy.md`; Owner decision |
| **NEW-OQ-CANDIDATE-C** | **Should the two versioned level roots (`coding_structure_versions` and `accounting_configurations`) be unified into one configuration root?** | Two roots, two publish lifecycles, two `level_kind` contracts and two "one ACTIVE per organization" locks is a standing source of divergence. Task 11's `configuration.md` non-goals already note that transforming `CodingStructureVersion` into configuration state is "separate ADR". | ADR-0028 territory; architecture decision |
| **NEW-OQ-CANDIDATE-D** | **Should `level_kind` have one contract?** It is a closed list in `coding_structure_levels` and free text (≤ 20 chars) in `accounting_configuration_levels`. | Reports and a future base structure would read the same concept from two surfaces with different guarantees. | Minor; folds into OQ-25 or NEW-OQ-CANDIDATE-C |

---

## 17. Proposed Next Implementation Slice

### 17.1 Principle applied

The brief requires the **smallest coherent slice**, explicitly *not* a broad ERP
chart-of-accounts implementation. The repository's own task-definition rule
([`task-index.md`](../../accounting/task-index.md) §7) requires, before any
implementation: objective, domain scope, non-goals, dependencies, blocking OQs, required
ADR/decisions, acceptance criteria, **and** a row in the §2 index. Every candidate below
is measured against that rule.

### 17.2 What the chart already does correctly (do not rebuild)

Create/place/validate, code immutability, version pinning, `postable ⇒ leaf`, cycle and
orphan prevention, freeze-after-use, deactivate/activate, organization scoping, granular
permissions, and (via Task 18) hierarchy roll-up without double counting. **None of this
should be re-implemented.**

### 17.3 The candidate slice (smallest coherent, evidence-backed)

> **Task 19 (candidate) — Accounting Chart of Accounts: Bounded Tree Read Surface and
> Coding-Pin Coherence Guard**
>
> Two parts, both additive and non-semantic: a **read-only** tree surface over data that
> already exists, and a **coherence guard/reconciliation** for the dual pin (§3.3) that
> reports divergence instead of silently allowing it.

#### CORE (what must exist for the chart to function correctly)

1. **A read-only chart tree/read surface** — one organization, one request, returning the
   account nodes with `id`, `code`, `title`, `parentId`, `level`, `accountNature`,
   `isPostable` (rendered with the POSTING/AGGREGATION vocabulary of ADR-0034 §1),
   `isActive`, and the pins. Bounded pagination; deterministic ordering; inactive nodes
   included with their state visible. **No new columns, no new table, no mutation.**
2. **A coding-pin coherence check** — a pure domain function plus an explicit,
   permission-gated reconciliation read that reports, per account, whether
   `coding_structure_version_id` and `accounting_configuration_id` agree on level count and
   per-level digit lengths, and whether the stored code still satisfies the pinned
   configuration's shape. **Report-only.** Whether divergence is *refused* on write is
   exactly what NEW-OQ-CANDIDATE-A asks; a guard that only reports is safe to ship, a guard
   that refuses is not.
3. **Tests** — the tree surface (scope, permission denial, 404 for foreign ids, ordering,
   pagination), the coherence function (agreeing pins, divergent pins, legacy rows), and the
   denial paths (AG-06/AG-13).

#### PLATFORM / CONFIGURATION

- Nothing new. Both existing configuration roots stay exactly as they are; the slice reads
  them and does not unify them.

#### SECURITY

- One new granular read code (e.g. `Accounting.ChartOfAccounts.View`) **or** reuse of
  `Accounting.Account.View` — **this is an Owner decision** (the §22 vocabulary has no
  chart row, and `accounting-permissions.ts` registers only enforced codes).
- Mandatory organization scope; foreign ids answer 404.
- **No change to the organization-authorization model** — S-1 stays open and is *not*
  papered over by this slice.

#### MIGRATION

- **None.** Both parts are read-only over existing tables. ADR-0035's migration service,
  level-count migration and any code-history migration stay deferred.

#### LEGAL

- **Nothing.** No statutory layout, no legal book, no compliance claim. ADR-0036 /
  OQ-43 are untouched.

#### REPORTING

- **Already consumed, must not be duplicated:** Task 17A (ledger movements), Task 17B
  (account statement), Task 18 (general ledger, trial balance, hierarchy roll-up via
  `AccountingReadQueryRepository`). The tree surface must **reuse** the Task 18 read
  repository's scoping/narrowing conventions and must **not** recompute balances,
  turnovers or trial-balance figures, and must **not** become a second financial
  calculation engine (Q15/Q16, `reporting-strategy.md` §1/§5).

#### Conditions this slice still requires before implementation

1. **NEW-OQ-CANDIDATE-B answered** (which module/layer owns a chart tree read).
2. **NEW-OQ-CANDIDATE-A scoped** (the coherence guard reports; refusal policy deferred).
3. **An explicit Owner decision set** for the slice (the Task 18 D1–D20 precedent) or
   adoption of the relevant ADR — not agent self-authorization.
4. **A row in `task-index.md` §2** and the §7 checklist completed.
5. **An ADR** if the Owner chooses to resolve the dual-pin question architecturally
   (AR-29/AG-07) rather than deferring it.

Items 1–5 do not exist today. Hence the gate in §20.

### 17.4 Larger slices considered and rejected for this next step

| Candidate | Why not the next slice |
|---|---|
| Base/template chart of accounts (Q2) | Content is EXPERT-GATED (OQ-25, D-5). Shipping invented codes/titles would violate AG-09/AR-31 |
| Control roles + mappings (Q4) | Role list and mandatory set are OQ-25 (O-2); **no consuming operation exists**, so by the Owner's own demand-driven rule nothing is mandatory yet |
| Account code history (Q18/I-1) | Additive schema + migration; blocked on the O-1 reuse answer, the validity-axis decision and ADR-0033 adoption. Larger than "smallest coherent" |
| Account deletion of unused accounts (Q21) | Blocked on the O-4 blocking-reference list, O-1 code reuse and a permission decision |
| Non-leaf POSTING / stored role attribute (Q5) | Blocked by D-1: needs an ADR amendment superseding AC-D-19/AC-I-09, §8.5 amended, and separated own-vs-descendant measures |
| Dimensions / floating detail (Q6/Q7) | Blocked by OQ-41; an EAV/JSONB engine is forbidden |
| `account_type` / `is_temporary` / classification | EXPERT-GATED (OQ-25); no consuming report exists; AR-29 forbids speculative columns |
| Area applicability of accounts | Blocked by OQ-40 (and entangled with the per-area-chart variant) |

---

## 18. Explicit Out-of-Scope List

The following must **not** enter the next task, in addition to the brief's §22 list
(legal books, journal book, XLSX/CSV export, PDF/print, report builder, treasury reports,
AR/AP, sales, purchase, settlement/allocation, currency engine, code-migration service,
level-count migration, semantic merge/split, workflow/rules engine, EAV/JSONB engine, UI,
frontend, microservices, Redis, unrelated refactors):

1. Any change to `accounts.code` semantics — no pre-use code edit, no code reuse, no
   code-history table, no `uq_accounts_organization_id_code` re-scoping.
2. Any relaxation of `postable ⇒ leaf` or any non-leaf POSTING configuration (D-1).
3. Any base/template chart, seed script, or default account rows.
4. Any control-role enum, column, mapping table or "mandatory role" validation.
5. Any `account_type` / `is_temporary` / statement-classification column or logic.
6. Any dimension model, floating-detail table, line-assignment table or JSONB/EAV
   configuration surface.
7. Any account deletion path or `Accounting.Account.Delete` permission.
8. Any change to the deactivation guard (non-zero balance / open-year activity).
9. Any legal, statutory, tax, e-ledger, filing or retention behaviour or claim.
10. Any new monetary source of truth, currency column, or unit/scale configuration
    (OQ-03).
11. Any change to the Task 12 projection, the Task 13 freeze marker, the Task 14 close
    gate, or the lock order (`lock-order-matrix.md`).
12. Any new Reporting module, report registry, report builder or `/api/v1/reports`
    surface.
13. Any change to financial-area semantics, per-area charts or user↔area grants (OQ-40).
14. Any new principal→organization authorization system (OQ-01/OQ-22) — the next slice
    must not invent a tenancy model incidentally.
15. Any production refactor of `AccountsService`/`AccountsRepository` beyond what the
    bounded slice strictly requires (AG-03).
16. Any dependency addition (AG-11).
17. Any UI/frontend work.
18. Any migration (AR-08/AR-10) — the candidate slice needs none.

---

## 19. Dependencies

| Dependency | Classification | Evidence / note |
|---|---|---|
| **Organization** | **HARD** | `organization_id` NOT NULL + FK RESTRICT; `requireUsableOrganization` gates every write; `assertOrganizationInScope` enforces the ADR-0025 pin |
| **Identity (session/principal)** | **HARD** | `AuthGuard` + `getPrincipal()` for `createdBy`/`updatedBy` and for every permission check |
| **RBAC** | **HARD** | `AuthorizationGuard` + `AuthorizationService.requireAllPermissions`; codes mirrored into `rbac.permissions` at startup (ADR-0006/0016) |
| **Financial Area** | **REFERENCE ONLY** for the chart, **HARD** for the books | Accounts carry no `financial_area_id`; areas scope documents/periods/years/ledger/projection. A chart read needs organization scope only, unless area applicability is later decided |
| **Fiscal Year** | **REFERENCE ONLY** | Not referenced by `accounts`. Needed only by the reporting surfaces that consume the chart |
| **Accounting Period** | **REFERENCE ONLY** | Same as above |
| **Voucher / Accounting Documents** | **HARD** (indirect, read-only) | The `countReferencingLinesInTx` predicate makes document lines the "usage" evidence for AC-I-11; finalization locks accounts `FOR SHARE` and enforces AC-I-09 |
| **LedgerEntry** | **REFERENCE ONLY** | No code is stored; identity is `account_id`. The slice must not aggregate ledger rows (that is Task 18's job) |
| **Documents (Documents Foundation)** | **NOT REQUIRED** for the chart | Accounting documents are module-owned (`accounting_documents`), not the shared Documents module |
| **Workflow** | **NOT REQUIRED** | No approval path exists for chart operations |
| **Inventory** | **NOT REQUIRED** | No Inventory → Accounting posting exists (contract §20.4 gate) |
| **Reporting Read Foundation (Task 18)** | **SOFT** | The tree surface must follow its scoping/narrowing conventions and must not duplicate its calculations. It does not depend on Task 18's code at runtime unless the Owner places the surface there (NEW-OQ-CANDIDATE-B) |
| **Task 12 projection / Task 13 marker / Task 14 gate** | **NOT REQUIRED** (but must not be disturbed) | The slice reads `accounts` only |
| **Audit module** | **NOT REQUIRED** (does not exist) | S-5 stays open |
| **License foundation (ADR-0030)** | **NOT REQUIRED** for this slice; **HARD** for the future migration service | No `license` schema/module exists |

---

## 20. Implementation Gate

Three candidate verdicts were tested against repository evidence.

**Is the repository foundation complete enough to start?**
Mostly yes for the *existing* foundation: the account model, hierarchy, POSTING/AGGREGATION
invariant, immutability, lifecycle and permissions are implemented, internally coherent and
tested. Two coherence caveats exist (dual pin, §3.3; and the absence of any chart tree
read) but neither makes the codebase unsafe to extend with a bounded read-only slice. So
`BLOCKED — REPOSITORY FOUNDATION INCOMPLETE` is **not** the right verdict.

**Are all required owner decisions present?** No:

1. **OQ-25 remains OPEN** and gates the content of every *core* chart capability
   (base structure, control roles, code-history shape, deletion guards, posting policy).
2. **Task 19 does not exist as a task.** [`task-index.md`](../../accounting/task-index.md)
   §7 makes an explicit index row plus objective/scope/non-goals/dependencies/OQs/ADRs/
   acceptance criteria a precondition of implementation. None exists. The Task 18
   precedent shows this is satisfiable — but only by the Owner.
3. **NEW-OQ-CANDIDATE-A** (which pin defines code shape) is unresolved and is a
   foundation-level question the preserved Q1–Q22 set does not answer.
4. **NEW-OQ-CANDIDATE-B** (which layer owns a chart tree read) is unresolved; the
   repository's own controller says "not this module's API".
5. **ADR-0033/0034/0035/0036/0037 are Proposed**, and repository convention (plus each
   ADR's "no self-acceptance" note) makes promotion an Owner/Reviewer act. Adoption is
   required for the code-history slice and for any POSTING-role relaxation.

Therefore:

## BLOCKED — OWNER DECISION REQUIRED

The block is **on decisions, not on code quality**. The narrowest slice that could proceed
without OQ-25 content is described in §17.3, and even it requires NEW-OQ-CANDIDATE-A/B to
be answered and a Task 19 row to be added to the task index under §7.

---

## 21. Owner Decisions Required

Recorded in the order a decider would need them.

| # | Decision required | Unblocks | Governing |
|---|---|---|---|
| **ODR-1** | **Authorize a Task 19 slice at all**, with its objective, domain scope, non-goals, dependencies, blocking OQs, acceptance criteria and a row in `task-index.md` §2 (§7 checklist) | Everything | Owner |
| **ODR-2** | **Which layer owns a chart-of-accounts tree read** — Accounting read surface, ADR-0009 reporting projection, or the future Reporting module (NEW-OQ-CANDIDATE-B) | The §17.3 tree surface | Owner + architecture |
| **ODR-3** | **Which pinned root defines an account's code shape**, and what happens when the two pins disagree (NEW-OQ-CANDIDATE-A) | The coherence guard; any future coding-structure work; ADR-0035 preflight | Owner + architecture (OQ-62/OQ-63; likely an ADR) |
| **ODR-4** | **OQ-25 content decisions** — the base structure's content (codes, Persian titles, level shape), the control-role list, and which roles are mandatory once a consuming operation exists | Base structure + control roles | Accountant / Owner (OQ-25, O-2) |
| **ODR-5** | **Code-history shape** — old code, new code, the validity axis, and **whether a superseded code may ever be re-issued** (O-1, OQ-36) | ADR-0033 §3 implementation | Accountant / Owner (OQ-25) |
| **ODR-6** | **Deletion policy** — the exact blocking-reference list, a granular permission, and whether the code may be reused after deletion (O-4, O-1) | Q21's first half | Owner + accountant (OQ-25) |
| **ODR-7** | **ADR adoption** — whether ADR-0033 (and, if a role attribute is wanted, ADR-0034) is Accepted, or whether a Task-18-style explicit decision set substitutes for the exact slice | The code-history slice; any POSTING-role work | Owner/Reviewer (no agent self-acceptance) |
| **ODR-8** | **Deactivation guard** — refuse deactivation while a balance is non-zero or activity exists in an open year? (O-4) | Completing the deactivation half of Q21 | Accountant (OQ-25) |
| **ODR-9** | **Organization authorization** — does a principal→organization binding (OQ-01/OQ-22) land before or after the chart slice? S-1 is a HIGH tenant-isolation finding that no chart slice should paper over | Tenant isolation | Product + security |
| **ODR-10** | **Per-level posting policy content** and, only if wanted, whether the D-1 relaxation proceeds (which needs an ADR amendment + separated measures) | Any POSTING-level configuration | Accountant + architecture (OQ-25, D-1) |

Not required for a chart slice: any OQ-43 legal decision (but no legal claim may be made),
and any currency/licensing decision (those gate the migration service, not the chart).

---

## 22. Final Recommendation

1. **Do not start a broad "Chart of Accounts" implementation.** The repository's own
   foundation is sound where it exists; the missing parts are *content decisions*, not code.
2. **Record, do not invent.** Every gap above is already registered as a discrepancy
   (D-1…D-13) or an open item (O-1…O-12) in
   [`owner-decision-baseline.md`](../../accounting/owner-decision-baseline.md); this report
   adds two candidate questions (A/B) and two minor ones (C/D) and invents no policy.
3. **Ask the Owner for ODR-1…ODR-3 first.** They are the smallest set that could authorize
   a coherent, non-speculative slice (§17.3). ODR-4…ODR-8 are needed for the larger,
   more valuable slices and can be taken in the same decision round.
4. **Keep the accepted reporting surface authoritative.** Any chart read must consume the
   conventions of Task 18 and must never become a second financial calculation engine.
5. **Do not close OQ-25 or OQ-43, do not promote an ADR, and do not create a migration** on
   the strength of this report.

---

## Appendix A — Verification performed (documentation-only)

| Check | Method | Result |
|---|---|---|
| No production change | `git status --short`, `git diff --stat`, `git diff` on the branch | Only this file added (see the final agent report for the exact diff) |
| Documentation-only path audit | No `backend/`, `*.ts`, `*.prisma`, `*.sql`, `package*.json`, `.github/`, `docker-compose.yml`, `.env.example` or `frontend/` path touched | PASS |
| Markdown structure | 22 numbered sections present, in the required order; table column counts consistent per table | PASS |
| Relative links | Every relative link resolves against the repository tree (`docs/tasks/task-19/` → `../../accounting/*`, `../../adr/*`, `../task-17/*`, `../task-18/*`, `../../../backend/*`, `../../../STATE.md`, `../../../.vardena/agent-rules.md`) | PASS |
| Referenced ids exist | AC-D-/AC-I- ids against `domain-contract.md` §25/§26; OQ ids against `docs/open-questions.md`; ADR ids against `docs/adr/`; AR-/AG- ids against `.vardena/*` | PASS |
| Whitespace | `git diff --check` reported clean | PASS |
| Test execution | **No tests were executed by this investigation** — none were needed for a documentation-only change, and no test claim is made | N/A (not claimed) |
| Statuses unchanged | No task status, ADR status or OQ status was edited anywhere in the repository | PASS |
