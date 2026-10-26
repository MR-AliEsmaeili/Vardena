# ACC-04 — Account administration (in-progress; backend contract wins)

**Date:** 2026-10-26 · **Status:** PARTIAL (not yet Definition of Done)

## Implemented

- Added `PATCH /accounts/:id`, enable/disable API calls with exact organization scope and `UpdateAccountDto`-derived type. `UpdateAccountDto` contains neither `code` nor `localCode`: edit form renders no code input and sends neither field. Create uses the backend's existing `localCode` path for guided root/child creation, or its `code` path for independently authorized Create-only root creation.
- Added edit route (`Account.View` + `Account.Edit`), Create-only route (`Account.Create`), per-row/detail lifecycle confirmation and permissions, Detail Group selection when `Detail.View` is held, and a shared account-prefix/chart-tree invalidation. Existing embedded create form retained.
- **Archive mismatch:** the ACC-04 evidence describes `code` as the only creation field, but current backend `CreateAccountDto` accepts **exactly one of `code` or `localCode`** and composes the full code for `localCode`. The pre-existing create UI uses this authoritative flow, so it was extended, not replaced. The generated `AccountResponseDto.detailGroupId` incorrectly emits `Record<string, never> | null` because Swagger lacks its explicit string type; `contracts.ts` now refines it to the DTO's declared `string | null`.
- See [OQ-95](../decisions/product/OQ-95-account-admin-cross-permission-reference-ux.md) for undecided cross-permission reference-data UX. No backend, generated file, permission registry or migration changed.

## Remaining / not claimed

- ACC-06 accounting-configuration administration and dedicated configuration link have **not** been completed; a pre-existing guided create warning is retained when no active configuration exists.
- The Detail Group selector currently reads active level-1 groups (bounded server list) and relies on the server to reject an obsolete structure; refine to the active structure and a paginated/search picker when ACC-08/09 land.
- End-to-end screenshots, heavy browser/live-DB validation, full acceptance-case matrix and final PR CI verification are outstanding. This report does not claim ACC-04 COMPLETE.

## Test execution matrix

| Gate | Environment | Result |
| --- | --- | --- |
| Account forms, detail, mutation hooks | FAST-LOCAL | Passed focused Vitest; see PR/checkpoint output |
| Typecheck/lint/format, frontend full unit/build, date guard/docs links | FAST-LOCAL | Passed: 749 tests / 106 files, build, date guard and 1,337 documentation links (0 broken) |
| Browser E2E, live DB | CI-HEAVY | Pending GitHub run on pushed SHA |

No heavy E2E/live-DB test was executed locally unless explicitly authorized.
