# ADR-0004: Outbox Pattern for External Synchronization

Status: Accepted
Date: 2026-09-10

## Context

Vardena must synchronize with external systems (legacy ERP, tax, payments)
without making core transactions dependent on their availability. A direct
"write to DB, then HTTP call" pattern fails on: partial success (DB committed,
call failed), retries after crashes (double send), ordering/replay, and
multi-destination fan-out. The proposed structure (Id, EntityType, EntityId,
Operation, Payload, Status, RetryCount, LastAttemptAt, ErrorMessage, CreatedAt,
ProcessedAt) is sound; it needs a few additions to be operationally complete.

## Decision

Adopt the **transactional outbox** with the flow:

**local transaction → outbox event (same transaction) → background worker →
external integration → retry → success/failure (dead-letter) state.**

- The kernel exposes an `OutboxWriter` port; business modules call it inside
  their business transaction. Implementation (Sync module) writes
  `sync.outbox_events` on the same connection/transaction — atomic by
  construction (dependency inversion keeps modules decoupled from Sync).
- **Field decision:** the proposed fields are **kept and extended**, not
  replaced (full table + per-field rationale in `docs/database-strategy.md`
  §9). Additions: `destination` (one row per event×destination fan-out),
  `dedup_key` (unique business idempotency key), `next_attempt_at` (backoff
  scheduling), `max_retries` (policy snapshot), `correlation_id` (end-to-end
  trace). `status` gains `processing` and `dead_letter`.
- Worker (ADR-0010 queue mechanics) claims due rows with
  `FOR UPDATE SKIP LOCKED`, routes to the Integration adapter, applies
  exponential backoff with jitter (default ladder 1m/5m/15m/1h/4h/12h,
  `max_retries` 6, per-destination policy), classifies permanent vs retryable
  errors (permanent → immediate dead-letter).
- Dead-letter rows are admin-visible (`Sync.Outbox.Manage`): retry (new attempt
  generation) or cancel; dead-letters are audited and notify admins.
- Delivery is **at-least-once**; consumers (including inbound handlers) are
  idempotent via stable keys (AR-15). Per-entity ordering preserved; no
  cross-entity ordering guarantee.

## Consequences

- ERP usability is decoupled from external availability; worst case, outbox
  grows (monitored: pending count, oldest pending — integrations.md §6).
- Complexity lives in two well-defined places (Sync dispatcher + adapters), not
  scattered through business code.
- `processing` state + crash recovery: a claimed row whose worker dies before
  terminal state is re-claimable after a lease (claim timeout) — implementation
  detail of the dispatcher.
- A future broker-backed pipeline would replace the polling dispatcher only;
  the outbox table and business write points stay.
