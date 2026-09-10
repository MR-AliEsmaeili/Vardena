# Vardena — Module Catalog

Status: Accepted (foundation) · Updated: 2026-09-10

This is the normative module catalog. Each entry defines: purpose, responsibilities
(including what the module is **not** responsible for), owned data (schema),
published/consumed events, and extension points. Adding a module = new folder per
`docs/architecture.md` §4 + a section here + an ADR (AR-29).

## Module Map

| Module | Status | One-line purpose | Owned schema(s) |
|---|---|---|---|
| Identity | v1 core | Authentication: login, sessions, password handling | `identity` |
| Users | v1 core | User records, profiles, enable/disable | `users` |
| RBAC | v1 core | Roles, granular permissions, assignments | `rbac` |
| Audit | v1 core | Append-only audit log of sensitive operations | `audit` |
| Notifications | v1 core | In-app notifications driven by events | `notifications` |
| Accounting | v1 core | Chart of accounts, journal entries, periods, ledgers | `accounting` |
| Inventory | v1 core | Items, warehouses, stock, receipts/issues/transfers/adjustments | `inventory` |
| Sales | v1 core | Customers, quotes, sales orders, invoices, returns | `sales` |
| Purchasing | planned | Suppliers, purchase orders, supplier invoices | `purchasing` |
| Reporting | v1 core | Report registry, query pipeline, dashboards | (none in v1) |
| Excel | v1 core | Import engine (validated workflow) + export engine | `excel` |
| Print | v1 core | Document templates, rendering, PDF jobs | `print` |
| Customization | v1 core | User preferences (UI, dashboards, filters, print, report) | `customization` |
| Integration | v1 core | External system adapters + credentials + sync state | `integration` |
| Sync | v1 core | Outbox + dispatch policies, retry, dead-letter, admin controls | `sync` |
| Jobs | v1 core | DB-backed job queue + scheduler | `jobs` |

**Purchasing** is marked *planned* because the product requirements imply it
(purchase → inventory receipt → accounting journal entry) but do not place it in
the initial scope explicitly. See OQ-16. Until it exists, purchase-driven stock
inflows can be entered as manual inventory receipts.

## Horizontal vs Vertical Modules

- **Vertical modules** own a business domain: Identity, Users, RBAC, Accounting,
  Inventory, Sales, Purchasing.
- **Horizontal modules** provide capabilities to vertical modules through
  **extension points** — they are *served by* vertical modules, never the owner of
  vertical data:
  - **Reporting** consumes `reports/` definitions + module-owned views.
  - **Excel** consumes `imports/` ImportSpecs (import) and Reporting's pipeline
    (export).
  - **Print** consumes `documents/` providers (data shape per document type).
  - **Customization** stores preferences that other features read
    (grid columns, dashboards, print prefs, report prefs).
  - **Audit**, **Notifications**, **Sync** are event *subscribers* to everything.

Rule: a horizontal module must never own vertical data or encode vertical business
rules; it defines the *mechanism*, vertical modules provide the *content*
(AR-08).

---

## Identity (v1 core)

- **Purpose:** authentication mechanics — credential verification, session
  lifecycle, password policy application.
- **Owns:** `identity.sessions` (opaque tokens, hashed at rest, expiry, last
  activity, device/IP metadata). Password hashes live on `users.users` (owned by
  Users); Identity reads them via the Users module's public service.
- **API (high-level):** login, logout, current session, list/revoke sessions
  (self + admin), password change (own), forced password reset (admin-initiated).
- **Publishes:** `UserSession.Created`, `UserSession.Revoked`, `Login.Failed`.
- **Not responsible for:** user records/profiles (Users), role/permission checks
  (RBAC), audit storage (Audit — it emits events that Audit consumes).
- **Security rules:** see `docs/security.md` §Authentication (argon2id, lockout,
  session lifetimes).

## Users (v1 core)

- **Owns:** `users.users` (profile, username (unique), email (optional, unique if
  set), display name, active flag, password hash, MFA hooks (reserved)).
- **API:** CRUD for user records, activate/deactivate, reset password (admin),
  self profile read/update.
- **Publishes:** `User.Created`, `User.Updated`, `User.Disabled`.
- **Depends on:** RBAC (role assignments are managed by the RBAC module against
  user ids), Identity (deactivated users' sessions are revoked via event).
- **Not responsible for:** login/session mechanics (Identity), permissions (RBAC).

## RBAC (v1 core)

- **Owns:** `rbac.permissions` (mirror of the code registry), `rbac.roles`,
  `rbac.role_permissions`, `rbac.user_roles`.
- **Model:** fine-grained permissions named `Module.Entity.Action` (AR-22), e.g.
  `Inventory.Receipt.View|Create|Edit|Delete`. The **code registry is the source
  of truth**: each module registers its permissions in code; a sync step mirrors
  them into the DB for the admin UI. Roles are named sets of permissions; users
  hold roles.
- **API:** list permissions; CRUD roles (code-managed roles protected); assign/
  remove roles to/from users; effective-permissions query (for UI + debugging).
- **Authorization service (public):** `hasPermission(userId, code)` and
  `hasAnyPermission(userId, [codes])` — used by route guards and application
  services. Permission evaluation is cached per session; role/permission changes
  invalidate the cache.
- **Publishes:** `Role.Updated`, `UserRole.Assigned`, `UserRole.Removed`.
- **Seed roles are a business decision (OQ-14)** — do not invent them.
- **Not responsible for:** deciding *where* checks happen (that's every module's
  application layer, AR-21) or audit of denials (Audit module).

## Audit (v1 core)

- **Owns:** `audit.audit_logs` — append-only: (id, actor id/type, action, module,
  entity type/id, before/after JSONB snapshots, correlation id, IP, user agent,
  created_at). No update/delete API (AR-23).
- **Feeds:** all sensitive events (user management, RBAC changes, accounting
  postings, inventory movements, sales documents, import applies, print jobs,
  integration admin actions).
- **API:** query/read audit log (permission `Audit.Log.View`); export to Excel
  (via Excel module).
- **Write path:** modules emit audit data through the kernel audit port inside
  their business transaction; Audit persists it. Retention/archival = OQ-17.

## Accounting (v1 core)

- **Owns:** chart of accounts, journal entries + lines (immutable, AR-13),
  accounting periods, account balances (materialized), posting rules
  (**mapping from domain events → journal templates belongs here**).
- **Consumes:** `InventoryReceipt.Created`, `InventoryIssue.Created`,
  `StockAdjustment.Created`, `Invoice.Issued`, and (future) purchasing events —
  each mapped to a journal-entry template defined and owned by Accounting.
- **API:** accounts CRUD; journal entries list/detail (create only via events or
  manual journal with permission `Accounting.Journal.Create`); period open/close;
  ledger & balance inquiries (feeds reporting via module views).
- **Publishes:** `JournalEntry.Posted`, `AccountingPeriod.Closed`.
- **Rules:** double-entry; journal entries immutable (correction = reversing
  entry); posting into a closed period is rejected (behavior detail OQ-11).
  Accounting journal generation from events is idempotent (dedup on event id,
  AR-15).
- **Not responsible for:** knowing *why* inventory moved (Inventory's business),
  pricing (Sales), tax rules (OQ-05/13).

## Inventory (v1 core)

- **Owns:** items (with units of measure), warehouses, locations, stock balances,
  stock movements (receipt, issue, transfer, adjustment) — movements are
  immutable; balances are derived/materialized from movements.
- **API:** items CRUD; warehouses CRUD; stock balance queries; receipt/issue/
  transfer/adjustment create (with permissions per AR-22); stock movement history.
- **Publishes:** `InventoryReceipt.Created`, `InventoryIssue.Created`,
  `StockTransfer.Created`, `StockAdjustment.Created` (+ `Item.Created/Updated/
  Archived` etc.).
- **Extension points:** `reports/` (stock on hand, movements, valuation views),
  `imports/` (item import, stock adjustment import), `documents/` (goods receipt
  note, issue note).
- **Rules:** stock cannot go below zero unless explicitly allowed per item/
  warehouse (policy = OQ-13 candidate); every movement records actor +
  correlation id.
- **Not responsible for:** accounting effects (subscribes nothing about
  accounting; ADR-0005), purchasing (future Purchasing module), pricing.

## Sales (v1 core)

- **Owns:** customers, quotes, sales orders, invoices, returns.
- **API:** customer CRUD; document workflows (quote → order → invoice; returns),
  each document with its permission set (`Sales.Invoice.View|Create|Edit|…`).
- **Publishes:** `SalesOrder.Created`, `SalesOrder.Confirmed`, `Invoice.Issued`,
  `SalesReturn.Created`.
- **Consumes (reads):** Inventory public stock queries (availability display —
  read-only, no stock mutation), Users/RBAC as needed.
- **Extension points:** `reports/` (sales by period/customer/item views),
  `imports/` (customer import), `documents/` (invoice, order, return print
  providers).
- **Not responsible for:** stock mutation (that's Inventory, via events/commands
  to Inventory's public API when the business requires it — workflow detail OQ-15),
  accounting (event-driven), tax calculation specifics (OQ-05/13).

## Purchasing (planned)

- **Purpose (when scoped):** suppliers, purchase orders, supplier invoices;
  purchase → inventory receipt flow.
- **Design constraint:** must follow the same anatomy and event style; its
  receipt events are consumed by Inventory/Accounting exactly like inventory's
  own events. Scope decision: OQ-16.

## Reporting (v1 core)

- **Owns:** the report **registry** (code-defined report definitions) and the
  query pipeline (filters, grouping, sorting, pagination, limits). No tables in
  v1 — definitions live in code (versioned, testable).
- **Data access:** module-owned views first, parameterized raw SQL in the
  reporting module for cross-module reports, Prisma for simple single-table
  cases — see `docs/reporting-strategy.md` (ADR-0009).
- **API:** list reports (permission-gated per report); execute report (data,
  count); export report to Excel (delegates to Excel); dashboard data endpoints.
- **Dashboards:** layouts are user preferences (Customization) referencing report
  ids; a dashboard is a composition of report widgets, not a separate query
  engine.
- **Publishes:** `Report.Generated` (async heavy reports → Jobs + Notifications).

## Excel (v1 core)

- **Import engine — the mandated workflow (ADR-0011):**
  `Upload → Parse → Validate → Preview → User confirmation → Transaction →
  Persist → Result summary`, with row-level status/errors. Sessions and rows
  live in `excel.import_sessions` / `excel.import_rows`.
- **Target contracts:** each vertical module provides `imports/` **ImportSpecs**
  (target entity, allowed columns, per-row validators, upsert key, batch size,
  post-commit events). The Excel module never inserts into another module's
  tables — it calls the target module's **import application service**
  (a public, transactional batch API) with validated row batches.
- **Export engine:** streaming XLSX writer used by Reporting (and any
  permission-gated endpoint needing Excel output); column headers/labels from
  report definitions or entity field metadata.
- **Publishes:** `ImportSession.Completed`, `ImportSession.Failed`
  → Notifications.

## Print (v1 core)

- **Owns:** document-type registry, versioned HTML/CSS templates (with
  organization-scope and user-preference overrides), render jobs, generated file
  storage (path-based in v1; storage port for later — OQ-08).
- **Mechanism (ADR-0012):** source module registers a **document provider** in
  its `documents/` (data shape + fetch function). Print job = (document type,
  entity ref, context) → data provider → template → HTML → PDF (worker, headless
  Chromium) → stored file → authenticated download.
- **API:** list document types/templates (admin); render (sync for small docs,
  job for heavy); fetch result (permission-gated per document type); template
  admin CRUD.
- **Publishes:** `PrintJob.Completed/Failed` → Notifications.
- **Not responsible for:** document business data (owned by source modules).

## Customization (v1 core)

- **Owns:** `customization.user_preferences` — (user, category, key) → JSONB
  value, validated against a **code registry** of allowed keys + JSON schemas
  (ADR-0013). Categories: `ui.table`, `ui.filters`, `ui.dashboard`, `ui.theme`,
  `ui.general`, `print`, `report`.
- **API:** get/set preferences (self); organization defaults later (OQ-09).
- **Design rule:** preferences are *user data about the UI*, never business data;
  unknown keys are rejected; values are validated server-side.
- **Not responsible for:** persisting business state; any "preference" that
  changes business behavior is a business rule and belongs in the business
  module (and likely an OQ).

## Integration (v1 core)

- **Owns:** concrete **adapters** for external systems (FaraPayam-style legacy
  ERP, Iranian Taxpayer System, payment services, …), per-adapter credentials
  (encrypted at rest), connection health, inbound receive endpoints (if an
  external system calls in).
- **Contract:** every adapter implements the kernel adapter port
  (see `docs/integrations.md` §Adapter contract): `send(operation, payload,
  meta)`, idempotency support, retryable-vs-permanent error taxonomy, health.
- **Publishes:** `Integration.Failed` (for dead-letter handling),
  `Integration.Connected/Disconnected`.
- **Not responsible for:** deciding *what* to sync (that's the business modules'
  outbox rows + Sync policies), mapping ownership (mapping configuration belongs
  here as *data*, business semantics belong to the owning module).

## Sync (v1 core)

- **Owns:** `sync.outbox_events` (the Outbox — DDL and field rationale in
  `docs/database-strategy.md` §Outbox), dispatch policies (retry/backoff/
  max-retries per destination), `sync.sync_state` (per destination/entity: last
  external id, last operation, last synced at), dead-letter handling, admin
  controls (view/retry/cancel).
- **Worker side:** the outbox dispatcher runs in the worker (ADR-0010): claims
  due rows (`FOR UPDATE SKIP LOCKED`), routes to the right Integration adapter,
  records success/failure, schedules retries, dead-letters after max retries.
- **Inbound sync:** external → adapter → idempotent commands → business modules'
  public APIs; tracked in `sync.sync_state`.
- **Publishes:** `OutboxItem.DeadLettered` → Audit + Notifications.

## Jobs (v1 core)

- **Owns:** `jobs.job_runs` — DB-backed queue (ADR-0010): (id, name, type,
  payload, status, scheduled_at, locked_by/at, attempts, max_attempts, error,
  actor, created/completed). Scheduler for cron-like tasks (NestJS scheduler in
  the worker).
- **Consumers (v1 set):** PDF rendering (Print), heavy Excel import apply
  batches, heavy report generation, outbox dispatch loop (Sync uses the same
  queue mechanics), future scheduled reconciliations.
- **API:** job list/detail/retry/cancel (admin permission), run history.
- **Publishes:** `Job.Failed` (after final attempt) → Notifications.

## Notifications (v1 core)

- **Owns:** `notifications.items` (in-app: user, type, title, body, link, status
  new/read/dismissed, created_at). Channel abstraction (email/SMS) is a later
  extension — channel choice is OQ-15 (product decision).
- **Consumes:** the cross-cutting events of other modules (import completed,
  print job finished, dead-letter, period closed, …) and maps them to
  user-facing notifications via per-module notification *rules* (template text
  lives in the Notifications module; *which events notify which users* is a
  per-module policy registered by each module).
- **API:** list my notifications, mark read, unread count.

---

## Event Catalog (initial v1 set)

> Naming: `Entity.PastTenseVerb` (PascalCase). This is the **initial** catalog;
> it grows with implementation. Event schemas are versioned; changing an existing
> event's field semantics requires an ADR (AR-29).

| Event | Publisher | Main consumers | Purpose |
|---|---|---|---|
| `UserSession.Created` / `UserSession.Revoked` / `Login.Failed` | Identity | Audit, (Notifications for lockout) | session lifecycle trail |
| `User.Created` / `User.Updated` / `User.Disabled` | Users | Audit, Identity (revoke sessions), Notifications | user lifecycle |
| `Role.Updated` / `UserRole.Assigned` / `UserRole.Removed` | RBAC | Audit, RBAC cache invalidation | permission changes |
| `InventoryReceipt.Created` | Inventory | **Accounting (journal)**, Audit, (Sync → outbox if configured) | stock in |
| `InventoryIssue.Created` | Inventory | **Accounting**, Audit | stock out |
| `StockTransfer.Created` / `StockAdjustment.Created` | Inventory | Accounting (adjustment), Audit | stock changes |
| `SalesOrder.Created` / `SalesOrder.Confirmed` | Sales | Audit, (Sync → outbox if configured) | sales flow |
| `Invoice.Issued` | Sales | **Accounting (revenue journal)**, Audit, (Sync → taxpayer/faraPayam outbox if configured) | billing |
| `JournalEntry.Posted` / `AccountingPeriod.Closed` | Accounting | Audit, Notifications | books |
| `ImportSession.Completed` / `ImportSession.Failed` | Excel | Notifications, Audit | import feedback |
| `PrintJob.Completed` / `PrintJob.Failed` | Print | Notifications, Audit | print feedback |
| `OutboxItem.DeadLettered` / `Integration.Failed` | Sync / Integration | Audit, Notifications (admins) | sync health |
| `Job.Failed` | Jobs | Notifications (admins) | job health |

**Outbox operations vs domain events:** an outbox *row* records an external
delivery operation (e.g. destination `faraPayam`, operation
`InventoryReceipt.Created`) and is written by the business module **inside its
own transaction** using the kernel outbox port — it is not "emitted to the Sync
module" at runtime. See `docs/integrations.md` and ADR-0004.
