# Vardena

A modern **modular ERP** system: NestJS + TypeScript + PostgreSQL (Prisma)
backend, React + TypeScript (Vite, Tailwind, shadcn/ui) frontend. Extensible by
design — new ERP modules are added without architectural change. On-premise
today, cloud-ready.

> **Status: architecture + backend foundation.** `backend/` holds the NestJS API +
> worker foundation (config, validation, errors, logging, health, Prisma,
> Docker). No business modules exist yet — the docs below remain the contract
> for all future implementation work (human or AI).

## Run with Docker

Docker Compose is the zero-configuration quick start. After cloning the
repository, run:

```bash
docker-compose up
```

The command also works with the newer `docker compose` syntax. It builds the
backend images, starts PostgreSQL, applies the Prisma migrations, and then
starts the API and worker. No `.env` file is required for local use; the
compose file supplies development defaults. The API is available at
<http://localhost:3000>, the liveness probe is at
<http://localhost:3000/api/v1/health/live>, and Swagger is enabled at
<http://localhost:3000/api/docs>.

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
| Reviewing the system design | [docs/architecture.md](docs/architecture.md) |
| Working on a domain | [docs/modules.md](docs/modules.md) + the matching `docs/*.md` |
| Changing the architecture | [docs/adr/](docs/adr/) (process in `adr/README.md` — an ADR is required) |
| Asking about behavior that isn't specified | [docs/open-questions.md](docs/open-questions.md) (register an OQ — never invent business rules) |

## Documentation

- [docs/architecture.md](docs/architecture.md) — system architecture, module anatomy, event model, API conventions, deployment
- [docs/modules.md](docs/modules.md) — module catalog, boundaries, event catalog
- [docs/security.md](docs/security.md) — authentication, RBAC, audit, API security
- [docs/integrations.md](docs/integrations.md) — external systems, adapter layer, synchronization
- [docs/database-strategy.md](docs/database-strategy.md) — schemas, conventions, migrations, outbox DDL
- [docs/reporting-strategy.md](docs/reporting-strategy.md) — reporting engine, views, export, performance
- [docs/open-questions.md](docs/open-questions.md) — registered open questions
- [docs/adr/](docs/adr/) — architecture decision records
- [.vardena/](.vardena/) — agent context, architecture rules, development rules
- [backend/README.md](backend/README.md) — backend setup, workflows, conventions
- [docker-compose.yml](docker-compose.yml) — local stack (PostgreSQL + API + worker)
