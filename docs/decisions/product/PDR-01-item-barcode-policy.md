# PDR-01: Item barcode policy

- **Type:** PDR (Product Decision Record)
- **Status:** **Decided** — Option A, confirmed by the Owner on **2026-10-02**
- **Owner:** Ali Esmaeili (with inventory domain input)
- **Created:** 2026-10-02
- **Decision id:** **OD-C47-03** (see
  [`docs/tasks/c-47-item-master-owner-decision-record.md`](../../tasks/c-47-item-master-owner-decision-record.md) §3)
- **Area:** Inventory / item master data
- **Related:** OQ-33 (item model — barcode was carried as an undecided
  attribute of the item-master chain), **OQ-65** (barcode lifecycle/reuse —
  created by this record and OPEN), OQ-36 (master-data lifecycle),
  ADR-0022 (Accepted — inventory core), ADR-0021 (organization-scoped master
  data), `docs/architecture/domain/master-data-strategy.md` §3.2/§7
- **Implementation state:** **DECIDED BUT NOT IMPLEMENTED** (§5)

> This record decides a *product policy*. It changes no production code, Prisma
> schema, migration, API, generated type, permission or test, and it authorizes
> no task. A future bounded implementation follow-up is described in §7 and is
> itself gated by OQ-65.

---

## 1. Context

`inventory.items` has carried an optional free-text `barcode` column since the
first inventory master-data migration (`20260911010000_inventory_master_data`).
No uniqueness, normalization, symbology or lifecycle rule was ever decided, so
the column was documented as a "standard attribute that is not a capability"
(`master-data-strategy.md` §3.2) and left deliberately unconstrained.

Both C-47 reports flagged it as a decision gap rather than a proposed policy:

- [`c-47-item-master-preflight-investigation.md`](../../tasks/c-47-item-master-preflight-investigation.md)
  §3.2: "There is **no database unique constraint on `barcode`**. Barcode
  uniqueness, normalization, whether a barcode may be reused, and whether
  multiple barcode formats/aliases are required are not established by
  OQ-29/OQ-33 or the current contract."
- [`c-47-item-master-readiness-hardening-report.md`](../../tasks/c-47-item-master-readiness-hardening-report.md)
  §7 item 5: "Barcode is one free nullable string (≤64), searchable, **no
  uniqueness, no symbology validation** (explicitly unsettled, presumably
  separate policy)."

Both reports recommended that barcode be approved as its own explicit
decision before any constraint is added. This record is that decision.

## 2. Decision (Option A — confirmed)

1. **A barcode is optional.** An item may have no barcode.
2. **Barcode uniqueness is enforced within an organization.**
3. **Two active items in the same organization must not have the same
   barcode.**
4. **Different organizations may use the same barcode.** Barcode identity is
   organization-scoped, consistent with every other business key in the
   product (ADR-0021).
5. **Multiple barcode formats are supported.** No strict symbology validation
   (EAN-8/EAN-13/UPC-A/Code-128/QR check digits, fixed lengths, charset
   restrictions) is imposed **unless separately approved**.
6. **No multi-barcode-per-item support** is introduced by this decision. One
   item carries at most one barcode value; no alias/secondary-barcode table,
   no packaging-level barcodes.
7. **No production code or schema change** is made by the documentation task
   that records this decision.

## 3. Options that were considered and rejected

| Option | Summary | Outcome |
|---|---|---|
| **A** | Optional, organization-scoped uniqueness among active items, multi-format, no symbology validation, single barcode per item | **CHOSEN** |
| B | Globally unique barcode (across organizations) | Rejected — breaks organization scoping (ADR-0021) and makes a legitimate per-tenant catalogue collide |
| C | Strict symbology validation (check digits, fixed lengths) | Rejected **for now** — would reject legitimate internal/supplier codes; may be revisited through a separate approval (clause 5) |
| D | Multiple barcodes per item (alias table, packaging-level codes) | Rejected **for now** — explicitly out of scope of this decision; would require its own model, API and reporting decisions |

## 4. What this decision does **not** decide

Recorded here so no reader infers more than was approved:

- Any **symbology/format validation** (clause 5 keeps it unapproved, not
  forbidden forever).
- Any **multi-barcode / alias / packaging-barcode** model (clause 6).
- Any **scan or barcode-lookup endpoint**, UI surface, or barcode printing.
- Any **item-code** policy. Barcode and item `code` are distinct keys; OQ-36
  and OD-C47-04 own the code lifecycle.
- Any change to the **search** behaviour that already matches barcode
  substrings.
- Everything listed in §6 (OQ-65).

## 5. Current implementation state — **the decision is not enforced**

Verified on `main` @ `4cf481efa2de5ca9863d9d434c2ab707de23301a`:

| Clause | Evidence path | State |
|---|---|---|
| Optional, ≤64 chars, trimmed, empty ⇒ `NULL` | `backend/prisma/schema/inventory.prisma` (`barcode String? @db.VarChar(64)`); `backend/src/modules/inventory/domain/master-data.ts` (`MAX_BARCODE_LENGTH = 64`); `backend/src/modules/inventory/application/items.service.ts` (`normalizeOptional`, `assertOptionalText('Barcode', …)`) | **Satisfied** |
| Uniqueness within an organization among active items | **No** barcode unique index exists — the only `Item` unique constraint is `uq_items_organization_id_code`. `items.service.ts` performs no barcode uniqueness pre-check and maps no barcode conflict | **NOT satisfied — open gap** |
| Different organizations may share a barcode | consequence of the absent constraint, and the intended end state | Trivially true |
| No symbology validation | `backend/src/modules/inventory/api/dto/item.dto.ts` — only `@MaxLength(MAX_BARCODE_LENGTH)` | **Satisfied** |
| Single barcode per item | one nullable column; no alias table | **Satisfied** |
| Barcode participates in item search | `backend/src/modules/inventory/data/items.repository.ts` (case-insensitive `contains` over code/name/barcode) | Present (not part of this decision) |
| Normalization/trim behaviour covered by tests | `backend/src/modules/inventory/application/items.service.spec.ts` ("`BC-9`" trim case, blank ⇒ `null`, 65-char rejection) | Present |

**Conclusion:** clause 2/3 is a decided-but-unenforced rule. It is recorded as
an explicit gap, not silently treated as implemented.

## 6. Unresolved lifecycle questions → **OQ-65 (OPEN)**

The decision's canonical wording constrains **two *active* items**. It does
not state what becomes of the barcode of an item that is later **deactivated**.
Per the Owner's explicit instruction this must **not** be inferred from the
uniqueness rule in either direction. The following stay OPEN and are
registered as **OQ-65** in [`docs/open-questions.md`](../../open-questions.md):

1. **Reuse after deactivation (the primary question).** May a barcode that
   was assigned to a now-deactivated item be assigned to a different item in
   the same organization?
2. **Reactivation collision.** If reuse is permitted and the original item is
   later re-enabled, two active items would share a barcode. Is reactivation
   blocked, is the barcode cleared, or is the collision tolerated?
3. **Normalization and comparison semantics.** Is the uniqueness comparison
   case-sensitive? Are leading/trailing spaces, internal spaces, hyphens,
   leading zeros, or Persian/Arabic-Indic vs ASCII digits significant? (The
   stored value is trimmed today; nothing else is normalized, and the *search*
   path is case-insensitive while no comparison path exists.)
4. **Enforcement authority.** Must uniqueness be database-authoritative (a
   partial unique index) with a concurrency test, or is an application check
   acceptable? The index predicate itself depends on answer (1).
5. **Empty value semantics.** `''` is normalized to `NULL` today; must several
   items without a barcode remain permitted (they must, under "optional"), and
   is any distinction between "no barcode" and "blank barcode" ever meaningful?
6. **Applicability by kind.** Does the rule apply to non-stockable kinds
   (`service`, `asset`) as well, or only to physically scannable items?
7. **Deleted items.** If OD-C47-04 (OQ-36, Option C) deletion is ever exposed,
   does a physically deleted item free its barcode? (Interacts with the
   still-open OQ-36 code-reuse residue.)
8. **Migration posture for existing data.** If duplicates already exist in a
   deployment when the constraint is introduced, is the migration expected to
   fail, report, or quarantine? (No production data is in scope today; recorded
   so the follow-up cannot assume a clean table.)

## 7. Implementation follow-up (NOT authorized by this record)

Closing the §5 gap is a bounded, well-scoped change — but it needs OQ-65
answer (1) first, because the shape of the constraint is exactly what that
answer determines:

- *"active items only"* ⇒ a partial unique index such as
  `(organization_id, barcode) WHERE barcode IS NOT NULL AND is_active`;
- *"any item, active or not"* ⇒ `(organization_id, barcode) WHERE barcode IS NOT NULL`.

The follow-up would additionally require: an application pre-check with the
established conflict mapping (409, mirroring the item-code path), DTO/OpenAPI
text, regenerated frontend types if the contract text changes, and a
concurrency case in the existing `backend/test/item-master-live.e2e-spec.ts`
live-PostgreSQL suite. A Prisma migration is unavoidable, which is precisely
why it is excluded from the documentation task that records this decision.

## 8. Review rules

1. This record may be cited as **approved product policy** for clauses 1–7 of
   §2 only.
2. It must **not** be cited to add symbology validation, multiple barcodes per
   item, a scan endpoint, or any item-code behaviour.
3. It must **not** be cited to answer any OQ-65 item.
4. Recording this decision does **not** accept PR #106, PR #107, the C-47
   candidate, or the current item-master implementation.
