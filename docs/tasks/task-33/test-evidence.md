# Task 33 / C-46 — Test Evidence

This file records the exact local and CI test evidence for the Warehouse
master-data regression-test hardening described in `implementation-report.md`.
It is updated with the real GitHub Actions run details once CI has executed
on the pushed commit; nothing below is claimed without having been directly
observed.

## Local fast verification (observed on this machine, no Postgres)

Run from `backend/`:

| Command | Result |
|---|---|
| `npm run typecheck` | PASS — 0 errors |
| `npm run lint` | PASS — 0 errors (1 pre-existing, unrelated warning in `src/modules/accounting/application/coding-structure-accounts.spec.ts:896`) |
| `npm run format:check` | PASS — clean |
| `npm run build` | PASS |
| `npx vitest run src/modules/inventory/application/warehouses.service.spec.ts` | PASS — 24/24 tests |
| `npx vitest run src/modules/organization/application/master-data-authorization.spec.ts` | PASS — 25/25 tests |
| `npx vitest run --config vitest.config.e2e.ts test/master-data.e2e-spec.ts` | PASS — 41/41 tests |
| `npx vitest run --config vitest.config.e2e.ts test/warehouse-master-live.e2e-spec.ts` | 5/5 tests **skipped** (no `VARDENA_TEST_DATABASE_URL` locally) — confirms the opt-in gate behaves correctly |
| `npm test` (full hermetic unit suite) | PASS — 120 files / 1391 tests |

`npm run test:e2e` (the full suite, which would also attempt the live spec
if a database URL were present) was intentionally **not** run locally, per
this task's binding policy that all PostgreSQL/live-E2E verification must
happen in GitHub CI.

## CI evidence (GitHub Actions)

Status: **PENDING** — to be filled in immediately after pushing
`arena/01a0f91f-vardena` and opening/observing the pull request's `backend`
CI job, by inspecting the actual run via `gh run view`/`gh pr checks`, not
assumed from the workflow file alone.

Required fields once available:
- PR URL / run URL:
- Run ID and conclusion:
- `backend` job step results (prisma validate/generate, lint, typecheck,
  format:check, unit tests, build, migrate deploy, bootstrap system admin,
  migration rehearsal, **E2E tests (incl. live-DB suites)**):
- Specific confirmation that `test/warehouse-master-live.e2e-spec.ts` ran
  (not skipped) and its 5 tests passed, quoting the relevant log lines.
- Specific confirmation that the extended `test/master-data.e2e-spec.ts`
  (41 tests) passed in the hermetic e2e run within the same job.
- Any failures encountered and how they were fixed, with a reference to the
  follow-up commit SHA.
