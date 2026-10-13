# ADR-0001: Modular Monolith (Not Microservices)

Status: Accepted
Date: 2026-09-10

> **Scoped clarification (2026-10-07).** ADR-0041 / PO-02 supersedes this ADR's
> event-only side-effect mechanism for internal Inventory → Accounting posting
> only. That path uses a synchronous public application/domain contract; independent
> reactions may still use domain events. OQ-39 leaves its transaction/failure
> semantics open.

## Context

Vardena is an ERP for on-premise deployments by default. Microservices would
impose an operations burden (service discovery, distributed transactions,
deployment orchestration) that small on-premise sites cannot absorb, while the
product is not yet large enough to need horizontal team/service scaling. Yet the
product must be extensible and must allow modules to be extracted later if it
grows.

## Decision

Build Vardena as a **modular monolith**: one NestJS application, one database,
with **hard module boundaries** enforced by rules (AR-02…AR-08):

- each module owns its tables (one DB schema per module — ADR-0008);
- no cross-module table/Prisma access; cross-module operations use an explicitly
  approved public contract where selected, while independent reactions may use
  domain events; reads use public services or module-owned views;
- a technical-only `kernel/` (no shared business layer);
- controllers are transport-only; use cases live in application services.

Extraction path: because contracts already flow through events/public APIs and
no module shares tables or in-memory state with another, a module can later be
extracted to its own service by swapping in-process dispatch for a broker and
public-service reads for an API — without rewriting neighbors.

## Consequences

- Easier to deploy/operate on-premise; one upgrade unit (good for the OQ-17
  upgrade-process decision).
- Discipline is the cost: boundary violations must be caught in review (and
  later, optionally, by CI checks); a "shared business service" smell is banned
  (AR-06).
- Event-consumer consistency follows each event's governing contract. The former
  ADR-0005 event-based Inventory → Accounting atomicity is superseded for that path
  by ADR-0041; its transaction and failure semantics remain open under OQ-39. Future
  async dispatch for independent/external event use is a kernel-level concern, not
  a reason to replace the approved internal Inventory posting contract.
