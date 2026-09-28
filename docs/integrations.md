# Vardena — Integration & Synchronization Architecture

Status: Accepted (foundation) · Updated: 2026-09-10
Companion ADRs: ADR-0003 (isolation), ADR-0004 (outbox), ADR-0010 (DB queue).

## 1. Independence Principle

Vardena is **not** built on any legacy ERP:

- own database (PostgreSQL, `vardena`) — never a legacy ERP database;
- own business logic — legacy data is _imported/synchronized_, never
  authoritative at runtime;
- own authentication/authorization — no pass-through to legacy identity;
- own API — the frontend talks only to Vardena.

Legacy FaraPayam-style ERP web services, the Iranian Taxpayer System, payment
services, and future external enterprise systems are all **peer systems**
integrated through the adapter layer below.

## 2. Integration Layer Topology

```
 Outbound (Vardena → external):

 business module transaction
   └─ kernel OutboxWriter.append(destination, operation, entity, payload, correlationId)
        → sync.outbox_events row (same DB transaction as the business write)
        → [worker] Sync dispatcher claims due row (FOR UPDATE SKIP LOCKED)
        → Integration adapter.send(operation, payload, meta)
        → success: status=succeeded, processed_at, sync_state updated
        → failure: retry with backoff (≤ max_retries) → dead_letter + audit + notification

 Inbound (external → Vardena):

 external system → adapter receive handler (adapter credential, validation, idempotency)
   → idempotent command → business module public application service
   → sync_state updated (last external id / last synced at)
```

Rules (binding):

1. **No external HTTP in request paths.** Business code never calls an adapter
   synchronously to _send_ data (AR-14). Reads _from_ an external system for
   interactive use (e.g. "lookup a legacy customer") are allowed through an
   adapter with short timeout + cached/tolerant degradation, and are documented
   per integration — they must never block a core transaction.
2. **Business availability is decoupled from external availability.** If
   FaraPayam is down, ERP operations continue; outbox rows wait and retry.
3. **One outbox row per (event, destination).** A domain event that must reach
   two systems produces two rows (fan-out at write time).
4. **All external calls are idempotent** from the sender side (stable
   `dedup_key`/idempotency key in the payload) _and_ consumers (including
   inbound receive) must deduplicate (AR-15).

## 3. Adapter Contract (kernel port)

Each external system has one adapter in the `integration` module implementing:

| Member                           | Purpose                                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `code`                           | stable destination id (`faraPayam`, `taxpayer`, `payment`) — matches outbox `destination`                                        |
| `send(operation, payload, meta)` | deliver an outbox operation; returns success/failure with error taxonomy                                                         |
| `errorTaxonomy`                  | classify failures: `retryable` (network, 5xx, timeout) vs `permanent` (4xx contract, auth) — permanent fails fast to dead-letter |
| `health()`                       | liveness/reachability probe for the admin UI                                                                                     |
| `credentials`                    | resolved from config, encrypted at rest; never logged                                                                            |
| `inbound?`                       | optional receive handlers (credential-protected, idempotent)                                                                     |

Concrete adapters may use REST/SOAP/whatever the external system speaks — the
protocol detail is **private to the adapter**. Nothing outside `integration/`
imports a concrete adapter; everything depends on the port. (AR-18)

**Mappings** (internal entity ↔ external entity/fields) are _data_ owned by the
Integration module (per-destination mapping configuration), while the _semantic_
meaning stays with the owning business module. Changing a mapping is config/data;
changing what an operation means is an ADR-gated contract change.

## 4. Planned Integrations

| Destination                | Direction                               | Status                        | Notes / Open questions                                                                                                                                                        |
| -------------------------- | --------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FaraPayam-style legacy ERP | in + out                                | **planned, contract unknown** | OQ-04: service contract (REST/SOAP?), auth mode, data model, sync scope & cadence. Until the contract is known, the adapter is a stub with the port fully exercised by tests. |
| Iranian Taxpayer System    | out (documents/returns) + in (statuses) | planned                       | OQ-05: scope (which document types, e.g. e-invoices; submission flows), credentials, sandbox availability. No specifics are assumed.                                          |
| Payment services           | in + out                                | planned                       | OQ-07: which providers, flows (receipts/refunds), reconciliation model.                                                                                                       |
| Other enterprise systems   | TBD                                     | future                        | Same pattern: new adapter + destination code + ADR if it changes contracts.                                                                                                   |

**New integration checklist** (each step maps to a rule):

1. ADR or OQ registered if the contract is unknown (document it, don't guess).
2. Define destination code + operations (operation names reuse domain event
   names, e.g. `InventoryReceipt.Created`).
3. Implement adapter (port) + config + credential encryption (AR-20).
4. Define the business module's outbox write points (which events, which
   payloads, in which transaction) — with the module owner.
5. Define mapping config (Integration).
6. Wire sync_state tracking + inbound idempotency if inbound.
7. Tests: adapter against recorded fixtures/mocks only (AG-06); outbox dispatch
   test covering success, retryable failure → retry, permanent failure →
   dead-letter; idempotency test (duplicate delivery changes nothing).
8. Admin UI: connection health, dead-letter view, manual retry/cancel.
9. Docs: module section (Integration), `docs/modules.md` event/outbox rows,
   this file's table.

## 5. Outbox Design (summary — DDL & field rationale: database-strategy §Outbox)

Flow: **Local transaction → Outbox event → Background worker → External
integration → Retry → Success/Failure state.**

- Written atomically with the business write (kernel `OutboxWriter`, port
  implemented by Sync — dependency inversion keeps business modules free of Sync
  details).
- Statuses: `pending → processing → succeeded | failed (retryable) → … →
dead_letter`. `processed_at` set on terminal states.
- Retry: exponential backoff with jitter (default ladder 1m, 5m, 15m, 1h, 4h,
  12h), `max_retries` default 6 (per-destination policy, configurable).
  Permanent (non-retryable) errors → immediate `dead_letter`.
- Dead-letter: visible in admin UI (permission `Sync.Outbox.Manage`), manual
  **retry** (resets to pending with a new attempt generation) and **cancel**;
  every dead-letter is audited and notifies admins.
- Operational guarantees: at-least-once delivery (dedup makes it effectively
  exactly-once at the business level, AR-15); ordering not guaranteed across
  entities, _per-entity_ ordering is preserved (worker processes per
  destination in claim order; per-entity sequence documented per integration if
  required).
- **Field decision (user-proposed list):** the proposed fields are **used and
  extended**, not replaced — see `docs/database-strategy.md` §Outbox for the
  per-field table and rationale of each addition (`destination`, `dedup_key`,
  `next_attempt_at`, `max_retries`, `correlation_id`).

## 6. Synchronization Semantics

- **Sync ≠ replication engine.** v1 sync is operation-based: discrete operations
  (created/updated documents) flow one way at a time per destination. Full
  historical _replication_ from the legacy ERP (bootstrap import) is a one-time
  data migration task per destination, executed through the same import
  pipeline discipline (validate → preview → confirm) — it is **not** a runtime
  dependency.
- **Conflict policy v1:** last-write-wins at the _operation_ level is acceptable
  for outbound (Vardena is source of truth for its own entities); for inbound,
  Vardena accepts external state changes only for fields the mapping marks as
  externally-owned, and rejects/log conflicts otherwise. Bidirectional ownership
  rules per field are defined per destination in mapping config (business
  decisions → OQ where unspecified).
- **Sync state:** `sync.sync_state` tracks per (destination, entity): last
  external id, last operation, last synced at — powers "resync" and monitoring.
- **Health monitoring:** per-destination metrics (pending count, oldest pending,
  failures/24h, dead-letter count) surfaced in admin UI; thresholds configurable.

## 7. Testing Rules (binding, AG-06)

- Unit/integration tests **never** call real external systems.
- Adapters are tested against **recorded fixtures** (request/response pairs) or
  an in-test mock server implementing the minimal contract.
- Outbox dispatch is tested end-to-end in-process: business write → outbox row →
  dispatcher → mock adapter → terminal state, including retry and dead-letter
  paths.
- Contract changes (operation payload shapes) require fixture updates + an ADR if
  semantics change.
