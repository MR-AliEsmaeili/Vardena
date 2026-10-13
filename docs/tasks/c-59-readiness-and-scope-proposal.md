# C-59 — Readiness assessment and scope proposal (PLANNING ONLY)

Status: **PLANNING ONLY — no C-59 implementation is authorized or started**
Date: 2026-10-06
Baseline: `main` @ `d0dc28691a646a1ea194a35cc233e04a58b7d459`

> This document exists so that when C-59 does start, nobody has to stop
> mid-implementation to decide Transfer, Return, Reversal, Pricing or the
> Accounting gate. It proposes slices; it authorizes none of them.

---

## 1. Decision inputs now in Git

| Record | Covers |
|---|---|
| [PDR-05](../decisions/product/PDR-05-inventory-valuation-and-cost-optional-operations.md) · OD-VAL-01…19 | Method, configuration scope, state granularity, cost-optional receipt, backdating, bounded recalculation, negative stock |
| [PDR-07](../decisions/product/PDR-07-inventory-pricing-sources-and-periodic-pricing-operation.md) · OD-PRC-01…12, OD-VH-01, OD-DOC-01/02 | Pricing sources, periodic Pricing Operation, unpriced ≠ operational block, Accounting eligibility gate, valuation state as its own axis, ledger authority + immutable valuation history |
| [PDR-08](../decisions/product/PDR-08-transfer-return-reversal-and-reverse-pricing-valuation.md) · OD-TRF / OD-RET / OD-REV / OD-RVP / OD-PDP | Transfer, Purchase Return, Sales Return, Reversal, Reverse Pricing, pricing dependencies |
| [OQ-54](../decisions/product/OQ-54-finalized-document-deletion-editing.md) / ADR-0040 (**Proposed**) | Edit boundary, side-effect transparency, negative-inventory hard invariant |
| [C-58](../decisions/product/C-58-inventory-business-documents.md) | Lifecycle, self-finalize, transaction boundaries, the three post-merge findings |

## 2. Readiness matrix

### 2.1 Document flows

| Flow | Decided? | Notes |
|---|---|---|
| Receipt | **READY** | Implemented and merged. Manual cost optional, single-line only (a known limitation, not an open question) |
| Issue | **READY** | Implemented and merged. No manual cost; value derived |
| Transfer | **READY** | OD-TRF-01…09. Non-backdated path implemented and matches the decision; backdated path is a named implementation gap (coupled two-key replay) |
| Return | **READY to build** | OD-RET-01…07. Not implemented at all; needs a Return document kind with an optional basis link |
| Reversal | **READY** | OD-REV-01…08. Implemented and matches the decision. Post-Accounting-Post correction is **not** ready — OQ-27 |

### 2.2 Valuation

| Concern | Decided? |
|---|---|
| Manual price | **READY** — OD-PRC-02 |
| Derived price | **READY** — OD-PRC-03; the transfer derivation is specified by OD-TRF-01 |
| Moving Weighted Average | **READY** — OD-VAL-02; implemented |
| Periodic Pricing Operation | **READY to build** — OD-PRC-05…07, OD-PDP-01…05. Only the one-key `recalculate` command exists today |
| Reverse Pricing | **READY to build** — OD-RVP-01…08. Not implemented |
| Unpriced / Partially Priced / Priced | **READY as a model** — OD-PRC-12. The merged schema has `valuationStale` plus per-movement `valuation_status`; composing those into the three document-level states is a C-59 design task, not a new decision |

### 2.3 Accounting

| Concern | Decided? |
|---|---|
| Accounting **eligibility** (may this document have an accounting document?) | **READY** — OD-PRC-11. **Not implemented**; `accountingPostDocument` does not check valuation completeness |
| Accounting **posting gate** (crossing the boundary) | **READY** — the lifecycle boundary exists; it must become conditional on eligibility |
| Post-pricing behaviour (reverse pricing vs an existing accounting document) | **READY on the Inventory side** — OD-RVP-03 fails closed and names the blockers |
| **Actual GL / COGS posting** | **BLOCKED** — OQ-39 / OQ-42 / OQ-24. No account mapping, no COGS convention, no posting mode |
| Purchase-return settlement variance account | **BLOCKED** — OQ-70 (Accounting side) |

### 2.4 Inventory foundations

| Concern | Status |
|---|---|
| Ledger authority | **READY** — ADR-0017 / ADR-0022, re-confirmed by OD-DOC-01/02 and OD-VH-01 |
| Balance projection | **READY** — ADR-0031, implemented |
| Kardex | **READY** — quantity Kardex implemented (C-54). A *valued* Kardex is a reporting question, not a blocker |
| Negative inventory | **READY** — hard block, OD-VAL-17 / ADR-0040 §4; C-58 reuses the same gate with no bypass |

### 2.5 Organization / security

| Concern | Status |
|---|---|
| Organization isolation | **READY** — verified across every C-58 read and command (404, never 403) |
| Permissions | **READY** — document ≠ movement ≠ transfer ≠ valuation authority. Reverse Pricing needs its own code (OD-RVP-08) |
| Licensing | **READY** — existing mechanism, unchanged |

## 3. Verdict

```
READY FOR C-59  —  for slices C-59A … C-59E
BLOCKED         —  for GL/COGS posting only (not part of the proposed C-59 scope)
```

Nothing in Transfer, Return, Reversal, Pricing or the Accounting **eligibility
gate** is unresolved. The only blocked item is the *actual journal posting* of
inventory value into Accounting, which is owned by OQ-39 / OQ-42 / OQ-24 and is
deliberately **excluded** from the C-59 scope below.

## 4. Proposed slices

The work-order's A–F split survives review, with one correction: **C-59F must
be the accounting *eligibility gate*, not accounting posting** — posting is
blocked and must not be smuggled into the slice.

| Slice | Scope | Depends on | Notes |
|---|---|---|---|
| **C-59A** | Receipt operational flow — hardening only | — | Mostly done by C-58. Remaining: multi-line receipt cost apportionment (needs an approved rounding rule — currently refused, correctly), and the separate `backdateConfirmed` on edit (C-58 finding #3) |
| **C-59B** | Issue operational flow — hardening only | — | Mostly done by C-58 |
| **C-59C** | Transfer operational flow | OD-TRF-01…09 | Coupled source→destination valuation replay; only then lift `inventory.backdated_transfer_valuation_unresolved` |
| **C-59D** | Return operational flow | OD-RET-01…07 | New document kind + basis link + two costing routes + cold-start refusal. **Excludes** the variance account (OQ-70) |
| **C-59E** | Pricing Operation + Reverse Pricing | OD-PRC-05…08, OD-PDP-01…05, OD-RVP-01…08 | The scoped batch run with per-key/per-document outcome reporting, and the run-scoped reversal with its four fail-closed guards |
| **C-59F** | Accounting **eligibility** integration | OD-PRC-11, OD-PRC-12 | The gate on `accountingPostDocument` + the document-level `Unpriced`/`Partially Priced`/`Priced` state + the eligibility event. **No GL posting** |

### 4.1 Suggested refinement to the work-order split

Two observations from the repository's actual architecture:

1. **C-59A and C-59B are not greenfield slices.** C-58 already shipped them.
   Re-opening them as full slices would invite redesign; they should be
   narrow hardening tickets instead.
2. **A C-59E′ is worth separating.** The *document-level valuation state*
   (OD-PRC-12) is consumed by C-59F but produced by the valuation domain. If
   C-59E and C-59F are built in parallel, that state should be its own small
   slice ahead of both. Sequentially (E → F) it can stay inside C-59E.

**Recommended order:** C-59F-prep (valuation state model) → C-59E → C-59F →
C-59C → C-59D, with C-59A/C-59B as hardening tickets scheduled independently.
This front-loads the Pricing Operation, which every other slice's accounting
eligibility depends on.

## 5. Explicitly out of C-59 scope

GL / COGS posting · Sales · Purchasing · the Factor domain · FIFO / LIFO ·
lot/serial runtime valuation · multi-currency · landed cost · revaluation /
NRV / ageing · money-precision migration (OQ-03 / OQ-11) · any correction
document after Accounting Post (OQ-27).

## 6. Remaining OPEN decisions that C-59 must NOT invent

| Question | Owner | Effect if ignored |
|---|---|---|
| **OQ-24** — COGS posting, landed cost, valuation precision/currency | Accountant | Would hard-code an accounting convention |
| **OQ-39 / OQ-42** — system-generated posting durability and mode | Architecture + accountant | Would hard-code a posting mode |
| **OQ-27** — accounting correction windows | Accountant | Would invent the post-Accounting-Post correction document |
| **OQ-69** — per-movement valuation history sufficiency | Accountant + auditor | Additive later; does not block C-59 |
| **OQ-70** (variance account) / **OQ-71** (accounting-side reversal flow) | Accountant | Would invent an account mapping |
| **OQ-03 / OQ-11** — money precision and currency | Product / Finance | Would trigger an unapproved destructive migration |
| **OQ-13 / OQ-26** — approval coupling | Product | Would add an approval framework C-58 explicitly excluded |
