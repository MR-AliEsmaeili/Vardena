# ADR-0034: Posting Accounts Are Leaf Accounts; Aggregation Is Read-Time Roll-up

- **Status:** Proposed — **Task 20 Owner Decision OD-20-5 resolves D-1 in this ADR**; this ADR remains Proposed pending its separate adoption/implementation gate and is not self-accepted by Task 20 (2026-09-26). Task 17C is accepted, but task acceptance did not promote this ADR.
- **Date:** 2026-09-25; amended 2026-09-26 by Task 20 decision resolution (documentation only).
- **Implements:** nothing — no code, schema, migration, endpoint, permission, validation rule or report is added or changed.
- **Owner source:** Task 17C Q5 + Invariant 2; **Task 20 OD-20-5** (authoritative resolution: `POSTING = leaf-only`, `AGGREGATION = reporting/read-time roll-up`). Canonical register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) §3/§5/§12.
- **Builds on:** ADR-0026/0028/0031; contract §8.5, §14 (AC-D-19), §25 (AC-I-09), §19.2; OQ-25 (per-level default/content that remains open under the leaf-only invariant).

## Context

Task 17C recorded a documentation conflict (**D-1**) between Q5's wording that configuration "may allow posting at another level" and the already-shipped invariant that a postable account is always a leaf. Task 20 re-read the accepted Task 18 General Ledger / Trial Balance roll-up model and confirmed why the shipped invariant matters: posting the same accounting movement independently at `معین`, `گروه` and `کل` would duplicate amounts, while reporting may show the same leaf movement rolled up at parent levels because those parent values are derived views.

The Owner resolved D-1 through **OD-20-5**: Vardena keeps **POSTING accounts leaf-only**. Non-leaf accounts such as `کل` and `گروه` are aggregation/reporting nodes. The current read model that rolls leaf postings upward is valid under this invariant.

## Decision

1. **POSTING = leaf-only.** A posting account is a leaf account. A document/ledger line may target only an active, postable leaf account.
2. **AGGREGATION = derived upward during reporting/read operations.** Non-leaf accounts do not receive independent duplicated postings. Their balances and turnovers are derived by rolling up descendant leaf postings.
3. **No duplicate movement at parent levels.** The same underlying accounting movement MUST NOT be separately posted to a leaf and its parents. Report rows may show the derived parent totals, but those totals are views over the same leaf postings and must not be added again as independent activity.
4. **Existing read models are consistent.** The Task 18 Trial Balance / General Ledger roll-up model remains valid because the source set is leaf POSTING accounts and parent rows are derived aggregates.
5. **No mixed POSTING/AGGREGATION semantics.** The previously recorded non-leaf-posting model is not the chosen product rule. Do not implement own-vs-descendant balance measures, non-leaf POSTING, or special double-counting workarounds under this ADR.
6. **Future exception requires a new decision.** If a future approved business requirement needs non-leaf posting, that must be a new explicit architecture decision that reopens/supersedes this ADR and the affected contract sections. It is not authorized by Task 20.

## Current implementation boundary / non-goals

The shipped behavior is correct and unchanged: `is_postable`, the `postable ⇒ leaf` placement checks, the §8.5 roll-up rule, and the Task 18 read-time hierarchy aggregation. Per-level default postability remains configuration, but it is always bounded by the leaf-only invariant. OQ-25 still owns content/policy such as the exact approved chart levels and defaults; Task 20 does not invent them.

## Consequences

- Baseline discrepancy **D-1 is resolved** by selecting the repository's stricter existing rule as the product rule.
- No ADR amendment for own-vs-descendant measures is required for Task 20, because non-leaf posting is rejected.
- Review rule: any future change that allows postings to a non-leaf account is a defect unless preceded by a new Owner decision, ADR supersession/amendment, read-model redesign and tests.
- No production code, schema, migration, API, permission or test changes are made by this ADR update.

## Links

- Register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (I-2, D-1, OD-20-5) · Contract: [`domain-contract.md`](../accounting/domain-contract.md) §8.5, §14 (AC-D-19), §19.2, §25 (AC-I-09), §31/§32 addenda · Related: ADR-0033, ADR-0037, ADR-0009, OQ-25
- Evidence: `backend/src/modules/accounting/domain/account.ts`, `backend/src/modules/accounting/data/accounts.repository.ts`, `backend/src/modules/accounting/data/accounting-read-query.repository.ts`, `backend/src/modules/accounting/application/account-statements.service.ts`
