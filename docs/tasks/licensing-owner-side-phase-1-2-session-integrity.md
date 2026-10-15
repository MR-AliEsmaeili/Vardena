# Owner Phase 1.2 — session-expiry integrity on a rejected credential

Date: 2026-10-15. Status: implementation submitted for exact-head CI and review.
This is not Product Owner acceptance, operational rollout, or permission to merge.
It changes no API contract, role, permission, migration, Open Question or signer.
It does not close OQ-75, OQ-77, OQ-78, OQ-82, OQ-83, OQ-84, OQ-85 or U-1.

## Repository-first baseline

Fetched `origin/main`: **`70aad01d8878290f7b61c81efe460b15850798aa`** (merge of
PR #162), verified with the session branch starting at exactly that commit and a
clean worktree. `gh pr list --state open` returned **no open pull request**; the
newest licensing PRs (#160, #161, #162) are **MERGED** and are already contained
in this `main`, so nothing merged is reimplemented and no open PR is modified.
Baseline post-merge push CI run `38806426803` for that exact SHA is
`completed / success`. The Owner slice in `main` implements the standalone
application, the manual-observation API/UI and the audit explorer; this record
does not repeat their history and does not reimplement them. Product authority
for the Owner application is [PDR-17](../decisions/product/PDR-17-owner-web-application-phase-1.md);
the affected flow is the mandatory first-login change documented in the
[Owner README](../../owner-licensing/README.md) and the
[UI README](../../owner-licensing/frontend/README.md#session-and-credential-failures).

## Defect and root cause

`POST /api/v1/auth/change-password` answers **401 `Unauthorized`** for two
different facts:

| Fact | Source |
| --- | --- |
| The session is absent, revoked, idle/absolute-expired or the user is disabled | `owner-licensing/backend/src/security.ts` (`authenticate`) |
| The submitted **current password was rejected** | `owner-licensing/backend/src/app.ts` — `fail(401, "Unauthorized", "Invalid current password.")` |

A status code cannot separate them, but the UI transport treated **any** 401 that
was not `/auth/login`, `/auth/logout` or `/auth/me` as "the session ended"
(`src/api/client.ts`, `SESSION_PROBE_PATHS`). So mistyping the current password in
the mandatory first-login change:

1. ran the global session-expiry reaction — `queryClient.clear()`, the session
   cache set to `null`, `sessionExpired = true` (`session-context.tsx`);
2. made `ChangePasswordPage` return `<Navigate to="/login" replace />`, because
   the page redirects as soon as the session state is unauthenticated;
3. showed the login page's notice `t.auth.sessionExpired`
   ("نشست شما منقضی شده است") — a **false statement**: the server never invalidated
   the session, it rejected the submitted credential, and the same session still
   answered `GET /auth/me`;
4. discarded every cached server value and the operator's typing, on the very path
   a new operator must complete before the workspace opens;
5. also reported the 401 through `applyServerValidationIssues` /
   `resolveChangePasswordErrorDescription` as an expired session.

The server-side authorization, session and quarantine behaviour is correct and is
unchanged by this slice. The defect is the client's classification of the
response, not the API's contract.

## Implementation

Smallest change that removes the false statement without weakening session
handling:

- **Transport** (`src/api/client.ts`): `/auth/change-password` joins the
  documented set of requests whose 401 is an expected answer
  (`expectedUnauthorizedPaths`, `isExpectedUnauthorized`). The transport no longer
  decides that the session ended for that route. A 401 from any session-gated
  request still triggers the expiry reaction unchanged.
- **Session provider** (`src/features/auth/session-context.tsx`): one
  `endSessionLocally` callback now backs both the intercepted-401 reaction and the
  new probe; `verifySessionAlive()` re-reads `GET /auth/me` and returns
  `'alive' | 'ended' | 'unverified'` — `'ended'` performs the same local cleanup,
  `'unverified'` (the probe itself failed with something other than 401) clears
  nothing, because a transport failure proves nothing.
- **Page** (`src/features/auth/change-password-page.tsx`): a 401 now probes the
  session before explaining itself. `'alive'` → the current-password field error
  and `t.auth.currentPasswordInvalid`; `'ended'` → the cleanup replaces the page
  with `/login` and its (now true) expiry notice; `'unverified'` → the neutral
  `t.errors.unauthorized` copy. Until the probe answers, the page states neither
  cause, so no render claims expiry for an unresolved 401.

No API shape, status class, endpoint, header, cookie behaviour, permission,
migration or backend file changes. The comparison status/code for a real expired
session and for a rejected credential is preserved exactly as documented.

## Regression coverage

| Case | Expected outcome | Location |
| --- | --- | --- |
| `/auth/change-password` is an expected 401 and never becomes an expiry trigger again | classified as expected; `/customers`, `/users`, `/operational-records`, `/audit-events`, `/permissions/effective` are not | `src/api/client.test.ts` (pure) |
| Wrong current password with a live session | stays on the form, `aria-invalid` current-password field, credential copy, **no** expiry notice, no login page, `GET /auth/me` probed once after the failure | `src/features/auth/change-password-page.test.tsx` (flow) |
| 401 with a session that really ended | `/login` with the expiry notice | same flow file |
| 401 whose probe cannot answer (5xx) | page stays, neutral copy, no expiry claim, no credential claim | same flow file |

The flow file mocks only the API module boundary (recorded convention in
`vitest.config.ts`); the PostgreSQL/HTTP side of the 401 contract is already
covered by `owner-licensing/backend/test/api.test.ts` (wrong current password →
401; session-write fault → rollback), which this slice does not change.

## Local checks performed

Fast, targeted only, on the final working tree:

- `npm ci --ignore-scripts --no-audit --no-fund` in `owner-licensing/frontend`
  (dependency installation only; no lifecycle script runs).
- `npx prettier --check` on the changed files: clean.
- `npx oxlint` on the changed files: 0 warnings, 0 errors.
- `npx tsc --noEmit` for the package: exit 0, no diagnostics.
- `npx vitest run src/api/client.test.ts`: 3 of 3 passed (~0.9 s).
- `npx vitest run src/features/auth/change-password-page.test.tsx`: 3 of 3 passed
  (~2.1 s).
- `npx vitest run src/app/owner-flow.test.tsx`: 10 of 10 passed (~2.1 s) — the
  existing auth/session flow file that renders this page; run because the session
  context is in the change set.
- Pre-fix verification of the regression itself: with the three changed source
  files temporarily reverted (stash, no history rewrite), the same flow file fails
  **all three** cases — "Unable to find an element with the text: گذرواژه فعلی نادرست
  است." for the rejected credential, and no login page or neutral copy for the
  other two. The tests therefore fail against the defective behaviour and pass
  after the fix. The files were restored byte-for-byte and verified with `diff`.
- `git diff --check` and the documentation link check
  (`python3 scripts/check-docs-links.py`).

No full suite, no watch mode, no coverage, no build, no Docker, no PostgreSQL and
no repeated run of any command was executed locally.

Not run locally (CI-only by the repository's execution policy): the complete
frontend suite and build, the Owner PostgreSQL/API integration suite, migration
and rehearsal jobs, the Owner/customer images and every customer-side gate.

## Boundaries and known limits

- The API-level alternative — answering a distinct error code or 400 for a
  rejected current credential — would change the Owner error contract that the
  backend README and the manual-observation record already document as the stable
  401 for stale credentials. That is a contract decision, not a defect fix, so it
  is **not** taken here.
- The probe adds one `GET /auth/me` request per rejected change-password attempt
  (not per successful one, and never for a non-401 failure).
- A confirmed expiry still ends the local session and clears cached values; the
  server remains the sole authority on session validity, so no client-side change
  can extend a session.
- OQ-77 option-C wording, general audit retention and the unresolved lifecycle
  questions (OQ-77/OQ-78/OQ-82/OQ-83/OQ-84/OQ-85, U-1) are untouched. No signer,
  key, protocol, migration, role or permission is added.
