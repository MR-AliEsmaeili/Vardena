# ADR-0034: Posting Account XOR Aggregation Account — One Semantic Role per Account Node

- **Status:** Proposed (Owner decision Q5 + Invariant 2 recorded 2026-09-25 —
  Task 17C, documentation only; **not Accepted**, no self-acceptance)
- **Date:** 2026-09-25
- **Implements:** nothing. No code, schema, migration, endpoint, permission,
  validation rule or report is added or changed by this ADR.
- **Owner source:** [`docs/tasks/task-17/task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md)
  §6 (Invariant 2), Q5
- **Register:** [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (rows Q5/I-2, discrepancy **D-1**)
- **Builds on:** ADR-0026, ADR-0028; contract §8.5, §14 (AC-D-19), §25 (AC-I-09),
  §19.2; ADR-0031 (rollups read the same lines); OQ-25 (per-level policy content)

## Context

The Owner decided that every account node carries exactly one semantic role at a
given time — **POSTING** or **AGGREGATION** — so that no node's own postings and
its descendants' rollup can ever be read as one undifferentiated number.

The repository today expresses the same *goal* with a stricter *rule*: contract
§14 rule 2 (AC-D-19) and invariant AC-I-09 state **"a postable account is always a
leaf"**, enforced on both write paths (`AccountsRepository`: setting `is_postable`
on an account with children is refused; creating the first child of a postable
account is refused), and §8.5 states that a non-postable account's movement/balance
is **the rollup of its descendants**. Q5, however, also decides that
"Accounting configuration may allow posting at another level" — i.e. a node above
the last configured level may be explicitly made POSTING. Under today's rule that
configuration is not representable ("No invalid posting configuration is therefore
representable", §14 rule 2). This ADR records the Owner's model and the conflict,
and resolves neither by invention (AG-09/AG-17, AR-31).

## Decision

1. **One role, never both (Invariant 2).** An account node is either
   - **POSTING** — a valid destination for ledger posting; or
   - **AGGREGATION** — its balance/turnover is derived from its child structure and
     it is never independently posted to.

   The role is a single explicit, stored, validated attribute of the account, not an
   inference from a level title, a code prefix or the presence/absence of children
   (§8.1, §8.5). `is_postable = true` ⇒ POSTING; `is_postable = false` ⇒ AGGREGATION
   is the mapping of the current schema onto this vocabulary.
2. **Default (Q5).** The **last configured level is postable by default**; higher
   levels are AGGREGATION by default. The default lives in the configuration level
   row (`accounting_configuration_levels.default_is_postable`, ADR-0028 §1;
   contract §14 rule 4) and may be overridden per account.
3. **Configurable posting eligibility (Q5).** Accounting configuration may make a
   node above the last level POSTING. That is permitted **only** together with §4/§5
   below; it is never a licence to post to a node whose descendants' rollup is
   reported as the same number.
4. **Double-counting prevention.** A rollup may never include the rolled-up node's
   own postings as if they were a child's, and a report may never add a node's own
   postings to its descendants' total without saying so. Where a POSTING node has
   descendants, the read model must keep **own postings** and **descendant rollup**
   separately addressable (two distinct measures, or an explicit inclusion flag), so
   that every total is either "own", "descendants" or "own + descendants, declared".
5. **Prohibition of simultaneous semantics.** No node may at one time be treated as
   an aggregation of its children *and* as an independent posting destination whose
   postings are folded into that same aggregation. Any future implementation must
   state its validation rules explicitly (the Owner's §6 requirement: "The exact
   validation rules must be made explicit in future implementation contracts") —
   including: which transitions of the role are allowed, when (before/after first
   use, §8.4 rule 4), what happens to descendants when a parent becomes POSTING, and
   how each report declares its inclusion rule.
6. **Conflict with AC-D-19 / AC-I-09 is recorded, not silently resolved (D-1).**
   Today's "postable ⇒ leaf" is a *sufficient* implementation of Invariant 2 (every
   non-leaf is AGGREGATION, every POSTING node has no descendants, so §4 is
   trivially satisfied) and it stays in force. Enabling a non-leaf POSTING node
   requires **superseding** contract §14 rule 2 and AC-I-09 and **amending** §8.5's
   undifferentiated rollup, by an accepted ADR amendment plus its own implementation
   task (`docs/accounting/task-index.md` §7). Nothing in this ADR authorizes that,
   and no validation, schema or report behaviour changes now.
7. **Reporting consequence.** Summary/rollup surfaces (summary trial balance,
   `کل`/`گروه` reports) aggregate over POSTING descendants only, and must disclose
   whether a POSTING ancestor's own postings are included (§4). This is a
   report-definition concern (ADR-0009, `docs/reporting-strategy.md`), never a
   second calculation engine (Q15/Q16 in the baseline register).

## Consequences

- The existing implementation remains correct and unchanged: `is_postable`,
  the leaf invariant, the account placement checks and the §8.5 rollup all keep
  their current behaviour; this ADR adds the *vocabulary* and the *boundaries* that
  a future configuration-driven posting model must respect.
- Any future "post at a higher level" feature must ship: an explicit role attribute
  (or a documented mapping), the §4 separated measures, the §5 validation rules,
  report disclosure, denial-path tests (AG-06/AG-13) and an ADR amendment.
- Per-level *policy content* (which levels a given business posts to, whether
  `معین` alone may be postable, mandatory control-role levels) stays EXPERT-GATED
  under OQ-25 — this ADR decides the mechanism and the invariant, not the policy.
- Risk recorded: an implementation that simply relaxes `postable ⇒ leaf` without §4
  would silently double count parents and children; that is a defect against this
  ADR, not a configuration choice.

## Links

- Register: [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md)
- Contract: [`docs/accounting/domain-contract.md`](../accounting/domain-contract.md) §8.5, §14, §25 (AC-I-09), §31 addendum
- Evidence: `backend/src/modules/accounting/domain/account.ts`,
  `backend/src/modules/accounting/domain/account-placement.spec.ts`,
  `backend/src/modules/accounting/data/accounts.repository.ts`,
  `backend/src/modules/accounting/api/dto/account.dto.ts` ("a postable account is always a leaf")
- Related: ADR-0033 (identity), ADR-0037 (configuration boundary), OQ-25
