# ADR-0033: Account Identity and Account Code History — `Account.id` Is Permanent, `code` Is a Business Identifier

- **Status:** Proposed — **Task 17C is accepted, but this ADR remains Proposed pending its separate adoption/implementation gate** (2026-09-25; Owner decisions Q3/Q8/Q18/Q21 + Invariant 1, recorded 2026-09-25 by Task 17C — documentation only; **not Accepted**, no self-acceptance; acceptance record: [`task-17c-acceptance-record.md`](../tasks/task-17/task-17c-acceptance-record.md) §ADR status handling)
- **Date:** 2026-09-25
- **Implements:** nothing — no code, schema, migration, endpoint, permission, seed or test is added or authorized here.
- **Owner source:** [`task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md) §5 (Invariant 1), Q3/Q8/Q18/Q21. Canonical register of Q1–Q22, I-1…I-3 and the implementation discrepancies (D-1…D-13): [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) — referenced here, never restated.
- **Builds on:** ADR-0026/0028/0031; contract §8.2–§8.6, §9.2–§9.5; OQ-25, OQ-36. **Companion:** [ADR-0035](./0035-account-code-structure-migration.md) — the only sanctioned way a code changes after use.

## Context

The Owner decided that `Account.id` is the permanent accounting identity and `Account.code` a business/display identifier with a *history*. The repository satisfies the first half — document lines, ledger rows and the projection key all reference `account_id`, and no ledger or projection row stores a code — but not the second: one immutable code per account, no code-history table, read surfaces rendering only the current code. Q18's historical resolution and Q21's deletion half therefore have no mechanism today.

## Decision

1. **`Account.id` (ULID) is the permanent Accounting identity (Invariant 1).** Document lines, ledger rows, balance/projection keys, opening logic and correction links resolve by id, never by code — existing behaviour recorded as normative; **dimension assignments are not implemented** (ADR-0037 §7) and must resolve the same way once they exist.
2. **`Account.code` is a business/display identifier** — unique per organization, digits-only, composed from the configured coding structure (§9.2/§9.3). It is never a semantic source: the tree comes from `parent_id`, the code prefix is only its proof (§8.5), and no classification may be inferred from a code range.
3. **A code is a time-scoped fact.** The model must retain every code an account has carried with its validity, so `Account.id → {historical code(s), current code}` is reconstructable at any reporting date. *Not implemented* — an additive schema task with its own migration (AR-10/AR-29).
4. **Historical resolution rule (Q18, Decision D).** A report over a historical context (fiscal year, accounting period, `document_date`) displays by default the code valid in that context, and may also expose the current code and the historical → current mapping (`report date → Account.id → historical code → report`). A current-code rendering is an explicit alternative view, never a silent rewrite of the historical one.
5. **Opening identity.** Opening/carry-forward semantics key on `Account.id` (ADR-0031 §4/§9; Task 17B decision D2), so a code change can never create, split, merge or orphan an opening balance, and a code is never a join key between two fiscal years.
6. **Code changes before use (Q3).** While an account has no accounting usage its code may in principle change inside the configured structure (validated against the pinned versions, digit lengths included). After first use a code changes **only** through ADR-0035's controlled migration. *The repository is stricter today* — no code-edit path exists at all — so this is a permitted future relaxation, not current behaviour (baseline D-2).
7. **Deletion vs deactivation (Q21, Decision D).** An account with **no** historical accounting usage and no other blocking reference may be deleted; an account with usage is deactivated (`is_active = false`), never physically deleted, with history, balances and reports staying readable (§8.6). **A zero current balance is not evidence of no usage** (`+100M / −100M = 0` is usage): "usage" means referencing accounting history, never a balance test. *Repository today*: no deletion endpoint, no `Accounting.Account.Delete` — only the stricter half is implemented (baseline D-4).
8. **Integrations** reference accounts by id; a code may be exposed as a controlled business reference only where an integration contract explicitly designs for it (ADR-0003) and says whether it means the current or the as-at-date code.

## Current implementation boundary / non-goals

Implemented and unchanged: id-based references, one immutable code per account, freeze-over-delete (AC-D-08). **Gaps, not authorizations:** code history and as-at resolution (§3/§4), a pre-use code edit (§6), deletion of a genuinely unused account with its reference check and granular permission (§7) — each needs its own task via [`task-index.md`](../accounting/task-index.md) §7. A code migration writes code *history*; it never rewrites ledger economics (Invariant 3 — ADR-0035 §4). Nothing here is implemented, scaffolded or stubbed.

## Consequences

- Reporting, opening logic and legal profiles gain a code-resolution seam (ADR-0036 §5); caching "the account code" as a key becomes a defect.
- The never-reuse rule (§8.6/AC-I-11) and `uq_accounts_organization_id_code` must be re-expressed for a history model; whether a superseded code may be re-issued is **not decided here** (OQ-25/OQ-36, baseline O-1).
- No production, schema, migration, API, permission or test change is made by this ADR; OQ-25 stays OPEN for everything not decided above.

## Links

- Register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) · Contract: [`domain-contract.md`](../accounting/domain-contract.md) §8.2–§8.6, §9.2–§9.5, §25 (AC-D-06/07/08, AC-I-10/11/14), §31 addendum · Related: ADR-0031 §2/§4/§9, ADR-0034, ADR-0035, ADR-0036, OQ-25, OQ-36
- Evidence: `backend/prisma/schema/accounting.prisma`, `backend/src/modules/accounting/domain/account.ts`, `api/accounts.controller.ts`
