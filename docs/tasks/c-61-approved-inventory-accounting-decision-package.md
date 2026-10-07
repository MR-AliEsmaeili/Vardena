# C-61 — Approved Inventory → Accounting Decision Package

- **Type:** Product Owner decision recording, architecture reconciliation, and traceability — **documentation only**
- **Status:** **Owner decisions recorded; implementation not authorized**
- **Baseline inspected:** current `main` / `origin/main` at `129323ec662c153480cdd75c038bf9aa00c59250`
- **Date:** 2026-10-07 (UTC)
- **Authoritative records:** [PDR-09](../decisions/product/PDR-09-inventory-accounting-posting-boundary.md) and [ADR-0041](../adr/0041-synchronous-inventory-accounting-application-contract.md)
- **Open Questions:** OQ-24, OQ-25, OQ-39, OQ-42, OQ-69, OQ-70, OQ-71 and OQ-72 remain open.

> **C-61 does not implement Inventory → Accounting.** It changes no production code, Prisma schema, migration, API, permission, event consumer, posting rule, voucher, journal line, correction flow, or frontend. Production integration is a future, separately gated C-62 stage.

## 1. Traceability — C-59 → C-60 → C-61 → C-62

| Stage | Record and outcome |
|---|---|
| **C-59 — Inventory Valuation** | Complete. Inventory owns a hardened valuation foundation: Moving Weighted Average; Receipt, Issue, Transfer, Purchase Return, Sales Return and Reversal valuation; Periodic Pricing and Reverse Pricing; stale propagation; concurrency controls; idempotency; organization isolation; bounded recalculation; rollback; and pricing audit/run records. OD-VAL-17 requires physical negative stock to be rejected; C-61 separately records that legacy Item/Warehouse `allowNegativeStock` API overrides remain a policy-enforcement discrepancy. See the C-59 records and `STATE.md` §§20, 23–26. |
| **C-60 — Boundary Analysis** | Complete as a documentation/audit package. It verified current Inventory and Accounting state, identified gaps and open questions, and offered recommendations. Its PO-01…PO-12 entries were **recommendations for Owner review**, not approvals. See [C-60](./c-60-inventory-accounting-boundary-and-decision-package.md). |
| **C-61 — Approved Decision Package** | This package records the explicit Product Owner decisions PO-01…PO-12 in [PDR-09](../decisions/product/PDR-09-inventory-accounting-posting-boundary.md) and the selected internal integration architecture in [ADR-0041](../adr/0041-synchronous-inventory-accounting-application-contract.md). C-61 is documentation only. |
| **Future C-62 — Accounting Core Implementation** | Future implementation stage only. It may implement the approved contract after its remaining OQ gates are resolved. C-61 does not authorize or start C-62. |

C-60's former proposed C-61…C-66 implementation numbering is historical planning, not an Owner-approved roadmap. C-61 now names this approved decision package; C-62 is the future Accounting Core Implementation stage. The old epic breakdown must be re-baselined against the C-61 decisions and open OQs before work begins.

## 2. Decision register — category and status

The complete authoritative wording is in PDR-09 §1–§2. Every row below is an **Owner Decision**; PO-12 is an Owner-approved **Deferred** decision, while OQ-70 remains open for PO-11's variance case.

| ID | Classification | Approved outcome |
|---|---|---|
| PO-01 | Owner Decision | Inventory owns quantity, movement and valuation truth/history; Accounting owns accounts, mapping, journal construction, voucher policy and financial posting. |
| PO-02 | Owner Decision / architecture | Synchronous internal application-service integration through explicit public contracts in the Modular Monolith; no microservices; outbox/events are not the primary internal path. OQ-39 remains open for transaction and failure semantics. |
| PO-03 | Owner Decision | Only explicitly approved Business Documents may create Accounting Posting Operations. Raw movements/ledger operations, reservations, Material Requests, technical projections and arbitrary repository/service calls are excluded. |
| PO-04 | Owner Decision | `Inventory Business Document → Accounting Posting Operation → Voucher → Journal Lines`; one operation per Business Document, at most one Voucher from that operation, multiple lines per Voucher. Journal-line count is independent of movement count. Inventory supplies facts; Accounting chooses accounts and structure. |
| PO-05 | Owner Decision | Any relevant stale valuation key blocks Accounting eligibility, irrespective of document-level valuation state. Eligibility also requires operational state, complete valuation and future Accounting policy gates. |
| PO-06 | Owner Decision (narrow scope) | Same-Legal-Entity warehouse transfer creates no GL Voucher; source Issue value is authoritative and the destination Receipt receives exactly the same transfer value. No intercompany/different-entity, tax, financial-area or other transfer policy is inferred. |
| PO-07 | Owner Decision | Direct valuation edit/repricing after actual Accounting Post is forbidden; do not silently change Inventory valuation after posting. |
| PO-08 | Owner Decision; correction policy open | Inventory and Accounting correction/reversal lifecycles are independent but linked by auditable references. No correction policy or cascade is invented. |
| PO-09 | Owner Decision | Posting idempotency is operation key + request hash; same key/same request replays as the same logical operation, same key/different request conflicts (`409`). |
| PO-10 | Owner Decision | Accounting Eligibility and Accounting Posted are separate concepts; eligible does not mean posted, and a posted document is not eligible for ordinary direct posting. |
| PO-11 | Owner Decision; OQ-70 open for variance policy | Purchase Return at Inventory cost may post. If the agreed amount differs from Inventory cost, posting for the variance is blocked until OQ-70 is decided; no variance account is invented. |
| PO-12 | Owner Decision — Deferred | Sales Return Inventory processing may exist; Accounting posting waits for the Sales Accounting contract. No temporary Sales Accounting rules. |

### 2.1 C-60 recommendation disposition

| C-60 item | C-60 status | C-61 disposition |
|---|---|---|
| PO-01, PO-03, PO-05, PO-06, PO-07, PO-08, PO-10, PO-12 | Recommendation only in C-60 | Explicitly confirmed/refined by the corresponding Owner Decision in PDR-09. |
| PO-02 | Recommended transactional event subscription | **Not adopted.** Replaced by the synchronous public application-service contract (ADR-0041); OQ-39 remains open for transaction/atomicity and failure semantics. |
| PO-04 | Recommended one Voucher per document; line design left to later work | Refined: one Accounting Posting Operation per Business Document; it may create one Voucher; multiple Journal Lines are permitted and are not movement-count proxies. |
| PO-09 | Recommended I3 with detailed hash fields | The Owner approved operation key + request hash and same/same versus same/different semantics only. C-60's proposed key format/hash fields are not Owner-approved. |
| PO-11 | Recommended blocking all Purchase Return accounting until OQ-70/counterparty | **Superseded by a case split:** cost-based Purchase Return posting is allowed; only the agreed-price variance case is blocked pending OQ-70. |

C-60's other recommendations remain recommendations unless expressly adopted above. Their presence in C-60 is not authority to implement them.

## 3. OQ status — all remain open

| OQ | Status and exact remaining boundary |
|---|---|
| **OQ-24** | **Open.** Broader costing/Accounting policy remains unresolved (including COGS/offset content, landed cost, write-down/NRV and other unanswered policies). Valuation precision/currency remain open and cross-referenced to OQ-03/OQ-11 as appropriate. The Inventory return-costing conventions in PDR-08 are not reopened. |
| **OQ-25** | **Open.** Concrete control-role catalog/mandatory set and unresolved account/mapping content remain undecided. |
| **OQ-39** | **Open.** PO-02 fixes the integration style, not transaction ownership/atomicity, posting-refusal behavior, retry or durability/failure semantics. No production posting may assume those answers. |
| **OQ-42** | **Open.** Posting mode, approval/finalization authority and rejection behavior remain undecided. |
| **OQ-69** | **Open.** Conceptual valuation-history architecture is Ledger Authority + Immutable Valuation History; whether its sufficiency meets accountant/auditor needs is unresolved. |
| **OQ-70** | **Open, narrowed.** Only the Accounting policy/account mapping when the agreed Purchase Return amount differs from authoritative Inventory valuation/cost remains unresolved. Inventory-cost Purchase Return posting is allowed; the variance case is blocked. |
| **OQ-71** | **Open.** Inventory-side Reverse Pricing constraints are decided/implemented. Accounting-side reversal/correction behavior remains undecided. |
| **OQ-72** | **Open.** System-origin Accounting authority, worker/system actor semantics and the final authorization contract remain undecided. C-61 makes no choice. |

OQ-31 and other intercompany, tax, financial-area, dimension, closed-period, and Sales decisions also remain outside this package where not explicitly decided.

## 4. Repository discrepancies to carry into C-62

These are documentation/implementation gaps against the now-approved contract, recorded rather than fixed in C-61:

| Finding | Current repository evidence | Required future treatment |
|---|---|---|
| **Key-level stale eligibility** | `isAccountingEligible` currently checks operational status, document valuation state, and the document-level `valuationStale` flag; it does not inspect every relevant `inventory_valuation_states.status`. The C-60 audit identified this gap. | C-62 must make any relevant stale key a hard Accounting-eligibility block and evaluate future Accounting policy gates. No production code changed here. |
| **The current “Accounting Post” flag is not a GL post** | `InventoryBusinessDocumentsService.accountingPostDocument` checks eligibility and writes the Inventory document's `accounting_posted` status/timestamps. Its own comment states it creates no journal; it stores no Accounting Voucher/reference. | C-62 must establish the real Accounting Posting Operation/Voucher evidence without treating the existing flag alone as proof of a journal. |
| **Valuation can still change after the current flag** | The C-60 audit found that Periodic Pricing, direct recalculation, and late cost assignment lack an Accounting-posted guard; Reverse Pricing has a guard. | C-62/follow-up must enforce PO-07 across the valuation paths so direct valuation changes cannot silently alter facts already posted to Accounting. Correction/reversal accounting remains separately undecided. |
| **Old event-only architecture statements** | ADR-0005, AR-16 and several pre-C-61 architecture documents describe Inventory → Accounting as event-subscription-only. | ADR-0041 supersedes that mechanism for this internal posting path. The actual application-service integration is still unimplemented; this is not a claim of runtime conformance. |

> **Separate pre-existing Inventory policy discrepancy — not C-61/C-62 implementation scope.** OD-VAL-17 / PDR-05 rejects physical negative inventory for the MVP, but the current Item/Warehouse APIs still expose `allowNegativeStock` overrides that can permit it. Treat those legacy fields as an implementation mismatch, not an approved exception. C-61 records this for a separately scoped Inventory follow-up; no production code or Owner decision was changed here.

## 5. Benchmark context (rationale only)

C-61 reuses the official Sepidar System and Hamkaran System / SystemGroup (Rahkaran) sources already cited in [PDR-08](../decisions/product/PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md) §0.2: [Sepidar inventory pricing](https://www.sepidarsystem.com/blog/pricing-in-sepidar/), [Sepidar warehouse accounting](https://www.sepidarsystem.com/blog/warehouse-accounting/), and [Rahkaran warehousing](https://www.systemgroup.net/products/rahkaran/supply-chain/warehousing/).

The benchmark is behavioral context only: inventory and Accounting are distinct but tightly integrated; Inventory owns stock and valuation facts; Accounting owns financial mapping; pricing is an explicit Inventory operation; unpriced stock may remain operational but is not Accounting-ready; source-first transfer valuation passes the same value to the destination; warehouse/stock and Accounting concerns are not collapsed; and eligibility is distinct from actual posting. PO-06's no-GL rule is Vardena's approved same-Legal-Entity policy. No other ERP's internal technical architecture is copied: Vardena remains a Modular Monolith with vertical slices and explicit contracts.

## 6. Scope and verification record

- **Production implementation:** none authorized or performed by C-61. No production source, schema, migration, API, permission, event consumer, accounting rule, voucher, journal line, correction engine, or frontend change is in scope.
- **Local verification allowed:** Markdown/documentation checks if available, `git diff --check`, and status/diff inspection only. Heavy suites and integration verification are delegated to GitHub CI.
- **Implementation gate:** C-62 is future work. Before enabling system-generated posting, resolve the applicable OQ-24/OQ-25/OQ-39/OQ-42/OQ-72 gates and any source-specific policy. OQ-70 gates only the Purchase Return variance case; OQ-69 and OQ-71 gate their respective auditability and Accounting correction scopes.
