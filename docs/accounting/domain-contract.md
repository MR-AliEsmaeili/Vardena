# Vardena — Accounting Domain Contract

Status: **Proposed** (domain contract — nothing is implemented) · Date: 2026-09-14 ·
Produced by Task 10.1

| | |
|---|---|
| Companion decision | [ADR-0026 — Accounting bounded context](../adr/0026-accounting-bounded-context.md) (Proposed) |
| Refines | [`architecture/domain/accounting-domain-analysis.md`](../architecture/domain/accounting-domain-analysis.md) (options/analysis record — still valid), blueprint §9, D-03/D-11/D-12/D-19 |
| Binds | every future Accounting schema, migration, service, API, report and integration |
| Must not contradict | ADR-0021/0022/0023/0024/0025, AR-07/08/12/13/14/15/16/21/22, `docs/security.md`, `docs/database-strategy.md` |
| Raises / updates | OQ-39 … OQ-43 (new); notes added to OQ-03, OQ-11, OQ-12, OQ-23, OQ-25, OQ-27, OQ-31 |

> **This document authorizes no code.** There is no Accounting Prisma schema, no
> migration, no controller, no service, no report and no frontend behind it. Every
> "shape" below is *conceptual* — the vocabulary, the invariants and the boundaries
> that a later task must respect. Where a decision needs an accountant, a tax
> expert or the product owner, it is **not** made here; it is registered as an OQ.
>
> **Design goal (Task 10.1 §35):** make the Accounting model *difficult to get
> wrong* before making it easy to code. A wrong accounting abstraction contaminates
> Inventory, Sales, Purchasing, Treasury, Reporting, Tax, year closing and Audit.

---

## 0. How to read this contract

Every normative statement carries one of three markers:

| Marker | Meaning | Consequence |
|---|---|---|
| **DECIDED** (`AC-D-nn`) | An architecture/domain decision taken in this task, inside the existing architecture rules and precedents. It is *ours* to make (structure, ownership, boundaries, invariants) — it is not an accounting policy. | Binding on later tasks. Changing it needs a superseding ADR. |
| **EXPERT-GATED** (`OQ-nn`) | A business/accounting/legal/tax policy that must not be invented (AR-31, AG-09). The contract fixes the *shape* so that any answer fits without a rewrite; the *answer* stays open. | Blocked until answered by the named owner. |
| **DEFERRED** | Out of the current boundary on purpose, with the seam recorded so deferral does not become impossibility (e.g. multi-currency, consolidation). | No code, no columns; only a documented seam. |

Identifiers:

- `AC-D-01`… — contract **decisions** (register in §26).
- `AC-I-01`… — contract **invariants** (normative list in §25).
- `OQ-nn` — open questions in [`../open-questions.md`](../open-questions.md).

Conceptual field lists are **not** DDL and **not** Prisma models. Column types,
indexes, constraints and the migration plan belong to the implementing task and
must satisfy `docs/database-strategy.md` (AR-12: `id`/`created_at`/`updated_at`/
`created_by`/`updated_by`, money `numeric(18,2)`, ULID ids, snake_case, one
`.prisma` file per module, closed code-defined lists stored as `TEXT`).

---

## 1. Objective and non-goals

### 1.1 Objective

Establish the **Accounting bounded context** for Vardena: which concepts exist,
who owns each one, how they relate, which rules are invariants and which rules are
policy, and through which boundary other modules may cause accounting effects — so
that Accounting can be implemented incrementally without re-deciding its spine.

### 1.2 Non-goals (explicit)

This contract does **not**:

1. define account codes, account titles, a chart-of-accounts template, control-role
   content or statutory report layouts (EXPERT-GATED: OQ-25, OQ-43);
2. define posting mappings from business events to accounts (EXPERT-GATED:
   `accounting-domain-analysis.md` §4, OQ-24/OQ-25/OQ-30);
3. decide fiscal-year start, period layout, close/reopen/seal policy, or year-end
   entry generation (EXPERT-GATED: OQ-23);
4. decide numbering formats, gap policy or fiscal-year number components
   (EXPERT-GATED: OQ-12);
5. decide currency set, precision or multi-currency behaviour (EXPERT-GATED: OQ-03);
6. implement, prototype or "temporarily" build a posting engine, journal engine,
   trial-balance engine or any accounting screen;
7. create a universal document engine, a general rules/expression engine, an EAV
   model, a JSONB ledger, a second tenant/authentication system, or microservices;
8. change the Prisma schema, add a migration, or touch the frontend.

### 1.3 Scope compliance statement

Task 10.1 is a documentation/domain-analysis task. Expected and actual repository
effect: **Prisma schema unchanged, no migration, no backend code, no frontend
code.** Only `docs/` files are added or updated (§28).

---

## 2. Benchmarking: method, sources, and the three-way distinction

Domain benchmarking was performed before modelling (Task 10.1 §3). Three kinds of
input are kept **separate** throughout this contract, because conflating them is how
amateur accounting models get built:

| Class | What it means here | How it is used |
|---|---|---|
| **A. Established ERP / double-entry patterns** | Concepts that are structural consequences of double-entry bookkeeping and appear across serious ERP accounting designs (chart of accounts, account groups/number ranges, fiscal-year + posting-period control, subledger → ledger transfer, analytical dimensions, document reversal instead of edit). | May be adopted as **DECIDED** shape, because they are architecture, not jurisdiction. |
| **B. Iranian ERP practice** | Concepts that Iranian accounting/ERP products converged on because Iranian businesses ask for them: `گروه / کل / معین / تفصیلی` account levels with user-defined code length per level, `تفصیلی شناور` (floating detail) with detail *groups*, `حوزه مالی` (financial area) distinct from `شعبه` (branch), `سند موقت → دائم` (temporary → final voucher), a review area for vouchers sent by other subsystems, `سند افتتاحیه / اختتامیه / بستن حساب‌های موقت / انتقال دوره`, cost allocation (`تسهیم`), currency/quantity columns on vouchers, electronic voucher attachments. | Adopted as **shape support** (the model must be able to express them), never as a mandated policy. |
| **C. Iranian legal / tax / e-ledger requirements** | Statutory obligations reported by secondary sources: legal books under Article 95 of the Direct Taxes Act and the Commercial Code (`دفتر روزنامه`, `دفتر کل`, `دفتر مشترک`, `دفتر درآمد و هزینه`), book registration before use, journal-entry timing limits, books kept in Persian and in the Iranian currency, prohibition of deleting entries from electronic books, branch operations recorded in the head-office books, Article 169 seasonal transaction reports, the Taxpayer System / electronic invoice law, retention windows. | Treated as **external domain requirements to be validated** with an accountant and current authoritative sources (**OQ-43**). Nothing here is hardcoded as a rule, a column or a constant. The architecture only guarantees that such requirements remain *expressible and auditable* later. |

> **Honesty note on sources.** Class C items below were read on secondary
> (commercial/legal-summary) pages, not on an official gazette. They are recorded as
> *reported* requirements with their sources so an accountant can confirm, correct or
> reject them. **No architectural constant in this contract depends on any of them.**

### 2.1 Class A — established ERP patterns observed

| Pattern | Observed in | Contract use |
|---|---|---|
| Chart of accounts as its own object, assigned to the accounting entity; account master split into a chart-level segment (number, group, nature) and an entity-level segment (currency, posting controls) | SAP FI (chart of accounts + company-code segment) | §8: one account object, organization-scoped, with area applicability; §24 keeps the entity-level seam |
| Account **groups** with number ranges and field/status control | SAP FI account groups | §9: coding structure + reserved ranges, code-defined |
| Fiscal-year **variant** (12 normal periods + special/adjustment periods, shortened years, non-calendar years, year-shift) and a separate **posting-period variant** opened/closed per entity and account type | SAP OB29/OB52 | §6/§7: fiscal year + period rows with explicit dates and status; multiple simultaneously open periods supported; adjustment-period vocabulary deferred (OQ-23) |
| Subledger documents produce **subledger journal account entries** through per-module **posting profiles**, which are then transferred to the ledger | Dynamics 365 Finance | §16/§20: the source-posting contract; posting rules are Accounting-owned configuration, never source-module code (AR-16) |
| **Account structures** declare which financial dimensions are valid/required per main account; dimensions are typed values, validated at posting; fixed/derived dimension values exist | Dynamics 365 | §10: dimension compatibility per account + per-binding requirement (`required`/`optional`/`forbidden`), validated on the line |
| One **ledger** per legal entity; up to N posting layers for parallel accounting standards | Dynamics 365 | §5: financial area is the ledger-scope analogue inside one organization; parallel posting layers are **DEFERRED** (not needed, seam noted) |
| Reconciliation accounts: subledger (AR/AP/asset) posts are mirrored into a GL control account automatically | SAP FI | §10/§12: control **roles** (D-12) referenced by posting rules; detail dimensions carry the counterparty |
| Reversal instead of edit; document change rules; balances carried forward by an explicit periodic program | SAP FB08/F.16/OB32 | §15: Final is immutable; correction = counter-document; §6: year transition is an explicit operation |
| Immutability of posted ledger lines; corrections are counter-records | AR-13, `database-strategy.md` §7 (already binding in this repo) | §15, §25 |

### 2.2 Class B — Iranian ERP practice observed

| Concept | Reported shape | Contract use |
|---|---|---|
| Account coding as a tree with user-defined level titles and **code length per level** (up to 8 levels reported); codes generated automatically or entered manually | FaraPayam integrated ERP; System Group coding guide; several coding articles (2–4 digits per level typical) | §9: configurable coding structure (levels, digit lengths, separators as display-only, max depth), versioned and pinned per account |
| Four **floating details** (`تفصیلی شناور`), each with its own tree (up to 5 levels reported), grouped by **detail groups** (`گروه تفصیلی`); the last layer of the account tree at any level can be linked to one or more detail groups; each detail item declares the **financial areas** where it is accessible | FaraPayam integrated ERP | §10/§11: dimensions are organization-configured (count not hardcoded to four), items are typed rows with area applicability, accounts attach via dimension groups |
| **Financial area** (`حوزه مالی`) and **branch** (`شعبه`) as *separate* subsystems, plus aggregation/consolidation (`تجمیع و تلفیق`) for holdings | FaraPayam product overview | §5: financial area ≠ branch ≠ organization; consolidation DEFERRED |
| Voucher (`سند حسابداری`) space with currency, quantity and reference-number columns; automatic balancing; voucher copy/templates (`سند الگو`); account/detail pickers as list, tree or last level; electronic attachment archive | FaraPayam | §12: reference numbers = source reference + document relations (ADR-0023); currency/quantity = reserved seams (§24.1, §12.6); templates/attachments DEFERRED |
| A **pre-draft area** (`پیش نویس اسناد`) where vouchers sent from other subsystems are reviewed: approved → enters the voucher list; rejected → returned to the source subsystem | FaraPayam | §17: posting Mode B is this pattern, expressed with the existing Document Foundation (`draft_required` + entry states) and Workflow Foundation approval — no new mechanism |
| Voucher lifecycle `موقت → دائم` (temporary → final), review before finalization, approval stages, numbering, making documents final (`قطعی کردن`) | Sepidar/Rahkaran course outlines and tutorials | §15: reuse the Foundation's `draft`/`temporary`/`final` vocabulary verbatim (ADR-0023, Task 8 §7) |
| Period-end / year-end operations: close temporary accounts (`بستن حساب‌های موقت`, `خلاصه سود و زیان`), closing document (`سند اختتامیه`), period transfer (`انتقال دوره`), opening document (`سند افتتاحیه`) — manual or mechanized | Rayvarz, Orash, Parmis, FaraPayam | §6.6: year transition is an explicit, permission-gated operation producing ordinary accounting documents; automation is EXPERT-GATED (OQ-23) |
| Fiscal periods of different kinds: normal, Gregorian-aligned, shorter than a year, 16-month; branches sharing the account/center tables; unlimited currencies and daily rates | Rayvarz | §6/§7: non-12-month years must be expressible; contiguity is not enforced, overlap is rejected; §24 multi-currency seam |
| Cost allocation tables and bases (`تسهیم هزینه`), with the allocation voucher generated by the system | FaraPayam | DEFERRED (no allocation engine; it would be a rules engine — §3.3) |
| Coding of the inventory↔accounting interface (account codes per warehouse / item group / receipt-issue type) and of the fixed-asset↔accounting interface | FaraPayam | §20: this *is* the posting-rule configuration, owned by Accounting (AR-16), expert-gated |

### 2.3 Class C — Iranian legal/tax inputs (EXTERNAL REQUIREMENTS → OQ-43)

Reported requirements that an accountant and current authoritative sources must
confirm. Each row states **only** the architectural consequence the contract already
provides, so that a confirmed requirement needs no redesign:

| # | Reported requirement (secondary sources) | Architectural consequence already guaranteed |
|---|---|---|
| C1 | Legal books from a tax viewpoint: journal (`دفتر روزنامه`), general ledger (`دفتر کل`), combined journal+ledger, and an income/expense book for some taxpayer groups; taxpayers are classified into groups with different book duties (Art. 95 Direct Taxes Act + its executive regulation) | Journal = chronological listing of Final documents by `document_date` + number; general ledger = per-account rollup; both are **reporting projections** over the same immutable lines (§19). A taxpayer-group distinction is *report configuration*, not schema. |
| C2 | Books must be registered/sealed before use (Commercial Code arts. 11–12 as summarized), pages/entries must not be missing | Numbering gaps are visible and auditable: the numbering **allocation ledger** (ADR-0023 §3) records every serial handed out; `reuse_policy = never` is the default. Gap *policy* stays OQ-12. |
| C3 | Journal entries must be recorded chronologically and without undue delay (a 15-day delay limit is reported, beyond which book validity is at risk) | The line/header contract keeps **both** the business date (`document_date`) and the system timestamps (`created_at`, `finalized_at`), so any entry-timing rule is measurable and reportable later with no migration (§12.3). |
| C4 | Books must be kept in Persian and in the Iranian currency; entries must not be deleted from electronic books | Persian titles are first-class attributes on accounts/detail items (§8, §10 — display localization itself is OQ-02); Final documents and lines are **never** updated or deleted (§15, AC-I-05/06); base currency is OQ-03. |
| C5 | Branch operations must be recorded in the head-office books; mismatch between books and system data is a rejection cause | Branch is a scope column on the document (§12.4) inside **one** book set; financial area is the book selector (§5). Reports can be produced per branch and in total from the same lines. |
| C6 | Article 169 / 169-مکرر seasonal transaction reports; electronic invoices registered in the Taxpayer System count as the Article 169 registration (Art. 7 of the Terminals & Taxpayer System Law); VAT invoice content requirements | These are **Sales/Treasury/Integration** concerns delivered through the outbox/adapters (ADR-0004, OQ-05, OQ-30). Accounting only needs the source reference and the immutable line detail to reconcile against them (§20.3). |
| C7 | Retention/archival of books and vouchers | Retention is deployment policy (OQ-17); the contract guarantees nothing referenced by history is ever physically deleted (§8.6, §15). |

**Nothing in C1–C7 is implemented, asserted as law, or encoded as a constant.** They
are the reason the contract insists on: immutable Final documents, stored period/year
resolution, business date *and* system timestamps, allocation-ledger numbering, and
typed Persian-capable titles.

### 2.4 Provenance

Class A: SAP FI configuration/transaction references (chart of accounts, account
groups, fiscal-year variant OB29, posting periods OB52, reversal, carry-forward,
reconciliation accounts) — `gauravconsulting.com/post/chart-of-account-in-sap`,
`icacourse.in/blog/sap-fico-transaction-codes`, `pathlock.com/blog/sap-fico-t-codes/`,
`slideshare.net/slideshow/sap-fi-gl/15900511`; Microsoft Dynamics 365 Finance ledger &
subledger and financial-dimension configuration —
`learn.microsoft.com/en-us/dynamics365/finance/general-ledger/ledger-subledger`,
`learn.microsoft.com/en-us/dynamics365/fin-ops-core/dev-itpro/financial/financial-dimension-configuration-integration`.

Class B: FaraPayam integrated-ERP product description (the legacy system Vardena
integrates with — OQ-04) — `farapayam.com/product/yekparche`; FaraPayam product
overview (financial areas + branches + consolidation subsystems) —
`isna.ir/news/98040301797`; System Group / Hamkaran System: Rahkaran general-ledger
course outline and accounting-coding guide —
`education.systemgroup.net/courses/دوره-آموزش-دفتر-کل-راهکاران/`,
`systemgroup.net/knowledge-network/accounting-coding/`,
`systemgroup.net/products/rahkaran/accounting/financial-statement/`; floating-detail
semantics — `momayezit.ir/blog/115`, `sazehhesab.com/accounting/تفضیلی-شناور-چیست`,
`shygunsys.net/kba/حساب‌های-تفصیلی-شناور`, `sarayehesabdar.ir/preferential-account/`,
`hoofer.cloud/حساب-تفصیلی`; coding levels/lengths — `sadgan.com/blog/accounting-coding`,
`bilanmehr.ir/accounting-coding`, `sirafhesab.ir/blog/آموزش/P1231`; period kinds,
closing/opening documents, branches, currencies — `rayvarz.com/en/products/financial-accounting`;
year-close practice — `orash.ir/blog/accounting/financial-accounting/account-types`,
`parmisit.com/item/1394`, `hesabtube.com/sepidar-software-course/season02-episode01`.

Class C: `hamrahyaar.com/books/mavad/177811` (Art. 95 text + history),
`fardadgroup.com/blog/ماده-95-قانون-مالیات-های-مستقیم` (book types + rejection causes),
`sabttehran.com/شیوه-تکمیل-دفاتر-قانونی` (regulation articles, 15-day rule),
`iliyahesab.com/تحریر-دفاتر` (who must keep books), `mohaseban.org/معاملات-فصلی`,
`persianhesab.com/statement-of-quarterly-transactions`,
`chekad.com/other/سامانه-مودیان-مالیاتی`,
`sepidarsystem.com/blog/quarterly-trading-system` (Art. 169, Taxpayer System
equivalence, VAT invoice content). **All Class C items are OQ-43 inputs, not rules.**

---

## 3. Bounded context

### 3.1 What Accounting owns — and what it must never own

| Accounting owns (schema `accounting`, module `accounting`) | Accounting must never own |
|---|---|
| Financial areas (`حوزه مالی`) and area access data | Organization structure: organizations, branches, departments, employees (Organization module — ADR-0020/0021) |
| Fiscal years, accounting periods, their status transitions | Party master data (Organization module — D-02) |
| Coding structure, chart of accounts, accounts, control-role mapping | Stock quantities, movements, balances, valuation quantities (Inventory — ADR-0017/0022) |
| Detail dimensions, dimension groups, detail items (floating details) | Operational document lifecycles (owning business modules) |
| Accounting documents + lines, their lifecycle, corrections | Pricing, discounts, tax computation (Sales/Purchasing/Tax — OQ-30/OQ-34) |
| The **event/payload → accounting document mapping** (posting rules as configuration) | Whether stock may go negative (Inventory policy — ADR-0022 §5) |
| Account/period balance projections for reporting | Numbering *mechanics* (Documents module — ADR-0023); workflow *mechanics* (Workflow module — ADR-0024) |
| Year-transition operations (closing/opening/period transfer) as explicit actions | Authentication, tenancy, principal identity (Identity/Users/RBAC) |
| Its own RBAC permission registry (`Accounting.*`) | Audit *storage* (Audit module — AR-23); Accounting only emits facts |

**Boundary rules that follow (AR-07/08/16, ADR-0005):** Accounting never reads
`inventory.*`, `sales.*`, `organization.*` or `documents.*` tables; other modules
never read or write `accounting.*` tables. Cross-module **reads** go through the
owning module's public application service; cross-module **effects** go through the
posting contract of §16 (events/commands), never through SQL.

### 3.2 The four concept categories

Task 10.1 §5 requires these to be distinguishable. Every concept in the initial
Accounting context is classified here; the classification decides where it lives and
how it may be used.

#### (a) Accounting concepts (owned by Accounting, persisted in `accounting`)

| Concept | Persian | Owner | Status | § |
|---|---|---|---|---|
| Financial Area | حوزه مالی | Accounting | DECIDED shape / EXPERT-GATED multiplicity (OQ-40) | 5 |
| Fiscal Year | سال مالی | Accounting | DECIDED shape / EXPERT-GATED policy (OQ-23) | 6 |
| Accounting Period | دوره مالی | Accounting | DECIDED shape / EXPERT-GATED policy (OQ-23) | 7 |
| Coding Structure (+ level definitions, versioning) | ساختار کدینگ | Accounting | DECIDED / lengths & depth = configuration (OQ-25) | 9 |
| Chart of Accounts | کدینگ حساب‌ها / درخت حساب | Accounting | DECIDED shape / content EXPERT-GATED (OQ-25) | 8 |
| Account (code, title, level, parent, nature, type, postable, active) | حساب (گروه/کل/معین/تفصیلی) | Accounting | DECIDED | 8 |
| Control-role mapping (account ↔ code-defined role) | نگاشت حساب‌ها | Accounting | DECIDED mechanism (D-12) / roles+mapping EXPERT-GATED | 8.7 |
| Detail Dimension | تفصیلی (بخش) | Accounting | DECIDED shape / count & requiredness EXPERT-GATED (OQ-41) | 10 |
| Detail Dimension Group | گروه تفصیلی | Accounting | DECIDED | 10.4 |
| Detail Item (floating detail) | تفصیلی شناور | Accounting | DECIDED shape / semantics EXPERT-GATED (OQ-41) | 11 |
| Accounting Document (header) | سند حسابداری | Accounting | DECIDED | 12 |
| Accounting Document Line | ردیف سند | Accounting | DECIDED | 12.5 |
| Line dimension assignment | تفصیل ردیف | Accounting | DECIDED | 10.6 |
| Debit / Credit amounts | بدهکار / بستانکار | Accounting | DECIDED representation | 13 |
| Finalization / Posting | قطعی کردن سند | Accounting | DECIDED mechanism / policy EXPERT-GATED (OQ-42) | 15, 17 |
| Reversal / Correction / Replacement | ابطال / اصلاح / جایگزینی | Accounting | DECIDED mechanisms / windows EXPERT-GATED (OQ-27) | 15.4 |
| Posting rule (mapping configuration) | کدینگ رابط / قواعد سند | Accounting | DECIDED location / content EXPERT-GATED (OQ-24/25/30) | 20.2 |
| Accounting configuration (switches: `accounting.enabled`, posting modes) | پیکربندی مالی | Accounting | DECIDED (D-19) | 17, 22 |
| System-posting idempotency ledger | — | Accounting | DECIDED (ADR-0022 pattern) | 16.4 |
| Account / period balance projection | مانده حساب | Accounting | DECIDED direction / mechanism deferred | 19.3 |

#### (b) Operational document concepts (owned elsewhere; Accounting references them logically)

Inventory movements & balances, receipts/issues/transfers/adjustments, sales
documents, purchase documents, treasury receipts/payments, cheques, fixed assets,
payroll documents, operational approvals, print templates, document relations and
numbering series. Accounting stores at most a **logical reference**
`(source_module, source_entity_type, source_entity_id, source_operation)` plus, where
useful, a relation row created through the Documents module (ADR-0023 §5). No
cross-module foreign key, ever (AR-07/08, ADR-0024 §2 precedent).

#### (c) Reporting projections (consumed by Reporting, produced by Accounting)

Chart-of-accounts listing, account tree, general ledger (`دفتر کل`), subsidiary
ledger (`دفتر معین`), detail ledger (`دفتر تفصیلی`), account movements, voucher
journal (`دفتر روزنامه`), trial balance and its 4/6/8-column variants, comparative
reports, dimension reports, branch reports, period/year statements. All of them are
**queries over Final document lines + balance projections** — never recomputations
from operational documents (§19).

#### (d) Integration contracts (the only legal doorway in)

The system-posting contract (§16.3), the domain-event vocabulary (§21), the
outbox/adapter boundary for statutory submissions (owned by Sync/Integration, not
Accounting — ADR-0004), and the Inventory→Accounting boundary (§20).

### 3.3 Shapes explicitly rejected (and why)

| Temptation | Verdict | Reason |
|---|---|---|
| One universal `documents` table with an accounting "type" | **Rejected** | ADR-0019/0023 §2 already rejected it; per-type validation, FKs and report shapes cannot live in one table. Accounting documents are typed tables in `accounting`. |
| Generic rules/expression engine for posting rules | **Rejected** | D-23, ADR-0018 §4: bounded configuration + code-defined vocabulary. Posting rules are typed configuration rows interpreted by Accounting code, reviewed by the accountant — never a scripting surface. |
| EAV for accounts, dimensions or line attributes | **Rejected** | Blueprint §17: no constraints, no indexes, reports become pivots. Dimensions are rows in typed tables (§10). |
| JSONB "flexible line" / ledger-in-JSONB | **Rejected** | `configurability-architecture.md` §5.2: never for amounts, quantities, statuses or ledger dimensions. Only descriptive custom fields are eligible for JSONB, and **not** on accounting lines (OQ-28). |
| One physical table per account level (`groups`, `generals`, `subsidiaries`, `details`) | **Rejected** | Depth is configuration (reported up to 8 levels, §2.2); four tables would freeze depth at four and make the tree, code-prefix validation and rollups four-way joins. One adjacency table + level definitions (§8.2). |
| Fixed four detail columns `detail_1_id … detail_4_id` on the line | **Rejected as the contract shape** | Hardcodes N=4 (Task 10.1 §12 forbids it). A typed child table keeps N configurable, uniqueness enforceable and reporting indexable (§10.6). May be revisited *only* as a reporting projection with its own ADR. |
| Signed single-amount lines with a direction flag | **Considered, not chosen** | §13.3 explains: two non-negative columns make the balance invariant and the statutory column layouts direct aggregates and remove a sign-convention error class. |
| Accounting writes triggered by SQL from Inventory/Sales | **Rejected** | AR-16/ADR-0005 and AC-I-13. |
| Second tenant system for financial areas | **Rejected** | §5.7: area access is authorization *data* under the existing RBAC + organization posture (ADR-0021/0025); no second identity/tenancy mechanism. |
| Microservices / separate accounting database | **Rejected** | ADR-0001/0008: one deployable, one database, schema per module. |

---

## 4. Organization scope and the security posture Accounting inherits

**DECIDED (`AC-D-01`).** Accounting adopts the organization security model
established by Task 9.6 (ADR-0021, ADR-0022 §8, ADR-0025) **without modification and
without a second mechanism**:

1. **Organization is the tenant/security boundary.** Every accounting row —
   financial area, fiscal year, period, coding structure, account, dimension, detail
   item, document, line, balance, posting operation — carries `organization_id`
   (`NOT NULL`, FK to `organization.organizations`, `ON DELETE RESTRICT`) from its
   first migration (ADR-0021 §1).
2. **The authenticated principal determines the accessible organizations.** Today
   that binding does not exist: `organizationId` is a caller-supplied parameter and
   the optional `DEPLOYMENT_ORGANIZATION_ID` pin (ADR-0025) confines a
   single-organization deployment. Accounting inherits exactly this posture and adds
   **no organization-level mechanism of its own**; the missing principal→organization
   binding stays OQ-01/OQ-22. (Financial-area access data — §5.5 — is bookkeeping
   scope inside one tenant, not a second tenancy or authentication system: §5.7.)
3. **A client-supplied `organizationId` is never sufficient authorization.** It is
   validated: (a) against the deployment pin by the global
   `DeploymentOrganizationScopeGuard` (registered `APP_GUARD`, so new accounting
   routes are confined automatically — ADR-0025 §3), and (b) inside the application
   service, which re-checks scope independently of the route.
4. **By-ID queries enforce ownership.** Every accounting by-id read/action takes
   `organizationId` and resolves through a `mustFindInOrganization`-style lookup:
   the row must exist **and** belong to the scope. A mismatch answers **404
   `EntityNotFound`, never 403** — cross-organization access must not leak existence
   (ADR-0021 §4, ADR-0022 §8, ADR-0025 §3).
5. **Lists enforce organization scope.** Every list endpoint requires an explicit
   `organizationId`; there is no cross-organization list, no query that omits the
   scope, and every list index leads with the scope column (ADR-0021 §3).
6. **Cross-organization references are rejected as not-found.** A branch, party,
   account, area, year or document from another organization is reported as 404, not
   422: a foreign key proves existence, not same-scope, so the check belongs to the
   service (ADR-0021 §4).
7. **Permissions are checked twice** — route guard (`@RequirePermission`) and
   application service (`AuthorizationService.requireAllPermissions`) — with no
   wildcard, no superuser and no `role === 'admin'` bypass (ADR-0016, OQ-21).
8. **System context** (worker/bootstrap/tests) is the documented exception where
   authorization is the caller's concern (`docs/security.md` §3); system-generated
   postings run there and are still scope-validated (§16).

**Consequence for financial areas:** the same 404 posture applies one level down —
an area, year, period, account or document that exists but is not in the caller's
scope is indistinguishable from one that does not exist (§5.7).

---

## 5. Financial Area (`حوزه مالی`)

### 5.1 What it is

**DECIDED (`AC-D-02`).** A **Financial Area** is an Accounting-owned,
organization-scoped **bookkeeping scope**: the boundary of one set of books. It
selects *which book* an accounting document is written into, and it is the scope for
fiscal years, periods, document numbering and balance projections.

It is **not**:

| Not | Why |
|---|---|
| the Organization | Organization is the tenant/security boundary and the legal-entity candidate (ADR-0021, OQ-22). One organization may need more than one book scope; multi-company remains a separate decision (OQ-31). |
| a Branch | Branch is Organization-owned operational structure and a **scope column** on documents/ledgers (ADR-0020 §1, D-01). Branch answers "where did this happen"; area answers "which book does it belong to". Iranian practice keeps `حوزه مالی` and `شعبه` as separate subsystems (§2.2). |
| a Department | Department is responsibility master data (ADR-0020 §1); whether it doubles as an accounting dimension is expert-gated (OQ-22). |
| a legal entity / company | **DEFERRED.** Two legal entities in one database is OQ-22/OQ-31 and needs its own ADR. A financial area must not be used as a stealth company: no inter-area settlement, no consolidation, no separate statutory identity in this contract. |
| a currency or a posting layer | Currency is OQ-03 (§24.1); parallel accounting layers (Dynamics "posting layers") are DEFERRED. |

`AC-D-02` explicitly refuses the equation `Organization = Financial Area = Branch`
(Task 10.1 §7). The three are independent axes; the contract keeps them separate so
that a customer needing one book for three branches, or three books inside one
organization, is configuration — not a rewrite.

### 5.2 Relationships (cardinalities)

```
Organization 1 ─── n FinancialArea           (n ≥ 1; multiplicity policy = OQ-40)
FinancialArea 1 ─── n FiscalYear             (year belongs to exactly one area)
FiscalYear    1 ─── n AccountingPeriod
FinancialArea 1 ─── n AccountingDocument     (document belongs to exactly one area)
Organization  1 ─── n ChartOfAccounts/CodingStructure   (org-scoped, see §5.4)
FinancialArea n ─── n DetailItem             (area applicability, §11.4)
User          n ─── n FinancialArea          (access grants, §5.5)
Branch        n ─── n FinancialArea          (independent axes, §5.3)
```

**DECIDED (`AC-D-03`)** — an accounting document belongs **directly** to exactly one
financial area (header attribute, immutable once issued). It never belongs to several
areas, and it never belongs to "the organization" without an area.

### 5.3 Financial Area vs Branch

- A branch is *operational* structure owned by Organization; a document may carry
  `branch_id` for reporting/scope (§12.4) **and** must carry `financial_area_id`.
- No FK or derivation between branch and area exists. A branch may post into
  different areas over time (e.g. a branch whose activity is booked centrally, then
  separately); an area may receive documents from many branches or none.
- Reports: "per branch" = filter/group on `branch_id`; "per book" = filter/group on
  `financial_area_id`; "organization total" = all areas. This is what keeps
  `شعبه`-level reporting and `حوزه مالی`-level reporting both possible (Class C5).
- Whether a *default* branch↔area association is convenient configuration is
  EXPERT-GATED with OQ-40 (it must never be a derivation rule).

### 5.4 Chart of accounts, coding structure and fiscal years relative to the area

**DECIDED (`AC-D-04`).** The **coding structure and the chart of accounts are
organization-scoped**, with an *applicability* relationship to financial areas;
**fiscal years, periods, documents, numbering scopes and balances are area-scoped.**

Rationale: Iranian practice reports one account tree with detail items declaring
which financial areas may use them (§2.2), and consolidation/aggregation across
areas is a separate concern (§24.2). Keeping one chart per organization avoids N
copies of the same account (and N mappings of control roles) while still letting an
area restrict which accounts/details are usable in its books.

The variant "each financial area has its own independent chart" is recorded in
**OQ-40**; the shape above supports it by making applicability per-area rather than
all-areas, without moving tables.

### 5.5 Users and financial areas

**DECIDED (`AC-D-05`) — target model:**

- A user may be granted access to **0..n** financial areas of an organization
  (many-to-many grant rows in `accounting`, with `created_by`/`created_at` and an
  explicit `is_default` per user).
- Grants are **authorization data**, evaluated in the application service on top of
  RBAC permissions. They are *not* roles, *not* a session claim, *not* a second
  authentication system (§5.7).
- A **default financial area** exists at two levels: (a) per user (UI preselection
  and the area used when a request omits one), and (b) per organization (at most one
  area flagged `is_default`, used as the resolution fallback for system postings).
- Selection supplied by a client is validated against the caller's grants; an area
  the caller may not access is **404**, not 403 (§4 rule 4).

**Interim posture (until grants are implemented):** financial areas are created and
referenced as caller-supplied, structurally scoped parameters — exactly the posture
`organizationId` has today (ADR-0021 "structural scoping is not security"). The
contract records this so nobody mistakes it for enforcement. Whether area-level
access grants ship with the first Accounting task or later is part of **OQ-40**.

### 5.6 Lifecycle

- `is_active` only; **never deleted** (OQ-36 posture, blueprint §12, AR-13).
- Deactivating an area blocks new documents/years in it; existing documents, years,
  periods and balances remain readable (freeze over delete — ADR-0022 §7).
- Deactivation while the area has an Open fiscal year or non-final documents is
  refused (422 `businessRule`): an area with live books cannot be switched off
  silently. Reopening/replacement of the area is a product decision (OQ-40).

### 5.7 Why this is not a second tenant system

The area is a **bookkeeping scope inside one tenant**. It adds: one column on
accounting rows, one set of grant rows, one scope check in the service. It adds
**no** new login, session, principal, organization or authentication concept; the
deployment pin (ADR-0025) and the principal→organization question (OQ-01/OQ-22) are
untouched and remain the only tenancy decisions.

---

## 6. Fiscal Year (`سال مالی`)

### 6.1 Conceptual shape

| Attribute | Notes |
|---|---|
| `organization_id`, `financial_area_id` | scope (§4, §5.2) |
| `code`, `title` | human identifiers, e.g. a Jalali year label or a name; localization is OQ-02. `code` unique per (organization, area) |
| `start_date`, `end_date` | inclusive, date-only (calendar choice is OQ-23/OQ-02; the model stores dates, never a calendar system assumption) |
| `status` | `open` \| `closed` \| `sealed` (closed list, code-defined) |
| `is_active` | lifecycle flag (§6.5) |
| `prior_year_id` | optional link to the previous year of the same (organization, area) — the year-transition chain |
| audit columns | AR-12 |

### 6.2 Rules that are DECIDED

1. **Non-overlap:** two years of the same (organization, area) may not overlap in
   time. Overlap is refused at create/edit (422).
2. **Contiguity is not required.** Shortened years, 16-month years and
   non-calendar-aligned years are expressible because a year is a configured row with
   explicit dates (§2.2 Rayvarz; Class A SAP shortened fiscal years).
3. **Date resolution must be unique:** a document date resolves to **at most one**
   year; a date that resolves to none is refused (no implicit year creation, no
   "nearest year" guessing).
4. **One year is the posting context:** every accounting document stores
   `fiscal_year_id` **and** `accounting_period_id`, resolved from `document_date` by
   the Accounting calendar service at composition time and re-validated at
   finalization. Reports never recompute periods from dates
   (`accounting-domain-analysis.md` §3 — reaffirmed).
5. **Year status is an explicit, permission-gated, audited operation** — never a
   side effect of posting, and never derived from period statuses.

### 6.3 Lifecycle: `Open → Closed → Sealed`

```
        close                 seal
 Open ────────▶ Closed ────────────▶ Sealed
   ▲              │                    │
   └── reopen ────┘                    │
   ▲                                   │
   └─────────── reopen (unseal) ───────┘   ← distinct permission + reason + audit
```

| Status | Meaning (DECIDED) | Posting | Corrections | Reopening |
|---|---|---|---|---|
| `open` | The year accepts documents in its **open** periods (§7) | allowed per period status | allowed per §15 | n/a |
| `closed` | The year's ordinary activity is finished; the books are provisionally complete | rejected | only through an explicit, permission-gated period/year reopen, or by documents dated in another open year (policy = OQ-23/OQ-27) | `closed → open` requires `Accounting.FiscalYear.Reopen` + reason + audit |
| `sealed` | The year is final: balances carried forward, statutory reporting basis frozen | rejected | rejected | `sealed → closed` requires a **distinct** permission (`Accounting.FiscalYear.Unseal`), a reason, and an audit record; whether it may ever be granted is OQ-23 |

**There is no `initial` state and no `void` state** (Task 10.1 §8; the same rejection
the Document Foundation made for documents — ADR-0023/Task 8 §7). Domain corrections
use the mechanisms of §15.4 (reversal / correction / adjustment / replacement), not a
status that pretends a year never existed.

### 6.4 Prior-year sealing and year transition

**DECIDED mechanism, EXPERT-GATED content (OQ-23):**

- Sealing a year requires that all its periods are closed (or that the sealing
  operation closes them as part of the same audited action — the choice is OQ-23).
- Year transition is an **explicit operation** performed by a permitted principal in
  the Accounting module, producing **ordinary accounting documents** in the years
  involved:
  1. close of temporary (profit-and-loss) accounts — `بستن حساب‌های موقت`;
  2. closing document — `سند اختتامیه` — zeroing permanent accounts of the old year;
  3. opening document — `سند افتتاحیه` — the carried-forward balances of the new year.
- These documents are normal documents: numbered (§18), balanced (§13), Final (§15),
  linked to the operation that produced them and to each other (document relations,
  ADR-0023 §5), fully auditable. **No special mutable "opening balance" table.**
- Whether they are generated automatically, from a template, or entered manually, and
  who may approve them, is EXPERT-GATED (OQ-23). The contract requires only that the
  mechanism exist, be permission-gated, be idempotent per (year, operation) — the
  ADR-0022 §3 pattern — and never overwrite an already-produced document.
- **Opening balances at go-live** (import from a legacy system, e.g. FaraPayam —
  OQ-04) enter through the same opening-document mechanism via the Excel import
  workflow (ADR-0011), not through a back door.

### 6.5 Lifecycle & integrity

- Years are never deleted; `is_active` + status only (OQ-36 posture).
- A year with Final documents cannot be deactivated or have its dates edited (dates
  are immutable once any document references the year — historical integrity,
  blueprint §12).
- Editing a year's dates while documents exist is refused (422); the correction path
  is a new year + explicit re-dating operation, which is EXPERT-GATED (OQ-23).

### 6.6 Permissions

`Accounting.FiscalYear.{View, Create, Edit, Close, Reopen, Seal, Unseal}` (§22). No
single "manage years" wildcard (OQ-21).

---

## 7. Accounting Period (`دوره مالی`)

### 7.1 Conceptual shape

| Attribute | Notes |
|---|---|
| `fiscal_year_id` (+ denormalized `organization_id`, `financial_area_id` for scope checks and indexing — ADR-0021 §3) | a period belongs to exactly one year |
| `sequence` | 1-based ordinal inside the year; unique per (year, sequence) |
| `title` | e.g. a month name; localization OQ-02 |
| `start_date`, `end_date` | inclusive; must lie inside the year's range |
| `status` | `open` \| `closed` \| `sealed` (closed list) |
| `period_kind` | closed, code-defined list. **v1 vocabulary: `normal` only.** An `adjustment`/special period is an EXPERT-GATED addition (OQ-23, Class A SAP special periods) — the seam exists, the value does not. |
| audit columns | AR-12 |

### 7.2 DECIDED rules

1. **Periods are rows, not computed months.** The layout (12 monthly periods,
   13 periods, 4-4-5, quarterly, a stub period) is data produced when the year is
   created — the year's layout is configuration/EXPERT-GATED (OQ-23), the *mechanism*
   is period rows.
2. **Periods inside one year do not overlap** and must lie within the year's dates.
   Gaps are refused at year creation time by the generator (a date that resolves to
   no period is refused at posting — §6.2 rule 3).
3. **Multiple periods may be open simultaneously.** The architecture does **not**
   assume one open period (Task 10.1 §9). Consequences: posting validation checks the
   *resolved* period's status only; "close all periods" is an explicit year-level
   action, not an implicit side effect; reports must state which periods they include
   rather than assuming "the open one".
4. **Period locking:** `closed` refuses new documents and new corrections dated in
   the period. `sealed` refuses everything, including a period reopen, unless the
   year is unsealed first (§6.3).
5. **Status transitions are explicit operations** with their own permissions
   (`Accounting.AccountingPeriod.{Open, Close, Reopen, Seal}`), reasons and audit
   records — never inferred from document activity.
6. **A period may be closed while its year is open**, and a year close implies its
   periods close (the year-level action performs it in the same transaction).
7. **Final documents keep their resolved period forever.** A later period close does
   not move or invalidate them; a reopen does not renumber them.
8. Whether posting into a closed period is **ever** allowed (with a special
   permission, or by dating a correction into an open period) is EXPERT-GATED
   (OQ-23/OQ-27). The contract's default is **fail closed**: reject.

---

## 8. Chart of Accounts and Account

### 8.1 What the chart is

**DECIDED (`AC-D-06`).** The chart of accounts is one **tree of accounts** per
organization (with area applicability, §5.4), whose depth, level titles and code
lengths come from the organization's **coding structure** (§9). The conceptual
hierarchy the contract must support is:

```
Group (گروه) ── General (کل) ── Subsidiary (معین) ── Detail (تفصیلی)
```

with these properties:

- the four names are the **common Iranian level vocabulary** (Class B), not four
  tables and not a code constant;
- depth is **configurable** (reported up to 8 levels — §2.2), so "Detail" may be
  level 4 in one organization and level 6 in another;
- level *titles* are organization configuration (a customer may call level 3
  something else);
- the **semantic** hooks the system needs (postability, temporary/permanent
  classification and future consumer-driven control-role assignments) are tied to
  accounts, not to a level name. Control-role association itself is not a column on
  `accounts`; Task 20 OD-20-3 chooses an independent effective-dated mapping.

### 8.2 One table, adjacency + level (rejected: four tables)

**DECIDED (`AC-D-07`).** Accounts live in **one** table with `parent_id` (self-FK,
`ON DELETE RESTRICT`), `level` (integer ≥ 1), and the code (§9). Reasons: depth is
configuration; the code-prefix invariant (§9.3) makes the hierarchy machine-verifiable;
rollups are a recursive CTE or a materialized path — both ordinary SQL for the
reporting views (ADR-0009); four tables would freeze depth at four and duplicate every
attribute, permission and report.

The tree may store a derived `path` (e.g. `/root_id/…/id`) as a **projection** for
report performance; if added it must be rebuildable from `parent_id` and never be the
authority (same posture as materialized inventory balances, ADR-0017/0022 §1).

### 8.3 Account attributes (conceptual)

| Attribute | Type/list | Notes |
|---|---|---|
| `organization_id` | scope | ADR-0021 |
| `code` | digits-only text | canonical, unique per organization (§9.2); business-facing accounting address. Controlled pre-use correction is permitted by OD-20-4; after accounting use it is immutable. The current implementation is stricter until a producer exists. |
| `title` (+ optional second-language title) | text | Persian is first-class (Class C4); display localization OQ-02 |
| `level` | int | 1..max depth of the coding structure version |
| `parent_id` | self-FK | null for roots; child code must extend parent code (§9.3) |
| `account_nature` | closed list `debit` \| `credit` | balance direction (`ماهیت`) — drives report column semantics, **not** which side a line may use (§13.4) |
| `account_type` | closed, code-defined list (asset / liability / equity / revenue / expense as the working vocabulary) | classification for statements and for the temporary-vs-permanent closing behaviour; **vocabulary is EXPERT-GATED (OQ-25)** |
| `is_temporary` | derived from `account_type` by a code-defined function | temporary accounts are closed at year end (§6.4); the mapping is expert-gated |
| `is_postable` | boolean | §14 |
| `is_active` | boolean | lifecycle; accounts are never deleted (§8.6) |
| `control_role_assignments` | future independent effective-dated relation | §8.7; **not** a nullable `Account.control_role` column (OD-20-3) |
| `coding_structure_version_id` | pinned | §9.4 (D-21) |
| `financial_area_applicability` | relation rows (all-areas default) | §5.4 |
| audit columns | AR-12 | |

Reserved (DEFERRED, seams only — **no speculative columns in the current schema**):
per-account currency constraint (§24.1), per-account dimension defaults, per-account
required field policy and any reconciliation/control-role requirement introduced by a
real consumer — each arrives with its own task and, where architectural, its own ADR.

### 8.4 Hierarchy validity (DECIDED invariants)

1. A child's `level` = parent's `level` + 1; no level may be skipped.
2. A child's code must **start with** its parent's code and be longer by exactly the
   level's configured digit length (§9.3).
3. A parent must not be moved under its own descendant (cycle rejection).
4. Changing `parent_id`, `level`, `account_nature` or `account_type` of an
   account that has been referenced by any document line is **refused** — create a
   new account and deactivate the old one (`accounting-domain-analysis.md` §2,
   blueprint §12 "Renaming", AR-13). A controlled `code` correction is permitted
   only before first accounting use (OD-20-4); after use the code is refused on
   ordinary update paths and changes only through ADR-0035's controlled migration.
   Titles may change; used codes and structure may not.
5. Root accounts are exactly the level-1 accounts; every account has exactly one path
   to a root.

### 8.5 Reporting behaviour (DECIDED)

Task 20 OD-20-5 resolves the POSTING/AGGREGATION question explicitly:

```text
POSTING = leaf-only
AGGREGATION = reporting/read-time roll-up
```

- A non-postable/non-leaf account's movement/balance is the **rollup** of its
  descendants (never posted directly, §14) — so `کل` and `گروه` reports are
  aggregations of the same underlying leaf lines that feed `معین`/`تفصیلی` reports.
  One fact, one owner (AR-08).
- The same movement MUST NOT be independently posted to a leaf and its parents.
  Parent rows may display derived totals, but those totals are not additional
  accounting activity to be added again.
- Reports read the account tree for structure and the document lines (or a
  rebuildable balance projection) for numbers; they never re-derive the tree from
  codes alone — the code prefix makes it possible, but the FK is the authority (§9.3
  note).

### 8.6 Freeze, never delete

**DECIDED (`AC-D-08`).** Accounts are never deleted and codes are never reused
(OQ-36 posture: "codes are compared case-sensitively and are never reused"; blueprint
§12: a financial dimension is never deleted). `is_active = false` blocks new posting
lines and new child creation; existing lines, balances, reports and history keep
referring to the account and remain fully readable. Whether an additional guard
refuses deactivation while the account has a non-zero balance or activity in an open
year is chart-governance policy → recorded in **OQ-25**.

### 8.7 Control roles (D-12 hybrid chart; refined by OD-20-2/OD-20-3)

**DECIDED mechanism (`AC-D-09`), consumer-first vocabulary, EXPERT-GATED content
(OQ-25).** Posting rules, reconciliation/reporting consumers and statutory/legal
profiles may reference **code-defined control roles**, but Task 20 makes the sequencing
explicit: Vardena MUST NOT create a speculative generic catalog. A role is introduced
only when a concrete approved consumer requires that semantic role, and that consumer
justifies the role's existence and meaning. Consequences:

- automated posting never depends on a customer-specific code (D-12);
- the role vocabulary is code (adding a role is a code change, like a document type or
  a permission — ADR-0023 §2 pattern), but no role is added without a real consumer;
- the authoritative account↔role association is an **independent effective-dated
  mapping** with its own permission, audit trail and validity period, conceptually:

  ```text
  Account
     |
     +---- AccountControlRoleAssignment
               |
               +-- account_id
               +-- control_role_id
               +-- effective_from
               +-- effective_to
               +-- audit metadata
  ```

- the final architecture is **not** a nullable `Account.control_role` column as the
  primary artifact;
- **the role list itself and which roles are mandatory remain expert-gated** under
  OQ-25 and arrive with the consuming operation; no empty control-role catalog is
  created merely because the architecture can support one.

---

## 9. Configurable coding structure

### 9.1 What is configurable (DECIDED `AC-D-10`)

A **Coding Structure** is an organization-scoped, versioned configuration object:

| Attribute | Notes |
|---|---|
| `max_depth` | number of levels (1..code-defined hard cap) |
| per level: `level_index`, `title`, `digit_length`, `default_is_postable`, `level_kind` (`group`/`general`/`subsidiary`/`detail`-style label — informational) | the level vocabulary the organization sees |
| `separator` (display only) | `-`, `/`, `.` or none — used for *rendering* codes, never stored in the code, never part of uniqueness (§9.2) |
| `reserved_ranges` | code-defined reserved ranges (e.g. for template/control accounts and for the year-transition documents' accounts) |

A **code-defined hard cap** on `max_depth` (working value: 8, matching the deepest
structure reported in §2.2) and on total code length (working value: 32 characters,
matching the numbering foundation's `MAX_SERIAL_LENGTH` reasoning) are
**architecture constants**, not business rules: they bound validation and index widths.
Raising them is a code change with an ADR note, not per-customer configuration.

The contract must **not** assume `2 + 3 + 3`, `1 + 2 + 4 + 6`, or any other fixed
layout (Task 10.1 §11). The brief's `8 digits = 02 + 003 + 004` example is one
possible configuration among many.

### 9.2 Canonical code (DECIDED)

- The stored `code` is the **concatenation of level segments, digits only** — no
  separators, no letters, no prefixes/suffixes. This mirrors the numbering
  foundation's decision that a serial is numeric-only (ADR-0023, Task 8 §11) and
  prevents `02-003` vs `02003` from being two accounts.
- Separators, grouping and Persian/English rendering are **presentation** concerns
  (frontend formatters, print templates) — OQ-02 for localization.
- Uniqueness: `code` is unique per **organization** (because the chart is
  organization-scoped — §5.4). If OQ-40 resolves to per-area charts, uniqueness
  becomes per (organization, area); the contract keeps the scope column pair on the
  unique key from the first migration so that change is additive, not a rewrite
  (the ADR-0021 argument applied one level down).
- Codes are compared **case-sensitively and literally**; they are never reused
  (§8.6).

### 9.3 Code ⇄ hierarchy consistency (DECIDED)

- A child's code = parent's code + the child level's segment (exactly
  `digit_length` digits, zero-padded).
- Validation is on **both** sides: creating a child validates the code against the
  parent; creating an account with an explicit code validates that the implied parent
  exists (codes may be system-generated or user-entered — §2.2 — but either way the
  prefix rule holds).
- The `parent_id` FK is the **authority** for the tree; the code prefix is the
  **proof**. If they ever disagree, that is a data bug and must fail loudly (a
  reconciliation check belongs with the reporting/maintenance task, mirroring
  Inventory's `Reconciliation.Execute` precedent in ADR-0022).

### 9.4 Versioning and pinning (DECIDED, D-21)

- A coding structure is **versioned**; exactly one version is active per organization
  at a time (ADR-0024 §3 pattern: draft → active → superseded).
- Every account pins the `coding_structure_version_id` it was created under, so a
  later structure change never reinterprets existing codes (historical integrity,
  blueprint §12/§14).
- Changing digit lengths or depth after accounts exist does **not** rewrite accounts;
  it applies to newly created accounts, and any migration of existing accounts is an
  explicit, permission-gated, audited operation whose policy is EXPERT-GATED
  (**OQ-25**).

### 9.5 Reserved ranges, changes and reuse (DECIDED)

| Question (Task 10.1 §11) | Contract answer |
|---|---|
| May account codes change? | **Before first accounting use:** permitted only through a future controlled code-change producer, with validation/audit/history designed in that task (OD-20-4). **After accounting use:** no ordinary change; only ADR-0035's controlled migration service. Titles change; used codes do not. |
| May codes be reused? | **No** (§8.6, OQ-36 posture). |
| Reserved ranges? | Supported as configuration (§9.1); a reserved range may only be used for its reserved purpose, enforced in the domain layer. The purpose vocabulary is code-defined. |
| Historical integrity | Guaranteed by immutability + version pinning + freeze-over-delete; no rewrite path exists. |

---

## 10. Detail dimensions (`تفصیلی`)

### 10.1 Concept

**DECIDED (`AC-D-11`).** A **Detail Dimension** is an organization-configured
analytical axis that can be attached to accounts and assigned on document lines,
**outside** the account tree. A **Detail Item** is a value of a dimension (§11).

Dimensions are: code-defined in *number* by organization configuration (not hardcoded
to four — Task 10.1 §12), strongly typed (rows in typed tables with FKs), and
reportable by `GROUP BY` (ADR-0009).

A code-defined **hard cap** on the number of dimensions per organization (working
value: 8, chosen so line-detail validation and report joins stay bounded; reported
practice is 1–5, §2.2) is an architecture constant like §9.1's caps.

### 10.2 Dimension attributes

`organization_id`, `ordinal` (1..N — the "Detail 1 … Detail N" the user sees),
`title`, `code_length` (its own coding rule, §9 mechanics reused), `is_hierarchical`
(a dimension's items may form a tree — reported up to 5 levels, §2.2), `is_active`,
audit columns. Whether a dimension's items are **free** (Accounting-owned descriptive
rows) or **bound** to master data (§10.5) is a per-dimension attribute.

### 10.3 Account ↔ dimension compatibility

**DECIDED (`AC-D-12`).** Compatibility is expressed through **dimension groups**, not
through a rule engine:

- A **Detail Dimension Group** (`گروه تفصیلی`) names a set of dimensions.
- An **account** (a postable one — §14) is linked to 0..n dimension groups.
- Therefore an account's usable dimensions = the union of its groups' dimensions.

This is the reported Iranian mechanism ("the last layer of the account tree at any
level can be linked to one or more of the four detail groups", §2.2) and it keeps
compatibility a **closed, inspectable configuration** — no expressions, no scripts
(D-23).

### 10.4 Requirement per dimension (`required` / `optional` / `forbidden`)

**DECIDED shape (`AC-D-13`), EXPERT-GATED default (OQ-41).** Each
(account, dimension) link carries a `requirement` from the closed list
`required` | `optional` | `forbidden`. The *mechanism* therefore supports both answers
to Task 10.1 §12's question:

> If an account has multiple attached detail dimensions, are all of them always
> required on every posting line, or can each dimension be independently
> optional/required?

The contract does **not** guess the answer. It records it as **OQ-41** with an interim
assumption (`required` for every attached dimension — fail closed), and notes that
resolving it either way is **configuration, not migration**: if the answer is "all
attached dimensions are always required", every link is simply created as `required`.

### 10.5 Dimension items may bind to master data (DECIDED)

A detail item may carry an optional **logical binding**
`(bound_module, bound_entity_type, bound_entity_id)` to an existing master record —
e.g. `organization/party`, `organization/branch`, `organization/employee`,
`inventory/warehouse`, or a future project/cost-centre. Rules:

- the binding is **logical** (module + type + ULID), never a cross-module FK
  (ADR-0024 §2, ADR-0023 §5, AR-07/08);
- a bound item is validated in-organization at creation (404 posture for
  cross-organization references, §4 rule 6);
- unbound items are free descriptive values (a project code with no master record);
- binding does **not** transfer ownership: the party stays Organization's, the
  warehouse stays Inventory's; Accounting stores the analytical value (§11.3).

Whether specific dimensions *must* be bound (e.g. "counterparty detail must reference
a party") is EXPERT-GATED with OQ-41.

### 10.6 Line-level assignment (DECIDED — the shape that matters most; refined by OD-20-6)

**`AC-D-14`.** Dimensions are initially modeled as transaction/document-line-level
analytical assignments. They are **not** `LedgerEntry` identity, do not add arbitrary
dimension columns to `ledger_entries`, and are never stored as a generic JSONB/EAV
payload. A document line's dimension assignments live in a **typed child table**:

```
accounting_document_line_details
  line_id            → accounting_document_lines(id)      (RESTRICT)
  detail_dimension_id→ accounting_detail_dimensions(id)   (RESTRICT)
  detail_item_id     → accounting_detail_items(id)        (RESTRICT)
  + organization_id, financial_area_id (scope), audit columns
  UNIQUE (line_id, detail_dimension_id)
  INDEX  (organization_id, detail_dimension_id, detail_item_id)
```

Why not `detail_1_id … detail_4_id` columns: the count is configuration (§10.1), and
columns would hardcode N (forbidden by Task 10.1 §12), leave unused nullable columns,
and make "report by dimension k" a per-k query. Why this is **not EAV**: the
"attribute" is a code-defined dimension row (not a free string), the "value" is a FK
to a typed item table (not a polymorphic text value), uniqueness is a DB constraint,
and every report is a join + `GROUP BY` on indexed typed columns (ADR-0009). Why not
JSONB: `configurability-architecture.md` §5.2 forbids ledger dimensions in JSONB, and
a JSONB assignment cannot be constrained, indexed per dimension, or joined for
statutory reports.

Validation at composition and again at finalization (DECIDED):

1. only dimensions attached to the line's account (via its groups) may be assigned;
2. every `required` dimension must be present; no `forbidden` dimension may be present;
3. at most one item per dimension per line (`UNIQUE` above);
4. the item must belong to the named dimension, be `is_active`, and be applicable to
   the document's financial area (§11.4);
5. multiple dimensions on one line are supported (bounded by N).

### 10.7 Reporting by dimension

Dimension reports are `GROUP BY` over the typed line-assignment table joined to
Accounting read sources (lines/documents/ledger facts as appropriate for the concrete
consumer: detail ledger, dimension trial balance, counterparty statement, project cost
report). Because assignments are typed and indexed, no pivot/EAV extraction is needed
(§19). A separate dimension projection is not introduced unless a future approved
reporting consumer justifies it.

---

## 11. Floating detail (`تفصیلی شناور`)

### 11.1 Definition (DECIDED `AC-D-15`)

A **floating detail** is a detail item that:

1. lives **outside the account tree** (it is not an account and has no account code);
2. has **one code and one identity** for the whole organization (`یونیک`), reused with
   *any* account whose dimension compatibility allows it (`شناور` — it "floats" across
   accounts);
3. has **no nature of its own**: it takes the debit/credit direction of the line it
   appears on (§2.2 sources state this explicitly), so its balance is always *derived
   from* the lines, never declared;
4. is **strongly typed**: a row in `accounting_detail_items` with FKs to its dimension
   (and optional parent item), an optional master-data binding (§10.5), area
   applicability (§11.4) and `is_active`.

### 11.2 Contrast with a static (fixed) detail

| | Static/fixed detail (`تفصیلی ثابت`) | Floating detail (`تفصیلی شناور`) |
|---|---|---|
| Where it lives | A node in the account tree (the deepest level) | A dimension item outside the tree |
| Code | Part of the account code (prefix rule, §9.3) | Its own code inside its dimension (§10.2) |
| Combining with accounts | One account per combination → code explosion ("Mr. X – Project A", "Mr. X – Project B") | One item, many accounts/combinations |
| Nature | Inherited from its account | None of its own; from the line |
| Reporting | Tree rollup | `GROUP BY` on the assignment table |

Both are supported: the account tree may have a detail level **and** dimensions may be
attached to it. The contract does not force an organization to choose.

### 11.3 What floating detail is NOT

| Not | Reason |
|---|---|
| Generic JSON on the line | §10.6 — forbidden for ledger dimensions |
| The Party | A party is Organization-owned master data with capability flags (D-02, OQ-38). A dimension item may *bind* to a party; the analytical value on the line is the item. This keeps receivable/payable reporting per counterparty possible without making Accounting own parties. |
| The Branch | Branch is a scope column (§5.3, §12.4); a dimension item may bind to a branch for analysis, but branch semantics (one branch ≠ separate books) stay Organization's. |
| The Employee / Warehouse / Item | Same pattern: binding, not ownership (§10.5). |
| A cost centre or project *by definition* | Cost centre and project are **uses** of dimensions. Whether they exist as master data in Vardena, and whether they must be bound, is EXPERT-GATED (OQ-41, and OQ-22 for departments as dimensions). |
| An EAV attribute | Dimensions are a closed, configured, code-capped set (§10.1) with typed items and DB uniqueness. |

### 11.4 Area applicability

Reported Iranian practice gives each detail item a set of **accessible financial
areas** (§2.2). The contract adopts this as an applicability relation
(item ↔ area, default = all areas of the organization), validated at posting (§10.6
rule 4). It is a *usability* filter, not an ownership split: the item stays
organization-scoped data.

---

## 12. Accounting Document (`سند حسابداری`)

### 12.1 One typed document, two origins

**DECIDED (`AC-D-16`).** There is **one** accounting document type in v1 —
`accounting_voucher` — registered in the Document Foundation's `DocumentTypeRegistry`
(ADR-0023 §2) and backed by typed tables in `accounting` (`accounting_documents`,
`accounting_document_lines`, `accounting_document_line_details`). It is written by
**two origins**: `manual` (an accounting user) and `system` (another module through
the posting contract, §16). Origin is an attribute, not a second table: the invariants
(§13, §25) are identical for both, which is what makes the books trustworthy.

Additional code-registered accounting document types for year transition
(`accounting_opening_balance`, `accounting_closing_balance`,
`accounting_temporary_close`) are **planned, not invented here** (§6.4); they arrive
with the closing task. Until then year-transition documents are ordinary vouchers
produced by an explicit operation, distinguished by their control-role accounts and
their relations.

### 12.2 Header attributes (conceptual)

| Attribute | Notes |
|---|---|
| `id` (ULID), `organization_id`, `financial_area_id` | §4, §5.2 (`AC-D-03`) |
| `fiscal_year_id`, `accounting_period_id` | resolved from `document_date` at composition, re-validated at finalization (§6.2 rule 4) |
| `document_number` | numeric-only serial from the Document Foundation (§18); allocated at issuance; immutable after Final |
| `document_date` | business/occurrence date (date-only). Drives period resolution and chronological reporting (Class C3) |
| `description` | header narration; **required, non-blank** (a voucher without a description is not defensible in any ledger) |
| `state` | `temporary` \| `final` (Document Foundation vocabulary — §15.1); plus the optional `draft` phase |
| `origin` | `manual` \| `system` (§16) |
| `branch_id` | optional operational scope dimension (§12.4) |
| `correction_kind` | nullable closed list `reversal` \| `correction` \| `replacement`; set only with a link (§15.4) |
| `corrects_document_id` / `reverses_document_id` / `reversed_by_document_id` / `replaced_by_document_id` | typed self-links (§15.4) |
| `correction_reason` | required when `correction_kind` is set (mirrors Inventory's adjustment-reason rule, ADR-0022) |
| `source_module`, `source_entity_type`, `source_entity_id`, `source_operation` | system origin only (§16.3) |
| `idempotency_reference`, `request_hash` | system origin only (§16.4) — stored on the posting-operation ledger, referenced from the document |
| `finalized_at`, `finalized_by` | finalization evidence (§23); `created_*`/`updated_*` per AR-12 |
| `correlation_id` | end-to-end traceability (`docs/architecture.md` §9, `docs/security.md` §5) |

Reserved seams (DEFERRED, no columns now): currency/exchange-rate (§24.1), attachment
archive (§2.2 electronic attachments → Print/Documents), posting-layer/parallel
accounting (§2.1), cost-allocation reference (§2.2 `تسهیم`).

### 12.3 Two dates, deliberately

The contract keeps `document_date` (business date) **and** the system timestamps
(`created_at`, `finalized_at`). Rationale: any journal-timing or entry-delay
requirement (Class C3), any audit reconstruction, and any "when did the book actually
get this entry" question needs both, and adding a timestamp later to immutable rows is
a migration of history. No third "entry date" business field is introduced (that would
be an unverified assumption about practice).

### 12.4 Branch on the header (not the line)

**DECIDED (`AC-D-17`).** `branch_id` is a **header** attribute (optional, validated
in-organization). ADR-0020 §1 requires branch on journals; header-level keeps one
document = one branch, so branch statements, branch trial balances and legal-book
consolidation (Class C5) are simple filters. A document that must span branches is
composed as several documents. Line-level branch was considered and rejected: it
duplicates the operational document's own structure inside the ledger and makes
branch rollups ambiguous when a line's branch differs from its document's.

### 12.5 Line attributes (conceptual)

| Attribute | Notes |
|---|---|
| `id`, `document_id`, `line_no` | `line_no` is 1-based, unique per document, dense (no gaps) — the legal-book rendering order |
| `organization_id`, `financial_area_id`, `fiscal_year_id`, `accounting_period_id` | denormalized scope for indexed queries and scope checks (ADR-0021 §3); always equal to the header's |
| `account_id` | must be postable (§14), active, and applicable to the area (§5.4) |
| `debit_amount`, `credit_amount` | non-negative exact decimals; exactly one is non-zero (§13) |
| `description` | optional line narration |
| dimension assignments | child table (§10.6) |
| `source_line_reference` | optional logical reference `(module, entity_type, entity_id, line_id?)` for system origin (§16.3, §20.3) — the "شماره عطف" of §2.2 is this plus a document relation (ADR-0023 §5) |

Lines are part of the document aggregate: they are created and replaced **only** while
the document is editable (§15.2), in the same transaction as the header, and they are
never edited or deleted after Final (AC-I-05/06).

### 12.6 Quantity, currency and attachments on lines

Reported Iranian voucher spaces include currency, quantity and reference columns
(§2.2). Contract position:

- **reference** → covered today by `source_*` + document relations (no new field);
- **currency / exchange rate** → DEFERRED with the seam in §24.1 (OQ-03);
- **quantity** (statistical amount, e.g. for currency or inventory-value vouchers) →
  DEFERRED. If required later it arrives as typed columns with the unit resolved
  through Inventory's public service (AR-07), never as JSONB, and never as an
  Inventory FK;
- **attachments** → a Print/Documents/archive concern (ADR-0012, ADR-0023), not an
  Accounting table.

---

## 13. Debit / credit and money semantics

### 13.1 The invariant

**DECIDED (`AC-D-18`).** For every accounting document that reaches `final`:

```
Σ debit_amount (all lines)  =  Σ credit_amount (all lines)      exactly
```

compared in **exact decimal arithmetic with zero tolerance** (no epsilon, no rounding
to make it balance). Additional structural requirements: at least **two** lines, at
least one debit line and at least one credit line. The check runs at composition
(fast feedback) **and** again inside the finalization transaction under the document
lock (the authoritative check — the ADR-0022 §"evaluate inside the transaction, never
check-then-act" posture).

### 13.2 Amounts are positive, side is explicit

- `debit_amount ≥ 0`, `credit_amount ≥ 0`; **exactly one** is non-zero per line;
  a line with both zero is rejected (zero-value lines carry no accounting fact and
  silently pad ledgers), and a line with both non-zero is rejected (that is two lines).
- **Negative amounts are rejected.** A "negative debit" is a credit and must be
  written as one; a correction is a counter-document (§15.4), never a sign flip. This
  removes an entire class of sign-convention bugs and keeps every report a plain
  `SUM`.

### 13.3 Representation: two columns, not a signed amount

Considered: one signed `amount` + direction flag (or SAP-style posting keys). Rejected
because (a) a line's direction is **not** derivable from the account's nature — the
same account is debited and credited — so a sign convention would have to be
re-explained per report; (b) the statutory/standard layouts the contract must serve
(4/6/8-column trial balances, journal, ledgers) are literally debit and credit
columns, so two columns make them direct aggregates; (c) two non-negative columns make
`Σ debit = Σ credit` and per-account balances expressible as pure SQL without
`CASE`-sign logic (ADR-0009 view-first reporting). Inventory's *signed quantity with a
typed movement type* (ADR-0022 §2) stays correct for its own domain: there the sign is
a property of the movement type; here the side is a property of the line.

### 13.4 Nature vs side (no confusion)

`account_nature` (§8.3) is the account's **expected balance direction** for reporting
(an asset normally carries a debit balance). It does **not** restrict which side a line
may use: an asset account is credited when the asset decreases. Reports may *flag* a
balance contrary to nature (a control/anomaly report); the contract does not reject it
— rejecting it would be an unverified accounting assumption. Whether contrary-nature
balances should warn or block is EXPERT-GATED (OQ-25).

### 13.5 Precision, rounding, totals

| Concern | Contract position |
|---|---|
| Storage | `numeric(18,2)` (AR-12, `database-strategy.md` §6). Exact decimal, never float. Precision per currency is **OQ-03**; the contract forbids hardcoding display precision. |
| Rounding | Any rounding happens **before** the document is composed — in the source module or in the posting rule — and the resulting document must already balance. **Accounting never rounds to force balance** and never distributes a residual silently. Residual-handling policy for system postings (which line absorbs a rounding remainder) is EXPERT-GATED with the posting rules (OQ-24/OQ-25/OQ-30). |
| Line vs document totals | Totals are **derived** from lines. A client-supplied total is ignored/rejected; if a denormalized total is stored for list performance it is recomputed inside the same transaction and asserted equal to the derived value. |
| Balancing validation | §13.1: at composition and again under lock at finalization. |
| Zero-total documents | Impossible (≥1 debit line and ≥1 credit line, each non-zero). |

### 13.6 Currency

v1 assumes a **single base currency** per organization (OQ-03 assumption). The
balancing invariant is expressed in that base currency, which is what makes future
multi-currency additive rather than transformative (§24.1).

---

## 14. Account posting eligibility

**DECIDED (`AC-D-19`, reaffirmed by Task 20 OD-20-5).**

1. `is_postable` is an **account attribute**, validated — not inferred from a level
   name. A document line may reference only a postable, active, area-applicable
   account.
2. **A postable account must be a leaf.** An account with children cannot be
   postable: posting to a parent would double-count its own rollup (§8.5). Enforced on
   both paths: setting `is_postable = true` on an account with children is refused, and
   creating the first child of a postable account is refused **unless the same
   operation clears the parent's postability** — which §8.4 rule 4 already forbids once
   the parent has lines. No invalid posting configuration is therefore representable
   (Task 10.1 §18).
3. A **leaf may still be non-postable** (a placeholder awaiting children, or a
   structural node an organization does not post to). Non-postable is therefore not
   equivalent to "has children".
4. The **default** postability per level comes from the coding structure's level
   definition (`default_is_postable`, §9.1) and may be overridden per account. The
   *policy* — which levels a given business posts to (`معین` only? `معین` + `تفصیلی`?
   configurable per organization?) — is EXPERT-GATED (**OQ-25**). The contract
   deliberately does **not** assert "Group/General non-postable, Subsidiary/Detail
   postable" as a rule; it asserts the *mechanism* plus the leaf invariant that makes
   any such policy safe.
5. Postability is part of the account's immutable-after-use surface: changing
   `is_postable` on an account that has lines is refused (§8.4 rule 4) — otherwise a
   historical rollup would silently change meaning.
6. Detail dimensions attach only to postable accounts (§10.3), matching the reported
   mechanism ("the last layer of the account tree … can be linked to detail groups").

---

## 15. Lifecycle, correction, reversal, adjustment, replacement

### 15.1 States — reuse the Document Foundation verbatim

**DECIDED (`AC-D-20`).** Accounting uses the Document Foundation phase/state model
(ADR-0023, Task 8 §7/§8) **as implemented**:

```
draft (optional pre-issuance phase) ──submit──▶ temporary ──finalize──▶ final
```

- `temporary` (`موقت`) and `final` (`دائم`/`قطعی`) are the only states.
- **No `initial` state, no `void` state, no `deleted` state, no `draft` *state***
  (`draft` is a phase, not a state — the Foundation's own distinction).
- Whether an accounting document starts in `draft` is configuration
  (`document_type_configs.draft_required`) — this is exactly the Mode A/Mode B seam of
  §17.
- The Accounting module registers its type with `entryStates` and `deletablePhases`
  (§15.3) and composes each action with its own RBAC permission (§22) — the
  Foundation supplies the state half of the decision, Accounting supplies the
  authority half (Task 8 §9).

### 15.2 Editability

| Phase | Editable? | Notes |
|---|---|---|
| `draft` | yes | header, lines, dimension assignments; no number required yet |
| `temporary` | yes | edits are audited; the number is allocated at issuance and never changes |
| `final` | **no** | AC-I-05: no field edit, no line edit, no dimension edit, no re-numbering, no re-dating, no period re-resolution |

`final` protection is **structural** (no update route, no mutation path in the
service), not merely validated — the posture ADR-0024 §"immutability is structural"
established for workflow history.

### 15.3 Deletion and cancellation before finalization

**DECIDED (`AC-D-21`).**

- `final` documents are **never deletable** (AC-I-06). The Foundation's `planDelete`
  refuses `final` unless explicitly declared; Accounting declares **no** deletable
  final phase.
- `deletablePhases = ['draft', 'temporary']`: a voucher that never reached `final` may
  be discarded — this matches reported Iranian practice (temporary vouchers are
  routinely edited/discarded before `دائم`, §2.2) and keeps the ledger free of noise.
- Deleting a numbered `temporary` document leaves its **numbering allocation row**
  intact (the allocation ledger is append-only, ADR-0023 §3): the gap is visible and
  auditable rather than silently recycled (`reuse_policy = never`). Whether gaps are
  acceptable, and whether a discarded voucher should instead be kept with a
  "discarded" marker, is EXPERT-GATED with numbering/legal policy (**OQ-12**, and
  Class C2 in **OQ-43**).
- Cancellation *after* finalization does not exist as a state change: it is a
  **reversal** or **replacement** (§15.4).

### 15.4 Correction mechanisms (four, typed, additive)

**DECIDED mechanisms (`AC-D-22`); EXPERT-GATED policy (OQ-27).** No mechanism mutates
a Final document; every mechanism produces **new documents** that are themselves
Final, balanced, numbered and audited.

| Mechanism | What it produces | Links | When it is the right tool (policy = OQ-27) |
|---|---|---|---|
| **Reversal** (`ابطال`/`معکوس`) | A mirror document: same lines, debit/credit swapped | `reverses_document_id` on the new document, `reversed_by_document_id` on the original; `correction_kind = 'reversal'`; reason required | The original should have no effect at all |
| **Correction** (`اصلاح`) | A **difference** document adjusting the net effect of specific lines | `corrects_document_id`; `correction_kind = 'correction'`; reason required | Part of the original was wrong (amount, account, dimension) |
| **Replacement** (`جایگزینی`) | An atomic **pair**: reversal + new document, committed together or not at all (ADR-0022's transfer-pair atomicity) | both links above + `replaced_by_document_id`; reason required | The original is wholly wrong and a correct version must exist |
| **Adjustment** (`تعدیل`) | An ordinary new voucher reflecting a newly known fact | no correction link (it corrects nothing); reason/description required | Period-end adjustments, accruals, revaluations, new information |

Rules that are DECIDED:

1. A reversal/replacement must mirror the original **exactly** in accounts, dimensions
   and amounts (derived server-side from the stored lines — never client-supplied),
   so a reversal cannot become a disguised new entry.
2. A correction/difference document is validated like any voucher (§13) and must name
   the document it corrects.
3. Each mechanism is **idempotent** per (original document, mechanism, operation key)
   via the posting-operation ledger (§16.4): retrying a reversal does not produce two
   reversals; an already-reversed document refuses a second reversal (the
   `AlreadyReversedError` posture of ADR-0022).
4. The **period/year the correction lands in** is resolved from the correction's own
   `document_date` (§6.2 rule 4) and is subject to that period's status: whether a
   correction may be dated into a closed period, or must be dated in the current open
   period, is EXPERT-GATED (**OQ-27**, Class C considerations in **OQ-43**).
5. **`reopen` (final → temporary) is refused for accounting documents.** The
   Foundation provides the action; Accounting does **not** use it, because AR-13 and
   `database-strategy.md` §7 make posted accounting immutable and corrections
   counter-records. If an accountant later requires a windowed, approval-gated reopen,
   that is a policy change needing an ADR and an OQ-27 answer — not a default.

### 15.5 Finalization

**DECIDED (`AC-D-23`).** Finalization is the single act that makes a voucher part of
the books. Inside one transaction, under a row lock on the document:

1. re-validate: balance (§13.1), lines ≥ 2 with both sides present, accounts postable
   + active + area-applicable, dimension assignments complete and legal (§10.6),
   year/period resolved from `document_date` and **open** (§7.2), organization/area
   scope (§4), description present;
2. allocate/confirm the document number (§18) — a Final document always has one;
3. set `state = final`, `finalized_at`, `finalized_by`, and the workflow evidence if an
   approval was required (§17);
4. update balance projections (§19.3) if the chosen mechanism is materialized;
5. write the posting-operation row for system origins (§16.4);
6. publish `AccountingDocument.Finalized` (§21) and emit audit facts (§23).

A failure anywhere rolls back everything — no partially final document, no balance
without a document, no document without its idempotency key (the ADR-0022 §3
guarantee applied to accounting).

---

## 16. Manual vs system-generated accounting

### 16.1 Two origins, one aggregate

**DECIDED (`AC-D-24`).** `origin ∈ {manual, system}` on the header (§12.2). Both
origins produce the same document shape and satisfy the same invariants; they differ
only in *who composes the lines* and *which evidence is stored*:

| | Manual | System-generated |
|---|---|---|
| Composer | an accounting user through the Accounting API | a posting operation invoked by/for another module (§16.3) |
| Authority | `Accounting.Document.Create` + the phase's action permissions | the *source* module's own permission for its business action, plus the posting contract's authorization (§16.5) |
| Evidence | actor, correlation id, timestamps | + source module/entity/id/operation, idempotency reference, request hash, mapping/rule version |
| Failure surface | 422 validation, 403 permission | + 409 idempotency conflict, retry/backoff semantics (§16.6) |
| Lifecycle | draft?/temporary → final per configuration | per posting mode (§17): Mode A ⇒ final directly; Mode B ⇒ temporary/draft awaiting an accounting approval |

### 16.2 What "system-generated" never means

- It never means another module inserting into `accounting.*` (AC-I-13, AR-07/16).
- It never means Accounting scraping another module's tables to build lines (AR-07):
  Accounting uses the payload it is given, and if it needs more detail it calls the
  owning module's **public application service**.
- It never means an implicit accounting effect because an operational document exists
  (§17.1).

### 16.3 The source-posting contract (conceptual — NOT implemented)

**DECIDED shape (`AC-D-25`).** One contract for every source module (Inventory, Sales,
Purchasing, Treasury, Fixed assets, Payroll — whenever they exist):

```
PostingRequest
  organizationId          ← scope (validated, 404 posture)          §4
  financialAreaId?        ← resolved per §16.7 when absent           §5
  sourceModule            ← code-defined module name (snake_case)    ADR-0023 §5 pattern
  sourceEntityType        ← code-defined entity type (snake_case)
  sourceEntityId          ← ULID (logical reference, no FK)
  sourceLineReferences[]? ← (entityId, lineId?) for line-level trace §12.5
  sourceOperation         ← code-defined operation (e.g. `post`, `reverse`, `adjust`)
  operationKey            ← caller-supplied idempotency key          §16.4
  documentDate            ← business date driving period resolution  §12.3
  description             ← narration (required)
  branchId?               ← operational scope                        §12.4
  accountingPayload       ← the composed intent:
      lines[] { accountRef | controlRole, debit | credit, description?,
                dimensionAssignments[] { dimensionOrdinal, itemRef },
                sourceLineReference? }
  correlationId           ← end-to-end trace
```

Notes:

- `accountRef | controlRole`: a source payload may name an account **or** a control
  role (§8.7). Roles are the durable form — the mapping role→account is
  Accounting-owned configuration, so a source module never hardcodes a customer's
  codes (D-12, AR-16).
- The payload is **validated by Accounting**, not trusted: accounts must exist, be
  postable and applicable; dimensions must be legal for the account (§10.6); amounts
  must satisfy §13. A source module cannot push an unbalanced or non-postable
  document into the books.
- Whether the *source* module composes lines at all, or sends business facts and lets
  an Accounting-owned **posting rule** compose them, is the distinction between
  "contract A" (facts + rule) and "contract B" (composed payload). **DECIDED:** the
  contract supports both, and the *preferred* form is facts + Accounting-owned rule
  (AR-16: mapping belongs to Accounting); a composed payload is allowed only where a
  rule cannot express the mapping, and then the mapping is still reviewed as
  Accounting configuration. Which form each source uses, and the rule content, are
  EXPERT-GATED (OQ-24/OQ-25/OQ-30).

### 16.4 Idempotency (DECIDED — mirrors ADR-0022 §3/§4 and ADR-0023 §4)

An Accounting-owned **posting-operation ledger** (`accounting_posting_operations`):

| Rule | Statement |
|---|---|
| Key | one row per completed posting operation, unique on `(organization_id, operation_key)` |
| Atomicity | written in the **same transaction** as the document, its lines and any balance projection: a committed effect always has its key, a failed one never does |
| Hash | `request_hash` = sha256 over the **canonical client intent only** — no generated ids, no server clocks, an omitted optional date hashed as explicit `null` (ADR-0022 §4, the Task 9.6 finding) |
| Replay | same key + same hash ⇒ replay the stored result (re-reading current rows, never a stale snapshot) |
| Conflict | same key + different hash ⇒ **409**, nothing applied |
| Kinds | closed code-defined list, e.g. `document_finalize`, `document_reverse`, `document_correct`, `document_replace`, `system_post`, `year_close`, `year_seal` |
| Event-derived | where posting is triggered by a domain event, the **event id** is the natural operation key (ADR-0005, AR-15) |

**AC-I-12:** system-generated posting must be idempotent — retries, double clicks,
replayed events and worker restarts must not duplicate a document.

### 16.5 Authorization for system postings

- The HTTP surface of the source module enforces the source's own permissions; the
  posting contract enforces Accounting's scope and validation rules.
- A posting executed **inside** a source module's request runs under that request's
  principal (so actor evidence is real); a posting executed by the **worker** runs in
  system context (`docs/security.md` §3) and must carry the original actor as evidence
  data, never as an authorization bypass.
- No "posting superuser" permission exists; no wildcard (OQ-21).

### 16.6 Delivery, transaction boundary and retry

Two delivery shapes are architecturally available, and the **choice is not made here**:

| Shape | Semantics | Precedent |
|---|---|---|
| **Transactional subscription** | The accounting effect commits **with** the source business write; a posting failure fails the source operation ("safe for the books") | ADR-0005 (Accepted), AR-16 |
| **Durable queue / outbox** | The source write commits; posting happens later, at-least-once, with retry and a dead-letter surface; the books lag the operation | AR-14, ADR-0004, `sync.outbox_events` |

**DECIDED (`AC-D-26`):** the posting *interface* (§16.3) is identical for both, so the
delivery choice is swappable without changing source modules. **EXPERT/ARCH-GATED
(`OQ-39`):** which shape production uses, what happens to a source document whose
posting is rejected near a period close, and — critically — the fact that **today the
event bus is in-memory only** (ADR-0024 §9 "gap accepted"): a crash after commit and
before dispatch loses the effect. Therefore:

> **No production system-generated posting integration may be enabled before OQ-39 is
> resolved and durable dispatch (or the transactional-subscription decision) is
> implemented.** The current in-memory bus provides **no** durable integration
> guarantee, and this contract does not pretend otherwise (Task 10.1 §22).

### 16.7 Financial-area resolution for system postings (DECIDED, fail closed)

1. explicit `financialAreaId` in the payload, if the source can determine it;
2. else the organization's **only** area, when exactly one exists;
3. else the organization's **default** area (§5.5), when exactly one is flagged;
4. else **fail** with a validation error — never guess, never post to "all areas".

---

## 17. Operational document → accounting document

### 17.1 The chain (DECIDED `AC-D-27`)

```
Operational Document (Inventory/Sales/Purchasing/Treasury — owning module)
        │  business transaction happens (movement, invoice, receipt, payment)
        ▼
Accounting Contract (§16.3 posting request / domain event)
        │  Accounting validates + composes + applies posting policy
        ▼
Accounting Document (voucher — Accounting-owned, immutable once Final)
```

An operational document **does not** become an accounting journal merely because it
exists. Three things must all be true: (a) accounting is enabled for the organization
(D-19 feature switch), (b) a posting rule/contract exists for that source operation
(EXPERT-GATED content), and (c) the posting mode for that source type resolves to
"post now" (§17.2). Otherwise the operational document simply has no accounting
effect — which is how Inventory and Sales can ship before accounting decisions are
made (D-19, ADR-0022's "no costing yet" gap).

### 17.2 Posting modes (DECIDED mechanism `AC-D-28`; EXPERT-GATED default OQ-42)

| Mode | Behaviour | Expressed with |
|---|---|---|
| **A — direct** | The source operation creates an accounting document that goes **straight to `final`** | Document Foundation entry state `['final']` for the registered accounting type in that organization (`document_type_configs`, ADR-0023 §2) |
| **B — review** | The source operation creates an accounting **draft/temporary** document that an accounting authority must finalize; rejection returns it to the source | entry state `['temporary']` + `draft_required = true`, with the approval carried by the **Workflow Foundation** (ADR-0024: bounded transitions, single-level approvals, `require_different_actor`, pinned versions) |

This is the reported Iranian `پیش نویس اسناد` pattern (§2.2) implemented with
mechanisms that already exist and are accepted — **no new engine, no new state, no new
table**. The mode is configuration per (organization, source module, source document
type), because a business may want inventory postings automatic and treasury postings
reviewed.

What is **not** decided (⇒ **OQ-42**): the default mode, which source types may use
Mode A at all, who may finalize a Mode B document, whether the creator may approve
their own (segregation of duties — the Workflow Foundation supports
`require_different_actor`, but the *policy* is OQ-26), what "reject" means for the
source document (block it? leave it posted with an accounting exception queue?), and
how a backlog of unapproved accounting drafts is governed.

### 17.3 What Accounting does not do here

- It does not own the operational document's lifecycle, numbering or approval
  (owning module + Documents/Workflow foundations).
- It does not call back into the source module to change it (ADR-0005: Accounting
  never calls Inventory).
- It does not store operational quantities/prices "for convenience": the accounting
  document stores accounting facts plus a logical reference to the source (§12.5).

---

## 18. Numbering

**DECIDED (`AC-D-29`): Accounting consumes the Document Foundation numbering
(ADR-0023). It builds no numbering mechanism of its own and does not redesign Task 8.**

| Requirement (Task 10.1 §19) | How it is satisfied |
|---|---|
| Numeric-only | Inherited: a serial is digits only, no prefix/suffix/separator (ADR-0023, Task 8 §11). Accounting adds nothing to the serial itself. |
| Financial-area component | `numbering_series.scope_key` — the Foundation's opaque series token that "splits the type's numbers into several independent runs". Accounting uses `scope_key = <financial area>` (plus source type where needed). |
| Fiscal-year component / per-year reset / numbering reset at the year boundary | **Not implemented today.** `strategy` is a closed list with `monotonic` only, and the Foundation documents the strategy column as "the seam for fiscal-year components, resets and recycling — expert-gated (OQ-12)". Contract position: if the accountant requires a year component, it is implemented as a **new numbering strategy in the Documents module**, never as an Accounting-side fork or a second counter table. Until then: one monotonic series per (organization, accounting document type, area). ⇒ **OQ-12** |
| Sequence, concurrency, uniqueness | Inherited: `SELECT … FOR UPDATE` on the series row + `(series_id, number)` unique + append-only allocation ledger (ADR-0023 §3). |
| Idempotent allocation | Inherited: `(series_id, allocation_key)`; a retry replays the stored serial, a reused key with different intent is rejected (ADR-0023 §4). Accounting passes its `operationKey` (§16.4) as the allocation key so one business action allocates one number however many times it is retried. |
| Gaps | Inherited `reuse_policy` (default `never`): gaps are auditable, not hidden. Whether gaps are legally acceptable, and the discard policy for temporary vouchers, is EXPERT-GATED (OQ-12, Class C2 → OQ-43). |
| Immutability after finalization | Inherited + reinforced: `assign_number` is refused for `final` (Foundation `planEdit`), and §15.2 makes Final structurally immutable. |
| Prefix/suffix configuration | **Rejected** for accounting serials: it contradicts the Foundation's numeric-only decision and the reported legal expectation that books show plain sequential numbers. Presentation may add separators (§9.2). |
| Permissions | Accounting registers **no** numbering permission: series configuration is `Document.NumberingSeries.{View,Create,Edit}` and allocation is an internal service call inside Accounting's own transaction (ADR-0023's explicit "no `Allocate` permission" reasoning). `Accounting.Document.View` covers reading a document's number. |

---

## 19. Reporting boundary

### 19.1 Future accounting reports (identified, NOT implemented)

Chart of accounts / account tree · voucher journal (`دفتر روزنامه`) · general ledger
(`دفتر کل`) · subsidiary ledger (`دفتر معین`) · detail ledger (`دفتر تفصیلی`) ·
account movements · trial balance · 4-column, 6-column and 8-column trial balances ·
period/year statements (balance sheet, P&L) · comparative reports (period-over-period,
year-over-year) · dimension reports (per detail item, per dimension) · branch reports ·
financial-area reports · control reports (contrary-nature balances, unposted/pending
system documents, numbering gaps, balance-vs-lines reconciliation).

### 19.2 Where the data comes from (DECIDED `AC-D-30`)

1. **Source of truth = Final document lines.** No report recomputes accounting from
   operational documents (no "invoice → revenue" arithmetic at report time), and no
   report reads another module's tables (AR-07, ADR-0009).
2. **Accounting owns module views** (`accounting/reports/`, raw SQL allowed there —
   AR-11a) exposing ledger/trial-balance/movement shapes; the **Reporting module**
   consumes them through code-defined report definitions with a permission per report
   (ADR-0009, `reporting-strategy.md` §1–2).
3. **Period/year filters are predicates on stored columns**, never date arithmetic:
   `fiscal_year_id`/`accounting_period_id` are stored on documents and lines (§6.2
   rule 4), so "as of period" is a `WHERE`.
4. **Dimension reports are `GROUP BY`** over the typed assignment table (§10.6) — no
   pivot extraction, no JSONB traversal.
5. **Column variants are layouts, not models.** A 4/6/8-column trial balance is the
   same aggregate (opening debit/credit, period debit/credit turnover, closing
   debit/credit) rendered with different column sets; the *layout* is a report
   definition concern, and statutory layouts are EXPERT-GATED (OQ-25, OQ-43).

### 19.3 Balance projections (direction DECIDED, mechanism deferred)

**DECIDED (`AC-D-31`).** Account balances are a **projection**, not the ledger:

- the intended shape is a materialized balance per (organization, financial area,
  fiscal year, period, account) — and, where a dimension report demands it, per
  dimension — updated inside the finalization transaction (§15.5 step 4), exactly the
  Inventory pattern (ADR-0017/0022 §1: ledger authoritative, balance materialized,
  rebuildable);
- a projection must be **rebuildable from the lines** by an explicit, permission-gated,
  audited maintenance operation (the `Inventory.Reconciliation.{View,Execute}`
  precedent) and must never be the authority;
- whether v1 materializes at all, or computes from lines until volume demands it, is an
  **implementation decision for the balance/reporting task** — it changes no concept in
  this contract, and if it introduces a materialized table it follows ADR-0017's
  accepted pattern (a new ADR only if it deviates).

### 19.4 What reporting must never become

No report engine inside Accounting, no user-defined report SQL, no report writing to
`accounting.*`, no snapshot table that cannot be rebuilt, and no statutory layout
hardcoded before OQ-43 validation.

---

## 20. Inventory → Accounting boundary

### 20.1 The boundary (DECIDED `AC-D-32`, reaffirming AR-16 / ADR-0005)

```
Inventory (owns stock facts: movements, balances, reservations — ADR-0022)
   │
   │  publishes facts / invokes the posting contract (§16.3)
   ▼
Accounting (owns financial meaning: accounts, rules, documents, periods)
```

Inventory must never `INSERT INTO accounting_…`, `UPDATE accounting_…` or
`SELECT … FROM accounting_…` (AC-I-13). Accounting must never read `inventory.*`
tables: it consumes the payload and, if it needs more (e.g. an item's account
binding), calls Inventory's **public application service** (AR-07).

### 20.2 Where each concern belongs

| Concern | Owner | Contract reference |
|---|---|---|
| Source reference (which movement/document caused the entry) | Accounting stores it as a **logical** reference `(source_module, source_entity_type, source_entity_id[, line])`; optionally a document relation created through the Documents module | §12.2, §12.5, ADR-0023 §5 |
| Idempotency | Accounting's posting-operation ledger keyed by the source `operationKey` / event id | §16.4, AC-I-12 |
| Posting policy (which accounts, which mode, whether enabled at all) | Accounting-owned **configuration** (posting rules + control-role mapping + D-19 switch + §17.2 mode) | §8.7, §17.2 |
| Cost/valuation input | **Inventory ledger + valuation method (OQ-24)** — unresolved; until it is, inventory-driven postings cannot be activated (ADR-0022 records the ledger stores quantities, not money) | §20.4 |
| Transaction boundary | OQ-39 (transactional subscription per ADR-0005 vs durable queue per AR-14) | §16.6 |
| Retry behaviour | Only meaningful in the queued shape: at-least-once + idempotent consumer + dead-letter surfacing (ADR-0004, AR-15). Never a blind retry of a non-idempotent posting | §16.4, §16.6 |
| Rounding/residual of a computed amount | Computed **before** composition, policy expert-gated; Accounting never rounds to balance | §13.5 |
| Failure near a period close | Policy: OQ-23/OQ-27 + OQ-39 (what happens to the source document) | §16.6, §7.2 rule 8 |

### 20.3 Traceability requirement (DECIDED)

Every system-generated accounting document must be traceable **both ways** without
cross-module SQL:

- forward: accounting document → `source_*` → Inventory's public read API;
- backward: inventory movement → Accounting's public read API filtered by
  `sourceModule/sourceEntityType/sourceEntityId` (an indexed query, §12.2).

This is what makes reconciliation a routine (blueprint §20 question 6) and what a
statutory mismatch investigation (Class C5/C6) will need.

### 20.4 Activation gate (DECIDED)

Inventory→Accounting posting stays **disabled** until: OQ-24 (valuation/costing) is
answered, the posting rules for each movement type are reviewed by an accountant
(OQ-25/OQ-30), and OQ-39 (delivery durability) is resolved. D-19's per-organization
accounting switch is the mechanism: operational modules work fully while the books
stay clean (ADR-0022's accepted gap).

---

## 21. Events and the outbox decision

**DECIDED (`AC-D-33`): Accounting reuses the existing kernel `DomainEventBus` and the
`core.domain_events` log — no second event architecture, no competing outbox table
(ADR-0024 §9 precedent).**

Proposed event vocabulary (`Entity.PastTenseVerb`, `docs/architecture.md` §5). These
**refine** the placeholder catalog rows `JournalEntry.Posted` /
`AccountingPeriod.Closed` in `docs/modules.md`; the catalog is updated when the module
is implemented (event schema changes are ADR-gated — AR-29):

| Event | When | Main consumers |
|---|---|---|
| `FinancialArea.{Created,Updated,Enabled,Disabled}` | area lifecycle | Audit |
| `FiscalYear.{Created,Closed,Reopened,Sealed,Unsealed}` | year operations | Audit, Notifications |
| `AccountingPeriod.{Opened,Closed,Reopened,Sealed}` | period operations | Audit, Notifications |
| `Account.{Created,Updated,Enabled,Disabled}` | chart maintenance | Audit |
| `DetailDimension.*` / `DetailItem.{Created,Updated,Enabled,Disabled}` | dimension maintenance | Audit |
| `AccountingDocument.{Created,Updated,Finalized,Deleted,Reversed,Corrected,Replaced}` | document lifecycle (`Updated`/`Deleted` only pre-final) | Audit, Notifications, Reporting cache invalidation |
| `AccountingYearTransition.Executed` | closing/opening operation | Audit, Notifications |
| `AccountingPosting.Rejected` | a system posting refused (scope, period closed, unbalanced, non-postable) | Audit, Notifications, source-module exception surface |

Payload convention follows the established one: `{id, organizationId, …}` +
`correlationId` + `occurredAt`; no `*.Deleted` event for master data (nothing is
deleted — OQ-36); amounts are included for `Finalized` only where a consumer needs
them, and never as a substitute for reading the owning module.

**Durability (OQ-39).** The bus is **in-memory**; the log is append-only inside the
publisher's transaction. Therefore:

- events are **evidence and notification**, not a durable delivery guarantee;
- a crash between commit and dispatch loses the effect (ADR-0024 §9 "gap accepted");
- **any accounting integration that must not lose an effect** (system posting,
  statutory submission, audit capture of finalization) requires the durable path
  (`sync.outbox_events` + worker, AR-14/ADR-0004) or the transactional-subscription
  decision of §16.6 — and that decision is **OQ-39**, not an assumption.

---

## 22. Security / RBAC permission vocabulary

**DECIDED (`AC-D-34`).** Accounting registers its own granular codes in its module
registry (`Module.Entity.Action`, AR-22), mirrored into `rbac.permissions` at startup
(ADR-0006/0016). **No wildcards, no `Accounting.*`, no "Accounting Manager" role**
(role sets are OQ-14; wildcards are OQ-21). The vocabulary below is the *contract*;
codes are registered by the implementing task and any code not enforced by code must
not exist (`docs/security.md` §3).

| Entity | Codes | Notes |
|---|---|---|
| `Accounting.FinancialArea` | `View, Create, Edit, Enable, Disable` | master-data pattern (Task 6) |
| `Accounting.FinancialAreaAccess` | `View, Grant, Revoke` | user↔area grants (§5.5); separate from RBAC role assignment on purpose |
| `Accounting.FiscalYear` | `View, Create, Edit, Close, Reopen, Seal, Unseal` | `Seal`/`Unseal` distinct from `Close`/`Reopen` (§6.3) |
| `Accounting.AccountingPeriod` | `View, Open, Close, Reopen, Seal` | period operations are their own authorities (§7.2 rule 5) |
| `Accounting.CodingStructure` | `View, Configure` | versioned configuration (§9.4); no free-text structure editing |
| `Accounting.Account` | `View, Create, Edit, Enable, Disable` | **no `Delete`** — accounts are never deleted (§8.6). "Manage chart of accounts" is expressed as this granular set, never a wildcard |
| `Accounting.ControlRole` | `View, Map` | role→account mapping (§8.7) |
| `Accounting.DetailDimension` | `View, Create, Edit, Enable, Disable` | |
| `Accounting.DetailItem` | `View, Create, Edit, Enable, Disable` | |
| `Accounting.Document` | `View, Create, Edit, Delete, Print, Export, Finalize, Approve, Reverse, Correct, Replace` | `Delete` applies **only** to `draft`/`temporary` (§15.3) and must not exist for `final`; `Finalize` ≠ `Approve` (finalize makes it a book entry; approve is the Workflow decision that may precede it — §17.2); `Reverse`/`Correct`/`Replace` are separate authorities, because correcting posted history is an authority of its own (the ADR-0022 `Movement.Reverse` precedent) |
| `Accounting.PostingRule` | `View, Configure` | mapping configuration (§20.2); content expert-gated |
| `Accounting.YearTransition` | `View, Execute` | closing/opening/period-transfer operations (§6.4) |
| `Accounting.Balance` | `View, Rebuild` | projection reads and the audited rebuild (§19.3) |
| `Accounting.LedgerMovement` | `View` | non-statutory ledger-native read source (Task 17A ACCEPTED; read-only access to immutable posted ledger entries) |
| `Accounting.AccountStatement` | `View` | bounded account statement read (Task 17B; one account + one fiscal year + optional period, opening/running/closing derived from the immutable ledger per request; read-only, no mutation code exists — Owner decision D6 authorized this addition to the §22 vocabulary) |
| `Accounting.SystemPosting` | `View, Retry` | inspection and manual retry of rejected/failed system postings (§16.6, §21) — only meaningful once OQ-39 is resolved |

Reports use `Report.<id>.View` codes registered by the Reporting module
(`reporting-strategy.md` §1 item 4); numbering configuration uses the Documents module's
`Document.NumberingSeries.*` (§18). Denials are 401/403 per `docs/security.md` §3, and
scope violations are 404 per §4.

---

## 23. Auditability

**DECIDED requirements (`AC-D-35`).** The Audit module is **not** implemented in this
task and persistent audit remains a separate concern (AR-23, `docs/security.md` §4);
what the contract requires is that Accounting *produces and preserves* the facts audit
needs, in-transaction:

| Requirement | How the contract provides it |
|---|---|
| Who created / changed / finalized / approved, and when | AR-12 columns (`created_by/at`, `updated_by/at`) + `finalized_by/at` (§12.2) + Workflow approval history (ADR-0024 §6/§7: append-only `workflow_transition_history` + `workflow_approvals`) |
| Source of a system document | `source_module/entity_type/entity_id/operation` + `operationKey` + `request_hash` + correlation id (§16.3/§16.4) |
| Reversal / correction / replacement relationships | typed self-links + `correction_kind` + mandatory `correction_reason` (§15.4); both documents remain (AR-13) |
| Period / year / area / organization context | stored on every document and line, resolved at composition and never recomputed (§6.2, §12.2, §12.5) |
| Immutability of Final rows | structural: no update/delete route, no service mutation path (§15.2/§15.3) |
| Numbering evidence | the Foundation's append-only allocation ledger (ADR-0023 §3) |
| Period/year operations evidence | explicit operations with permission, reason, actor and events (§6.3, §7.2, §21) |
| Balance rebuild evidence | permission-gated, audited maintenance operation (§19.3) |
| Sensitive-write audit emission | Accounting calls the kernel audit port inside the business transaction for: document finalization, deletion of temporary documents, corrections/reversals, period and year operations, chart/dimension configuration changes, control-role mapping changes, posting-rule changes, balance rebuilds (`docs/security.md` §4 already lists "all accounting writes") |

---

## 24. Deferred boundaries (must remain possible)

### 24.1 Multi-currency (DEFERRED — OQ-03)

Not implemented; v1 is single base currency (§13.6). The contract keeps it possible:

- the balancing invariant is defined **in base currency** (§13.1), so adding a
  transaction currency means adding line attributes, not redefining the invariant;
- the reserved seam is per-line: `currency_code`, `exchange_rate` (+ rate type/date
  source), transaction-currency amount, and base-currency `debit/credit` — with the
  rate **snapshotted on the line** at composition (historical integrity: documents copy
  the values they used, blueprint §12);
- exchange-rate tables, rate types, revaluation (`تسعیر ارز`) and currency reporting
  are their own future task, expert-gated (OQ-03; Class B reports currency tables and
  daily rates as standard Iranian ERP capability);
- per-account currency constraints are reserved (§8.3) and must not be invented now;
- **no column, table or DTO field is added in this task.**

### 24.2 Multi-company / consolidation (DEFERRED — OQ-22, OQ-31)

Organization remains the tenant boundary (§4) and the candidate legal entity. A
financial area is **not** a company (§5.1). Future multi-company work must not be
pre-empted here:

- no `company_id` column, no inter-company clearing accounts, no inter-area settlement
  documents, no consolidation reports in this contract;
- what the contract *does* guarantee: every accounting fact carries
  (organization, financial area, fiscal year, period), so a future consolidation or a
  second legal entity is a scope question, not a data-model rewrite — and area-level
  aggregation (`تجمیع و تلفیق`, §2.2) can be built as a reporting projection over
  areas without touching the ledger;
- OQ-31 (inter-branch/inter-company treatment) and OQ-22 (separate books per entity)
  remain the owners of that decision; ADR-0026 explicitly does not decide it.

### 24.3 Other explicitly deferred items

Cost allocation (`تسهیم`), budgeting, fixed-asset accounting, treasury/receipts &
payments, payroll posting, parallel accounting/posting layers, voucher templates
(`سند الگو`), electronic attachment archive, statutory e-ledger export formats
(OQ-43), opening-balance import tooling (ADR-0011 path, OQ-04). Each needs its own
analysis; none may be anticipated with speculative columns (AR-29 forbids
architecture-by-anticipation).

---

## 25. Domain invariants (normative)

Each invariant states the rule, where it is enforced, and the failure posture. Later
tasks must implement **all** of them; violating one is a defect (`.vardena/
architecture-rules.md` preamble).

| id | Invariant | Enforced at | Failure posture |
|---|---|---|---|
| **AC-I-01** | Every accounting row belongs to exactly one Organization scope; every by-id read/action is organization-qualified. | service (`mustFindInOrganization`-style) + global pin guard | **404** `EntityNotFound` (never 403) — ADR-0021 §4, ADR-0025 §3 |
| **AC-I-02** | Every accounting document belongs to exactly one Financial Area of its organization, and to a Fiscal Year + Accounting Period of that area, resolved from `document_date`. | domain rule + service | 422 `businessRule` (unresolvable date), 404 (out-of-scope area/year) |
| **AC-I-03** | Fiscal years of one (organization, area) never overlap; periods of one year never overlap and lie inside the year. | domain rule on create/edit | 422 |
| **AC-I-04** | A document may be finalized only into an **open** period of an **open** fiscal year; closed/sealed periods and years reject posting. | finalization transaction (re-check under lock) | 422 `businessRule` (`period_closed` / `year_closed` / `year_sealed`) |
| **AC-I-05** | A **Final** accounting document cannot be edited: no field, line, dimension, date, number or period change. | structural (no mutation path) + Foundation `planEdit` | 422 `final_protected` |
| **AC-I-06** | A **Final** accounting document cannot be deleted, and its lines cannot be deleted. | structural + Foundation `planDelete` (no deletable final phase) | 422 `final_protected` |
| **AC-I-07** | Σ debit = Σ credit **exactly**, with ≥2 lines and at least one debit and one credit line. | domain rule at composition + re-check in the finalization transaction | 422 `unbalanced_document` |
| **AC-I-08** | Line amounts are non-negative; exactly one of debit/credit is non-zero; zero-value lines are rejected; negative amounts are rejected. | domain rule | 422 |
| **AC-I-09** | Only **postable**, active, area-applicable accounts may receive lines; a postable account is always a leaf. | domain rule (posting) + chart maintenance rules (§14 rule 2) | 422 `account_not_postable` / `account_has_children` |
| **AC-I-10** | The account hierarchy stays valid: level = parent level + 1, child code = parent code + the level's segment, no cycles, one root path. | domain rule on create/move | 422 |
| **AC-I-11** | An account `code` is unique within its scope, digits-only, never changed after use and never reused; `parent_id`, `level`, `nature`, `type` and `is_postable` are immutable once the account has lines. | DB unique index + domain rule | 409 (unique violation) / 422 (immutable-after-use) |
| **AC-I-12** | System-generated posting is **idempotent**: one posting-operation row per `(organization_id, operation_key)`, written in the same transaction as the document; same key + same hash replays, same key + different hash is refused. | posting-operation ledger (ADR-0022 §3/§4 pattern) | 200 replay / **409** conflict |
| **AC-I-13** | No source module mutates or reads Accounting persistence; no Accounting query reads another module's tables. Cross-module effects go through the posting contract/events; cross-module reads through public services. | architecture review + module boundary (AR-07/16) | defect (rejected in review) |
| **AC-I-14** | Historical accounting records remain interpretable without current master data: documents store resolved year/period/area, the pinned coding-structure version, and (for system origin) the source reference and rule/mapping identity. | composition rules (blueprint §12/§14, D-21) | defect |
| **AC-I-15** | Corrections never mutate history: reversal/correction/replacement/adjustment produce **new** Final documents with typed links and a mandatory reason; each mechanism is idempotent per (original, mechanism, operation key). | domain rule + posting-operation ledger | 422 / 409 (`already_reversed`) |
| **AC-I-16** | Cross-organization references are forbidden everywhere in Accounting (accounts, areas, years, dimensions, items, branches, parties, documents) and answer as not-found. | service reference resolution | **404** |
| **AC-I-17** | A sealed fiscal year cannot be reopened without a distinct permission, a recorded reason and an audit entry; sealed periods cannot be reopened while the year is sealed. | service + permission check + audit | 403 (permission) / 422 (state) |
| **AC-I-18** | Dimension assignments on a line are legal for the line's account: only attached dimensions, all `required` present, no `forbidden`, one item per dimension, item active and area-applicable. | domain rule + DB unique `(line_id, dimension_id)` | 422 / 409 |
| **AC-I-19** | Balance projections are never the source of truth: they are rebuilt from Final lines by an explicit audited operation and must reconcile with them. | maintenance operation + reconciliation report | defect if divergence is not surfaced |
| **AC-I-20** | No accounting write occurs while accounting is disabled for the organization (D-19), except the explicit, permission-gated enabling operation and chart/calendar configuration needed to turn it on. | service check on the configuration switch | 422 `accounting_disabled` |
| **AC-I-21** | Every accounting action is authorized twice (route guard + application service) with granular codes; there is no wildcard, no superuser and no bypass permission. | AR-21/ADR-0016 | 401 / 403 |
| **AC-I-22** | Document numbers are numeric-only, allocated at most once per business action, unique per series, never reused and never changed after Final. | Documents Foundation (ADR-0023) + §15.2 | 409 / 422 `final_protected` |

---

## 26. Decision register (this contract)

| id | Decision | § | Class |
|---|---|---|---|
| AC-D-01 | Accounting inherits the Task 9.6 organization security posture unchanged; no second tenant mechanism | 4 | A |
| AC-D-02 | Financial Area = Accounting-owned, organization-scoped bookkeeping scope; ≠ organization, ≠ branch, ≠ department, ≠ company | 5.1 | B |
| AC-D-03 | An accounting document belongs directly to exactly one financial area | 5.2 | B |
| AC-D-04 | Chart + coding structure are organization-scoped with area applicability; years/periods/documents/numbering/balances are area-scoped | 5.4 | B |
| AC-D-05 | User↔area is a many-to-many grant with per-user and per-organization defaults; interim posture is structural (caller-supplied) like `organizationId` today | 5.5 | A |
| AC-D-06 | One account tree per organization; `group/general/subsidiary/detail` are configurable level labels, not tables or constants | 8.1 | B |
| AC-D-07 | Accounts = one table, adjacency (`parent_id`) + integer `level` (+ optional rebuildable `path` projection) | 8.2 | A |
| AC-D-08 | Accounts are never deleted, codes never reused; deactivation blocks new usage only | 8.6 | A |
| AC-D-09 | Control roles are code-defined; organizations map accounts to roles once; posting rules reference roles (D-12 hybrid chart) | 8.7 | A |
| AC-D-10 | Coding structure is versioned organization configuration: levels, digit lengths, display separators, max depth, reserved ranges; code-defined hard caps | 9.1 | B |
| AC-D-11 | Detail dimensions are organization-configured (count not hardcoded), typed, capped, reportable | 10.1 | B |
| AC-D-12 | Account↔dimension compatibility is expressed through dimension groups | 10.3 | B |
| AC-D-13 | Per-(account, dimension) `requirement` ∈ {required, optional, forbidden}; the *default policy* is OQ-41 | 10.4 | B |
| AC-D-14 | Line dimension assignments live in a typed child table (not columns, not EAV, not JSONB) | 10.6 | A |
| AC-D-15 | Floating detail = a typed, code-unique, nature-less item outside the account tree, combinable with any compatible account | 11 | B |
| AC-D-16 | One registered accounting document type in v1 (`accounting_voucher`) with two origins (`manual`, `system`); year-transition types are planned, not invented | 12.1 | A |
| AC-D-17 | `branch_id` is a header attribute; a document has at most one branch | 12.4 | A |
| AC-D-18 | Σ debit = Σ credit exactly, ≥2 lines, both sides present; checked at composition and under lock at finalization | 13.1 | A |
| AC-D-19 | Posting eligibility is a validated account attribute; postable ⇒ leaf; the per-level default policy is OQ-25 | 14 | A |
| AC-D-20 | Lifecycle reuses the Foundation verbatim: `draft` phase + `temporary`/`final` states; no `initial`, no `void`, no `deleted` state | 15.1 | A |
| AC-D-21 | `deletablePhases = [draft, temporary]`; Final is never deletable; a discarded numbered voucher leaves an auditable gap | 15.3 | B |
| AC-D-22 | Four additive correction mechanisms (reversal, correction, replacement, adjustment), typed links, mandatory reason, idempotent; `reopen` refused for accounting documents | 15.4 | A |
| AC-D-23 | Finalization is one locked transaction: re-validate, number, state, projections, idempotency row, events, audit | 15.5 | A |
| AC-D-24 | Manual and system origins share one aggregate and one invariant set; they differ in composer and evidence | 16.1 | A |
| AC-D-25 | One source-posting contract for every source module (scope, source identity, operation, idempotency key, date, payload with accounts-or-roles) | 16.3 | A |
| AC-D-26 | The posting interface is delivery-agnostic; transactional-vs-durable delivery is OQ-39 and no production integration is enabled before it is resolved | 16.6 | A |
| AC-D-27 | An operational document produces an accounting document only when accounting is enabled, a rule/contract exists, and the posting mode says so | 17.1 | A |
| AC-D-28 | Posting Mode A (direct final) / Mode B (review then finalize) are configuration over the existing Foundation entry states + Workflow approvals | 17.2 | B |
| AC-D-29 | Accounting consumes Document Foundation numbering; a fiscal-year component would be a new Foundation strategy, never an Accounting fork | 18 | A |
| AC-D-30 | Reports read Final lines via Accounting-owned views consumed by Reporting; period filters are stored-column predicates; column variants are layouts | 19.2 | A |
| AC-D-31 | Balances are a rebuildable projection, never the ledger; materialization mechanism deferred to the balance task | 19.3 | A |
| AC-D-32 | Inventory→Accounting is contract/event-only both ways; traceability without cross-module SQL; activation gated on OQ-24/25/30/39 | 20 | A |
| AC-D-33 | Accounting reuses the kernel event bus + `core.domain_events`; no second event architecture; durability is OQ-39 | 21 | A |
| AC-D-34 | Granular `Accounting.*` permission vocabulary; no wildcards; `Finalize` ≠ `Approve`; corrections are their own authorities | 22 | A |
| AC-D-35 | Accounting produces and preserves all audit facts in-transaction; persistent audit stays the Audit module's concern | 23 | A |

*Class = the benchmarking class (§2) that motivated the decision; it does not weaken
it — every row is a Vardena architecture decision.*

---

## 27. Open questions raised or updated by this contract

New (**full text in [`../open-questions.md`](../open-questions.md)**):

| id | Area | One-line question |
|---|---|---|
| **OQ-39** | Accounting / Events | Durable event & outbox semantics for system-generated posting: transactional subscription (ADR-0005) or durable queue (AR-14), and what happens to a source document whose posting is rejected? |
| **OQ-40** | Accounting | Financial Area semantics: how many per organization, separate charts?, user access grants in v1?, default area, consolidation/aggregation? |
| **OQ-41** | Accounting | Detail dimensions: how many, are attached dimensions independently optional/required, which dimensions must bind to master data, item governance? |
| **OQ-42** | Accounting | System-posting mode: default Mode A vs Mode B per source type, who may finalize/approve, what rejection means for the source document? |
| **OQ-43** | Accounting / Legal | Which Iranian statutory requirements (legal books, entry timing, language/currency, no deletion from electronic books, e-invoice/Art. 169, retention) constrain the accounting model? Validate with an accountant + current authoritative sources. |

Updated with Task 10.1 notes (no new OQ, to avoid duplicating settled scope):

| id | Note added |
|---|---|
| OQ-03 | base-currency invariant + the reserved per-line currency/rate seam (§13.6, §24.1) |
| OQ-11 | the contract now fixes the *shape* (immutable balanced documents, stored period resolution); what remains open is policy |
| OQ-12 | accounting numbering consumes the Foundation; a fiscal-year component would be a new `strategy` (§18) |
| OQ-23 | multiple simultaneously open periods, `sealed` year state, year-transition operations, reopen authority (§6, §7) |
| OQ-25 | coding-structure configurability, posting eligibility per level, account freeze guards, control-role list (§8, §9, §14) |
| OQ-27 | the four correction mechanisms and their windows/period rules (§15.4) |
| OQ-31 | financial area ≠ company; consolidation stays deferred (§5.1, §24.2) |

Explicitly **not** raised (already settled by existing architecture, per Task 10.1 §28):
organization scoping and the 404 posture (ADR-0021/0022/0025), idempotency mechanics
(ADR-0022 §3/§4), numbering allocation and gaps-by-policy (ADR-0023), workflow
approval mechanics and version pinning (ADR-0024), document phase vocabulary
(ADR-0023/Task 8 §7), reporting access pattern (ADR-0009), inventory ledger truth
(ADR-0017/0022), event naming/bus (ADR-0005/0024 §9), no-wildcard RBAC (OQ-21),
no-deletion master-data lifecycle (OQ-36).

---

## 28. Implementation gates and sequencing

### 28.1 Gate for Task 10.2 — Fiscal Year + Financial Area Foundation

| Precondition | State |
|---|---|
| ADR-0026 (bounded context, calendar/area ownership) accepted | **Proposed** — needs accept/reject |
| Financial-area multiplicity & chart-scope assumption recorded | recorded as the OQ-40 interim assumption (one area by default, model permits more, one organization-scoped chart, no consolidation) |
| Fiscal-year/period *policy* (open/close/seal/reopen authority, layout) | **not** required for the shape: statuses, transitions and permissions are defined here; the *policy* stays OQ-23 and only gates closing automation |
| Organization security posture | already accepted (ADR-0021/0022/0025) — inherit verbatim |

⇒ **Task 10.2 is not blocked** by an accounting-policy OQ, provided it implements the
shape of §5, §6, §7 (plus §4 scoping) and no posting/closing automation.

### 28.2 Gates for later tasks

| Task (indicative) | Hard gate |
|---|---|
| Chart of accounts + coding structure | OQ-25 (levels, code lengths, eligibility policy, control-role list) — the *mechanism* (§8, §9) may be built first with configuration empty |
| Detail dimensions + items | OQ-41 (count, requiredness default, binding policy) |
| Accounting documents + finalization | OQ-12 (numbering year component, gaps), OQ-03 (precision/currency), OQ-23 (period policy for posting), OQ-27 (correction windows) |
| Reporting (ledgers, trial balances) | OQ-25/OQ-43 (statutory layouts); ADR-0009 mechanics already accepted |
| Inventory → Accounting posting | OQ-24 (valuation), OQ-25/OQ-30 (mappings/tax), **OQ-39 (delivery durability)** |
| Any production system-generated posting | **OQ-39** (AC-D-26) |
| Statutory/e-ledger features | **OQ-43** validation with an accountant and current authoritative sources |

### 28.3 What must be true before *any* Accounting migration

1. ADR-0026 accepted (or superseded) — it moves fiscal-calendar ownership out of
   ADR-0020 §2 and must not be contradicted silently (AG-17).
2. `docs/modules.md` Accounting entry and the event catalog updated in the same change
   as the module (AG-07).
3. The permission registry for `Accounting.*` written with its denial tests (AG-13).
4. No table created for a DEFERRED concept (§24) — speculative columns are forbidden
   (AR-29).

---

## 29. Traceability — Task 10.1 brief → this contract

| Brief § | Contract § | Outcome |
|---|---|---|
| 1 objective, 35 principle | 0, 1 | contract established; no code |
| 2 do not implement | 1.2, 1.3, 28.3 | non-goals + scope compliance |
| 3 research requirement | 2 (A/B/C classes + provenance) | benchmarking separated from legal assumptions; OQ-43 |
| 4 architecture constraints | 3.1, 4, 16.2, 20.1 | Modular Monolith, vertical slices, contracts, events, outbox boundary preserved |
| 5 boundaries | 3.2 (four categories + concept inventory) | accounting vs operational vs reporting vs integration |
| 6 organization scope | 4 | 8 explicit statements inherited from Task 9.6 |
| 7 financial area | 5 | ≠ organization/branch; users, defaults, lifecycle, area↔document |
| 8 fiscal year | 6 | Open/Closed/Sealed; no `initial`, no `void`; transition mechanics |
| 9 accounting period | 7 | period rows; multiple open periods; locks; policy → OQ-23 |
| 10 chart of accounts | 8 | one tree, configurable levels, nature/type/postable, freeze rules |
| 11 configurable coding | 9 | levels, digits, separators, depth, uniqueness, reserved ranges, immutability, versioning |
| 12 detail dimensions | 10 | configurable count, groups, compatibility, line assignment, requiredness → OQ-41 |
| 13 floating detail | 11 | defined; distinguished from hierarchy/party/cost centre/branch/employee; not JSON |
| 14 manual vs system | 16 | source contract fields; idempotency; authorization |
| 15 operational vs accounting document | 17 | chain + Mode A/B configurable |
| 16 document lifecycle | 15.1–15.3 | Temporary/Final; no Draft/Void/Deleted states; Final protected |
| 17 debit/credit model | 13 | invariant, positivity, precision, rounding, totals, currency boundary |
| 18 posting eligibility | 14 | attribute + leaf invariant; policy → OQ-25 |
| 19 numbering | 18 | Foundation reuse; fiscal-year component path; immutability |
| 20 reporting boundary | 19 | report inventory; views/projections; layouts vs models |
| 21 Inventory boundary | 20 | contract/event only; where each concern belongs; activation gate |
| 22 event/outbox decision | 21, 16.6 | OQ-39; in-memory bus explicitly not durable |
| 23 security/RBAC | 22 | granular vocabulary, no wildcards, no single role assumption |
| 24 auditability | 23 | requirements; Audit module not implemented |
| 25 multi-currency | 24.1 | deferred with an explicit seam |
| 26 multi-company | 24.2 | deferred; OQ-22/OQ-31 remain owners |
| 27 invariants | 25 | AC-I-01 … AC-I-22 |
| 28 open questions | 27 | 5 new, 7 annotated, settled items explicitly not re-raised |
| 29 ADR requirement | ADR-0026 (Proposed) | one ADR for one real decision; nothing else invented |
| 30 required documents | this file + ADR-0026 + index updates | §28.3 lists the doc-sync obligation |
| 31 no DB changes | 1.3 | Prisma schema unchanged, no migration |
| 32 no frontend changes | 1.3 | no frontend file touched |
| 33 verification | 30 (below) | contradiction check + link check; no fabricated test results |

---

## 30. Verification performed in Task 10.1

| Check | Result |
|---|---|
| Prisma schema unchanged (`backend/prisma/schema/*.prisma`) | ✅ no change |
| No migration added (`backend/prisma/migrations/`) | ✅ no change |
| No backend/frontend source change | ✅ docs only |
| No contradiction with Task 9.6 (ADR-0022 §8, ADR-0025) | ✅ §4 inherits the posture verbatim, including the 404-not-403 rule and the pin guard |
| No contradiction with ADR-0022 | ✅ idempotency ledger, hash-only-client-intent, freeze-over-delete and in-transaction policy evaluation are reused, not redefined |
| No contradiction with ADR-0023 | ✅ numbering, type registry, logical references, phase vocabulary reused; no accounting numbering fork |
| No contradiction with ADR-0024 | ✅ approvals/version pinning/in-memory-bus gap reused; Mode B is workflow configuration |
| No contradiction with the organization security model | ✅ §4, AC-I-01/16/21 |
| No contradiction with the Document Foundation | ✅ §15.1, §18 |
| No contradiction with the Workflow Foundation | ✅ §17.2 |
| No direct Inventory → Accounting table dependency proposed | ✅ §20.1, AC-I-13 |
| No universal document table introduced | ✅ §3.3, §12.1 |
| No EAV accounting model introduced | ✅ §10.6 |
| No generic JSONB accounting model introduced | ✅ §3.3, §10.6, §12.6 |
| Existing tests unchanged / no fabricated results | ✅ no test was run or added: this is a documentation/domain-analysis task |
| Documentation link consistency | ✅ relative links in the new/updated docs resolve (checked mechanically) |

**Known documentation contradictions found and flagged (AG-17), not silently resolved:**

1. `docs/modules.md` (Organization entry) and ADR-0020 §2 give the **fiscal calendar**
   to the Organization module, while `accounting-domain-analysis.md` §1 and blueprint §9
   give periods/calendar to Accounting. ADR-0026 proposes the Accounting ownership and
   records the supersession; `docs/modules.md` now carries a pointer instead of a silent
   edit.
2. ADR-0020 §2 also gives numbering series and workflow definitions to Organization;
   ADR-0023 and ADR-0024 (both Accepted) already moved them to the Documents and
   Workflow modules. `docs/modules.md`'s Organization entry is stale in the same way;
   this task flags it without rewriting unrelated history (AG-03).
3. `.vardena/project-context.md` still says "Documentation-only. No application code
   exists yet", which has been untrue since the backend foundation. Out of Task 10.1
   scope; flagged for a separate docs-sync task.

---

## 31. Owner Decision Consolidation Addendum (Task 17C, 2026-09-25 — pointer only)

**This section changes no decision, no status and no behaviour.** It exists so that a
future reader of this contract cannot miss that the Repository Owner took a set of
Accounting decisions on 2026-09-25 that refine parts of it, and so that nobody
re-derives those answers from scratch (AG-17: record, don't assume).

- **Authoritative record:** [`docs/accounting/owner-decision-baseline.md`](./owner-decision-baseline.md)
  — Owner decisions **Q1–Q22** plus the three mandatory invariants (**I-1** Account
  identity, **I-2** POSTING XOR AGGREGATION, **I-3** code migration never rewrites
  economic ledger history), each reconciled against current `main`, with every
  discrepancy and every remaining implementation-level question listed.
- **Received Owner prompt (source of the decisions):**
  [`docs/tasks/task-17/task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md).
- **ADRs created (all Proposed — none Accepted by that documentation task):**
  [ADR-0033](../adr/0033-account-identity-and-code-history.md) identity + code
  history · [ADR-0034](../adr/0034-posting-versus-aggregation-accounts.md) posting vs
  aggregation · [ADR-0035](../adr/0035-account-code-structure-migration.md) code
  structure migration · [ADR-0036](../adr/0036-legal-reporting-architecture.md) legal
  reporting architecture · [ADR-0037](../adr/0037-accounting-configuration-boundary.md)
  configuration boundary.

Contract sections those ADRs **refine** (the contract text below is untouched; per §0 a
DECIDED row changes only through a superseding ADR, and per `docs/accounting/task-index.md`
§7 an implementation needs its own defined task):

| Contract section | Owner decision | Effect |
|---|---|---|
| §8.3 `code` "immutable once created", §8.4 rule 4, §9.5 | Q3 + OD-20-4 | A code change **before first accounting use** is permitted-in-principle through a future controlled producer (the repository is stricter today: no code-edit path exists). After use, ordinary code change is forbidden; only ADR-0035's controlled migration can change representation/history. Baseline discrepancy **D-2** remains implementation-only. |
| §8.5 rollup, §14 rule 2 (AC-D-19), §25 AC-I-09 (postable ⇒ leaf) | Q5 + I-2 + OD-20-5 | **D-1 resolved:** `POSTING = leaf-only`; `AGGREGATION = reporting/read-time roll-up`. The existing leaf rule is the product rule, not merely a temporary stricter implementation. Non-leaf posting, own-vs-descendant measures and double-counting workarounds are not authorized; a future exception requires a new explicit architecture decision. |
| §8.6 (AC-D-08) freeze-over-delete | Q21 | Deletion becomes permitted-in-principle for an account with **no** historical accounting usage and no blocking reference; used accounts are deactivated, never deleted; a zero balance is **not** proof of no usage. The repository implements the stricter half only. Baseline discrepancy **D-4**. |
| §8.7 control roles (AC-D-09), §1.2 non-goal 1 | Q2 + Q4 + OD-20-1…OD-20-3 | Vardena's Base Chart is a versioned Accounting-owned product/database template adopted explicitly into an organization, creating organization-owned Account identities; its content stays EXPERT-GATED (OQ-25). Control roles are consumer-first, not a speculative catalog, and the account↔role artifact is an independent effective-dated mapping — not `Account.control_role`. Nothing exists in code. Baseline discrepancy **D-5** remains implementation-only. |
| §9.4 "any migration of existing accounts is an explicit, permission-gated, audited operation (OQ-25)" | Q8 + Q19 + I-3 | That operation is now named and shaped: the **Accounting Code Structure Migration Service** (controlled, licensed, preflight → impact → dry run → plan → approval → license → backup point → migration → reconciliation → audit). Level-count changes are **excluded** (Q20). Not implemented; ADR-0030/OQ-45 licensing is a prerequisite. |
| §8.3/§9.2 code as one value per account | Q18 + I-1 | `Account.id` is the permanent identity; a code is a **time-scoped** business identifier with history, and historical reports resolve the code valid in the reported context. Needs an additive schema task. Baseline discrepancy **D-3**. |
| §12.3 two dates, §19.2 rule 3 stored-column filters | Q14 | Confirmed and elevated to an explicit reporting rule: `document_date` = financial-reporting axis, `posting_timestamp` = audit/event-timing axis; Fiscal Year, Accounting Period, Document Date and Posting Timestamp stay four distinct concepts. |
| §19.1 report inventory, §19.4 | Q10 + Q15 + Q16 | The journal (`دفتر روزنامه`) and the general ledger (`دفتر کل`) are **independent** report definitions over one read source; **Account Statement** is the unified account performance/turnover concept (Task 17B's surface); **Account Overview** («مرور حساب») is a presentation over the same read source and calculations — never a second engine. |
| §2.3 Class C, §19.4 "no statutory layout hardcoded before OQ-43 validation" | Q9 + Q11 + Q22 | Architecture decided: `Accounting Core → Legal Adapter / Legal Profile → {Iran, future}` (ADR-0036). Persian is the primary language; the base monetary unit is configurable (Rial/Toman) with conversion as presentation only. **No legal fact is decided or claimed** — OQ-43 stays OPEN. |
| §10/§11 dimensions and floating detail (AC-D-11…AC-D-15) | Q6 + Q7 + OD-20-6 | Confirmed and refined: tree-based **and** floating details, a configurable typed dimension model with per-(account, dimension) `required`/`optional`/`forbidden`, never EAV/JSONB. Initial dimension assignments are transaction-line-level analytical assignments; aggregation is through Accounting/read logic when a concrete reporting consumer requires it. No ledger-column widening or speculative projection. Still unimplemented; OQ-41 stays OPEN for content/governance. |
| §15 lifecycle/corrections (AC-D-20/21/22, AC-I-05/06/15) | Q12 + Q13 | Confirmed: non-final documents may be edited/discarded under permissions; Final/Posted documents are immutable and corrected only by counter-documents; Final/legal history is never physically deleted. OQ-27 (windows) and OQ-54 (non-accounting documents) stay OPEN; only `reversal` is implemented today. |
| §25 invariants, §22 permissions, §4 organization scope | Q17 | Configurability principle: high configurability, never unrestricted — configuration may not violate the AC-I invariants, authorization, auditability, tenant isolation or data integrity (ADR-0037 §8). |

**Open Questions are unaffected in status:** OQ-25 and OQ-43 remain **OPEN** in
[`docs/open-questions.md`](../open-questions.md) (annotated with what is now Owner
Decided versus what stays an implementation detail or requires legal validation), as do
OQ-02/03/23/27/36/41/45/49/52/53/62/63.

---

## 32. Task 20 Owner Decision Resolution Addendum (2026-09-26 — documentation only)

Task 20 resolved the six Owner Decisions originally proposed by the Task 20
investigation. This addendum records the resolution boundary; it does not authorize
production implementation and does not reopen Task 19.

| Decision | Original question | Owner decision | Architectural consequence | Implementation status |
|---|---|---|---|---|
| OD-20-1 | What is the Base Chart artifact and adoption model? | Versioned Base Accounting Chart template, Accounting-owned as a database/product asset; explicit adoption into an organization creates organization-owned `Account` identities. Template identities never become ledger references. | Future adoption must create coherent ODR-1 pin pairs and pass ODR-3 authorization. Actual account content is not invented by agents and requires explicit accounting approval. | Deferred; no template tables, seed data, adoption service or API. |
| OD-20-2 | Should control roles be catalog-first or consumer-first? | Consumer-first. Do not create a speculative generic catalog. | A control role is introduced only with a concrete approved consumer that justifies the role and semantics. | Deferred; no role table/enum/seed/API/service. |
| OD-20-3 | Is role association a column or mapping? | Independent effective-dated Account↔Control Role assignment. | `Account.control_role` is rejected as the primary architecture; future mapping must support history, reassignment, auditability and identity preservation. | Deferred until a real consumer requires roles. |
| OD-20-4 | How do Account identity, code edits and code history interact? | `Account.id` is permanent identity; `Account.code` is the business-facing address. Controlled pre-use code correction is permitted; after accounting use code is immutable. | History is designed with the code-change producer so permitted transitions are auditable/reconstructable; no producer means no speculative history table. | Deferred; no code-change operation or history schema. |
| OD-20-5 | Is posting allowed on non-leaf nodes? | **POSTING = leaf-only**; **AGGREGATION = reporting/read-time roll-up**. | D-1 is resolved. Existing ADR-0034/read models remain valid; no non-leaf posting, no duplicate parent postings, no own-vs-descendant workaround. | No implementation required. Future non-leaf posting would need a new explicit decision. |
| OD-20-6 | Where do dimensions live initially? | Transaction-line-level analytical assignments with aggregation through the Accounting/read layer for concrete reporting consumers. | Dimensions are not `LedgerEntry` identity; no arbitrary ledger dimension columns, no generic JSONB, no speculative projection. | Deferred; no dimensions schema/API/UI/report endpoint/projection. |

Task 19 integrity is unchanged: ODR-1, ODR-2 and ODR-3 remain exactly as accepted.
Future Base Chart adoption/configuration must produce a coherent
`coding_structure_version` + `accounting_configuration` pair, and future Base Chart,
Control Role and Dimension surfaces must reuse the ODR-3 membership chokepoint.
