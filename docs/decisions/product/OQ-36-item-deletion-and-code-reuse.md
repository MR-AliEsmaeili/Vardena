# OQ-36: Master-data lifecycle — item deletion and code reuse

- **Type:** OQ decision record (Inventory domain policy; central-registry OQ below OQ-44, recorded here per the 2026-10-02 Owner decision session)
- **Status:** **Open** — **item-scope deletion eligibility is Decided (Option C)**; code-reuse semantics and the remaining lifecycle questions remain **Open**
- **Owner:** Ali Esmaeili (Repository Owner)
- **Decided (item scope):** 2026-10-02
- **Registry row:** [`docs/open-questions.md`](../../open-questions.md) — OQ-36 (row stays **Open**)
- **Related:** [OQ-29 record](./OQ-29-quantity-precision-and-conversion.md) · [OQ-33 record](./OQ-33-item-taxonomy-and-capabilities.md) · [PDR-01](./PDR-01-item-barcode-policy.md) · [OQ-65](./OQ-65-item-barcode-lifecycle.md) · [C-47 preflight investigation](../../tasks/c-47-item-master-preflight-investigation.md) §4/§8 · [C-47 readiness/hardening report](../../tasks/c-47-item-master-readiness-hardening-report.md) §9

## Decision (Option C — item scope)

The Owner decided **Option C** for the **item** scope of OQ-36:

1. **Physical deletion is permitted only when the item has never been
   referenced by any operational, ledger, or historical record.**
2. **An item that has been referenced must not be physically deleted** — its
   history is preserved.
3. **History and organization-scoped identity constraints are preserved** —
   deletion eligibility never weakens the organization-scoped identity of
   items, and referenced items stay available to history (the existing
   lifecycle is deactivation/freeze, never removal).

No production code, schema, migration, permission, or test change was made by
the decision-recording task: **no deletion is implemented today** and none may
be implemented without a separately authorized bounded task.

## What is explicitly NOT decided (kept OPEN)

- **Whether the code of a physically deleted, never-referenced item may be
  reused by a later item.** Option C decides _deletion eligibility_ only; the
  complete item-code reuse policy must **not be inferred** from it. Reuse of a
  code after physical deletion of a never-referenced item stays **OPEN**.
- Whether a code may be reused after **deactivation** (no deletion) — OPEN.
- Whether business codes are compared case-sensitively (`ABC` vs `abc`) — OPEN
  (current unique indexes compare case-sensitively; that is implementation
  posture, not a decided rule).
- Whether any soft-delete (`deleted_at`) lifecycle is wanted for referenced
  items — OPEN (current implementation is `is_active`-only with freeze guards).
- The same lifecycle questions for **non-item master data** (item groups,
  units, warehouses, parties, accounts/users per their own OQs) — OPEN; this
  decision is item-scoped.
- **The Base Chart prerequisites recorded by Task 21 §10** (account code-reuse
  policy vs `uq_accounts_organization_id_code`; deletion eligibility of unused
  adopted accounts; code-history producer coexistence) — **not answered** by
  this item-scoped decision; they remain explicit prerequisites for Phase 1A/1B.

## Implementation evidence (context; unchanged by this decision)

- No `*.Delete` permission and no DELETE endpoint exists for inventory master
  records (`backend/src/modules/inventory/domain/inventory-permissions.ts` —
  "No `*.Delete` anywhere: master-data lifecycle is `is_active`").
- Current guards that already embody "referenced items must survive":
  `ItemsService` freeze guards (`existsForItem`,
  `hasBlockingBalanceForItem`) block base-unit/stockability changes after
  movements and block disabling an item with a remaining balance
  (`backend/src/modules/inventory/application/items.service.ts`).
- Organization-scoped identity: unique `(organization_id, code)` on
  `inventory.items` (`backend/prisma/schema/inventory.prisma`); codes are never
  reused today.

## Consequences

- The decided eligibility rule ("never referenced by any operational, ledger,
  or historical record") is the future delete-endpoint's acceptance rule; the
  reference check must cover more than the existing freeze guards (which gate
  edits/disables, not deletion) — its exact design belongs to the bounded
  implementation task, not to this record.
- C-47's lifecycle acceptance criterion (preflight §7 item 2) is partially
  decidable now (eligibility decided); code scope/comparison/reuse remain open,
  so OQ-36 is **not** resolved and C-47 does not claim completion.
- Phase 1A/1B (Base Chart content/code history) remain blocked by the
  account-scoped OQ-36 prerequisites, which this decision does not touch.

## Follow-up questions (open)

1. Code reuse after physical deletion of a never-referenced item (and after
   deactivation) — Owner + architecture.
2. Case sensitivity of business codes — Owner + architecture.
3. Extension of the decided eligibility rule to other master-data types —
   Owner, per entity.
