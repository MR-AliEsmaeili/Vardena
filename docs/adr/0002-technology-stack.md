# ADR-0002: Technology Stack (Fixed Set)

Status: Accepted
Date: 2026-09-10

## Context

The product requirements fix the stack. Allowing ad-hoc additions would fragment
the codebase, raise on-premise operational complexity, and make parallel AI-agent
work inconsistent.

## Decision

The stack is fixed as follows; any addition requires an ADR (AR-30):

- **Backend:** NestJS + TypeScript; PostgreSQL + Prisma; REST API with generated
  OpenAPI/Swagger; Docker.
- **Frontend:** React + TypeScript + Vite; Tailwind CSS + shadcn/ui; React
  Router; TanStack Query; Axios; React Hook Form; Zod; TanStack Table; Day.js.
- **Processes:** two entrypoints from the same codebase — `api` and `worker`
  (outbox dispatch, PDF rendering, heavy imports/reports, scheduled jobs).
- Within the NestJS ecosystem, standard first-party packages are allowed
  without a new ADR (validation, throttler, schedule, OpenAPI generation,
  testing utilities).

## Consequences

- Small, known dependency surface; on-premise images stay lean and stable.
- Worker shares code with the API: event schemas, adapters, and domain logic are
  defined once.
- Constrained choice forces good design inside the fixed set (e.g. DB-backed
  queue instead of a broker — ADR-0010; headless Chromium for PDF — ADR-0012).
- If a capability truly cannot be met (e.g. a specific Excel engine), the gap
  is resolved as an ADR or OQ, never by silent dependency drift.
