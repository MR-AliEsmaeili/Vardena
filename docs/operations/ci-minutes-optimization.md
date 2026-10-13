# CI minutes optimization — change-aware jobs with a stable gate

Status: **implemented** · Date: 2026-10-13 · Baseline: `main` @ `749b01c` (merge of PR #144)
Scope: CI execution only. No product code, schema, migration, permission, API contract,
generated client or dependency is changed.

`docs/testing/test-execution-policy.md` remains the authority on **where** suites execute
(FAST-LOCAL vs CI-HEAVY vs CI-LIVE-DB vs CI-MIGRATION). This document records **which jobs run
for which change**, the merge contract that keeps that safe, and the current enforcement
limitation.

## 1. Why (measured baseline)

Every pull request used to start three unconditional jobs — `backend` (PostgreSQL 16 service,
`migrate deploy`, system-admin bootstrap, two timezone live suites, three migration rehearsals,
E2E incl. live-DB), `frontend`, and `generated-api-client` (two `npm ci` installs + a backend
build). Measured job time from the GitHub API (per-job billing rounds up):

| Run | Change set | backend | frontend | generated-api-client | Total |
| --- | --- | --- | --- | --- | --- |
| `38390128645` (PR #144) | **documentation-only** (5 `*.md`) | 6m33s | 2m52s | 1m07s | **10m32s** = 12 billed min |
| `38352417591` (PR #143) | backend + migration + workflow | 6m22s | 2m56s | 1m05s | 10m23s |
| `38354611367` (push to `main`) | post-merge of PR #143 | 4m26s | 2m20s | 1m13s | 7m59s |

## 2. Path-to-job matrix

`classify` (`scripts/ci-classify-scope.py`) inspects the change set against the **merge base**
and `docs`, `backend`, `frontend`, `generated-api-client` follow its decision. `classify` and
`ci-gate` always run.

| Changed paths | docs | backend | frontend | generated-api-client |
| --- | --- | --- | --- | --- |
| `*.md` anywhere (root, `docs/`, `.vardena/`), deletions and renames included | run | — | — | — |
| `docs/**` any file (images, fixtures) | run | — | — | — |
| `backend/**` (src, tests, Prisma schema, migrations, manifests, lockfile) | — | run | — | run |
| `backend/**/*.md` (`format:check` covers Markdown) | run | run | — | — |
| `frontend/**` non-API code | — | — | run | — |
| `frontend/src/api/**` (incl. the committed generated client) | — | — | run | run |
| `scripts/check-generated-api-client.sh` | — | — | — | run |
| **anything else** — `.github/**`, other `scripts/**`, root files, new top-level directories | run | run | run | run |
| empty change set, missing/zero/unverifiable base revision | run | run | run | run |

Decisions are per path, so a mixed change set runs the union. The `docs` job is Python-only
(standard library): no Node, no PostgreSQL, no build.

## 3. Checks preserved

No step of `backend`, `frontend` or `generated-api-client` was changed — each only gained its
condition. For any change set that touches the corresponding workspace, CI still runs Prisma
validate/generate, backend lint/typecheck/format/unit/build, fresh PostgreSQL 16 `migrate
deploy`, system-admin bootstrap, both timezone-sensitive BusinessDate live suites, all three
migration rehearsals, the full E2E set plus the serial licensing-persistence suite, frontend
lint/typecheck/format/tests/build, and the generated-client drift check.

## 4. The stable result: `ci-gate`

A job skipped by an `if` condition reports **success**, and a workflow skipped by a `paths`
filter leaves its checks **pending forever**. That is why there is no `paths` filter anywhere
and why `ci-gate` exists: it declares `if: always()`, depends on every other job
(`scripts/ci-gate.py`), and fails when

* the classifier did not succeed (no scope evidence → no green),
* a job the classifier marked applicable did not reach `success` — **including a job that was
  skipped, cancelled or missing from `needs`**,
* a job that ran outside the classification failed,
* the classification claims no job is applicable.

It passes exactly when every applicable job ran and succeeded and the rest were skipped. Job
display names (`backend`, `frontend`, `generated-api-client`) are unchanged.

## 5. Self-weakening guard

The classifier decides which jobs run, so a change set that ships a *weakened* classifier could
skip the verification it should have triggered (reproduced: a pull request that rewrites
`backend/src/worker.ts` while classifying everything as documentation ran only `docs`, leaving
`ci-gate` green over untested code). `classify` therefore passes
`--also-run-rev "$CI_BASE_SHA"`: the classifier revision **already accepted on `main`**
re-evaluates the same change set and its decision is **unioned** in — monotone, so
documentation-only and frontend-only runs stay narrow. A previous classifier that exists but
cannot be executed fails closed (every job runs); a base revision that predates the classifier
is reported as a notice. The guard is required by the CI-script tests, so it cannot be dropped
silently.

## 6. Concurrency

Unchanged: `group: ci-${{ github.ref }}` with
`cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` — outdated pull-request runs stay
cancellable, and an in-progress `main` verification is never cancelled. No scheduled run, no
matrix, no extra full-suite run.

## 7. Savings: measured baseline, estimated categories

Measured: the baseline in §1, and the durations of the three jobs such a change set would run
(`classify` 8–12s, `docs` 6–16s, `ci-gate` 5–12s across runs `38441286692`, `38442405919` and
`38394588059`).

Estimated, not yet observed end-to-end: a documentation-only pull request costs those three
jobs, rounding up to **3 billed minutes instead of 12** (arithmetic on the measured job
durations). Frontend-only ~58% saved, backend-only ~8%, schema/migration and unclassifiable
changes unchanged (full coverage retained). Every run of the pull request that introduces this
pipeline is **broad** — a pull request's change set is its whole diff against `main`, and that
diff contains `.github/**` and `scripts/**` — so the narrow paths are verified by the test suite
and by local reproduction, and become measurable on `main` after the merge.

## 8. Enforcement: advisory CI and the manual merge protocol

**GitHub does not technically require any check for `main` on the current plan.** Verified
2026-10-13 (read-only): `GET /repos/MR-AliEsmaeili/Vardena/branches/main` → `{"protected":false}`
(no branch protection rule exists, so no check can block a merge);
`GET …/branches/main/protection` → `403 Resource not accessible by integration` with
`X-Accepted-Github-Permissions: administration=read`; `GET …/rulesets` and
`GET …/rules/branches/main` → `403 Upgrade to GitHub Pro or make this repository public to
enable this feature` — protected branches/rulesets require GitHub Pro for a **private**
repository.

**Owner decision (2026-10-13): keep the repository private on GitHub Free and accept advisory
CI with a manual merge protocol.** No visibility, billing, protection, secret or permission
setting was changed, and the repository is not made public. A green `ci-gate` is therefore
**not** proof of server-enforced protection: it can be ignored, and a pending or failed run
does not prevent a merge. The protocol below reduces risk; it cannot guarantee prevention.

Manual merge protocol (per pull request):

1. Confirm the latest **completed** CI run is for the exact current head SHA; any new push
   invalidates the previous verification.
2. Require `classify` and `ci-gate` to succeed.
3. Read the `classify` step summary and check the scope decision against the changed paths.
4. Require every applicable job to succeed; accept a skipped job only when the classifier says
   it is not applicable.
5. Do not merge while any run is pending, missing, failed, cancelled or ambiguous — and review
   the diff first.
6. Never push directly to `main`.

## 9. How this is verified

```bash
python3 -m unittest discover -s scripts/tests -t scripts/tests   # CI helper suite
python3 scripts/check-docs-links.py                              # documentation links
```

The suite covers the classification matrix, the fallback for unknown paths and unusable base
revisions, the gate contract (a skipped, cancelled or failed applicable job fails the gate),
the self-weakening guard, the workflow wiring that makes the gate load-bearing, and the
documentation link check. It runs inside the `classify` job, so a pull request that would
weaken the classification fails before the other jobs execute.

## 10. Remaining limitations

* **No server-side enforcement** (§8); the manual protocol is the only control.
* **Hollowing out a check is not prevented by the guard.** A change set that edits a CI script
  (e.g. `scripts/check-generated-api-client.sh`) can make *that* check vacuous; such paths are
  classified broad, so product verification still runs, and the remaining control is review of
  `scripts/**` and `.github/**` changes.
* **Documentation links**: repository-relative links only; external URLs, anchors and
  reference-style definitions are out of scope. Reference-style links are not used anywhere in
  the current tree.
* **Base detection depends on the event payload** (`github.event.pull_request.base.sha`,
  `github.event.before`); an unexpected payload falls back to running every job — minutes, not
  coverage.
* **A future job added to the workflow must be added to `ci-gate`'s `needs`**; the CI-script
  tests assert the current wiring.
