# ADR-0010: DB-Backed Job Queue (No External Broker in v1)

Status: Accepted
Date: 2026-09-10

## Context

Background work is required: outbox dispatch, PDF rendering, heavy Excel import
apply, heavy report generation, scheduled tasks. Introducing a message broker
(Redis/RabbitMQ) would add a major infrastructure dependency (violating
ADR-0002's fixed stack without a strong architectural reason) and an extra
operational component for on-premise deployments, while v1 throughput is modest
(ERP scale: dozens, not millions, of jobs/day).

## Decision

- **DB-backed queue** in PostgreSQL: `jobs.job_runs` (id, name, type, payload,
  status `queued|running|succeeded|failed|canceled`, scheduled_at, locked_by,
  locked_at, attempts, max_attempts, error, actor, timestamps), claimed with
  `FOR UPDATE SKIP LOCKED`.
- The **worker process** (same NestJS codebase, `worker.ts`) runs: the outbox
  dispatcher loop, the generic job runner, and scheduled tasks (NestJS
  scheduler). Multiple worker replicas may run — the queue is concurrency-safe
  by construction.
- **Outbox dispatch reuses the same mechanics** (claim → execute → terminal
  state) with its richer status/retry model (ADR-0004).
- Jobs are **idempotent** (safe re-run after crash) and **deterministic in
  inputs** (payload self-contained; no reliance on request context).
- Failure semantics: bounded attempts → `failed` (final) → audit + admin
  notification; manual retry from admin UI (new run, same payload).
- **Escape hatch:** if v1.x shows sustained throughput/latency limits, a broker
  may be introduced behind the same queue port — an ADR at that time; job
  definitions and consumer code do not change.

## Consequences

- One fewer infrastructure component; everything inspectable in the same
  database (operations-friendly on-premise; good for AI-agent debuggability).
- Postgres is now on the critical path for async work — acceptable at ERP
  scale; monitor queue depth (a growth signal for the broker escape hatch).
- Crash recovery: `running` rows with expired `locked_at` are re-claimable
  (lease timeout) — dispatcher/runner implementation detail.
- Ordering not guaranteed across jobs; per-entity ordering where it matters is
  handled at the caller (e.g. outbox per-entity sequencing).
