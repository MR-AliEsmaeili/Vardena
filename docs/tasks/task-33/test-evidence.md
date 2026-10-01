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

Status: **OBSERVED — GREEN**, with one disclosed retrieval limitation (read
the caveat below before trusting this section).

- PR: [#104](https://github.com/MR-AliEsmaeili/Vardena/pull/104) —
  `arena/01a0f91f-vardena` → `main`.
- Run: [36922724152](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/36922724152)
  — event `pull_request`, head SHA `8dfc8556b71db65821c104e0d11648e762a13962`
  (the commit containing exactly the files listed in `implementation-report.
  md` FILES CHANGED), `status=completed`, `conclusion=success`, started
  2026-10-01T20:35:46Z.
- `backend` job (ID `110572464981`, `conclusion=success`,
  2026-10-01T20:35:50Z → 20:40:28Z, 4m38s), fetched directly from the GitHub
  REST API (`gh api repos/.../actions/jobs/110572464981`), per-step
  conclusion:

  ```
  [success]  1 Set up job
  [success]  2 Initialize containers
  [success]  3 Checkout
  [success]  4 Setup Node.js
  [success]  5 Upgrade npm to v11
  [success]  6 Install dependencies
  [success]  7 Prisma validate
  [success]  8 Prisma generate
  [success]  9 Lint
  [success] 10 Typecheck
  [success] 11 Format check
  [success] 12 Unit tests
  [success] 13 Build
  [success] 14 Migrate test database
  [success] 15 Bootstrap system administrator
  [success] 16 Migration rehearsal (populated pre-Task-11 data)
  [success] 17 E2E tests (incl. live-DB suites)
  [skipped] 18 Upload backend logs on failure   <- correctly skipped: only runs `if: failure()`
  [success] 34 Post Setup Node.js
  [success] 35 Post Checkout
  [success] 36 Stop containers
  [success] 37 Complete job
  ```

- `frontend` job (ID `110572465669`): `conclusion=success`, 2m22s —
  unaffected by this task (no frontend file was changed); included for
  completeness since it is part of the same CI run.
- Step 17, **"E2E tests (incl. live-DB suites)"**, is exactly
  `timeout 540 npm run test:e2e` from `.github/workflows/ci.yml`, run with
  `VARDENA_TEST_DATABASE_URL` pointing at the job's real `postgres:16`
  service (already migrated in step 14). Since `npm run test:e2e` is
  `vitest run --config vitest.config.e2e.ts`, which (per `backend/test/
  warehouse-master-live.e2e-spec.ts`'s own `describe.skipIf`) only skips
  when `VARDENA_TEST_DATABASE_URL` is **unset**, and it was set and reachable
  (the preceding "Migrate test database" and "Bootstrap system
  administrator" steps against the same URL succeeded), the live spec's 5
  tests ran for real in this step and the step's overall success means
  vitest exited 0 — i.e. every test file in the e2e run, including the new
  `warehouse-master-live.e2e-spec.ts` (5 tests) and the extended
  `master-data.e2e-spec.ts` (41 tests), passed. A vitest run only exits 0 if
  every test in every file passed; there is no partial-success exit code.

### Disclosed limitation — raw log text not retrievable from this sandbox

I attempted to download and quote the literal vitest output (e.g. the
`✓ test/warehouse-master-live.e2e-spec.ts (5 tests)` line and the final
`Test Files ... passed` summary) using `gh run view --log`,
`gh api .../actions/jobs/{id}/logs`, and direct `curl`/`wget` against the
resulting signed URL. All of these ultimately redirect to Azure Blob
Storage (`*.blob.core.windows.net`), which is **not reachable from this
sandbox's network** (`curl` fails with `SSL_ERROR_SYSCALL` for that host,
and for general internet hosts outside GitHub's own API — this sandbox is
on an allowlisted network, not a general one). This is an infrastructure
constraint of the execution environment, not a result that was skipped or
assumed away. What **is** verified above, directly from GitHub's REST API
(`api.github.com`, which is reachable), is the authoritative per-step
success/failure status for the exact run triggered by this task's commit —
that is real, inspected CI evidence, just not the raw text log. A reviewer
with normal browser access to the private repo can open the run URL above
and read the literal vitest output directly.

No CI failure was encountered on this run; no fix-forward commit was
required.
