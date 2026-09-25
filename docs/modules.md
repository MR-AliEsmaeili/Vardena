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

| Module        | Status                                                                                                                                                                                                                  | One-line purpose                                                                                                                                                                            | Owned schema(s) |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Identity      | v1 core                                                                                                                                                                                                                 | Authentication: login, sessions, password handling                                                                                                                                          | `identity`      |
| Users         | v1 core                                                                                                                                                                                                                 | User records, profiles, enable/disable                                                                                                                                                      | `users`         |
| Organization  | structure + party master implemented (Task 6); configuration half pending                                                                                                                                               | Organization structure (branches, departments, employees), party master, cross-module configuration (fiscal calendar → Accounting per ADR-0026, numbering → Documents, workflow → Workflow) | `organization`  |
| RBAC          | v1 core                                                                                                                                                                                                                 | Roles, granular permissions, assignments                                                                                                                                                    | `rbac`          |
| Audit         | v1 core                                                                                                                                                                                                                 | Append-only audit log of sensitive operations                                                                                                                                               | `audit`         |
| Notifications | v1 core                                                                                                                                                                                                                 | In-app notifications driven by events                                                                                                                                                       | `notifications` |
| Accounting    | foundation + chart + configuration + documents + ledger implemented (Tasks 10.2, 10.3, 10.4, 10.7, 10.8, 11 — **Task 11 ACCEPTED 2026-09-22**; ADR-0026 Accepted); posting rules / corrections contract-only; **balances READY FOR REVIEW as Task 12 (ADR-0031 Proposed, not Accepted)**; **ledger movement read source ACCEPTED as Task 17A (2026-09-25, PR #39); account statement read surface ACCEPTED as Task 17B (2026-09-25, PR #43 merged in `b10e007`)** | Financial areas, fiscal years/periods, coding structure, accounting configurations, chart of accounts, accounting documents + lines, ledger entries (+ the read-only movement source and account statement), balance projection (READY FOR REVIEW), posting rules                          | `accounting`    |
| Inventory     | v1 core                                                                                                                                                                                                                 | Items, warehouses, stock, receipts/issues/transfers/adjustments                                                                                                                             | `inventory`     |
| Sales         | v1 core                                                                                                                                                                                                                 | Customers, quotes, sales orders, invoices, returns                                                                                                                                          | `sales`         |
| Purchasing    | planned                                                                                                                                                                                                                 | Suppliers, purchase orders, supplier invoices                                                                                                                                               | `purchasing`    |
| Reporting     | v1 core                                                                                                                                                                                                                 | Report registry, query pipeline, dashboards                                                                                                                                                 | (none in v1)    |
| Excel         | v1 core                                                                                                                                                                                                                 | Import engine (validated workflow) + export engine                                                                                                                                          | `excel`         |
| Print         | v1 core                                                                                                                                                                                                                 | Document templates, rendering, PDF jobs                                                                                                                                                     | `print`         |
| Customization | v1 core                                                                                                                                                                                                                 | User preferences (UI, dashboards, filters, print, report)                                                                                                                                   | `customization` |
| Integration   | v1 core                                                                                                                                                                                                                 | External system adapters + credentials + sync state                                                                                                                                         | `integration`   |
| Sync          | v1 core                                                                                                                                                                                                                 | Outbox + dispatch policies, retry, dead-letter, admin controls                                                                                                                              | `sync`          |
| Jobs          | v1 core                                                                                                                                                                                                                 | DB-backed job queue + scheduler                                                                                                                                                             | `jobs`          |

**Purchasing** is marked _planned_ because the product requirements imply it
(purchase → inventory receipt → accounting journal entry) but do not place it in
the initial scope explicitly. See OQ-16. Until it exists, purchase-driven stock
inflows can be entered as manual inventory receipts.

## Horizontal vs Vertical Modules

- **Vertical modules** own a business domain: Identity, Users, RBAC, Accounting,
  Inventory, Sales, Purchasing.
- **Horizontal modules** provide capabilities to vertical modules through
  **extension points** — they are _served by_ vertical modules, never the owner of
  vertical data:
  - **Reporting** consumes `reports/` definitions + module-owned views.
  - **Excel** consumes `imports/` ImportSpecs (import) and Reporting's pipeline
    (export).
  - **Print** consumes `documents/` providers (data shape per document type).
  - **Customization** stores preferences that other features read
    (grid columns, dashboards, print prefs, report prefs).
  - **Audit**, **Notifications**, **Sync** are event _subscribers_ to everything.

Rule: a horizontal module must never own vertical data or encode vertical business
rules; it defines the _mechanism_, vertical modules provide the _content_
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
  (ADR-0020, ADR-0021). The _configuration_ half — fiscal calendar, numbering series,
  tax definitions, workflow definitions and custom-field definitions — is **not**
  implemented and still waits on ADR-0020 acceptance and the gate in
  [`architecture/domain/domain-blueprint.md`](./architecture/domain/domain-blueprint.md) §21.
  Three of those five have since moved out of this module: **numbering series** are
  implemented by the Documents foundation (ADR-0023), **workflow definitions/versions**
  by the Workflow foundation (ADR-0024), and the **fiscal calendar** (financial
  areas, years, periods) **moved to Accounting**: [ADR-0026](./adr/0026-accounting-bounded-context.md)
  §2 is **Accepted** (2026-09-14) and Task 10.2 implemented the foundation there —
  see the Accounting entry. Tax definitions and custom-field definitions remain
  here, still unimplemented. The "Purpose" bullet below keeps the original ADR-0020 wording on
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
- **Purpose:** own what is _organization-wide_: the organization structure (branches,
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
- **Not responsible for:** deciding _where_ checks happen (that's every module's
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

## Accounting (v1 core — **foundation + chart + configuration + documents + ledger implemented (Tasks 10.2, 10.3, 10.4, 10.7, 10.8, 11 — Task 11 ACCEPTED 2026-09-22)**; posting rules / corrections still contract-only; **balances READY FOR REVIEW as Task 12 (not Accepted)**)

- **Status:** Task 10.2 implemented the **bookkeeping scope** — financial areas,
  fiscal years, accounting periods (contract §4/§5/§6/§7, AC-D-01…AC-D-05,
  AC-I-01/03/04/16): schema `accounting` (`20260914000000_accounting_foundation`),
  guarded repositories, application services, HTTP API, 17 registered permissions.
  Task 10.3 added the **coding structure + chart of accounts** (contract §8/§9/§14,
  AC-D-06…AC-D-10, AC-D-19, AC-I-10/11):
  `accounting.coding_structure_versions` / `_levels` / `accounts`
  (`20260914010000_accounting_coding_structure_accounts`), 7 more permissions
  (24 total) and `Account.{Created,Updated,Enabled,Disabled}` events.
  Task 10.4 added the **accounting document aggregate** — the voucher header +
  lines with the `draft → temporary → final` lifecycle (contract §12…§18,
  AC-D-16…AC-D-23): `accounting.accounting_documents` /
  `accounting_document_lines` / `accounting_posting_operations`
  (`20260915000000_accounting_documents`), 5 document permissions (29 total)
  and `AccountingDocument.{Created,Updated,Finalized,Deleted}` events.
  Task 10.6 defined the **posting & ledger contracts** (`domain/posting.ts`,
  `domain/ledger-entry.ts` — pure, framework-free, no persistence) and Task 10.7
  persists them: **finalization atomically materializes one immutable ledger
  entry per stored line** (`accounting.ledger_entries`,
  `20260916000000_accounting_ledger`; `final` = posted, no separate state, no
  endpoint, no new permission).
  Task 11 — **ACCEPTED 2026-09-22** (PR #25, remediated 2026-09-22, defect-resolution PR #29 `docs/task-11-defect-resolution-report.md`, CI `35755493453`/`35755917087` success) added the **accounting configuration
  foundation** (D1–D7): `accounting.accounting_configurations` /
  `accounting_configuration_levels` (`20260920000000_accounting_configuration_foundation`),
  DRAFT → ACTIVE → SUPERSEDED with exactly one ACTIVE per organization (row
  locks primary, the partial unique index `uq_accounting_configurations_org_active`
  as the DB backstop), `accounts.accounting_configuration_id` NOT NULL as the
  sole configuration scope (D1) beside the untouched code-shape pin
  `coding_structure_version_id` (D2), a LEGACY configuration backfilled per
  organization that had accounts but no ACTIVE configuration, and 2 permissions
  (31 total). Root creation and moves validate **only** against the account's
  own configuration/version pair, re-checked under lock at the write boundary;
  the operational-freeze abstraction existed without a caller (D4 — decision
  note + OQ-64) and is **wired by Task 13**, below. The populated pre-Task-11 backfill is
  verified by `npm run test:migration-rehearsal`
  (`backend/prisma/rehearsal/task-11-configuration-foundation/`). Preserved explicitly: **OQ-62: OPEN** (pin compatibility requires future Product + Architecture decision), **OQ-63: OPEN** (legacy fallback shape), **OQ-64: **RESOLVED 2026-09-23** by Task 13 (operational freeze wired into finalization), **G7: ACCEPTED RISK** (raw-SQL partial index `uq_accounting_configurations_org_active` guarded by live `pg_indexes` verification and migration rehearsal).
  Task 13 — **IN PROGRESS (self-review, 2026-09-23)**, branch
  `arena/01a0cd89-vardena`, report `docs/task-13-implementation-report.md` —
  wired the operational freeze (D4). `AccountingDocumentsRepository.finalizeChecked`
  now marks `accounting.accounting_configurations.operationally_used_at` with
  ONE guarded statement per DISTINCT configuration pinned by the voucher's lines
  (`data/accounting-configuration-usage.ts`, the column's only writer, whose
  resolution rule lives in the domain file): inside the finalization transaction,
  after the line accounts are resolved from the stored lines and BEFORE they are
  locked `FOR SHARE` — the module's existing configuration position of the global
  lock order, recorded as row `D4″` of `docs/accounting/lock-order-matrix.md`, so
  no new position is added and the chart's configuration-before-account order
  (A1/A5) is preserved (the inverted order deadlocks; demonstrated by
  `backend/prisma/rehearsal/task-13-operational-freeze/rehearse.mjs`).
  Semantics, all three decided in Task 11's note §5/§6 and now in code:
  **first use wins** (`WHERE … operationally_used_at IS NULL`, so a concurrent
  finalizer waits on the row lock, re-evaluates against the committed row and
  updates nothing, and a replay cannot move the timestamp); **atomicity** (a
  rejected validation or a failed ledger insert rolls the mark back, and an
  unresolvable account→configuration pin aborts finalization with the typed
  `ConfigurationUsageReferenceError` BEFORE the first write — a voucher is never
  `final` while its configuration reads as unused); **mixed vouchers freeze every
  configuration they touched**, including a `SUPERSEDED` pin, which is what makes
  "no edit/delete of a used version" true. Chart work is not use: account
  creation, enable and disable mark nothing (a chart row is not a business
  effect), and a `pending`/`temporary` voucher freezes nothing. No migration, no
  endpoint, no permission, no event, no status; `AccountingConfigurationsService.markOperationallyUsed`
  keeps its no-endpoint design and is now organization-scoped + first-use-wins,
  delegating to the same statement. Known limitation: usage predating this change
  is not backfilled (a data-only migration was rejected as an unaudited business
  effect) — the repair statement is in the report §9.
  [ADR-0026](./adr/0026-accounting-bounded-context.md) is **Accepted** (2026-09-14).
  Still contract-only past the ledger: control roles, detail dimensions,
  posting rules, correction/reversal mechanisms and balance projections. The binding contract stays
  [`accounting/domain-contract.md`](./accounting/domain-contract.md) (decisions
  `AC-D-01…AC-D-35`, invariants `AC-I-01…AC-I-22`, gates §28); the conceptual
  options record stays in
  [`architecture/domain/accounting-domain-analysis.md`](./architecture/domain/accounting-domain-analysis.md).
  The authoritative task sequence, candidate map and OQ gates live in
  [`accounting/task-index.md`](./accounting/task-index.md) (Task 10.9: not formally defined).
- **Owns (Tasks 10.2 + 10.3 + 11):** schema `accounting` — `financial_areas`,
  `fiscal_years`, `accounting_periods`, `coding_structure_versions`,
  `coding_structure_levels`, `accounting_configurations`,
  `accounting_configuration_levels`, `accounts`. Every table carries `organization_id`
  (ADR-0021, FK RESTRICT; cross-schema FK direction strictly Accounting →
  Organization);
  business keys are unique per scope (area code per organization; year code per
  (organization, area); period sequence per year; account code per organization;
  structure ordinal per (organization, code, version number); one level row per
  version+ordinal); non-overlap and containment hold under concurrency via
  area → year → period `SELECT … FOR UPDATE` transactions, and the chart via
  coding-structure-version → account locks (publish locks every version row of
  the organization ascending by id; a child create locks its parent row; a move
  locks node + new parent ascending; a postability flip locks the node and counts
  children under that lock). Lock order is never reversed, and this is
  documentation the concurrency-critical raw SQL depends on (AR-11,
  `data/accounting-locks.ts`). None of it is an exclusion constraint or a
  trigger — the migration headers record why (`btree_gist` + Prisma-invisible
  drift hazard: a generated migration would drop them and silently lose the
  invariant).
  The chart is **one account table** (`parent_id` adjacency + integer `level`,
  AC-D-07) — no `groups`/`generals`/`subsidiaries`/`details` tables, because
  depth is configuration; the coding structure is **versioned**
  (`draft → active → superseded`, exactly one active version per organization,
  §9.4, ADR-0024 §3 shape) with its levels stored as rows of the VERSION, so a
  later structure change never reinterprets an existing code; accounts pin
  `coding_structure_version_id` (AC-I-14). Lifecycle is `is_active` plus
  `status` (`open|closed|sealed`); periods carry no `is_active` (contract §7.1).
  **No DELETE**: nothing is deleted (OQ-36) — the one exception is a coding
  structure _draft_'s level rows, replaced atomically as unreferenced
  configuration workspace (ADR-0024's draft rule).
- **Owns (Tasks 10.4 + 10.7):** `accounting_documents` (the voucher header:
  stored scope, `draft|temporary|final` phase, numeric-only serial per
  (organization, area), origin + logical source identity, finalization
  evidence), `accounting_document_lines` (dense 1-based `line_no`, postable
  account, `numeric(18,2)` debit/credit, exactly one side non-zero),
  `accounting_posting_operations` (the `(organization_id, operation_key)`
  idempotency ledger, written LAST inside the effect's transaction) and
  `ledger_entries` (one immutable row per posted line, written inside
  `finalizeChecked` between the state update and the operation row). Backstops:
  unique number per (organization, area), unique `line_no` per document,
  unique operation key per organization, and the 1:1
  `uq_ledger_entries_voucher_line_id` — a second entry for one line is
  impossible to persist. All ledger FKs (voucher, line, account, scope,
  branch) are RESTRICT: a posted row can never disappear. Lock order is
  unchanged (area → year → period → accounts `FOR SHARE` → document); the
  materialization adds no lock — fresh INSERTs under the held document lock
  cannot deadlock (`data/accounting-locks.ts`, AR-11).
- **Owns (per ADR-0026, still to build):** control-role mappings, detail
  dimensions/groups/items (floating details) + line dimension assignments,
  posting rules, correction/reversal mechanisms and balance projections
  (rebuildable, never the source of truth). **Deferred with the seam recorded, not invented
  now** (AR-29): per-account financial-area applicability (§8.3 — the chart is
  organization-scoped per AC-D-04 and area applicability has no consumer before
  posting validation exists; if OQ-40 resolves to per-area charts, uniqueness
  widens additively to `(organization_id, financial_area_id, code)`),
  `account_type`/`is_temporary` and the control-role list (§8.3/§8.7, OQ-25),
  coding-structure `reserved_ranges` (§9.1, OQ-25), and the
  `path` tree projection (§8.2 — belongs with the reporting task that reads it).
- **Usage seam for AC-I-11:** "immutable once the account is referenced by a
  document line" is decided by `isReferencedByDocumentLine`
  (`accounting/domain/account.ts`) — one call site, no usage table, no `used_at`
  column (Task 10.3 forbids inventing the mechanism the posting task owns). The
  rule itself is implemented and unit-tested in the domain layer; `code`
  immutability is already absolute (§8.3: no `code` field exists on the update
  path, and codes are never reused).
- **Posting readiness seam (Task 10.5):** an INTERNAL (non-HTTP, non-exported)
  application contract between the finalized voucher and the future Posting
  Engine: `PostingReadinessService.evaluateReadiness(organizationId,
documentId)` assembles a read-only snapshot (document + lines + stored
  area/year/period + referenced accounts, by stored ids, no locks) and
  delegates to the pure decision table `domain/posting-readiness.ts`, which
  reuses `checkVoucherLines`/`checkOriginEvidence` verbatim. The verdict is
  `ready | not_ready` with machine-readable reasons reusing the module's
  problem vocabularies (`document_not_final`, `document_not_numbered`,
  `missing_description`, the §13 line problems, `account_not_found`/
  `account_not_postable`, `scope_unresolvable` with the area/year/period
  scope). Deliberate NON-criteria, per contract: calendar statuses and account
  activity (§7.2 rule 7, §8.6 — a period closed, a year sealed or an account
  disabled after finalization leaves the voucher ready); dimension
  requiredness (OQ-41), area applicability (OQ-40), approval/posting mode
  (OQ-42) and delivery durability (OQ-39) remain open and are recorded as
  seams in the domain file. Read-only by construction: no numbering, no
  idempotency ledger, no events, no state — a `ready` verdict on a final
  voucher is stable, and the future engine still re-validates inside its own
  transaction (ADR-0022 posture, `data/accounting-locks.ts` order unchanged).
  No permission code and no endpoint exist for it (AR-21 binds endpoints;
  the calling operation authorizes — the `requireUsable*` precedent).
- **Posting orchestration seam (Task 10.8):** ONE application use case,
  `PostingService.postVoucher({ organizationId, voucherId, operationKey })`
  (`accounting/application/posting.service.ts`), is the boundary every caller
  reaches posting through — `AccountingDocumentsService.finalizeDocument` is
  now its HTTP-facing shell (authorize → delegate → map the outcome and the
  guard errors), so no caller re-assembles the posting sequence. The seam
  coordinates and nothing else: resolve in scope (404, AC-I-01/16) →
  idempotency replay-or-reject on the EXISTING `(organization_id,
operation_key)` + `request_hash` identity of the `document_finalize` kind
  (§16.4: same key + same hash replays by re-reading current rows, same key +
  different hash is a 409 that mutates nothing — no second key scheme, no
  `ledger-post-*` pattern) → the Foundation's lifecycle verdict
  (`planVoucherFinalize`) → **Task 10.7's ONE atomic transaction, unwrapped**
  (`finalizeChecked`: the module's fixed lock order, the in-transaction
  re-validation, **the Task 14 period-lifecycle gate first — the locked
  period/year status is judged immediately after the scope locks, before the
  usage marker, the account/projection locks and any write (row `D4‴` of the
  lock-order matrix) — the Task 13 usage marker at the configuration position,
  `state = final`, N immutable ledger entries, the operation row LAST) → `AccountingDocument.Finalized` (still the posting evidence,
  AC-D-20) → the Task 10.5 readiness verdict on the FINAL voucher → a
  `PostingResult` (Task 10.6) assembled from the STORED entries, with
  one-entry-per-line and the whole sourcing snapshot re-checked against the
  voucher. It opens no transaction, takes no lock, writes no row of its own,
  and adds no endpoint, no permission, no event, no table and no state. There
  is deliberately **no Posting Engine** behind it: no posting rules, no account
  mapping, no control roles, no dimensions, no balances/reports, no
  correction/reversal, no source-module trigger, no outbox/queue/worker — and
  OQ-39…OQ-43 stay open (a cross-module caller would need §16.3 plus OQ-39's
  delivery decision first, so the seam is provided, not exported, AR-07).
- **Fiscal-calendar ownership moved here.** ADR-0020 §2 and the Organization entry
  gave the fiscal calendar to Organization; ADR-0026 §2 assigns financial areas,
  fiscal years and periods to Accounting (the module that enforces posting
  eligibility owns the state it depends on — AR-08), following the accepted
  precedent that numbering went to Documents (ADR-0023) and workflow definitions
  to Workflow (ADR-0024). Accepted 2026-09-14 and implemented by Task 10.2, so
  this paragraph is now history, kept for the trail (AG-17).
- **Consumes:** inventory/sales/purchasing/treasury facts **only** through the
  source-posting contract (contract §16.3: scope, financial area, source
  module/entity/id/operation, `operationKey`, business date, validated payload naming
  accounts **or control roles**) — never another module's tables (AR-07/AR-16).
  Event names it will consume are the source modules' own (ADR-0005).
- **API (implemented):** `/api/v1/{financial-areas,fiscal-years,accounting-periods}` —
  list (mandatory `organizationId`, pagination, filtering, sorting), get, create,
  patch (areas/years only — periods have no `Edit` code, so no update endpoint),
  transitions as `POST :id/{close, reopen, seal, unseal}` with a mandatory `reason`
  (years support all four; periods support close/reopen/seal). Year close cascades
  onto its open periods in the same transaction; seal requires every period closed
  (fail closed, OQ-23); a sealed year gates period close/reopen. **No DELETE.**
  **Task 14:** the lifecycle is enforced inside the finalization transaction (a
  `closed`/`sealed` period refuses a new finalization with
  `422 businessRule` `{scope, status}` before any write), and the two backward moves
  the contract explicitly permits — `CLOSED → OPEN` and `SEALED → OPEN` after the
  audited year `unseal` — remain reachable **only** through this endpoint, with their
  own permission, mandatory reason and audit event. No force-close, no wildcard bypass,
  no endpoint accepting an arbitrary target status (ADR-0032).
- **API (Task 10.3):**
  `/api/v1/coding-structures` — `GET` list of versions (mandatory
  `organizationId`, optional `code`/`status`/`search`), `GET /active`
  (the organization's active version), `GET :id`, `POST` (draft a version with
  its levels), `PATCH :id` (reconfigure while `draft` only),
  `POST :id/publish` (validate + activate + supersede the previous active one).
  `/api/v1/accounts` — `GET` list (mandatory `organizationId`; `parentId`,
  `level`, `isActive`, `isPostable`, `codingStructureVersionId`, `search`),
  `GET :id`, `POST`, `PATCH :id` (title, nature, postability, re-parent),
  `POST :id/enable`, `POST :id/disable`. No DELETE, no tree endpoint (the
  chart-of-accounts/tree reads are reporting projections, contract §19.1), no
  per-level routes, and no code-editing route: `level` and
  `codingStructureVersionId` are derived by the server, `code` is immutable.
- **API (Task 10.4):** `/api/v1/accounting-documents` — `GET` list (mandatory
  `organizationId`; `financialAreaId`, `fiscalYearId`, `accountingPeriodId`,
  `state`, `origin`, `branchId`, `documentNumber`, `dateFrom`/`dateTo`,
  `search`), `GET :id`, `POST`
  (compose a draft, or an issued `temporary` voucher when the organization
  asks for no draft phase), `PATCH :id` (edit while pre-final; the area is
  frozen at issuance), `POST :id/issue` (allocate the serial, idempotent
  replay), `POST :id/finalize` (the single act that posts — Task 10.7
  materializes the ledger entries inside it; since Task 10.8 the route is the
  HTTP shell of `PostingService`, and there is still no `POST :id/post`),
  `DELETE :id` (discard
  pre-final only; `final` is never deletable). No correction, reversal,
  reopen, approval or reporting route.
- **API (Task 11):** `/api/v1/accounting-configurations` — `GET` list
  (mandatory `organizationId`; `code`/`status`/`search`, pagination, sorting),
  `GET /active` (the organization's ACTIVE configuration with its levels),
  `GET :id`, `POST` (draft a version with its levels), `PATCH :id` (edit while
  `DRAFT` and never operationally used), `POST :id/publish` (validate, activate,
  supersede the previous ACTIVE one in one transaction), `DELETE :id` (only a
  `DRAFT` that was never operationally used; the database additionally refuses a
  delete of any configuration an account references — FK RESTRICT). Accounts expose the
  pinned `accountingConfigurationId`; neither pin is editable through the API
  (both are derived server-side).
- **API (Task 17A):** `/api/v1/accounting/ledger-movements` — `GET` ONLY (one
  method, no mutation route anywhere): the Accounting-owned, read-only source of
  POSTED ledger movements, built for the future account-ledger / general-ledger /
  subsidiary-ledger / account-movement inquiries and the balance-oriented reads
  that precede a trial balance. One row per immutable `ledger_entries` row —
  no join, no aggregation, no projection, no second truth, no new table and no
  migration. Mandatory `organizationId` (deployment-pin asserted, then resolved
  through `OrganizationsService.requireUsableOrganization`: 404 for a foreign or
  unknown organization, never 403) plus optional `financialAreaId`,
  `fiscalYearId`, `accountingPeriodId`, `accountId`, `voucherId`,
  `voucherNumber`, `dateFrom`/`dateTo` (inclusive business-date bounds) and the
  shared `page`/`pageSize`/`sort` conventions, with the sort allow-listed to
  `documentDate`/`postingTimestamp` and always completed by stable tie-breakers
  (serial, line ordinal, unique entry id). Amounts cross the wire as exact
  decimal STRINGS. Deliberately absent — and not to be inferred later without
  their own authority: a `status` filter (no such column exists; drafts and
  temporary vouchers have NO ledger rows, so the source is posted-only by
  construction), currency/FX, branch filters, account code/title or hierarchy
  joins, groupings/subtotals, statement layouts, exports and any trial-balance
  or book-configuration semantics (OQ-03/23/25/43). Permission:
  `Accounting.LedgerMovement.View` (NEW, read-only; `Accounting.Balance.View`
  governs the rebuildable projection and `Accounting.Document.View` the voucher
  aggregate — neither means the ledger). Tests: `ledger-movements.service.spec.ts`
  (authorization, scope, filters, order, exactness), `accounting-ledger-movements.e2e-spec.ts`
  (HTTP: 401/403, posted-only, tenant isolation, filters, paging, validation, no
  mutation route, deployment pin) and the live suite `ledger-movements-live.e2e-spec.ts`
  (real PostgreSQL: posted-only, organization isolation, inclusive date bounds,
  stable paging, `numeric(18,2)` exactness).
- **API (Task 17B):** `/api/v1/accounting/account-statements` — `GET` ONLY (one
  method; no POST/PUT/PATCH/DELETE exists and no statement is ever persisted):
  the bounded, read-only account statement for ONE postable account of ONE
  fiscal year plus an optional accounting period — the canonical
  account-movement calculation («این حساب چه گردشی داشته است؟») over the same
  immutable `ledger_entries` the movement source exposes. Response = scope echo
  (account code/title — never a nature/classification), opening, movement rows
  (document date, posting timestamp, voucher number, line no, description,
  debit, credit, net, running balance, source-document traceability) and totals
  (opening / Σ debit / Σ credit / net / closing), with the disclosures
  `signConvention: debit-positive` (`net = debit − credit`,
  `closing = opening + net`), `openingBasis: intra-fiscal-year`
  (sequence-based; a whole-year statement opens at `0` and NO prior-year
  carry-forward exists — ADR-0031 §4/§9) and the fixed order
  `documentDate,voucherNumber,lineNo,id`. Exact decimal STRINGS throughout;
  totals are computed over the whole window (page-independent); the running
  balance continues across pages. Query surface is exactly
  `organizationId`/`accountId`/`fiscalYearId` + optional
  `accountingPeriodId`/`financialAreaId` + `page`/`pageSize` — no client sort
  (400), no date window, no status filter (open/closed/sealed periods are all
  READABLE and reading never changes status), no exports. Scope keys resolve
  organization-first: foreign/unknown ids → 404 (never 403), non-postable
  account / period of another year / area ≠ the year's area / disabled
  organization → 422. Window reads run in ONE `REPEATABLE READ` read-only
  transaction (count + window sums + prior-sequence opening sums + pre-page
  nets + page). Permission: `Accounting.AccountStatement.View` (NEW 36th
  code, decision D6 — independent of `Accounting.LedgerMovement.View` and
  `Accounting.Balance.View`, enforced in the service on top of the route
  guard). Tests: `account-statement.spec.ts` (statement math, Decimal
  exactness), `account-statements.service.spec.ts` (authorization, 404/422
  matrix, opening/running/totals, read-only surface lock),
  `accounting-account-statements.e2e-spec.ts` (HTTP envelope, running balance
  across pages, period openings incl. sequence gaps, no carry-forward, org
  isolation, statuses readable/no-mutation, whitelist 400s, deployment pin)
  and `account-statements-live.e2e-spec.ts` (real PostgreSQL: reversal pair
  nets zero, reconciliation against `vw_account_balance_derived`, misaligned
  sequence-vs-calendar fixture, no-mutation incl. `account_balance_projections`).
- **API (still planned):** dimensions/items, document corrections
  (reverse, correct, replace), the remaining ledger/trial-balance/movement report
  shapes through Accounting-owned views consumed by the Reporting module
  (ADR-0009), report layouts and exports. The posted movement SOURCE exists
  (Task 17A, above) and the account statement calculation exists (Task 17B,
  above); none of the report layouts or the Reporting module does.
- **Permissions (implemented, 36 codes):**
  `Accounting.FinancialArea.{View,Create,Edit,Enable,Disable}`,
  `Accounting.FiscalYear.{View,Create,Edit,Close,Reopen,Seal,Unseal}`,
  `Accounting.AccountingPeriod.{View,Open,Close,Reopen,Seal}`,
  `Accounting.CodingStructure.{View,Configure}`,
  `Accounting.AccountingConfiguration.{View,Configure}`,
  `Accounting.Account.{View,Create,Edit,Enable,Disable}`,
  `Accounting.Document.{View,Create,Edit,Delete,Finalize,Reverse}`,
  `Accounting.Balance.{View,Rebuild}` (Task 12), `Accounting.LedgerMovement.View`
  (Task 17A) and `Accounting.AccountStatement.View`
  (Task 17B) — enforced in the
  application services, not only by the route guards. Period creation is authorized
  by `Open` (the row is born `open`); there is no period `Create`/`Edit`. The
  coding structure has ONE write code (`Configure`: drafting, editing a draft and
  publishing are the contract's single "no free-text structure editing"
  authority), and accounts have **no `Delete`** (§8.6). The remaining contract §22
  vocabulary is granular (no wildcard, no `Accounting.Journal.Create`-style
  catch-all, `Finalize` ≠ `Approve` — OQ-21, OQ-14) and arrives with the tasks
  that enforce it.
- **Publishes (implemented, Tasks 10.2 + 10.3 + 10.4; Task 12 READY FOR REVIEW):**
  `FinancialArea.{Created,Updated,Enabled,Disabled}`,
  `FiscalYear.{Created,Closed,Reopened,Sealed,Unsealed}`,
  `AccountingPeriod.{Opened,Closed,Reopened,Sealed}`,
  `Account.{Created,Updated,Enabled,Disabled}`,
  `AccountingDocument.{Created,Updated,Finalized,Deleted}`,
  `AccountBalance.Rebuilt` (Task 12, audited slice rebuild, payload `{organizationId, financialAreaId?, fiscalYearId?, deleted, inserted, reason, rebuiltBy, rebuiltAt}` — ledger stays truth) — payload is
  `{id, organizationId, …scope, code|sequence}`, plus `fromStatus`/`toStatus`/`reason`
  on transitions, plus `correlationId`/`occurredAt`; the `Account.*` payload adds
  `level` and `codingStructureVersionId`. There is deliberately **no
  `*.Deleted`** for master data: nothing is deleted (the `AccountingDocument.Deleted`
  event is the one discard of a pre-final voucher, §15.3 — `final` is never
  deleted). There is **no `CodingStructure.*` event** and **no
  `AccountingDocument.Posted` event**: contract §21 defines none — `final` IS
  posted (AC-D-20), so `Finalized` is the posting evidence — and a structure
  publish is evidenced by the AR-12 audit columns instead of an invented name
  (event-vocabulary changes are ADR-gated, AR-29). Task 10.7 emits no new event.
- **Publishes (planned, refines the catalog rows below):**
  `AccountingDocument.{Reversed,Corrected,Replaced}`,
  `DetailDimension.*`, `DetailItem.*`,
  `AccountingYearTransition.Executed`, `AccountingPosting.Rejected` — on the existing
  kernel bus (contract §21). The placeholders `JournalEntry.Posted` /
  `AccountingPeriod.Closed` in the event catalog are superseded by the shipped names
  above for years/periods/areas/accounts/documents; the rest follow when their tasks ship.
- **Rules (contract invariants, not policy):** Σ debit = Σ credit exactly with ≥2
  lines (AC-I-07/08); `final` documents are structurally immutable and never deleted
  (AC-I-05/06); corrections are new counter-documents — reversal / correction /
  replacement / adjustment (AC-I-15); only postable leaf accounts receive lines
  (AC-I-09); closed/sealed periods and years reject posting (AC-I-04); system posting
  is idempotent through an Accounting-owned operation ledger (AC-I-12); organization
  scoping and the 404-not-403 posture are inherited unchanged (AC-I-01/16,
  ADR-0021/0022/0025); the chart stays valid on every write —
  `level = parent.level + 1`, child code = parent code + that level's segment
  (digits only), no cycles, no skipped level, one version per subtree, and a
  postable account is always a leaf, so no invalid posting configuration is
  representable (AC-I-10, AC-D-19; enforced in the domain layer AND inside the
  repositories' locked transactions, never by a UI). Policy — period/close/reopen
  rules, coding scheme, posting
  eligibility defaults, dimension requiredness, correction windows, numbering year
  components, currency, valuation mappings — stays open: OQ-03/11/12/23/24/25/27/30/31
  and the new OQ-39…OQ-43.
- **Not responsible for:** knowing _why_ inventory moved (Inventory's business),
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
  \* Party (customer/supplier) _master data_ moves to the **Organization** module
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
- **Design rule:** preferences are _user data about the UI_, never business data;
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
- **Not responsible for:** deciding _what_ to sync (that's the business modules'
  outbox rows + Sync policies), mapping ownership (mapping configuration belongs
  here as _data_, business semantics belong to the owning module).

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
  user-facing notifications via per-module notification _rules_ (template text
  lives in the Notifications module; _which events notify which users_ is a
  per-module policy registered by each module).
- **API:** list my notifications, mark read, unread count.

---

## Event Catalog (initial v1 set)

> Naming: `Entity.PastTenseVerb` (PascalCase). This is the **initial** catalog;
> it grows with implementation. Event schemas are versioned; changing an existing
> event's field semantics requires an ADR (AR-29).

| Event                                                                                                                                                                                                                                                                                                                                                                                       | Publisher          | Main consumers                                                                            | Purpose                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UserSession.Created` / `UserSession.Revoked` / `Login.Failed`                                                                                                                                                                                                                                                                                                                              | Identity           | Audit, (Notifications for lockout)                                                        | session lifecycle trail                                                                                                                                      |
| `User.Created` / `User.Updated` / `User.Enabled` / `User.Disabled` / `User.PasswordReset`                                                                                                                                                                                                                                                                                                   | Users              | Audit, Identity (revoke sessions on disable/reset), Notifications                         | user lifecycle                                                                                                                                               |
| `Role.Created` / `Role.Updated` / `RolePermission.Assigned` / `RolePermission.Removed` / `UserRole.Assigned` / `UserRole.Removed`                                                                                                                                                                                                                                                           | RBAC               | Audit, UI refetch of effective permissions                                                | permission changes (no server-side cache to invalidate — ADR-0016)                                                                                           |
| `Organization.Created` / `Organization.Updated` / `Organization.Enabled` / `Organization.Disabled`                                                                                                                                                                                                                                                                                          | Organization       | Audit                                                                                     | organization root lifecycle (implemented, Task 6)                                                                                                            |
| `Branch.*` / `Department.*` / `Employee.*` / `Party.*` (`Created` / `Updated` / `Enabled` / `Disabled`)                                                                                                                                                                                                                                                                                     | Organization       | Audit                                                                                     | organization-structure and party master-data lifecycle (implemented, Task 6)                                                                                 |
| `Item.*` / `ItemGroup.*` / `Unit.*` / `Warehouse.*` (`Created` / `Updated` / `Enabled` / `Disabled`)                                                                                                                                                                                                                                                                                        | Inventory          | Audit                                                                                     | inventory master-data lifecycle (implemented, Task 6)                                                                                                        |
| `UnitConversion.Created`                                                                                                                                                                                                                                                                                                                                                                    | Inventory          | Audit                                                                                     | a new effective-dated conversion version (payload carries `supersededConversionId`); **no update/disable event exists** — versions are never edited in place |
| `InventoryReceipt.Created`                                                                                                                                                                                                                                                                                                                                                                  | Inventory          | **Accounting (journal)**, Audit, (Sync → outbox if configured)                            | stock in                                                                                                                                                     |
| `InventoryIssue.Created`                                                                                                                                                                                                                                                                                                                                                                    | Inventory          | **Accounting**, Audit                                                                     | stock out                                                                                                                                                    |
| `StockTransfer.Created` / `StockAdjustment.Created`                                                                                                                                                                                                                                                                                                                                         | Inventory          | Accounting (adjustment), Audit                                                            | stock changes                                                                                                                                                |
| `SalesOrder.Created` / `SalesOrder.Confirmed`                                                                                                                                                                                                                                                                                                                                               | Sales              | Audit, (Sync → outbox if configured)                                                      | sales flow                                                                                                                                                   |
| `Invoice.Issued`                                                                                                                                                                                                                                                                                                                                                                            | Sales              | **Accounting (revenue journal)**, Audit, (Sync → taxpayer/faraPayam outbox if configured) | billing                                                                                                                                                      |
| `JournalEntry.Posted` / `AccountingPeriod.Closed` _(placeholders — refined by the Accounting Domain Contract §21 into `AccountingDocument.*`, `FiscalYear.*`, `AccountingPeriod.*` when those ship; `FinancialArea.*`, `AccountingPeriod.*`, `Account.*` and `AccountingDocument.{Created,Updated,Finalized,Deleted}` are already SHIPPED with their refined names — Tasks 10.2/10.3/10.4)_ | Accounting         | Audit, Notifications                                                                      | books                                                                                                                                                        |
| `ImportSession.Completed` / `ImportSession.Failed`                                                                                                                                                                                                                                                                                                                                          | Excel              | Notifications, Audit                                                                      | import feedback                                                                                                                                              |
| `PrintJob.Completed` / `PrintJob.Failed`                                                                                                                                                                                                                                                                                                                                                    | Print              | Notifications, Audit                                                                      | print feedback                                                                                                                                               |
| `OutboxItem.DeadLettered` / `Integration.Failed`                                                                                                                                                                                                                                                                                                                                            | Sync / Integration | Audit, Notifications (admins)                                                             | sync health                                                                                                                                                  |
| `Job.Failed`                                                                                                                                                                                                                                                                                                                                                                                | Jobs               | Notifications (admins)                                                                    | job health                                                                                                                                                   |

> **Payload convention for the Task 6 master-data events:** `{id, organizationId,
code}` (the organization root uses `{id, code}`), plus `correlationId` and
> `occurredAt`. `UnitConversion.Created` additionally carries `itemId`,
> `fromUnitId`, `toUnitId`, `factor`, `validFrom` and `supersededConversionId`.
> None of them is a `*.Deleted` event: master data is deactivated, never deleted
> (OQ-36).

**Outbox operations vs domain events:** an outbox _row_ records an external
delivery operation (e.g. destination `faraPayam`, operation
`InventoryReceipt.Created`) and is written by the business module **inside its
own transaction** using the kernel outbox port — it is not "emitted to the Sync
module" at runtime. See `docs/integrations.md` and ADR-0004.
