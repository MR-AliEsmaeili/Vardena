# OD-29-05 — Statement Classification Decision Pack

**Date:** 2026-09-28
**Decision ID:** OD-29-05 — Statement Classification
**Status:** **`DECIDED — OPTION C`** — Owner selected Organization-configurable Statement Classification.
**Initial decision-pack baseline:** `f15ce98e095c3c2bfb1f2e0b6ebbe7082da776aa` (merge of PR #77, Task 29 Owner Decision Closure).
**Owner-decision follow-up baseline:** `280e07e2cbf3f031a4ec178341e5c617576d1189` (`origin/main` at the start of this follow-up).
**Nature of this document:** documentation-only Owner Decision record and preserved option analysis. Zero production code, Prisma schema, migration, seed, API, permission, guard, Posting, reporting, or UI change. It records the Owner's final OD-29-05 choice and explicitly does not authorize implementation.

---

## 1. Repository Baseline (Verified Context — Nothing Re-decided Here)

All statuses below preserve the audited repository context. This follow-up changes only OD-29-05 from `PENDING OWNER DECISION` to `DECIDED — OPTION C`; all other prior Owner Decisions and task statuses are preserved without reinterpretation.

| Item | Recorded status at baseline | Evidence |
|---|---|---|
| Task 27 — Main Governance Reconciliation & MVP Gate | READY FOR REVIEW — NOT ACCEPTED; governance/documentation only | `STATE.md` §7 row 27; `docs/tasks/task-27/*` |
| Task 28 — Owner Decision Closure & MVP Implementation Selection Gate | READY FOR REVIEW — NOT ACCEPTED; governance/selection gate only | `STATE.md` §7 row 28; `docs/tasks/task-28/*` |
| OD-27-02 — Base Chart MVP Scope Boundary | **DECIDED**: MVP requires the Base Chart *mechanism*, not a concrete content set | `docs/tasks/task-28/owner-decision-record.md` (Decision 1); `docs/tasks/task-29/owner-decision-pack.md` §2 |
| Task 29 — VARDENA Base Chart Reconciliation & Accounting Domain Decision Gate | READY FOR REVIEW — NOT ACCEPTED; governance & domain reconciliation gate only | `STATE.md` §8; `docs/tasks/task-29/*` |
| OD-29-01 — Account Nature | **DECIDED**: exactly `DEBIT`, `CREDIT`, `DUAL`; `DUAL` independent; Nature is orientation, not a posting prohibition | `docs/tasks/task-29/owner-decision-closure.md` |
| OD-29-02 — Account Type | **DECIDED**: exactly `BALANCE_SHEET`, `INCOME_STATEMENT`, `MEMORANDUM`; independent of Nature; immutable after first Posting | `docs/tasks/task-29/owner-decision-closure.md` |
| OD-29-03 — Detail Requirement / Detail Hierarchy | **DECIDED**: first-class organization-configurable Detail hierarchy; first-level Account relationship; controlled destructive removal | `docs/tasks/task-29/owner-decision-closure.md` |
| OD-29-04 — English Account Title | **DECIDED**: not required for MVP; absence blocks nothing | `docs/tasks/task-29/owner-decision-closure.md` |
| OD-29-05 — Statement Classification | **`DECIDED — OPTION C`** — Organization-configurable Statement Classification | `docs/tasks/task-29/owner-decision-closure.md` §"OD-29-05 — Statement Classification" |
| OD-29-06 — System Account | **DECIDED**: MVP has no System Account concept, `isSystem`, or equivalent flags | `docs/tasks/task-29/owner-decision-closure.md` |
| OQ-25 — Chart of accounts content/roles/statutory layouts | **OPEN** (substantially narrowed; concrete content, mandatory-account and control-role catalog, statutory layouts remain unresolved) | `docs/open-questions.md` OQ-25 row |
| OQ-41 — Detail dimensions | **OPEN** (narrowed by OD-29-03; physical persistence/authorization/implementation unresolved) | `docs/open-questions.md` OQ-41 row |
| OQ-43 — Iranian statutory requirements | **OPEN**; architecture Owner-decided (Legal Profile, ADR-0036 Proposed), legal facts not validated | `docs/open-questions.md` OQ-43 row |
| Task 30 / any implementation task | **NOT AUTHORIZED** | `docs/tasks/task-29/owner-decision-closure.md` §"Implementation Authorization Boundary" |
| 264-account VARDENA Base Chart artifact | **NOT approved for production loading** | `docs/tasks/task-29/implementation-readiness.md` |

**Relevant current architecture (verified static inspection, unchanged by this pack):**

- **Account domain:** `backend/prisma/schema/accounting.prisma` `Account` carries `code`, `title`, `parentId`, `level`, `codingStructureVersionId`, `accountingConfigurationId`, `accountNature` (two-value runtime — the decided `DUAL` remains a recorded implementation gap), `isPostable`, `isActive`. No type, no classification.
- **Coding Structure:** organization-configurable levels/digit lengths (`CodingStructureVersion`/`CodingStructureLevel`; `MAX_CODING_STRUCTURE_DEPTH = 8`, `MAX_ACCOUNT_CODE_LENGTH = 32`, `backend/src/modules/accounting/domain/coding-structure.ts`). It defines *code shape*, not statement presentation.
- **Base Chart mechanism:** `BaseChartTemplate`/`...Version`/`...Level`/`...Node`/`BaseChartAdoption`; nodes carry `code`, `title`, `accountNature`, `isPostable`, `isMandatory`, `defaultIsActive` — no classification field. Adoption is copy-not-reference (Task 21 / Task 23).
- **Reporting-related architecture:** bounded Accounting-owned read surfaces only — `account-statements`, `general-ledger`, `trial-balance` (Task 18), `chart-tree` (Task 19 ODR-2), `ledger-movements` (Task 17A) — all Ledger-native over `accounting.ledger_entries`, all explicitly documented as exposing **no** account classification. ADR-0009 (module views + scoped raw SQL) and ADR-0036 (Legal Profile, Proposed) frame future reporting/statutory work. There is no Report Builder, no statement layout engine, no financial-statement generator.

---

## 2. Problem Definition — What OD-29-05 Answered

The owner-provided VARDENA artifact and standard financial reporting practice raised one remaining domain question, now answered by OD-29-05:

> **When Vardena eventually renders formal financial statements (ترازنامه / صورت سود و زیان and their presentation lines), where does the knowledge "account X appears under presentation line Y" live — and is it a first-class, independent concept at all?**

### 2.1 What is already decided and MUST NOT be reopened

**Account Type** (OD-29-02, `DECIDED`) is exactly:

```text
BALANCE_SHEET
INCOME_STATEMENT
MEMORANDUM
```

Account Type is a fixed, global, three-value concept. It governs the account's *closing/carry-forward/period-transition lifecycle* (which statement family the account's lifecycle belongs to), is independent of Account Nature, and is immutable after the account's first Posting.

**Account Nature** (OD-29-01, `DECIDED`) is exactly:

```text
DEBIT
CREDIT
DUAL
```

Account Nature is the natural balance orientation. `DUAL` is independent and must never be collapsed into `DEBIT` or `CREDIT`. Nature is not an absolute prohibition on opposite-side posting.

Both decisions stand as recorded in `owner-decision-closure.md`. **This pack does not modify, reinterpret, or extend them.** OD-29-05 must not add a fourth Account Type, must not merge Statement Classification into Account Type, and must not turn Nature into a presentation concept.

### 2.2 What Statement Classification is (and is not)

Statement Classification is the *presentation/grouping axis* of formal financial statements: e.g. distinguishing a current asset from a non-current asset, or an operating expense from a finance cost. Two accounts can share `AccountType = BALANCE_SHEET` and `AccountNature = DEBIT` and still belong to entirely different statement lines.

Account Type answers "*which statement lifecycle does this account live in?*" (3 fixed values). Statement Classification answers, at the domain-direction level, "*under which presentation line inside that statement does this account appear?*" (a finer, presentation-oriented grouping). OD-29-05 decides that this finer grouping exists as an independent, Organization-configurable concept; concrete taxonomy, modeling details, and runtime behavior remain future design work.

### 2.3 Strict concept separation (do not conflate)

```text
Account Type
≠
Account Nature
≠
Statement Classification
≠
Account Hierarchy
```

| Concept | Governs | Owner / scope | Decision status |
|---|---|---|---|
| **Account Type** | Closing, opening, carry-forward, period transition; statement *family* lifecycle | Fixed global 3-value enum | `DECIDED` (OD-29-02) — untouched here |
| **Account Nature** | Natural balance orientation; contrary-balance interpretation | Fixed global 3-value enum | `DECIDED` (OD-29-01) — untouched here |
| **Statement Classification** | Presentation line / grouping inside formal financial statements | Organization-configurable domain concept | `DECIDED — OPTION C` (OD-29-05) |
| **Account Hierarchy** | Organization's coding tree (parent/child, roll-up axis for the existing read reports) | Organization-owned, shaped by Coding Structure | Implemented (Tasks 10–19); not a decision subject here |
| **Detail / Dimension** | Analytical sub-ledger axis on posting lines (تفصیلی) | Organization-configurable (OD-29-03; physical model open under OQ-41) | `DECIDED` at domain level — untouched here |
| **System Account** | (Excluded) system-owned account flags | — | `DECIDED` excluded from MVP (OD-29-06) — untouched here |
| **Base Chart Coding Structure** | Digit shape/levels of template and org codes | Product-owned template + org configuration | Implemented mechanism (OD-27-02, Task 23) — untouched here |

Statement Classification is **none** of the other six concepts. Any future implementation that stores it as a hidden overload of `Account.code` ranges, hierarchy depth, Nature, Type, Detail, System Account, or a Base Chart level name would violate this separation.

---

## 3. Options Analysis

Three candidate answers were analyzed before the Owner selected Option C. The analysis is preserved here as decision context; only the explicit OD-29-05 decision text in §7 is authoritative.

### Option A — No Separate Statement Classification

No independent Statement Classification concept is ever modeled. Financial-statement presentation is derived entirely from the Account Hierarchy (e.g. "statement line = the Level-1/Level-2 ancestor") and/or per-report logic in the future reporting layer.

**Pros**

- Zero new domain concepts, tables, fields, or lifecycle rules; smallest possible model.
- Matches the current implementation exactly: today's read reports (trial balance, general ledger, account statement, chart tree) already aggregate strictly by hierarchy and expose no classification.
- No Base Chart impact, no migration, no versioning question, nothing to administer.
- No risk of inventing statutory taxonomy prematurely (respects OQ-43's "no legal requirement is hardcoded" posture).

**Cons**

- Couples *presentation* to *coding*: an organization's statement layout becomes hostage to how it cut its code tree. Reorganizing a statement line would require restructuring account codes — but codes are immutable after accounting use (contract §8/§9, OD-20-4), so presentation mistakes become effectively permanent.
- One account subtree can legitimately span presentation lines (e.g. a receivables parent containing both current and non-current children); pure ancestor-derivation cannot express that without distorting the chart.
- Pushes the classification knowledge into per-report code — exactly the hard-coded-report-logic pattern the Legal Profile architecture (ADR-0036) was designed to avoid.
- Multi-organization consequence: every organization must *encode* its presentation intent into its chart shape; organizations adopting the same Base Chart template but wanting different statement layouts have no lever other than diverging their charts.
- A later reversal (adding classification after years of postings) is safe *data-wise* (additive mapping) but expensive *content-wise*: every organization must back-classify its whole chart at once.

### Option B — Fixed Built-in Classification

Vardena ships one product-owned, hard-coded Statement Classification taxonomy that every organization uses. Conceptually of the flavor *Current Assets / Non-current Assets / Current Liabilities / Non-current Liabilities / Equity / Operating Revenue / Non-operating Revenue / Operating Expense / Non-operating Expense / …* — **listed here strictly as an illustration of the option's shape; these examples are NOT a proposed, approved, or official Vardena taxonomy and must not be transcribed anywhere as content.**

**Pros**

- Uniformity: every organization's statements aggregate identically; cross-organization comparison and product-level report templates are trivial.
- Simple for account creation UX: pick one value from a closed list.
- No per-organization administration burden; no configuration UI needed.
- Reporting engine can be written once against a known, closed value set.

**Cons**

- **Limitation for different organizations:** manufacturing, service, non-profit, and holding entities present statements differently; one fixed list either bloats (union of everyone's needs) or starves (someone's line is missing). There is no escape hatch short of a product release.
- **Effect on reporting:** rigid — any new presentation line is a code change, deployment, and (if the enum is persisted) a migration, not data entry. This contradicts the repository's established preference for configuration over hard-coding (Coding Structure, Detail hierarchy, accounting configuration are all organization-configurable by decided design).
- **Effect on Base Chart:** the template mechanism would need to carry a fixed-taxonomy value per node, entangling the deliberately content-free Base Chart mechanism (OD-27-02) with product-owned semantic content; publishing/adoption invariants would grow a new coupled axis.
- **Effect on future Localization / statutory reporting:** the highest-risk aspect. OQ-43 records that **no legal requirement is hardcoded** and ADR-0036 (Proposed) places jurisdiction-specific layouts in versioned Legal Profiles *outside* the Accounting Core. A fixed built-in classification is, in substance, a hard-coded statutory presentation assumption inside Core — it would pre-commit Vardena to one jurisdiction's statement shape before any accountant/legal validation, and future jurisdictions or Iranian layout revisions would force enum surgery on live data.
- **Migration risk:** changing a fixed taxonomy later means data migration across every organization simultaneously; the blast radius is product-wide by construction.

### Option C — Organization-configurable Statement Classification

Statement Classification becomes an independent, organization-scoped concept: each organization defines the classification entries it needs for reporting presentation. The product ships the *mechanism*, not the *taxonomy* — the same mechanism-vs-content split already decided for the Base Chart (OD-27-02), Coding Structure, and Detail hierarchy (OD-29-03). Exact hierarchy, level count, effective dating/versioning, assignment/mapping cardinality, and unclassified-account behavior remain future decisions.

**Pros**

- Full separation of concerns: presentation is decoupled from Type (lifecycle), Nature (orientation), hierarchy (coding), and Detail (analytics).
- Multi-organization: each organization models its own statement lines; different industries and jurisdictions coexist without product releases.
- Consistent with every prior Vardena configurability decision — this is the pattern the repository already follows.
- Keeps Core statutory-neutral: a future Iran Legal Profile (ADR-0036) can consume or constrain organization classifications without Core ever hard-coding a layout.
- Additive and deferrable: nothing in the MVP depends on it; the concept can be introduced post-MVP without disturbing decided models.

**Cons / costs**

- More moving parts than A or B: a classification entity, an account-to-classification assignment, validation, permissions, and administration UI eventually needed.
- Organizations must do classification work themselves (or start from an optional product-provided starter set — which would be a *content* artifact requiring its own approval, like the Base Chart content).
- Unclassified accounts need a defined reporting behavior (fail, "unclassified" bucket, or hierarchy fallback) — a future design question.
- Cross-organization comparability is not automatic (mitigable later via optional shared templates, not required now).

**Impact review (as required):**

- **Reporting:** future financial statements group by organization-defined classifications; the existing Task 18 read reports are untouched (they remain hierarchy/ledger-native). Consistent with ADR-0009's read-model approach.
- **Base Chart:** cleanest form keeps classification *out* of the template entirely (templates stay classification-free; organizations classify after adoption). Whether templates may ever carry *suggested* classifications is a separate future decision — not part of OD-29-05.
- **Migration:** expected to be additive in architectural shape; exact database model, relationship placement, migration strategy, and backfill policy are **not** decided here. No rewrite of ledger facts is implied by the decision.
- **Versioning:** classification definitions are organization data; whether they need effective-dating/versioning (statements re-rendered for prior years) is a real future design question, analogous to the already-decided effective-dated control-role mapping (OD-20-3). Not decided here.
- **Account lifecycle:** presentation regrouping is a likely future design concern, but exact mutability, audit rules, mapping cardinality, and historical-report behavior are future decisions.
- **Future financial statements:** provides the missing grouping axis for ترازنامه / صورت سود و زیان lines without inventing their content today; statutory column sets/layouts remain Legal Profile territory (OQ-43 unchanged).

---

## 4. Fit/Gap Against the Current Architecture

Every row below is a static-inspection fact at the audited baseline. Where a capability does not exist, it is stated as `NOT IMPLEMENTED` — nothing is invented. OD-29-05 decides direction only; these implementation gaps remain.

| Question | Finding | Evidence |
|---|---|---|
| Does `Account` carry any Statement Classification concept? | **NOT IMPLEMENTED.** Fields are identity, code, title, parent/level, structure/configuration references, `accountNature`, `isPostable`, `isActive`, audit stamps. No type field (itself a recorded OD-29-02 gap), no classification field. | `backend/prisma/schema/accounting.prisma` `model Account` |
| Does any Prisma model represent a Statement Classification? | **NOT IMPLEMENTED.** No `StatementClass`/`StatementClassification` (or equivalent) model exists in any schema file. | `backend/prisma/schema/*.prisma` (searched) |
| Does the Reporting Foundation have such a concept? | **NOT IMPLEMENTED.** The Task 17A/18/19 read surfaces explicitly and deliberately expose *no* classification: chart tree ("no invented `account_type`/classification"), trial balance ("No account classification or financial-statement columns are inferred"), account statement (D3 excludes nature/classification presentation), ledger movements ("no statement classification"). | `backend/src/modules/accounting/api/dto/chart-tree.dto.ts`, `api/trial-balance.controller.ts`, `domain/account-statement.ts`, `domain/ledger-movement.ts` |
| Does the Base Chart mechanism create a dependency on it? | **No.** `BaseChartTemplateNode` carries `code`, `title`, `accountNature`, `isPostable`, `isMandatory`, `defaultIsActive` only; publish/adoption invariants reference no classification. The mechanism is compatible with all three options as-is. | `backend/prisma/schema/accounting.prisma` `model BaseChartTemplateNode`; `docs/tasks/task-21/task-21-governance-baseline.md` |
| Can the Account hierarchy substitute for it? | **Partially, with structural limits.** Hierarchy roll-up is exactly what today's reports do, so Option A is *feasible*; but hierarchy is the coding axis (immutable codes after use, organization-shaped), so subtree-spanning presentation lines and post-hoc presentation regrouping cannot be expressed without chart restructuring. It is a possible *policy answer* (Option A), not an existing classification *feature*. | `AccountingReadQueryRepository` roll-up semantics (Task 18); contract §8/§9 code immutability |
| Has the implementation implicitly assumed something as Statement Classification? | **No.** The codebase repeatedly documents the *absence* of classification rather than smuggling one in; `accountNature` is explicitly "reporting semantics only," and trial-balance row kinds (POSTING/AGGREGATION) are explicitly "a roll-up semantic, not an account-classification taxonomy." No column, enum, DTO field, or report grouping plays a hidden classification role. | Same evidence paths as above; `accounting.prisma` `accountNature` comment |
| Prior Task 29 material on this subject | Originally analysis/proposal only; now reconciled with the explicit OD-29-05 Owner Decision. `statement-class-analysis.md` records Option C as direction only and preserves that implementation details remain unauthorized. | `docs/tasks/task-29/statement-class-analysis.md` §5; `owner-decision-closure.md` |

**Net fit/gap:** Statement Classification remains a clean greenfield for implementation. Option C is now the decided domain direction, but no existing invariant changes and no production implementation is present or authorized by this decision alone.

---

## 5. Owner Decision Recorded

> **Decision: Option C — Organization-configurable Statement Classification.**
>
> Statement Classification is an independent accounting/reporting concept configurable per Organization. Vardena records the domain direction only; implementation is deferred to a separately authorized Reporting Foundation / financial-statement task.

Decision consequences at the level decided by OD-29-05:

1. **Separation of Concerns:** Statement Classification has its own axis. It is not Account Type (lifecycle), Account Nature (orientation), Account Hierarchy / Chart of Accounts (coding), Detail / Detail Hierarchy (analytics), System Account, or Base Chart Coding Structure.
2. **Multi-organization support:** each Organization may define how its accounts are classified and presented for financial reporting, subject to future approved design and validation rules.
3. **Reporting flexibility:** the Chart of Accounts hierarchy is not the sole source of financial-statement presentation.
4. **Base Chart independence:** no Base Chart content, default classification taxonomy, statutory account requirement, or FaraPayam content is approved by this decision. Whether any future template may carry suggested classifications is a separate future decision.
5. **Accounting Core independence:** Chart of Accounts, voucher creation, Posting, General Ledger, Account Turnover, Trial Balance, and basic accounting operations remain conceptually independent from Statement Classification.
6. **Future financial reporting:** the concept is primarily relevant to classified/presentational statements such as Balance Sheet / Statement of Financial Position and Income Statement. It does not, by itself, solve Cash Flow or other advanced reporting logic.
7. **No implementation authorization:** schema, migration, Prisma models, APIs, DTOs, permissions, guards, UI, reports, seeds, classification hierarchy/versioning/effective dating, mapping cardinality, mandatory-vs-optional policy, and unclassified-account behavior all remain future decisions/design work.
8. **No statutory assumption:** OQ-43 remains open; no Iranian statutory classification rule, legal profile, filing format, or regulatory content is accepted here.

The analysis below is retained as the pre-decision option analysis that led to the recorded Owner choice.

---

## 6. Decision Matrix (Qualitative — No Numeric Scores)

| Option | Simplicity | Flexibility | Reporting | Multi-Org | Base Chart Impact | Future Migration Risk | Complexity |
|---|---|---|---|---|---|---|---|
| **A — No separate classification** | High (nothing new) | Low (presentation bound to coding) | Constrained: statements derivable only from hierarchy shape or per-report code | Weak: layout intent must be encoded into each org's chart | None | Medium–High: late retrofit forces whole-chart back-classification per organization; interim reports accumulate hard-coded grouping logic | Low now; the complexity re-emerges inside future report implementations |
| **B — Fixed built-in taxonomy** | Medium (closed list to pick from, but product owns a semantic catalog) | Low (taxonomy changes are releases/migrations) | Uniform but rigid; every gap in the list blocks someone's statement | Poor: one taxonomy imposed on all organizations and jurisdictions | Medium: template mechanism gains a coupled semantic-content axis, straining OD-27-02's boundary | High: revising a product-wide enum across live organizational data; statutory revisions hit Core directly | Medium code, but High governance (Vardena must curate and defend an official taxonomy) |
| **C — Organization-configurable** | Low–Medium (new mechanism/admin surface eventually, deferred) | High (per-organization definitions; changes are configuration data) | Strong directionally: statements can use configured presentation lines; Core stays layout-neutral; Legal Profiles may consume future approved outputs | Strong: native per-organization scoping, consistent with existing org-scoped configuration | Low at decision level (templates remain classification-free; any template-carried suggestion is a separate future decision) | Low–Medium directionally; exact migration/backfill/versioning/unclassified-account behavior remains future design work | Medium–High eventually, but zero until a separately gated implementation task |

---

## 7. OWNER DECISION RECORDED

> ## OD-29-05 — Statement Classification
>
> **Status:** `DECIDED`
>
> **Selected option:** **Option C — Organization-configurable Statement Classification**

The Owner explicitly selected **Option C**.

Statement Classification is an independent accounting/reporting concept that is configurable per Organization and is separate from:

- Account Type;
- Account Nature;
- Account Hierarchy / Chart of Accounts;
- Detail / Detail Hierarchy;
- System Account; and
- Base Chart Coding Structure.

The purpose is to allow an Organization to define how accounts are classified/presented for financial reporting without making the Chart of Accounts hierarchy itself the sole source of financial statement presentation.

### Important Scope Boundary

The decision is only about the architectural direction:

```text
Statement Classification is an independent, Organization-configurable concept.
```

Do **not** infer any default classification taxonomy, default classification names, statutory classification rules, Iranian statutory reporting requirements, number of classification levels, classification hierarchy/versioning, effective dating, mapping cardinality, whether one Account may have multiple classifications, behavior of unclassified accounts, mandatory-vs-optional classification policy for an Organization, permissions, admin workflow, database schema, Prisma models, API contracts, frontend/UI, reporting implementation, migration/seed data, Base Chart content, FaraPayam compatibility, legal/regulatory profiles, or production runtime behavior.

### Accounting Core Boundary

Statement Classification is **not required** for basic Accounting Core operation. The following capabilities remain conceptually independent from Statement Classification:

- Chart of Accounts;
- voucher creation;
- Posting;
- General Ledger;
- Account Turnover;
- Trial Balance; and
- basic accounting operations.

No rule is introduced that prevents an Organization from using Accounting Core merely because Statement Classification has not yet been configured. The exact runtime behavior of future financial reports when no classification exists remains a future Reporting Foundation decision.

### Relationship to Financial Statements

Statement Classification is primarily relevant to classified/presentational financial statements, including concepts such as:

- Balance Sheet / Statement of Financial Position; and
- Income Statement.

Statement Classification alone is **not** recorded as solving Cash Flow reporting or other advanced reporting requirements. Cash Flow and other advanced reporting logic remain separate future design concerns.

### Illustrative Example Only

```text
Chart of Accounts

101001  Cash
101002  Bank
101003  Accounts Receivable
102001  Equipment
201001  Accounts Payable
301001  Capital
401001  Service Revenue
501001  Salary Expense
```

Separately, an Organization may define a reporting classification such as:

```text
Statement Classification

Statement of Financial Position
├── Current Assets
├── Non-Current Assets
├── Current Liabilities
├── Non-Current Liabilities
└── Equity

Income Statement
├── Operating Revenue
└── Operating Expense
```

The example is illustrative only. It is **not** Vardena's official/default taxonomy, creates no seed data, approves no Base Chart content, and approves no production records.

**What OD-29-05 does and does not do:** it fixes the *domain direction* only. It does **not** authorize Task 30, Statement Classification implementation, Reporting Foundation implementation, or any other implementation; does **not** close OQ-25; does **not** approve the 264-account artifact for loading; does **not** approve FaraPayam content; does **not** introduce a System Account concept; does **not** introduce an English Account Title field; and does **not** modify OD-29-01/02/03/04/06 or OD-27-02.

---

## 8. Governance Boundary of This Pack

- Documentation only: no production code, Prisma schema, migration, seed, API, controller, service, Posting, reporting, permission, guard, Base Chart, Detail, or Account implementation is touched.
- OD-29-05 is **decided only at the domain-direction level** as **Option C**; the decision is not a production implementation approval.
- OQ-25 remains **OPEN**; OQ-41 and OQ-43 retain their recorded statuses.
- Task 30 and all other implementation tasks remain **NOT AUTHORIZED**.
- The 264-account Base Chart artifact remains not approved and not loaded; no Base Chart content is approved; no FaraPayam content is approved or loaded; no System Account concept and no English Account Title are introduced (OD-29-06 / OD-29-04 respected).
- The illustrative category names in this document are examples only, not Vardena's official/default taxonomy.
- No ADR is promoted to Accepted by this Owner Decision.

**Status: OD-29-05 DECIDED — OPTION C. Implementation remains separately gated.**
