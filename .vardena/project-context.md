# Vardena — Project Context (AI Agent Onboarding)

> **Read this first.** If you are an AI coding agent (or human) starting work in this
> repository, this file is your entry point. Required reading order:
> 1. This file
> 2. `docs/architecture.md`
> 3. `.vardena/architecture-rules.md` and `.vardena/agent-rules.md`
> 4. The specific `docs/*.md` for the area you are working in
> 5. Related ADRs in `docs/adr/`

## What Vardena Is

Vardena is a modern, **modular ERP** for organizations and businesses (primary market:
Iran). It must be extensible — new ERP modules must be addable without architectural
change. It must work **on-premise / local-network** today and remain suitable for
future **cloud** deployment.

Planned capabilities: authentication, user management, roles/permissions (RBAC),
accounting, inventory/warehouse, purchasing (planned), sales, reporting, Excel
import/export, printing, UI/dashboard customization, external integrations,
background jobs, synchronization, audit logging, notifications.

**Vardena is fully independent from any legacy ERP.** A legacy FaraPayam-style ERP
web service is an *external system* integrated through an adapter layer — never the
core of Vardena. Vardena owns its own database, business logic, authentication,
authorization, and API. The frontend talks only to the Vardena API.

## Current Repository State

- **Documentation-only.** No application code exists yet. The directory layouts in
  `docs/architecture.md` are the *target* layout for the first implementation phase.
- The first implementation phase (scaffolding) has **not** started. Do not assume
  existing code patterns; the docs are the source of truth.
- Any ambiguity about business behavior: see `docs/open-questions.md`. **Do not
  invent business rules** (numbering, tax, ledger behavior, approval flows, policies).

## Technology (fixed — see ADR-0002)

| Layer | Technology |
|---|---|
| Backend | NestJS, TypeScript |
| Database | PostgreSQL, Prisma ORM |
| API | REST + generated OpenAPI/Swagger |
| Deployment | Docker (compose: API app, worker app, PostgreSQL) |
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Frontend libs | React Router, TanStack Query, Axios, React Hook Form, Zod, TanStack Table, Day.js |

No additional major technologies without an ADR (`AG-12`, `AR-30`).

## Repository Map

```
.vardena/            ← agent context & rules (this folder)
docs/
  architecture.md    ← system architecture, module anatomy, event model
  modules.md         ← module catalog: responsibilities, boundaries, events
  security.md        ← authn/authz, audit, API security, integration security
  integrations.md    ← external systems, adapter layer, outbox/sync design
  database-strategy.md ← schema-per-module, conventions, migrations, raw SQL policy
  reporting-strategy.md ← reporting architecture, raw SQL policy, export/print
  open-questions.md  ← registered open architectural/business questions (OQ-xx)
  adr/               ← architecture decision records (ADR-xxxx)
backend/             ← (target) NestJS modular monolith + Prisma + worker
frontend/            ← (target) React SPA
docker-compose.yml   ← (target)
```

## Golden Rules (the 10 that matter most)

1. **Modular monolith.** One backend deployable; each module is a self-contained
   domain unit. No microservices (ADR-0001).
2. **Layer purity.** Controllers = transport only. Business logic lives in
   application/domain layers, never in controllers (AR-03/04).
3. **Module boundaries are law.** No cross-module table access. Cross-module side
   effects go through domain events; cross-module reads through the owning module's
   public service or module-owned views (AR-07).
4. **Backend authorization is mandatory.** Every endpoint declares a permission;
   frontend checks are UX only (AR-21).
5. **External integrations only through adapters**, driven by the **Outbox pattern**:
   local transaction → outbox row → worker → adapter → retry → terminal state
   (AR-14, ADR-0004).
6. **Inventory never calls Accounting.** Accounting effects happen by subscribing to
   domain events; mapping rules belong to Accounting (AR-16, ADR-0005).
7. **Database changes only via Prisma migrations.** Raw SQL only where documented
   (module views, reporting, perf-critical paths) — always parameterized (AR-10/11).
8. **Architecture changes require an ADR** before or with the change (AR-29).
9. **Never invent business rules.** Register an OQ in `docs/open-questions.md` and
   ask (AG-09).
10. **Keep changes focused.** No unrelated refactors, no drive-by edits, one concern
    per branch (AG-02/03).

## How to Work Here

Full workflow rules: `.vardena/agent-rules.md`. Architecture rules with rationale:
`.vardena/architecture-rules.md`. In short: feature branch → focused change → tests
for business rules → docs kept in sync → ADR if architecture changed → PR against
`main` (never push to `main` directly).
