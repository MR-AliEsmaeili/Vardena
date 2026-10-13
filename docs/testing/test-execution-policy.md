# Test Execution Policy — Local Fast Gates vs CI Delegation

Status: **Authoritative** · Date: 2026-09-26 · Type: testing policy (execution environments)

This document records WHERE tests execute, not WHAT is covered. It is an
**execution-environment decision: no coverage is reduced by it.** Every suite
listed under a CI gate below runs on CI for every pull request and every push
to `main` **whenever the change set can affect it**
(`.github/workflows/ci.yml`); the pipeline is change-aware, so a
documentation-only pull request runs no database, no dependency install and no
build, while any change under `backend/**` — including the Prisma schema and
migrations — still runs the full backend, migration, live-DB and
generated-client verification. The exact path-to-job matrix, the merge contract
and the fail-safe rules are recorded in
`docs/operations/ci-minutes-optimization.md`; the always-running `ci-gate` job
fails when a job the change set requires did not succeed, and the classification
itself is unit-tested in CI. The FAST-LOCAL/CI-* classification below exists so
that a development sandbox (which may lack Docker, a PostgreSQL service, or
network access to engine/registry hosts) never silently substitutes a weaker
local approximation for the authoritative environment.

---

## 1. Local Fast Gates (FAST-LOCAL)

Safe and deterministic in any checkout; no database, no network services, no
long-lived processes:

| Gate | Command |
|---|---|
| Format check | `npm run format:check` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Unit tests (hermetic) | `npm test` |
| Targeted unit tests | `npx vitest run <file>` |
| Build | `npm run build` |
| Prisma schema validation | `npm run prisma:validate` (needs `DATABASE_URL` present; never connects) |
| Prisma client generation | `npm run prisma:generate` |
| Static analysis / schema inspection | repository searches, schema/code review, small deterministic scripts |

Notes:

- `prisma:validate`/`prisma:generate` need the `DATABASE_URL` key to be
  *present* but never connect; a sandbox without network access to
  `binaries.prisma.sh` cannot download the schema engine. In that case the
  gates are **delegated to CI** and the limitation is documented in the task
  report — never silently skipped.
- Unit tests are fully hermetic (`vitest.config.ts` → `src/**/*.spec.ts`):
  in-memory fakes only, no Prisma connection.

## 2. CI Heavy Gates (CI-HEAVY)

End-to-end suites over the production HTTP pipeline
(`npm run test:e2e`, `vitest.config.e2e.ts`). Hermetic variants run with an
intentionally unreachable `DATABASE_URL`; live variants are opt-in via
`VARDENA_TEST_DATABASE_URL`. Run **only** on CI. A local execution is not a
substitute: CI is the authoritative environment (same Node, same npm, same
runner image every time), and heavy local runs have historically hung
sandboxes (see `e2e-hang-root-cause.md`).

## 3. CI Live-DB Gates (CI-LIVE-DB)

The `describe.skipIf(VARDENA_TEST_DATABASE_URL === undefined)` suites that
boot the real application against the `postgres:16` service container
(`account-*-live.e2e-spec.ts`, `*-live.e2e-spec.ts`). **Only** CI provisions
that database; never reproduced locally.

## 4. CI Migration Gates (CI-MIGRATION)

`npm run prisma:deploy` (real `migrate deploy` against the service
container), the Task 11 configuration-foundation rehearsal
(`test:migration-rehearsal`), and the Task 13 operational-freeze rehearsal
(`test:operational-freeze-rehearsal`). Migration rehearsals exercise shadow
databases and engine downloads; they are CI-only.

## 5. CI Concurrency Gates (CI-CONCURRENCY)

Lock-contention, deadlock-ordering and multi-transaction behaviour
(`balance-lock-order.spec.ts` against live PostgreSQL inside the live-DB
suites, and any future dedicated concurrency suites). Single-process
sandboxes cannot produce the interleavings these suites exist to catch.

---

## Rules

1. **Classify before running.** If uncertain whether a suite is FAST-LOCAL,
   default to CI.
2. **Never weaken a suite to make it local-runnable** — no ignored failures,
   no `continue-on-error`, no skipped E2E/PostgreSQL, no reduced assertions,
   no timeout increases to hide failure, no forced exit codes. A red CI suite
   is fixed, not circumvented (the `timeout 540 npm run test:e2e` CI step is
   a detection tripwire, not a tuning knob).
3. **Diagnose CI failures from CI logs first.** Do not reproduce a failed
   CI-heavy test locally unless the reproduction is fast and safe or the
   Owner explicitly requests it.
4. **Reporting discipline.** Distinguish `Local verification:` /
   `CI verification:` / `Not yet verified:`. A CI test is "passed" only when
   the GitHub Actions run actually completed successfully; a local test is
   "passed" only when it was actually executed. Task reports must include the
   TEST EXECUTION MATRIX and the line *"No heavy E2E/live-DB test was executed
   locally unless explicitly authorized."*
5. **A needed test CI does not run** → if permanent and valuable, add an npm
   script plus a dedicated deterministic CI step and document why; if a
   temporary probe, do not run it locally when heavy — document it as an
   investigation limitation.
6. **Hang protection.** If a heavy test accidentally starts locally and
   misbehaves: stop it safely, do not classify it as a product failure, do
   not alter the test, move verification to CI, and record *"Local heavy-test
   execution intentionally not used. CI is the authoritative execution
   environment."*
7. **Change-aware CI never reduces required coverage.** The classifier
   (`scripts/ci-classify-scope.py`) may skip a job only when the changed paths
   cannot affect it; uncertainty runs the job, and any path it cannot classify
   runs every job. Skipping a suite for a change that *can* affect it, weakening
   a suite to make a run cheaper, or making a required job skippable while
   `ci-gate` is not a required check, is a policy violation rather than an
   optimization. See `docs/operations/ci-minutes-optimization.md`.
