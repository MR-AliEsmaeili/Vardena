# PDR-07: Inventory pricing sources, the periodic Pricing Operation, and the Accounting eligibility gate

- **Type:** PDR (Product Decision Record) · decision ids **OD-PRC-01 … OD-PRC-12**
- **Status:** **Decided** — Owner decisions recorded 2026-10-06, transcribed from the "Git Truth Baseline + PR #122 Verification + Transfer/Return/Reversal Decision Sprint" work order
- **Decided by:** Repository Owner (Ali Esmaeili), explicit decision text recorded in the work order
- **Owner of the remaining questions:** Accountant + inventory expert (OQ-24 stays **OPEN**)
- **Registry rows:** [`docs/open-questions.md`](../../open-questions.md) — **OQ-24** (partially resolved, stays OPEN), **OQ-67**, **OQ-68**, **OQ-69**, and the new **OQ-70** / **OQ-71** opened by this pass
- **Recording baseline:** `main` @ `d0dc28691a646a1ea194a35cc233e04a58b7d459` (merge of PR #122 — verified against GitHub on 2026-10-06, see §7)
- **Related records:** [PDR-05](./PDR-05-inventory-valuation-and-cost-optional-operations.md) (OD-VAL-01…19 — this record extends it, replaces nothing) · [OQ-54](./OQ-54-finalized-document-deletion-editing.md) / ADR-0040 (**Proposed**) · ADR-0039 (**Proposed**) · ADR-0022 / ADR-0017 (ledger authority) · [C-58](./C-58-inventory-business-documents.md)
- **Superseding note:** the OPEN placeholders this record creates for Transfer and Return pricing (OD-PRC-05 / OD-PRC-06) were resolved later the same day by [PDR-08](./PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md).

> **What this record is and is not.** It transcribes the Owner's *business*
> decisions on where a document's price comes from, what a Pricing Operation
> is, and when Accounting may consume a valuation. It **accepts no
> implementation**, **promotes no ADR** (ADR-0039 and ADR-0040 both stay
> **Proposed**), **closes no Open Question**, and **authorizes no C-59
> implementation**. MERGED ≠ ACCEPTED (STATE.md §6).

---

## 1. Context

PDR-05 decided the valuation *method* (Moving Weighted Average), its
*configuration scope*, its *state granularity*, the *cost-optional receipt*
and the *backdating/recalculation* policy. What it did **not** state is the
model one level up: a document's monetary value may legitimately arrive by
more than one route, and only one of those routes is the Pricing Operation.

Implementation work (C-56 … C-58) has since proceeded with an implicit
assumption that "valuation" and "the repricing command" are the same thing.
They are not, and conflating them produces two concrete design errors that
this record forbids in advance:

1. treating the Pricing Operation as the *only* legitimate source of a
   document's price (which makes a manually priced purchase receipt
   unrepresentable); and
2. treating an unpriced document as an *operational* blocker (which stops the
   warehouse because the accountant is late).

## 2. Problem

Three questions had to be answered before C-59 can be scoped:

- **P1.** Where may a document's monetary value come from, and is the Pricing
  Operation mandatory?
- **P2.** Is pricing real-time (per posting) or periodic (per operator-run
  batch)? And what does the system do between the posting and the pricing?
- **P3.** What exactly does an unpriced document block — nothing, the next
  inventory operation, or only the accounting document?

## 3. Decision register (OD-PRC-01 … OD-PRC-12)

### 3.1 Pricing source

| id | Decision | Why it is not inferable from the code |
|---|---|---|
| **OD-PRC-01** | **An inventory document may receive its value from any of three sources: Manual Price, Derived Price, or the Inventory Pricing Operation.** These are peers. The Pricing Operation is **one** valuation mechanism, not *the* valuation mechanism. | The implemented code has exactly one explicit cost entry point and one recalculation command; nothing in it says whether a third, derived route is legitimate or a bug. |
| **OD-PRC-02** | **A Manual Price is valid wherever the document type allows it**, and a document type that allows it needs no Pricing Operation at all. A purchase receipt that arrives with its price already known is complete on creation. | The alternative — "every document must pass through pricing" — is a defensible ERP posture and must be ruled out explicitly, not by omission. |
| **OD-PRC-03** | **A Derived Price is valid wherever a domain rule defines the derivation** (for example: a transfer's destination leg deriving from its source leg). A derivation is a *decided rule*, never an implementation convenience. | Derivation rules are domain decisions; allowing the mechanism without requiring a decision per rule is how silent conventions get born. |
| **OD-PRC-04** | **The Pricing Operation never overwrites a value that a decided source already supplied.** It computes values for documents whose decided source is the Pricing Operation, and it leaves manually priced and validly derived values alone. | Prevents a batch command from quietly destroying operator-entered data. |

### 3.2 Pricing is periodic; quantity is real-time

| id | Decision | Why it is not inferable from the code |
|---|---|---|
| **OD-PRC-05** | **Quantity is real-time; value is periodic.** A movement's quantity effect is final at posting. A Pricing Operation is a **user-initiated, scope-bounded, reportable batch** — never an implicit background effect of posting. | Perpetual *quantity* and periodic *valuation* coexisting is a specific product shape; "perpetual" in OD-VAL-01 does not by itself say the repricing is operator-driven. |
| **OD-PRC-06** | **A Pricing Operation is scoped by the operator**, at minimum over: From Date, To Date, one warehouse or all warehouses, and one or several document types. | The scope dimensions are a UX/product contract that the one-key `recalculate` command does not express. |
| **OD-PRC-07** | **A Pricing Operation must report its outcome**: success count, failure count, the failed documents/lines, and a named reason per failure. A run that "mostly worked" must say exactly what did not. | Reporting shape is a product requirement, not a logging detail. |
| **OD-PRC-08** | **Reverse Pricing is required.** A completed Pricing Operation must be reversible, under constraints that are themselves a Domain decision and must not enter implementation undecided. | Without this stated up front, pricing becomes a one-way door. |

### 3.3 Unpriced documents and the Accounting gate

| id | Decision | Why it is not inferable from the code |
|---|---|---|
| **OD-PRC-09** | **An unpriced inventory document is operationally valid.** It may be created, finalized, and may remain in the flow of quantity operations indefinitely. | Restates OD-VAL-05 at the *document* level, where C-58 operates. |
| **OD-PRC-10** | **Unpriced status must NEVER be used as a general block on subsequent inventory operations.** The model `Unpriced Receipt → block all future issues` is explicitly **rejected**. The warehouse does not stop because the accountant is late. | This is the load-bearing prohibition of this record. It is the single most tempting shortcut in a valuation implementation and it is forbidden. |
| **OD-PRC-11** | **The gate is Accounting, not Inventory Operations.** An inventory document **without a valid monetary value may not create or post its corresponding accounting document.** Accounting eligibility is a function of valuation completeness. | Puts the refusal at the one boundary where it is correct, and names Accounting — not Inventory — as the owner of the refusal. |
| **OD-PRC-12** | **Valuation state is a concern SEPARATE from document lifecycle state.** The C-58 lifecycle (`Draft → Operational → Accounting Posted → Immutable`) and the valuation state (`Unpriced` / `Partially Priced` / `Priced`) are two independent axes and must never be collapsed into one enum. | Collapsing them is the natural implementation shortcut and would make "operational but unpriced" — the whole point of OD-VAL-05 — unrepresentable. |

### 3.4 Valuation history

| id | Decision | Why it is not inferable from the code |
|---|---|---|
| **OD-VH-01** | **Option C — Ledger Authority + Immutable Valuation History.** The Inventory Ledger stays the single authority for the real quantitative and monetary effect of stock. In addition, valuation history is retained immutably for audit. Neither replaces the other, and the history is **never** a second ledger that anything reads for current truth. | OQ-69 asked whether the current run record suffices; this answers the *architecture* (both, with authority clearly assigned) while OQ-69's *sufficiency* question stays open. |

### 3.5 The two rules that follow for the Document layer

| id | Decision |
|---|---|
| **OD-DOC-01** | **The Business Document Layer must not create a second ledger.** It is an orchestration layer over the existing Inventory movement/balance/valuation infrastructure (ADR-0017 / ADR-0022 / ADR-0039). |
| **OD-DOC-02** | **A document never computes stock arithmetic itself.** Every quantitative and monetary effect is produced by the ledger infrastructure, inside the caller-owned transaction. |

## 4. Topics deliberately recorded as OPEN by this pass

Per the Owner's instruction, the following were **not** decided here and were
carried into the Decision Sprint rather than guessed:

| Topic | Status at the time of this record |
|---|---|
| **Transfer pricing** — which side determines value, and what the destination leg receives | **OPEN** (OQ-67) — resolved by [PDR-08](./PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md) §2 |
| **Return pricing** — purchase return and sales return costing | **OPEN** (new **OQ-70**) — resolved by [PDR-08](./PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md) §3 |
| **Reversal valuation** — original movement value vs current average | **OPEN** (OQ-68); the initial direction is *original movement valuation*, with the detail to be settled in the Sprint — resolved by [PDR-08](./PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md) §4 |
| **Reverse Pricing constraints** — what may be reversed, and what happens to a created accounting document | **OPEN** (new **OQ-71**) — resolved by [PDR-08](./PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md) §5 |

## 5. Confirmed-unchanged decisions (restated, not re-decided)

The following stand exactly as recorded and were re-confirmed rather than
revisited: V1 = Moving Weighted Average only (OD-VAL-02/18); FIFO, LIFO,
lot/serial runtime valuation and multi-currency are **not** implemented in V1
but must not be architecturally foreclosed; negative physical inventory stays
a **hard block** (OD-VAL-17 / ADR-0040 §4); backdating requires two
independent explicit confirmations with no default (OD-VAL-10/11).

## 6. Precision — factual correction against the work order

The work order states the current precision decision as *"fixed 4 decimals,
unrepresentable values rejected, no hidden rounding."* Against the repository
this is **half right, and the half that is wrong matters**:

| Dimension | Repository truth (`main` @ `d0dc286`) | Matches the work order? |
|---|---|---|
| **Quantity** | `numeric(18,4)` — fixed 4 decimals, exact-or-reject, no hidden rounding (PDR-01 / OD-C47-01) | **Yes** |
| **Unit conversion factor** | `numeric(18,6)` | Not addressed by the work order |
| **Money / valuation** | `numeric(18,2)` — exact-or-reject at the entry boundary, rounding only where the method divides, residual retained so `SUM(movement value) == state value` cannot drift (OD-VAL-16) | **No — money is 2 decimals, not 4** |

**Decision: no precision change is made by this record.** The "fixed 4
decimals" rule is confirmed for **quantities**. Money precision stays
`numeric(18,2)` and remains owned by **OQ-03 / OQ-11**, which are OPEN.
Changing money scale is a destructive migration across Inventory *and*
Accounting and must not be done as a side effect of a documentation pass. The
exact-or-reject and no-hidden-rounding principles apply to **both** and are
unchanged.

## 7. Git-truth verification performed before recording

| Check | Result |
|---|---|
| `main` head | `d0dc28691a646a1ea194a35cc233e04a58b7d459` |
| PR #122 state | **MERGED** 2026-10-06T09:49:21Z by `MR-AliEsmaeili`; head SHA `39d06f768cb4d5aa41b742cb44d3cdfce6c5ca3f`; merge commit **is** the current `main` head |
| PR #122 CI on its head SHA | `backend` **SUCCESS**, `frontend` **SUCCESS** (run `37444676807`) |
| PR #122 human review | **None.** `reviewDecision` empty, zero reviews, zero review comments; the only PR comment is an automated notice that the Codex reviewer hit its usage limit — i.e. **PR #122 was merged without any completed code review** |
| Duplicate decision files | None — this is the first record of OD-PRC-xx; PDR-05 is extended by reference, not rewritten |

## 8. Consequences

- C-59 may be scoped against a stated pricing model instead of discovering it
  mid-implementation.
- `accountingPostDocument` in the merged C-58 runtime does **not** yet enforce
  OD-PRC-11 — it records the boundary without checking valuation completeness.
  That is now a named **implementation gap** against a decided rule, assigned
  to the C-59F slice; it is **not** a new open question.
- A valuation-state axis (`Unpriced` / `Partially Priced` / `Priced`) distinct
  from the lifecycle enum is now required by OD-PRC-12. The merged schema
  carries `valuationStale` plus per-movement `valuation_status`; whether that
  composes into the three decided document-level states is a C-59 design task.

## 9. Rejected alternatives

| Rejected | Why |
|---|---|
| **Pricing Operation as the only source of value** | Makes a manually priced purchase receipt unrepresentable and contradicts OD-VAL-05/06. |
| **Unpriced receipt blocks subsequent issues** | Explicitly rejected by the Owner: it lets an accounting backlog halt the warehouse. The correct refusal point is the accounting document (OD-PRC-11). |
| **One enum for lifecycle + valuation** | Would make "operational but unpriced" unrepresentable (OD-PRC-12). |
| **Silently defaulting the repricing choice** | Already rejected by OD-VAL-11; re-confirmed. |
| **Changing money precision to 4 decimals in this pass** | A cross-module destructive migration; owned by OQ-03/OQ-11 (§6). |
