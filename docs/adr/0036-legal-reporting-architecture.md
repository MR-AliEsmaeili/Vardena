# ADR-0036: Legal Reporting Architecture — Accounting Core → Legal Adapter / Legal Profile (Iran first, jurisdictions later)

- **Status:** Proposed (Owner decisions Q9/Q10/Q11/Q22 recorded 2026-09-25 —
  Task 17C, documentation only; **not Accepted**, no self-acceptance)
- **Date:** 2026-09-25
- **Implements:** nothing. No Legal Book, legal profile, statutory layout, export,
  print, e-ledger or filing capability is created or authorized by this ADR.
- **Owner source:** [`docs/tasks/task-17/task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md)
  Q9, Q10, Q11, Q22 (Decision B), §8
- **Register:** [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (rows Q9/Q10/Q11/Q22, discrepancies **D-6**, **D-13**)
- **Why a new ADR:** the repository has **no** authoritative equivalent. Contract
  §2.3 (Class C1–C7) records *reported* Iranian legal inputs as OQ-43 material and
  guarantees only that they stay expressible; ADR-0009 + `docs/reporting-strategy.md`
  decide the reporting *access* pattern, not a legal layer; the four-layer boundary
  (layer 4 "legal/statutory report profile") exists as a **proposal** in
  [`task-17b-investigation.md`](../tasks/task-17/task-17b-investigation.md) §8.1 and
  [`next-step-recommendation.md`](../tasks/task-17/next-step-recommendation.md) §5.
  This ADR adopts that layer as architecture; it does not restate the envelope design.
- **Builds on:** ADR-0026, ADR-0009, ADR-0003 (adapter isolation precedent),
  ADR-0033 (identity/code history); contract §2.3, §19.1/§19.2/§19.4, AC-D-30;
  OQ-43 (legal facts), OQ-02 (localization), OQ-03 (currency), OQ-12/OQ-17/OQ-27

## Context

Iranian statutory requirements (legal books under Art. 95 of the Direct Taxes Act and
the Commercial Code, book registration/sealing, chronological journal entry and delay
limits, books in Persian and the Iranian currency, no deletion from electronic books,
branch operations in head-office books, Art. 169 seasonal reports, the Taxpayer
System / e-invoice law, retention windows) are recorded in the repository as
**reported external inputs to validate** (contract §2.3 C1–C7, OQ-43) — never as rules,
columns or constants. The Owner has now decided the *architecture* that keeps it that
way (Q22, Decision B) and the sequencing (Q9: legal books after Accounting Core).
No legal profile model, module or table exists today
([`reporting-sample-audit.md`](../tasks/task-17/reporting-sample-audit.md) item 19),
and no statutory report is implemented — the only Accounting read surfaces are the
ledger movement source (Task 17A, ACCEPTED) and the account statement (Task 17B).

## Decision

1. **Layering (Q22, Decision B).**

   ```text
   Accounting Core (generic double-entry semantics: accounts, coding structure,
                    documents, ledger, periods, balances, statements)
         |
         v
   Legal Adapter / Legal Profile (jurisdiction-specific: book definitions, column
                                  sets, layouts, ordering and timing rules,
                                  language/currency presentation, filing/export
                                  formats, retention and e-book obligations)
         |
         +--> Iran Legal Profile (first)
         +--> future jurisdictions / profiles
   ```

   The Core never imports profile semantics; a profile consumes Core read sources
   through the module boundary (AR-07, ADR-0009 view-first) and adds presentation,
   validation and filing obligations on top.
2. **No jurisdiction-specific semantics in the Core (Q9/Q22).** Forbidden inside
   `backend/src/modules/accounting/`: a statutory column set, a legal-book type
   constant, taxpayer-group logic, an Article 95/169 rule, a book-registration or
   sealing state, an e-ledger format, a statutory retention constant, or any
   "Iran-only" branch in domain logic. Statutory content lives in a **versioned,
   expert-approved profile** whose *content* remains gated by OQ-43 and must be
   validated against authoritative current sources before any statutory feature is
   built (Q22 closing clause). Legal books are implemented **after** Accounting Core;
   no Core capability may depend on a legal book existing.
3. **Journal Book and General Ledger are independent reports (Q10).** `دفتر روزنامه`
   (chronological listing of Final documents by `document_date` + number) and
   `دفتر کل` (per-account rollup) are two report definitions over the **same**
   immutable ledger rows (contract §19.1 lists them separately; C1). They must not be
   collapsed into one report, one definition or one surface merely because they share
   data — one read source, two definitions, no duplicated calculation engine
   (`reporting-strategy.md` §1/§5).
4. **Language and monetary unit (Q11).** Persian is the primary system language:
   Persian-capable titles are already first-class (contract §2.3 C4, §8.3;
   `accounts.title VARCHAR(200)`), while display localization/formatting remains
   **OQ-02**. The base monetary unit is configurable, including Rial and Toman, and a
   Rial input may be displayed with a Toman conversion — as **presentation only**:
   one stored amount, one stored unit, no second stored value, no derived rounding
   (AR-05/AR-12, contract §13.5, exact decimal strings). The unit/precision
   *mechanism* stays **OQ-03** (`numeric(18,2)`; no currency column exists on
   `ledger_entries` or the projection — the §13.6/§24.1 seam is dormant; discrepancy
   D-6). Statutory language/currency presentation (books kept in Persian and the
   Iranian currency, C4) is a **Legal Profile** concern, never a Core constant.
5. **Identity model (prompt §8).** Legal reporting uses the same `Account.id`
   identity (ADR-0033 §1). A Legal Profile must **not** use `Account.code` as
   permanent identity, and a statutory report covering a historical period resolves
   the code valid in that period (ADR-0033 §4) — including for legal books, whose
   entries must remain interpretable as originally recorded (AC-I-14).
6. **Time axes (Q14, Decision D) are the reporting contract a profile builds on.**
   `document_date` is the financial-reporting axis; `posting_timestamp` is the
   audit/event-timing axis; Fiscal Year, Accounting Period, `document_date` and
   `posting_timestamp` remain four distinct concepts, never substitutes for one
   another (contract §12.3, C3; `ledger_entries` stores all of them). Period/year
   filters stay predicates on **stored** `fiscal_year_id`/`accounting_period_id`
   resolved from `document_date` (§19.2 rule 3) — a profile may not re-derive a period
   from a timestamp. Any entry-delay/timing rule a statute imposes is measured on
   `posting_timestamp` and reported, never used to re-date history.
7. **External filing systems stay adapters.** The Taxpayer System, e-invoice and
   similar submissions are Integration concerns behind adapters + outbox (ADR-0003,
   ADR-0004, OQ-05/OQ-30/OQ-51) — they are not part of the Legal Profile model, which
   owns book/report *semantics and layout*, not transport.

## Consequences

- OQ-43 stays **OPEN**: this ADR decides architecture (where legal semantics live),
  never legal facts. No compliance, statutory-correctness, e-ledger or filing claim is
  made by it, and none may be derived from it.
- A future Legal Profile task must define, at minimum: the profile object and its
  versioning/approval/evidence model (who signed which legal source, which effective
  dates), its permission codes (AR-22), its read-source consumption (layer 1 of
  `task-17b-investigation.md` §8.1), and its export/print delegation (ADR-0012,
  `reporting-strategy.md` §6) — and must pass `docs/accounting/task-index.md` §7 first.
- The Core's existing guarantees are what make a profile additive rather than a
  rewrite: immutable Final documents (AC-I-05/06), insert-only ledger (Task 10.7),
  stored year/period resolution, both date axes, append-only numbering allocations
  (ADR-0023 §3 — C2 gap visibility), Persian-capable typed titles, branch as a scope
  column (C5), freeze-over-delete (C7).
- Risk recorded: implementing a 4/6/8-column trial balance, a legal-book layout or a
  Toman/Rial statutory rule inside the Accounting module would violate §2 and must be
  rejected in review (AG-07/AR-29), even if a customer asks for it urgently.
- Q11's Persian-primary decision does **not** close OQ-02 (UI language, Jalali
  calendar, digit rendering) and does not authorize a frontend localization change —
  no frontend exists in this repository yet.

## Links

- Register: [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md)
- Contract: [`docs/accounting/domain-contract.md`](../accounting/domain-contract.md) §2.3 (C1–C7), §12.3, §19, §31 addendum
- Reporting: [`docs/reporting-strategy.md`](../reporting-strategy.md),
  ADR-0009, [`task-17b-investigation.md`](../tasks/task-17/task-17b-investigation.md) §8.1
- Related: ADR-0003, ADR-0004, ADR-0012, ADR-0033, OQ-02, OQ-03, OQ-05, OQ-12,
  OQ-17, OQ-27, OQ-30, OQ-43, OQ-51
