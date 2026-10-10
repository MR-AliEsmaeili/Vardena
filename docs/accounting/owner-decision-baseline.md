# Vardena — Accounting Owner Decision Baseline (Q1–Q22 + Invariants 1–3)

Status: **Authoritative Owner-decision register** · Date: 2026-09-25 · Type:
governance / consolidation (documentation only) · Task 17C status:
**ACCEPTED (2026-09-25)** — documentation-only governance acceptance recorded by
the Task 17C Acceptance Sync (no self-acceptance; the acceptance was recorded per
the Owner's explicit Acceptance-Sync authorization — acceptance record:
[`docs/tasks/task-17/task-17c-acceptance-record.md`](../tasks/task-17/task-17c-acceptance-record.md))
· Task 19 ODR-1…ODR-3: **DECIDED** (appended §11; implementation accepted by Task 19) · Task 20 OD-20-1…OD-20-6: **DECIDED** (appended §12; documentation-only decision resolution)

| | |
|---|---|
| Owner source | [`docs/tasks/task-17/task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md) — the received Task 17C prompt, saved verbatim before any file change |
| ADRs created by this consolidation | [ADR-0033](../adr/0033-account-identity-and-code-history.md) (identity + code history) · [ADR-0034](../adr/0034-posting-versus-aggregation-accounts.md) (POSTING XOR AGGREGATION) · [ADR-0035](../adr/0035-account-code-structure-migration.md) (code structure migration) · [ADR-0036](../adr/0036-legal-reporting-architecture.md) (legal reporting architecture) · [ADR-0037](../adr/0037-accounting-configuration-boundary.md) (configuration boundary) — all **Proposed**, none Accepted by this task |
| Registry synchronization | [`docs/open-questions.md`](../open-questions.md): OQ-25 and OQ-43 annotated (both remain **OPEN**); [`STATE.md`](../../STATE.md) §3/§7/§9/§10; [`docs/accounting/task-index.md`](./task-index.md) §2/§4/§5/§9; [`docs/accounting/domain-contract.md`](./domain-contract.md) §31 addendum (pointer only) |
| Production effect | **NONE.** No code, API, DTO, schema, Prisma, migration, seed, permission, report, UI, dependency, refactor or behaviour change. Task 17B's implementation **and** its **ACCEPTED** status (PR #43 merged in `b10e007`; acceptance recorded by PR #44, merged in `2892189`) are untouched. |
| Binding contract | Unchanged: [`domain-contract.md`](./domain-contract.md) + [ADR-0026](../adr/0026-accounting-bounded-context.md). Where an Owner decision refines a contract decision, §5 records it and names the ADR that must be accepted plus the task that must implement it — nothing is silently reinterpreted. |

> **Purpose.** Make the Owner-approved Accounting decisions Q1–Q22 and the three
> approved invariants *repository-backed*, so no future agent or task has to
> re-interpret them, and so every place where the repository is **stricter**,
> **silent** or **not yet implemented** is recorded instead of being papered over
> (AG-17: record, don't assume).
>
> **Boundary.** This register decides nothing new. It transcribes Owner decisions,
> reconciles each one against `main` as it stood at the reconciliation baseline
> (`b10e007`, merge of PR #43) — re-verified after this branch was synchronized with
> `main` @ `2892189`, the merge of **PR #44** (see §1 and §10) — and lists the
> discrepancies (§5) and the implementation-level questions that stay open (§6).
> It closes **no** Open Question, promotes **no** ADR or task status, and makes **no**
> legal, tax or statutory claim.

---

## 0. How to read this register

| Class | Meaning |
|---|---|
| **OWNER DECIDED** | The Owner decided this in the Task 17C prompt. It is a decision, not a suggestion, and future work must not re-litigate it. |
| **CONFIRMED BY REPOSITORY** | Current `main` already implements/decides it; cited by file, contract §, ADR or AC id. |
| **IMPLEMENTATION DETAIL OPEN** | The Owner decided the model; a concrete rule, vocabulary, column, endpoint or policy is still undecided and stays with the named OQ. |
| **LEGAL VALIDATION REQUIRED** | A legal/tax fact that must be validated with an accountant and authoritative current sources before any statutory feature (OQ-43). This register claims no legal closure. |
| **GAP** | The Owner decision requires a capability the repository does not have. Not a contradiction; additive work, unauthorized here. |
| **DISCREPANCY** | The Owner decision and the repository cannot both be literally true today. Recorded in §5, never silently resolved. |

Evidence paths are relative to the repository root; `accounting/...` means
`backend/src/modules/accounting/...`.

---

## 1. Repository baseline verified for this consolidation

Inspected on `main` @ `b10e007` before any edit (AG-01 reading order), and
re-inspected on `main` @ `2892189` (the merge of PR #44) during the branch
synchronization recorded in §10:
`STATE.md` · `docs/open-questions.md` · `docs/accounting/domain-contract.md` ·
`docs/accounting/task-index.md` · `docs/accounting/configuration.md` ·
`docs/reporting-strategy.md` · `docs/tasks/task-17/*` (brief, prompt, 17A report +
acceptance record, 17B investigation/brief/prompt/gate/decision pack/implementation
report/acceptance record) · `docs/adr/README.md` + ADR-0003/0009/0026/0028/0030/0031/0032 ·
`.vardena/agent-rules.md` · `.vardena/architecture-rules.md` ·
`docs/architecture/domain/configurability-architecture.md` · `docs/modules.md`
(Accounting) · and the Accounting implementation, read-only, to keep this document
from contradicting it: `backend/prisma/schema/accounting.prisma`,
`backend/prisma/migrations/*` (15 migrations), `accounting/domain/{account,account-code,coding-structure,accounting-configuration,ledger-entry,document-reversal,account-statement,money}.ts`,
`accounting/data/{accounts,ledger-entries,account-balance-projections,account-statements}.repository.ts`
+ `accounting/data/accounting-configuration-usage.ts`,
`accounting/application/{accounts,account-statements,ledger-movements,accounting-balances,accounting-documents}.service.ts`,
`accounting/api/*`, `accounting/domain/accounting-permissions.ts` (36 codes **at this
baseline**; **38 after Task 18** — see the post-baseline drift note below).

**Synchronization note (2026-09-25).** PR #44 (Task 17B acceptance) changed
**documentation only**: `STATE.md`, `docs/accounting/task-index.md`,
`docs/modules.md`, `docs/tasks/task-17/task-17b-implementation-report.md` and the
new `docs/tasks/task-17/task-17b-acceptance-record.md`. `git diff --name-only
b10e007…2892189` contains no `backend/`, Prisma, migration, test, permission,
workflow or dependency path, so **every repository fact in this section — and
therefore every discrepancy (D-1…D-13) and open implementation item (O-1…O-12)
below — is unchanged by that merge**. Only the governance statements about Task
17B's *status* (§5 D-8, §7, §8, §10) needed updating to the post-merge facts.

**Post-baseline drift note (2026-09-25, recorded by the Task 17C governance review after
PR #47).** Task 18 — Accounting Reporting Read Foundation — was reviewed before merge,
merged (PR **#46** → `e774a1c`) and then **ACCEPTED (2026-09-25)** (PR **#47** →
`40a3e0a`), i.e. **after** this register's baseline. Inside the Accounting module it adds
a shared read/query repository, **extends the account-statement surface** and adds the
explicit read-only **General Ledger** and **Trial Balance** APIs, plus the independent
`Accounting.GeneralLedger.View` / `Accounting.TrialBalance.View` permissions — and no
schema, migration, Reporting module, export, statutory layout or legal book
(`docs/tasks/task-18/task-18-acceptance-record.md` §7/§8). Three statements below were
true at the baseline and are corrected in place: the §1 permission-code count, the
**Q10** row and the **D-13** row — the **General Ledger** read surface now exists, while
the **Journal Book** (`دفتر روزنامه`), every statutory/legal book and any Legal Profile do
not. Q10's Owner decision, D-13's legal gap and every other reconciliation, discrepancy
and open item are unchanged; **OQ-25/OQ-43 remain OPEN**, Task 17 remains **FORMALIZED /
IMPLEMENTATION BLOCKED**, and Task 18 authorizes no Task 17 slice and promotes no ADR.

Facts this register relies on:

| Fact | Evidence |
|---|---|
| Ledger rows, document lines and the balance projection reference `account_id`; **no ledger/projection row stores an account code** | `accounting.prisma` (`LedgerEntry.accountId`, `AccountBalanceProjection` five-column key), ADR-0031 §2/§3 |
| `accounts.code` is digits-only, unique per organization, and **immutable from creation** — the update path has no code field | `uq_accounts_organization_id_code`; `accounting/domain/account.ts` ("There is therefore NO code field on the update path"); `PATCH /api/v1/accounting/accounts/:id` — "The code is immutable" |
| Postable ⇒ leaf is enforced on both write paths; a non-postable node's numbers are its descendants' rollup | contract §14 rule 2 (AC-D-19), §8.5, AC-I-09; `accounting/data/accounts.repository.ts`; `UpdateAccountDto` description |
| Levels, digit lengths, titles, `level_kind` and per-level posting defaults are configurable and version-pinned; caps are code constants | `coding_structure_versions`/`_levels`, `accounting_configurations`/`_levels` (ADR-0028), `MAX_CODING_STRUCTURE_DEPTH = 8`, `MAX_ACCOUNT_CODE_LENGTH = 32` |
| Accounts are never deleted; lifecycle is `is_active` only; there is no `Accounting.Account.Delete` | contract §8.6 (AC-D-08); `accounting/api/accounts.controller.ts` (GET/POST/PATCH/enable/disable only); OQ-36 posture |
| Final accounting documents are never edited or deleted; `DELETE` exists only for `draft`/`temporary`; the implemented correction kind is `reversal` only | AC-I-05/06, contract §15.2–§15.4; `accounting/api/accounting-documents.controller.ts`; `accounting/domain/document-reversal.ts` (`ACCOUNTING_CORRECTION_KINDS = ['reversal']`) |
| `document_date` and `posting_timestamp` are both stored on every ledger entry, alongside stored `fiscal_year_id`/`accounting_period_id` | `accounting.prisma` (`LedgerEntry`), contract §12.3, §19.2 rule 3, C3 |
| Account Statement exists as the canonical account-movement read surface (Opening, Debit, Credit, Net, Running, Closing; intra-year sequence-based opening; no carry-forward) | Task 17B: `accounting/domain/account-statement.ts`, `AccountStatementsService`, `GET /api/v1/accounting/account-statements`, `Accounting.AccountStatement.View` |
| Control roles, dimensions, floating details, posting rules, year-transition operations, statutory reports and any Legal Profile are **contract-only — not implemented** | `accounting.prisma` header (defers `control_role`, `reserved_ranges`), contract §8.7/§10/§11, `task-index.md` §4; no `license` schema/module exists in `backend/` |
| No base/template chart of accounts is shipped or seeded | contract §1.2 non-goal 1; `backend/prisma/` has no seed script; no template artifact in the tree |

---

## 2. Owner decision register (Q1–Q22)

| Q | Owner decision (as received, condensed — full text in the prompt file) | Class | Repository reconciliation | Recorded in |
|---|---|---|---|---|
| **Q1** | Code levels must **not** be hardcoded to four; the organization configures the level count inside a controlled Vardena-supported structure — configurable, not unlimited arbitrary hierarchy. | OWNER DECIDED · CONFIRMED BY REPOSITORY | Already decided/implemented: configurable depth + per-level titles/digit lengths/kinds, version-pinned, with code-defined caps (depth ≤ 8, code ≤ 32). Four level names are vocabulary, not tables. | ADR-0037 §1; contract §8.1/§9.1 (AC-D-06/AC-D-10) |
| **Q2** | Vardena provides a **standard/base** Accounting structure; the organization configures it; standard Control Roles exist and organization-owned accounts are mapped to them (hybrid model). | OWNER DECIDED · **GAP/DISCREPANCY D-5** · **REFINED BY OD-20-1** | The *hybrid mechanism* exists (Vardena semantics + organization configuration). **OD-20-1 resolves the artifact shape:** the Base Chart is a versioned Accounting-owned database/product template adopted explicitly into an organization, creating organization-owned Account identities; template identities never become ledger references. The **base/template content does not exist** and stays expert-gated (OQ-25): no seed, no template artifact/table, no adoption operation. | ADR-0037 §2/§3; §5 D-5; §12 OD-20-1 |
| **Q3** | Code changes may be allowed **before use** inside the configured structure; after use, arbitrary code changes are not allowed — any structural change after use follows the controlled migration mechanism; digit-length constraints stay governed by the configured structure. | OWNER DECIDED · **DISCREPANCY D-2** | The repository is **stricter**: `code` is immutable from creation (no code field on the update path). The after-use half matches contract §8.4 rule 4/§9.5 and is now mechanized by ADR-0035. | ADR-0033 §6; ADR-0035 §1; §5 D-2 |
| **Q4** | Control Roles are standardized by Vardena; only roles required by **active** Accounting operations are mandatory; organizations map their own accounts to those roles. | OWNER DECIDED · **GAP** · **REFINED BY OD-20-2/OD-20-3** | Mechanism decided (AC-D-09: code-defined roles, organizations map accounts to roles, posting rules reference roles) but **not implemented** — no role catalog/table/service exists. **OD-20-2 resolves sequencing as consumer-first**: no speculative generic catalog. **OD-20-3 resolves the artifact shape** as an independent effective-dated mapping, not `Account.control_role`. The concrete role list and mandatory set stay EXPERT-GATED (OQ-25). | ADR-0037 §4/§5; contract §8.7; §12 OD-20-2/OD-20-3 |
| **Q5** | Default: the **final/last configured level** is postable, higher levels are not; configuration may allow posting at another level; posting must preserve integrity and must not create parent/child double counting; reconcile with Invariant 2. | OWNER DECIDED · **D-1 RESOLVED BY OD-20-5** | Default-per-level exists (`default_is_postable`, contract §14 rule 4). **OD-20-5 selects the structural product rule:** `POSTING = leaf-only`; `AGGREGATION = reporting/read-time roll-up`. Non-leaf posting is not authorized; the same movement must not be independently posted to `معین`, `گروه` and `کل`. Task 18 roll-ups are valid because parent amounts are derived from leaf postings. | ADR-0034; §5 D-1; §12 OD-20-5 |
| **Q6** | Vardena must support **both** tree-based Detail Accounts and Floating Detail Accounts; exact usage configurable. | OWNER DECIDED · CONFIRMED (mechanism) · **GAP** (implementation) | Contract §11.2 explicitly supports both and forces no choice (AC-D-15). Neither dimensions nor floating details are implemented (OQ-41; `task-index.md` §4 candidate). | ADR-0037 §6; contract §10/§11 |
| **Q7** | A configurable general dimension model (cost center, project, branch, …); **never** a giant EAV or giant JSONB structure; account↔dimension relationship may be `required` / `optional` / `forbidden` per configuration. | OWNER DECIDED · CONFIRMED (mechanism) · **GAP** (implementation) · **REFINED BY OD-20-6** | Exactly the decided shape: configured count under a code cap, typed item tables, per-(account, dimension) `requirement`, typed line-assignment child table, no EAV/JSONB (AC-D-11…AC-D-14, AC-I-18, `configurability-architecture.md` §5.2). **OD-20-6 decides the initial boundary:** transaction-line-level analytical assignments, aggregation through Accounting/read logic for concrete reporting consumers, no ledger dimension columns and no speculative projection. Not implemented; defaults/count/binding stay OQ-41. | ADR-0037 §7; contract §10.1–§10.6; §12 OD-20-6 |
| **Q8** | Vardena provides default code lengths; at initial setup the organization chooses each level's digit length; changing code length **after transactions exist** only through the controlled licensed migration mechanism. | OWNER DECIDED · CONFIRMED (first half) · **GAP** (second half) | `digit_length` per level is configuration (ADR-0028 §1, contract §9.1); a new version never reinterprets pinned accounts (§9.4). The migration service does not exist (ADR-0035 authorizes nothing). | ADR-0035 §1/§2; ADR-0033 §6; contract §9.4 |
| **Q9** | Legal books are implemented **after** Accounting Core; Iranian statutory requirements must not become hardcoded dependencies of the Core. | OWNER DECIDED · CONFIRMED BY REPOSITORY | Contract §2.3 records C1–C7 as *reported* inputs only; "Nothing in C1–C7 is implemented, asserted as law, or encoded as a constant." No statutory code exists. | ADR-0036 §2; contract §2.3, §19.4 |
| **Q10** | Journal Book and General Ledger are **independent reports**; they must not be collapsed into one report because they share underlying data. | OWNER DECIDED · CONFIRMED (separation) · **GAP** (Journal Book not implemented; a General Ledger read surface exists since Task 18) | Contract §19.1 lists the journal (`دفتر روزنامه`) and the general ledger (`دفتر کل`) as distinct future reports over the same immutable lines (C1); `reporting-strategy.md` §1/§5: definitions compose, engines are never duplicated. At this baseline no report definition existed; since **Task 18 (ACCEPTED 2026-09-25, PR #46 merged in `e774a1c`)** an accounting-owned **General Ledger** read surface exists (`GET /api/v1/accounting/general-ledger`) — not a legal book and with no statutory layout — while the **Journal Book** stays unimplemented (see the drift note in §1). | ADR-0036 §3 |
| **Q11** | Primary system language: **Persian**. Base monetary unit configurable, including **Rial** and **Toman**; Rial input may be displayed with Toman conversion; legal reporting handled separately through the Legal Profile/Adapter. | OWNER DECIDED · PARTLY CONFIRMED · **DISCREPANCY D-6** | Persian-capable typed titles are first-class (C4, §8.3). **Later date/time clarification:** the BusinessDate/Instant foundation and explicit Gregorian/Jalali API boundaries follow ADR-0042; ADR-0044 fixes Jalali-first MVP presentation and keeps only the organization IANA time zone configurable. Calendar selection and transition are not available. OQ-02 remains open for Persian-numeral preference and broader localization. Money is `numeric(18,2)` with **no currency column** on ledger/projection (§13.6/§24.1 dormant seam, OQ-03) — so a configurable base unit (and Rial↔Toman scale) has no storage representation yet; conversion must stay presentation-only. | ADR-0036 §4; ADR-0042; ADR-0044; §5 D-6; OQ-02/OQ-03 remain OPEN only for their remaining scope |
| **Q12** | Two correction behaviours by lifecycle: internal/non-final documents may support controlled deletion/recreation under permissions and lifecycle rules; Final/posted documents follow immutable correction/reversal semantics. **Not** permission to physically delete Final/Posted history. | OWNER DECIDED · CONFIRMED BY REPOSITORY | Exactly the shipped model: `deletablePhases = [draft, temporary]` with `Accounting.Document.Delete`, Final never editable/deletable (AC-I-05/06), corrections are counter-documents (AC-D-22, AC-I-15). Only `reversal` is implemented; correction/replacement/adjustment are contract-only. Windows stay OQ-27. | No new ADR needed — already binding: contract §15.1–§15.4 (AC-D-20/21/22, AC-I-05/06/15) + ADR-0026 §4; open parts in §5 D-10 and §6 O-10 |
| **Q13** | **Decision C.** Final/legal documents must not be physically deleted; correction/reversal must preserve historical auditability (`draft/non-final → controlled edit/delete/recreate`; `final/posted → immutable → correction/reversal`); exact lifecycle stays subject to the existing domain contract. | OWNER DECIDED · CONFIRMED BY REPOSITORY | AC-I-06 + `planDelete` refuse Final; the numbering allocation row survives a discarded voucher (auditable gap, ADR-0023 §3); reversal (Task 15) creates a new Final counter-document and never suppresses originals. OQ-54 (non-accounting finalized documents) and OQ-27 (windows) remain OPEN — Q13 does not close them. | contract §15.3/§15.4; ADR-0035 §4 (history preserved) |
| **Q14** | **Decision D.** `Document Date` for financial reporting, `Posting Timestamp` for audit/event timing; Fiscal Year, Accounting Period, Document Date and Posting Timestamp remain distinct — never substitutes. | OWNER DECIDED · CONFIRMED BY REPOSITORY | All four exist and are distinct: stored `fiscal_year_id`/`accounting_period_id` (resolved from `document_date`, AC-I-02), `document_date` (`DATE`) and `posting_timestamp` (`timestamptz`) on every ledger entry (§12.3, C3); report period filters are predicates on stored columns (§19.2 rule 3). Task 17A/17B expose both dates and sort by `documentDate` first. | ADR-0036 §6; §6 O-6 (free date-window "as of" basis) |
| **Q15** | **Decision A.** Account Statement is the **unified** concept for account performance/turnover: at minimum Opening, Debit Turnover, Credit Turnover, Net, Closing; supports drill-down to source documents; **no two independent financial calculation engines** for Account Statement and Account Performance. | OWNER DECIDED · CONFIRMED BY REPOSITORY (drill-down partly) | Implemented by Task 17B as the canonical account-movement calculation (`domain/account-statement.ts`; prompt §19 forbids a second engine): opening/debit/credit/net/running/closing, exact debit-positive decimals, intra-year sequence-based opening. Rows carry voucher + voucher-line ids and the source-document snapshot, so drill-down **data** exists; a drill-down resource/endpoint does not (see §6 O-7). No "Account Performance" surface exists — consistent. | Baseline §4; contract §19.2; Task 17B prompt §19 |
| **Q16** | **Decision D.** Account Overview is a more graphical/easier **presentation** over the same read source and the same financial calculations — KPIs, charts, summaries, drill-down — never a second independent accounting calculation engine. | OWNER DECIDED · CONFIRMED BY REPOSITORY (principle) | Already repository policy: `reporting-strategy.md` §1.3/§5 ("dashboards compose, they don't duplicate"; KPIs are report queries), ADR-0009 (view-first, one pipeline), Task 17B prompt §20 ("no separate accounting calculation named «مرور حساب»… must never become a second accounting truth"), and the shipped service header comment. No Overview surface exists yet. | Baseline §4; ADR-0036 §3 (same discipline for legal books) |
| **Q17** | **Decision D.** The Accounting Core stays standardized, safe and integrity-preserving; a Configuration Layer provides high flexibility; configuration may **not** violate fundamental invariants, security, auditability, tenant isolation or data integrity. *High configurability does not mean unrestricted configurability.* | OWNER DECIDED · CONFIRMED BY REPOSITORY | The L1/L2 layering of `configurability-architecture.md` §1, the anti-pattern guard §2, AR-29/AR-31/AG-09, ADR-0028 (versioned configuration, single ACTIVE, operational freeze), AC-I-01/16/21 and ADR-0016 enforcement. | ADR-0037 §8 |
| **Q18** | **Decision D.** Historical reports use the account code valid during the relevant historical period/date, and retain/display the historical ↔ current mapping where useful (1404: `1000 - زمین`; 1406: `1100 - زمین`; a 1404 report defaults to `1000 - زمین`). | OWNER DECIDED · **GAP/DISCREPANCY D-3** · **REFINED BY OD-20-4** | No code history exists: one immutable code per account, and every read surface renders the current code. Today the rule is *vacuously* satisfied (a code never changes), so no report is wrong. **OD-20-4 decides producer-first history:** pre-use code correction is permitted in principle; after accounting use code is immutable; do not create a speculative history table until a real code-change producer is implemented. | ADR-0033 §3/§4; §5 D-3; §12 OD-20-4 |
| **Q19** | **Decision D.** Changing code structure after transactions exist goes through a dedicated Vardena-controlled **Accounting Code Structure Migration Service** — a controlled/licensed capability, not a normal user setting — with the 11-stage flow (Request → Preflight → Impact → Dry Run → Plan → Owner Approval → License Validation → Recovery/Backup Point → Migration → Reconciliation → Audit Report), fully auditable. | OWNER DECIDED · **GAP/DISCREPANCY D-7** | Contract §9.4 already requires "an explicit, permission-gated, audited operation" (policy OQ-25); nothing is implemented, and the **license gate has no foundation yet** (ADR-0030 Proposed, enforcement OFF, no `license` schema/module; OQ-45 open). Backup/recovery targets are uncommitted (OQ-52/OQ-53). | ADR-0035 §1–§7/§9; §5 D-7 |
| **Q20** | **Decision D.** Changing the **number of levels** is not a current product capability: do not implement it, add no feature/migration flow/UI for it; the architecture should not unnecessarily prevent future analysis. Current migration scope = controlled code-length/structure changes within the approved model. | OWNER DECIDED · CONFIRMED (with a precision, D-9) | Nothing to remove: no level-count migration exists. Precision recorded: creating a **new** configuration/coding-structure version with a different `max_depth` for **newly created** accounts (existing accounts stay pinned, §9.4) is ordinary configuration, not a level-count migration, and is unaffected. | ADR-0035 §8; §5 D-9 |
| **Q21** | **Decision D.** An account with no historical transaction usage and no other blocking references may be deleted; an account with historical usage must be deactivated, never physically deleted. **Zero current balance ≠ safe to delete** (`+100M / −100M = 0` is historical usage). Deletion rules must preserve historical accounting integrity. | OWNER DECIDED · **DISCREPANCY D-4** (repository stricter) | Implemented rule is freeze-over-delete for **every** account (AC-D-08, §8.6): no delete endpoint, no `Accounting.Account.Delete`, `is_active` only (OQ-36 posture). The "never delete used accounts" half is enforced; the "may delete unused accounts" half is a relaxation that needs its own task (reference check over accounting history + permission + a code-reuse answer). | ADR-0033 §7; §5 D-4 |
| **Q22** | **Decision B.** Accounting Core stays independent from jurisdiction-specific legal requirements: `Accounting Core → Legal Adapter / Legal Profile → {Iran Legal Profile, future profiles}`; no Iranian statutory report semantics hardcoded in the Core; actual Iranian legal requirements must be validated against authoritative current sources before statutory/legal features are built. | OWNER DECIDED (architecture) · **LEGAL VALIDATION REQUIRED** (facts) | Matches the repository's existing posture (contract §2.3, §19.4, OQ-43: "No legal requirement is hardcoded") and adopts the *proposed* layer 4 of `task-17b-investigation.md` §8.1 as architecture. No legal profile model/module exists (`reporting-sample-audit.md` item 19). **OQ-43 stays OPEN.** | ADR-0036 §1/§2/§7 |

---

## 3. The three mandatory invariants (normative)

Approved by the Owner after architecture review. They bind every future Accounting
schema, migration, service, API, report, integration and legal profile.

### I-1 — Account Identity (ADR-0033)

`Account.id` is the **permanent** Accounting identity; `Account.code` is a
business/display identifier and is **not** the permanent identity. Therefore: the
ledger references Account identity; opening logic references Account identity;
historical reporting resolves the code by historical validity; integrations must not
treat a code as permanent identity unless explicitly designed as a controlled business
reference.

```text
Account.id
   +-- Current Code
   +-- Historical Code(s)
```

**Repository status:** the identity half is CONFIRMED BY REPOSITORY (ledger lines,
ledger entries and the projection key all carry `account_id`; no code is stored on
any historical row; opening/carry-forward windows partition by `account_id` —
ADR-0031 §2/§4). The **code-history half is a GAP** (§5 D-3).

### I-2 — Posting Account XOR Aggregation Account (ADR-0034)

An account node has exactly one semantic role at a given time: **POSTING** (a valid
destination for ledger posting) **or** **AGGREGATION** (balance/turnover derived from
its child structure, never independently posted to) — never both simultaneously. The
purpose is to prevent ambiguity and double counting:

```text
Accounts Receivable          (AGGREGATION → derived from children)
   +-- Customer A            (POSTING)
   +-- Customer B            (POSTING)
   +-- Customer C            (POSTING)
```

Task 20 OD-20-5 resolves the prior Q5 wording ambiguity by choosing the shipped
leaf-only invariant as the product rule:

```text
POSTING = leaf-only
AGGREGATION = reporting/read-time roll-up
```

**Repository status:** satisfied today by the authoritative rule — postable ⇒ leaf
(AC-D-19 rule 2, AC-I-09) plus §8.5 rollup — which makes a non-leaf POSTING node
unrepresentable. Parent values are derived views over descendant leaf postings, not
additional independent movements. Future non-leaf posting would require a new explicit
architecture decision and ADR supersession/amendment; it is not authorized here.

### I-3 — Code Migration Must Not Rewrite Economic Ledger History (ADR-0035)

Changing an account code must **not** rewrite the economic identity of historical
ledger entries. A migration preserves `Account.id` and changes only the code
representation/history, keeping a reconstructable historical mapping:

```text
Ledger Entry → Account.id = A123 → { 1000 [historical] , 1100 [current] }
```

It must not mutate historical economic meaning merely to make old ledger rows display
a new code.

**Repository status:** structurally protected (no historical row stores a code; ledger
is insert-only with no update/delete path — `data/ledger-entries.repository.ts`), and
**no migration service exists** to violate it. Binding on the future service
(ADR-0035 §4/§5/§6).

---

## 4. Historical and legal reporting rule

```text
Report Date → Account.id → Historical Code Resolution → Report
```

1. A historical report resolves and displays the code valid for its historical context
   (fiscal year / accounting period / `document_date`) — Q18, ADR-0033 §4.
2. The current code and the historical ↔ current mapping may be exposed alongside it;
   a current-code rendering is an explicit alternative view, never a silent rewrite.
3. Legal reporting uses the **same** identity model: a Legal Profile must not use
   `Account.code` as permanent identity (ADR-0036 §5).
4. Time axes stay distinct (Q14): `document_date` = financial-reporting axis;
   `posting_timestamp` = audit/event-timing axis; Fiscal Year and Accounting Period are
   the stored scope a report filters on (§19.2 rule 3) — none of the four replaces
   another.
5. One read source, many presentations (Q15/Q16): Account Statement is the canonical
   account-movement/turnover calculation; Account Overview, Account Performance,
   dashboards, KPIs, charts and the legal books are **presentations or report
   definitions** over the same Accounting read source (`reporting-strategy.md` §1/§5,
   ADR-0009). A second financial calculation engine is a defect, not a feature.
6. **Legal Books are not implemented by this task** and are not authorized by it
   (Q9/Q22; ADR-0036).

---

## 5. Discrepancies between the Owner decisions and the current repository

Recorded per AG-17 and prompt §2 ("If a claimed decision cannot be reconciled with the
repository, do NOT silently invent a resolution. Report it as a discrepancy."). None of
them was resolved by invention; none changes shipped behaviour.

| Id | Type | Owner decision | Repository state (evidence) | What this consolidation does | What a future task must do |
|---|---|---|---|---|---|
| **D-1** | **RESOLVED BY OD-20-5 (2026-09-26)** | Q5 + I-2 required reconciliation between configurable posting level wording and parent/child double-count prevention. | Contract §14 rule 2 (AC-D-19) + AC-I-09: **postable ⇒ leaf**, enforced on both write paths; §8.5 and Task 18 read models roll leaf postings up to ancestors at reporting/read time. | **OD-20-5 chooses the shipped invariant as the product rule:** `POSTING = leaf-only`; `AGGREGATION = reporting/read-time roll-up`. Parent-level values are derived from leaf postings and must not be posted independently as duplicate movement. | No implementation is needed for D-1. Future non-leaf posting would be a new explicit architecture decision that reopens/supersedes ADR-0034 and the affected contract/read-model rules. |
| **D-2** | **CONFLICT (repository stricter)** | Q3 and OD-20-4: code changes may be allowed **before first accounting use** inside the configured structure. | `code` is immutable **from creation**: no code field on the update path (`accounting/domain/account.ts`), `PATCH /accounts/:id` documents "The code is immutable", `UpdateAccountDto` has no `code`. | ADR-0033 §6 records the Owner decision as a **permitted future relaxation** and OD-20-4 confirms the boundary: pre-use controlled correction allowed; after accounting use forbidden. Nothing implemented. | A task adding a pre-use code edit: reference check (no document line/ledger entry), §9.2/§9.3 validation against the pinned versions, uniqueness/collision handling, permission (AR-22), audit, tests, and producer-bound history. |
| **D-3** | **GAP** | Q18 + I-1 + OD-20-4: code history, as-at historical resolution, mapping display; history must be designed with a real producer. | No history structure; one immutable code per account; `uq_accounts_organization_id_code`; read surfaces render the current code only. | ADR-0033 §3/§4 makes code history + as-at resolution the target contract and OD-20-4 forbids a speculative history-only table before a producer exists. No column, table or migration added (AR-29). | A future producer task (pre-use edit or ADR-0035 migration) designs code-history rows with validity, as-at resolution, mapping exposure, and answers **code reuse** (§6 O-1) / unique-index interaction. |
| **D-4** | **CONFLICT (repository stricter)** | Q21: an account with no historical usage and no blocking references **may be deleted**. | Freeze-over-delete for every account (AC-D-08, §8.6): no DELETE route, no `Accounting.Account.Delete` permission, `is_active` only (OQ-36: "No deletion is implemented"). | ADR-0033 §7 records both halves, defines "usage" as referencing accounting history (**never** a zero-balance test), and states that only the stricter half is implemented. | A task adding deletion for provably unused accounts: reference check across document lines/ledger/projection/configuration references, granular permission + denial tests, code-reuse policy (OQ-36), audit. The never-delete-used-accounts half needs no work. |
| **D-5** | **GAP (new commitment; mechanism refined by OD-20-1/2/3)** | Q2: Vardena provides a standard/base Accounting structure the organization configures; Q4: standardized control roles exist when consumed. | Contract §1.2 non-goal 1: the contract does **not** define account codes, titles, chart content or control-role content. No seed script, no template artifact/table, no adoption operation, no role catalog and no mapping table. | ADR-0037 records the decided mechanism: Base Chart = versioned Accounting-owned template asset adopted explicitly into an organization; control roles = consumer-first; role assignment = independent effective-dated mapping, not `Account.control_role`. Content stays EXPERT-GATED (OQ-25) and nothing is invented here (AR-31). | Future tasks require accountant-approved base content and/or a concrete control-role consumer. Adoption must create organization-owned Account identities and respect ODR-1/ODR-3; role implementation waits for its consumer and catalog approval. |
| **D-6** | **GAP / PARTIAL** | Q11: Persian primary language; configurable base monetary unit incl. Rial and Toman; optional Rial→Toman display conversion. | Persian-capable titles exist (C4/§8.3). BusinessDate/Instant storage and explicit calendar-boundary contracts follow ADR-0042; ADR-0044 fixes Jalali-first MVP presentation, with only the IANA time zone configured per organization. Calendar selection/transition are not available; Persian-numeral and broader localization policy remain open. Money is `numeric(18,2)`; **no currency column** on `ledger_entries` or the projection (ADR-0031 §3; contract §13.6/§24.1 seam dormant, OQ-03/OQ-47/OQ-48); no unit/scale configuration exists. | ADR-0036 §4 records the decision, keeps conversion **presentation-only** (one stored amount, one stored unit) and leaves currency mechanism/precision to OQ-03 and numeral/broader display preferences to OQ-02. **No legal/statutory currency claim is made.** | OQ-03/OQ-02 answers (unit set, scale/precision, numeral rendering) before any unit-configuration or conversion work; statutory currency/language presentation belongs to the Legal Profile (ADR-0036). ADR-0042 foundation / ADR-0044 display policy. |
| **D-7** | **GAP (dependency)** | Q19: the migration service is a **licensed** capability with a Recovery/Backup Point stage. | No license foundation in code: ADR-0030 is **Proposed**, enforcement OFF, no `license` schema/module in `backend/`; OQ-45 (expiry behaviour) unresolved. Backup/restore: no committed RPO/RTO (OQ-52), controlled-restore principle only (OQ-53). | ADR-0035 §3 records that the license gate **exists as a decision** but **cannot be implemented** before ADR-0030/OQ-45 resolve, and that restore/backup must never be license-blocked. | Resolve ADR-0030/OQ-45 (licensing) and OQ-52/OQ-53 (backup/restore) before the migration service task; the service also needs ADR-0033 §3 (code history) and OQ-62/OQ-63 (pin divergence) handled in preflight. |
| **D-8** | **GOVERNANCE (status) — RESOLVED 2026-09-25 by the PR #44 merge** | Prompt §13: "Task 17B remains accepted as previously established." | At the reconciliation baseline `main` (`b10e007`) recorded Task 17B as **READY FOR REVIEW — NOT ACCEPTED** (`task-index.md` header/§2/§4, `STATE.md` §7/§8/§10, `docs/modules.md` Accounting line, `task-17b-implementation-report.md` banner), with the acceptance sitting in **PR #44** (`arena/01a0d76b-vardena`), then **OPEN — not merged**; `STATE.md` §1 (unmerged branches and PR descriptions are not official history) and §6 (only the Owner/Reviewer records `ACCEPTED`) therefore forbade restating it as accepted. **Now resolved:** PR #44 was **MERGED into `main` in `2892189`** (2026-09-25T09:35:22Z), so `main` records Task 17B as **ACCEPTED (2026-09-25)** by the Repository Owner/Reviewer — PR #43 reviewed before merge and merged in `b10e007` (merged head `1ec996e`, implementation `9ee46f7`, CI run `36074225037` green) — with `docs/tasks/task-17/task-17b-acceptance-record.md` as the formal record. That acceptance is **bounded**: it closes no Open Question (**OQ-25/OQ-43 remain OPEN**), does not complete Task 17, promotes no ADR and authorizes **no** future Task 17 slice, Task 17C included. | Task 17C promoted nothing while the discrepancy was open and promotes nothing now: the synchronization merge preserves `main`'s Task 17B **ACCEPTED** text **verbatim** (`STATE.md` §7/§8/§10, `task-index.md` header/§2/§4/§9, `docs/modules.md`) while keeping Task 17C itself **READY FOR REVIEW — NOT ACCEPTED**. Nothing else about Task 17B is touched (prompt §11: "changing Task 17B implementation" is prohibited). | Nothing further — the Owner merged PR #44, which is what this row recommended. The predicted textual conflict between PR #44 and PR #45 did materialize (`STATE.md` §7; `task-index.md` header/§2/§9) and was resolved conservatively on `arena/01a0d7c4-vardena` by merging `main` @ `2892189` into the branch — no rebase, no force-push (AG-04) — keeping both sides' valid content (`STATE.md` §10 BOOT-R-12; `task-index.md` §9 synchronization row). |
| **D-9** | **PRECISION (no conflict)** | Q20: changing the number of levels is not a current capability; no feature/migration/UI for it. | Contract §9.1: `max_depth` is configuration; §9.4: changing depth after accounts exist does **not** rewrite accounts — it applies to newly created accounts, existing accounts stay pinned. | ADR-0035 §8 records the exclusion **and** the precision: creating a new version with a different `max_depth` for **new** accounts is ordinary configuration (unchanged), while migrating **existing** accounts to a different level count is excluded and unauthorized. | Nothing now. A future level-count capability needs its own Owner decision + ADR (Q20: the architecture must not unnecessarily prevent that analysis — version pinning + code history keep it possible). |
| **D-10** | **GAP (partial implementation)** | Q12/Q13: Final/posted documents follow immutable correction/reversal semantics. | Only `reversal` is implemented (`ACCOUNTING_CORRECTION_KINDS = ['reversal']`, Task 15); contract §15.4's `correction`, `replacement` and `adjustment` mechanisms are contract-only. Correction windows/period dating remain OQ-27; `reopen` is refused for accounting documents (§15.4 rule 5). | Recorded as CONFIRMED for the immutability/deletion half (AC-I-05/06/15, `deletablePhases`), with the unimplemented mechanisms and OQ-27 policy listed in §6. | A corrections task (per `task-index.md` §7) for correction/replacement/adjustment + OQ-27 windows; no change to Final-document immutability. |
| **D-11** | **GAP (partial implementation)** | Q15: Account Statement "should support drill-down to underlying source documents". | The statement returns `voucherId`, `voucherLineId`, `voucherNumber`, `lineNo` and the `source*` document snapshot per row (Task 17B report §3), so the drill-down **keys** exist; no drill-down resource/endpoint or navigation contract exists. | Recorded as OWNER DECIDED with drill-down **data** confirmed and the surface itself listed as an open implementation detail (§6 O-7). | A future presentation/reporting task may add navigation using the existing ids — read-only, permission-gated, no second calculation (Q15/Q16). |
| **D-12** | **GAP** | Q6/Q7: tree + floating detail accounts and a configurable dimension model must be supported. | Contract-only (AC-D-11…AC-D-15); no `accounting_detail_dimensions` / `_groups` / `_items` / line-assignment table exists; OQ-41 open (count, per-dimension defaults, master-data binding, item governance, area applicability). | ADR-0037 §6/§7 confirms the decided mechanism and the EAV/JSONB prohibition; `task-index.md` §4 keeps them as candidates blocked by OQ-41. | A dimensions task after OQ-41 answers, with AC-I-18 validation, typed assignment table, GROUP BY reporting (§10.7) and denial-path tests. |
| **D-13** | **GAP** | Q10/Q22: independent Journal Book and General Ledger reports; Iran Legal Profile. | No **statutory/legal** report definition, no Reporting module (`task-17b-owner-decision-pack.md` E-25), no legal-profile model/module (`reporting-sample-audit.md` item 19); the **Journal Book** is unimplemented. Since **Task 18 (ACCEPTED 2026-09-25, PR #46 merged in `e774a1c`)** accounting-owned **General Ledger / Trial Balance** read surfaces exist — explicitly **not** legal books (`docs/tasks/task-18/task-18-acceptance-record.md` §7). Task 17 remains FORMALIZED / IMPLEMENTATION BLOCKED (OQ-25/OQ-43). | ADR-0036 §1/§3 fixes the architecture and the independence rule; **no** statutory layout, column set or legal fact is invented (OQ-43, LEGAL VALIDATION REQUIRED). | Legal Profile + legal books tasks after OQ-43 validation with authoritative current sources, through `task-index.md` §7 and ADR-0009/`reporting-strategy.md`. |

---

## 6. Implementation-level questions that stay open

These are **not** new OQ ids and **not** decisions; each falls under an existing Open
Question, which stays OPEN in [`docs/open-questions.md`](../open-questions.md).

| Id | Open implementation detail | Governing OQ / ADR |
|---|---|---|
| **O-1** | May a superseded historical code ever be re-issued to another account, and how does code history coexist with `uq_accounts_organization_id_code` and the never-reuse rule (§8.6/AC-I-11)? | OQ-25, OQ-36; ADR-0033 §3/§7 |
| **O-2** | Which concrete control roles exist, which become mandatory when an operation consumes them, and what is the base chart's approved content (codes, Persian titles, level shape, optional initial mappings)? The Base Chart artifact/adoption model and control-role sequencing/shape are decided by OD-20-1…OD-20-3. **Task 21 (READY FOR REVIEW — NOT ACCEPTED) narrows the governance** — Base Chart content **model/field set**, adoption (copy, version-pinned, no silent mutation), mandatory-account **semantics**, and the consumer-first control-role **governance contract** (catalog still OPEN, no roles introduced) — but the Base Chart content **values** and the concrete role catalog/mandatory set remain open. | OQ-25; ADR-0037 §3/§4/§5; §12 OD-20-1…OD-20-3; `docs/tasks/task-21/task-21-governance-baseline.md` |
| **O-3** | Per-level posting-default policy content (which leaf levels a given business posts to by default) under the OD-20-5 invariant. Non-leaf POSTING is rejected unless a future explicit decision reopens ADR-0034. **Task 21 (proposed governance) fixes the role of the defaults:** `is_postable` is an explicit Base Chart property seeded from configuration `default_is_postable` and hard-bounded by leaf-only; the per-business content of which leaf levels are used remains open. | OQ-25; ADR-0034; §12 OD-20-5; `docs/tasks/task-21/task-21-governance-baseline.md` |
| **O-4** | Whether deactivation is blocked while a balance is non-zero or activity exists in an open year, and the exact "blocking references" list for Q21 deletion. **Task 21 (proposed governance)** adds that a *mandatory* Base Chart account and an *in-use role-backed* account cannot be deactivated; the general deactivation/deletion policy stays with OQ-36. | OQ-25, OQ-36; ADR-0033 §7; `docs/tasks/task-21/task-21-governance-baseline.md` |
| **O-5** | Dimension count, per-dimension requirement defaults, master-data binding rules, item governance and area applicability. OD-20-6 decides only the initial line-level analytical-assignment boundary and read-layer aggregation direction. | OQ-41; ADR-0037 §7; §12 OD-20-6 |
| **O-6** | Whether any report needs a free "as of arbitrary date" window (a second opening basis) in addition to the stored year/period axes — Task 17B deliberately excluded date filters for this reason. | OQ-23 (year/opening), Q14; ADR-0036 §6 |
| **O-7** | The drill-down/navigation contract from Account Statement rows to source documents, and which surface (Accounting read source vs future Reporting) owns Account Overview presentations. | OQ-49 (Report Builder depth), ADR-0009; Q15/Q16 |
| **O-8** | Base monetary unit set, scale/precision and Rial↔Toman display rules; Persian-numeral preference and broader localization. The fixed Jalali-first MVP display policy is decided by ADR-0044; the organization IANA-zone contract remains in ADR-0042 and is not an open item here. | OQ-02 (remaining localization), OQ-03; ADR-0036 §4; ADR-0042 |
| **O-9** | Licensing mechanism and expiry behaviour for a licensed capability; backup/recovery point semantics for a migration run. | OQ-45, OQ-52, OQ-53; ADR-0030, ADR-0035 §3 |
| **O-10** | Correction windows, cross-period corrections, uncorrectable documents, and the unimplemented correction/replacement/adjustment mechanisms. | OQ-27; contract §15.4, D-10 |
| **O-11** | Account-pin compatibility (OQ-62) and the LEGACY fallback shape (OQ-63), which a migration preflight must detect and report. | OQ-62, OQ-63; ADR-0035 §2 |
| **O-12** | Every Iranian legal fact: current statutory book layouts and column sets, taxpayer groups, registration/sealing, entry-timing limits, e-book deletion rules, Art. 169, retention windows. **LEGAL VALIDATION REQUIRED** — no closure claimed. | OQ-43; ADR-0036 §2 |

---

## 7. What this consolidation explicitly does **not** do

- No production code, API, DTO, schema, Prisma, migration, seed, permission, report,
  UI, dependency, refactor or performance work (prompt §11). No placeholder code.
- No implementation of the Code Migration Service, Classification, Trial Balance,
  Legal Books, control roles, dimensions, Account Overview or a base chart.
- No Open Question closed, reclassified or reopened: **OQ-25 and OQ-43 remain OPEN**
  (annotated only), as do OQ-02/03/23/27/36/41/45/49/52/53/62/63 and every other row.
- No ADR status promoted and no task status changed: ADR-0031/0032 stay **Proposed**;
  the five new ADRs are **Proposed**; Task 17A stays **ACCEPTED (2026-09-25)**; Task
  17B stays exactly as recorded on `main` — since the PR #44 merge (`2892189`) that
  is **ACCEPTED (2026-09-25)**, bounded to the D1–D7 slice of PR #43 — and Task 17C
  neither restates, weakens, extends nor relies on that acceptance to authorize any
  future slice (§5 D-8, resolved); Task 17 stays **FORMALIZED /
  IMPLEMENTATION BLOCKED BY OPEN QUESTIONS** and is **not complete**; Tasks 12 (P1
  follow-up), 13, 14 and 16 are untouched.
- No legal, tax, statutory or compliance claim of any kind (Q22 closing clause;
  OQ-43).
- No new OQ id invented, and no contract decision silently edited: the domain contract
  gains only the non-normative §31 pointer addendum.

## 8. Synchronization performed by Task 17C

| File | Change |
|---|---|
| `docs/adr/0033…0037-*.md` | **Created** (Proposed). |
| `docs/adr/README.md` | Index rows for ADR-0033…0037. |
| `docs/accounting/owner-decision-baseline.md` | **Created** — this register. |
| `docs/tasks/task-17/task-17c-prompt.md` | **Created** — the received prompt, verbatim. |
| `docs/accounting/domain-contract.md` | **§31 addendum** (pointer only): Owner decisions recorded, which sections they refine, and the statement that no contract decision, status or behaviour is changed by this task. |
| `docs/open-questions.md` | **OQ-25** and **OQ-43** annotated with a Task 17C note separating OWNER DECIDED / IMPLEMENTATION DETAIL OPEN / LEGAL VALIDATION REQUIRED. Both stay in the Open table. |
| `docs/accounting/task-index.md` | §2 row for Task 17C; §4 candidate rows for the newly named capabilities (code structure migration, code history/historical resolution, POSTING/AGGREGATION role, base structure + control roles, dimensions/floating detail note, Legal Profile); §5 OQ-25/OQ-43 rows annotated; §9 dated history row. |
| `STATE.md` | §3 ADR inventory rows 0033–0037; §7 Task History row 17C (row 17B is `main`'s **ACCEPTED** text from PR #44, preserved verbatim); §8 Task 17C paragraph (`main`'s Task 17B ACCEPTED paragraph untouched); §9 OQ-25/OQ-43 row annotated; §10 dated consolidation paragraph, BOOT-R-11 and BOOT-R-12 (**RESOLVED** by the PR #44 merge). |

## 9. Verification performed (documentation-only)

| Check | Command / method | Result |
|---|---|---|
| Whitespace errors | `git diff --check` (staged + unstaged, against base `b10e007`) | clean |
| **Synchronization merge** (after the PR #44 merge) | `git merge --no-ff origin/main` (`2892189`) into `arena/01a0d7c4-vardena`; conflicts in `STATE.md` §7 and `docs/accounting/task-index.md` header/§2/§9 resolved hunk-by-hunk — never a global `ours`/`theirs` | resolved; no conflict marker remains; `git diff --check` clean |
| `main`'s governance text preserved | the Task 17B **ACCEPTED** lines of `2892189:STATE.md` §7 and of `2892189:docs/accounting/task-index.md` (header, §2 row, §9 acceptance row) compared byte-for-byte with the merged files | byte-identical — Task 17B does not regress to READY FOR REVIEW |
| No production change between baselines | `git diff --name-only b10e007…2892189` | 5 documentation files only (`STATE.md`, `docs/accounting/task-index.md`, `docs/modules.md`, `docs/tasks/task-17/task-17b-implementation-report.md`, `docs/tasks/task-17/task-17b-acceptance-record.md`) |
| Diff scope | `git diff --name-only b10e007…HEAD` | only `.md` files under `docs/` and `STATE.md` |
| No production/schema/test/dependency change | path audit of the diff for `backend/`, `prisma/`, `*.ts`, `*.sql`, `package*.json`, `.github/`, `docker-compose.yml`, `.env.example`, `frontend/` | zero matches |
| Referenced paths exist | every backticked repository path and relative link in the new/edited files tested on the filesystem | all present |
| Referenced ids exist | AC-D-/AC-I- ids against contract §25/§26; OQ ids against `docs/open-questions.md`; ADR ids against `docs/adr/`; AR-/AG- ids against `.vardena/*` | all resolve |
| Markdown table integrity | column count per row for every edited/created table | consistent |
| ADR format | `docs/adr/README.md` template (Status/Date/Context/Decision/Consequences) and numbering (sequential after 0032; **0027 intentionally not filled** — `STATE.md` §3) | conforms |
| Statuses unchanged | grep for status strings of Tasks 12/13/14/16/17/17A/17B and ADR-0031/0032 in edited files | unchanged |

## 10. Version record

- 2026-09-25 — Created by **Task 17C — Accounting Decision Consolidation**
  (DOCUMENTATION ONLY) on `arena/01a0d7c4-vardena` (base `b10e007`, merge of PR #43).
  Status **READY FOR REVIEW — NOT ACCEPTED**; no self-acceptance.
- 2026-09-25 — **Synchronized with `main` after the PR #44 merge** (`2892189`; Task 17B
  **ACCEPTED (2026-09-25)**): `main` was merged into the PR #45 branch — no rebase, no
  force-push (AG-04). Conflicts (`STATE.md` §7; `docs/accounting/task-index.md`
  header/§2/§9) were resolved to keep **both** sides' valid content: `main`'s Task 17B
  acceptance verbatim **and** the complete Task 17C register. Stale "17B READY FOR
  REVIEW / PR #44 open" statements were updated to the post-merge facts — §1
  synchronization note, §5 **D-8 RESOLVED**, §7 status bullet, §8 `STATE.md` row, §9
  synchronization checks, plus one clarifying clause in ADR-0036's Context (Task 17B
  recorded as ACCEPTED, with neither read surface presented as a legal one).
  **Q1–Q22, invariants I-1…I-3, D-1…D-13 and O-1…O-12 are unchanged**;
  **OQ-25 and OQ-43 remain OPEN** (an Owner decision is not an implemented capability);
  no ADR or task status was promoted; no production code, schema, migration, test, API,
  permission or dependency was touched. Task 17C remains **READY FOR REVIEW — NOT
  ACCEPTED**; Task 17 remains **FORMALIZED / IMPLEMENTATION BLOCKED** and **NOT
  complete**.
- 2026-09-25 — **Task 17C governance review (documentation correction only).** Reviewed
  against `main` @ `40a3e0a` (PR #47). Three baseline statements had been overtaken by the
  separately authorized and accepted **Task 18** read foundation and were corrected in
  place — the §1 permission-code count (**36 → 38**), the **Q10** row and the **D-13** row
  (a General Ledger read surface exists; the Journal Book, the legal books and the Legal
  Profile do not); the matching read-surface clause in ADR-0036's Context was aligned, one
  imprecise clause in ADR-0033 §1 that listed the non-existent `dimension assignments`
  among the repository's existing id-resolving references was tightened, and the
  `task-index.md` §4 candidate row was qualified. **No Owner decision (Q1–Q22), invariant
  (I-1…I-3), discrepancy classification (D-1…D-13), open item (O-1…O-12), ADR status, OQ
  status or task status was changed**: OQ-25/OQ-43 remain **OPEN**, every ADR stays
  **Proposed**, Task 17 stays blocked and Task 17C stays **READY FOR REVIEW — NOT
  ACCEPTED** until the separate Acceptance Sync.
- 2026-09-25 — **Task 17C ACCEPTED (documentation-only governance acceptance — the
  separate Acceptance Sync).** Per the Owner's explicit Acceptance-Sync authorization,
  Task 17C is recorded **ACCEPTED (2026-09-25)** and the status header of this register
  was updated accordingly (acceptance record:
  [`docs/tasks/task-17/task-17c-acceptance-record.md`](../tasks/task-17/task-17c-acceptance-record.md)).
  The accepted decision set is preserved **exactly as recorded**: **Q1–Q22, invariants
  I-1…I-3, discrepancies D-1…D-13 (D-8 RESOLVED by the PR #44 merge in `2892189`) and
  open items O-1…O-12 — nothing in this register was reinterpreted, expanded, closed or
  altered**. **OQ-25 and OQ-43 remain OPEN** — acceptance of Task 17C resolves neither.
  **ADR-0033…0037 remain Proposed** — under the repository ADR convention, task
  acceptance does not promote an ADR (no self-acceptance); each ADR remains pending its
  separate adoption/implementation gate, and the ADR subjects remain future/controlled
  concepts, not implemented production capabilities. Task 17 remains **FORMALIZED /
  IMPLEMENTATION BLOCKED BY OPEN QUESTIONS** and **NOT complete**. No production code,
  schema, migration, test, API, permission or dependency was touched by the
  synchronization.
- 2026-09-25 — **Task 19 Owner Decision Sync (documentation only).** Appended
  **ODR-1 / ODR-2 / ODR-3** (all **DECIDED**) as §11 of this register. Q1–Q22 and
  I-1…I-3 are unchanged. No production implementation.
- 2026-09-26 — **Task 20 Owner Decision Resolution (documentation only).** Appended
  **OD-20-1…OD-20-6** (all **DECIDED**) as §12 of this register, updated Q2/Q4/Q5/Q7/Q18,
  D-1/D-2/D-3/D-5 and open items O-2/O-3/O-5 to reference those decisions, and kept
  OQ-25/OQ-41/OQ-36 and all implementation work deferred. **D-1 is resolved** by
  OD-20-5 (`POSTING = leaf-only`; `AGGREGATION = reporting/read-time roll-up`).
  **Task 19 ODR-1/ODR-2/ODR-3 are unchanged.** No production code, schema,
  migration, API, DTO, permission, frontend or test changed.

---

## 11. ODR-1…ODR-3 — Task 19 (DECIDED)

Canonical Owner Decision Register entries for Task 19. These are **decisions**,
not proposals. They do **not** implement production behavior.

Identifier mapping vs
[`accounting-chart-configuration-investigation.md`](../tasks/task-19/accounting-chart-configuration-investigation.md)
§21: Owner **ODR-1** = investigation ODR-3 (dual pin); Owner **ODR-2** =
investigation ODR-2 (tree ownership); Owner **ODR-3** = investigation ODR-9
(organization authorization). Investigation labels are not competing decisions.

### ODR-1 — Dual Configuration Pin / Explicit Coherence Rule

| Field | Content |
|---|---|
| **Question** | When `coding_structure_version_id` and `accounting_configuration_id` diverge, which pin defines Account code-shape validation, and may the system silently fall back? |
| **Owner decision** | **C — Explicit Coherence Rule.** The two references must remain explicitly coherent. If they diverge in a way that violates the defined configuration relationship, the operation **MUST be rejected**. No silent selection of one pin. |
| **Status** | **DECIDED** |
| **Decision rationale** | Two independent sources of truth for the same code-shape would make validation non-deterministic. |
| **Architectural implications** | Do **not** invent a second configuration architecture. Inspect the existing model (Task 10.3 coding structure + Task 11 accounting configuration). Preserve existing concepts. Exact canonical resolution/coherence mechanism is **derived from the repository**, not designed here. |
| **Security implications** | None beyond integrity of validation (fail closed on incoherence). |
| **Explicit non-goals** | Second configuration system; duplicated coding-structure state; silent pin choice; rewriting historical ledger data; generic configuration engine; EAV/giant JSONB; unrelated refactor. |
| **Implementation consequences** | Task 19 Slice 1 — Configuration Coherence Guard. **Implementation detail — requires Task 19 implementation design** for the exact comparison algorithm. |
| **Related OQ(s)** | **OQ-62** remains **OPEN** (algorithm/repair of existing divergent rows); **OQ-63** remains **OPEN** (legacy fallback shape). Architectural “do not silently pick a winner” is decided. |
| **Factual repository state** | Accounting configuration owns `accounting_configurations` / `_levels` (ADR-0028). Coding structure owns `coding_structure_versions` / `_levels` (Task 10.3). Both pins are persisted NOT NULL on `accounts`. Today **only configuration levels** feed `checkAccountCode`; coding-structure digit lengths are not consulted. Divergence is possible (Task 11 rehearsal). **No coherence invariant is enforced.** Task 11 D2 text (“coding_structure_version_id remains the code-shape pin”) is **not** true of the live validation path — recorded, not silently treated as already fixed. |

### ODR-2 — Chart Tree Read Ownership / Accounting-owned

| Field | Content |
|---|---|
| **Question** | Which bounded context owns the canonical Chart of Accounts / Chart Tree read surface? |
| **Owner decision** | **A — Accounting-owned.** Accounting owns the canonical Account master and hierarchy. A read/query layer may be used internally; Reporting and UI are **consumers**. |
| **Status** | **DECIDED** |
| **Decision rationale** | The Chart Tree must not become a duplicate Account master inside Reporting. |
| **Architectural implications** | Ownership: Account master, identity, hierarchy, domain invariants stay in Accounting. Consumption: Accounting UI, Reporting, future Legal Adapter/Profile, other authorized readers. Exact API shape is derived during implementation. |
| **Security implications** | Tree reads remain organization-scoped; ODR-3 applies. |
| **Explicit non-goals** | Second canonical Account model in Reporting; transferring Account ownership to Reporting; Reporting as source of truth for hierarchy; introducing a Reporting module merely to provide the Tree; coupling UI directly to Accounting tables. |
| **Implementation consequences** | Task 19 Slice 2 — read-only Accounting-owned Chart Tree. Must preserve org scope, Account identity, hierarchy, code, name, level, active/inactive, posting/aggregation semantics **where already authoritative**, deterministic ordering. |
| **Related OQ(s)** | Does **not** close **OQ-25** (classification/content) or **OQ-43**. |
| **Factual repository state** | Existing APIs: `GET /api/v1/accounting/accounts` (list) and get-by-id. **No complete Chart Tree API exists.** Task 18 GL/TB/statement are ledger reads, not a chart tree. |

### ODR-3 — Organization Authorization Boundary / Principal-bound Organization

| Field | Content |
|---|---|
| **Question** | May a caller access another Organization by changing `organizationId` if they hold a valid Accounting permission? |
| **Owner decision** | **A — Principal-bound Organization Authorization.** Organization authorization is bound to the authenticated Principal's authorized organization context. Permission alone is insufficient. Multi-org access only where repository-supported membership/access explicitly authorizes that Organization. |
| **Status** | **DECIDED** (target invariant). **Not implemented.** |
| **Decision rationale** | Organization authorization is a tenant-isolation boundary. |
| **Architectural implications** | Chain: Principal → Authorized Organization Membership/Context → Requested Organization → Module Permission → Resource Access. |
| **Security implications** | The following **MUST NOT** be possible: Principal + valid Accounting permission + arbitrary `organizationId` → cross-organization data access. |
| **Explicit non-goals** | Trusting arbitrary caller-supplied `organizationId`; wildcard organization access; bypassing existing RBAC; duplicating organization membership data; a new authorization subsystem without repository evidence; weakening 404/not-found tenant isolation. |
| **Implementation consequences** | Task 19 Slice 3. Do **not** claim this is implemented because it is decided. |
| **Related OQ(s)** | **OQ-01** / **OQ-22** remain **OPEN** (deployment tenancy / books). ODR-3 decides the **authorization invariant**, not the full product tenancy model. |
| **Factual repository state** | Principal: Identity session (`AuthGuard`). Permissions: RBAC `AuthorizationGuard` / `AuthorizationService` (no wildcards). **Principal→Organization membership is not modeled** in `users`/`rbac` schemas. Organization-scoped requests take caller-supplied `organizationId`. Guards: `requireUsableOrganization` / `assertOrganizationInScope` enforce the **optional ADR-0025 deployment pin**, not per-principal membership. Accounting reads use **404** for foreign/unknown keys. **Current gap:** with the pin unset, permission + arbitrary `organizationId` can access another org's chart (investigation S-1). |

**Current vs target vs future (ODR-3):**

| Layer | Current implementation | Approved target (ODR-3) | Future work |
|---|---|---|---|
| Isolation | Structural `organization_id` + optional deployment pin | Principal-bound membership/context **then** permission | Task 19 Slice 3 |
| Cross-org via `organizationId` | Possible when pin unset | Forbidden | Tests required |
| 404 posture | Accounting reads 404 foreign keys | Preserve | Do not leak existence |

---

## 12. OD-20-1…OD-20-6 — Task 20 Owner Decisions (DECIDED)

Canonical Owner Decision Register entries for Task 20. These are **decisions**, not
proposals. They do **not** implement production behavior, do not close OQ-25/OQ-41
as a whole, and do not reopen Task 19.

### OD-20-1 — Base Accounting Chart

| Field | Content |
|---|---|
| **Original question** | What is the Base Chart artifact, who owns it, and what does organization adoption mean? |
| **Owner decision** | Vardena will support a **versioned Base Accounting Chart template stored as an Accounting-owned database/product asset**, with an explicit adoption operation into an organization. |
| **Status** | **DECIDED** |
| **Architectural implications** | The Base Chart is a reusable product/template asset. Adoption creates organization-owned Account identities. Template account identities MUST NOT become ledger references for an organization. Adopted accounts receive their own organization-scoped `Account.id`; future Base Chart versions may exist independently from already-adopted charts. |
| **Content boundary** | The actual list of accounts, codes, Persian titles, account natures, postability and template content is **not** decided and must be approved explicitly by accounting/domain experts. |
| **Implementation status** | **Deferred / not implemented.** No template tables, migrations, adoption service, API, seed data or account content are authorized by Task 20. |
| **Task 19 dependency** | Adoption/configuration must produce an ODR-1 coherent `coding_structure_version` + `accounting_configuration` pair and pass the ODR-3 organization authorization chokepoint. |

### OD-20-2 — Control Roles

| Field | Content |
|---|---|
| **Original question** | Should Vardena create a broad control-role foundation/catalog before any consumer exists? |
| **Owner decision** | Use a **Consumer-First** strategy. Vardena MUST NOT invent or prematurely create a large generic control-role catalog. |
| **Status** | **DECIDED** |
| **Architectural implications** | A role is introduced only when a concrete approved consumer requires that semantic role (for example Inventory → Accounting integration, reconciliation, reporting or settlement). The existence and semantics of each role must be justified by its real consumer. |
| **Implementation status** | **Deferred / not implemented.** No control-role table, enum, seed catalog, migration, API or service is authorized by Task 20. |
| **Open content** | OQ-25 still owns the concrete role catalog and mandatory set. |

### OD-20-3 — Control Role Artifact Shape

| Field | Content |
|---|---|
| **Original question** | Is role association a nullable account column or an independent effective-dated mapping? |
| **Owner decision** | The authoritative association between an Account and a Control Role will be an **independent effective-dated mapping**, not a nullable column directly on Account. |
| **Status** | **DECIDED** |
| **Architectural implications** | Future design must support historical interpretation, effective dating, reassignment, auditability, preservation of Account identity and separation between account identity and semantic control classification. |
| **Rejected artifact** | Do **not** model the final Control Role association as `Account.control_role` as the primary artifact. |
| **Implementation status** | **Deferred / not implemented.** Exact physical schema belongs to the future consumer-driven task. |

### OD-20-4 — Account Code History

| Field | Content |
|---|---|
| **Original question** | Are account identity and account code distinct, when can code change, and should a history table be created before a producer exists? |
| **Owner decision** | `Account.id` remains permanent accounting identity. `Account.code` is the business-facing accounting address/code. A controlled **pre-use** code change is permitted; once an Account has accounting postings/ledger activity, its code is immutable. |
| **Status** | **DECIDED** |
| **Architectural implications** | Future permitted code transitions must be auditable and historically reconstructable, but the history mechanism is designed together with the real code-change producer. |
| **Rejected artifact** | Do **not** introduce speculative history-only migrations, unused history tables, fake seed history or automatic history records without a real code-change operation. |
| **Implementation status** | **Deferred / not implemented.** No code-change producer or history table is authorized by Task 20. |
| **Open content** | OQ-25/OQ-36 still own code reuse and uniqueness/history policy details. |

### OD-20-5 — POSTING vs AGGREGATION

| Field | Content |
|---|---|
| **Original question** | Does Vardena support non-leaf posting, or is posting leaf-only with derived parent aggregation? |
| **Owner decision** | **POSTING = leaf-only. AGGREGATION = reporting/read-time roll-up.** |
| **Status** | **DECIDED — D-1 RESOLVED** |
| **Architectural implications** | Non-leaf accounts such as `کل` and `گروه` are aggregation/reporting nodes and are not direct posting targets. The same underlying accounting movement MUST NOT be independently posted to leaf, group and general levels. Parent values may appear in reports only as derived roll-up views over leaf postings. |
| **ADR/read-model consequence** | Existing `postable ⇒ leaf` remains authoritative. ADR-0034 and the Task 18 Trial Balance / General Ledger roll-up model are valid under this invariant. Do not implement own-vs-descendant measures or double-counting workarounds. |
| **Future exception** | If a future approved business requirement needs non-leaf posting, it must become a new explicit architecture decision and reopen/supersede the relevant ADR through a future task. |
| **Implementation status** | No implementation required by Task 20. |

### OD-20-6 — Dimensions

| Field | Content |
|---|---|
| **Original question** | Are dimensions ledger-entry identity, ledger columns/JSONB, document-line assignments, or a separate projection architecture? |
| **Owner decision** | Dimensions will initially be modeled as **transaction-line-level analytical assignments**, with aggregation performed through the Accounting/read layer when a concrete reporting consumer requires it. |
| **Status** | **DECIDED** |
| **Architectural implications** | Dimensions are analytical classification, not `LedgerEntry` identity. Do not widen `LedgerEntry` with arbitrary dimension columns as the primary architecture. Do not create a generic `everything JSONB` payload. Do not introduce a separate projection architecture unless a real reporting/consumer requirement justifies it. |
| **Implementation status** | **Deferred / not implemented.** No dimension tables, catalogs, migrations, APIs, UI, report endpoints or aggregation projections are authorized by Task 20. |
| **Open content** | OQ-41 remains OPEN for dimension count, requirement defaults, master-data binding, governance and area applicability; OQ-22/OQ-55 remain relevant for branch/department questions. |

**Task 19 integrity:** ODR-1 Explicit Configuration Coherence, ODR-2 Accounting-owned
Chart Tree and ODR-3 Principal-bound Organization Authorization are not reopened,
rewritten, weakened or replaced by Task 20.

**Formal acceptance synchronization (2026-09-26):** **Task 20 is ACCEPTED** as
documentation-only decision-resolution work under the Owner-authorized Formal
Acceptance Sync. This status records, but does not alter, OD-20-1…OD-20-6. No
production capability was implemented; OQ-25/OQ-41 remain OPEN where applicable,
unrelated Open Questions remain OPEN, and ADR-0033…0037 remain Proposed. See
[`task-20-acceptance-record.md`](../tasks/task-20/task-20-acceptance-record.md).
