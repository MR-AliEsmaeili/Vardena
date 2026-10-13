# OQ-65: Item barcode lifecycle, reuse and comparison semantics

- **Type:** OQ (product/inventory policy decision)
- **Status:** **Open — reuse/lifecycle DECIDED 2026-10-05 (Owner Decision OD-65-01: a barcode is NEVER reusable within the organization).** Comparison/normalization semantics (question 2) remain **OPEN**.
- **Owner:** Ali Esmaeili (with Inventory domain expert)
- **Created:** 2026-10-02 · **Reuse decided:** 2026-10-05 (governance re-baseline; wording corrected 2026-10-06 — see §Enforcement implication)
- **Priority:** High · **Blocks** the bounded barcode-uniqueness implementation (candidate C-55); does **not** block any other Inventory candidate
- **Created by:** the barcode Owner decision [PDR-03](./PDR-03-item-barcode-policy.md) (OD-C47-03), which decided the uniqueness rule for **active** items and deliberately left the lifecycle detail unresolved
- **Related:** OQ-33 (item model), OQ-36 / [PDR-04](./PDR-04-item-deletion-and-code-reuse.md) (master-data lifecycle, code reuse), `docs/architecture/domain/master-data-strategy.md` §7, [C-47 preflight](../../tasks/c-47-item-master-preflight-investigation.md) §4

```text
Never-reuse policy
        ↓
OWNER DECISION — RESOLVED (OD-65-01)

Barcode comparison / normalization semantics
        ↓
OPEN — NOT YET DECIDED
```

## Owner Decision (2026-10-05) — OD-65-01: no reuse, ever

> **A barcode is never reusable within the organization.**

### Business invariant

For a given organization:

> **Once a barcode has been assigned to an item, that barcode is permanently
> consumed for that organization and may never be assigned to another item
> again — even if the original assignment is later cleared, replaced,
> deactivated, retired, or the item otherwise stops using the barcode.**

The rule applies for the **entire lifetime of the organization**. The invariant
is defined over **assignment history**, not merely over the current
`Item.barcode` value:

```text
assignment history matters   —   not merely the current Item.barcode value
```

### Cases explicitly covered by the invariant

| # | Case | Rule |
|---|---|---|
| 1 | **Active assignment** — Item A → barcode `123456` | No other item may use `123456`. |
| 2 | **Barcode cleared** — Item A → `123456`, then Item A → `NULL` | `123456` remains consumed; Item B → `123456` is **prohibited**. |
| 3 | **Item retired/deactivated** — Item A → `123456`, Item A retired | `123456` remains permanently consumed. |
| 4 | **Barcode replacement** — Item A → `123456`, then Item A → `987654` | `123456` remains permanently consumed (and `987654` is now consumed too). |
| 5 | **Historical assignment** — the current item record no longer contains the barcode at all | The organization still considers that barcode consumed. |

Consequences for the previously registered sub-questions: **Q1** (reuse after
deactivation) — no; **Q3** (inactive-vs-inactive collisions) — not permitted,
no two items ever share an assigned barcode; **Q4** (re-activation) — no
collision can exist because the barcode was never released, so re-activation is
unaffected; **Q5** (clearing) — clearing does **not** release the barcode
(Case 2).

## Enforcement implication (NOT an implementation decision)

> **A uniqueness constraint over only the currently assigned barcode value is
> insufficient to guarantee the Owner decision** after a barcode is cleared,
> replaced, retired, or otherwise removed from the current item record.

```text
current-value uniqueness  ≠  historical never-reuse
```

A plain current-row unique index such as `(organization_id, barcode)` over
non-null values would **permit** the prohibited Case 2/4/5 sequence (clear the
barcode on Item A → the row no longer holds the value → Item B takes it). A
current-value constraint may still be useful as **one possible part** of a
future enforcement design, but it cannot by itself satisfy the full Owner
invariant and must not be presented as sufficient.

Satisfying the invariant requires some form of **persistent historical
consumption/assignment record or an equivalent immutable reservation
mechanism** — i.e., the enforcement property is *history-aware*, not
*current-state-only*. **This record deliberately does NOT choose the design**:
whether the future implementation uses a dedicated barcode history table, an
immutable reservation table, an append-only assignment record, another
relational design, or another mechanism is an implementation/architecture
detail for a future task.

### Future implementation gate

> The concrete persistence/enforcement design remains a **future
> implementation decision** and must be handled in a **separate implementation
> task** after the remaining barcode comparison/normalization question (Q2
> below) is resolved. Candidate **C-55** remains blocked accordingly.

**Scope of this decision:** documentation/governance only. No barcode
constraint, schema, migration, index, repository/service code, API or test is
implemented or authorized by this record. Future acceptance test (documented,
not implemented): a previously assigned barcode — including a cleared,
replaced or retired one — cannot be assigned to another item in the same
organization. Deciding record of the uniqueness rule for active items: PDR-03
(OD-C47-03) — unchanged.

## Still OPEN — Q2: comparison/normalization semantics

Case sensitivity on the trimmed raw string vs normalization (case folding,
leading-zero handling, whitespace/special characters, Unicode/Persian digit
folding), and whether visually or textually equivalent representations count
as the same barcode, are **NOT decided**. List *search* is already
case-insensitive substring matching, which is a different concern and must not
be read as a comparison rule. Q2 must be answered before any uniqueness/
never-reuse enforcement is implemented; no answer may be inferred from generic
ERP behavior or from an implementation preference.

## Context (historical — as registered 2026-10-02)

OD-C47-03 (PDR-03) decided: a barcode is optional; **two active items in the
same organization must not have the same barcode**; different organizations may
use the same barcode; multiple formats are supported without strict symbology
validation; no multi-barcode-per-item support.

Current `main` has **no** barcode constraint of any kind: `inventory.items.barcode`
is a nullable `varchar(64)` that is trimmed, length-checked and stored verbatim
(`backend/src/modules/inventory/application/items.service.ts`,
`backend/prisma/schema/inventory.prisma`). The only item unique key is
`(organization_id, code)`.

Enforcing the decided rule therefore requires new enforcement — and **every
candidate enforcement shape silently answers questions the Owner had not
answered** at the time this record was created.

### Questions as originally registered (Q1/Q3/Q4/Q5 now answered by OD-65-01; Q2 still open)

1. **Reuse after deactivation.** May a barcode assigned to a **deactivated**
   item be reused by another item in the same organization? → **Answered: no**
   (OD-65-01).
2. **Comparison semantics.** Is uniqueness compared case-sensitively on the
   trimmed raw string (consistent with item-code comparison today), or is a
   normalization required? → **OPEN.**
3. **Inactive-vs-inactive collisions.** May two inactive items hold the same
   barcode? → **Answered: no** (OD-65-01).
4. **Re-activation.** If item A is deactivated and later re-activated — is
   there a collision? → **Answered: none can exist** (the barcode is never
   released; OD-65-01).
5. **Clearing and re-assignment.** Does a cleared barcode become reusable? →
   **Answered: no** (OD-65-01, Case 2).

## Options (historical — superseded by OD-65-01)

> The table below is the option analysis as registered on 2026-10-02, kept for
> traceability. **Note:** its index-shape sketches describe *current-row*
> constraints; after OD-65-01, the "plain unique index over non-null barcodes"
> sketch attached to Option A is **not** a sufficient enforcement of the
> decided invariant (see §Enforcement implication) — the Owner decided the
> Option A *semantics* (no reuse ever), not that index shape.

| Option | Semantics | Consequences |
|---|---|---|
| **A — No reuse ever** (sketched at the time as a plain unique index over non-null barcodes) | A barcode is permanently bound to the item it was first assigned to, active or not | Simplest invariant; historical scans stay unambiguous; operators cannot re-label a barcode without editing/clearing the old item (needs an `Edit` path and a policy for who may do it) |
| **B — Reuse allowed after deactivation** (partial unique index on active rows) | Only active items compete for a barcode | Matches the OD-C47-03 wording literally; allows re-labelling; a historical scan value may map to several items over time — any future scan lookup must disambiguate by date/state |
| **C — Reuse allowed only after an explicit release action** | Deactivation does not free the barcode; a separate audited "release barcode" operation does | Most controlled, most expensive: new operation, permission, audit surface (no Audit module exists) |

*(Historical note: no option was recommended when this record was created.
On 2026-10-05 the Owner decided the **Option A semantics — no reuse ever**;
see the Owner Decision section above. The operational consequence noted for
A — re-labelling requires clearing/editing the retired item, and the cleared
barcode still never returns to the pool — is accepted by that decision.)*

## Dependencies

- The reuse decision (OD-65-01) is recorded; **C-55** (organization-scoped
  barcode never-reuse/uniqueness enforcement) remains **blocked** by the open
  Q2 comparison semantics and normal task gating.
- Interacts with OQ-36 / PDR-04 (if physical deletion of a never-referenced
  item is ever implemented, what happens to that item's assignment history is
  an enforcement-design question for the future task; the business invariant
  of OD-65-01 is unaffected).
- Interacts with OQ-33 only in that any future multi-barcode capability would
  re-open the enforcement shape (not the never-reuse invariant).

## Decision deadline or dependency

Q2 must be decided before any barcode comparison/uniqueness/never-reuse
enforcement, migration or scan-oriented API is implemented. Nothing else in
the Inventory MVP path waits on it.
