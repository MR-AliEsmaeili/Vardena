# Vardena

Owner-only licensing administration is a **separate application**: see
[`owner-licensing/`](owner-licensing/README.md). It is not part of customer
Vardena builds, runtime configuration, database or production images.

A modern **modular ERP** system: NestJS + TypeScript + PostgreSQL (Prisma)
backend; React + TypeScript (Vite, Tailwind, shadcn/ui) frontend on the fixed
stack of ADR-0002, whose **first vertical slice is implemented**. Extensible by
design — new ERP modules are added without architectural change. On-premise
today, cloud-ready.

> **Status: backend foundations and a bounded frontend are implemented**
> (current-state audit: `main` at
> `34dddfd60d6ce2f9d4599bd05b440556a80aa847`, 2026-09-29).
> `frontend/` is a React + Vite SPA covering login/session, the RTL
> application shell, organization context, permission-aware navigation, the
> read-only Accounting surfaces (chart tree, account statement, general ledger,
> trial balance), and the real-data Dashboard corrected by PR #86 — see
> [frontend/README.md](frontend/README.md). Accounting write UI has since been
> added (voucher lifecycle, plus period opening, chart-structure activation
> and account creation for fresh organizations; see
> `docs/accounting/operational-readiness-audit-2026-10-24.md`). It still has no
> Inventory/Workflow administration UI, RBAC administration UI, or Treasury UI.
> `backend/` is a NestJS modular monolith with the kernel plus nine registered
> modules — `health` and the eight domain modules **identity, users, rbac,
> organization, inventory, documents, workflow, accounting** — over 8
> PostgreSQL schemas, 55 Prisma models, 18 migrations, 48 controllers, and 142
> registered permission codes.
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

Docker Compose is the quick start. After cloning the repository, create a
local, untracked `.env` from the template and configure the one-time initial
administrator password (`.env` is gitignored — never commit a real credential):

```bash
cp .env.example .env
# Edit .env and set BOOTSTRAP_SYSTEM_ADMIN_PASSWORD to a local-only value
# (8–128 characters, not CHANGE_ME).
docker-compose up
```

The command also works with the newer `docker compose` syntax. It builds the
backend images, starts PostgreSQL, applies the Prisma migrations, provisions
the idempotent real Users/RBAC `System Administrator`, and then starts the API
and worker. `docker-compose.yml` passes `BOOTSTRAP_SYSTEM_ADMIN_PASSWORD`
through to the bootstrap with an empty default — **no placeholder or default
password is supplied**. A fresh installation must configure the variable
explicitly (in the untracked `.env` or in the shell environment): when `مدیر`
does not exist yet and the variable is missing, the bootstrap fails with a
clear error instead of provisioning a known credential. Subsequent starts of an
already-provisioned installation may leave it unset. The API is available at
<http://localhost:3000>, the liveness probe is at
<http://localhost:3000/api/v1/health/live>, and Swagger is enabled at
<http://localhost:3000/api/docs>.

API Docker health uses HTTP readiness; the non-HTTP worker uses its own
DB-backed heartbeat probe. See [health checks and troubleshooting](docs/operations/worker-healthcheck.md)
for effective-probe inspection and safe deployment (no database-volume deletion).

Initial login is `مدیر` with the initial password you configured via
`BOOTSTRAP_SYSTEM_ADMIN_PASSWORD` (required when provisioning a new `مدیر`
account; never a fixed default). The password is stored only
as an Argon2id hash and the newly provisioned administrator is flagged with
`mustChangePassword = true`: on first login, all protected business APIs are
blocked until the password is changed via `POST /api/v1/auth/change-password`
(or the forced password-change screen in the UI). Subsequent bootstrap runs are
idempotent and neither require `BOOTSTRAP_SYSTEM_ADMIN_PASSWORD` nor overwrite
an existing `مدیر` password. The bootstrap grants no scope bypass: with
`DEPLOYMENT_ORGANIZATION_ID` configured it provisions that single organization
and `مدیر`'s ordinary membership, so organization-scoped APIs work at first
login; without it, create the initial organization and grant `مدیر` its ordinary
first membership before using organization-scoped capabilities. See
[backend/README.md](backend/README.md) for the exact procedure and limitations.

To stop the stack, press `Ctrl+C`. To remove the containers and the local
PostgreSQL volume as well, run `docker-compose down -v`. The untracked `.env`
file carries your local configuration, including
`BOOTSTRAP_SYSTEM_ADMIN_PASSWORD` for a fresh bootstrap; copy `.env.example`
to `.env` for ports and other settings as needed. The default local database
is intentionally private to the
Compose network; password authentication should be configured for a shared or
production deployment.

## Start Here

| If you are…                                            | Read                                                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| An AI coding agent / new contributor                   | [.vardena/project-context.md](.vardena/project-context.md) (onboarding, mandatory order)                                                              |
| Asking "what is actually built and what was accepted?" | [STATE.md](STATE.md) + [docs/current-state-reconciliation.md](docs/current-state-reconciliation.md) (current audited state), with [docs/repository-documentation-audit.md](docs/repository-documentation-audit.md) retained as the 2026-09-26 historical audit |
| Planning or proposing the next MVP work                | [docs/roadmap/backend-mvp-roadmap.md](docs/roadmap/backend-mvp-roadmap.md) (read before proposing or implementing future work)                        |
| Reviewing the system design                            | [docs/architecture.md](docs/architecture.md)                                                                                                          |
| Working on a domain                                    | [docs/modules.md](docs/modules.md) + the matching `docs/*.md`                                                                                         |
| Working on the UI                                      | [frontend/README.md](frontend/README.md) + [docs/architecture.md](docs/architecture.md) §7                                                            |
| Changing the architecture                              | [docs/adr/](docs/adr/) (process in `adr/README.md` — an ADR is required)                                                                              |
| Asking about behavior that isn't specified             | [docs/open-questions.md](docs/open-questions.md) (register an OQ — never invent business rules)                                                       |

## Documentation

- [docs/roadmap/backend-mvp-roadmap.md](docs/roadmap/backend-mvp-roadmap.md) — **Backend MVP Roadmap**: the planned path from the current repository state to Backend MVP, with the dependency matrix ([backend-mvp-dependency-matrix.md](docs/roadmap/backend-mvp-dependency-matrix.md)) and the Future Task Candidate Register ([future-task-candidates.md](docs/roadmap/future-task-candidates.md)). The current Owner-directed scope requires Foundation, Accounting, Full Inventory/Warehouse, Party/Customer, Sales, Sales → Accounting, Inventory → Accounting, Reporting, and Electronic Books/Tax Accounting; Purchasing, Purchasing → Accounting, Purchasing Reports, and Treasury remain post-MVP. This roadmap describes the planned path from the current repository state to Backend MVP. **It does not itself authorize implementation or accept future work** — future agents must read it before proposing or implementing MVP work, and the repository wins on any conflict.
- [docs/architecture.md](docs/architecture.md) — system architecture, module anatomy, event model, API conventions, deployment
- [docs/modules.md](docs/modules.md) — module catalog, boundaries, event catalog
- [docs/security.md](docs/security.md) — authentication, RBAC, audit, API security
- [docs/integrations.md](docs/integrations.md) — external systems, adapter layer, synchronization
- [docs/database-strategy.md](docs/database-strategy.md) — schemas, conventions, migrations, outbox DDL
- [docs/reporting-strategy.md](docs/reporting-strategy.md) — reporting engine, views, export, performance
- [docs/accounting/domain-contract.md](docs/accounting/domain-contract.md) — **Accounting Domain Contract** (Task 10.1): bounded context, financial area, fiscal year/period, chart of accounts & coding structure, detail dimensions, accounting documents, posting & integration boundaries, invariants, gates. The contract is binding; its foundation, document, posting/ledger and read layers are now **implemented** (see `docs/accounting/task-index.md` for what exists and what is still a candidate)
- [docs/accounting/task-index.md](docs/accounting/task-index.md) — authoritative accounting task sequence, capability status and OQ gates
- [docs/tasks/](docs/tasks/) — per-task briefs, implementation gates, reports and acceptance records
- [docs/current-state-reconciliation.md](docs/current-state-reconciliation.md) — current repository-wide truth matrix, governance reconciliation, Task 32 correction and drift log at exact audited SHA
- [docs/repository-documentation-audit.md](docs/repository-documentation-audit.md) — historical documentation ↔ code consistency audit (2026-09-26), incl. the Treasury scope boundary
- [STATE.md](STATE.md) — consolidated project state: repository/module inventory, task history, review status, risks
- [docs/open-questions.md](docs/open-questions.md) — registered open questions
- [docs/decisions/product/](docs/decisions/product/) — product/business decision records (OQ/PDR), incl. the 2026-10-05 governance re-baseline: OQ-54 document editing policy (edit until Accounting Post, then cancel/correct only), OQ-49 Report Builder scope, PDR-06 Initial Usable Product / V1 definition
- [docs/decisions/product/PDR-11-vardena-licensing-product-requirements.md](docs/decisions/product/PDR-11-vardena-licensing-product-requirements.md) — **Vardena licensing product requirements** (Owner-approved source of truth, 2026-10-11; documentation only, not an implementation specification; open items and conflicts with existing licensing ADRs listed in §15 and §19). Implemented foundation: [docs/licensing-architecture.md](docs/licensing-architecture.md)
- [docs/operations/backup-and-restore.md](docs/operations/backup-and-restore.md) — backup/restore/export operational policy (Business Export ≠ Disaster Recovery Backup; restore is admin-only via Runbook)
- [docs/frontend/ux/document-editing-and-system-alerts.md](docs/frontend/ux/document-editing-and-system-alerts.md) — frontend UX contracts for document editing warnings, system alerts, Report Builder scope and license Grace/Read-Only
- [docs/adr/](docs/adr/) — architecture decision records
- [.vardena/](.vardena/) — agent context, architecture rules, development rules
- [backend/README.md](backend/README.md) — backend setup, workflows, conventions
- [frontend/README.md](frontend/README.md) — frontend setup, scripts, layout and conventions
- [docker-compose.yml](docker-compose.yml) — local stack (PostgreSQL + API + worker)
