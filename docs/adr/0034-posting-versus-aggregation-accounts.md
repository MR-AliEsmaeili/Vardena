# ADR-0034: Posting Account XOR Aggregation Account — One Semantic Role per Account Node

- **Status:** Proposed (Owner decision Q5 + Invariant 2, recorded 2026-09-25 by Task 17C — documentation only; **not Accepted**, no self-acceptance)
- **Date:** 2026-09-25
- **Implements:** nothing — no code, schema, migration, endpoint, permission, validation rule or report is added or changed, and no current rule is relaxed.
- **Owner source:** [`task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md) §6 (Invariant 2), Q5. Canonical register of Q1–Q22, I-1…I-3 and the implementation discrepancies (incl. **D-1**, the conflict in §6 below): [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) — referenced here, never restated.
- **Builds on:** ADR-0026/0028/0031; contract §8.5, §14 (AC-D-19), §25 (AC-I-09), §19.2; OQ-25 (per-level policy content).

## Context

The Owner decided that every account node carries exactly one semantic role at a given time — **POSTING** or **AGGREGATION** — so a node's own postings and its descendants' rollup can never be read as one undifferentiated number. The repository pursues the same goal with a stricter rule: contract §14 rule 2 (AC-D-19) and AC-I-09 state **"a postable account is always a leaf"**, enforced on both write paths, while Q5 also decides that configuration "may allow posting at another level" — not representable under that rule. This ADR records the Owner's model and the conflict, resolving neither by invention (AG-09/AG-17, AR-31).

## Decision

1. **One role, never both (Invariant 2).** A node is either **POSTING** — a valid destination for ledger posting — or **AGGREGATION** — its balance/turnover is derived from its child structure and it is never independently posted to. The role is one explicit, stored, validated attribute, not an inference from a level title, a code prefix or the presence/absence of children (§8.1/§8.5); today `is_postable = true` ⇒ POSTING, `false` ⇒ AGGREGATION.
2. **Default (Q5).** The **last configured level is postable by default**; higher levels are AGGREGATION by default. The default lives in the configuration level row (ADR-0028 §1; contract §14 rule 4) and may be overridden per account.
3. **Configurable posting eligibility (Q5).** Configuration may make a node above the last level POSTING — permitted **only** together with §4/§5, never as a licence to post to a node whose descendants' rollup is reported as the same number.
4. **Double-counting prevention.** A rollup may never include the rolled-up node's own postings as if they were a child's, and no report may add a node's own postings to its descendants' total without saying so. Where a POSTING node has descendants, the read model must keep **own postings** and **descendant rollup** separately addressable (two measures, or an explicit inclusion flag), so every total is "own", "descendants" or "own + descendants, declared".
5. **Prohibition of simultaneous semantics.** No node may at one time be an aggregation of its children *and* an independent posting destination whose postings fold into that same aggregation. Future implementation contracts must state the validation rules explicitly (Owner §6): which role transitions are allowed and when (before/after first use, §8.4 rule 4), what happens to descendants when a parent becomes POSTING, and how each report declares its inclusion rule.
6. **The conflict with AC-D-19 / AC-I-09 is recorded, not resolved (baseline D-1).** Today's **`postable ⇒ leaf`** rule is a *sufficient* implementation of Invariant 2 (every non-leaf is AGGREGATION, so §4 holds trivially) and it **stays in force; this ADR does not relax or weaken it**. Enabling a non-leaf POSTING node requires **superseding** contract §14 rule 2 and AC-I-09 and **amending** §8.5's undifferentiated rollup, by an accepted ADR amendment plus its own implementation task ([`task-index.md`](../accounting/task-index.md) §7). Nothing here authorizes that, and no validation, schema or report behaviour changes now.
7. **Reporting consequence.** Summary/rollup surfaces (summary trial balance, `کل`/`گروه` reports) aggregate over POSTING descendants only and must disclose whether a POSTING ancestor's own postings are included (§4) — a report-definition concern (ADR-0009, [`reporting-strategy.md`](../reporting-strategy.md)), never a second calculation engine (baseline Q15/Q16).

## Current implementation boundary / non-goals

The shipped behaviour is correct and unchanged: `is_postable`, the leaf invariant, the placement checks, the §8.5 rollup. This ADR adds only the *vocabulary* and *boundaries* a future configuration-driven posting model must respect — **non-leaf posting is decided as a model and is NOT implemented**. Such a feature must ship the explicit role attribute (or a documented mapping), §4's separated measures, §5's validation rules, report disclosure, denial-path tests (AG-06/AG-13) and an accepted ADR amendment. Per-level *policy content* stays EXPERT-GATED under OQ-25; no implementation is authorized here.

## Consequences

- Risk recorded: relaxing `postable ⇒ leaf` without §4 would silently double count parents and children — a defect against this ADR, not a configuration choice.
- This ADR decides the mechanism and the invariant, not the policy (which levels a business posts to, whether `معین` alone may be postable, mandatory control-role levels — all OQ-25), and it changes no production code, schema, migration, API, permission, validation or test (`STATE.md` §10 BOOT-R-11).

## Links

- Register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (D-1, O-3) · Contract: [`domain-contract.md`](../accounting/domain-contract.md) §8.5, §14 (AC-D-19), §19.2, §25 (AC-I-09), §31 addendum · Related: ADR-0033, ADR-0037, ADR-0009, OQ-25
- Evidence: `backend/src/modules/accounting/domain/account.ts`, `domain/account-placement.spec.ts`, `data/accounts.repository.ts`, `api/dto/account.dto.ts` (`default_is_postable`; "a postable account is always a leaf")
