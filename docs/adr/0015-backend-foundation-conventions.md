# ADR-0015: Backend Foundation Conventions

Status: Accepted
Date: 2026-09-10

## Context

The architecture docs fix shapes (error envelope, correlation ids, health
probes, Prisma layout) but leave foundation-level details open. The first
implementation must pin them so later agents build on one convention.

## Decision

1. **Correlation ids:** accept a client `x-correlation-id` iff it is a valid
   ULID or UUID, else replace with a server ULID; echo on every response;
   ambient via AsyncLocalStorage for logs/errors/audit/outbox.
2. **Errors:** every failure renders
   `{ code, message, details?, correlationId }` (extends architecture §9 with
   the id the mission requires on errors); stable codes in
   `kernel/errors/error-codes.ts`; unknown routes render `EntityNotFound`
   via an Express fallback (else Express leaks HTML 404s).
3. **Health:** `GET /api/v1/health/live` (process alive, no DB) and
   `/ready` (DB probe; any failure → 503 `ServiceUnavailable`).
4. **DB availability split:** the API boots without the DB (lazy client;
   readiness is the signal); the worker fails fast without it (useless
   otherwise). Prisma Client loads lazily with an actionable
   "run prisma:generate" error when codegen has not run.
5. **Logging:** JSON lines on stdout; secrets redacted by key; level from
   config; health probes log at debug.
6. **Rate limiting:** dependency-free in-memory fixed window per IP
   (`@nestjs/throttler` has no Nest 12 release); health exempt; revisit
   when upstream catches up; a shared store later needs an ADR.
7. **Prisma 7 + ESM:** multi-file schema in `prisma/schema/`, generated
   client compiled with the app at `src/generated/prisma/`; initial
   migration creates only the kernel-owned `core` schema.
8. **Worker lifetime:** a documented keep-alive holds the loop until the
   first real scheduler/poll loop (Jobs/Sync) replaces it.
9. **Docker:** one image, `production` target for API/worker, `migrate`
   one-shot from the `build` target (`migrate deploy` before start).

## Consequences

- One documented convention per concern; reviewable in `backend/README.md`.
- Sandbox-verifiable except Prisma CLI ops (need `binaries.prisma.sh`)
  and live-DB paths (covered by skippable integration tests + CI).
- Throttler/helmet choices are revisit points, recorded, not drift.
