# PDR-01: Item barcode policy

- **Type:** Product Decision Record (Inventory master-data policy; first PDR)
- **Status:** **Decided (Option A)**
- **Owner:** Ali Esmaeili (Repository Owner)
- **Decided:** 2026-10-02
- **Registry:** decided policy recorded here; the unresolved lifecycle detail is registered as [OQ-65](../../open-questions.md) (row + [record](./OQ-65-item-barcode-lifecycle.md)); context row [OQ-33](./OQ-33-item-taxonomy-and-capabilities.md)
- **Related:** [C-47 preflight investigation](../../tasks/c-47-item-master-preflight-investigation.md) §4 (barcode row) and §9 Q5 · [C-47 readiness/hardening report](../../tasks/c-47-item-master-readiness-hardening-report.md) §7 item 5 · ADR-0022 (Accepted) · `docs/architecture/domain/master-data-strategy.md` §3.2

## Decision (Option A)

The Owner confirmed **Option A** for the item barcode policy:

1. **A barcode is optional.** An item may exist without a barcode.
2. **Barcode uniqueness is enforced within an organization.**
3. **Two active items in the same organization must not have the same
   barcode.**
4. **Different organizations may use the same barcode.** Uniqueness is not
   global across organizations.
5. **Multiple barcode formats are supported; strict symbology validation is not
   imposed** unless it is separately approved (check-digit/format validation is
   a future, separately-approved policy).
6. **No multi-barcode-per-item support is introduced under this decision** —
   one optional barcode value per item, no alias table.

**No production code or schema change was made in the documentation task that
records this decision.** The decision is recorded policy; its enforcement is a
future, separately-authorized bounded implementation task (see below).

## What is explicitly NOT decided (kept OPEN)

- **Whether a barcode assigned to a deactivated item may be reused by another
  item in the same organization.** The uniqueness rule above is worded over
  _active_ items and must **not** be read as deciding this lifecycle question —
  neither as permitting reuse nor as reserving the deactivated item's barcode.
  This is registered as **OQ-65** ([record](./OQ-65-item-barcode-lifecycle.md)).
- **Comparison/normalization semantics of the uniqueness check** (case
  sensitivity, whitespace handling) — also under OQ-65. The current service
  trims/normalizes the optional barcode string; that is implementation
  behavior, not a decided comparison rule.
- Barcode symbology/check-digit validation formats (excluded by this decision
  unless separately approved).

## Implementation status and required follow-up

Current `main` (verified 2026-10-02 at the merge of PR #107):

- `inventory.items.barcode` is a nullable `VarChar(64)` with **no database
  unique constraint** (`backend/prisma/schema/inventory.prisma`).
- `ItemsService` normalizes and length-validates the optional barcode and the
  item repository supports barcode search
  (`backend/src/modules/inventory/application/items.service.ts`,
  `backend/src/modules/inventory/data/items.repository.ts`); the DTO documents
  case-insensitive substring search over code/name/barcode.
- There is no symbology validation and no alias/multi-barcode table.

**Gap created by this decision (policy ≠ implementation):** the decided
active-item, organization-scoped uniqueness rule is **not yet enforced** by any
constraint or service check. Enforcing it requires a bounded implementation
task (expected shape: an organization-scoped uniqueness guarantee over
non-null barcodes of active items — exact index/constraint shape, NULL
handling, deactivated-item treatment and re-enable conflict handling follow
from OQ-65 plus the task's own design; nothing is decided or implemented
here). Item import, when admitted, must respect the same rule.

## Consequences

- C-47's barcode sub-scope is decided **at policy level**; C-47 completion
  (enforcement + tests) remains gated on OQ-65 and on that bounded
  implementation task being authorized through the candidate register.
- A scan lookup contract may rely on organization-scoped uniqueness among
  active items once enforced.
- This decision does not accept the C-47 hardening PR (#107) and does not
  authorize any code change by itself.
