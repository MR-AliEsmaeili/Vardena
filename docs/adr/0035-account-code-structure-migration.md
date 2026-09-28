# ADR-0035: Accounting Code Structure Migration — a Controlled, Licensed, Audited Service That Never Rewrites Economic Ledger History

- **Status:** Proposed — **Task 17C is accepted, but this ADR remains Proposed pending its separate adoption/implementation gate**. **Task 20 OD-20-4 clarifies that the required code-history mechanism is producer-bound; Task 20 does not self-accept this ADR** (2026-09-26).
- **Date:** 2026-09-25; amended 2026-09-26 by Task 20 decision resolution (documentation only).
- **Implements:** nothing. The Accounting Code Structure Migration Service does **not** exist here and is **not** created, scaffolded, stubbed or authorized as an implementation task by this ADR.
- **Owner source:** [`task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md) §7 (Invariant 3), Q3/Q8, Q19 (Decision D), Q20 (Decision D), and **Task 20 OD-20-4**. Canonical register of Q1–Q22, I-1…I-3, OD-20-4 and the implementation discrepancies (incl. **D-7** licensing, **D-9** level-count precision): [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) — referenced here, never restated.
- **Builds on:** [ADR-0033](./0033-account-identity-and-code-history.md), ADR-0026/0028/0031; contract §9.4/§9.5, §8.4 rule 4, §23, AC-I-11/14/15/19; OQ-25, OQ-45, OQ-52/OQ-53, OQ-62/OQ-63.

## Context

Contract §9.4 already decides that changing digit lengths or depth after accounts exist **does not rewrite accounts** — a new version applies to newly created accounts, existing accounts stay pinned — and that "any migration of existing accounts is an explicit, permission-gated, audited operation whose policy is EXPERT-GATED (OQ-25)". The Owner has now decided that operation's *shape* (Q19, Decision D): a dedicated Vardena-controlled capability, explicitly **not** a user setting. None of it exists in code: no migration service, no license enforcement (ADR-0030 Proposed, enforcement OFF, no `license` schema/module), no code-history store (ADR-0033 §3). Invariant 3 is nevertheless already structurally protected, because ledger rows and projections reference `account_id` and store no code.

## Decision

1. **One sanctioned path.** After an account has accounting usage, its code (and any code-shape change implying re-coding of existing accounts) may change **only** through the Accounting Code Structure Migration Service — not a user preference, not a normal configuration edit, not an admin "quick fix" endpoint, not a SQL script run by support, not an import side effect (ADR-0011).
2. **Pipeline (binding order, Q19).** Every run executes and persists each stage; none may be skipped or reordered, and a failed stage stops the run and leaves the chart unchanged:

   ```text
   Request → Preflight Analysis → Impact Report → Dry Run → Migration Plan
     → Owner Approval → License Validation → Recovery/Backup Point
     → Migration → Reconciliation → Audit Report
   ```

   Preflight verifies at minimum: organization scope/isolation (AC-I-01/16); the pinned coding-structure/configuration versions and any pin divergence (OQ-62/OQ-63); the operational-freeze state (`operationally_used_at`, Task 13 — a frozen configuration is never mutated in place); code ⇄ hierarchy consistency (§9.3); uniqueness/collision analysis under the target shape (§9.2, ADR-0033 §3); and the referencing accounting history.
3. **Licensed, permission-gated, Owner-approved.** The service is gated by the license foundation (ADR-0030) **plus** a dedicated granular permission (AR-22, no wildcard — OQ-21) **plus** an explicit recorded Owner approval of the concrete plan. Because ADR-0030 is Proposed with enforcement OFF and OQ-45 is unresolved, the license gate **cannot be implemented yet** (baseline D-7): this ADR decides that the gate exists, not how licensing is enforced. Restore/backup must never be license-blocked (OQ-52/OQ-53).
4. **Invariant 3 — economic ledger history is never rewritten.** A migration preserves `Account.id` and changes only the code representation/history: `Ledger Entry → Account.id = A123 → { 1000 [historical], 1100 [current] }`. Forbidden: updating, deleting or re-dating `ledger_entries` / `accounting_document_lines` / `accounting_documents`; changing an entry's account reference, amounts, `document_date`, `posting_timestamp` or stored year/period; back-writing a code onto historical rows; deleting or rebuilding history to "clean up". The historical mapping stays reconstructable (ADR-0033 §3/§4), so any period can still be reported with the code valid then.
5. **Derived data is rebuilt, never edited.** Projections are re-derived by the existing explicit, audited, idempotent-by-replacement rebuild (ADR-0031 §6, AC-I-19); a migration never hand-patches a projection row.
6. **Reconciliation is a gate, not a report.** Completion requires proof that every migrated code satisfies the target shape and prefix rule (§9.3); Σ debit = Σ credit per voucher and per scope is unchanged (AC-I-07); the projection reconciles with the ledger (AC-I-19); balances/turnovers per `Account.id` are byte-identical before and after; and the historical→current map covers every account touched. Divergence blocks completion and is surfaced — never silently repaired.
7. **Auditability.** Each run produces a persisted audit trail: actor, timestamps, request, preflight findings, impact report, dry-run result, approved plan, license evidence, backup/recovery-point reference, per-account code mappings, reconciliation result, final outcome (contract §23, AR-23). Persistent audit storage stays the Audit module's concern.
8. **Scope exclusion — level count (Q20, Decision D).** Changing the **number of accounting code levels** is *not* a current product capability: no feature, migration flow, UI, endpoint or analysis artifact is added. The decided future scope is controlled **code-length / structure changes within the approved model** (Q8/Q19). Version pinning (§9.4) plus code history (ADR-0033 §3) keep future analysis possible, but a level-count capability needs its own Owner decision and ADR. Creating a *new* version with a different `max_depth` for *newly created* accounts (existing accounts stay pinned, §9.4) is **not** a level-count migration and is unchanged here (baseline D-9).
9. **Versioning discipline.** A migration consumes/produces configuration and coding-structure **versions** per ADR-0028 (DRAFT → ACTIVE → SUPERSEDED, exactly one ACTIVE per organization, published versions immutable); it never edits a published version's levels in place and never leaves two ACTIVE versions.

## Current implementation boundary / non-goals

**Not implemented, not scaffolded, not authorized.** The service needs its own task through [`task-index.md`](../accounting/task-index.md) §7 before any agent may build it, with these dependencies recorded now: ADR-0033 §3 (code history), ADR-0030/OQ-45 (licensing — unresolved), OQ-52/OQ-53 (backup/restore), OQ-62/OQ-63 (pin divergence), the Audit module. **Task 20 OD-20-4 forbids satisfying the history dependency by shipping a speculative history-only table before a real producer exists**; the history mechanism is designed with the pre-use edit producer and/or this migration service. Contract §9.4's shipped behaviour is unchanged — a new version applies to newly created accounts while existing accounts stay pinned, and `PATCH /accounts/:id` still publishes "The code is immutable". Level-count migration stays out of scope (§8).

## Consequences

- Any future endpoint that edits a used account's code outside this service is a defect against this ADR; today's immutability stays exactly as shipped.
- Q8's "change code length after transactions exist" is answered *mechanically* (this service); the *content* policy stays with the configured structure and OQ-25. Dry-run/impact artifacts are the review surface — an Owner approves a concrete plan, not an intention (the ADR-0011 posture).
- Risk recorded: a "simple `UPDATE accounts SET code = …`" script would violate §4/§6/§7 at once — unreconstructable history, unreconciled derived data, no audit — and must be refused in review.

## Links

- Register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (D-7, D-9, O-9, O-11) · Contract: [`domain-contract.md`](../accounting/domain-contract.md) §9.4/§9.5, §8.4, §23, §25 (AC-I-11/14/15/19), §31 addendum · Related: ADR-0011, ADR-0028, ADR-0030, ADR-0031, ADR-0033, OQ-25, OQ-45, OQ-52/OQ-53, OQ-62/OQ-63
- Evidence: `backend/prisma/schema/accounting.prisma`, `backend/src/modules/accounting/data/accounts.repository.ts`, `data/accounting-configuration-usage.ts`, `backend/prisma/migrations/20260922000000_accounting_balance_projection/migration.sql` (`vw_balance_reconciliation`)
