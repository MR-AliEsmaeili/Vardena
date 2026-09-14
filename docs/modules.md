# Vardena — Module Catalog

Status: Accepted (foundation) · Updated: 2026-09-11

> **Domain foundation:** the domain model, configurability and workflow architecture
> are specified in [`architecture/domain/`](./architecture/domain/README.md)
> (blueprint + glossary + master-data/document/workflow/inventory/accounting docs).
> Proposed ADRs 0017–0020 are pending acceptance; nothing there is implemented yet.

This is the normative module catalog. Each entry defines: purpose, responsibilities
(including what the module is **not** responsible for), owned data (schema),
published/consumed events, and extension points. Adding a module = new folder per
`docs/architecture.md` §4 + a section here + an ADR (AR-29).

## Module Map

| Module | Status | One-line purpose | Owned schema(s) |
|---|---|---|---|
| Identity | v1 core | Authentication: login, sessions, password handling | `identity` |
| Users | v1 core | User records, profiles, enable/disable | `users` |
| Organization | structure + party master implemented (Task 6); configuration half pending | Organization structure (branches, departments, employees), party master, cross-module configuration (fiscal calendar → Accounting per ADR-0026, numbering → Documents, workflow → Workflow) | `organization` |
| RBAC | v1 core | Roles, granular permissions, assignments | `rbac` |
| Audit | v1 core | Append-only audit log of sensitive operations | `audit` |
| Notifications | v1 core | In-app notifications driven by events | `notifications` |
| Accounting | contract only (Task 10.1; ADR-0026 Proposed — nothing implemented) | Financial areas, fiscal years/periods, chart of accounts, accounting documents + lines, posting rules | `accounting` (planned) |
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

- **Owns:** `users.users` (username (unique), password hash, active flag, audit
  columns, `deleted_at` reserved for soft delete). Profile/email/display-name
  fields are later Users sessions; MFA hooks are reserved (OQ-06).
- **API (implemented):** `GET /users` (paginated, `isActive` filter), `GET
  /users/{id}`, `POST /users`, `PATCH /users/{id}` (username), `POST
  /users/{id}/enable|disable`, `POST /users/{id}/password-reset` (admin reset,
  204). No delete endpoint (OQ-18) and no self-service profile in v1.
- **Permissions (own registry, AR-22):** `Users.User.View|Create|Edit|Enable|
  Disable|ResetPassword`. There is no delete permission because there is no
  delete endpoint.
- **Publishes:** `User.Created`, `User.Updated`, `User.Enabled`, `User.Disabled`,
  `User.PasswordReset` (security-relevant lifecycle; the password itself is
  never in the payload).
- **Depends on:** RBAC (role assignments are managed by the RBAC module against
  user ids; administration endpoints require the permissions above), Identity
  (deactivated users' sessions are revoked via event).
- **Not responsible for:** login/session mechanics (Identity), permissions (RBAC).
- **Responses:** safe DTOs only (id, username, isActive, createdAt, updatedAt) —
  the password hash never leaves the module (AR-24).

## Organization (implemented — structure & party master data)

- **Status:** implemented in Task 6 for the organizational-structure and party half
  (ADR-0020, ADR-0021). The *configuration* half — fiscal calendar, numbering series,
  tax definitions, workflow definitions and custom-field definitions — is **not**
  implemented and still waits on ADR-0020 acceptance and the gate in
  [`architecture/domain/domain-blueprint.md`](./architecture/domain/domain-blueprint.md) §21.
  Three of those five have since moved out of this module: **numbering series** are
  implemented by the Documents foundation (ADR-0023), **workflow definitions/versions**
  by the Workflow foundation (ADR-0024), and the **fiscal calendar** (years, periods)
  is proposed to move to Accounting by
  [ADR-0026](./adr/0026-accounting-bounded-context.md) §2 (Proposed — see the
  Accounting entry). Tax definitions and custom-field definitions remain here, still
  unimplemented. The "Purpose" bullet below keeps the original ADR-0020 wording on
  purpose; this note is the correction of record (AG-17).
- **Owns (Task 6):** schema `organization` — `organizations`, `branches`, `departments`,
  `employees` (minimal reference data), `parties`. Every table carries `organization_id`
  (ADR-0021); business keys are unique per organization; lifecycle is `is_active` only.
- **API (implemented):** `/api/v1/{organizations,branches,departments,employees,parties}` —
  list (explicit `organizationId`, pagination, filtering, sorting), get, create, patch,
  `POST :id/enable`, `POST :id/disable`. **No DELETE**: master data is deactivated, not
  deleted (OQ-36).
- **Permissions:** `Organization.{Organization,Branch,Department,Employee,Party}` ×
  `{View,Create,Edit,Enable,Disable}` (25 codes), enforced in the application services,
  not only by the route guards.
- **Purpose:** own what is *organization-wide*: the organization structure (branches,
  departments, employees as minimal reference data), the **fiscal calendar** (years and
  periods), and **cross-module configuration** (numbering series, tax definitions,
  effective-dated settings, workflow definitions/versions, custom-field definitions).
  It also owns **party master data** (parties with customer/supplier capability flags,
  contacts, addresses, bank accounts) so one counterparty is one record
  (`architecture/domain/master-data-strategy.md` §5).
- **Why a module (and not the kernel):** configuration is business data; `kernel/` must
  stay technical (AR-06), and one owner gives consistent scoping, versioning and audit.
- **API (sketch):** read structure/configuration for other modules (public services
  only, AR-07); administer branches/departments/parties; manage numbering series, tax
  definitions, workflow versions and custom-field definitions (permission-gated, AR-21);
  publish workflow versions (draft → published, ADR-0018).
- **Publishes (implemented in Task 6):** `{Organization,Branch,Department,Employee,Party}`
  × `{Created,Updated,Enabled,Disabled}` — payload is `{id, organizationId, code}`
  (`{id, code}` for the organization root), plus `correlationId`/`occurredAt`. There is
  deliberately **no `*.Deleted`**: nothing is deleted.
- **Still planned (not implemented):** `NumberingSeries.Changed`,
  `WorkflowVersion.Published`, `TaxDefinition.Changed` — all with the configuration half.
- **Party shape in Task 6:** `code`, `display_name`, `legal_name?`, `party_type`
  (`person`|`organization`), `is_customer`, `is_supplier`, `email?`, `phone?`. At least one
  capability is required (422 otherwise). Contacts, addresses and bank accounts are
  **not** implemented — their shape and the Iranian legal identifiers are unresolved
  (OQ-30, OQ-38).
- **Employee shape in Task 6:** `employee_code`, `first_name`, `last_name`, optional
  `department_id` / `branch_id`. No link to `users.users` (OQ-37).
- **Not responsible for:** user accounts/auth (Identity/Users), roles/permissions
  (RBAC), commercial relationship data such as price lists and credit enforcement
  (Sales/Purchasing), and any operational document or ledger.

## RBAC (v1 core)

- **Owns:** `rbac.permissions` (mirror of the code registry), `rbac.roles`,
  `rbac.role_permissions`, `rbac.user_roles`.
- **Model:** fine-grained permissions named `Module.Entity.Action` (AR-22), e.g.
  `Inventory.Receipt.View|Create|Edit|Delete`. The **code registry is the source
  of truth**: each module registers its permissions in code; a sync step mirrors
  them into the DB for the admin UI. Roles are named sets of permissions; users
  hold roles.
- **API (implemented):** `GET /roles` (paginated), `GET /roles/{id}` (with its
  permissions), `POST /roles` (optionally with an initial permission set, written
  in one transaction), `PATCH /roles/{id}`; `POST /roles/{id}/permissions` +
  `DELETE /roles/{id}/permissions/{code}`; `POST /roles/{id}/users` + `DELETE
  /roles/{id}/users/{userId}`; `GET /permissions` (registry mirror);
  `GET /permissions/effective` (the caller's own codes — authenticated, no code
  declared, AR-21 exception). There is deliberately **no** permission
  create/update endpoint: permissions come from code (ADR-0006).
- **Permissions (own registry, AR-22):** `Rbac.Permission.View`, `Rbac.Role.View|
  Create|Edit`, `Rbac.RolePermission.Assign|Remove`, `Rbac.UserRole.Assign|
  Remove`. No `Rbac.Role.Delete` (OQ-20).
- **Authorization service (public):** `hasAllPermissions(userId, codes)`,
  `hasAnyPermission(userId, codes)`, `effectivePermissionCodes(userId)` and
  `requireAllPermissions(codes)` for application services. Evaluation reads the
  assignment tables on every request — **no cache in v1** (ADR-0016), so
  revocation is immediate; caching is an explicit revisit point with its
  invalidation contract.
- **Enforcement:** `AuthorizationGuard` + `@RequirePermission(...)` on the route
  (fail closed: an undeclared guarded route is a 500), re-checked in the
  application service; multiple codes on one route mean ALL of them; 401 when
  unauthenticated, 403 when authorized-but-not-permitted (ADR-0016).
- **Publishes:** `Role.Created`, `Role.Updated`, `RolePermission.Assigned`,
  `RolePermission.Removed`, `UserRole.Assigned`, `UserRole.Removed`.
- **Seed roles are a business decision (OQ-14)** — do not invent them; the first
  administrator's bootstrap procedure is OQ-19.
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

## Accounting (v1 core — **contract only, nothing implemented**)

- **Status:** no schema, no code, no API. Task 10.1 established the binding
  **Accounting Domain Contract** — [`accounting/domain-contract.md`](./accounting/domain-contract.md)
  (decisions `AC-D-01…AC-D-35`, invariants `AC-I-01…AC-I-22`, gates §28) — and
  [ADR-0026](./adr/0026-accounting-bounded-context.md) (**Proposed**, must be
  accepted before the first Accounting migration). The conceptual options record
  stays in [`architecture/domain/accounting-domain-analysis.md`](./architecture/domain/accounting-domain-analysis.md).
- **Owns (per ADR-0026):** financial areas (`حوزه مالی`), **fiscal years and
  accounting periods**, the coding structure and chart of accounts (one account
  tree, configurable levels), control-role mappings, detail dimensions/groups/items
  (floating details), accounting documents + lines + line dimension assignments,
  posting/finalization/correction, posting rules, the system-posting idempotency
  ledger and balance projections (rebuildable, never the source of truth).
- **Fiscal-calendar ownership moved here.** ADR-0020 §2 and the Organization entry
  below gave the fiscal calendar to Organization; ADR-0026 §2 assigns fiscal
  years/periods to Accounting (the module that enforces posting eligibility owns the
  state it depends on — AR-08), following the accepted precedent that numbering went
  to Documents (ADR-0023) and workflow definitions to Workflow (ADR-0024). Pending
  acceptance, the contradiction is recorded here rather than silently resolved
  (AG-17).
- **Consumes:** inventory/sales/purchasing/treasury facts **only** through the
  source-posting contract (contract §16.3: scope, financial area, source
  module/entity/id/operation, `operationKey`, business date, validated payload naming
  accounts **or control roles**) — never another module's tables (AR-07/AR-16).
  Event names it will consume are the source modules' own (ADR-0005).
- **API:** none yet. Planned surface follows the contract: financial areas, fiscal
  years/periods (+ close/reopen/seal), coding structure, accounts, dimensions/items,
  documents (+ finalize, reverse, correct, replace), ledger/balance inquiries through
  Accounting-owned views consumed by Reporting (ADR-0009).
- **Permissions:** none registered yet. The contract §22 vocabulary is granular
  (`Accounting.{FinancialArea,FiscalYear,AccountingPeriod,CodingStructure,Account,
  ControlRole,DetailDimension,DetailItem,Document,PostingRule,YearTransition,Balance,
  SystemPosting}.*`) — no wildcard, no `Accounting.Journal.Create`-style catch-all,
  and `Finalize` ≠ `Approve` (OQ-21, OQ-14).
- **Publishes (planned, refines the catalog rows below):**
  `AccountingDocument.{Created,Updated,Finalized,Deleted,Reversed,Corrected,Replaced}`,
  `FiscalYear.{Created,Closed,Reopened,Sealed,Unsealed}`,
  `AccountingPeriod.{Opened,Closed,Reopened,Sealed}`,
  `FinancialArea.*`, `Account.*`, `DetailDimension.*`, `DetailItem.*`,
  `AccountingYearTransition.Executed`, `AccountingPosting.Rejected` — on the existing
  kernel bus (contract §21). The placeholders `JournalEntry.Posted` /
  `AccountingPeriod.Closed` in the event catalog are superseded by these names when
  the module ships.
- **Rules (contract invariants, not policy):** Σ debit = Σ credit exactly with ≥2
  lines (AC-I-07/08); `final` documents are structurally immutable and never deleted
  (AC-I-05/06); corrections are new counter-documents — reversal / correction /
  replacement / adjustment (AC-I-15); only postable leaf accounts receive lines
  (AC-I-09); closed/sealed periods and years reject posting (AC-I-04); system posting
  is idempotent through an Accounting-owned operation ledger (AC-I-12); organization
  scoping and the 404-not-403 posture are inherited unchanged (AC-I-01/16,
  ADR-0021/0022/0025). Policy — period/close/reopen rules, coding scheme, posting
  eligibility defaults, dimension requiredness, correction windows, numbering year
  components, currency, valuation mappings — stays open: OQ-03/11/12/23/24/25/27/30/31
  and the new OQ-39…OQ-43.
- **Not responsible for:** knowing *why* inventory moved (Inventory's business),
  stock quantities or valuation quantities (ADR-0022), pricing/discounts (Sales),
  tax computation (OQ-30), numbering mechanics (Documents — ADR-0023), workflow
  mechanics (Workflow — ADR-0024), audit storage (Audit — AR-23), organization
  structure or party master data (Organization).

## Inventory (v1 core)

- **Status:** the **master-data half is implemented** (Task 6): schema `inventory` —
  `units`, `unit_conversions`, `item_unit_conversions`, `item_groups`, `items`,
  `warehouses`. The transactional half below (movements, balances, reservations,
  valuation) is **not implemented** and waits on ADR-0017.
- **API (implemented):** `/api/v1/inventory/{items,item-groups,units,unit-conversions,warehouses}`.
  Unit conversions are the exception: **no PATCH and no enable/disable**, because
  effective-dated configuration is never edited in place — a change is a new version
  (`GET .../unit-conversions/resolve` answers "which version applies at instant X").
- **Permissions:** `Inventory.{Item,ItemGroup,Unit,Warehouse}` ×
  `{View,Create,Edit,Enable,Disable}` (20) plus `Inventory.UnitConversion.{View,Create}`
  (2) — 22 codes, enforced in the application services.
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

- **Owns:** customers*, quotes, sales orders, invoices, returns.
  \* Party (customer/supplier) *master data* moves to the **Organization** module
  when [ADR-0020](./adr/0020-organizational-scope-and-master-data.md) is accepted; Sales then owns
  the commercial relationship (price lists, credit policy, sales documents) referencing
  `party_id`. See [`architecture/domain/master-data-strategy.md`](./architecture/domain/master-data-strategy.md) §5.
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

- **Purpose (when scoped):** suppliers (same party-master note as Sales — pending
  ADR-0020), purchase orders, supplier invoices; purchase → inventory receipt flow.
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
| `User.Created` / `User.Updated` / `User.Enabled` / `User.Disabled` / `User.PasswordReset` | Users | Audit, Identity (revoke sessions on disable/reset), Notifications | user lifecycle |
| `Role.Created` / `Role.Updated` / `RolePermission.Assigned` / `RolePermission.Removed` / `UserRole.Assigned` / `UserRole.Removed` | RBAC | Audit, UI refetch of effective permissions | permission changes (no server-side cache to invalidate — ADR-0016) |
| `Organization.Created` / `Organization.Updated` / `Organization.Enabled` / `Organization.Disabled` | Organization | Audit | organization root lifecycle (implemented, Task 6) |
| `Branch.*` / `Department.*` / `Employee.*` / `Party.*` (`Created` / `Updated` / `Enabled` / `Disabled`) | Organization | Audit | organization-structure and party master-data lifecycle (implemented, Task 6) |
| `Item.*` / `ItemGroup.*` / `Unit.*` / `Warehouse.*` (`Created` / `Updated` / `Enabled` / `Disabled`) | Inventory | Audit | inventory master-data lifecycle (implemented, Task 6) |
| `UnitConversion.Created` | Inventory | Audit | a new effective-dated conversion version (payload carries `supersededConversionId`); **no update/disable event exists** — versions are never edited in place |
| `InventoryReceipt.Created` | Inventory | **Accounting (journal)**, Audit, (Sync → outbox if configured) | stock in |
| `InventoryIssue.Created` | Inventory | **Accounting**, Audit | stock out |
| `StockTransfer.Created` / `StockAdjustment.Created` | Inventory | Accounting (adjustment), Audit | stock changes |
| `SalesOrder.Created` / `SalesOrder.Confirmed` | Sales | Audit, (Sync → outbox if configured) | sales flow |
| `Invoice.Issued` | Sales | **Accounting (revenue journal)**, Audit, (Sync → taxpayer/faraPayam outbox if configured) | billing |
| `JournalEntry.Posted` / `AccountingPeriod.Closed` *(placeholders — refined by the Accounting Domain Contract §21 into `AccountingDocument.*`, `FiscalYear.*`, `AccountingPeriod.*` when the module ships)* | Accounting | Audit, Notifications | books |
| `ImportSession.Completed` / `ImportSession.Failed` | Excel | Notifications, Audit | import feedback |
| `PrintJob.Completed` / `PrintJob.Failed` | Print | Notifications, Audit | print feedback |
| `OutboxItem.DeadLettered` / `Integration.Failed` | Sync / Integration | Audit, Notifications (admins) | sync health |
| `Job.Failed` | Jobs | Notifications (admins) | job health |

> **Payload convention for the Task 6 master-data events:** `{id, organizationId,
> code}` (the organization root uses `{id, code}`), plus `correlationId` and
> `occurredAt`. `UnitConversion.Created` additionally carries `itemId`,
> `fromUnitId`, `toUnitId`, `factor`, `validFrom` and `supersededConversionId`.
> None of them is a `*.Deleted` event: master data is deactivated, never deleted
> (OQ-36).

**Outbox operations vs domain events:** an outbox *row* records an external
delivery operation (e.g. destination `faraPayam`, operation
`InventoryReceipt.Created`) and is written by the business module **inside its
own transaction** using the kernel outbox port — it is not "emitted to the Sync
module" at runtime. See `docs/integrations.md` and ADR-0004.
