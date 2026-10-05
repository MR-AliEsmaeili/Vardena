# PDR-03: Item barcode policy (Option A — Owner decision confirmed)

- **Type:** PDR (Product Decision Record) · decision id **OD-C47-03**
- **Status:** **Decided** — Owner decision confirmed 2026-10-02
- **Decided by:** Repository Owner (Ali Esmaeili)
- **Scope of this record:** documentation/governance only. **No production code and no schema change is made or authorized by this record.**
- **Registry rows:** [`docs/open-questions.md`](../../open-questions.md) — OQ-33 (item model, remains OPEN), **new OQ-65** (barcode lifecycle/identity, OPEN)
- **Recording baseline:** `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a` (merge of PR #107)
- **Related records:** [C-47 preflight](../../tasks/c-47-item-master-preflight-investigation.md) §4/§6 (barcode decision gap) · [C-47 readiness/hardening report](../../tasks/c-47-item-master-readiness-hardening-report.md) §7/§10 · [OQ-65](./OQ-65-barcode-lifecycle-and-reuse.md) · [PDR-02](./PDR-02-item-taxonomy-and-capabilities.md)

> Barcode had **no** dedicated registry row before this record: it was carried as
> a decision gap inside the OQ-33 chain (preflight §4 "Barcode — PARTIAL …
> Decision gap", §6 question 5; hardening report §7 item 5 and §9). This record
> is therefore the first canonical barcode decision in the repository.

## 1. Decision (OD-C47-03) — Option A

1. **A barcode is optional.** An item may exist with no barcode.
2. **Barcode uniqueness is enforced within an organization.**
3. **Two active items in the same organization must not have the same barcode.**
4. **Different organizations may use the same barcode.** Uniqueness never
   crosses organization scope.
5. **Multiple barcode formats are supported.** No strict symbology validation
   (EAN/UPC/GS1 structure, length classes, check digits) is imposed unless it is
   separately approved by its own decision.
6. **No multi-barcode-per-item support** is introduced by this decision (no
   alias table, no secondary/packaging barcodes).

## 2. Explicitly out of scope of this record

- No production code, Prisma schema, migration, API/DTO, OpenAPI artifact,
  generated frontend type, permission or test is changed by this documentation
  task.
- The decision does **not** authorize the implementation work it implies; that
  work is a bounded candidate (see §5) and is itself blocked (see §4).

## 3. Implementation evidence on `main` (fact, not acceptance)

| Decided element | Current state | Evidence |
|---|---|---|
| Barcode optional | **Matches** — nullable column, optional DTO field | `backend/prisma/schema/inventory.prisma` (`barcode String? @db.VarChar(64)`); `backend/src/modules/inventory/api/dto/item.dto.ts` |
| Uniqueness within an organization | **NOT IMPLEMENTED** — there is no unique index and no application uniqueness check on `barcode`; the only item unique key is `(organization_id, code)` | `backend/prisma/schema/inventory.prisma` (`@@unique([organizationId, code])`, no barcode index); `backend/prisma/migrations/20260911010000_inventory_master_data/migration.sql`; `backend/src/modules/inventory/application/items.service.ts` (barcode is trimmed and length-checked only) |
| Two active items must not collide | **NOT ENFORCED** today | same as above |
| Different organizations may reuse a barcode | Trivially true today (no constraint at all) — would have to be preserved by any future constraint, which must be organization-scoped | `inventory.items.organization_id` scope |
| Multiple formats, no symbology validation | **Matches** — only `trim()` + max length 64 | `items.service.ts` (`normalizeOptional`, `assertOptionalText('Barcode', …, MAX_BARCODE_LENGTH)`) |
| Single barcode per item | **Matches** — one scalar column, no alias table | `backend/prisma/schema/inventory.prisma` |

**Delta:** the uniqueness rule (items 2–3) is a *real implementation gap*. The
decision records the policy; it does not close the gap and does not permit
closing it in this task.

## 4. Unresolved lifecycle detail — kept OPEN (OQ-65)

The decided wording constrains **two active items**. It says nothing about an
item that has been **deactivated** (`is_active = false`). Therefore:

> **OPEN:** may a barcode assigned to a deactivated item be reused by another
> item in the same organization?

> **Update (2026-10-05):** the Owner answered this in the governance
> re-baseline — **a barcode is never reusable within the organization**
> (OD-65-01, the Option A *semantics*; full record in
> [OQ-65](./OQ-65-barcode-lifecycle-and-reuse.md)). The invariant is defined
> over **assignment history**: clearing, replacing, deactivating or retiring
> an assignment does not release the barcode. **Caution on the historical
> table below:** a plain current-row unique index `(organization_id, barcode)`
> does **not** by itself enforce the decided invariant (a cleared/replaced
> barcode leaves the row and would become takeable); enforcement needs a
> history-aware mechanism whose concrete design is a future implementation
> task (OQ-65 §Enforcement implication). Comparison/normalization semantics
> remain OPEN there. The paragraphs below stand as the historical record of
> why the question was blocking.

This must **not** be inferred from the uniqueness rule. Both plausible
implementations silently answer it, which is exactly why it is blocking:

| Candidate enforcement | What it would silently decide |
|---|---|
| Plain unique index `(organization_id, barcode)` | Reuse after deactivation **forbidden** (a deactivated item keeps the barcode reserved forever) |
| Partial unique index `(organization_id, barcode) WHERE is_active` | Reuse after deactivation **allowed**, and two *inactive* items may share a barcode |

Related sub-questions recorded with it (see
[OQ-65](./OQ-65-barcode-lifecycle-and-reuse.md)): comparison semantics for
uniqueness (case sensitivity, whitespace, leading zeros, Unicode digits — today
the value is only trimmed and stored verbatim, while list search is
case-insensitive substring), whether re-activating an item whose barcode was
taken in the meantime is permitted, and the behavior when a barcode is cleared
and re-assigned.

## 5. Bounded implementation candidate created by this decision

Registered as a candidate only (see
[`docs/roadmap/future-task-candidates.md`](../../roadmap/future-task-candidates.md)
row **C-55**): organization-scoped barcode uniqueness enforcement with
database-authoritative constraint, concurrency proof, conflict mapping and
regression coverage. It is **BLOCKED BY OQ-65** until the deactivation/reuse
semantics and the comparison semantics are decided, because any index shape
chosen first would decide them silently.

## 6. Follow-up questions for the Owner

1. May a barcode of a **deactivated** item be reused by another item in the same
   organization? (Blocking — see §4.)
2. Is barcode uniqueness compared **case-sensitively** and on the trimmed raw
   string, consistent with item-code comparison today?
3. May two **inactive** items hold the same barcode?
4. Is a later multi-barcode (alias/packaging) capability expected, so the
   uniqueness implementation should stay additively extensible?
