# PDR-09: Inventory → Accounting posting boundary and Owner decisions

- **Type:** Product Decision Record · Owner decision ids **PO-01…PO-12**
- **Status:** **Decided** — explicitly approved by the Product Owner and recorded in C-61 on 2026-10-07
- **Decision authority:** This record and [ADR-0041](../../adr/0041-synchronous-inventory-accounting-application-contract.md) are authoritative for the decisions listed below. No other C-60 recommendation is promoted by implication.
- **Companion package:** [C-61 Approved Inventory → Accounting Decision Package](../../tasks/c-61-approved-inventory-accounting-decision-package.md)
- **Related records:** C-60 boundary analysis; [PDR-05](./PDR-05-inventory-valuation-and-cost-optional-operations.md), [PDR-07](./PDR-07-inventory-pricing-sources-and-periodic-pricing-operation.md), [PDR-08](./PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md); ADR-0017/0022; OQ-24/25/39/42/69/70/71/72

> **Documentation only.** This PDR defines the approved business and architectural boundary. It creates no Accounting posting engine, voucher, journal line, mapping, permission, API, migration, or correction flow. The implementation gate and known code/documentation discrepancies are recorded in C-61 §4.

## 1. Owner decision register

`Owner Decision` means the Product Owner explicitly approved the rule. `Deferred` identifies an approved deferral, not an unanswered recommendation. Open Questions listed in §4 remain open even where a related decision is now fixed.

| ID | Status classification | Approved decision |
|---|---|---|
| **PO-01** | Owner Decision | Inventory owns quantity, movement, inventory valuation, valuation state, and inventory valuation history. Accounting owns account mapping, journal construction, voucher policy, and financial posting. Accounting must not duplicate Inventory valuation logic. |
| **PO-02** | Owner Decision — architecture; see ADR-0041 | Inventory → Accounting uses synchronous internal application-service integration in the Modular Monolith through explicit public application/domain contracts. No microservices. Outbox/event-driven integration may serve external integrations later; it is not the primary internal mechanism. |
| **PO-03** | Owner Decision | Only explicitly approved Inventory Business Documents may create Accounting Posting Operations. Raw movements, raw ledger operations, reservations, Material Requests, technical projections, and arbitrary repository/service calls are not direct Accounting sources. |
| **PO-04** | Owner Decision | Conceptual chain: `Inventory Business Document → Accounting Posting Operation → Voucher → Journal Lines`. One posting operation belongs to one Business Document; it may create one Voucher; a Voucher may have multiple Journal Lines. Journal-line count is not movement count. Inventory supplies valuation facts; Accounting chooses accounts and journal structure. |
| **PO-05** | Owner Decision | A document is not Accounting-eligible when any relevant valuation key is `stale`, even if document-level valuation state alone appears complete. Eligibility also requires the operational and valuation preconditions and all applicable Accounting policy gates. |
| **PO-06** | Owner Decision — limited to same Legal Entity | A warehouse transfer between warehouses of the same Legal Entity creates **no GL Voucher**. Inventory still values the source Issue first; its value is authoritative; the destination Receipt receives exactly that value. No extension to intercompany/different-entity, tax, financial-area, or other transfer cases. |
| **PO-07** | Owner Decision | After an actual Accounting Post, direct valuation edit or repricing is forbidden. The system must not silently change inventory valuation after Accounting has posted the document. |
| **PO-08** | Owner Decision — correction policy remains open | Inventory and Accounting correction/reversal lifecycles are independent but linked. Preserve auditable references among the Inventory document, valuation, Accounting Posting Operation, Voucher, and any correction/reversal operation. This does not choose a correction policy or cascade. |
| **PO-09** | Owner Decision | Posting idempotency uses **operation key + request hash**. Same key and same request is idempotent success for the same logical operation; same key and a different request is a conflict (`409` semantics). Retries must not create duplicate vouchers. Exact key format, hash algorithm, and canonical request fields are not decided here. |
| **PO-10** | Owner Decision | Accounting Eligibility and Accounting Posted are separate facts: `accountingEligible !== accountingPosted`. Eligibility answers whether the document may be posted now; Posted answers whether it actually was posted. A document may be eligible but not posted, ineligible and not posted, or posted and no longer eligible for ordinary direct posting. |
| **PO-11** | Owner Decision — OQ-70 remains open for variance policy | Purchase Return at the authoritative Inventory valuation/cost may be posted to Accounting. If the agreed return amount differs from Inventory cost, Accounting Post for the variance is **blocked until OQ-70 is decided**. Do not invent or select a variance account; do not absorb the difference into Inventory valuation. |
| **PO-12** | Owner Decision — **Deferred** | Sales Return Inventory processing/valuation may stand independently. Accounting posting is deferred until the Sales Accounting contract exists. No temporary Sales Accounting rule is authorized. |

## 2. Normative boundary

### 2.1 Value ownership and source eligibility

Inventory is the sole source of truth for inventory quantity and valuation facts. Accounting consumes those facts through the approved public contract; it does not recompute or maintain a competing inventory valuation. Accounting is the authority for financial mapping and journal/voucher policy.

The Accounting source must be an explicitly approved **Inventory Business Document**, not an arbitrary data write. PO-03 does not create an exhaustive source-type catalog: each type must be explicitly approved in the future contract. PO-06 specifies that a same-Legal-Entity warehouse transfer creates no GL Voucher; PO-11 permits a Purchase Return at authoritative Inventory cost subject to other applicable gates; PO-12 defers Sales Return Accounting. Do not infer source approval from a movement, event, repository/service call, or technical projection.

### 2.2 Posting operation and eligibility lifecycle

The posting chain in PO-04 is conceptual and does not declare a database schema or implementation. It preserves one operation per Business Document and the distinction between document facts and journal composition. It does not prescribe a fixed number of lines per movement or document line.

The current/future Accounting Eligibility decision must include all of the following:

1. the source Business Document is in an operational state eligible for Accounting;
2. the document's relevant valuation facts are complete/priced;
3. **every relevant valuation key is not stale**;
4. all applicable Accounting policy gates permit posting; and
5. the document has not already been posted for ordinary direct posting.

The exact future Accounting policy gates (for example, mapping, posting mode, authorization, financial area, or period policy) remain subject to their OQs. Eligibility is permission to attempt the Accounting operation, not evidence that an operation or Voucher exists. Conversely, a posted document is not eligible for a second ordinary direct post; any correction/reversal is a separate operation.

`Accounting Posted` means a real Accounting posting outcome and its traceable operation/Voucher, not merely an Inventory status flag. The current repository status flag is not that evidence; see C-61 §4.

### 2.3 Same-Legal-Entity transfer

PO-06 applies only when both warehouses belong to the same Legal Entity. Inventory's existing transfer valuation contract remains authoritative: value the source Issue first, use its transfer value as authoritative, and assign exactly the same value to the destination Receipt. The transfer is internally value-neutral and creates no GL Voucher under this decision. Intercompany, different Legal Entity, tax, financial-area, and future transfer types require separate decisions; none is inferred here.

### 2.4 After Accounting Post and correction linkage

A direct valuation edit/repricing that would change valuation after Accounting Post is forbidden. This is not permission to post a compensating journal, reverse a Voucher, re-open a document, or select a correction route. Those are separate decisions. Inventory and Accounting correction/reversal can proceed independently, but each related operation must retain references and auditability across the Inventory document, valuation facts/history, Accounting Posting Operation, Voucher, and correction/reversal operation. No cascade or correction policy is specified by this PDR.

### 2.5 Purchase Return and Sales Return

- **Purchase Return at Inventory cost:** Accounting Post is allowed when its accounting amount is based exactly on authoritative Inventory valuation/cost. Inventory supplies that valuation fact; Accounting applies its approved financial mapping/policy. This is not an unconditional guarantee that every other Accounting gate is satisfied.
- **Purchase Return with agreed-price variance:** when the agreed return amount differs from authoritative Inventory cost, Accounting Post **for the variance is blocked** until OQ-70 is decided. The block is not a blanket ban on Purchase Returns at Inventory cost. No variance account, automatic account choice, or Inventory-cost adjustment is approved.
- **Sales Return:** Inventory processing and valuation are independent; Accounting posting is deferred until a Sales Accounting contract exists. No Sales Accounting rule is inferred.

## 3. C-60 recommendation status

C-60 §21 recorded proposals for Product Owner review; a recommendation in that package was not an Owner Decision. C-61 confirms or refines only the decisions in §1. In particular, PO-02 selects a public synchronous application-service contract rather than C-60's proposed event-subscription mechanism, and PO-11 replaces C-60's blanket Purchase Return block with the cost/variance distinction in §2.5. Unlisted C-60 recommendations remain recommendations or open questions.

## 4. Open Questions — remain open

| OQ | Open boundary after C-61 |
|---|---|
| **OQ-24** | Remains open for broader Inventory/Accounting costing and posting policy, including COGS/offset content, landed cost, write-down/NRV and other unanswered policies. Valuation precision/currency remain open and cross-referenced to OQ-03/OQ-11 as appropriate. It does not reopen the decided Inventory return-costing conventions. |
| **OQ-25** | Remains open for the concrete control-role catalog/mandatory set and unresolved chart/mapping content. |
| **OQ-39** | Remains open for the transaction/atomicity boundary, posting-refusal and source-document behavior, and retry/durability/failure semantics. PO-02 decides the primary internal integration style only; it does not decide these semantics. No outbox/event subscription is the primary internal Inventory → Accounting mechanism. |
| **OQ-42** | Remains open for system-posting mode, approval/finalization authority, and rejection behavior. |
| **OQ-69** | Remains open for whether the conceptual **Ledger Authority + Immutable Valuation History** architecture is sufficient for accountant/auditor requirements. |
| **OQ-70** | Remains open only for the Accounting policy/account mapping when the agreed Purchase Return amount differs from authoritative Inventory valuation/cost. Cost-based Purchase Return posting is allowed; the variance case is blocked pending this answer. |
| **OQ-71** | Remains open for Accounting-side reversal/correction behavior. Inventory-side Reverse Pricing constraints remain decided/implemented; C-61 adds no Accounting reversal policy. |
| **OQ-72** | Remains open for system-origin posting authority, required Accounting authority, worker/system actor semantics, and the final authorization contract. C-61 decides none of these. |

OQ-31 and all other multi-entity, tax, financial-area, dimension, and Sales rules remain outside the decisions in this PDR unless explicitly named above.

## 5. Benchmark context (rationale only)

The business behavior was cross-checked against Iranian ERP conventions already documented in PDR-08, particularly Sepidar System and Hamkaran System / SystemGroup's Rahkaran materials:

| Official source already referenced in PDR-08 | Context used |
|---|---|
| [Sepidar System — inventory pricing](https://www.sepidarsystem.com/blog/pricing-in-sepidar/) and [warehouse accounting](https://www.sepidarsystem.com/blog/warehouse-accounting/) | Pricing is an explicit Inventory operation; source-side transfer issue is priced first and the destination receives the same value; unpriced stock may remain operational without becoming accounting-ready. |
| [Hamkaran System / SystemGroup — Rahkaran warehousing](https://www.systemgroup.net/products/rahkaran/supply-chain/warehousing/) | Supports the broader context that warehousing and Accounting are distinct but connected concerns; capability information is not treated as proof of every detailed accounting rule. |

The benchmark is rationale, not Vardena's technical blueprint. Vardena's Modular Monolith, vertical slices, explicit module contracts, and no-cross-module-table-access rules remain authoritative. Same-Legal-Entity transfer without a GL Voucher is the approved **Vardena** policy in PO-06, not a claim that a vendor's internal architecture is being copied.

## 6. Implementation boundary

This PDR is documentation only. It authorizes no posting engine, account mappings, permissions, correction/reversal accounting, variance account, Sales Accounting, intercompany accounting, tax, financial dimensions, period behavior, system-origin authority, endpoint, schema, migration, frontend, or production-code change. The separately gated future implementation stage is C-62; its scope must honor the open OQs in §4 and the discrepancies recorded in C-61 §4.
