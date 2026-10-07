# PDR-08: Transfer, Return, Reversal and Reverse Pricing valuation

- **Type:** PDR (Product Decision Record) · decision ids **OD-TRF-01 … 09**, **OD-RET-01 … 07**, **OD-REV-01 … 08**, **OD-RVP-01 … 08**, **OD-PDP-01 … 05**
- **Status:** **Decided** — Decision Sprint held 2026-10-06 against external vendor evidence; recorded from the "Transfer/Return/Reversal Decision Sprint" work order
- **Decided by:** Repository Owner (Ali Esmaeili)
- **Registry rows:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-67 → Resolved**, **OQ-68 → Resolved**, **OQ-69 stays OPEN**, **OQ-70** and **OQ-71** stay OPEN *for their Accounting-side counterpart only*, **OQ-24 stays OPEN**
- **Recording baseline:** `main` @ `d0dc28691a646a1ea194a35cc233e04a58b7d459`
- **Builds on:** [PDR-07](./PDR-07-inventory-pricing-sources-and-periodic-pricing-operation.md) (OD-PRC-01…12) · [PDR-05](./PDR-05-inventory-valuation-and-cost-optional-operations.md) (OD-VAL-01…19) · ADR-0039 / ADR-0040 (both **Proposed**) · ADR-0017 / ADR-0022 (ledger authority)

> **Scope limit.** This record decides *valuation conventions*. It
> **authorizes no implementation**, promotes no ADR, and does not start C-59.
> Where the evidence was insufficient, the item is recorded as OPEN with its
> reason — a guess is never promoted to a Decision.

---

## 0. How to read this record

Every topic below separates three things that must never be merged:

- **Evidence** — what a reference product verifiably does, with its source and
  its authority level.
- **Recommendation** — what Vardena *should* do, and why.
- **Decision** — what Vardena *will* do, as a citable rule.

### 0.1 Evidence authority levels

| Level | Meaning |
|---|---|
| **V** | Vendor-published (the vendor's own site/documentation) |
| **T** | Third-party (reseller, consultant, training site) — corroborating only, never presented as a vendor statement |
| **N** | No authoritative public source found → `Evidence not sufficient` |

### 0.2 Sources consulted

| # | Source | Level | Used for |
|---|---|---|---|
| S1 | Sepidar System — *نحوه قیمت گذاری در سپیدار*, `https://www.sepidarsystem.com/blog/pricing-in-sepidar/` (updated 1405-03-17) | **V** | Pricing operation scope/mechanics, which forms are priced, receipt-without-price rule, transfer pricing order, purchase/sales return basis rules, reverse-pricing preconditions |
| S2 | Sepidar System — *حسابداری انبار چیست؟*, `https://www.sepidarsystem.com/blog/warehouse-accounting/` | **V** | Transfer: the source transfer-issue is valued first and the destination receipt value equals it |
| S3 | Sepidar System — *آموزش سیستم تامین کنندگان و انبار*, `https://www.sepidarsystem.com/blog/sepidar-inventory-system/` | **V** | Quantity-only vs value access separation; basis (`مبنا`) propagation between documents |
| S4 | Hamkaran System (Rahkaran) — *نرم افزار انبارداری و حسابداری انبار راهکاران*, `https://www.systemgroup.net/products/rahkaran/supply-chain/warehousing/` | **V** | Rahkaran prices **both** inbound and outbound documents, supports several methods, applies ancillary (landed) costs, and posts accounting **aggregated over defined time ranges** |
| S5 | `virateam.com/قیمت-گذاری-اسناد-انبار/` | **T** | Reverse-pricing ordering constraint (latest run only) |
| S6 | `narvanhesab.com` — compendium of Sepidar error messages | **T** | Exact refusal text when an accounting document blocks reverse pricing; post-pricing document lock |
| S7 | `sadramohaseb.com` | **T** | A receipt may be registered without a price, but **no accounting document is issued for it** |
| S8 | `modiriatmali.com` — Rahkaran inventory feature list | **T** | Rahkaran auto-pricing by last purchase rate / last consumption rate / standard rate / actual rate |

> **Rahkaran honesty note.** Hamkaran System publishes *capability* pages, not
> operational semantics. For every Rahkaran cell below where no authoritative
> statement exists, this record writes **`Evidence not sufficient`** rather
> than attributing behaviour to the vendor. S8 is third-party and is labelled
> as such.

---

## 1. Summary table (the required Sprint output)

| Topic | Sepidar Evidence | Rahkaran Evidence | Vardena Recommendation | Decision |
|---|---|---|---|---|
| **Transfer** | **V (S2):** the source transfer-issue is priced first and *"the amount of this document must equal the value of the goods-in document at the destination warehouse"*. **V (S1):** the operational procedure is explicitly ordered — price the **source** warehouse (`خروج انبار`) first, the **destination** warehouse (`رسید انبار`) last; shorter date windows are advised when transfers are frequent; the GL sub-accounts for both legs are fixed at transfer registration | **V (S4):** inbound *and* outbound documents are priced and multi-warehouse/multi-branch is supported. **N** for the direction of transfer valuation | **Option A — source-side valuation.** The destination leg derives its value from the source leg; it is a Derived Price (OD-PRC-03), not an independent pricing | **OD-TRF-01…09** — Option A adopted. Source value flows to destination; per-warehouse averages legitimately diverge; organization-level average is a reporting roll-up only. **OQ-67 RESOLVED** |
| **Purchase Return** | **V (S1):** when registered **with a basis** (`مبنادار`) on the original receipt, the goods *"are returned at the same price at which they were purchased"*; without a basis, no manual price is allowed and the Pricing Operation computes it. Since v5.1.2 an **agreed return amount** may be entered, and any difference against the computed value posts to a dedicated difference account (`معین اختلاف توافقی بهای تمام شده برگشت رسید`). GL: Dr Payables/counterparty detail, Cr Inventory | **V (S4):** ancillary costs are applied to inventory cost. **N** for return costing | Basis-linked → **original receipt cost**. Non-basis-linked → **current Moving Weighted Average**. A settlement difference is a **variance**, never absorbed into the average (consistent with OD-VAL-09) | **OD-RET-01…04** — adopted. **OQ-70 stays OPEN only for the variance account mapping** (owned by Accounting) |
| **Sales Return** | **V (S1):** *"a return-of-issue is equivalent to a receipt (inbound) and is recorded at the weighted-average purchase price"*. With a basis on the return invoice a manual amount **is** permitted; if omitted, the Pricing Operation computes it by moving weighted average. If a return-of-issue is the item's **first** movement the average cannot be computed and Sepidar refuses / requires a manual rate | **N** | **Inventory cost, never the sales price.** The sales price reverses revenue in Sales/GL; it has nothing to do with what the goods cost. Cold start (no valued pool) → fail closed | **OD-RET-05…07** — adopted. **Return ≠ Reversal** is itself a decision |
| **Reversal** | **N for a valued counter-movement.** Sepidar's correction model is *mutate-and-redo* (delete the accounting document → reverse the pricing → edit/delete the inventory document → re-price), which an append-only ledger cannot adopt — see §4.1 | **N** | Reverse **the original movement's own recorded value**. It is the only convention that keeps `SUM(movement value) == state value` exact without a variance account the MVP does not have | **OD-REV-01…08** — original-value convention confirmed. **OQ-68 RESOLVED** |
| **Reverse Pricing** | **V (S1):** a pricing run may be reversed only when (1) the accounting documents issued for the affected forms have been deleted, and (2) the run is selected in the pricing list and `برگشت از محاسبه` is used. **T (S5):** only the **latest** run of a warehouse is reversible. **T (S6):** with an accounting document present the system **refuses** — *"امکان برگشت از قیمت‌گذاری وجود ندارد، زیرا برای تعدادی از اسناد، سند حسابداری صادر شده است"* — it does **not** cascade | **V (S4):** accounting is posted **aggregated over time ranges**, which implies a comparable run-level dependency. **N** for reversal semantics | Run-scoped, latest-run-only, **fail closed** on any accounting document, quantity untouched, and — unlike Sepidar — the reversed run is **retained** with a compensating run, because ADR-0017 forbids erasure | **OD-RVP-01…08** — adopted. **OQ-71 stays OPEN only for the Accounting-side reversal flow** |

---

## 2. Transfer

### 2.1 Context and problem

OQ-67 asked whether a per-warehouse average that diverges from a sibling
warehouse's average after a transfer is the accountant's *intent* or an
accident of OD-VAL-04. It also left unstated which side of a transfer
determines value. Until this is fixed, C-59C cannot be built, and the merged
C-58 runtime fails closed on every backdated transfer
(`inventory.backdated_transfer_valuation_unresolved`).

### 2.2 Evidence

**Sepidar (V, S2)** — *"the first step is to determine the price of the
transfer-issue document of the source warehouse. The amount of this document
must equal the value of the goods-in document at the destination warehouse."*

**Sepidar (V, S1)** — the operational procedure for an inter-warehouse
transfer is explicitly sequenced:

1. run the inventory-document pricing for the **source** warehouse (the issue) first;
2. run it for the **destination** warehouse (the receipt) last;
3. keep the pricing date windows short when transfers happen in quick succession;
4. fix the debit sub-account of the issue and the credit sub-account of the receipt **at transfer registration time**, before pricing.

**Corroboration (T)** — the same source-first/destination-equal statement
appears in independent third-party inventory-accounting material, and
third-party year-end guidance adds that a transfer-issue must have its
destination receipt issued before year-end and that warehouses which traded
with each other are closed **simultaneously** — i.e. the two legs are a
coupled pair for valuation purposes, not two independent documents.

**Rahkaran** — `Evidence not sufficient` for the valuation direction. The
vendor page (V, S4) confirms only that inbound and outbound documents are
both priced and that multi-warehouse operation is supported.

### 2.3 The scenario, answered

Warehouse A: Item X, average cost 100,000. Warehouse B: Item X, average cost
150,000. Transfer 10 units A → B.

| # | Question | Answer |
|---|---|---|
| 1 | Source issue valuation | 10 × **100,000** = 1,000,000 — the **source** key's Moving Weighted Average at the transfer's business date |
| 2 | Destination receipt valuation | **Exactly 1,000,000** (unit 100,000) — derived from leg 1 |
| 3 | Does the destination take the source value? | **Yes.** This is the whole rule |
| 4 | Does B's prior 150,000 affect the transfer? | **No.** It affects only B's average *after* the transfer (B's existing pool at 150,000 blended with 10 incoming units at 100,000) |
| 5 | Does a transfer cause average divergence? | **Yes, and that is intended.** A's average is unchanged (removing stock at its own average is neutral); B's average moves toward 100,000 |
| 6 | Two valuation legs? | **Yes** — one atomic pair, never two independent documents |
| 7 | Is destination-side pricing separate? | **No.** Destination value is *derived*, not independently priced. Sepidar's two pricing runs are a **mechanical sequencing** fact of its per-warehouse batch, not two independent valuations |
| 8 | Reverse transfer | A mirror pair at the **original legs' own values** (§4), **not** a fresh transfer back at today's average |
| 9 | Source issue unpriced | The transfer stays **operational**; both legs stay `unvalued`; **accounting eligibility is denied for the pair**. The quantity movement is never blocked (OD-PRC-10) |
| 10 | Destination receipt already operational | Cannot arise in Vardena: a transfer is **one document with two legs posted atomically**. Sepidar's two-document model is a rejected alternative (§2.6) |
| 11 | When is the accounting document allowed? | Only when **both** legs are priced. The pair is one accounting event; a partially priced transfer is never accounting-eligible |

### 2.4 Options compared

| | **A — Source price** | **B — Destination price** | **C — Source unit price + independent transfer posting** |
|---|---|---|---|
| Business behaviour | Value travels with the goods | Destination re-values incoming stock at its own average | Source price plus a separate valuation event |
| Accounting effect | Dr destination inventory / Cr source inventory, equal amounts — value-neutral | Creates value out of nothing (or destroys it) on every transfer | Needs a third account to absorb the delta |
| Average-cost effect | Deterministic; only the destination average moves | Destination average never moves — which is wrong, incoming goods did not cost that | Introduces a variance with no owner in the MVP |
| Reverse behaviour | Exact mirror | Not reversible to the same numbers | Requires reversing the variance too |
| Complexity | Low — already implemented | Low but wrong | High |
| Iranian ERP practice | **Matches Sepidar (V, S1/S2)** | Contradicts it | No evidence |

### 2.5 Decision — OD-TRF-01 … 09

| id | Decision |
|---|---|
| **OD-TRF-01** | **Option A.** A transfer is valued **source-side**. The destination leg's value is **derived** from the source leg (a Derived Price under OD-PRC-03), never independently priced and never manually entered. |
| **OD-TRF-02** | **A transfer is exactly value-neutral at organization level.** The out leg removes the source's share of value; the in leg adds the identical amount. No value is created or destroyed. |
| **OD-TRF-03** | **Per-warehouse average divergence is INTENDED, not a defect.** The authoritative valuation key stays organization + warehouse + item (OD-VAL-04). This is the substantive answer to OQ-67. |
| **OD-TRF-04** | **Any organization-level "one average per item" figure is a reporting roll-up computed from the per-warehouse keys.** It is never a second stored state and never feeds a posting. A report that sums per-warehouse values is correct by construction, because the legs are value-neutral. |
| **OD-TRF-05** | **A transfer has exactly two valuation legs and they are one atomic pair.** Partial valuation of a transfer is not a representable state for accounting purposes. |
| **OD-TRF-06** | **A transfer never accepts a manual cost** (confirms the implemented refusal). Its value is whatever the source key already held. |
| **OD-TRF-07** | **If the source leg cannot be valued, both legs stay `unvalued` and the pair is not accounting-eligible.** The quantity effect is still posted and still final (OD-PRC-10). |
| **OD-TRF-08** | **Ordering rule for the Pricing Operation:** the source key must be priced before the destination key. When both are in scope, the operation enforces the ordering itself; a destination-only scope that would value a leg whose source is still unpriced is **refused with a named reason**, never silently valued. |
| **OD-TRF-09** | **Backdated transfers remain fail-closed for V1 — but the reason has changed.** The *convention* is now decided (OD-TRF-01). What is missing is the **coupled two-key replay** (source and destination must be replayed together, in order). That is an **implementation gap assigned to C-59C**, no longer an undecided domain question. The current refusal code stays until that replay exists — **IMPLEMENTED 2026-10-07 (C-59C):** the replay exists (`domain/transfer-replay.ts` + `data/inventory-transfer-replay.ts`, OD-VAL-10 confirmation and `Inventory.Valuation.Recalculate` required, bounded by OD-VAL-12), and the retired refusal code is emitted by no path. |

### 2.6 Rejected alternatives

- **Option B (destination price).** Contradicts the vendor evidence and
  fabricates value on every transfer.
- **Option C (independent transfer posting).** Requires a variance account the
  MVP does not have; OD-VAL-16's "no residual drift" rule would be violated.
- **Sepidar's two-document transfer model** (a separate `خروج انبار` and
  `رسید انبار` linked by basis). Vardena keeps **one transfer document with
  two atomic legs**: it makes OD-TRF-05 structural instead of procedural, and
  it removes the "destination receipt was never issued" failure mode that
  Sepidar's year-end guidance has to warn about.

### 2.7 Implementation impact

Confirms the already-merged `applyTransfer` neutrality — **no behaviour change
is required for the non-backdated path**. C-59C must add the coupled
source-then-destination replay and lift OD-TRF-09. OQ-67's registry row moves
to Resolved.

---

## 3. Return

### 3.1 Context and problem

OD-VAL-19 deferred return costing and warned explicitly that the reversal rule
("undo the value the original carried") **must not** be read as the return
rule. C-59D cannot be scoped until the actual rule exists.

### 3.2 Evidence

**Purchase return — `برگشت رسید انبار` (Sepidar, V, S1)**

- Return documents carry a **basis** column (`مبنا`) linking them to an originating document.
- *"If a receipt-return is registered with a receipt as its basis, the goods are returned at the same price at which they were purchased."* Otherwise the amount **cannot** be entered manually.
- Without a basis, the Pricing Operation computes the value by moving weighted average.
- From v5.1.2, an **agreed purchase-return amount** may be recorded; where it differs from the system-computed value, the difference is posted to a dedicated account (`معین اختلاف توافقی بهای تمام شده برگشت رسید`).
- Resulting GL entry: **Dr** Accounts Payable / counterparty detail, **Cr** Inventory, plus the difference account when a difference exists.
- Operational warning: do **not** register a basis-linked receipt-return when the item's quantity at that date is zero (a documented cause of negative stock).

**Sales return — `برگشت خروج انبار` (Sepidar, V, S1)**

- *"A return-of-issue is equivalent to a receipt (inbound) and, applying the weighted-average formula, is recorded at the average purchase price."*
- With the return invoice as basis, a manual amount **is** permitted; if it is omitted, the Pricing Operation values it by moving weighted average (the system warns that it will).
- If a return-of-issue is the item's **first ever** movement there is no average to apply: Sepidar refuses, and the user must either enter a rate manually (sales-type return) or register an ordinary receipt instead (consumption/other-type return).

**Receipt without a price (T, S7)** — a receipt may be registered with no
price, *but no accounting document is issued for it*. This independently
corroborates OD-PRC-09/OD-PRC-11.

**Rahkaran** — `Evidence not sufficient` for return costing.

### 3.3 Decision — OD-RET-01 … 07

| id | Decision |
|---|---|
| **OD-RET-01** | **A Return is a first-class business document with an optional BASIS** — an explicit link to the originating receipt (purchase return) or issue/invoice (sales return). The basis is what determines the costing route. |
| **OD-RET-02** | **Purchase return WITH a basis leaves at the ORIGINAL receipt's own recorded cost.** Not the current average, not the last valuation. |
| **OD-RET-03** | **Purchase return WITHOUT a basis leaves at the key's current Moving Weighted Average at the return date**, supplied by the Pricing Operation. No manual price is accepted in that case. |
| **OD-RET-04** | **A settlement/agreed return amount is NOT an inventory cost.** Where the amount agreed with the counterparty differs from the inventory value computed by OD-RET-02/03, the difference is a **variance** recognised outside the inventory average. It is **never** absorbed into the Moving Weighted Average, and it never changes the value of stock that remains on hand. This is OD-VAL-09 ("purchase price ≠ inventory cost") applied to returns. |
| **OD-RET-05** | **A sales return re-enters inventory at INVENTORY COST, never at the sales price.** The sales price reverses revenue in Sales/GL and has no inventory-valuation meaning. |
| **OD-RET-06** | **Sales-return inventory cost = the key's current Moving Weighted Average at the return date.** Where the return carries a basis on the original issue and the operator supplies an explicit amount, that amount is a Manual Price under OD-PRC-02 and is honoured — any difference is treated under OD-RET-04. |
| **OD-RET-07** | **Cold start fails closed.** If a return would be the first valued inbound on its key (no valued pool exists), Vardena **refuses** with a named reason and requires an explicit valuation. It never values returned stock at zero and never invents an average. |

### 3.4 Rationale

The decisive finding is that **Return and Reversal use different
conventions**, and the evidence says so directly: Sepidar treats returns as
ordinary *priced* documents flowing through the normal pricing operation,
while a reversal/correction is handled by unwinding the pricing and the
document itself. OD-VAL-19's warning is therefore confirmed by evidence rather
than by caution. OD-RET-04 is the second load-bearing rule: it is the only
thing preventing a commercial negotiation from silently rewriting the cost of
stock still sitting in the warehouse.

### 3.5 What stays OPEN

**OQ-70 stays OPEN** for the **variance account mapping** of OD-RET-04 — which
account the difference lands in, and whether it is a Factor-domain concern. That
is an Accounting decision (OQ-39 / OQ-42) and an Inventory record must not make
it.

### 3.6 Rejected alternatives

| Rejected | Why |
|---|---|
| Sales return at the **sales invoice price** | Would inject margin into inventory cost. Contradicted directly by S1. |
| Purchase return at the **current average** even when a basis exists | Contradicted by S1; also lets unrelated later purchases change what a specific supplier return is worth. |
| Return = Reversal (mirror the original movement's value) | Explicitly warned against by OD-VAL-19 and contradicted by the evidence: a basis-linked purchase return happens to coincide, a sales return does not. |
| Absorbing a settlement difference into the average | Rewrites the cost of stock that was never part of the negotiation (OD-RET-04). |

---

## 4. Reversal

### 4.1 Evidence — and an honest statement of its absence

**No vendor evidence exists for "reverse at original value vs reverse at
current value", because the reference products do not have that question.**
Sepidar's correction model (V, S1; T, S6) is *mutate-and-redo*:

1. delete the accounting documents issued for the affected inventory documents;
2. reverse the pricing run (`برگشت از محاسبه`);
3. edit or delete the inventory document — which is otherwise **locked**: every inventory document of a warehouse dated on or before the last pricing date is non-editable and non-deletable;
4. re-run the pricing.

Vardena **cannot** adopt that model: ADR-0017/ADR-0022 make the movement
ledger append-only, so a posted fact is corrected by a counter-movement, never
by mutation. The reversal convention must therefore be decided on
**internal-consistency** grounds, and this record says so plainly instead of
dressing an internal decision as vendor practice.

**Rahkaran** — `Evidence not sufficient`.

### 4.2 Decision — OD-REV-01 … 08

| id | Decision |
|---|---|
| **OD-REV-01** | **A reversal undoes the ORIGINAL movement's own recorded value**, read from the locked original row — never the key's current average at reversal time. This confirms the implemented convention and **resolves OQ-68**. |
| **OD-REV-02** | **Rationale of record:** it is the only convention that keeps `SUM(movement value) == state value` exact. Reversing at the current average produces a delta that must land somewhere, and the MVP has no variance account to put it in (OD-VAL-16 forbids letting it drift into the residual). |
| **OD-REV-03** | **"The original's own value" means the value the original row carries AT REVERSAL TIME.** If the original was legitimately repriced after posting, the reversal mirrors the repriced value. Vardena does not keep a frozen snapshot of a superseded value for this purpose. |
| **OD-REV-04** | **If the original is `unvalued`, the reversal is `unvalued`.** Mirroring nothing yields nothing; both become accounting-eligible together, never separately. |
| **OD-REV-05** | **If the valued pool no longer holds the reversed quantity, the reversal degrades to `provisional` and marks the key `stale`** rather than inventing a number. This confirms the implemented behaviour and applies the OD-VAL-11 honesty rule (a visibly wrong number over a silently wrong one). |
| **OD-REV-06** | **A reversal is never dated before the fact it mirrors.** Confirms the implemented rule. |
| **OD-REV-07** | **After Accounting Post there is NO reversal path.** The document is immutable; the only correction is an explicit correction document. Its convention is **not** decided here — OQ-27 (accounting correction windows) stays OPEN. |
| **OD-REV-08** | **Reversal convention ≠ Return convention.** Stated as a decision so it cannot be eroded: Reversal mirrors the original's own value (OD-REV-01); a Return is priced by §3. A Return is **never** implemented by reusing the reversal path. |

### 4.3 Interaction with Reverse Pricing

If a pricing run that valued the original is reversed, the original becomes
`unvalued`; by OD-REV-04 an existing reversal of it becomes `unvalued` too.
Both are repriced together by the next Pricing Operation on that key. This is
the one case where §4 and §5 interact, and it is deterministic because both
rules key off the same row.

### 4.4 Consequences

Deterministic and auditable: the reversal value is **read**, never recomputed,
so replaying the ledger reproduces it exactly. The accepted cost is that a
reversal long after a price change does not reflect the current average —
which is the correct accounting answer, because the goods being unwound are
the goods that were originally moved.

---

## 5. Reverse Pricing

### 5.1 Evidence

**Sepidar (V, S1)** — a completed pricing run may be reversed only when:

1. the accounting documents issued for each of the affected forms have been deleted (in bulk); then
2. the run is selected in the list of performed pricings and `برگشت از محاسبه` is chosen.

**Sepidar (T, S5)** — in each warehouse only the **last** pricing run is
reversible; if a later run exists, the earlier one cannot be removed.

**Sepidar (T, S6)** — with an accounting document present the system **refuses
outright**: *"امکان برگشت از قیمت‌گذاری وجود ندارد، زیرا برای تعدادی از اسناد، سند
حسابداری صادر شده است"* — "reverse pricing is not possible, because an
accounting document has been issued for a number of the documents." It does
**not** cascade into Accounting. The same source records that after pricing,
all inventory documents of that warehouse dated ≤ the last pricing date are
locked against edit and delete.

**Quantity (V, S1 + T)** — reverse pricing is a **value-only** operation.
Quantity control (`انبارگردانی`) is explicitly independent of pricing.

**Rahkaran** — `Evidence not sufficient` for reversal semantics. The vendor
page (V, S4) does confirm that accounting is posted **aggregated over defined
time ranges**, which implies a comparable run-level dependency between pricing
and posting.

### 5.2 Decision — OD-RVP-01 … 08

| id | Decision |
|---|---|
| **OD-RVP-01** | **Reverse Pricing is scoped to a PRICING RUN, not to a document.** The unit of reversal is the run recorded in `inventory_valuation_runs`. |
| **OD-RVP-02** | **Only the LATEST run on a key may be reversed.** Runs are reversed in strict reverse order. A run with a later run on the same key is refused with a named reason. |
| **OD-RVP-03** | **BLOCKED — never cascading — while any affected document has an accounting document created or posted.** Vardena refuses and **names the blocking documents**. An Inventory command never deletes or reverses an Accounting document as a side effect. |
| **OD-RVP-04** | **Reverse Pricing NEVER changes inventory quantity.** It is a valuation-only operation; the ledger's quantity facts are untouched. |
| **OD-RVP-05** | **The reversed run is RETAINED, not erased.** Vardena records a **compensating run** that points at the run it reverses and restores the affected movements and valuation state to their pre-run condition. The original run stays visible. This is a deliberate divergence from Sepidar (which deletes the pricing) and is required by ADR-0017 and by OD-VH-01. |
| **OD-RVP-06** | **After a successful reverse, the affected movements return to `unvalued` and the key is marked as requiring repricing.** It is never left silently holding the reversed values. |
| **OD-RVP-07** | **Transfer coupling fails closed.** If the run being reversed valued a transfer **source** leg whose paired destination key has since been valued, the reversal is **refused** with a named reason. Relaxing this into a coordinated two-key cascade is a possible later enhancement; it is not invented now. |
| **OD-RVP-08** | **Reverse Pricing requires its own authority**, distinct from running a pricing operation. Un-pricing already-published figures is a different act from computing them. |

### 5.3 Explicitly rejected: Sepidar's post-pricing document lock

Sepidar locks every inventory document dated ≤ the last pricing date against
edit and delete, forcing a reverse-pricing round trip for any correction.
**Vardena does not adopt this.** Its equivalent controls already exist and are
better targeted:

- **OQ-54 / ADR-0040**: a pre-post edit requires an explicit side-effect acknowledgement **and** an explicit repricing choice, with no default;
- **the Accounting Post boundary** is the hard lock, where it belongs.

Adopting Sepidar's lock would re-introduce the very coupling OD-PRC-10
forbids: an accounting-side batch freezing ordinary warehouse correction.

### 5.4 What stays OPEN

**OQ-71 stays OPEN** for the Accounting-side counterpart only: what a
compliant accounting-document reversal/deletion flow looks like so that
OD-RVP-03's precondition can actually be satisfied by a user. That is owned by
OQ-27 / OQ-39 / OQ-42.

---

## 6. Pricing dependencies — OD-PDP-01 … 05

### 6.1 Evidence

**Sepidar (V, S1)**

- The pricing form is scoped by **warehouse** and by a **to-date**; the **from-date is set automatically** by the system, either from the start of the fiscal year or from the end date of the last pricing performed — i.e. runs are **contiguous and non-overlapping** per warehouse.
- *"When the relevant inventory receipt has no price, pricing does not take place at all."*
- Pricing calculations are available for **issue**, **return-of-issue** and **return-of-receipt** forms, and **manual price entry is not possible in those forms**.
- A run also fails when a sales invoice in range has no matching issue (or quantities disagree), and when an inventory sub-account was not selected at registration. Sepidar provides a worklist (`فعالیت‌های روز`) to resolve exactly these.
- After pricing, accounting documents are issued **in bulk** from the document lists.

### 6.2 Decision

| id | Decision |
|---|---|
| **OD-PDP-01** | **A Pricing Operation is scoped by organization + warehouse scope + document kinds + date range.** The **from-date defaults to immediately after the last completed run** for that scope; the operator chooses the to-date. Runs on a key are **contiguous and non-overlapping**. |
| **OD-PDP-02** | **Pricing computes values for documents whose decided source is the Pricing Operation** — outbound movements and non-basis-linked returns. It never overwrites a Manual Price or a validly Derived Price (OD-PRC-04). |
| **OD-PDP-03** | **An inbound in range with no resolvable value makes that KEY fail**, with a named reason naming the offending documents. It does **not** fail unrelated keys: the run reports per-key and per-document success/failure counts (OD-PRC-07). This is Vardena's deliberate softening of Sepidar's all-or-nothing refusal, and it does not weaken any gate — the affected documents simply stay unpriced and accounting-ineligible. |
| **OD-PDP-04** | **Transfer ordering is enforced by the operation itself** (OD-TRF-08): source key before destination key. |
| **OD-PDP-05** | **Pricing never changes quantity, never posts accounting, and never blocks a quantity posting.** Accounting document creation is a separate, explicitly invoked step gated by OD-PRC-11. |

---

## 7. Registry effect

| Row | Before | After |
|---|---|---|
| **OQ-67** — transfer average divergence | OPEN | **RESOLVED** — OD-TRF-01…09 |
| **OQ-68** — reversal costing convention | OPEN | **RESOLVED** — OD-REV-01…08 |
| **OQ-69** — per-movement valuation history | OPEN | **OPEN** — OD-VH-01 fixes the *architecture* (ledger authority + immutable history); whether the current run record is *sufficient* for audit is still an accountant/auditor question |
| **OQ-70** — return costing | OPEN | **OPEN** — costing rule decided (OD-RET-01…07); variance **account mapping** unresolved |
| **OQ-71** — reverse-pricing constraints | OPEN | **OPEN** — inventory-side constraints decided (OD-RVP-01…08); Accounting-side reversal flow unresolved |
| **OQ-24** — inventory valuation and stock policy | OPEN | **OPEN** — COGS posting, landed cost, valuation precision/currency, FIFO/LIFO, lot/serial valuation all untouched |

## 8. Implementation impact (planning only — nothing is authorized)

| Decision | Impact |
|---|---|
| OD-TRF-01…07 | **None** — confirms the merged `applyTransfer` neutrality |
| OD-TRF-08/09 | **DONE 2026-10-07 (C-59C):** coupled source→destination replay implemented; the backdated-transfer refusal is lifted and the pair is valued together, atomically, inside the posting transaction |
| OD-RET-01…07 | C-59D: a Return document kind with an optional basis link, two costing routes, and a cold-start refusal |
| OD-REV-01…06 | **None** — confirms the merged reversal behaviour |
| OD-REV-07 | Blocked by OQ-27; correction documents stay out of scope |
| OD-RVP-01…08 | C-59E: a run-scoped Reverse Pricing command with latest-run-only, accounting-blocked, transfer-coupled fail-closed checks and a compensating run |
| OD-PDP-01…05 | C-59E: the scoped batch Pricing Operation with per-key/per-document outcome reporting |
| OD-PRC-11 (PDR-07) | C-59F: the accounting-eligibility gate that `accountingPostDocument` does not yet enforce |
