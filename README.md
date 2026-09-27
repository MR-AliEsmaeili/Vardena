# Vardena

A modern **modular ERP** system: NestJS + TypeScript + PostgreSQL (Prisma)
backend; React + TypeScript (Vite, Tailwind, shadcn/ui) frontend on the fixed
stack of ADR-0002, whose **first vertical slice is implemented**. Extensible by
design — new ERP modules are added without architectural change. On-premise
today, cloud-ready.

> **Status: backend implemented, frontend at its first vertical slice**
> (current `main` synchronized at `2aae5fba99671639fec4bffeb8877d3bcad09b6a`,
> 2026-09-27; frontend Task 22 **ACCEPTED 2026-09-26**).
> `frontend/` is a React + Vite SPA covering login/session, the RTL
> application shell, organization context, permission-aware navigation and the
> read-only Accounting surfaces (chart tree, account statement, general ledger,
> trial balance) against the real API — see
> [frontend/README.md](frontend/README.md). No other UI exists yet.
> `backend/` is a NestJS modular
> monolith with the kernel (config, validation, errors, logging, correlation,
> Prisma, rate limiting) plus nine registered modules — `health` and the eight
> domain modules **identity, users, rbac, organization, inventory, documents,
> workflow, accounting** — over 8 PostgreSQL schemas and 17 migrations.
> **Accounting** is the most advanced domain (fiscal calendar, chart of
> accounts, configurations, vouchers, posting/ledger, balance projection,
> reversal, read-only account-statement / general-ledger / trial-balance /
> chart-tree surfaces, and a versioned Base Chart template with explicit
> organization adoption). **Not implemented:** Audit, Notifications, Sales,
> Purchasing, Reporting, Excel, Print, Customization, Integration, Sync, Jobs —
> and **Treasury, which is deferred and out of MVP scope**. The docs below stay
> the contract for all future implementation work (human or AI); implementation
> existing in `main` does **not** mean the related task or ADR was accepted —
> Bootstrap System Administrator, Task 23, and Task 24 are merged and CI-green
> but **READY FOR REVIEW — NOT ACCEPTED**; see `STATE.md`.

## Run with Docker

Docker Compose is the zero-configuration quick start. After cloning the
repository, run:

```bash
docker-compose up
```

The command also works with the newer `docker compose` syntax. It builds the
backend images, starts PostgreSQL, applies the Prisma migrations, provisions
the idempotent real Users/RBAC `System Administrator`, and then starts the API
and worker. No `.env` file is required for local use; the compose file supplies
development defaults. The API is available at <http://localhost:3000>, the
liveness probe is at <http://localhost:3000/api/v1/health/live>, and Swagger is
enabled at <http://localhost:3000/api/docs>.

Initial login is `مدیر` / `1`. The password is stored only as an Argon2id hash;
change it immediately through the existing password-reset API because forced
password change is not implemented. The bootstrap creates no organization and
no scope bypass: after creating the initial organization, grant `مدیر` its
ordinary first membership before using organization-scoped capabilities. See
[backend/README.md](backend/README.md) for the exact procedure and limitations.

To stop the stack, press `Ctrl+C`. To remove the containers and the local
PostgreSQL volume as well, run `docker-compose down -v`. Copy `.env.example`
to `.env` only when you need to override ports, credentials, or other
configuration. The default local database is intentionally private to the
Compose network; password authentication should be configured for a shared or
production deployment.

## Start Here

| If you are… | Read |
|---|---|
| An AI coding agent / new contributor | [.vardena/project-context.md](.vardena/project-context.md) (onboarding, mandatory order) |
| Asking "what is actually built and what was accepted?" | [STATE.md](STATE.md) (project memory, task history, review status) + [docs/repository-documentation-audit.md](docs/repository-documentation-audit.md) |
| Reviewing the system design | [docs/architecture.md](docs/architecture.md) |
| Working on a domain | [docs/modules.md](docs/modules.md) + the matching `docs/*.md` |
| Working on the UI | [frontend/README.md](frontend/README.md) + [docs/architecture.md](docs/architecture.md) §7 |
| Changing the architecture | [docs/adr/](docs/adr/) (process in `adr/README.md` — an ADR is required) |
| Asking about behavior that isn't specified | [docs/open-questions.md](docs/open-questions.md) (register an OQ — never invent business rules) |

## Documentation

- [docs/architecture.md](docs/architecture.md) — system architecture, module anatomy, event model, API conventions, deployment
- [docs/modules.md](docs/modules.md) — module catalog, boundaries, event catalog
- [docs/security.md](docs/security.md) — authentication, RBAC, audit, API security
- [docs/integrations.md](docs/integrations.md) — external systems, adapter layer, synchronization
- [docs/database-strategy.md](docs/database-strategy.md) — schemas, conventions, migrations, outbox DDL
- [docs/reporting-strategy.md](docs/reporting-strategy.md) — reporting engine, views, export, performance
- [docs/accounting/domain-contract.md](docs/accounting/domain-contract.md) — **Accounting Domain Contract** (Task 10.1): bounded context, financial area, fiscal year/period, chart of accounts & coding structure, detail dimensions, accounting documents, posting & integration boundaries, invariants, gates. The contract is binding; its foundation, document, posting/ledger and read layers are now **implemented** (see `docs/accounting/task-index.md` for what exists and what is still a candidate)
- [docs/accounting/task-index.md](docs/accounting/task-index.md) — authoritative accounting task sequence, capability status and OQ gates
- [docs/tasks/](docs/tasks/) — per-task briefs, implementation gates, reports and acceptance records
- [docs/repository-documentation-audit.md](docs/repository-documentation-audit.md) — documentation ↔ code consistency audit (2026-09-26), incl. the Treasury scope boundary
- [STATE.md](STATE.md) — consolidated project state: repository/module inventory, task history, review status, risks
- [docs/open-questions.md](docs/open-questions.md) — registered open questions
- [docs/adr/](docs/adr/) — architecture decision records
- [.vardena/](.vardena/) — agent context, architecture rules, development rules
- [backend/README.md](backend/README.md) — backend setup, workflows, conventions
- [frontend/README.md](frontend/README.md) — frontend setup, scripts, layout and conventions
- [docker-compose.yml](docker-compose.yml) — local stack (PostgreSQL + API + worker)
