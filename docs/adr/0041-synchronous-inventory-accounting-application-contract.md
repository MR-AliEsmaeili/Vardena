# ADR-0041: Synchronous Inventory → Accounting application contract

Status: Accepted — Product Owner decision PO-02, 2026-10-07
Date: 2026-10-07
Supersedes: ADR-0005 for the primary internal Inventory → Accounting posting mechanism only

## Context

C-60 analyzed the Inventory → Accounting boundary and recommended a transactional domain-event subscription. The Product Owner instead approved synchronous internal application-service integration in Vardena's Modular Monolith, with explicit public application/domain contracts. The existing event/outbox architecture remains relevant for other event consumers and external integrations, but must not be assumed to be the internal posting path.

## Decision

1. The primary internal Inventory → Accounting mechanism is a **synchronous in-process application-service call** through explicit public application/domain contracts.
2. Inventory supplies authoritative movement and valuation facts; Accounting owns account mapping, journal construction, voucher policy and posting. Neither module reads or writes the other's tables directly.
3. This is a Modular Monolith integration. Do not introduce microservices.
4. The outbox/event-driven path may serve external integrations later; it is not the primary internal Inventory → Accounting mechanism.
5. This ADR does **not** decide whether the cross-module operation is one atomic database transaction, how posting refusals affect the Inventory operation, or the complete retry/durability/failure contract. Those remain open under **OQ-39**; no production posting may be enabled by implication.

## Consequences

- ADR-0005's event-subscription mechanism is superseded for this posting path; domain events may still serve independent notifications/audit or other explicitly contracted uses.
- The implementation must call a public Accounting contract and preserve the module boundary; no event consumer or outbox row is a substitute for that call.
- The application-service seam, transaction ownership, refusal semantics, idempotency implementation and correction behavior remain unimplemented and separately gated by C-61's open questions.
- This ADR records architecture only; it implements no code, schema, migration, API, permission, posting rule, voucher or journal line.

## C-62 Owner-approved refinement (2026-10-08; no implementation)

[PDR-10](../decisions/product/PDR-10-c62-inventory-accounting-posting-modes.md) records C62-OD-01…06. Synchronous application-service integration remains the primary path. Atomic commit is the Owner's **feasibility-gated preference**, not a conclusion of this ADR: existing Inventory and Accounting services each own independent Prisma transactions, so current exported methods cannot simply be nested into one atomic post. A clean shared-transaction contract must pass technical review; if it cannot, the Owner-approved durable pending/two-phase fallback applies. Warehouse-configured direct-final and Accounting-owned draft modes both exist as product requirements; creating a draft is not Accounting Posted. This refinement does not close OQ-39, OQ-42 or OQ-72 or authorize production code.
