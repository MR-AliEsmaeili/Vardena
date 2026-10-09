# Vardena — Architecture Rules

Binding rules for all implementation work (human or AI). Each rule has a short
rationale. Rules reference ADRs (decision source) in `docs/adr/`. Violating a rule
without an accepted ADR that supersedes it is a defect, not a style choice.

## A. Modules & Layering

- **AR-01 — Modular monolith.** One NestJS application, modules under
  `backend/src/modules/<name>`. No microservices, no second database, no external
  message broker in v1. (ADR-0001, ADR-0002, ADR-0010)
  *Why: one deployable to operate on-premise; extraction path preserved by
  boundaries, not by premature distribution.*
- **AR-02 — Fixed module anatomy.** Every module uses the folders: `api/`
  (controllers + DTOs), `application/` (use-case services), `domain/` (entities,
  invariants, domain events), `data/` (Prisma repositories, module SQL views),
  `events/` (event schemas + consumers), plus optional extension-point folders
  `reports/`, `imports/`, `documents/` for the reporting, Excel, and printing
  horizontal features.
- **AR-03 — Controllers are transport-only.** `api/` handles HTTP mapping, DTO
  validation, permission metadata, and response shaping. No business rules, no
  Prisma calls, no event orchestration, no direct domain mutation in controllers.
  *Why: keeps the API swappable and business logic testable without HTTP.*
- **AR-04 — Use cases live in application services.** `application/` orchestrates
  domain + data + events, owns transaction boundaries, and enforces authorization
  (on top of route guards). Every write path: guard → application service →
  transaction.
- **AR-05 — Domain layer is framework-free.** `domain/` contains entities, value
  objects, invariants, domain rules, and domain event *schemas*. No Nest decorators,
  no Prisma imports, no HTTP concerns.
  *Why: business rules stay testable plain and portable if a module is later
  extracted.*
- **AR-06 — `kernel/` is technical-only.** The kernel holds technical primitives:
  event bus, outbox port, ID generation, pagination, Result/error types, base
  DTOs. **No business logic in the kernel.** A "shared business service" is a
  code smell — the logic belongs to exactly one module.
- **AR-07 — Cross-module communication rules.**
  - An explicitly synchronous cross-module operation uses the owning module's
    **public application/domain contract** (in-process); Inventory → Accounting
    posting uses this mechanism under ADR-0041.
  - Independent reactions to published facts may use **domain events** under the
    event contract that governs them; an event is not a substitute for the
    synchronous Inventory → Accounting posting contract.
  - Reads from another module use the owning module's **public application
    service**, or a **module-owned SQL view** (reporting use).
  - **Forbidden:** module A reading or writing module B's tables/Prisma models
    directly.
  *Why: boundaries stay extractable; the database cannot hide coupling.*
- **AR-08 — One owner per fact.** Every table, and every business fact, belongs to
  exactly one module. If two modules need the same fact, one owns it and publishes
  it (event) or exposes it (public service).

## B. Data & Database

- **AR-09 — Single database, one schema per module.** PostgreSQL, one `vardena`
  database, one schema per module (`identity`, `users`, `rbac`, `inventory`, ...).
  (ADR-0008)
- **AR-10 — Migrations are the only schema change path.** Any schema change ships
  with a committed Prisma migration. Never `prisma db push`, never manual SQL
  against the schema, never edit an already-applied migration.
- **AR-11 — Raw SQL is scoped.** Allowed only in: (a) module-owned views under the
  module's `data/` or `reports/`; (b) the reporting module; (c) a documented
  performance-critical path noted in the module's section of `docs/modules.md`.
  Always parameterized. Never string-concatenated user input.
- **AR-12 — Standard entity columns.** Every entity table: `id` (ULID),
  `created_at`, `updated_at` (timestamptz, UTC), `created_by`, `updated_by`.
  Money `numeric(18,2)`, quantities `numeric(18,4)` (see
  `docs/database-strategy.md`; currency precision is OQ-03).
- **AR-13 — Immutability & soft delete.** Accounting journal entries/lines are
  immutable (correction = reversing entry). Soft delete only where documented per
  module (e.g. items, users, roles); deleted rows keep `deleted_at`/`deleted_by`.

## C. Events, Sync & Background Work

- **AR-14 — Outbox for all external side effects.** Anything that must reach an
  external system (legacy ERP, tax, payments) is written as an outbox row **in the
  same DB transaction** as the business write. No external HTTP call in a request
  path, ever. (ADR-0004)
- **AR-15 — Idempotent consumers.** Every event consumer (domain event handlers and
  outbox dispatch) must be idempotent, deduplicating on the stable event/
  `dedup_key` identity.
- **AR-16 — Inventory ⇢ Accounting posting uses an explicit synchronous public
  contract.** The Inventory Business Document invokes Accounting through a
  public application/domain contract inside the Modular Monolith; Inventory
  supplies valuation facts and Accounting owns mapping and journal policy.
  No direct cross-module table access, no microservices, and no event/outbox as
  the primary internal posting mechanism. (ADR-0041, PDR-09; OQ-39 still gates
  transaction/failure semantics)
- **AR-17 — Worker from the same codebase.** Background work (outbox dispatch, PDF
  rendering, heavy imports/reports, scheduled jobs) runs in the `worker` entrypoint
  of the same NestJS codebase. v1 job queue is **DB-backed** (no external broker).
  (ADR-0010)

## D. Integrations & Security

- **AR-18 — Adapter boundary.** All external systems sit behind adapters in the
  `integration` module. Business and worker code depend on the **port interfaces**
  (kernel), never on concrete adapters. (ADR-0003)
- **AR-19 — Frontend isolation.** The SPA talks only to the Vardena API. The
  browser never calls legacy ERP, tax, or payment services.
- **AR-20 — Integration secrets.** Credentials come from environment/config, are
  encrypted at rest, never logged, never committed.
- **AR-21 — Backend authorization is mandatory.** Every endpoint declares a
  permission (or an explicit, documented anonymous configuration). Authorization is
  enforced in the backend (route guard + application service check). Frontend
  permission checks are UX-only and never a security boundary. (ADR-0006)
- **AR-22 — Granular permissions.** Permission codes follow
  `Module.Entity.Action` (e.g. `Inventory.Receipt.View`, `Inventory.Receipt.Create`,
  `Inventory.Receipt.Edit`, `Inventory.Receipt.Delete`). New permissions are
  registered in the owning module's code registry; the DB mirrors the registry.
- **AR-23 — Audit logging.** Sensitive operations are audited (actor, action,
  module, entity, before/after) inside the business transaction. Audit records are
  append-only: no update/delete API.
- **AR-24 — Validate at the edge.** All request inputs are validated (backend
  DTO validation; frontend Zod mirrors). Error responses never leak internals
  (no stack traces, SQL, or server paths).
- **AR-25 — Credential & session baseline.** Passwords: argon2id. Sessions: opaque
  256-bit random tokens, stored hashed, delivered via httpOnly cookies (ADR-0007).
  Defaults for lifetimes/lockout are configuration, not business rules — see
  `docs/security.md`.

## E. API Contract & Frontend

- **AR-26 — OpenAPI is the contract.** The OpenAPI spec is generated from backend
  DTOs and is the single source of truth. Frontend API types are derived from it
  (no hand-copied duplicate definitions). (ADR-0014)
- **AR-27 — Feature isolation.** `frontend/src/features/<x>` must not import the
  internals of `features/<y>`; cross-feature composition goes through `ui/`, `lib/`,
  `api/`.
- **AR-28 — Data access pattern.** All server data flows through TanStack Query;
  all mutations go through the `api/` layer (single Axios instance, interceptors).
  No ad-hoc `fetch`/Axios calls inside components.
- **AR-29 — ADR-gated architecture changes.** New module, new cross-module pattern,
  new major dependency, schema-per-module change, event contract change, or
  deployment-topology change ⇒ ADR first (or in the same PR).
- **AR-30 — Dependency discipline.** No new major dependency without documented
  justification (ADR or registered OQ). Prefer the fixed stack (ADR-0002).
- **AR-31 — No invented business rules.** Where behavior is unspecified, register
  an OQ in `docs/open-questions.md` and ask. Do not guess numbering, tax, ledger,
  approval, retention, or policy behavior.
- **AR-32 — BusinessDate and Instant are distinct, permanent concepts.** A
  `BusinessDate` is a calendar day persisted as canonical Gregorian PostgreSQL
  `date`; user-facing input/display follows the organization's configured
  calendar (Jalali by default). An `Instant` is a UTC PostgreSQL `timestamptz`;
  wire Instants must be valid ISO UTC `Z` values, never naive local date-times
  or offset-bearing strings parsed in the browser. Render each valid Instant by
  resolving the organization's valid IANA zone first, then its configured
  calendar. Detail/audit Instant displays include seconds, the resolved zone
  and that instant's offset; keep the raw UTC ISO value available for evidence.
  Reuse the shared kernel/frontend date-time abstractions; never treat a
  business day as a JavaScript `Date`, UTC-midnight transport, browser-zone day,
  or timestamp, and never use hard-coded offsets or local calendar conversions.
  Jalali API input must be explicitly declared. The owner-approved legacy
  ISO-instant BusinessDate compatibility branch resolves to the UTC calendar
  day. Follow `docs/datetime.md` for range semantics and Inventory
  validity-window exceptions; do not extrapolate policy to other `valid_*`
  fields.

## F. Frontend Conventions (summary)

- React + Vite + TS strict; Tailwind + shadcn/ui for UI.
- React Router for routing; feature folders mirror backend modules
  (`features/inventory`, `features/accounting`, ...).
- React Hook Form + Zod for forms; Zod schemas mirror the API contract.
- TanStack Table for data grids; column visibility/order persist via the
  customization module (preference category `ui.table`).
- Day.js is used only through `frontend/src/lib/datetime/` for date-time handling;
  BusinessDate and Instant rendering follows AR-32 and ADR-0042. Calendar/zone
  behavior is organization-configured, and Persian numeral preference remains
  open under OQ-02.
- UI text must come from a central i18n dictionary, not inline literals
  (language decision OQ-02).
