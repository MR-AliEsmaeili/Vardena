# ADR-0033: Account Identity and Account Code History — `Account.id` Is Permanent, `code` Is a Business Identifier

- **Status:** Proposed — Task 17C is accepted, but this ADR remains Proposed pending its separate adoption/implementation gate. **Task 20 Owner Decision OD-20-4 is recorded here as an authoritative clarification; Task 20 does not self-accept this ADR** (2026-09-26).
- **Date:** 2026-09-25; amended 2026-09-26 by Task 20 decision resolution (documentation only).
- **Implements:** nothing — no code, schema, migration, endpoint, permission, seed, history table, code-edit operation or test is added or authorized here.
- **Owner source:** Task 17C §5 (Invariant 1), Q3/Q8/Q18/Q21; **Task 20 OD-20-4**. Canonical register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) §3/§5/§12.
- **Builds on:** ADR-0026/0028/0031; contract §8.2–§8.6, §9.2–§9.5; OQ-25, OQ-36. **Companion:** [ADR-0035](./0035-account-code-structure-migration.md) — the only sanctioned way a code changes after accounting use.

## Context

The Owner decided that `Account.id` is the permanent accounting identity and `Account.code` is a business-facing accounting address/code. The repository satisfies the identity half today: document lines, ledger rows and the projection key reference `account_id`, and no ledger/projection row stores a code. The repository is stricter than the decided future rule for code edits: `accounts.code` is immutable from creation because no code-change producer exists.

Task 20 OD-20-4 resolves the activation boundary: a controlled pre-use code change is permitted in principle, but once an account has accounting postings/ledger activity its code is immutable except through a future controlled migration service. A speculative history-only table must not be created before a real producer exists.

## Decision

1. **`Account.id` (ULID) is the permanent Accounting identity (Invariant 1).** Document lines, ledger rows, balance/projection keys, opening logic, corrections and future analytical assignments resolve by id, never by code.
2. **`Account.code` is a business/display address.** It is digits-only, unique in its configured scope, and validated against the configured/pinned code shape. It is not the semantic source for the tree, classification, role, nature or reporting identity.
3. **Pre-use code correction is permitted (OD-20-4).** A controlled code-change operation may change an account code before first accounting use, e.g. `110101 → 110201`, provided the new code is valid under the account's pinned structure/configuration and all uniqueness/reuse rules are satisfied. This operation is not implemented today.
4. **After accounting use, the code is immutable (OD-20-4).** Once an account has been used by accounting postings/ledger activity, ordinary code changes are forbidden. Any post-use re-coding belongs only to ADR-0035's controlled Accounting Code Structure Migration Service.
5. **Code history is producer-bound.** The model must eventually retain permitted code transitions so `Account.id → historical/current codes` is auditable and reconstructable at any reporting date. However, a history mechanism is designed with its producer (pre-use edit and/or ADR-0035 migration), not as a speculative unused table.
6. **Historical resolution rule (Q18).** A historical report resolves the code valid for its context (fiscal year, accounting period, `document_date`) and may expose the current code and historical ↔ current mapping. A current-code rendering is an explicit alternative view, never a silent rewrite.
7. **Deletion vs deactivation (Q21).** An account with no historical accounting usage and no blocking reference may be deleted in a future task; a used account is deactivated, never physically deleted. A zero current balance is not proof of no usage.
8. **Integrations** reference accounts by id. If a code is exposed as a business reference, the contract must state whether it means current code or as-at code.

## Current implementation boundary / non-goals

Implemented and unchanged: id-based references, one code on `accounts`, no code on ledger/projection rows, and freeze-over-delete. Not implemented and not authorized: pre-use code-edit producer, code-history table, as-at code resolver, post-use migration service, report rendering changes, or deletion of unused accounts. Task 20 explicitly rejects a speculative history-only migration, fake seed history, automatic history rows without a producer, or read-surface changes without a future task.

## Consequences

- Baseline discrepancy **D-2** remains a repository-stricter implementation gap: code edit before use is permitted by decision but not implemented.
- Baseline discrepancy **D-3** remains an implementation gap: historical code resolution requires a future producer-bound schema/read task.
- OQ-25/OQ-36 still own code reuse and the interaction with existing uniqueness rules.
- ADR-0035 depends on this history mechanism, but OD-20-4 forbids solving that dependency by shipping an unused history table first.
- No production, schema, migration, API, permission or test change is made by this ADR update.

## Links

- Register: [`owner-decision-baseline.md`](../accounting/owner-decision-baseline.md) · Contract: [`domain-contract.md`](../accounting/domain-contract.md) §8.2–§8.6, §9.2–§9.5, §25 (AC-D-06/07/08, AC-I-10/11/14), §31/§32 addenda · Related: ADR-0031 §2/§4/§9, ADR-0034, ADR-0035, ADR-0036, OQ-25, OQ-36
- Evidence: `backend/prisma/schema/accounting.prisma`, `backend/src/modules/accounting/domain/account.ts`, `backend/src/modules/accounting/api/accounts.controller.ts`
