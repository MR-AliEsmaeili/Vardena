# ACC-04 — Account administration

**Date:** 2026-10-26 · **Status:** IMPLEMENTED; local and PR CI verification passed

## Implemented

- Completed the account administration flow on the existing backend contract: create, list/inspect, edit, enable, and disable. Lifecycle actions remain individually permission-gated and require confirmation where the existing UI pattern requires it. `unlink-detail-group` was deliberately left unchanged and out of ACC-04 (ACC-05).
- Account creation uses the backend's supported `localCode` path when the active accounting configuration is available, with a server-backed eligible-parent picker and full-code preview. Create-only users without the separate read grants get the contract-supported full `code` root form; it issues no unauthorized configuration or account-reference GETs.
- Parent candidates are searched through the backend account-list query, not by filtering a fixed client-side page. A selected parent remains visible while the operator changes the search term.
- Detail-group candidates are queried only when both `Accounting.Detail.View` and `Accounting.DetailStructure.View` are present, and are restricted to active level-1 groups in the active detail-structure version. The active structure ID scopes both the server filter and React Query key. A selected candidate is retained across server-search changes.
- Account edit has no code/localCode input and sends neither field in `PATCH`; the request is formed from `UpdateAccountDto` fields only. Existing linked groups outside the active candidate set are shown as unchanged and not silently resubmitted.
- Shared create/edit/lifecycle mutations refresh the organization account list and chart tree; update/lifecycle also invalidate the edited account detail query.
- **Archive mismatch:** the ACC-04 evidence describes `code` as the only creation field, while the current backend `CreateAccountDto` supports exactly one of `code` or `localCode`. The implementation follows the current DTO. `UpdateAccountDto` excludes both code variants; codes are immutable. The generated `AccountResponseDto.detailGroupId` Swagger type mismatch was already refined in `frontend/src/api/contracts.ts`; no generated file was changed in this task.
- No backend endpoint, API contract, permission, or business rule was added or changed. OQ-95 remains open; this implementation requests reference data only under its existing independent read permissions.

## Verification

- Feature tests cover create-only behavior without unauthorized reference GETs, server-side parent search, active-structure group selection, independent group-read permissions, immutable PATCH fields, and mutation cache invalidation.
- Full acceptance-case testing and browser screenshots remain CI-heavy and are tracked by the GitHub PR checks; they have not been claimed as locally completed.

## Test execution matrix

| Gate                                                                                                 | Environment | Result                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account administration and adjacent master-data/chart-tree tests                                     | FAST-LOCAL  | Passed: 127 tests across 22 files                                                                                                                                             |
| Full frontend unit suite                                                                             | FAST-LOCAL  | Passed: 813 tests across 122 files. An earlier run had two transient failures in unrelated shell/licensing suites; both isolated reruns and the subsequent full rerun passed. |
| Typecheck, lint, format, production build, date-contract, design-token and documentation-link checks | FAST-LOCAL  | Passed; 1,336 relative documentation links, 0 broken. Build emitted non-blocking dependency annotation and large-chunk warnings.                                              |
| Browser E2E, frontend CI, generated API client, docs, and aggregate gate                             | CI-HEAVY    | Passed on [PR #217](https://github.com/MR-AliEsmaeili/Vardena/pull/217), commit `7185f923`; backend checks were correctly not applicable because the backend was unchanged    |

No heavy E2E/live-DB test was executed locally.
