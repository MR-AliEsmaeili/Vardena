# CI minutes optimization — change-aware jobs with a stable gate

Status: **implemented, pending CI verification on the pull request head** · Date: 2026-10-13
Baseline audited: `main` @ `749b01c95c4f107b8a37a86376dad156dffb8463` (merge of PR #144)
Scope: CI execution only — no product code, schema, migration, permission, API contract,
generated client, dependency or licensing behaviour is changed.

`docs/testing/test-execution-policy.md` remains the authority on **where** suites execute
(FAST-LOCAL vs CI-HEAVY vs CI-LIVE-DB vs CI-MIGRATION). This document records **which jobs
run for which change**, and the merge contract that keeps that optimization safe.

---

## 1. Baseline behaviour (measured, not inferred)

On the audited `main`, `.github/workflows/ci.yml` started for every pull request and every
push to `main` and always ran **three unconditional jobs** in parallel:

| Job | Cost driver |
| --- | --- |
| `backend` | Node 22 + npm 11 + `npm ci`, Prisma validate/generate, lint, typecheck, format, unit tests, build, **postgres:16 service**, `migrate deploy`, system-admin bootstrap, two timezone live suites, three migration rehearsals, E2E incl. live-DB suites |
| `frontend` | `npm ci`, lint, typecheck, format, tests, build |
| `generated-api-client` | `npm ci` (backend) + `npm ci` (frontend), Prisma generate, backend build, OpenAPI dump, client diff |

Measured job durations from the GitHub API (sum of job wall-clock time):

| Run | Event | Change set | `backend` | `frontend` | `generated-api-client` | Total |
| --- | --- | --- | --- | --- | --- | --- |
| `38390128645` | pull_request | **documentation-only** (PR #144: 5 `*.md`) | 6m33s | 2m52s | 1m07s | **10m32s** |
| `38352417591` | pull_request | backend + Prisma migration + workflow (PR #143) | 6m22s | 2m56s | 1m05s | **10m23s** |
| `38354611367` | push to `main` | post-merge of PR #143 | 4m26s | 2m20s | 1m13s | **7m59s** |

So a five-file Markdown pull request paid for a PostgreSQL service, migrations, live-DB E2E
suites, two dependency installs and two production builds. Because GitHub bills per job
minute rounded up (private repository, ubuntu runners, no multiplier), that documentation-only
run consumed **12 billed minutes**.

## 2. New path-to-job matrix

`.github/workflows/ci.yml` now always starts and always runs a `classify` job plus the
`ci-gate` job. The classifier (`scripts/ci-classify-scope.py`) inspects the change set against
the **merge base** of the pull request base tip / pre-push head, and the six jobs below follow.

| Changed paths | `docs` | `backend` | `frontend` | `generated-api-client` |
| --- | --- | --- | --- | --- |
| `*.md` anywhere root/`docs/`/`.vardena/` (incl. deleted, renamed, spaced names) | run | — | — | — |
| `docs/**` (any file, incl. images/fixtures) | run | — | — | — |
| `.vardena/**/*.md` | run | — | — | — |
| `backend/**` (src, tests, Prisma schema, migrations, manifests, lockfile) | — | run | — | run |
| `backend/**/*.md` (e.g. `backend/README.md`) | run | run | — | — |
| `frontend/**` non-API code (src, tests, config, lockfile) | — | — | run | — |
| `frontend/README.md` | run | — | run | — |
| `frontend/src/api/**` (incl. the committed generated client) | — | — | run | run |
| `scripts/check-generated-api-client.sh` | — | — | — | run |
| **anything else** — `.github/**`, other `scripts/**`, `docker-compose.yml`, `.env.example`, root files, new top-level directories | run | run | run | run |
| empty change set, missing/zero/unverifiable base revision | run | run | run | run |

Decisions are made per path, so a mixed change set runs the union. `backend/**` non-Markdown
changes trigger the client check because only backend sources, the Prisma schema and the
backend manifests can change the OpenAPI document; a Markdown-only backend change cannot, but
it still runs `backend` so its `format:check` coverage is unchanged.

`classify`, `docs` and `ci-gate` add no dependency install, no database and no build. The
`docs` job is Python-only (standard library), and the repository already relied on `python3`
in the `backend` job's failure inventory.

## 3. Checks preserved

Nothing was removed, weakened or replaced. Every step of `backend`, `frontend` and
`generated-api-client` is byte-identical to the audited baseline; only the conditions that
decide *whether* the job runs were added. In particular, for any change set that touches the
corresponding workspace, CI still runs:

* Prisma validate/generate, backend lint, typecheck, format, unit tests, build;
* fresh PostgreSQL 16 migration deployment and system-admin bootstrap;
* both timezone-sensitive BusinessDate live suites (Asia/Tehran, America/Los_Angeles);
* all three migration rehearsals, including the licensing version-model fixture;
* the full E2E set plus the serial licensing-persistence live suite;
* frontend lint, typecheck, format, tests, production build;
* the generated API client drift check.

The classifier is validated by `scripts/tests/test_ci_scripts.py` (80 tests) which run inside
the always-on `classify` job, so a pull request that would weaken the classification fails
before anything else executes.

## 4. Required-check safety (the reason there are no `paths` filters)

A workflow skipped by `paths`/`paths-ignore` leaves its required checks **"Pending" forever**
and blocks the merge — GitHub documents this explicitly, and a *job* skipped by an `if`
condition instead reports **success**. Both behaviours are handled deliberately:

* the workflow is never skipped by path or branch filters (only `main` targets, as before);
* conditional jobs are made safe by a **stable final gate**, `ci-gate`, which declares
  `if: always()` and depends on `classify`, `docs`, `backend`, `frontend` and
  `generated-api-client`. It fails when
  * the classifier did not succeed (no scope evidence → no green),
  * a job the classifier marked applicable did not reach `success` — **including when it was
    skipped or cancelled** or is missing from `needs`,
  * a job that ran outside the classification failed,
  * the classification claims no job is applicable (so a classifier regression can never
    produce an empty green gate).
  It passes when jobs that are genuinely not applicable are `skipped`, which is what lets a
  documentation-only pull request merge without the PostgreSQL suite.
* `classify` fails **open** (unclassifiable path → every job) while `ci-gate` fails **closed**,
  so an unforeseen path can only cost minutes, never coverage or a stuck pull request.

**Branch protection could not be read** (see §7) so no claim is made about which checks are
currently required. The job *display names* `backend`, `frontend` and `generated-api-client`
are unchanged, so any existing required check keeps matching, and a skipped job satisfies it
the same way it would have satisfied it before. Recommended Owner action (a strengthening, not
a change made here): make **`ci-gate`** the single required check, so the merge contract is
"every applicable job passed" instead of "each job individually did not fail".

## 5. Concurrency and duplicate runs

`concurrency` is unchanged in behaviour and documented in place:

```yaml
group: ci-${{ github.ref }}
cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

Outdated pull-request runs are still cancelled (per-PR group), and a push to `main` is never
cancelled, so the authoritative post-merge verification of `main` cannot be hidden by a newer
run. No scheduled run, no matrix, and no additional full-suite run was added; the new jobs are
small runner jobs that exist only to keep the required checks safe.

## 6. Estimated savings by change category

Savings are the difference against the measured baseline in §1, expressed in billed minutes
(per-job rounding up). The **new** jobs' own durations *are* measured: the first run of this
workflow (PR #145, run `38394588059`, head `d8c6632`) exercised the broad path and reported
`classify` **7s**, `docs` **7s**, `ci-gate` **5s**; per-category totals remain estimates until
a real run of each category exists (§7).

| Change category | Before | After (estimated) | Estimated saving |
| --- | --- | --- | --- |
| Documentation-only (PR #144 shaped) | 12 billed min | `classify` 1 + `docs` 1 + `ci-gate` 1 = **3 min** (19s of job time) | **~9 min (~75%)** |
| Frontend-only | ~12 billed min | `classify` 1 + `frontend` ~3 + `ci-gate` 1 = **~5 min** | **~7 min (~58%)** |
| Backend-only | ~12 billed min | `classify` 1 + `backend` ~7 + `generated` ~2 + `ci-gate` 1 = **~11 min** | **~1 min (~8%)** |
| Prisma schema / migration | ~12 billed min | **unchanged** (full backend integration coverage retained) | ~0 |
| Generated client / API contract | ~12 billed min | `classify` + `backend` + `generated` + `ci-gate` | ~1 min |
| Workflow, root config, unclassifiable | ~12 billed min | **unchanged** (every job) | 0 |

For a `main` push the same categories apply against the 7m59s baseline measured for run
`38354611367`.

**These numbers are expectations, not verified savings.** Actual savings must be measured from
subsequent runs (compare `gh run view <id> --json jobs` totals per category). Only the
*baseline* column of the table above was measured.

## 7. Remaining uncertainties and risks

* **Branch protection is unreadable from this session.** `gh api
  repos/MR-AliEsmaeili/Vardena/branches/main/protection` returns HTTP 403 *"Resource not
  accessible by integration"* and the rulesets endpoint requires GitHub Pro or a public
  repository. The repository already records this as **BOOT-OQ-04 (UNKNOWN)** in `STATE.md`.
  No protection setting, secret, permission or visibility was changed. If a required check
  currently names *another* workflow or a status context that this workflow no longer
  produces, the Owner must confirm; nothing here removes or renames an existing check.
  A required check that is a *skipped conditional job* reports success — which is safe only
  while `ci-gate` is also required (or while the conditional job's own condition is trusted).
* **Actual savings, cancellation behaviour and gate behaviour are unmeasured** until the first
  real runs on the new workflow. Re-measure per category before reporting a number as fact.
* **Documentation link validation degrades to report-only** when no comparable base revision
  can be resolved (missing, zero, or foreign to `main`): it reports broken links as warnings
  and exits 0. The degradation is always logged and annotated. Three pre-existing broken
  relative links exist on `main` and are reported as warnings, not failures; they are not
  fixed here (out of scope for a CI-only change).
* **The docs job checks relative links only.** External URLs, in-page anchors and
  reference-style link definitions are out of scope, deliberately, to avoid network flakiness
  and a dependency solely for link checking.
* **Base detection depends on the event payload** (`github.event.pull_request.base.sha`,
  `github.event.before`). The classifier refuses a base that is not reachable from
  `origin/main` and falls back to running every job, so an unexpected payload costs minutes,
  never coverage.
* **A future job added to the workflow must be added to `ci-gate`'s `needs`**;
  `scripts/check-ci-workflow.py` fails loudly if it is not.

## 8. How this is verified

| Check | Where |
| --- | --- |
| Path classification, gate contract, link checker, workflow wiring | `python3 -m unittest discover -s scripts/tests -t scripts/tests` (80 tests) |
| Workflow invariants (no path filters, `if: always()` gate, gate wiring, scope conditions, output declarations, `main`-safe concurrency) | `scripts/check-ci-workflow.py` (also asserted by the test suite shell above, including mutations that must fail) |
| Change detection against real history | `scripts/ci-classify-scope.py --base <base> --head HEAD` |
| First full run of this workflow (broad path) | [PR #145](https://github.com/MR-AliEsmaeili/Vardena/pull/145), run `38394588059`, head `d8c6632`: `classify` 7s, `docs` 7s, `backend` 6m45s, `frontend` 2m41s, `generated-api-client` 1m06s, `ci-gate` 5s — all six `success`, including Prisma validate/generate, `migrate deploy`, system-admin bootstrap, both timezone live suites, all three rehearsals and the E2E suite incl. live-DB. The classifier annotation recorded the decision ("broad change detected — running every job") and the `docs` job reported only the three pre-existing broken links as warnings |
| Documentation links | `scripts/check-docs-links.py --base <base>` |

Run all of it locally in one line:

```bash
python3 -m unittest discover -s scripts/tests -t scripts/tests -v
python3 scripts/check-ci-workflow.py
```
