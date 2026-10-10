# ADR-0043: Acyclic Organization–Inventory Calendar-Transition Coordination

Status: Proposed
Date: 2026-10-10
Builds on: ADR-0042, AR-07, AR-29

## Context

Organization owns each organization's display calendar; Inventory owns
business-document dates. PR #135's original GREGORIAN → JALALI guard read
Inventory tables from the Organization repository, while Inventory's stale-write
helper read Organization tables directly. Making Organization import Inventory
would reverse the existing Inventory → Organization dependency and create a
module cycle. The update and concurrent document writers must remain serialized:
an unlocked history read can miss a writer, and a stale writer must not persist
under a calendar different from the one used to validate its input.

The Product Owner authorized correcting this issue inside PR #135. That task
authorization is not formal acceptance of this architecture decision; no ADR
acceptance is recorded, so this ADR remains Proposed. The implementation in PR
#135 is subject to that review and creates no direct-access exception.

## Proposed decision

1. Keep business modules acyclic. Retain Inventory → Organization and add a
   small root `composition/` module importing both. Move only
   `PATCH /api/v1/organizations/:id` to its controller, preserving its DTO,
   guards, permission, deployment-scope metadata, response and error contract.
   Neither business module imports the composition module.
2. Organization owns calendar updates and row locking. Every explicit
   `calendarSystem` update takes `FOR UPDATE` and changes the setting in
   Organization's transaction. For GREGORIAN → JALALI only, a required callback
   calls Inventory's public history reader while the lock is held; a missing
   callback or reader failure aborts the update. JALALI → GREGORIAN remains
   unrestricted by history.
3. Inventory owns the history query and reads only its own tables. It returns
   the earliest out-of-range BusinessDate using the inclusive renderable
   Gregorian bounds `0621-03-21`–`3798-12-31`. The guard does not rewrite or
   delete history; out-of-range Gregorian dates remain valid and their Jalali
   rendering remains nullable.
4. Every Inventory document create/edit path validates the BusinessDate first,
   then calls Organization's `withBusinessDateWriteLock` contract. Organization
   takes `FOR KEY SHARE`, compares the stored calendar with the one used for
   validation, and awaits the callback wrapping Inventory's complete
   transaction. Missing/stale organizations do not run the callback. No Prisma
   transaction client crosses the module boundary.
5. Keep transactions local rather than claiming a shared cross-module
   transaction. The Organization row lock and calendar update are in the
   Organization transaction; the history query runs through Inventory's public
   application service on its own Prisma operation. Document/header/line/ledger
   effects remain atomic in the Inventory transaction. The deployed PostgreSQL
   default is READ COMMITTED: a writer-first lock ordering makes the transition
   wait and then read the writer's committed history; a transition-first
   ordering makes the waiting writer re-read the changed calendar and refuse
   before its callback.

## Consequences

- AR-07 is satisfied without a table-access exception. The root composition
  pattern is new and ADR-29-gated; this implementation remains Proposed pending
  explicit ADR review.
- Both sides lock the same Organization row in a consistent order
  (`FOR KEY SHARE` for writers, `FOR UPDATE` for calendar updates). The history
  reader takes no Organization row lock and no Inventory write waits back on
  that transition transaction, so these paths introduce no row-lock cycle. Live
  PostgreSQL tests must continue to cover both orderings, READ COMMITTED recheck,
  stale rejection and rollback.
- A lock is held for the duration of the Inventory callback. Keep that callback
  bounded. The shared PostgreSQL pool is capped at 10 connections with a
  3-second acquisition timeout; each active writer holds an Organization
  lock-transaction connection plus an Inventory transaction connection, and
  nested public reads may briefly need more. Pool saturation therefore causes
  a fail-closed timeout/rollback and may reduce write availability;
  high-concurrency capacity still needs operational measurement.
- The transactions are independent: an infrastructure failure after the
  Inventory transaction commits but before the Organization lock transaction's
  completion can leave the caller uncertain about the write outcome. This
  design guarantees serialization and each module's local atomicity, not
  distributed all-or-nothing commit or exactly-once retry.
- Preserve `organization.calendar.jalali_history_unrenderable`, the existing
  stale-write conflict, date range, BusinessDate/Instant separation and all
  API/auth behavior. No schema change, range expansion or history conversion is
  proposed.

## Alternatives considered

- Bidirectional Organization ↔ Inventory imports: simpler wiring, but creates
  the module cycle this proposal avoids.
- A history preflight outside the Organization lock: can miss a concurrent
  writer.
- Passing a shared Prisma transaction client across modules: couples public
  contracts to persistence and obscures transaction ownership.
- Direct cross-module SQL with an ADR exception: unnecessary when the
  public-contract composition can coordinate the use case; no exception is
  proposed or approved.
