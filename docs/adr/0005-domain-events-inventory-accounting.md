# ADR-0005: Domain Events for Inventory → Accounting

Status: Superseded by ADR-0041 for the primary internal Inventory → Accounting posting mechanism
Date: 2026-09-10

> **Supersession note (2026-10-07).** ADR-0041 supersedes only this ADR's
> event-subscription mechanism for internal Inventory → Accounting posting.
> The accepted historical decision remains recorded below; independent domain
> events and other consumers are not generally withdrawn.

## Context

Inventory transactions eventually generate accounting effects (e.g. purchase →
inventory receipt → journal entry). Inventory must not couple to Accounting
internals (mapping tables, posting rules), and Accounting must not scrape
Inventory tables. At the same time, the books must stay consistent: a receipt
without its journal entry is a silent accounting bug, and a journal entry for a
rolled-back receipt is a silent corruption.

## Decision

**Domain events, dispatched synchronously in-process within the publisher's
unit of work in v1, persisted to `core.domain_events` in the same transaction.**

- Inventory publishes events (`InventoryReceipt.Created`,
  `InventoryIssue.Created`, `StockAdjustment.Created`, …) via the kernel event
  bus inside its application service's transaction.
- Accounting **subscribes** and owns the mapping from event → journal-entry
  template (mapping rules live in the Accounting module — its bounded context).
  The accounting effect commits or rolls back **with** the inventory write
  (atomic; a posting failure fails the receipt — safe for the books).
- Every consumer is **idempotent**, deduplicating on the event id (AR-15); the
  event id is also the key Accounting uses to prevent double-posting on replay.
- Events are also appended to `core.domain_events` (audit + replay + the future
  async migration path).
- Naming/versioning: `Entity.PastTenseVerb`; payload additions of optional
  fields are compatible changes; semantic changes require an ADR (AR-29).
- Future path: dispatch can move to a broker (async, eventual consistency +
  reconciliation) without changing module code — the interfaces are identical.

## Consequences

- Loose coupling with strong consistency in v1; Inventory knows nothing about
  Accounting (only its own events).
- Atomic fan-out means a new subscriber added later can change failure
  semantics of existing writes — subscriber changes are reviewed as
  architecture-sensitive (they touch the publisher's transaction).
- Ledger reconciliation/period-close behavior (what to do with a rejected
  posting near period close) is business territory: OQ-11.
- Event log growth: compact over time (retention policy with OQ-17).
