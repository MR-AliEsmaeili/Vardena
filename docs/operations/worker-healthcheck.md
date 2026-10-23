# Docker API and worker health checks

## Cause and scope

At baseline `cdd242bc4250bc16d57e2b77827b43de24abb4f3`, the production
[Dockerfile](../../backend/Dockerfile) supplied an HTTP readiness probe to
**both** processes. [Compose](../../docker-compose.yml) changed the worker's
command, but not its inherited healthcheck. The
[worker entrypoint](../../backend/src/worker.ts) uses
`NestFactory.createApplicationContext(WorkerModule)`, never `listen()`;
`WorkerModule` has no HTTP controllers. Its successful DB startup message
therefore did not imply a listener on port 3000. A refused HTTP probe could mark
a correctly running worker unhealthy; the log about zero registered handlers
is informational, not an error.

This fix preserves ADR-0010/ADR-0015: same image/codebase, separate non-HTTP
process, existing DB startup gate and idle keep-alive. No jobs, outbox,
HTTP listener, dependency, migration or product policy is added.

## Health contract

- **API:** unchanged image default: HTTP `GET /api/v1/health/ready`; a real
  `PrismaService.checkHealth()` (`SELECT 1`) must succeed. DB failure is 503.
- **Worker:** Compose explicitly runs `node dist/worker-healthcheck.js`.
  After application initialization, the worker serially probes the DB through
  its **own existing Prisma client/pool**, immediately and then 10 seconds after
  each completion. It atomically publishes `{pid, checkedAtMs, databaseUp}` in
  `$TMPDIR/vardena-worker-health.json` (normally `/tmp`, mode `0600`). There are
  no credentials or business dates in this ephemeral runtime telemetry.
- The probe requires valid contents, a successful DB result, age **less than
  30 seconds**, no future timestamp, and a live publishing PID. It does not boot
  Nest, open a second DB client, contact the API, or equate PID existence with
  readiness. Query **start** time is used so a slow completion cannot renew old
  evidence. DB errors publish `databaseUp: false`; a stuck query, stalled event
  loop or failed file write cannot refresh success. Probes never overlap.
- Startup clears previous evidence **before** configuration/DB initialization.
  SIGTERM/SIGINT stops publication and removes the file before closing Prisma;
  late in-flight results cannot restore readiness.
- Docker retains `interval=30s`, `timeout=5s`, `start_period=20s`, `retries=3`
  for both services. Detection is bounded, not instantaneous: stale evidence
  expires after 30 seconds, then Docker's sampling/retry window also applies.
  Docker `unhealthy` alone does **not** restart a running container.

One worker process per container; do not share/persist its temporary health
file. Outside Compose, overriding the image command to `dist/worker.js` also
requires `--health-cmd='node dist/worker-healthcheck.js'`: the shared image's
default deliberately remains the API probe. This signal verifies current
startup/DB/event-loop health, **not** job throughput, queue lag or future job
handler correctness. Extend it alongside any separately approved Jobs/Sync loop.

## Deploy and troubleshoot (no data deletion)

From the repository root, with the existing local configuration/bootstrap:

```bash
docker compose build api worker
docker compose up -d api worker
docker compose ps
# Inspect each effective probe separately; these commands do not dump env/secrets.
docker inspect --format '{{json .Config.Healthcheck}}' "$(docker compose ps -q api)"
docker inspect --format '{{json .Config.Healthcheck}}' "$(docker compose ps -q worker)"
docker inspect --format '{{json .State.Health}}' "$(docker compose ps -q worker)"
docker compose exec -T worker node dist/worker-healthcheck.js
docker compose logs --tail=80 api worker
```

Expect API's HTTP probe and worker's CLI probe, then both `healthy` once the
DB is available. A generic CLI failure means missing/invalid/stale evidence,
DB failure or a dead publisher; inspect worker/PostgreSQL logs and temporary
filesystem permissions. Never repair this by deleting `pgdata`, changing
migrations, disabling the check, or calling the API from the worker probe.

## Regression verification

FAST-LOCAL: `cd backend && npm test -- src/worker-health.spec.ts
src/worker.service.spec.ts src/modules/health/application/health.service.spec.ts`
(run as one command). Real temporary files/live PID cover missing/malformed/
stale/future signals, DB failure/recovery, hung/slow checks, write failure and
shutdown races; controlled DB outcomes are **not** live-database evidence.

CI-LIVE-DB: `npm run test:worker-health:docker -- --postgres-container <CI-id>`
requires the already-built `vardena-customer-check` image and
`VARDENA_TEST_DATABASE_URL`. It starts the **real Compose** API/worker commands
against migrated PostgreSQL on a test-owned network (only probe cadence and
restart policy are shortened for deterministic observation). It inspects both
effective probes, reproduces failure of the inherited API probe in a healthy
worker, disconnects/reconnects each process from the DB, stops/resumes only the
worker PID to prove expiry, verifies graceful shutdown/restart, and checks
failed DB startup cannot reuse a seeded heartbeat. No dependency mocks, DB
volume removal or PostgreSQL stop; it cleans up only its containers/network.
Existing API health E2E and the full backend CI gates remain required.
