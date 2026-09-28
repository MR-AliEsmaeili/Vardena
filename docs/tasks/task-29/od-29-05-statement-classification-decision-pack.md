# OD-29-05 — Statement Classification Decision Pack

**Date:** 2026-09-28
**Decision ID:** OD-29-05 — Statement Classification
**Status:** **`PENDING OWNER DECISION`** — this pack does **not** decide anything.
**Prepared against `main`:** `f15ce98e095c3c2bfb1f2e0b6ebbe7082da776aa` (merge of PR #77, Task 29 Owner Decision Closure).
**Nature of this document:** documentation-only Owner Decision preparation. Zero production code, Prisma schema, migration, seed, API, permission, guard, Posting, reporting, or UI change. It records analysis and a non-binding architectural recommendation; only the Owner may convert any option below into a decision.

---

## 1. Repository Baseline (Verified Context — Nothing Re-decided Here)

All statuses below are transcribed from repository records at the audited `main` commit. This pack changes **none** of them.

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
| OD-29-05 — Statement Classification | **`PENDING OWNER DECISION`** — the subject of this pack | `docs/tasks/task-29/owner-decision-closure.md` §"Decision Remaining Open" |
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

## 2. Problem Definition — What OD-29-05 Must Answer

The owner-provided VARDENA artifact and standard financial reporting practice raise one remaining domain question:

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

Both decisions stand as recorded in `owner-decision-closure.md`. **This pack does not modify, reinterpret, or extend them.** In particular, whatever the Owner decides for OD-29-05, the answer must not add a fourth Account Type, must not merge Statement Classification into Account Type, and must not turn Nature into a presentation concept.

### 2.2 What Statement Classification is (and is not)

Statement Classification is the *presentation/grouping axis* of formal financial statements: e.g. distinguishing a current asset from a non-current asset, or an operating expense from a finance cost. Two accounts can share `AccountType = BALANCE_SHEET` and `AccountNature = DEBIT` and still belong to entirely different statement lines.

Account Type answers "*which statement lifecycle does this account live in?*" (3 fixed values). Statement Classification would answer "*under which presentation line inside that statement does this account appear?*" (a finer, presentation-oriented grouping). The open question is whether that finer grouping should exist as an independent modeled concept, and if so, who owns its taxonomy.

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
| **Statement Classification** | Presentation line / grouping inside formal financial statements | **UNDECIDED — the OD-29-05 question** | `PENDING OWNER DECISION` |
| **Account Hierarchy** | Organization's coding tree (parent/child, roll-up axis for the existing read reports) | Organization-owned, shaped by Coding Structure | Implemented (Tasks 10–19); not a decision subject here |
| **Detail / Dimension** | Analytical sub-ledger axis on posting lines (تفصیلی) | Organization-configurable (OD-29-03; physical model open under OQ-41) | `DECIDED` at domain level — untouched here |
| **System Account** | (Excluded) system-owned account flags | — | `DECIDED` excluded from MVP (OD-29-06) — untouched here |
| **Base Chart Coding Structure** | Digit shape/levels of template and org codes | Product-owned template + org configuration | Implemented mechanism (OD-27-02, Task 23) — untouched here |

Statement Classification is **none** of the other six concepts. Any future implementation that stores it as a hidden overload of `Account.code` ranges, hierarchy depth, Nature, Type, Detail, or a Base Chart level name would violate this separation.

---

## 3. Options Analysis

Three candidate answers are analyzed. None is selected here.

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

Statement Classification becomes an independent, organization-scoped concept: each organization defines the classification entries it needs (possibly hierarchical) and assigns them to its accounts. The product ships the *mechanism*, not the *taxonomy* — the same mechanism-vs-content split already decided for the Base Chart (OD-27-02), Coding Structure, and Detail hierarchy (OD-29-03).

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
- **Migration:** additive only — new tables plus a nullable/absent relationship; no rewrite of `Account`, no ledger impact, no backfill forced at introduction time.
- **Versioning:** classification definitions are organization data; whether they need effective-dating/versioning (statements re-rendered for prior years) is a real future design question, analogous to the already-decided effective-dated control-role mapping (OD-20-3). Not decided here.
- **Account lifecycle:** classification assignment should be *mutable* (unlike Account Type after first Posting) because presentation regrouping is a legitimate reporting correction that never touches ledger facts. Exact mutability/audit rules are future design.
- **Future financial statements:** provides the missing grouping axis for ترازنامه / صورت سود و زیان lines without inventing their content today; statutory column sets/layouts remain Legal Profile territory (OQ-43 unchanged).

---

## 4. Fit/Gap Against the Current Architecture

Every row below is a static-inspection fact at the audited baseline. Where a capability does not exist, it is stated as `NOT IMPLEMENTED` — nothing is invented.

| Question | Finding | Evidence |
|---|---|---|
| Does `Account` carry any Statement Classification concept? | **NOT IMPLEMENTED.** Fields are identity, code, title, parent/level, structure/configuration references, `accountNature`, `isPostable`, `isActive`, audit stamps. No type field (itself a recorded OD-29-02 gap), no classification field. | `backend/prisma/schema/accounting.prisma` `model Account` |
| Does any Prisma model represent a Statement Classification? | **NOT IMPLEMENTED.** No `StatementClass`/`StatementClassification` (or equivalent) model exists in any schema file. | `backend/prisma/schema/*.prisma` (searched) |
| Does the Reporting Foundation have such a concept? | **NOT IMPLEMENTED.** The Task 17A/18/19 read surfaces explicitly and deliberately expose *no* classification: chart tree ("no invented `account_type`/classification"), trial balance ("No account classification or financial-statement columns are inferred"), account statement (D3 excludes nature/classification presentation), ledger movements ("no statement classification"). | `backend/src/modules/accounting/api/dto/chart-tree.dto.ts`, `api/trial-balance.controller.ts`, `domain/account-statement.ts`, `domain/ledger-movement.ts` |
| Does the Base Chart mechanism create a dependency on it? | **No.** `BaseChartTemplateNode` carries `code`, `title`, `accountNature`, `isPostable`, `isMandatory`, `defaultIsActive` only; publish/adoption invariants reference no classification. The mechanism is compatible with all three options as-is. | `backend/prisma/schema/accounting.prisma` `model BaseChartTemplateNode`; `docs/tasks/task-21/task-21-governance-baseline.md` |
| Can the Account hierarchy substitute for it? | **Partially, with structural limits.** Hierarchy roll-up is exactly what today's reports do, so Option A is *feasible*; but hierarchy is the coding axis (immutable codes after use, organization-shaped), so subtree-spanning presentation lines and post-hoc presentation regrouping cannot be expressed without chart restructuring. It is a possible *policy answer* (Option A), not an existing classification *feature*. | `AccountingReadQueryRepository` roll-up semantics (Task 18); contract §8/§9 code immutability |
| Has the implementation implicitly assumed something as Statement Classification? | **No.** The codebase repeatedly documents the *absence* of classification rather than smuggling one in; `accountNature` is explicitly "reporting semantics only," and trial-balance row kinds (POSTING/AGGREGATION) are explicitly "a roll-up semantic, not an account-classification taxonomy." No column, enum, DTO field, or report grouping plays a hidden classification role. | Same evidence paths as above; `accounting.prisma` `accountNature` comment |
| Prior Task 29 material on this subject | Analysis/proposal only, never promoted: `statement-class-analysis.md` sketches an organization-configurable model and the closure record explicitly demoted it to "historical Task 29 analysis/proposal only." | `docs/tasks/task-29/statement-class-analysis.md` §5; `owner-decision-closure.md` |

**Net fit/gap:** Statement Classification is a clean greenfield. No option is architecturally blocked, no existing invariant must bend, and no implicit commitment has been made — the decision is genuinely open.

---

## 5. Architectural Recommendation (NOT an Owner Decision)

> **Recommendation: Option C — Organization-configurable Statement Classification, decided now as the domain direction, implemented later (post-MVP / Reporting Foundation phase, under its own gate).**
>
> This is the preparer's architectural recommendation only. It has no decision force. OD-29-05 remains `PENDING OWNER DECISION` until the Owner records a choice.

Justification against the required criteria:

1. **Separation of Concerns:** Option C is the only option that gives presentation its own axis, keeping Type = lifecycle, Nature = orientation, hierarchy = coding, Detail = analytics fully orthogonal (§2.3). Option A collapses presentation into coding; Option B collapses it into product code.
2. **Multi-organization support:** organization-scoped classification is the only shape that lets different industries/entity kinds present differently without forking charts (A) or forcing releases (B).
3. **Reporting flexibility:** future statements group by data, not by deployed code; new lines are configuration. A and B both make presentation changes structurally expensive.
4. **Base Chart independence:** Option C (in its clean form, classification outside the template) leaves the OD-27-02 mechanism/content boundary untouched. Option B is the only option that would drag semantic content into the template mechanism.
5. **Future financial reporting:** provides the grouping axis financial statements need while leaving statutory layouts/column sets to Legal Profiles (ADR-0036), exactly as the decided architecture intends.
6. **Migration safety:** purely additive introduction (new tables + optional assignment); no `Account` rewrite, no ledger impact, no forced backfill; the lowest structural blast radius of the three when introduced *and* if later revised.
7. **Avoiding unnecessary complexity:** the complexity cost is real but *deferred* — deciding Option C now creates zero MVP work; nothing is built until a separately authorized Reporting/financial-statement task exists. Option A is simpler only until statements are actually needed, at which point its cost reappears as per-report hard-coding plus whole-chart back-classification.
8. **Avoiding hard-coded statutory assumptions:** Option B directly violates the recorded OQ-43 posture and ADR-0036 direction; Options A and C both avoid it, and C avoids it while still making statements expressible.

Why not the alternatives: **Option A** is a legitimate minimal answer and costs nothing today, but it silently converts every future presentation requirement into either chart surgery (blocked by code immutability) or hard-coded report logic (the anti-pattern ADR-0036 exists to prevent) — it is cheap now and expensive exactly when Vardena starts mattering as a reporting product. **Option B** is the weakest fit for this codebase: it contradicts the mechanism-vs-content principle the Owner has already applied three times (OD-27-02 Base Chart, Coding Structure, OD-29-03 Detail), and it is the only option that plants a statutory assumption inside Core.

If the Owner prefers to minimize even decision-level commitment, the defensible fallback is **Option A recorded as an explicit interim posture with C as the acknowledged future direction** — but that is a variant for the Owner to choose, not a recommendation to split the decision.

---

## 6. Decision Matrix (Qualitative — No Numeric Scores)

| Option | Simplicity | Flexibility | Reporting | Multi-Org | Base Chart Impact | Future Migration Risk | Complexity |
|---|---|---|---|---|---|---|---|
| **A — No separate classification** | High (nothing new) | Low (presentation bound to coding) | Constrained: statements derivable only from hierarchy shape or per-report code | Weak: layout intent must be encoded into each org's chart | None | Medium–High: late retrofit forces whole-chart back-classification per organization; interim reports accumulate hard-coded grouping logic | Low now; the complexity re-emerges inside future report implementations |
| **B — Fixed built-in taxonomy** | Medium (closed list to pick from, but product owns a semantic catalog) | Low (taxonomy changes are releases/migrations) | Uniform but rigid; every gap in the list blocks someone's statement | Poor: one taxonomy imposed on all organizations and jurisdictions | Medium: template mechanism gains a coupled semantic-content axis, straining OD-27-02's boundary | High: revising a product-wide enum across live organizational data; statutory revisions hit Core directly | Medium code, but High governance (Vardena must curate and defend an official taxonomy) |
| **C — Organization-configurable** | Low–Medium (new entity + assignment + admin, deferred) | High (per-organization definitions; changes are data) | Strong: statements group by configured lines; Core stays layout-neutral; Legal Profiles consume it | Strong: native per-organization scoping, consistent with all existing org-scoped configuration | Low (clean form: none — templates stay classification-free; any template-carried suggestion is a separate future decision) | Low–Medium: introduction is additive; open sub-questions (versioning, unclassified-account behavior) are design work, not data risk | Medium–High eventually (mechanism + admin UI), but zero until a separately gated implementation task |

---

## 7. OWNER DECISION REQUIRED

> ## آیا Vardena باید Statement Classification مستقل داشته باشد؟
>
> **Should Vardena have an independent Statement Classification concept — and if so, who owns its taxonomy?**

```text
A — No separate Statement Classification
B — Fixed built-in classification
C — Organization-configurable classification
```

- **A** — No independent concept, ever (or until explicitly revisited): statement presentation derives from Account Hierarchy and/or future report logic.
- **B** — Vardena ships one fixed, product-owned classification taxonomy used by all organizations.
- **C** — Statement Classification is an independent, organization-scoped, configurable concept; Vardena ships the mechanism, organizations own the taxonomy; implementation deferred to a separately authorized post-MVP task.

**No option is selected by this pack.** Until the Owner records a choice, OD-29-05 remains:

```text
PENDING OWNER DECISION
```

**Explicitly out of scope of OD-29-05 (each would need its own future decision, whichever option is chosen):** the concrete classification value set or any starter/default taxonomy content; whether Base Chart templates may carry suggested classifications; hierarchy depth/versioning/effective-dating of classifications; behavior of unclassified accounts in reports; mapping cardinality (single vs. multiple classifications per account); permissions and administration surfaces; any statutory layout or Legal Profile content (OQ-43); and every implementation concern (schema, migration, API, UI).

**What deciding OD-29-05 would and would not do:** it would fix the *domain direction* only. It would **not** authorize Task 30 or any implementation, would **not** close OQ-25 (concrete chart content, mandatory accounts, control-role catalog, statutory layouts stay open), would **not** approve the 264-account artifact for loading, and would **not** modify OD-29-01/02/03/04/06 or OD-27-02.

---

## 8. Governance Boundary of This Pack

- Documentation only: no production code, Prisma schema, migration, seed, API, controller, service, Posting, reporting, permission, guard, Base Chart, Detail, or Account implementation is touched.
- OD-29-05 is **not** decided, advanced, or defaulted here; the recommendation in §5 is advisory only.
- OQ-25 remains **OPEN**; OQ-41 and OQ-43 retain their recorded statuses.
- Task 30 and all other implementation tasks remain **NOT AUTHORIZED**.
- The 264-account Base Chart artifact remains not approved and not loaded; no System Account concept and no English Account Title are introduced (OD-29-06 / OD-29-04 respected).
- The illustrative category names in §3 Option B are analysis-only examples, not recorded Vardena taxonomy.

**Status: READY FOR OWNER DECISION.**
