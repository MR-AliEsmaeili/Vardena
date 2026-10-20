# PR #189 corrective report — Owner UI

**Status: BLOCKED — PR-branch handoff and authoritative CI verification.**
Date: 2026-10-20. This report supersedes the earlier PR report; no previous local
or CI success claim is carried forward as current evidence.

## Revision and delivery identity

- Repository: `MR-AliEsmaeili/Vardena`.
- Existing [PR #189](https://github.com/MR-AliEsmaeili/Vardena/pull/189): OPEN,
  head branch `feat/owner-ui-loading-thinking-orbs`.
- Re-fetched PR HEAD: `2ba7b89b2778028e34119028b7147c284e355a69`.
- Checkout/base and fetched `main`: `1ad7c602f3b820b7439e09b9ea472baf51d47cd9`.
- Implementation commit: `09c9104424e2a4b0d29316cf2b81a7104f31abc2`.
- Actual delivery branch: **`arena/52e389a5-vardena`**. The session permits
  commits/pushes only to that fixed branch. It cannot update the different PR
  head branch, and a parallel PR was explicitly forbidden. No branch switch,
  original-head push, new PR, merge or auto-merge was performed.
- The final documentation commit is the tip containing this report; its exact
  SHA is reported in the PR handoff comment/final delivery (not a self-referential
  SHA embedded in this file).

All eight PR commits were inspected: `0539862`, `a21be7b`, `96c75c1`, `93a7dd6`,
`b504959`, `5d2c081`, `2fb61e1`, `2ba7b89`. The frontend changes were adapted onto
current main, not by restoring the entire old PR tree: main's backend transaction
fix and tests remain untouched. GitHub comments/reviews/inline comments were
queried; the available bot comments report a failed/usage-limited review, not a
completed design approval. No human product decision was inferred from them.

## Proven CI cause, not a guessed directory fix

Run: [39484617508](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39484617508),
frontend [job 118842472787](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39484617508/job/118842472787).

The GitHub job API shows **Owner UI verification failed** (step 13), and
**Independent Owner UI image with canonical date sources was skipped** (step 14).
The latter did not fail in this run. The full `gh run view --log-failed` download
failed with EOF at the restricted `results-receiver.actions.githubusercontent.com`
host. Job/step metadata, check annotations, source and a bounded reproduction
are the available evidence; this report does not claim the inaccessible log was read.

The committed Owner lock at `2ba7b89` contains only **`PLACEHOLDER`**, not JSON.
Reproducing with the exact PR manifest/lock in a fresh standalone directory gives
npm `EUSAGE`: "The npm ci command can only install with an existing
package-lock.json or npm-shrinkwrap.json with lockfileVersion >= 1". That generic
message does not prove a wrong working directory.

| Step                                              | Actual working directory / input                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Customer install/lint/typecheck/format/test/build | Explicit `frontend`                                                                 |
| Date guard / artifact isolation scan              | Repository root                                                                     |
| Owner UI verification                             | Explicit `owner-licensing/frontend`; its own manifest/lock                          |
| Independent Docker build                          | Repository root context, `-f owner-licensing/frontend/Dockerfile`                   |
| Docker npm ci                                     | `WORKDIR /repo/owner-licensing/frontend`; COPY of Owner manifest/lock               |
| Date projection                                   | Seven allowlisted files resolved relative to the staging script's `import.meta.url` |

**Fix:** retain main's valid Owner v3 lock and update it from the Owner manifest.
The delta from main is only the root dependency entry and locked
`thinking-orbs@0.3.2` package (integrity included); no existing resolution was
upgraded. No customer lockfile is used. Added regression tests assert Owner
identity, manifest/lock parity, pinned orb and Docker's install boundary.
The workflow/Docker/context/date graph and all isolation/security gates were
already correct and remain unchanged.

## Presentation work across the existing routes

| Existing route(s)                                                | Improvements                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`, `/change-password`                                     | Real h1, self-hosted Persian typography, unified form/focus/validation styles; decorative submit/logout orbs from existing pending state                                                          |
| `/app`, `/app/lifecycle`                                         | Unified shell, non-decorative content hierarchy, clear existing unavailable/manual-operation language; no new lifecycle action                                                                    |
| `/app/customers`                                                 | Bounded search toolbar, compact readable rows, wrapping identity/reference and semantic active/inactive badge, section refresh feedback                                                           |
| `/app/customers/new`, `/:id`, `/:id/edit`                        | Consistent panel/controls, readable metadata and contract-date fieldset, wrapping actions, existing save/error/success states                                                                     |
| `/app/users`                                                     | Same heading, native role control, create/access/reset form presentation and local pending indicators; existing roles/predicates unchanged                                                        |
| `/app/signing-keys`                                              | Search/status toolbar, metadata panels, unified status/notes/register controls and submission/success feedback                                                                                    |
| `/app/licenses`                                                  | Clear page/prepare/record hierarchy, responsive limits (single column on narrow phones), shared selects, semantic request/revocation/error styling, real prepare/download/revoke pending feedback |
| `/app/audit`                                                     | Consistent filter controls, event/archive metadata surfaces, success/danger tones, local refetch feedback; existing date/URL/filter rules untouched                                               |
| `/app/operations`, `/activation/new`, `/replacement/new`, `/:id` | Filter toolbar, coherent observation forms/detail/history, wrapping actions and status/safety colors; manual-observation caveats preserved                                                        |
| Auth/route failures and not-found                                | Shared primitives/feedback remain in use; no guard or redirect policy changed                                                                                                                     |

Shared semantic tokens replace scattered palette utilities in Owner only.
Native `Select` and `Input` share height/border/focus/disabled/invalid treatment;
`PageHeading` and panel/toolbar/status/success patterns keep presentation
consistent. Vazirmatn v33.003 is self-hosted with its OFL license. The solid
header and active RTL navigation replace translucent/glass styling. Desktop
uses a sticky rail, phones a two-column nav, and main/action/reference content
can shrink/wrap. Existing lists were not converted to fictitious tables or KPIs.

## Loading and technical review

Full contract: [Owner loading system](../frontend/owner-ui-loading-system.md).
It adapts [the main contract](../frontend/loading-system.md) and
[ADR-0051](../adr/0051-global-request-loading-system.md) without approving a
product/architecture decision.

- Single wrapper and locked MIT library; third-party notices included.
- Only Axios starts activity. Query hooks never double-count. GET is background,
  writes global, local pending/fetching states remain owned by existing hooks.
- Unique tokens, idempotent end, stable immutable external-store snapshots.
  The response path finalizes before existing 401 reaction; helper `finally`
  covers missing-config errors. Cookie/header/session/expected-401 rules unchanged.
- Global 500ms; ambient/local-refresh 300ms; local submit/initial skeleton
  immediate. No minimum display time, retry, new timeout or blocking overlay.
- **Proven bug fixed:** rapid idle→active bursts cancelled the old zero-delay
  hide timer and inherited `visible=true`. A test failed before the fix and now
  protects the guarded state reset plus cleaned show timer.
- **Proven accessibility collision removed:** active as well as idle global
  progress no longer has output's implicit status role. A mounted polite div
  carries progress; completion toasts keep their existing status role. Tests
  exercise a success toast while another write remains active. Separate visual
  bands avoid mobile header/toast overlap.
- Reduced motion/static frame, visible animation scheduling, unmount cleanup,
  decorative canvas and theme are tested through the real library wrapper.
- No network/storage/eval surface was found in the installed orb distribution;
  only the wrapper imports it. Indicators make no API call.
- Route exit cleans UI subscriptions/timers; existing AbortSignals cancel reads
  through Axios. A genuine surviving request is not falsely reset merely
  because its originating route unmounted. No new transport cancellation policy.

## TEST EXECUTION MATRIX — actual local results

Node `v22.22.3`, npm `10.9.8`. CI upgrades to npm 11; that difference remains
an authoritative-CI verification item, not a reason to change dependency versions.
Run inside **`owner-licensing/frontend`**, not with root-level `npm exec`:

| Command/check                                                                                                                                    | Actual result                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `npm ci --no-audit --no-fund`                                                                                                                    | PASS, clean dependency installation                                                    |
| `npm run lint`                                                                                                                                   | PASS, 0 warnings / 0 errors                                                            |
| `npm run format:check`                                                                                                                           | PASS                                                                                   |
| `npm run typecheck`                                                                                                                              | PASS, including canonical date staging                                                 |
| `npm test`                                                                                                                                       | PASS: 18 Vitest files / **243 tests**, plus **3** staging/graph/declaration node tests |
| `npm run build`                                                                                                                                  | PASS, TypeScript + production Vite output                                              |
| Isolated Owner + exactly seven canonical sources; `npm ci --ignore-scripts --no-audit --no-fund`, then the same lint/format/typecheck/test/build | PASS, no customer manifest, lock or node_modules present                               |
| Customer `npm ci` and `npm run build` (no source change)                                                                                         | PASS                                                                                   |
| `python3 scripts/check-owner-isolation.py --artifact frontend/dist`                                                                              | PASS on actual newly built customer artifact and dependency graph                      |
| `python3 scripts/check-date-contract.py`                                                                                                         | PASS (structural coverage only)                                                        |
| `python3 scripts/check-docs-links.py`                                                                                                            | PASS                                                                                   |
| Actual Docker/image build, issuer image and live-DB/backend/integration gates                                                                    | NOT RUN locally; Docker unavailable; CI required                                       |

Evidence: [checkout command output](owner-ui-review/checkout-verification.txt),
[isolated command output](owner-ui-review/local-verification.txt).
Coverage includes registry concurrency/duplicate endings/subscriptions, transport
success/HTTP/network/abort/pre-abort/timeout/retry/config reuse, expected and
session-gated 401s, no extra request, timer thresholds/fast and consecutive
bursts/unmount, global vs ambient/local, toast coexistence, real orb
reduced-motion/cleanup, and existing behavior suites plus pending customer-save
assertions. No test or gate was deleted/skipped. The existing audit fixtures
emit duplicate-key warnings; tests still pass and the unchanged fixture IDs,
not a new production identity strategy, cause those warnings. Rollup also emits
upstream Zod pure-comment warnings; build exits 0.

The current user explicitly requested Owner `npm test`; the executed frontend
suites are jsdom/in-memory API-boundary tests. Browser inspection below uses
intercepted responses, not the production HTTP pipeline or a database.
**No heavy E2E/live-DB test was executed locally unless explicitly authorized.**
No such heavy suite was executed in this pass.

## Actual browser and screenshot evidence

Chromium **131** was run using temporary external Playwright tooling; no browser
package was added to the application. The first Chromium 153 launch lacked NSS
libraries; temporary tooling was adjusted to the bundled Chromium 131/Lambda
libraries, after which the real browser review completed.

[Browser results](owner-ui-review/browser-results.json): **45** route/state/size
cases, widths **360 / 768 / 1440**, `dir=rtl`, no viewport overflow or page JS
errors in those cases. It covers the existing shell/list/form routes, login,
empty data, delayed actual Axios GET activity, HTTP error, and an actual form
POST held in flight to observe disabled/aria-busy button + global progress.
The held POST is answered with a fixture failure, not fabricated saved data.

**Important:** these are screenshots of the actual running React application,
not generated images/mockups. API responses are explicitly intercepted **test
fixtures**, including the test session and empty lists. This is **not** live
Owner API/DB/signature proof or a production visual-acceptance claim. Populated
long histories, administrative archive data, every permission combination,
screen-reader speech and physical-device behavior still need human review.
Detail/history behavior also has existing jsdom tests; not every populated
detail view was browser-inspected in this pass.

Selected actual captures:

- [Before, licenses desktop](owner-ui-review/before-app-licenses-1440-empty-fixture.png)
  / [after](owner-ui-review/after-app-licenses-1440-empty-fixture.png).
- [Before, licenses phone](owner-ui-review/before-app-licenses-360-empty-fixture.png)
  / [after](owner-ui-review/after-app-licenses-360-empty-fixture.png).
- [Login phone](owner-ui-review/after-login-360-login-fixture.png).
- [Pending customer form, phone](owner-ui-review/after-app-customers-new-360-submit-fixture.png).
- [Loading customers, phone](owner-ui-review/after-app-customers-360-loading-fixture.png).
- [Error customers, phone](owner-ui-review/after-app-customers-360-error-fixture.png).

The before build is PR `2ba7b89` sources with the current installed dependencies
supplied only to permit visual comparison; it is **not** evidence that the
invalid old lock installed successfully. The after screenshots come from the
current running source. Temporary baseline preview was stopped. The remaining
preview is frontend-only and requires a real Owner API to use outside fixtures.

Reproduction helper: [browser-review.mjs](owner-ui-review/browser-review.mjs).
Install `playwright-core` and `@sparticuz/chromium@131.0.1` in an external tooling
directory, set `OWNER_REVIEW_TOOLS_DIR` to that directory, start the after UI on
5174 and baseline preview on 4174. Run with
`AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x node docs/tasks/owner-ui-review/browser-review.mjs`.
The helper intentionally intercepts `/api/v1/**` in isolated browser contexts;
it is not imported by the product or CI. It records real dimensions/screenshots,
not business results.

## GitHub CI state and unresolved handoff

Last existing PR run remains **39484617508**, on **2ba7b89**, not the corrective
implementation. [GitHub step metadata](owner-ui-review/ci-job-baseline.json).

| Job                  | Existing PR run, 2ba7b89                           | Corrective branch latest HEAD |
| -------------------- | -------------------------------------------------- | ----------------------------- |
| classify             | SUCCESS                                            | No run                        |
| docs                 | SUCCESS                                            | No run                        |
| backend              | SUCCESS                                            | No run                        |
| frontend             | FAILURE (Owner install); independent image SKIPPED | No run                        |
| generated-api-client | SKIPPED by classifier                              | No run                        |
| ci-gate              | FAILURE                                            | No run                        |

Workflow triggers are `pull_request` targeting main and pushes **only to main**;
there is no workflow_dispatch. Pushing the allowed session branch cannot trigger
this workflow while the existing PR targets a different head. The workflow was
not widened/disabled or its result manually changed to disguise this blocker.

**Required next step:** an authorized maintainer must transfer the frontend/docs
snapshot from `arena/52e389a5-vardena` onto the **existing** PR head branch, retain
current main's backend fixes, and let the unchanged PR workflow run on that new
HEAD. Inspect all required checks and, specifically, both Owner verification and
independent Docker build steps. Do not reuse the old green customer build as
Owner acceptance. No parallel PR is needed or requested.

## Remaining risks and recommendation

- **Do not merge yet:** no corrective-HEAD CI run, no independent Docker success
  evidence and no live backend/image/security gate result for this correction.
- Visual work is substantially broader than the original shell/orb change, but
  fixture browser evidence does not replace Product Owner visual review.
- No timeout policy was invented. A truly hung request stays active; future
  non-Axios transports would need deliberate integration.
- ADR-0051 remains Proposed; existing Owner/product questions (including manual
  operation/replacement gaps) stay outside this presentation task.
- No business rules, API contracts, session, permissions, signing operations,
  backend/customer source, workflow gate or date-projection boundary changed.
- PR remains open and unmerged; branch handoff and exact-HEAD CI are mandatory
  before promoting this status to READY FOR REVIEW.
