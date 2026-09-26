# Vardena Backend

NestJS (ESM) modular monolith: one codebase, two processes — **API** (`src/main.ts`)
and **worker** (`src/worker.ts`) — on PostgreSQL + Prisma. This README covers setup
and daily workflows; the architecture contract lives in `docs/` + `.vardena/`
(start at `../.vardena/project-context.md`) and the foundation decisions in
`../docs/adr/0015-backend-foundation-conventions.md`.

> **Scope (verified 2026-09-26):** kernel foundation plus nine registered
> modules — `health` and the eight domain modules **identity, users, rbac,
> organization, inventory, documents, workflow, accounting** — over 8
> PostgreSQL schemas and 16 migrations. **Not implemented here:** Audit,
> Notifications, Sales, Purchasing, Reporting, Excel, Print, Customization,
> Integration, Sync, Jobs — and **Treasury (deferred, out of MVP)**. Do not
> invent them; see `../docs/modules.md` and
> `../docs/repository-documentation-audit.md`.

## Requirements

- Node.js >= 22.12, npm >= 10 (npm 11+ recommended: npm 10's resolver crashes
  on this dependency graph)
- PostgreSQL 16 for anything touching the database (or Docker, see below)
- Network access to `registry.npmjs.org` (install) and `binaries.prisma.sh`
  (`prisma generate` / `migrate` download the schema engine on first use)

## Install

```bash
cd backend
npm install
cp .env.example .env   # then fill in DATABASE_URL (placeholders only in the example)
npm run prisma:generate
```

`prisma:generate` compiles the Prisma Client into `src/generated/prisma/`
(gitignored, compiled with the app). Re-run it after every schema change.
It needs `DATABASE_URL` set (config load) but never connects.

## Configuration

All environment-specific values come from environment variables, validated at
startup by `src/kernel/config/app-config.ts`. Invalid config fails fast with a
message naming every bad key. `.env` files are dev convenience only — real
deployments inject real env (dotenv never overrides real env).

| Key                                | Default               | Notes                                                                                             |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                         | `development`         | `development \| test \| production`                                                               |
| `PORT`                             | `3000`                | API listen port                                                                                   |
| `DATABASE_URL`                     | _(required)_          | `postgresql://` connection string                                                                 |
| `APP_VERSION`                      | `0.0.0-dev`           | release label in health + OpenAPI                                                                 |
| `LOG_LEVEL`                        | `debug` (dev), `info` | `debug \| info \| warn \| error`                                                                  |
| `SWAGGER_ENABLED`                  | `true` except prod    | Swagger UI at `/api/docs`                                                                         |
| `CORS_ORIGINS`                     | _(empty)_             | comma-separated origins; empty = same-origin only                                                 |
| `TRUST_PROXY`                      | `false`               | `true` behind a trusted reverse proxy (client IPs)                                                |
| `RATE_LIMIT_WINDOW_MS`             | `60000`               | per-IP fixed window                                                                               |
| `RATE_LIMIT_MAX`                   | `300`                 | requests per window per IP                                                                        |
| `DEPLOYMENT_ORGANIZATION_ID`       | _(unset)_             | ULID pin confining the deployment to one organization (ADR-0025); unset = structural scoping only |
| `AUTH_COOKIE_NAME`                 | `vardena_session`     | httpOnly session cookie name (ADR-0007)                                                           |
| `AUTH_COOKIE_PATH`                 | `/`                   | cookie path                                                                                       |
| `AUTH_COOKIE_SAME_SITE`            | `lax`                 | `lax \| strict \| none` (default: lax)                                                            |
| `AUTH_COOKIE_SECURE`               | `true` in prod        | `Secure` flag (auto in prod: true; dev/test: false)                                               |
| `AUTH_SESSION_IDLE_TIMEOUT_MS`     | `1800000` (30 min)    | Sliding idle session timeout                                                                      |
| `AUTH_SESSION_ABSOLUTE_TIMEOUT_MS` | `43200000` (12 h)     | Absolute session hard cap                                                                         |
| `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS`  | `900000` (15 min)     | Login-only rate-limit window                                                                      |
| `AUTH_LOGIN_RATE_LIMIT_MAX`        | `10`                  | Login-only max attempts per window                                                                |

Adding a key? Update `app-config.ts`, `.env.example`, and this table together.

## Run

```bash
npm run start:dev          # API with watch
npm run start:worker:dev   # worker with watch (separate terminal)
npm run build              # -> dist/
npm run start:prod         # node dist/main.js
npm run start:worker       # node dist/worker.js
```

The API boots **without** a database (liveness is DB-free; `/ready` reports DB
state). The worker **fails fast** when the database is unreachable — a worker
without the database cannot do its future jobs.

## Tests

```bash
npm test                   # unit (src/**/*.spec.ts, hermetic — no DB, no network)
npm run test:e2e           # e2e (test/*.e2e-spec.ts, boots the real app)
npm run test:cov           # unit with coverage
npm run typecheck && npm run lint && npm run format:check   # quality gates
```

- E2E runs against an intentionally unreachable `DATABASE_URL` (set in
  `vitest.config.e2e.ts`), so the readiness/503 path is deterministic without
  Docker. It also covers correlation ids, validation envelopes, 404s, 429s,
  and the OpenAPI output.
- `test/db.e2e-spec.ts` and every `test/*-live.e2e-spec.ts` suite are the
  **live-database** suites: skipped unless `VARDENA_TEST_DATABASE_URL` is set
  (CI with Postgres). They need a generated client and a migrated database.
- Always build e2e apps via `test/support/test-app.ts` (`createTestApp`) — it
  applies the production HTTP pipeline, so tests can't drift from prod.
- `test/support/validation-probe.ts` is a test-only controller for the global
  validation pipe. It must never be imported from `src/`.

## Prisma & migrations

```bash
npm run prisma:generate    # regenerate the client (after schema edits)
npm run prisma:format      # format *.prisma files
npm run prisma:validate    # validate schema + config
npm run prisma:migrate     # prisma migrate dev (creates a migration)
npm run prisma:deploy      # prisma migrate deploy (production path)
```

Workflow for future agents (AR-10, `docs/database-strategy.md`):

1. Add/edit `prisma/schema/<module>.prisma` (one file per module, models carry
   `@@schema("<module>")`). Never `db push`, never hand DDL, never edit an
   applied migration.
2. `npm run prisma:migrate` (dev DB) — name it `<module>: <intent>`.
3. `npm run prisma:generate`, commit schema + migration + code together.
4. Production/Docker runs `prisma migrate deploy` before app start
   (the compose `migrate` service does exactly this).

Current state (verified 2026-09-26): `prisma/schema/` holds `base.prisma`
(datasource + generator) plus one file per module — `identity`, `users`,
`rbac`, `organization`, `inventory`, `documents`, `workflow`, `accounting` —
with 47 models across those **8 database schemas** (there is no `core`
schema). `prisma/migrations/` contains **16 applied migrations**
(`20260910000000_init` … `20260926000000_organization_membership`), and
`prisma/rehearsal/` holds the Task 11/12/13 migration and freeze rehearsal
fixtures driven by `npm run test:migration-rehearsal` and
`npm run test:operational-freeze-rehearsal`.

## Docker

From the repository root, a fresh clone can be started without creating an
`.env` file:

```bash
docker-compose up
```

The newer `docker compose up` spelling is equivalent. Compose builds the
backend images, waits for PostgreSQL, applies `prisma migrate deploy`, and then
starts `api` and `worker`. The API is available at `http://localhost:3000`;
`/api/v1/health/live` is the liveness probe and `/api/docs` is the local
Swagger UI.

Inside the images, installs run with npm 11 (`node:22-slim` bundles npm 10,
whose resolver crashes on this dependency graph) plus generous fetch
retries/timeouts, and npm tarball downloads are kept in a BuildKit cache mount.
If an image build fails with npm's `Exit handler never called!`, just run the
build again — completed downloads are reused.

The default local database uses trust authentication only on the private
Compose network, so no credential is committed or required for the quick
start. For password authentication or other overrides, copy
`../.env.example` to `../.env`, set `POSTGRES_HOST_AUTH_METHOD`,
`POSTGRES_PASSWORD`, and the matching `DATABASE_URL`, then run Compose again.
Use password authentication for any shared or production deployment. The
image build itself needs network access to `binaries.prisma.sh` (`generate`
downloads the Prisma engines); air-gapped builds must pre-seed or vendor them.

## Swagger / OpenAPI

- UI: `GET /api/docs`, spec JSON: `GET /api/docs-json` (codegen input).
- The spec is generated from backend DTOs (ADR-0014) — DTOs are the contract.
- Disabled in production by default (`SWAGGER_ENABLED`).

## Conventions (read before adding code)

- **URLs:** `/api/v1/...`, kebab-case. Version is explicit per controller;
  `defaultVersion: '1'` is the safety net.
- **Success responses are NOT enveloped.** Return DTOs directly; lists return
  `{ items, total, page, pageSize }` (`kernel/pagination/`).
- **Errors are always** `{ code, message, details?, correlationId }` with a
  stable `code` (`kernel/errors/error-codes.ts`); branch on `code`, never on
  `message`. Throw `AppException.*` for expected failures; anything else
  becomes a generic 500 (full error stays in server logs).
- **Controllers are transport-only** (AR-03): HTTP mapping + DTOs only. No
  Prisma, no branching, no business rules.
- **Validation:** global pipe rejects unknown fields everywhere and transforms
  payloads. DTOs must declare coercions explicitly (`@Type(() => Number)` —
  implicit conversion is off).
- **Correlation id:** `x-correlation-id` in/out; valid ULID/UUID accepted,
  anything else replaced with a server ULID (ADR-0015). `getCorrelationId()`
  is available to logs/errors/audit/outbox.
- **Logging:** JSON lines on stdout (`timestamp, level, message, context?,
correlationId?, ...meta`). Meta is redacted (`kernel/logging/redaction.ts`);
  never log secrets, and never log the raw `DATABASE_URL`
  (`PrismaService.describeConnection()` for labels).
- **Database:** one `PrismaService` per process (lazy client, one `pg` pool).
  Inject it only from module `data/` layers; no cross-module model access
  (AR-07); no generic repositories.
- **Rate limiting:** in-memory fixed window per IP (security.md §5). Health
  probes are exempt. Exact for one API replica; a shared store later would
  need an ADR (new infrastructure).
- **Worker:** no HTTP. Register future job handlers in `JobsRegistry`
  (idempotent handlers, per-job correlation ids). The keep-alive timer is a
  placeholder until the first real scheduler/poll loop owns the lifetime.

## Dependencies

Fixed stack (ADR-0002): NestJS + Prisma + Postgres + REST/Swagger + Docker,
plus first-party Nest packages (validation, Swagger) and tiny focused libs
with documented justification:

| Dependency                                   | Why (platform couldn't do it)                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pg` + `@prisma/adapter-pg`                  | Prisma 7 requires a driver adapter for Postgres                                     |
| `class-validator` / `class-transformer`      | declarative DTO validation + transform (Nest standard)                              |
| `ulid`                                       | correct Crockford-Base32 monotonic ids (ADR-0008); hand-rolling invites subtle bugs |
| `dotenv`                                     | `.env` loading for dev + Prisma CLI config (zero-dep, ubiquitous)                   |
| `supertest`, `vitest`, `@vitest/coverage-v8` | HTTP e2e + ESM-native test runner (Nest 12 ESM starter default)                     |
| `oxlint`, `prettier`, `typescript`           | lint + format + compiler (Nest 12 ESM starter default)                              |

Deliberately **not** added: `@nestjs/throttler` (no Nest 12-compatible release;
fixed-window middleware in `kernel/rate-limit/` instead — revisit when upstream
catches up), `helmet` (static headers suffice pre-SPA; CSP/HSTS re-evaluated
with the frontend, see OQ-06), any broker/queue (ADR-0010: DB-backed).

## Layout

```text
src/
  main.ts            # API entrypoint (bootstrap + listen)
  worker.ts          # worker entrypoint (no HTTP; see its doc comment)
  app.module.ts      # API root (business modules register here)
  worker.module.ts   # worker root
  worker.service.ts  # worker startup gate (DB check + handler listing)
  kernel/            # technical-only primitives (AR-06): config, correlation,
                     # errors, http pipeline, ids, jobs registry, logging,
                     # pagination, Prisma, rate limiting, bootstrap guard
  modules/
    health/          # liveness/readiness probes (NOT a business module)
    identity/        # authentication: login/logout/me, server-side sessions,
                     # session-revocation consumer (subscribes to Users events)
    users/           # user records + administration endpoints; owns the
                     # Users.User.* permission codes
    rbac/            # roles, permission registry (+ DB mirror), assignments,
                     # AuthorizationService/AuthorizationGuard (ADR-0006/0016)
    organization/    # organizations, branches, departments, employees, parties,
                     # principal→organization memberships + scope chokepoint
    inventory/       # item/unit/warehouse master data + movement ledger,
                     # balances, reservations, transfers (ADR-0022)
    documents/       # document types, numbering series/allocations, relations
                     # (ADR-0023)
    workflow/        # versioned definitions/states/transitions, instances,
                     # approvals, automation bindings (ADR-0024)
    accounting/      # fiscal calendar, chart + configurations, vouchers,
                     # posting/ledger, balances, reversal, read surfaces
prisma/
  schema/            # base.prisma (datasource + generator) + one file per module
  migrations/        # the ONLY schema-change mechanism (AR-10)
  rehearsal/         # migration / operational-freeze rehearsal fixtures
test/                # e2e specs + support (harness, validation probe)
```

## Known limitations

- `prisma generate` / `migrate` need network to `binaries.prisma.sh`
  (schema-engine download); restricted sandboxes can't run them — see ADR-0015
  for how the code degrades (actionable error, no crash).
- The `migrate` compose service assumes networked builds (same reason).
- Rate limiting is per-replica in-memory (exact for the single on-prem API).
- RBAC evaluation reads the assignment tables on every request (no permission
  cache — ADR-0016). Immediate revocation over one indexed join; caching is a
  documented revisit point with its invalidation contract.
- User/RBAC endpoints exist and are guarded (`AuthGuard`, `AuthorizationGuard`,
  `@RequirePermission`), but **no seeded users or roles** are created (OQ-14);
  the first administrator must be created out-of-band by the operator
  (OQ-19 tracks the procedure). See `docs/security.md` §3.
- Prisma CLI operations and the live-DB paths were not runnable in this
  sandbox (no Postgres, no network to `binaries.prisma.sh`); CI must be the
  first to prove the `prisma/schema/` + `prisma/migrations/` sibling layout
  (mandated by `architecture.md` §6) is accepted by `migrate dev`/`deploy`.
  If the CLI ever demands co-location, move `migrations/` under
  `prisma/schema/` and update only `migrations.path` in `prisma.config.ts`.
