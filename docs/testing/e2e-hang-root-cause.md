# E2E Hang — Root Cause, Repair and Regression Protection

**Status: ROOT CAUSE IDENTIFIED — REPAIRED — REGRESSION-PROTECTED (2026-09-26)**

Canonical record for the recurring report that `npm run test:e2e`
(`backend/`, Vitest + Supertest, `vitest.config.e2e.ts`) "does not terminate
and appears to hang". Treated as a test-infrastructure / lifecycle
reliability defect, investigated diagnose-first: no `--forceExit`-equivalent,
no `.skip`, no timeout increase, no worker reduction, no suite deletion.

---

## 1. Incident

| Field                           | Value                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Symptom                         | Tests report completion but the `npm run test:e2e` process does not exit; or the command is _believed_ to hang because a previous session observed that signature |
| Command                         | `npm run test:e2e` → `vitest run --config ./vitest.config.e2e.ts`                                                                                                 |
| Affected environment            | Development sandboxes running the live-DB path; **never observed in CI** (see §2.2)                                                                               |
| Reproducibility at current HEAD | **Not reproducible** — 8/8 full runs terminated with exit 0 (see §6, Layer 2/3)                                                                                   |
| First recorded occurrence       | Reported before PR **#14** (merged 2026-09-14, "E2E stability: guaranteed app/pool teardown in live suites + harness init failures")                              |
| Containment added later         | PR **#33** (Task 15, 2026-09-23) wrapped the CI E2E step in `timeout 540` + `timeout-minutes: 10` + failure log artifact                                          |

## 2. Evidence

### 2.1 Repository history (recorded)

- **PR #14 (2026-09-14, MERGED)** investigated the originally reported hang.
  Finding, quoted from the PR: the three then-existing live suites
  "ran raw-client FK cleanup in `afterAll` and only then closed the Nest app.
  Any cleanup error (FK/lock/connection failure) skipped `app.close()`,
  orphaning the pg Pool's sockets in the Vitest worker — tests report
  completion but the process stays alive". PR #14 also fixed the harness:
  a rejected `app.init()` now closes the app it could not initialize
  (`test/support/test-app.ts`).
- **PR #33 (Task 15, 2026-09-23, MERGED)** added the CI E2E kill-timeout and
  log-artifact upload. This is **containment/detection, not a fix** — it
  converts a would-be infinite hang into a visible CI failure with logs.

### 2.2 CI history (verified via GitHub API, 2026-09-26)

Every CI `backend` job failure whose failing step was
"E2E tests (incl. live-DB suites)" was inspected
(runs `35061030928`, `35127221215`, `35135301245`, `34963627750`,
`35388699487`, `35916956106`, `35917461492`, `35918193311`, `36073357644`,
`36132173749`):

- **Every failed E2E step completed in 33–90 seconds** — none reached the
  540 s kill-timeout, none was terminated by the runner.
- Every failure has a concrete assertion annotation (e.g.
  `expected 400 "Bad Request", got 200 "OK"`;
  `AccountingDocumentDateUnresolvableError`) — real test failures, not hangs.
- All `cancelled` runs were concurrency-group cancellations
  (`cancel-in-progress` on force-push), not timeouts.

**Conclusion: no E2E hang has ever occurred in CI.** The hang class is a
local/sandbox phenomenon of the live-DB path.

### 2.3 Fresh reproduction attempt (this investigation, 2026-09-26)

Environment: sandbox, Node 22.22.3, npm 10.9.8, 2 CPUs, Vitest 4.1.11
(default `forks` pool), real generated Prisma client (7.10.0), PostgreSQL
16.4 (embedded binaries), all 15 migrations applied in order.

| Run                                                         | Result                                                |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `npm run test:e2e` (default, hermetic)                      | 246 passed / 85 skipped, **exit 0**, 43.3 s           |
| `VARDENA_TEST_DATABASE_URL` set (full live path, first run) | **28 files / 331 passed / 0 skipped, exit 0**, 60.5 s |
| 5 further consecutive full live runs                        | exit 0 every time (63 s / 64 s / 60 s / 68 s / 69 s)  |

### 2.4 Termination-envelope probes (what _can_ and _cannot_ hang this harness)

Four disposable probe specs were run against the project's Vitest 4.1.11
`forks` pool (probes deleted after use; they are documented here, not kept):

| #   | Probe                                                                                                                                         | Observed behavior                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `beforeAll` throws after acquiring resources                                                                                                  | `afterAll` **still runs** → suite-level cleanup hooks are reached on setup failure                                                       |
| P2  | Test leaks a listening TCP server + a non-`unref`'d `setInterval` and passes                                                                  | Run **exits immediately** — Vitest 4 force-terminates fork workers; an in-worker leaked handle can no longer hold the top-level run open |
| P3  | `afterAll` cleanup `DELETE` blocked **forever** on a held PostgreSQL row lock (`FOR UPDATE` from a second session), `pool.end()` in `finally` | `hookTimeout` (default 10 s) fails the hook; run **exits code 1 in 10.2 s** — bounded, no hang                                           |
| P4  | Spec module blocks at **import time** (never-resolving top-level `await`)                                                                     | **`vitest run` hangs indefinitely** (killed only by an external `timeout`) — the import/collection phase has **no timeout**              |

Repository audit for the one unbounded phase (P4): no top-level `await` and
no import-time I/O exists outside the process entrypoints `src/main.ts` /
`src/worker.ts`, which no test imports. The generated Prisma client is
imported lazily (`PrismaService.getClient()`), never at module load.

## 3. Root Cause

**Component:** the live-DB E2E suites' teardown, together with the shared
harness `test/support/test-app.ts`.

**Lifecycle/resource:** the `pg` `Pool` owned by the kernel `PrismaService`
(one pool per Nest application; `test/support/test-app.ts` builds one real
application per suite). Its only deterministic shutdown path is
`app.close()` → `PrismaService.onModuleDestroy()` → `client.$disconnect()` +
`pool.end()`.

**Defect (the hang class):** any test-owned application whose `app.close()`
is reachable **only on the happy path**. Originally (pre-PR #14) the live
suites ran raw-client fixture cleanup _before_ `app.close()` without
`try/finally`; a failing cleanup skipped the close, orphaning the pool's
open sockets inside the Vitest worker after the final assertion — the exact
"tests finished, Node never exits" signature.

**Why existing cleanup did not handle it:** cleanup and close were sequenced
as two ordinary statements, so the first failure aborted the hook before the
owner teardown ran; and a rejected `app.init()` used to orphan the half-built
module the same way.

**Why it appears in E2E only:** only the E2E harness boots full Nest
applications with a real `pg` pool. Unit tests are hermetic (mocked client,
no pool sockets).

**Why it recurred / why earlier attempts did not end it:** PR #14 fixed the
three live suites that existed _then_ and the harness init path — but the
guarantee lived in copied convention only. Ten new E2E suites were added
afterwards; one of them (`test/deployment-scope.e2e-spec.ts`) re-introduced
the pattern: its phase-1 _seed application_ was closed by a mid-hook
`await seedApp.close()` reachable only if every seeding step succeeded. The
CI `timeout 540` added in Task 15 contains the symptom in CI but neither
detects nor fixes the class, and nothing regression-tested the lifecycle
contract — so the class could (and did) silently reappear.

**Bounding note (measured, §2.4):** under the current Vitest 4 `forks` pool
an orphaned in-worker pool no longer holds the _top-level_ run open (P2) —
workers are force-terminated. The defect class remains real: it produces the
historical hang under a threads/inline pool, under `--no-file-parallelism`
debugging, or any runner that waits for worker event loops, and it silently
skips fixture cleanup and hides the original error. The only construct that
hangs the current harness indefinitely is import-time blocking (P4), of
which the repository has none.

## 4. Fix

Smallest change that closes the proven class; production code untouched.

| File                                         | Change                                                                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/test/deployment-scope.e2e-spec.ts`  | Phase-1 seed application wrapped in `try { …seed… } finally { await seedApp.close(); }` — the close is now unskippable, matching every other suite and the ownership rule documented in the harness |
| `backend/test/harness-lifecycle.e2e-spec.ts` | **New** regression suite pinning the lifecycle contract (see §5)                                                                                                                                    |
| `docs/testing/e2e-hang-root-cause.md`        | This record                                                                                                                                                                                         |

Explicitly **not** done: no `--forceExit`/`dangerouslyIgnoreUnhandledErrors`,
no `.skip`/`.only`, no timeout increase, no worker/pool reconfiguration, no
suite serialization, no production `$disconnect()` sprinkling, no CI
behavior change. The CI `timeout 540` is retained **as a tripwire** (a hang
regression must fail CI loudly with uploaded logs), documented here as
detection — the repository does not depend on it to pass.

## 5. Regression Protection

`backend/test/harness-lifecycle.e2e-spec.ts` — runs in the default hermetic
configuration (identical with or without a live database), 3 tests:

1. **`app.close()` ends the pg pool owned by PrismaService** — exercises the
   readiness path once, closes the app, asserts the pool is really ended
   (the exact resource whose leak caused the hang).
2. **A failed `app.init()` still destroys instantiated providers** — an
   injected module throws in `onModuleInit`; asserts `createTestApp` rejects
   _and_ destroy hooks ran _and_ the PrismaService pool is ended (pins the
   PR #14 harness guarantee).
3. **No TCP handles remain after close** — black-box: after `app.close()`
   the worker holds zero `TCP*` active resources (bounded poll, 2 s).

A future teardown-ownership regression now fails these tests deterministically
instead of manifesting as a nondeterministic hang.

## 6. Verification (all executed 2026-09-26 in this investigation's sandbox)

- **Layer 1 — focused:** `vitest run --config ./vitest.config.e2e.ts harness-lifecycle`
  → 3 passed, exit 0, 3.9 s; `… deployment-scope` → 9 passed, exit 0, 3.2 s.
- **Layer 2 — repeated:** 5 consecutive **full live** `npm run test:e2e`
  runs (`VARDENA_TEST_DATABASE_URL` set) before the fix and 3 after the fix
  — every run 28 files passed, exit 0, 60–69 s, no forced exit, no orphan
  process (`ps` clean after each run).
- **Layer 3 — complete E2E:** default hermetic run and full live run both
  exit 0; totals after the fix: default 249 passed / 85 skipped; live
  **334 passed / 0 skipped** (331 baseline + 3 regression tests).
- **Layer 4 — fast gates:** `format:check`, `lint`, `typecheck`,
  `npm test` (unit), `build` — all pass (recorded in the PR/commit).
- **Layer 5 — PostgreSQL:** real PostgreSQL 16.4; the 15 SQL migrations under
  `prisma/migrations/` applied in order (see limitation below); after the
  final run: `pg_stat_activity` shows no leftover connections from test
  runs and no waiting locks.
- **Layer 6 — CI:** CI executes the identical live path
  (`postgres:16` service + `VARDENA_TEST_DATABASE_URL`); verification is the
  PR's CI run. No claim is made for a CI run that has not happened at the
  time this document was written.

## 7. Concurrency Review (requested scope)

Vitest runs suite files in parallel (forks, one per CPU). Reviewed shared
resources on the live path:

- Fixtures are suite-unique (ULID ids, per-suite usernames/codes with random
  suffixes) — no cross-suite row contention on business data.
- The only shared rows are `rbac.permissions`: every app boot upserts the
  same 128 registry rows (`PermissionSyncService`). All boots upsert in the
  identical registry order, so concurrent syncs serialize on row locks and
  cannot form a lock cycle; sync failure is non-fatal by design (logged
  warn). Observed across 6 parallel-suite live runs: no deadlock, no
  measurable wait.
- No static ports (supertest binds ephemeral ports), no shared temp files,
  no global mutable fixtures.

No serialization policy is needed; none was added.

## 8. Remaining Limitations

- The original pre-PR #14 hang environment cannot be replayed; its root
  cause is adopted from the PR #14 record, which this investigation's
  probes are consistent with (P2/P3 show the _current_ pool would bound it).
- `prisma migrate deploy` cannot run in this sandbox (Prisma schema-engine
  download blocked by egress policy); migrations were applied by executing
  each `migration.sql` in timestamp order against PostgreSQL 16.4. CI
  continues to verify the real `migrate deploy` path.
- Import-phase blocking (P4) is unbounded in Vitest by design; no repository
  code triggers it today. If it ever appears, the CI tripwire (§4) turns it
  into a failed step with logs rather than a silent 20-minute job timeout.
- CI job step logs older than the retention window could not be downloaded
  from this sandbox (artifact storage egress-blocked); step timings and
  failure annotations were verified through the GitHub API instead.
