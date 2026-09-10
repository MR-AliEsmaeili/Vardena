# Vardena — System Architecture

Status: Accepted (foundation) · Updated: 2026-09-10 · Companion docs:
[modules](./modules.md) · [security](./security.md) · [integrations](./integrations.md) ·
[database-strategy](./database-strategy.md) · [reporting-strategy](./reporting-strategy.md) ·
[open questions](./open-questions.md)

## 1. Product Summary

Vardena is a modern **modular ERP** for organizations and businesses. Core
requirements that shape this architecture:

- **Extensible**: new ERP modules must be addable without architectural change.
- **Independent**: Vardena owns its database, business logic, authentication,
  authorization, and API. Legacy ERPs (FaraPayam-style) are *external systems*.
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

| Principle | Meaning in Vardena |
|---|---|
| Modular monolith | One deployable; modules are hard boundaries, not folders (ADR-0001) |
| Extraction-ready | Modules could become services later: no cross-module DB access, contracts via events/public APIs |
| Domain-oriented boundaries | Modules named after business domains (inventory, accounting, sales), not technical layers |
| No shared business layer | `kernel/` is technical-only; every business rule belongs to exactly one module (AR-06/08) |
| Controllers = transport | Business logic never in controllers (AR-03) |
| Infrastructure at the edge | Prisma, HTTP, file I/O, and external protocols are leaf dependencies of the module |
| Adapter isolation | External systems behind ports+adapters (AR-18, ADR-0003) |
| Transactional messaging | Outbox for external side effects; persisted domain events for internal ones (ADR-0004/0005) |
| Backend-enforced security | Authorization decided in the backend, always (AR-21) |
| Docs as architecture | `docs/` + `docs/adr/` + `.vardena/` are normative for AI agents; behavior changes update them (AG-07) |

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
- A module's **public surface** is: its application services (for other modules'
  *reads*), its published domain events (for other modules' *side effects*), and
  its extension-point folders (for horizontal features).

**`kernel/`** (`backend/src/kernel/`) holds technical primitives only (AR-06):
event bus + event log, outbox port, ULID generation, pagination helpers,
Result/error types, base DTOs, exception filters. If you feel the need for a
"shared business service", the logic belongs to one module — put it there.

## 5. Cross-Module Communication (AR-07)

| Need | Mechanism |
|---|---|
| "Another module must react to something I changed" | **Domain event** (synchronous in-process dispatch in v1, persisted in `core.domain_events`; consumers idempotent) — ADR-0005 |
| "I need to read another module's data" | That module's **public application service** (in-process), or its **module-owned SQL view** for reporting |
| "I need to send something to an external system" | **Outbox row** written in my transaction → worker → integration adapter — ADR-0004 |
| Direct cross-module table/Prisma access | **Forbidden** |

Event naming: `Entity.PastTenseVerb` in PascalCase — e.g. `InventoryReceipt.Created`,
`Invoice.Issued`, `JournalEntry.Posted`. The initial v1 event catalog is in
`docs/modules.md` §Event catalog; it grows as modules are implemented (each event
schema is versioned: adding optional fields is a compatible change; changing
semantics of an existing field requires an ADR).

## 6. Target Repository Layout

> The repository currently contains **documentation only**. This is the target
> layout for the first implementation phase.

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
├── frontend/
│   └── src/
│       ├── app/               # router, layouts, providers
│       ├── api/               # single Axios instance + per-module API functions
│       ├── features/          # one feature slice per module (mirror backend)
│       ├── ui/                # shadcn/ui primitives
│       └── lib/               # utils, Day.js setup, formatters, i18n dict
├── docker-compose.yml         # postgres + api + worker (+ volumes)
└── README.md
```

## 7. Frontend Architecture (summary)

- **Feature slices mirror backend modules** (`features/inventory`, `features/sales`,
  ...) — the same mental model on both sides (AR-27).
- `api/` is the **only** HTTP layer: one Axios instance, interceptors for auth
  errors (401 → login redirect) and correlation ids; per-module API functions
  typed from the generated OpenAPI contract (AR-26, ADR-0014).
- **TanStack Query** for all server state (query keys namespaced per module,
  e.g. `['inventory','receipts', …]`); **React Hook Form + Zod** for forms (Zod
  schemas mirror the API contract); **TanStack Table** for grids (column
  visibility/order and saved filters persist via the customization module);
  **Day.js** for all date handling; **React Router** for routing; Tailwind +
  shadcn/ui for UI.
- Frontend authorization (hiding buttons/menus by permission) is **UX only** —
  the backend enforces everything (AR-21).
- Localization (UI language, Jalali calendar, number formatting) is **OQ-02**;
  the architecture requirement is that all user-facing strings live in one i18n
  dictionary and all date/number display goes through `lib/` formatters so the
  decision can be made in one place.

## 8. Event Model (overview)

| Kind | Transport (v1) | Durability | Use |
|---|---|---|---|
| Domain event (internal) | in-process bus, dispatched in the publisher's unit of work | appended to `core.domain_events` in the same transaction | cross-module side effects (inventory → accounting), audit, notifications |
| Outbox event (external) | `sync.outbox_events` table, worker dispatch | transactional with the business write | sending to external systems with retry (ADR-0004) |
| Job (delayed work) | `jobs.job_runs` DB queue, worker pickup | DB | PDF rendering, heavy imports/reports, scheduled tasks (ADR-0010) |
| Notification | event → notifications module → `notifications.items` | DB | in-app user notifications (email/SMS channels later) |

Consistency rules:

- A business write, its domain-event log entry, and any outbox rows commit or roll
  back **together** (one DB transaction).
- If a transactional domain-event consumer (e.g. Accounting creating a journal
  entry) fails, the **whole business operation fails** — safe for the books
  (ADR-0005).
- If the worker is down, outbox rows accumulate; business operations continue.
  Dispatch resumes on restart. Dead-lettered rows surface in the admin UI for
  manual retry/cancel.
- External systems are never a dependency of a business transaction: their
  availability affects sync latency, not ERP usability (ADR-0004).

## 9. API Conventions

- Base path `/api/v1`; kebab-case resource paths (`/api/v1/inventory/receipts`);
  JSON only.
- List endpoints: `?page=1&pageSize=20&sort=field:dir&filter[field][op]=value`;
  response `{ items, total, page, pageSize }`. `pageSize` capped (default 100,
  hard max 500).
- Errors: standard HTTP status + `{ code, message, details? }`; `code` is a stable
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

| Service | Image | Notes |
|---|---|---|
| `postgres` | PostgreSQL 16 | volume-backed; backups per database-strategy §Backups |
| `api` | backend (API entrypoint) | stateless; sessions live in Postgres |
| `worker` | backend (worker entrypoint) | outbox dispatch, PDF, jobs; scales by running more replicas (queue is DB-backed, `SKIP LOCKED`) |

- Configuration via environment variables (12-factor); secrets injected, never
  baked into images (AR-20).
- **Future cloud path** (no architectural change required): stateless `api`
  scales horizontally (sessions in DB), `worker` scales independently, local file
  storage (PDFs/imports) moves behind a storage port (S3-compatible) — storage
  driver choice is OQ-08.

## 11. Where Things Are Documented

| Topic | Document |
|---|---|
| Module responsibilities, boundaries, event catalog | `docs/modules.md` |
| Authentication, RBAC, audit, API security | `docs/security.md` |
| External systems, adapters, outbox/sync design | `docs/integrations.md` |
| Schemas, naming, migrations, raw-SQL policy, outbox DDL | `docs/database-strategy.md` |
| Reporting engine, views, export, performance | `docs/reporting-strategy.md` |
| Ambiguous business/architectural decisions | `docs/open-questions.md` |
| Decisions & their rationale | `docs/adr/` |

## 12. Extraction Path (future)

Because of AR-07/AR-08, any module can later be extracted to its own service
without rewriting its neighbors: replace in-process event dispatch with a broker,
replace public-service reads with API/async replication. No module is designed to
share tables or in-memory state with another.
