# CI Run #395 — Queue Starvation Diagnosis (PR #119)

**Date:** 2026-10-05
**PR:** #119 — `feat(inventory): integrate warehouse operations with valuation UX`
**Head SHA:** `f25730fd9636ff96c4688a9401eb1629d09a0297`
**Branch:** `arena/678f7774-vardena` → `main`
**Run:** #395 (`37368220600`)

## Verdict

**No repository-side defect exists.** `.github/workflows/ci.yml` is valid and unchanged
by PR #119. The jobs were starved by an active, GitHub-acknowledged **GitHub Actions
hosted-runner assignment incident** (status.github.com incident `3q1yb5m7ltvb`, opened
2026-10-05T19:11:58Z, still unresolved at time of writing).

**No workflow, application, or test changes were made.** The concurrency block was
analysed and found correct; it was explicitly ruled out as the cause (see below).

## Evidence

### 1. The workflow is byte-identical to the one that passes on `main`

```
$ diff <(gh api .../contents/.github/workflows/ci.yml?ref=main ...) \
       <(gh api .../contents/.github/workflows/ci.yml?ref=f25730fd ...)
IDENTICAL
```

PR #119 changes 36 files; **none** of them are under `.github/`. Run #393 (`push` to
`main`, 18:58Z) used this exact file and acquired runners in **1 second**.

### 2. Static validation of `ci.yml`

| Property | Value | Risk |
| --- | --- | --- |
| YAML parse | OK | none |
| Triggers | `push:[main]`, `pull_request:[main]` | PR targets `main` → matches |
| `permissions` | `contents: read` | sufficient; no `environment:` gates |
| `needs:` | none on either job | no dependency deadlock |
| `if:` | none on either job | no condition can suppress a job |
| `environment:` | none | no approval gate |
| `strategy`/matrix | none | no matrix expansion issue |
| secrets / vars | none referenced | no missing-secret stall |
| reusable workflows | none | n/a |
| `runs-on` | `ubuntu-latest` (both jobs) | standard, valid label |

Actions is **enabled**; the `CI` workflow state is `active`. Repo is a private,
user-owned (non-org) repo, so no org-level runner-group or approval restrictions apply.

### 3. Concurrency is NOT the cause — disproved by timeline

The configuration is:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
```

This is **correct and was left unchanged**: PR runs use `ci-refs/pull/119/merge`
(cancellable, so a newer commit supersedes an older run), `main` uses
`ci-refs/heads/main` with `cancel-in-progress: false` (never cancelled). The two groups
cannot collide, and no other active workflow shares the group.

Two independent facts disprove concurrency as the cause:

* **Run #394 was cancelled *before* the superseding run existed.** #394's jobs ended at
  `20:10:47Z`; Run #395 was not created until `20:11:48Z` — **61 seconds later**.
  A `cancel-in-progress` cancellation is triggered *by* the new run, so it cannot
  precede it.
* **Run #395 attempt 1 was cancelled with nothing superseding it at all.** It ended at
  `20:26:52Z`; the next event in the group was the *manual re-run* (attempt 2) at
  `20:33:30Z`.

### 4. The cancellations are a deterministic 15m03s queue eviction

| Run / attempt | Queued | Cancelled | Queued for | Runner |
| --- | --- | --- | --- | --- |
| #394 | 19:55:44Z | 20:10:47Z | **15m03s** | never assigned |
| #395 att.1 | 20:11:49Z | 20:26:52Z | **15m03s** | never assigned |
| #395 att.2 `backend` | 20:33:31Z | 20:48:34Z | **15m03s** | never assigned |

Identical to the second across three attempts, with `runner_name` empty every time —
the jobs **never acquired a runner**. This is platform-side queue eviction, not a
workflow timeout (the two jobs have different `timeout-minutes`, 20 and 15, yet were
evicted at the same instant; and job timeouts only start counting once a job *runs*).

### 5. Decisive isolation: two jobs, same run, same file — different outcomes

During attempt 2 the incident partially mitigated, producing the cleanest evidence:

```
backend   queued 20:33:31Z → cancelled 20:48:34Z   runner: none
frontend  queued 20:33:31Z → SUCCESS   20:46:xxZ   runner: GitHub Actions 1000000631
```

`frontend` ran the full gate chain (install → lint → typecheck → format:check → tests →
build) and **passed in ~2.5 minutes**. Since both jobs share the same workflow file, the
same `runs-on: ubuntu-latest`, the same event, the same commit and the same concurrency
group, this conclusively eliminates:

* the workflow file, triggers and branch filters
* the concurrency configuration
* the `ubuntu-latest` runner label
* permissions, approvals, billing, and Actions-disabled states

The only structural difference between the two jobs is that **`backend` requests a
service container** (`services: postgres:16`). Runner assignment for container-hosting
jobs is the part of the fleet still degraded by the incident.

### 6. Correlation with the GitHub incident

| Time | Event |
| --- | --- |
| 18:58Z | Run #393 (`main`) — runner in 1s, **success** |
| **19:11:58Z** | **GitHub opens "Incident with Actions" — hosted-runner assignment delays** |
| 19:55Z | Run #394 — first starved run |
| 20:39:27Z | GitHub update: *"continuing to investigate job failures and delays affecting GitHub-hosted runner assignment"* |

Every CI run before the incident window succeeded and acquired runners in 1–4 seconds
(#388, #389, #390, #391, #392, #393). Every run after it started has starved. The
repository changed nothing in between.

## Actions taken

1. `.github/workflows/ci.yml` — **unchanged** (validated as correct).
2. No application, test, schema or domain code touched.
3. No success was faked; no test was skipped, removed or weakened.
4. No self-hosted runner introduced.
5. This report added as evidence.

A re-run was attempted via the API but the available token lacks the `actions: write`
scope (`403 Resource not accessible by integration`), so re-running must be done by a
maintainer.

## Recommended next step

Wait for incident `3q1yb5m7ltvb` to resolve, then on Run #395 click **“Re-run failed
jobs”** (re-runs only `backend`; the `frontend` success is preserved). Confirm the
`backend` job reports a non-empty `runner_name`:

```bash
gh api repos/MR-AliEsmaeili/Vardena/actions/runs/37368220600/jobs \
  --jq '.jobs[] | {name, status, conclusion, runner_name}'
```

Do **not** change `runs-on`, relax the concurrency block, or drop the Postgres service
container in response to this incident — the starvation is transient and external, and
the `backend` job's live-DB coverage depends on that service.

### Contingency (only if runner-assignment degradation becomes persistent)

If service-container jobs remain unschedulable for an extended period, the *smallest*
mitigation would be to start Postgres as an ordinary `docker run` step inside the
`backend` job instead of using the `services:` key, keeping every test and gate intact.
This was **not** implemented, as the evidence shows a transient platform incident rather
than a repository defect.
