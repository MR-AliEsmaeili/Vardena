# PR #190 — final corrective audit of Owner UI

**Status: BLOCKED — Product Owner visual acceptance has not been recorded.**
Audit date: 2026-10-21 (Asia/Tehran).

This replaces the obsolete PR #189 branch-handoff report. [PR #190](https://github.com/MR-AliEsmaeili/Vardena/pull/190)
is the only delivery PR, from `arena/52e389a5-vardena` to `main`. PR #189 is closed
and was not merged. No new PR, merge, auto-merge, branch switch, protection change
or push to `main` is part of this audit.

## Source of truth and evidence identity

- Fetched base: `1ad7c602f3b820b7439e09b9ea472baf51d47cd9`.
- Starting PR head: `d6619779847f97194f03f842b4793b042a35ff61`.
- The containing audit commit includes the final tested source, refreshed evidence
  and this report. Its exact SHA and the authoritative final CI run/job links are
  recorded in the **PR #190 body and final audit handoff comment after push**.
  This avoids a self-referential commit SHA or claiming that an earlier run
  validates a later commit. Any later push invalidates that CI acceptance.
- Baseline CI [39502299323](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39502299323)
  passed on `d661977`; it is historical evidence, **not** final-audit CI evidence.
- Requirements read: `AGENTS.md`, frontend standards, ADR-0048 including its exact
  seven-source addendum, ADR-0051 (still Proposed), the loading contracts, testing
  execution policy and CI manual-merge protocol.

## Actual GitHub requirements and review state

Read-only API queries returned `main.protected=false` and an empty applicable
branch-rules list. Reading legacy protection and enumerating GraphQL protection
rules returned `403` / `FORBIDDEN`; full administration configuration was **not**
accessible. No settings were changed. This is consistent with the documented
advisory-CI/manual-merge protocol, not proof of server-enforced required checks.

Reviews, inline review comments and GraphQL review threads were empty at audit.
The Codex summary reports failure, followed by a usage-limit explanation: this
is **not a completed independent review**, nor a concrete defect to invent a fix
for. There is no Product Owner visual approval. A green CI run must not be
substituted for either human review or approval.

## Findings and narrowly scoped corrections

1. **Production dependency audit:** `npm audit --omit=dev` on the starting lock
   reported one High vulnerable package, `follow-redirects@1.16.0`, via Axios.
   Advisories: [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8)
   and [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c).
   Only that transitive lock entry was patched to **1.16.1**. The manifest and
   every other existing resolution remain unchanged. Fresh independent and
   checkout audits report **zero production vulnerabilities**. These advisories
   concern Node redirect handling; this is not a claim that browser credentials
   were observed leaking. No cookie/header/auth policy was changed.
2. **Audit test fixture:** the existing full-page pagination fixture repeated one
   event/React key 50 times. It now supplies 50 distinct valid identifiers and
   asserts that all 50 rows render, retaining the disabled-next assertion.
   Duplicate-key warnings disappeared; no console suppression was added.
3. **Missing negative transport evidence:** three regression cases now verify
   settlement of a global write receiving a null body, HTML proxy failure or
   unknown error envelope. They assert zero remaining activity and the existing
   safe Persian error, without exposing upstream implementation text. Production
   response normalization/API contracts remain untouched.
4. **Stale evidence/report:** refreshed independent and checkout logs, real browser
   measurements, main-baseline screenshots and this report. The browser helper
   now checks retry recovery, loading settlement, button re-enablement, duplicate
   submission prevention, validation without a write, keyboard skip-link focus,
   normal-motion cases and unexpected console errors as well as dimensions.

No production UI/business code needed a speculative rewrite in this audit.
The earlier rapid-burst visibility fix and its regression remain intact.

## Independent Owner UI image: a step, not a separate job

The official gate is **step 14 inside the `frontend` job**, not a standalone job:

- `.github/workflows/ci.yml:387–392`: frontend runs when the classifier requires it.
- Lines 437–445: `Owner UI verification` explicitly runs in
  `owner-licensing/frontend` using its own clean install and all five gates.
- Lines 447–448: `Independent Owner UI image with canonical date sources` runs
  `docker build -f owner-licensing/frontend/Dockerfile -t vardena-owner-ui-ci .`.
  There is no separate skip/continue-on-error condition; default success
  semantics prevent it running after a failed earlier step.
- Baseline [frontend job](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/39502299323/job/118902626470)
  reports both steps 13 and 14 **SUCCESS**. The final run must independently show
  the same on the final delivery SHA, as linked in the PR body. A job-list-only
  view cannot establish whether an individual step ran.

Docker retains `WORKDIR /repo/owner-licensing/frontend`, copies the Owner
manifest/lock, installs independently and builds with only the exact approved
canonical sources. Its root context is restricted by `Dockerfile.dockerignore`.
The complete seven-file list is `calendar.ts`, `dayjs.ts`, `numerals.ts`,
`business-date.ts`, `time-zone.ts`, `instant.ts`, `instant-range.ts`. Staging
regenerates byte-identical inputs and rejects graph drift/missing sources.
No customer manifest, lock, dependency tree, runtime/config/secrets or broader
source graph is admitted. Docker, staging, allowlists, workflow, classifier and
isolation/security/date gates were **not changed**.

The whole PR (not just the last commit) requires `docs`, `backend`, `frontend`
plus always-running `classify` and `ci-gate`. `generated-api-client` is correctly
inapplicable: no customer API/backend/generated-client path changed. The
base-revision classifier union and aggregate fail-closed behavior remain intact.

## TEST EXECUTION MATRIX

Fresh executions use Node **22.22.3**, npm **11.21.1** throughout. Commands below
were run in both the checkout Owner directory and a new standalone tree with
only tracked Owner files plus exactly seven canonical date sources. The latter
contains **no** customer manifest, lockfile or `node_modules`.

| Gate / command | Execution and actual result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | FAST-LOCAL: PASS in both clean environments |
| `npm run lint` | PASS, 0 warnings / 0 errors in both |
| `npm run format:check` | PASS in both |
| `npm run typecheck` | PASS in both, with canonical staging |
| `npm test` | PASS in both: **246 Vitest tests / 18 files**, plus **3 Node staging tests** |
| `npm run build` | PASS in both, TypeScript and production Vite output |
| `npm audit --omit=dev` | PASS in both: **0 production vulnerabilities** after the narrow lock patch |
| `python3 -m unittest discover -s scripts/tests -t scripts/tests` | FAST-LOCAL: **84 tests**, PASS |
| `python3 scripts/check-date-contract.py` | PASS; limited structural coverage, not a full date-domain audit |
| `python3 scripts/check-docs-links.py` | FAST-LOCAL documentation gate; final execution recorded in PR handoff |
| Real Chromium fixture review | **47 cases**, PASS; widths 360 / 768 / 1440 |
| Docker/images, customer artifact isolation, Owner PostgreSQL/security/RBAC, full backend/E2E and migrations | CI-only; final exact-SHA job/step results indexed in the PR body |

Evidence: [checkout output](owner-ui-review/checkout-verification.txt),
[independent output](owner-ui-review/local-verification.txt),
[dependency audit before](owner-ui-review/dependency-audit-before.json) /
[after](owner-ui-review/dependency-audit-after.json),
[browser measurements](owner-ui-review/browser-results.json).

Coverage includes registry concurrency/idempotency/stable snapshots/subscription
cleanup; HTTP success/failure/network/cancel/pre-cancel/timeout/retry/config reuse;
expected versus session-gated 401s; no extra network calls; 300/500ms thresholds,
fast and rapid consecutive bursts, immediate settlement/unmount cleanup; local,
ambient and global isolation; toast coexistence; pending form buttons; real orb
reduced-motion/animation cleanup; and existing feature behavior/permission/date
suites. The new negative cases do not introduce response-schema or retry policy.

No heavy E2E/live-DB test was executed locally unless explicitly authorized.
None was executed locally in this audit. The requested Owner tests use in-memory
API boundaries; the browser review intercepts fixtures, not production services.
The only remaining build warnings are upstream Zod PURE-comment annotations;
they were retained, not suppressed. The Audit duplicate-key warnings are fixed.

## Functional and visual evidence — carefully bounded

[Portable browser helper](owner-ui-review/browser-review.mjs) uses external
`playwright-core` / `@sparticuz/chromium@131.0.1`; neither is a product dependency.
The before preview is now a **fresh independent install/build of main
`1ad7c602`**, not the old invalid-lock PR. After preview serves the exact rebuilt
Owner artifact from the isolated audit tree. The refreshed after screenshots are
byte-identical to the prior captures; the security patch does not change the
browser bundle. All captures are real browser output, not generated mockups.

47 cases cover existing shell/list/form routes, login, empty/loading/error and
pending submission, reduced motion and two normal-motion cases. Measurements
show RTL, no horizontal viewport overflow, no page JS exceptions and no unexpected
console warning/error in those cases. Expected fixture HTTP 401/503 resource
errors are explicitly retained in the JSON, not called application exceptions.
Retry returns to the empty state; settled writes remove global activity and
re-enable the button; invalid forms issue no write; disabled repeat clicks issue
no second write; keyboard skip links focus main content.

Selected refreshed screenshots:

- Licenses desktop: [main before](owner-ui-review/before-app-licenses-1440-empty-fixture.png)
  / [after](owner-ui-review/after-app-licenses-1440-empty-fixture.png).
- Licenses phone: [main before](owner-ui-review/before-app-licenses-360-empty-fixture.png)
  / [after](owner-ui-review/after-app-licenses-360-empty-fixture.png).
- [Login phone](owner-ui-review/after-login-360-login-fixture.png).
- [Pending customer save](owner-ui-review/after-app-customers-new-360-submit-fixture.png).
- [Initial loading](owner-ui-review/after-app-customers-360-loading-fixture.png).
- [HTTP error](owner-ui-review/after-app-customers-360-error-fixture.png).

These are **intercepted fixtures**, including the session and empty lists. They
are not live Owner API/DB/signer proof, real-data write approval, cryptographic
proof or Product Owner visual acceptance. No configured Owner service/database
or Docker executable was available locally, and no real-data modification was
attempted. CI's disposable backend/Owner PostgreSQL suites are separately scoped
evidence, not an integrated live UI/signer demonstration.

Populated long histories, administrative archive data, every permission
combination, screen-reader speech and physical devices are not exhaustively
browser-tested. Existing jsdom feature tests cover populated behavior; this does
not expand the screenshot claim. LCP/device performance was not measured. Built
JS chunks total approximately 218.05 KB gzip versus the 250 KB guideline, not
proof of production LCP. Human visual acceptance remains outstanding.

## Full-diff and risk review

The complete changed-path inventory is confined to Owner frontend and related
docs/evidence. No customer/backend/issuer source, API contracts, auth/session or
permission module, canonical date source, lifecycle/signing rule or workflow
changed. Existing feature calls were additionally compared using a TypeScript
AST diagnostic across all 12 modified feature render files: call inventories
and arguments match main after replacing JSX with a placeholder. This is a
bounded cross-check, **not** proof that arbitrary render changes are equivalent;
JSX guards, disabled predicates, handlers, native control forwarding, navigation,
initial/error/empty states and shared loading behavior were reviewed separately.

One Axios interceptor owns activity; helper finalizers end the same token.
Registry entries contain only scope/message enums, not URLs/bodies/credentials.
A hung real request intentionally remains active: no timeout, retry, artificial
minimum delay or route-reset policy was invented. Existing AbortSignals remain
responsible for cancellation. Global feedback is non-blocking; completion toasts
retain their own semantics. No new storage, HTML injection or network surface
was found in the orb wrapper/distribution; fonts and licenses are self-hosted.

The PR remains broad in presentation scope and therefore needs visual review.
ADR-0051 is still Proposed; this task does not approve architecture or close any
Owner/product question. Existing manual/unavailable capabilities remain explicit.
No assertions/gates were removed, skipped or weakened to obtain green results.

## Product Owner decision / outstanding blockers

- **BLOCKED for merge recommendation:** no recorded Product Owner visual approval.
  Review the actual screenshots and return approval or concrete corrections.
- Independent Codex review did not complete due to usage limits. Obtain the
  intended independent/human review; an empty thread list is not approval.
- Full administrative protection configuration was inaccessible. Follow the
  existing manual exact-HEAD merge protocol; do not claim server enforcement.
- Live integrated UI/API/DB/signer evidence is not claimed. If it is an acceptance
  requirement, an authorized test environment and safe fixture/data permission
  are required; do not use production writes as a substitute.
- Keep PR #190 **OPEN and unmerged**. Even final green CI does not resolve the
  human approval or proposed-ADR decisions.
