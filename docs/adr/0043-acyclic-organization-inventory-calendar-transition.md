# ADR-0043: Acyclic Organization–Inventory Calendar-Transition Coordination

Status: Superseded by ADR-0044
Date: 2026-10-10
Builds on: ADR-0042, AR-07, AR-29

## Context

Organization owns each organization's display calendar; Inventory owns its
BusinessDates. Organization must inspect Inventory history before a
GREGORIAN → JALALI transition, while concurrent Inventory writes must not
commit dates validated under the old calendar. Direct cross-module persistence
access, a module cycle, and a shared transaction client are prohibited.

## Decision

1. Keep the dependency acyclic: a root `composition/` service calls the public
   Organization and Inventory application contracts. Organization owns the
   setting and transition lock; Inventory owns the history query and all its
   writes. Neither module imports composition or another module's persistence.
2. A calendar transition locks the Organization row `FOR UPDATE`. For
   GREGORIAN → JALALI, the required Inventory history reader runs while that
   lock is held; a missing reader or read failure aborts the Organization
   transaction. JALALI → GREGORIAN remains unrestricted by history.
3. Every Inventory write that persists a BusinessDate validates against its
   captured calendar, then holds Organization's `FOR SHARE` lock while its
   complete Inventory-local transaction commits. `FOR SHARE` conflicts with
   the non-key row update made by a calendar change; `FOR KEY SHARE` would not.
   A missing or stale organization never starts the Inventory callback. Balance
   rebuilds also follow this contract: the application captures the calendar
   once, locks/rechecks it per key, and the Inventory transaction refuses to
   copy a ledger-derived latest movement date that cannot be rendered there.
   The lock is released between keys; no transaction client crosses the module
   boundary.
4. The Inventory history query is tenant-scoped, deterministic and read-only.
   It checks movement dates, document dates, conversion and valuation-method
   validity endpoints, valuation/pricing run dates, balance projection dates,
   and Accounting-posting snapshot dates. GREGORIAN → JALALI rejects the
   earliest stored day outside the inclusive renderable Gregorian range
   `0621-03-21`–`3798-12-31`; it never rewrites history. Gregorian-only
   rendering remains valid outside that Jalali envelope.
5. Organization and Inventory keep independent transactions. The contract
   guarantees serialization and each module's local atomicity, not a
   distributed all-or-nothing commit or exactly-once outcome. Both Organization
   transactions explicitly use PostgreSQL READ COMMITTED so a transition-first
   writer re-reads the committed calendar after its `FOR SHARE` wait.

## Consequences

- Public-path guards cover standalone movements, transfers, reversals,
  document create/edit/finalize/cancel and Accounting-posting snapshot creation,
  conversion and valuation-method versions, valuation recalculation,
  pricing/reverse-pricing runs, and the derived `last_movement_date` written by
  balance rebuilds.
- A balance rebuild keeps its existing short Inventory transaction per key and
  holds Organization `FOR SHARE` only around that key; it does not hold the
  10-second Organization transaction across the whole discovered batch. A
  transition may therefore win between keys. In that case the API returns the
  calendar-change conflict with completed/total key counts; earlier key commits
  remain, and the operator retries the full scope. Rebuild is idempotent by
  absolute ledger-derived replacement, not an atomic batch or exactly-once job.
- The rebuild's OpenAPI 409 response uses the standard error envelope with
  `code`, `message`, `details`, and `correlationId`; it types both stable
  `details.code` values plus
  `completedKeys`/`totalKeys`. `retrySafe` is present for the calendar-change
  case; an unrenderable-history conflict instead includes `businessDate` and
  `calendarSystem`. Frontend API declarations are generated from this schema.
- Prisma 7.10 interactive transactions default to `maxWait=2s` and `timeout=5s`;
  PrismaPg uses these Prisma transaction limits. The Organization writer lock
  pins `maxWait=3s`, `timeout=10s`; calendar transitions pin `maxWait=3s`,
  `timeout=15s`. Current Inventory-local write transactions retain the 5s
  default, so the Organization lock outlives their deadline. If an Inventory
  callback adopts a longer timeout, update this paired limit and the live test.
- A guarded write consumes an Organization connection while its Inventory
  transaction needs another from the shared 10-connection pool. Same-org
  writers acquire Organization first, then Inventory; transition history reads
  follow that order without taking Inventory row locks. Bursts can exhaust the
  pool and fail closed after connection/transaction wait limits. Do no
  post-commit work inside the lock callback.
- If Inventory commits but the later Organization callback/commit fails, the
  API can return an error although the Inventory effect is durable. Retry keyed
  movements, transfers, valuation and pricing with the same operation key;
  for non-keyed document/configuration writes, read the current state before
  retrying and never blindly replay. For an interrupted balance rebuild, retry
  the whole scope: each committed key is recomputed from the latest locked
  ledger state. This is not exactly-once behavior.
- Live PostgreSQL tests prove transition/writer ordering, concurrent transition
  serialization, stale refusal before the Inventory callback, history refusal,
  inclusive endpoints, local rollback, idempotent recovery after an outer
  failure, and per-key balance-rebuild ordering with a partial-batch retry.
  Pool/load capacity and a production-data rehearsal remain deployment checks;
  CI does not imply that production has been audited or rehearsed.
- The history query's organization-first indexes are additive. Their ordinary
  transactional builds block writes on indexed Inventory tables until commit;
  deploy in a write-quiesced window after a production-sized rehearsal. A lock
  timeout aborts the whole index migration.
