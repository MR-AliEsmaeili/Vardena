# Vardena — Database Strategy

Status: Accepted (foundation) · Updated: 2026-10-09 (date/time data conventions reconciled; the remaining foundation sections retain their earlier scope)
ADR-0008 (single DB, schemas per module) · ADR-0004 (outbox) · ADR-0005 (domain events)

## 1. Engine & Topology

- **PostgreSQL 16** (minimum 15) — single node for v1.
- **One database: `vardena`. One schema per module** (ADR-0008):

| Schema | Owner module |
|---|---|
| `core` | kernel (domain event log) |
| `identity` | Identity |
| `users` | Users |
| `rbac` | RBAC |
| `organization` | Organization (planned — ADR-0020, Proposed) |
| `audit` | Audit |
| `notifications` | Notifications |
| `accounting` | Accounting |
| `purchasing` | Purchasing (when scoped) |
| `inventory` | Inventory |
| `sales` | Sales |
| `excel` | Excel |
| `print` | Print |
| `customization` | Customization |
| `integration` | Integration (adapters, credentials, mappings) |
| `sync` | Sync (outbox, sync state) |
| `jobs` | Jobs |

- The Reporting module owns **no tables** in v1 (definitions in code); it reads
  module-owned views.
- Connection pooling: app-managed pool (Prisma) in v1; PgBouncer/sidecar only
  if scale requires (note for cloud path).
- **Ownership rule (AR-07/08):** a schema is written only by its owning module.
  Cross-schema reads are allowed *only* as module-owned views consumed by
  Reporting (and, for debugging, by admins with DB access). Cross-schema writes
  never (except the kernel writing `core.domain_events` in any transaction —
  this is the single documented exception, part of the event mechanism).

## 2. Prisma Usage

- Prisma is the ORM of record for module data. **One schema file per module**
  under `backend/prisma/schema/<module>.prisma` (single provider, schema
  directory), mirroring the DB schema split — the file boundary *is* the module
  boundary on disk.
- **Migrations are the only schema change path (AR-10):**
  - `prisma migrate dev` in development; every migration committed with the code
    that needs it; production deploys run `prisma migrate deploy`.
  - Never `prisma db push`; never manual DDL; never edit an applied migration —
    add a new one.
  - Migration naming: Prisma default timestamp prefix; each migration message
    states module + intent (e.g. `inventory: add receipt notes`).
- Prisma models are **private to their module** (in `data/`); other modules must
  not import another module's Prisma client models (AR-07).

## 3. Naming Conventions

| Object | Convention | Example |
|---|---|---|
| Table | plural, snake_case | `inventory.receipt_lines` |
| Column | snake_case | `created_at`, `unit_cost` |
| Foreign key | `<singular_entity>_id` | `receipt_id` |
| Primary key | `id` (ULID, see §4) | — |
| Unique index | `uq_<table>_<cols>` | `uq_users_username` |
| Regular index | `idx_<table>_<cols>` | `idx_receipts_warehouse_id_created_at` |
| View | `vw_<domain>_<name>` | `inventory.vw_stock_on_hand` |
| Enum (Prisma) | PascalCase, prefixed by purpose | `MovementType` → PG `inventory.MovementType` |

Prisma convention mapping: `@@map("receipt_lines")` etc. so Prisma model names
stay PascalCase while the database stays snake_case.

## 4. Primary Keys & Identity

- **ULIDs** for all entity ids (decision, ADR-0008 consequences). The column type is
  plain `TEXT`, matching every applied migration — the 26-character length is enforced by
  the generator (`kernel/ids`) and by API validation, not by a `varchar(26)` width:
  sortable by time, string-friendly in APIs/logs, no central generator, safe for
  sharding later. Generated in the kernel (`kernel/ids`), client-side in the
  application layer (never DB defaults — keeps generated ids consistent across
  API and worker).
- Business **document numbers** (invoice no., receipt no., …) are *not* primary
  keys and are **business rules — do not invent them (OQ-12)**. Technical note
  for when the rule is decided: if sequence-based, use a dedicated sequence or a
  numbering table with per-scope uniqueness constraints; numbers are assigned
  inside the write transaction.

## 5. Standard Columns (AR-12)

Every entity table has:

| Column | Type | Notes |
|---|---|---|
| `id` | `text(26)` ULID | PK |
| `created_at` | `timestamptz` | UTC, set on insert |
| `updated_at` | `timestamptz` | UTC, set on update |
| `created_by` | `text(26) NULL` | user id; NULL for system events |
| `updated_by` | `text(26) NULL` | same |

- **Instants are always `timestamptz` stored in UTC.** Display is not a raw
  timestamp or browser-zone conversion: use the shared frontend date-time layer,
  resolve the organization's valid IANA zone, then render the resulting local
  date/time in its configured calendar. Detail/audit views include seconds and
  the resolved zone and offset. OQ-02 remains open for numeral rendering and
  broader localization, not the organization calendar/zone contract.
- **BusinessDates are PostgreSQL `date` values, canonical Gregorian.** They are
  days, not JavaScript `Date` domain values, UTC-midnight transports, or
  `timestamptz` values. Prisma exposes a PG `date` through a `DateTime` carrier;
  convert only inside the owning persistence adapter with the shared
  `businessDateToDbDate` / `businessDateFromDbDate` functions, never through
  application DTOs or domain services. User-facing entry/display follows the
  organization's configured calendar (Jalali by default); use the shared
  date-input and conversion APIs. Never infer a BusinessDate from an event
  Instant inside domain logic.
- **Inventory effective-dated windows have an explicit BusinessDate axis**
  (Owner decision, 2026-10-09): global and item-specific unit-conversion windows
  and item-valuation-method windows use half-open `[valid_from, valid_to)`
  ranges (`NULL` end is open), persisted as PostgreSQL `date`. Migration
  `20261012000000_inventory_business_date_validity_windows` maps existing values
  by UTC calendar day and preflights invalid/collapsed/overlapping histories.
  `backend/prisma/rehearsal/business-date-validity-windows/audit.sql` reports
  aggregate counts without row IDs or business payloads. Migration 120 repeats
  its preflight while holding `SHARE ROW EXCLUSIVE` locks on all source tables
  through conversion and commit; a 10-second lock timeout aborts the
  transaction, and concurrent writers wait. Its type changes may block reads,
  so deployment requires an authorized maintenance window. The two-session
  PostgreSQL rehearsal verifies the barrier before and after preflight. Fixture
  rehearsal is not production data evidence; inspect target data and retain the
  audit counts, migration NOTICE, verified backup/restore evidence, and
  target-like rehearsal outcome before deployment. Other modules' fields named
  `valid_*` are not reclassified by this decision.
- FKs to users are logical (enforced at the app level; DB FK to `users.users`
  only where the owning schema and dependency are clean — e.g. not for
  `created_by` on module tables to avoid cross-schema FK sprawl; documented
  per table if used).

## 6. Data Types

| Concern | Convention |
|---|---|
| Money | `numeric(18,2)` default. Currency handling: ledger tables carry an explicit currency; whether IRR/RMT precision differs is **OQ-03** — do not hardcode display precision. |
| Quantity | `numeric(18,4)` default per unit; per-warehouse decimal settings later if needed (module-level decision). |
| Rates/ratios | `numeric(18,6)` where required. |
| IDs in API | ULID strings; no client-generated ids accepted except correlation ids (validated format). |
| JSONB | payloads (outbox, event log, preferences, import rows, audit before/after). Always written by the owning module; queried with GIN indexes only when a query pattern demands (no speculative GIN). |
| Booleans | explicit `boolean`, not int. |
| Strings | `text` + length check in validation layer (prefer validation over DB length), `varchar(n)` only for protocol constraints (e.g. username 64). |

## 7. Immutability & Soft Delete (AR-13)

- **Immutable by nature:** accounting journal entries & lines, inventory
  movements, audit logs, outbox rows (append-only; status columns are the only
  updates), domain event log, import rows (after apply). Corrections are
  *counter-records* (reversing entries, adjustment movements), never edits.
- **Soft delete:** only for reference/master data where history matters
  (items, warehouses, customers, suppliers, roles, users, accounts). Pattern:
  `deleted_at timestamptz NULL`, `deleted_by text(26) NULL`; unique constraints
  use partial indexes (`WHERE deleted_at IS NULL`) so re-creating with the same
  business key works. Transactional documents (invoices, receipts) are **not**
  soft-deleted; they are *canceled* by a state transition (per-module state
  machine, documented in the module section).
- Every module documents per entity: immutable / soft-delete / state machine.

## 8. Domain Event Log (`core.domain_events`)

Append-only log of internal domain events (ADR-0005):

| Column | Type | Notes |
|---|---|---|
| `id` | `text(26)` | event id (ULID) — also the consumer dedup key |
| `type` | `text` | `InventoryReceipt.Created` … |
| `aggregate_type` | `text` | `InventoryReceipt` |
| `aggregate_id` | `text(26)` | source entity id |
| `payload` | `jsonb` | full event body (versioned by type) |
| `correlation_id` | `text` | request correlation |
| `created_at` | `timestamptz` | |

Written in the publisher's transaction; dispatched in-process immediately (v1).
Consumers keep their own dedup tables (event ids they processed) — the log is
for audit, replay, and the future async migration, not a broker queue.

## 9. Outbox (`sync.outbox_events`) — field decision

The user-proposed structure is **used and extended** (decision — ADR-0004):

| Column | Type | From proposal? | Rationale |
|---|---|---|---|
| `id` | `text(26)` | yes (Id) | PK, ULID |
| `destination` | `text` | **added** | one row per (event, destination) fan-out; required to route to the right adapter and scope retries/policies per system |
| `operation` | `text` | yes (Operation) | canonical operation id = domain event name (e.g. `InventoryReceipt.Created`) |
| `entity_type` | `text` | yes (EntityType) | source entity (e.g. `InventoryReceipt`) |
| `entity_id` | `text(26)` | yes (EntityId) | source entity id |
| `payload` | `jsonb` | yes (Payload) | stable, idempotency-safe payload; includes idempotency key + payload version field |
| `dedup_key` | `text` (unique) | **added** | stable business idempotency key (e.g. `InventoryReceipt:<id>:Created`); protects against double-append and duplicate delivery (AR-15) |
| `status` | enum | yes (Status) | `pending \| processing \| succeeded \| failed \| dead_letter` — adds `processing` (claimed by a worker) and `dead_letter` (terminal, manual handling) |
| `retry_count` | `int` | yes (RetryCount) | attempts made |
| `max_retries` | `int` | **added** | policy snapshot at write time (default 6) — history-safe if policy changes |
| `next_attempt_at` | `timestamptz` | **added** | backoff scheduling; `NULL` = due now. Without it the worker would need to compute backoff from `last_attempt_at`+`retry_count` per poll |
| `last_attempt_at` | `timestamptz` | yes (LastAttemptAt) | |
| `error_message` | `text` | yes (ErrorMessage) | last error, truncated to 4000 chars; full details in worker logs via correlation id |
| `correlation_id` | `text` | **added** | traces API request → business write → outbox → external call (security §5) |
| `created_at` | `timestamptz` | yes (CreatedAt) | |
| `processed_at` | `timestamptz` | yes (ProcessedAt) | set on terminal states (`succeeded`, `dead_letter`) |

Indexes: `uq_outbox_dedup_key` (unique), `(status, next_attempt_at)` for
worker claim, `(entity_type, entity_id)` for per-entity sync history.

**Semantics:** at-least-once delivery; idempotent consumers (business dedup on
event/`dedup_key`); per-entity ordering preserved; no cross-entity ordering
guarantee. Manual retry from dead-letter starts a new attempt generation
(`retry_count` reset, new `next_attempt_at`).

## 10. Other Horizontal Tables (shape summary)

- `jobs.job_runs`: id, name, type, payload jsonb, status
  (`queued|running|succeeded|failed|canceled`), scheduled_at, locked_by,
  locked_at, attempts, max_attempts, error, created_by, created_at, completed_at.
  Claimed with `FOR UPDATE SKIP LOCKED` (ADR-0010).
- `excel.import_sessions` / `excel.import_rows`: see `docs/modules.md` §Excel
  (session lifecycle statuses; row-level status + error code/message).
- `print.document_types` / `print.templates` / `print.jobs`: see
  `docs/modules.md` §Print.
- `customization.user_preferences`: id, user_id, category, key, value jsonb,
  updated_at; `uq(user_id, category, key)` (ADR-0013).
- `identity.sessions`: id, user_id, token_hash, user_agent, ip_address,
  created_at, last_seen_at, expires_at, revoked_at (ADR-0007).
- `rbac.*`: permissions (code unique, module, entity, action, description),
  roles (code unique, name, is_system), role_permissions, user_roles.
- `audit.audit_logs`: id, actor_id, actor_type, action, module, entity_type,
  entity_id, before jsonb, after jsonb, correlation_id, ip_address, user_agent,
  created_at (append-only).
- `sync.sync_state`: id, destination, entity_type, entity_id, external_id,
  last_operation, last_synced_at, status; `uq(destination, entity_type, entity_id)`.
- `notifications.items`: id, user_id, module, type, title, body, url, status
  (`new|read|dismissed`), created_at, read_at.

## 11. Indexing Strategy

- Index FKs by default; index columns used in documented list-filter patterns
  (each module documents its report/list query columns in its section of
  `docs/modules.md` — indexes follow, not speculation).
- Composite indexes for dominant access patterns (e.g. receipt list by
  warehouse + date range).
- GIN on JSONB **only** for a concrete query (none planned in v1).
- Partial indexes for soft-delete uniques and active-only lists.
- Review: after any performance incident, update the module's documented query
  patterns *and* the index in the same change.

## 12. Raw SQL Policy (AR-11)

Allowed, in exactly these places:

1. **Module-owned views** — defined in the owning module's `data/` (SQL) and
   exposed to Reporting; a view may join *within its own schema* (and `core`
   event log if needed for audit-joined reports — documented per view).
2. **Reporting module** — parameterized queries composing module views for
   cross-module reports (see `docs/reporting-strategy.md`).
3. **Documented perf-critical paths** — must be noted in the module's section of
   `docs/modules.md` with the query pattern; requires ADR if it crosses schemas.

Always parameterized (no string concatenation of user input), always executed
through the module's data layer, never from `api/`.

## 13. Concurrency

- **Optimistic locking** via `version int` for multi-user-editable reference
  data (user profile, item master data) — version checked on update; conflict →
  `Conflict` error with 409.
- **Pessimistic row locks** inside short transactions for stock balance updates
  (Inventory), number sequences, and the Accounting guards — `SELECT …
  FOR UPDATE` on the parent area/year row inside the module's guarded `data/`
  transactions (lock order area → year → period, never reversed; the unique
  indexes stay the backstop for identity races). Task 10.3 extends the same rule
  to the chart: order `coding-structure version → account`, publish locks every
  version row of the organization ascending by id (that is what makes "exactly
  one active coding structure per organization" hold), a child create locks its
  parent row (so it serializes against a postability flip on that same row), a
  re-parenting locks node + new parent ascending (so concurrent
  cycle-forming moves serialize and exactly one wins).
- Journal entries: immutability instead of locking (AR-13).
- No long-running transactions: anything that waits (external call, user
  confirmation) must have committed or rolled back first (outbox/import pattern).

## 14. Backups & Operations

- **Policy (Owner, 2026-10-05):** Vardena provides a backup capability and an
  operational Runbook; the customer/server administrator is responsible for
  maintaining backups on the customer infrastructure; restore is performed by
  the customer's authorized IT/server administrator per the Runbook — normal
  ERP users never get an in-product Restore. **Business Export (Excel) ≠
  Disaster/Technical Backup (full backup)** — never conflate them. Canonical
  policy: `docs/operations/backup-and-restore.md` (OQ-46/OQ-52/OQ-53).
- Logical backups (`pg_dump`) scheduled (compose sidecar or host cron —
  deployment detail), retention per deployment; point-in-time recovery via WAL
  archiving is recommended but deployment-specific.
- **RPO/RTO targets are business/deployment decisions — OQ-17/OQ-52** (do not
  assume; numeric targets remain OPEN as of 2026-10-05).
- Migration deploy order: `prisma migrate deploy` before app start; migrations
  must be backward-compatible with the *previous* app version during the deploy
  window (expand → migrate → contract pattern for risky changes, ADR if needed).
- Database user: app role with least privilege (no `pg_dump`-equivalent admin
  from the app); backups use a separate role.
