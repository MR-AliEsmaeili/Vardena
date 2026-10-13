-- Inventory module: Material Request (C-50) — Owner-confirmed lifecycle
-- decisions (return-for-correction, cancellation) recorded after the
-- original C-50 foundation migration.
--
-- Design notes (see prisma/schema/inventory.prisma for the full rationale):
--   * `material_requests.status` gains two new closed-list values —
--     `returned` and `cancelled` — both well within the existing
--     VARCHAR(16) column width, so the column itself is unchanged.
--   * `returned_at`/`returned_by`/`return_reason` record the MOST RECENT
--     return-for-correction (Owner decision: the approver may send a
--     submitted request back to the requester). Like every other per-cycle
--     audit column in this table (`approval_reversed_at` etc.), this is
--     overwritten on each return; the full cycle history is preserved in
--     the already-existing append-only `material_request_events` table, not
--     here.
--   * `cancelled_at`/`cancelled_by`/`cancellation_reason` record a CANCEL —
--     a new, terminal, distinct transition from approval reversal (Owner
--     decision: "cancellation and reversal of approval are distinct
--     operations... with explicit, auditable state transitions"). Unlike
--     the return columns, this is set at most ONCE per request: `cancelled`
--     is a terminal status, never re-entered.
--   * No CHECK constraints, same rule as every other migration in this
--     module: value rules (status set, required-reason-on-return) live in
--     the framework-free domain/application layer and are unit/E2E tested,
--     not enforced in SQL.
--   * No backfill needed: this is additive-only (new nullable columns on an
--     aggregate with no production rows yet — PR #112 is unmerged).

ALTER TABLE "inventory"."material_requests"
    ADD COLUMN "returned_at"         TIMESTAMPTZ(6),
    ADD COLUMN "returned_by"         TEXT,
    ADD COLUMN "return_reason"       VARCHAR(1000),
    ADD COLUMN "cancelled_at"        TIMESTAMPTZ(6),
    ADD COLUMN "cancelled_by"        TEXT,
    ADD COLUMN "cancellation_reason" VARCHAR(1000);
