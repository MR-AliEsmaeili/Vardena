# FE-LICENSE-01 — Frontend License Activation (implementation report)

**Scope:** the frontend vertical slice that lets an authenticated session
activate the installation license. The backend licensing foundation (L-01 /
L-02, ADR-0030) is used as-is: **no backend file was changed**.

## 1. Backend contract consumed (unchanged)

| Endpoint | Auth | Backend source |
| --- | --- | --- |
| `GET /api/v1/license/current` | `AuthGuard`, no RBAC permission | `backend/src/modules/licensing/api/license-state.controller.ts` |
| `POST /api/v1/license/activate` | `AuthGuard` + `AuthorizationGuard` with `Licensing.License.Activate` | `backend/src/modules/licensing/api/license-activation.controller.ts` |

Request body: `ActivateLicenseDto` — exactly one field, `code`
(`IsString`, `MinLength(1)`, `MaxLength(8192)`). Response: the evaluated
`LicenseStateView` plus `changed: boolean` (re-submitting the current code is
idempotent). Rejections are `AppException.businessRule(...)` → 422
`BusinessRuleViolation` (signature, installation binding, lifecycle), with no
structured `details` discriminator.

## 2. Frontend changes

| File | Change |
| --- | --- |
| `frontend/src/api/contracts.ts` | `ActivateLicenseRequest`, `LicenseActivationResult`, `LICENSE_CODE_MAX_LENGTH` (typed, no `any`, no open JSON type) |
| `frontend/src/api/licensing.api.ts` | `activateLicense()` through the existing Axios client (`apiPost`) |
| `frontend/src/features/licensing/license-activation-schema.ts` | RHF + Zod schema: trim, non-empty, ≤ 8192 — no client-side license verification |
| `frontend/src/features/licensing/license-activation-errors.ts` | Error-code → Persian copy mapping (never the backend message) |
| `frontend/src/features/licensing/use-activate-license.ts` | Mutation; `onSuccess` invalidates **and awaits** the refetch of `queryKeys.licenseState()`; `retry: false`, `gcTime: 0` |
| `frontend/src/features/licensing/license-activation-form.tsx` | The activation card (label, hint, validation, pending, failure, retry) |
| `frontend/src/app/layouts/license-gate.tsx` | `inactive` → activation step when the session holds `Licensing.License.Activate`, otherwise the unchanged explainer |
| `frontend/src/features/permissions/permission-codes.ts` | `PERMISSIONS.licensing.licenseActivate` (copied from the backend registry) |
| `frontend/src/lib/i18n.ts` | Persian activation copy (no inline strings in JSX) |

No new route, no second shell, no new global store, no second license source:
the single canonical query key `['licensing','license','current']` stays the
only license state.

## 3. License states

`loading` · `active` · `inactive` · `error` — unchanged four-way model in
`use-license-state.ts`. A failed read is never rendered as "inactive"; a
successful POST never marks the state active. After activation the gate
releases only on a re-read of `GET /license/current` reporting `active: true`;
if that re-read fails, the gate shows its retryable error state.

## 4. Security

- The raw code exists only in the form state and in the body of one in-flight
  request. No `localStorage` / `sessionStorage` / IndexedDB / cookie / URL /
  query-string write, no analytics, no logging (the frontend has no logger and
  this task introduced none; `console.*` is absent from `src/features/licensing`).
- The mutation cache is in-memory only (no persister in the app) and
  `gcTime: 0` drops the variables once settled.
- No hardware/browser fingerprinting and no frontend installation id: the
  displayed `installationId` comes verbatim from the backend response.
- No admin bypass, no `NODE_ENV` shortcut, no mock provider. The permission
  check only decides whether the *form* is offered; the gate still requires a
  backend-confirmed active license for everyone.

## 5. Tests

New: `frontend/src/features/licensing/license-activation.test.tsx` (10 tests)
— activation UI on inactive, none on active, explainer without the permission,
empty/whitespace rejection, successful activation + re-read + organization
bootstrap without re-login, duplicate-submit prevention, backend rejection +
retry, successful POST with failed re-read staying blocked/retryable, 401
fabricating nothing, and the storage/URL/log/cache leakage checks.

Updated (behavioral change, coverage preserved and extended):
`frontend/src/app/layouts/license-gate.test.tsx` — the never-licensed case
with `Licensing.License.Activate` now asserts the activation surface, and a new
sibling test keeps the original explainer assertions for a session without that
permission.

Executed locally (frontend only): `npm test` (41 files, 298 tests, all pass),
`npm run typecheck`, `npm run lint`, `npx prettier --check src`, `npm run build`.
Backend suites and live-DB/E2E verification are left to GitHub CI.

## 6. Review trail

- Branch `arena/01a0f7cb-vardena`, commit `e72e547`
  (`feat(frontend): license activation step in the licensing bootstrap gate`).
- PR [#100](https://github.com/MR-AliEsmaeili/Vardena/pull/100) → `main`.
- GitHub CI history on this branch:
  - run `36875679821` on `e72e547` (implementation): **success** — jobs
    `frontend` and `backend`, the latter including the live-PostgreSQL suites
    this task did not run locally;
  - run `36876812366` on `501830c` (documentation-only commit): **failure** in
    the backend step "E2E tests (incl. live-DB suites)" — no code changed
    between `e72e547` and `501830c`, so it is not attributable to this task;
  - run `36877691687` on `a120b20` (empty re-run commit, identical tree):
    **success** — both jobs, confirming the previous failure was transient.
    The flaky suite was neither skipped nor weakened.
- Documentation updated with the implemented behavior:
  `docs/licensing-architecture.md` §"Frontend consumption" (the statement that
  "the frontend adds no activation form in L-02" no longer describes the
  repository) and a License Activation row in
  `docs/frontend/ux/ux-flow-matrix.md`.

## 7. Known limitations

- All backend activation rejections (malformed code, bad signature, wrong
  installation, expired/suspended) map to one Persian sentence: the service
  raises them through `AppException.businessRule(...)` without a structured
  `details` discriminator, so there is nothing to branch on. Registered as a
  contract gap, not worked around by parsing messages.
- The activation step is offered only to sessions holding
  `Licensing.License.Activate` (UX routing; the backend authorizes the call
  regardless).
