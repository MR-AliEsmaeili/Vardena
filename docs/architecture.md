# Vardena — System Architecture

Status: Accepted (foundation) · Updated: 2026-09-11 · Companion docs:
[modules](./modules.md) · [security](./security.md) · [integrations](./integrations.md) ·
[database-strategy](./database-strategy.md) · [reporting-strategy](./reporting-strategy.md) ·
[open questions](./open-questions.md)

## 1. Product Summary

Vardena is a modern **modular ERP** for organizations and businesses. Core
requirements that shape this architecture:

- **Extensible**: new ERP modules must be addable without architectural change.
- **Configurable (controlled):** businesses differ in documents, approvals, numbering
  and accounting practice; variation is configuration over a stable core — see
  [`architecture/domain/`](./architecture/domain/README.md).
- **Independent**: Vardena owns its database, business logic, authentication,
  authorization, and API. Legacy ERPs (FaraPayam-style) are _external systems_.
- **Deployable on-premise today** (single machine / local network, Docker) and
  suitable for future cloud deployment.
- **Reporting, Excel, printing, and customization are first-class capabilities**,
  not afterthoughts.

## 2. System Topology

```
┌────────────────────────────┐
│  Browser — React SPA       │  talks to ONE backend: the Vardena API
└──────────────┬─────────────┘
               │  same-origin REST (/api/v1) + OpenAPI docs
┌──────────────▼──────────────────────────────────────────────────┐
│  Vardena Backend — NestJS modular monolith (Docker)             │
│                                                                 │
│  ┌─────────────────────────────┐   ┌──────────────────────────┐ │
│  │ API process                 │   │ Worker process            │ │
│  │  - module controllers       │   │  - outbox dispatcher      │ │
│  │  - application services     │   │  - PDF rendering          │ │
│  │  - domain + events          │   │  - heavy imports/reports  │ │
│  └──────────────┬──────────────┘   │  - scheduled jobs         │ │
│                 │                  └────────────┬─────────────┘ │
└─────────────────┼───────────────────────────────────────────────┘
                  │                              │
        ┌─────────▼─────────┐         ┌──────────▼───────────────┐
        │ PostgreSQL         │         │ Integration adapters      │
        │ db: vardena        │         │ (faraPayam, taxpayer,     │
        │ schema per module  │         │ payment, …)              │
        └────────────────────┘         └──────────┬───────────────┘
                                                  │  outbound only, async
                                     ┌────────────▼─────────────┐
                                     │ External systems          │
                                     │ legacy ERP, tax, payments │
                                     └───────────────────────────┘
```

Key invariants:

1. The **frontend communicates only with the Vardena API** — never with external
   legacy/tax/payment services (AR-19).
2. **External calls are asynchronous**: business writes enqueue outbox rows in the
   same DB transaction; the worker process dispatches (ADR-0004).
3. The **worker shares the backend codebase** (separate entrypoint) so module
   code, event schemas, and adapters are defined once (ADR-0002).

## 3. Architectural Principles

| Principle                  | Meaning in Vardena                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Modular monolith           | One deployable; modules are hard boundaries, not folders (ADR-0001)                                   |
| Extraction-ready           | Modules could become services later: no cross-module DB access, contracts via events/public APIs      |
| Domain-oriented boundaries | Modules named after business domains (inventory, accounting, sales), not technical layers             |
| No shared business layer   | `kernel/` is technical-only; every business rule belongs to exactly one module (AR-06/08)             |
| Controllers = transport    | Business logic never in controllers (AR-03)                                                           |
| Infrastructure at the edge | Prisma, HTTP, file I/O, and external protocols are leaf dependencies of the module                    |
| Adapter isolation          | External systems behind ports+adapters (AR-18, ADR-0003)                                              |
| Transactional messaging    | Outbox for external side effects; persisted domain events for internal ones (ADR-0004/0005)           |
| Backend-enforced security  | Authorization decided in the backend, always (AR-21)                                                  |
| Docs as architecture       | `docs/` + `docs/adr/` + `.vardena/` are normative for AI agents; behavior changes update them (AG-07) |

## 4. Modular Monolith — Module Anatomy

Every module under `backend/src/modules/<name>/` follows the same anatomy
(AR-02). This uniformity is what lets many AI agents work in parallel without
stepping on each other:

```
modules/inventory/
├── inventory.module.ts
├── api/            # controllers + request/response DTOs (transport only, AR-03)
├── application/    # use-case services: orchestration, transactions,
│                   #   authorization enforcement (AR-04)
├── domain/         # entities, value objects, invariants, rules,
│                   #   domain event schemas (framework-free, AR-05)
├── data/           # Prisma repositories + module-owned SQL views (raw SQL
│                   #   allowed here, AR-11a)
├── events/         # event schemas exposed to other modules + consumers of
│                   #   other modules' events
├── reports/        # (optional) reporting definitions + views for the
│                   #   reporting module to consume
├── imports/        # (optional) ImportSpecs for the Excel module
├── documents/      # (optional) printable document providers for the print module
└── tests/
```

**Layering inside a module (dependency direction, strictly downward):**

```
api/  →  application/  →  domain/
             ↓               ↑
           data/        (domain has no dependencies)
           events/
```

- `api/` calls application services; application services call domain logic and
  data repositories.
- `domain/` is plain TypeScript: no Nest decorators, no Prisma, no HTTP.
- A module's **public surface** is its application/domain contracts (for
  explicit synchronous operations and reads), published domain events (for
  independent reactions), and extension-point folders (for horizontal features).
  Inventory → Accounting posting specifically uses the synchronous public
  contract in ADR-0041, not a domain-event subscription.

**`kernel/`** (`backend/src/kernel/`) holds technical primitives only (AR-06):
event bus + event log, outbox port, ULID generation, pagination helpers,
Result/error types, base DTOs, exception filters. If you feel the need for a
"shared business service", the logic belongs to one module — put it there.

## 5. Cross-Module Communication (AR-07)

| Need                                                                              | Mechanism                                                                                                                                                            |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "A current command must synchronously ask another module to perform an operation" | That module's **public application/domain contract**, called in-process; Inventory → Accounting uses this pattern (ADR-0041)                                         |
| "An independent consumer must react to a published fact"                          | **Domain event** under its governing contract; events are not the primary internal Inventory → Accounting posting path (ADR-0041; ADR-0005 superseded for that path) |
| "I need to read another module's data"                                            | That module's **public application service** (in-process), or its **module-owned SQL view** for reporting                                                            |
| "I need to send something to an external system"                                  | **Outbox row** written in my transaction → worker → integration adapter — ADR-0004                                                                                   |
| Direct cross-module table/Prisma access                                           | **Forbidden**                                                                                                                                                        |

When one use case must coordinate multiple modules, a small root-level
`backend/src/composition/` service may call their public application contracts.
It is not a business module: it must not access repositories, tables or Prisma
transaction clients, and business modules must not import it. Each new use of
this pattern is AR-29/ADR-gated. The previously accepted Organization–Inventory
calendar-transition use case was superseded by ADR-0044; no calendar-transition
composition service remains.

Event naming: `Entity.PastTenseVerb` in PascalCase — e.g. `InventoryReceipt.Created`,
`Invoice.Issued`, `JournalEntry.Posted`. The initial v1 event catalog is in
`docs/modules.md` §Event catalog; it grows as modules are implemented (each event
schema is versioned: adding optional fields is a compatible change; changing
semantics of an existing field requires an ADR).

## 6. Target Repository Layout

> **Implementation status (reconciled 2026-09-29 at `main` `34dddfd`; see
> `current-state-reconciliation.md`):** the backend below **exists**
> (`backend/src/kernel`, `backend/src/modules/{health,identity,users,rbac,organization,inventory,documents,workflow,accounting}`,
> `prisma/schema/` with 8 module files and `prisma/migrations/` with 18
> migrations). The `frontend/` tree **now exists** with `src/{app,api,features,ui,lib}`
> as drawn below (Task 22 plus the Task 32 Dashboard corrected by PR #86;
> `features/` includes `auth/ permissions/ organization/ accounting/ dashboard/`,
> plus a `styles/` and a `test/` folder). The
> `backend/src/kernel/outbox/` port and the
> `modules/{audit,notifications,sales,purchasing,reporting,excel,print,customization,integration,sync,jobs}`
> folders below are **target layout, not present**. Module folders currently
> use `api/ application/ domain/ data/`; the optional `events/ reports/
  imports/ documents/` folders of §4 are not in use (domain event schemas live
> in `domain/*.events.ts`). A root `backend/src/composition/` use-case layer
> may coordinate approved multi-module workflows through public contracts; the
> former calendar transition described by ADR-0043 was removed under ADR-0044.

```
Vardena/
├── .vardena/                  # AI agent context & rules (normative)
│   ├── project-context.md
│   ├── architecture-rules.md
│   └── agent-rules.md
├── docs/                      # architecture documentation (normative)
│   ├── architecture.md  modules.md  security.md  integrations.md
│   ├── database-strategy.md  reporting-strategy.md  open-questions.md
│   └── adr/                   # ADR-0001… (process in adr/README.md)
├── backend/
│   ├── src/
│   │   ├── main.ts            # API process entrypoint
│   │   ├── worker.ts          # worker process entrypoint (outbox, PDF, jobs)
│   │   ├── composition/       # root-only, ADR-gated multi-module use cases
│   │   ├── kernel/            # technical primitives only (AR-06)
│   │   │   ├── events/        #   bus, domain-event log, idempotency helper
│   │   │   ├── outbox/        #   OutboxWriter port + impl (port implemented by sync)
│   │   │   ├── ids/           #   ULID generation
│   │   │   ├── pagination/  result/  common/  # base DTOs, errors, filters
│   │   └── modules/           # one folder per module (anatomy in §4)
│   │       ├── identity/  users/  rbac/  audit/  notifications/
│   │       ├── accounting/  purchasing/  inventory/  sales/
│   │       ├── reporting/  excel/  print/  customization/
│   │       ├── integration/  sync/  jobs/
│   ├── prisma/
│   │   ├── schema/            # one .prisma file per module (AR-09)
│   │   └── migrations/
│   └── docker/                # Dockerfiles (api, worker)
├── frontend/                  # React SPA (setup & conventions: frontend/README.md)
│   └── src/
│       ├── app/               # router, layouts, providers, route guards
│       ├── api/               # single Axios instance + per-module API functions
│       │   └── generated/     #   openapi-typescript output (ADR-0014)
│       ├── features/          # one feature slice per module (mirror backend)
│       ├── ui/                # shadcn/ui primitives + reusable patterns
│       ├── lib/               # utils, Day.js setup, formatters, i18n dict
│       ├── styles/            # Tailwind entry
│       └── test/              # test setup, render helpers, fixtures
├── docker-compose.yml         # postgres + api + worker (+ volumes)
└── README.md
```

## 7. Frontend Architecture (summary)

> **Implementation status:** the conventions below are implemented by the
> Task 22 slice and the Task 32 Dashboard corrected by PR #86 (login/session,
> license and organization gates, Financial Area → Fiscal Year workspace context,
> RTL app shell, permission-aware navigation, Accounting read surfaces and bounded Dashboard reads). Everything else —
> other feature slices and grid-state persistence via the customization module
> — are still target state. The organization-scoped date/time slice is implemented
> under ADR-0042; OQ-02 remains open for numeral preference and broader
> localization. Setup, scripts and the file layout are documented in
> [`frontend/README.md`](../frontend/README.md).

- **Feature slices mirror backend modules** (`features/inventory`, `features/sales`,
  ...) — the same mental model on both sides (AR-27).
- `api/` is the **only** HTTP layer: one Axios instance, interceptors for auth
  errors (401 → login redirect) and correlation ids; per-module API functions
  typed from the generated OpenAPI contract (AR-26, ADR-0014).
- **TanStack Query** for all server state (query keys namespaced per module,
  e.g. `['inventory','receipts', …]`); **React Hook Form + Zod** for forms (Zod
  schemas mirror the API contract); **TanStack Table** for grids (column
  visibility/order and saved filters persist via the customization module);
  **Day.js through `frontend/src/lib/datetime/` only** for date/time handling;
  **React Router** for routing; Tailwind + shadcn/ui for UI. Date/Instant and
  calendar/zone rules are binding in [ADR-0042](adr/0042-datetime-calendar-architecture.md)
  and [the date/time contract](datetime.md).
- Frontend authorization (hiding buttons/menus by permission) is **UX only** —
  the backend enforces everything (AR-21). The scoped workspace selection is
  `Organization → Financial Area → Fiscal Year`; it is ephemeral browser state,
  clears descendants on each parent transition, and never substitutes for
  server-side organization/parent-chain validation. See
  [`frontend/financial-context.md`](frontend/financial-context.md).
- Localization remains an open product area under OQ-02 (UI language, Persian
  numeral preference and broader number formatting). The calendar default and
  organization-scoped IANA time zone are already decided/implemented by ADR-0042;
  all date and number display still goes through shared `lib/` formatters.

## 8. Event Model (overview)

> **Implementation status / C-61 decision (verified 2026-10-07).** The table
> below remains a target event model, not a claim that persistence/dispatch exists.
> The in-process bus is in-memory; there is no `core.domain_events`, outbox table,
> or worker dispatch loop. One event subscriber exists, but Accounting does not
> consume Inventory events and no Inventory → Accounting posting is implemented.
> Under **ADR-0041 / PO-02**, that posting uses a synchronous public
> application-service contract, not an event subscriber. **OQ-39 remains open**
> for transaction ownership, refusal, retry and failure semantics.

| Kind                    | Transport (v1)                                       | Durability                                           | Use                                                                                                          |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Domain event (internal) | in-process bus, according to the event's contract    | No persisted event log is currently implemented      | Independent reactions, audit and notifications; not the primary internal Inventory → Accounting posting path |
| Outbox event (external) | `sync.outbox_events` table, worker dispatch          | Intended to be transactional with the business write | Sending to external systems with retry (ADR-0004); not the primary internal Inventory → Accounting path      |
| Job (delayed work)      | `jobs.job_runs` DB queue, worker pickup              | DB                                                   | PDF rendering, heavy imports/reports, scheduled tasks (ADR-0010)                                             |
| Notification            | event → notifications module → `notifications.items` | DB                                                   | in-app user notifications (email/SMS channels later)                                                         |

Consistency rules:

- Event and outbox persistence/transaction semantics are defined by their owning
  contract; this target table does not assert that the infrastructure is present.
- Inventory → Accounting posting must use the synchronous public contract in
  ADR-0041. Its transaction/atomicity and refusal/failure behavior remain open
  under OQ-39; ADR-0041 authorizes no production implementation.
- If the worker is down, future external outbox rows may accumulate and resume
  through retry/dead-letter handling under ADR-0004.
- External systems are never a dependency of a business transaction: their
  availability affects sync latency, not ERP usability (ADR-0004).

## 9. API Conventions

- Base path `/api/v1`; kebab-case resource paths (`/api/v1/inventory/receipts`);
  JSON only.
- List endpoints: `?page=1&pageSize=20&sort=field:dir&filter[field][op]=value`;
  response `{ items, total, page, pageSize }`. `pageSize` capped (default 100,
  hard max 500).
- Errors: standard HTTP status + `{ code, message, details?, correlationId }`; `code` is a stable
  machine-readable code (e.g. `EntityNotFound`, `ValidationFailed`,
  `PermissionDenied`); no internal details in responses (AR-24).
- Authentication: cookie session (ADR-0007); every endpoint declares a permission
  (AR-21) except explicitly documented anonymous endpoints (login).
- OpenAPI/Swagger served from the API (`/api/docs`), generated from DTOs
  (AR-26); disabled in production by default.
- Each mutating request carries a correlation id (client-generated or
  server-assigned) used across logs, audit, and outbox (see security §audit).

## 10. Deployment

**v1 (on-premise / local network)** — single Docker Compose stack:

| Service    | Image                       | Notes                                                                                           |
| ---------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `postgres` | PostgreSQL 16               | volume-backed; backups per database-strategy §Backups                                           |
| `api`      | backend (API entrypoint)    | stateless; sessions live in Postgres                                                            |
| `worker`   | backend (worker entrypoint) | outbox dispatch, PDF, jobs; scales by running more replicas (queue is DB-backed, `SKIP LOCKED`) |

- Configuration via environment variables (12-factor); secrets injected, never
  baked into images (AR-20).
- **Future cloud path** (no architectural change required): stateless `api`
  scales horizontally (sessions in DB), `worker` scales independently, local file
  storage (PDFs/imports) moves behind a storage port (S3-compatible) — storage
  driver choice is OQ-08.

## 11. Where Things Are Documented

| Topic                                                                                         | Document                     |
| --------------------------------------------------------------------------------------------- | ---------------------------- |
| Module responsibilities, boundaries, event catalog                                            | `docs/modules.md`            |
| Authentication, RBAC, audit, API security                                                     | `docs/security.md`           |
| External systems, adapters, outbox/sync design                                                | `docs/integrations.md`       |
| Schemas, naming, migrations, raw-SQL policy, outbox DDL                                       | `docs/database-strategy.md`  |
| Reporting engine, views, export, performance                                                  | `docs/reporting-strategy.md` |
| Domain model, configurability, workflows, master data, inventory & accounting domain analysis | `docs/architecture/domain/`  |
| Ambiguous business/architectural decisions                                                    | `docs/open-questions.md`     |
| Decisions & their rationale                                                                   | `docs/adr/`                  |

## 12. Extraction Path (future)

Because of AR-07/AR-08, any module can later be extracted to its own service
without rewriting its neighbors: replace in-process event dispatch with a broker,
replace public-service reads with API/async replication. No module is designed to
share tables or in-memory state with another.
