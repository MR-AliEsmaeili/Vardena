# ADR-0036: Legal Reporting Architecture — Accounting Core → Legal Adapter / Legal Profile (Iran first, jurisdictions later)

- **Status:** Proposed — **Task 17C is accepted, but this ADR remains Proposed pending its separate adoption/implementation gate** (2026-09-25; Owner decisions Q9/Q10/Q11/Q22, recorded 2026-09-25 by Task 17C — documentation only; **not Accepted**, no self-acceptance; acceptance record: [`task-17c-acceptance-record.md`](../tasks/task-17/task-17c-acceptance-record.md) §ADR status handling)
- **Date:** 2026-09-25
- **Implements:** nothing. No Legal Book, legal profile, statutory layout, export, print, e-ledger or filing capability is created, scaffolded or authorized, and no statutory format is authorized merely by this ADR.
- **Owner source:** [`task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md) Q9/Q10/Q11, Q14 (Decision D), Q22 (Decision B), §8. Canonical register of Q1–Q22, I-1…I-3 and the implementation discrepancies (incl. **D-6**, **D-13**): [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) — referenced here, never restated.
- **Why a new ADR:** the repository had no authoritative equivalent — contract §2.3 (C1–C7) records *reported* Iranian legal inputs as OQ-43 material, ADR-0009 + [`reporting-strategy.md`](../reporting-strategy.md) decide the reporting *access* pattern, and layer 4 of the four-layer boundary ("legal/statutory report profile") existed only as a proposal in [`task-17b-investigation.md`](../tasks/task-17/task-17b-investigation.md) §8.1. This ADR adopts that layer as architecture; it does not restate the envelope design.
- **Builds on:** ADR-0026/0009/0003/0033; contract §2.3, §12.3, §19.1/§19.2/§19.4, AC-D-30; OQ-43 (legal facts), OQ-02, OQ-03, OQ-12/OQ-17/OQ-27.
- **Later date/time clarification (ADR-0042, Accepted 2026-10-09):** references in this 2026-09-25 proposal to Jalali calendar choice remaining in OQ-02, or to there being no frontend, are historical. Generic BusinessDate input/display and Instant zone/calendar behavior are now governed by ADR-0042 and organization settings. OQ-02 remains open for Persian numerals and broader localization; statutory language, layout, currency, and filing decisions remain with the Legal Profile and OQ-43/OQ-03.

## Context

Iranian statutory requirements (enumerated in contract §2.3 C1–C7 and OQ-43) are recorded in the repository as **reported external inputs to validate**, never as rules, columns or constants. The Owner has now decided the *architecture* that keeps it that way (Q22, Decision B) and the sequencing (Q9: legal books after Accounting Core). No legal profile model, module or table exists ([`reporting-sample-audit.md`](../tasks/task-17/reporting-sample-audit.md) item 19) and no statutory report is implemented. The Accounting read surfaces are the ledger movement source (Task 17A), the account statement (Task 17B) and — since Task 18 (ACCEPTED 2026-09-25, PR #46 merged in `e774a1c`) — the General Ledger and Trial Balance read APIs, all **ACCEPTED** ([`task-17b-acceptance-record.md`](../tasks/task-17/task-17b-acceptance-record.md), [`task-18-acceptance-record.md`](../tasks/task-18/task-18-acceptance-record.md)) and **none of them a legal surface**; the Journal Book and every statutory/legal book remain unimplemented and this ADR's decision is unchanged by that acceptance.

## Decision

1. **Layering (Q22, Decision B).**

   ```text
   Accounting Core (generic double-entry semantics: accounts, coding structure,
                    documents, ledger, periods, balances, statements)
         |
         v
   Legal Adapter / Legal Profile (jurisdiction-specific: book definitions, column sets,
                                  layouts, ordering/timing rules, language & currency
                                  presentation, filing/export formats, retention, e-books)
         |
         +--> Iran Legal Profile (first)
         +--> future jurisdictions / profiles
   ```

   The Core never imports profile semantics and legal reporting never contaminates Core ledger or domain calculations; a profile consumes Core read sources through the module boundary (AR-07, ADR-0009 view-first) and adds presentation, validation and filing obligations on top.
2. **No jurisdiction-specific semantics in the Core (Q9/Q22).** Forbidden inside `backend/src/modules/accounting/`: a statutory column set, a legal-book type constant, taxpayer-group logic, an Article 95/169 rule, a book-registration or sealing state, an e-ledger format, a statutory retention constant, any "Iran-only" branch in domain logic. Statutory content lives in a **versioned, expert-approved profile** whose *content* stays gated by **OQ-43** and must be validated against authoritative current sources before any statutory feature is built (Q22 closing clause). Legal books are implemented **after** Accounting Core; no Core capability may depend on a legal book existing.
3. **Journal Book and General Ledger are independent reports (Q10).** `دفتر روزنامه` (chronological listing of Final documents by `document_date` + number) and `دفتر کل` (per-account rollup) are two report definitions over the **same** immutable ledger rows (contract §19.1; C1). They must not be collapsed into one report, definition or surface merely because they share data — one read source, two definitions, no duplicated calculation engine ([`reporting-strategy.md`](../reporting-strategy.md) §1/§5).
4. **Language and monetary unit (Q11).** Persian is the primary system language — Persian-capable titles are already first-class (contract §2.3 C4, §8.3) — while display localization stays **OQ-02**. The base monetary unit is configurable, including Rial and Toman, and a Rial input may be displayed with a Toman conversion as **presentation only**: one stored amount, one stored unit, no second stored value, no derived rounding (AR-05/AR-12, contract §13.5). The unit/precision *mechanism* stays **OQ-03** (`numeric(18,2)`, no currency column — the §13.6/§24.1 seam is dormant; baseline D-6). Statutory language/currency presentation (C4) is a **Legal Profile** concern, never a Core constant.
5. **Identity model (prompt §8).** Legal reporting uses the same `Account.id` identity (ADR-0033 §1); a Legal Profile must **not** treat `Account.code` as permanent identity, and a statutory report covering a historical period resolves the code valid in that period (ADR-0033 §4) — including for legal books, whose entries must stay interpretable as originally recorded (AC-I-14).
6. **Time axes (Q14, Decision D) are the contract a profile builds on.** `document_date` is the financial-reporting axis, `posting_timestamp` the audit/event-timing axis; Fiscal Year, Accounting Period, `document_date` and `posting_timestamp` stay four distinct concepts, never substitutes (contract §12.3, C3). Period/year filters remain predicates on **stored** `fiscal_year_id`/`accounting_period_id` resolved from `document_date` (§19.2 rule 3) — a profile may not re-derive a period from a timestamp. Any statutory entry-delay/timing rule is measured on `posting_timestamp` and reported, never used to re-date history.
7. **External filing systems stay adapters.** The Taxpayer System, e-invoice and similar submissions are Integration concerns behind adapters + outbox (ADR-0003/0004, OQ-05/OQ-30/OQ-51) — not part of the Legal Profile model, which owns book/report *semantics and layout*, not transport.

## Current implementation boundary / non-goals

Nothing listed in **Implements** above exists or is scaffolded — no legal profile model/module/table, statutory report, layout, column set, export, print, e-ledger or filing capability. **Iranian legal requirements are NOT declared implemented by Task 17C, and OQ-43 remains OPEN** — this ADR decides *where* legal semantics live, never a legal fact. A future Legal Profile task must define the profile object with its versioning/approval/evidence model, its permission codes (AR-22), its read-source consumption and its export/print delegation (ADR-0012) — after passing [`task-index.md`](../accounting/task-index.md) §7. **This ADR is not a legal reporting specification.**

## Consequences

- **No legal claim is made.** No compliance, statutory-correctness, e-ledger or filing claim is made by this ADR or may be derived from it; every legal fact stays with OQ-43 (LEGAL VALIDATION REQUIRED).
- A profile is additive, not a rewrite: the Core already guarantees immutable Final documents (AC-I-05/06), an insert-only ledger, stored year/period resolution, both date axes and freeze-over-delete (contract §2.3 C1–C7).
- Risk recorded: implementing a 4/6/8-column trial balance, a legal-book layout or a Toman/Rial statutory rule inside the Accounting module violates §2 and must be rejected in review (AG-07/AR-29), however urgent the request.
- Q11's Persian-primary decision does not settle Persian-digit preference or broad UI language localization (OQ-02), and it authorizes no statutory-format implementation. Generic calendar/zone input and display are covered by the later accepted ADR-0042; this Legal Profile ADR remains Proposed and does not alter that contract.

## Links

- Register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (D-6, D-13, O-6, O-8, O-12) · Contract: [`domain-contract.md`](../accounting/domain-contract.md) §2.3 (C1–C7), §12.3, §19, §31 addendum · Reporting: [`reporting-strategy.md`](../reporting-strategy.md), ADR-0009, [`task-17b-investigation.md`](../tasks/task-17/task-17b-investigation.md) §8.1
- Related: ADR-0003, ADR-0004, ADR-0012, ADR-0033, OQ-02, OQ-03, OQ-05, OQ-12, OQ-17, OQ-27, OQ-30, OQ-43, OQ-51
