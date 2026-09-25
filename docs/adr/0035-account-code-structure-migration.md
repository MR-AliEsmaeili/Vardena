# ADR-0035: Accounting Code Structure Migration — a Controlled, Licensed, Audited Service That Never Rewrites Economic Ledger History

- **Status:** Proposed (Owner decisions Q3/Q8/Q19/Q20 + Invariant 3 recorded
  2026-09-25 — Task 17C, documentation only; **not Accepted**, no self-acceptance)
- **Date:** 2026-09-25
- **Implements:** nothing. The Accounting Code Structure Migration Service does
  **not** exist in this repository and is **not** created, scaffolded, stubbed or
  authorized as an implementation task by this ADR.
- **Owner source:** [`docs/tasks/task-17/task-17c-prompt.md`](../tasks/task-17/task-17c-prompt.md)
  §7 (Invariant 3), Q3, Q8, Q19 (Decision D), Q20 (Decision D)
- **Register:** [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) (rows Q3/Q8/Q19/Q20/I-3, discrepancies **D-7**, **D-9**)
- **Builds on:** [ADR-0033](./0033-account-identity-and-code-history.md) (identity +
  code history), ADR-0028 (versioned configuration root, single ACTIVE, operational
  freeze), ADR-0026; contract §9.4/§9.5, §8.4 rule 4, AC-I-11/14/15/19;
  ADR-0031 (projection rebuild/reconciliation); OQ-25, OQ-52/OQ-53, OQ-62/OQ-63

## Context

Contract §9.4 already decides that changing digit lengths or depth after accounts
exist **does not rewrite accounts**: a new coding-structure/configuration version
applies to newly created accounts, existing accounts stay pinned
(`coding_structure_version_id`, `accounting_configuration_id`), and "any migration of
existing accounts is an explicit, permission-gated, audited operation whose policy is
EXPERT-GATED (OQ-25)". The Owner has now decided that operation's shape (Q19,
Decision D): a dedicated Vardena-controlled capability — the **Accounting Code
Structure Migration Service** — that is licensed, approved, rehearsed, reconciled and
audited, and explicitly **not** a user setting. Nothing of it exists in code: there is
no migration service, no license enforcement (ADR-0030 is Proposed with enforcement
OFF and no `license` schema/module in `backend/`), and no code-history store
(ADR-0033 §3). Invariant 3 is nevertheless already structurally protected, because
ledger rows and projections reference `account_id` and store no account code.

## Decision

1. **One sanctioned path.** After an account has accounting usage, its code (and any
   code-shape change that implies re-coding existing accounts) may change **only**
   through the Accounting Code Structure Migration Service. Not a user preference, not
   a normal configuration edit, not an admin "quick fix" endpoint, not a SQL script
   run by support, not an import side effect (ADR-0011).
2. **Pipeline (binding order, Q19).** Every run executes and persists each stage:

   ```text
   Request → Preflight Analysis → Impact Report → Dry Run → Migration Plan
     → Owner Approval → License Validation → Recovery/Backup Point
     → Migration → Reconciliation → Audit Report
   ```

   No stage may be skipped or reordered; a failed stage stops the run and leaves the
   chart unchanged. Preflight must at minimum verify: organization scope and
   isolation (AC-I-01/16), the pinned coding-structure/configuration versions and any
   pin divergence (OQ-62/OQ-63), the operational-freeze state
   (`operationally_used_at`, Task 13 — a frozen configuration is never mutated in
   place), code ⇄ hierarchy consistency (§9.3), uniqueness/collision analysis under
   the target shape (§9.2, ADR-0033 §3), and the referencing accounting history.
3. **Licensed capability.** The service is gated by the license foundation
   (ADR-0030) **plus** a dedicated granular permission (AR-22, no wildcard — OQ-21)
   **plus** an explicit, recorded Owner approval of the concrete migration plan.
   Because ADR-0030 is Proposed with enforcement OFF and OQ-45 (expiry behaviour) is
   unresolved, the license gate **cannot be implemented yet** — recorded as
   discrepancy D-7; this ADR decides that the gate exists, not how licensing is
   enforced. Restore/backup must never be license-blocked (OQ-52/OQ-53 posture).
4. **Invariant 3 — no rewriting of economic ledger history.** A migration preserves
   `Account.id` and changes only the code representation/history:

   ```text
   Ledger Entry → Account.id = A123 → { 1000 [historical] , 1100 [current] }
   ```

   Forbidden: updating, deleting or re-dating `ledger_entries` /
   `accounting_document_lines` / `accounting_documents`; changing an entry's account
   reference, amounts, `document_date`, `posting_timestamp` or stored
   year/period; back-writing a code onto historical rows to make them display the new
   value; deleting or rebuilding history to "clean up" a migration. A historical
   mapping must stay reconstructable (ADR-0033 §3/§4), so any period can still be
   reported with the code that was valid then.
5. **Derived data is rebuilt, never edited.** Balance projections are re-derived by
   the existing explicit, audited, idempotent-by-replacement rebuild (ADR-0031 §6,
   AC-I-19) — a migration never hand-patches a projection row.
6. **Reconciliation is a gate, not a report.** Completion requires proof that: every
   migrated account's code satisfies the target shape and the prefix rule (§9.3);
   Σ debit = Σ credit per voucher and per scope is unchanged (AC-I-07); the
   projection reconciles with the ledger (`vw_balance_reconciliation`, AC-I-19);
   account balances/turnovers per `Account.id` are byte-identical before and after;
   and the historical→current code map covers every account touched. Divergence
   blocks completion and is surfaced — never silently repaired (AC-I-19 posture).
7. **Auditability.** Each run produces a persisted audit trail: actor, timestamps,
   request, preflight findings, impact report, dry-run result, approved plan, license
   evidence, backup/recovery point reference, per-account code mappings, reconciliation
   result and final outcome (contract §23, AR-23). Persistent audit storage remains
   the Audit module's concern; Accounting produces and preserves the facts.
8. **Scope exclusion — level count (Q20, Decision D).** Changing the **number of
   accounting code levels** is *not* a current product capability: no feature, no
   migration flow, no UI, no endpoint, no analysis artifact is added now. The current
   supported migration scope is controlled **code-length / structure changes within the
   approved model** (Q8/Q19). The architecture must not unnecessarily prevent future
   analysis — version pinning (§9.4) plus code history (ADR-0033 §3) keep the door
   open — but a future level-count capability needs its own Owner decision and ADR.
   Creating a *new* configuration/coding-structure version with a different `max_depth`
   for *newly created* accounts (existing accounts stay pinned, §9.4) is not a
   level-count migration and is unchanged by this ADR (discrepancy D-9).
9. **Versioning discipline.** A migration consumes/produces configuration and
   coding-structure **versions** per ADR-0028 (DRAFT → ACTIVE → SUPERSEDED, exactly
   one ACTIVE per organization, published versions immutable) — it never edits a
   published version's levels in place and never leaves an organization with two
   ACTIVE versions.

## Consequences

- No implementation exists or is authorized: the service needs its own task defined
  through `docs/accounting/task-index.md` §7 (objective, scope, non-goals,
  dependencies, blocking OQs, ADR, acceptance criteria, index row) before any agent
  may build it. Dependencies recorded now: ADR-0033 §3 (code history), ADR-0030/OQ-45
  (licensing), OQ-52/OQ-53 (backup/restore), OQ-62/OQ-63 (pin divergence), Audit
  module (persistent audit).
- Any future endpoint that edits an account code after use outside this service is a
  defect against this ADR; the current immutability (`PATCH /accounts/:id` — "The code
  is immutable") stays exactly as shipped.
- Q8's "changing code length after transactions exist" is now answered *mechanically*
  (this service) while the *content* policy (which shapes are legal for a given
  organization, defaults per level) stays with the configured structure and OQ-25.
- Dry-run/impact artifacts are the review surface: an Owner approves a concrete plan,
  not an intention — the same posture as ADR-0011's staged, validated imports.
- Risk recorded: a "simple UPDATE accounts SET code = …" maintenance script would
  violate §4/§6/§7 at once (unreconstructable history, unreconciled derived data, no
  audit) and must be refused in review.

## Links

- Register: [`docs/accounting/owner-decision-baseline.md`](../accounting/owner-decision-baseline.md)
- Contract: [`docs/accounting/domain-contract.md`](../accounting/domain-contract.md) §9.4/§9.5, §8.4, §23, §25 (AC-I-11/14/15/19), §31 addendum
- Evidence: `backend/prisma/schema/accounting.prisma` (`CodingStructureVersion`,
  `AccountingConfiguration`, `Account`, `LedgerEntry`),
  `backend/src/modules/accounting/data/accounts.repository.ts`,
  `backend/src/modules/accounting/data/accounting-configuration-usage.ts`,
  `backend/prisma/migrations/20260922000000_accounting_balance_projection/migration.sql`
- Related: ADR-0011 (validated import workflow), ADR-0028, ADR-0030, ADR-0031,
  ADR-0033, OQ-25, OQ-45, OQ-52/OQ-53, OQ-62/OQ-63
