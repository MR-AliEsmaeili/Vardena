# ACC-06 — پیکربندی حسابداری (Accounting Configuration) — implementation report

**Date:** 2026-10-26 · **Status:** implemented; fast gates green locally, heavy/e2e gates delegated to PR CI.
**Task brief:** `task/accounting/ACC-06-accounting-configuration.md` (external task pack, not in the repository).
**Branch:** `arena/52d4679b-vardena` · **Backend changes:** none.

## 1) What was delivered

A complete administration surface over the seven EXISTING endpoints of
`backend/src/modules/accounting/api/accounting-configurations.controller.ts`:

| Surface | File |
| --- | --- |
| list (server pagination + `search`/`status` filters in the URL) | `frontend/src/features/accounting/configuration/configuration-list-page.tsx` |
| create / edit a DRAFT version (header + level editor) | `.../configuration-form-page.tsx`, `.../configuration-levels-editor.tsx`, `.../configuration-levels.ts` |
| detail (header + level table + publish/delete) | `.../configuration-detail-page.tsx` |
| the single action matrix (view/edit/publish/delete with confirmations) | `.../configuration-actions.tsx` |
| queries, mutations and invalidation | `.../configuration-hooks.ts` |
| domain error copy | `.../configuration-error-messages.ts` |
| API layer | `getAccountingConfiguration`, `updateAccountingConfiguration`, `deleteAccountingConfiguration` in `frontend/src/api/accounting.api.ts` |
| contract types | `AccountingConfigurationLevel`, `AccountingConfigurationLevelInput`, refined `AccountingConfiguration`, `UpdateAccountingConfigurationRequest` in `frontend/src/api/contracts.ts` |
| query keys | `accountingConfigurationPrefix`, `accountingConfigurationList`, `accountingConfigurationDetail` in `frontend/src/api/query-keys.ts` |
| routes | `/app/accounting/configurations`, `/new`, `/:id`, `/:id/edit` in `frontend/src/app/router.tsx` |
| navigation + hub card | `frontend/src/app/navigation.ts`, `frontend/src/features/accounting/accounting-home-page.tsx` |
| copy | new `t.accountingConfig` namespace in `frontend/src/lib/i18n.ts` |
| coverage record | `docs/frontend/coverage-matrix.md` §1 row «پیکربندی حساب‌داری»: `MISSING` → `COMPLETE` |

Permission gates use exactly the controller's codes — reads
`Accounting.AccountingConfiguration.View`, every write
`Accounting.AccountingConfiguration.Configure`. `/configurations/new` is a
SIBLING of the View-gated group because `POST` enforces only `Configure`;
`/:id/edit` requires View **and** Configure because it reads the record first.
No permission code was invented; both already existed in
`frontend/src/features/permissions/permission-codes.ts` and the backend
registry.

## 2) Backend truth vs the task brief (deviations, code wins)

1. **`GET /accounting-configurations/active` answers `404 EntityNotFound`** when
   the organization has no active version (`AccountingConfigurationsService.
   getActiveConfiguration` → `AppException.notFound('AccountingConfiguration')`).
   There is no `204`. The pre-existing API client (`getActiveAccountingConfiguration`,
   ACC-04) already maps **404 → `null`**, and that mapping is kept unchanged: "no
   active configuration" stays an ordinary state, never an error.
2. **`pattern` is joined with `' + '`** (`describeConfigurationPattern` in
   `backend/src/modules/accounting/domain/accounting-configuration.ts`), not with
   `'-'` as the brief's example (`2-2-4`) suggests. Read surfaces render the
   server's own `pattern` field verbatim; the form preview uses the same `' + '`
   rule and is labelled as a preview. Nothing recomputes or stores a second
   pattern.
3. **There is no `accounting.configuration.*` error-code family.** The service
   raises `BusinessRuleViolation` (422) for "only a DRAFT can be changed /
   published / deleted" and "already used operationally", `Conflict` (409) when a
   version ordinal is created concurrently, and the kernel's generic codes
   otherwise. `configuration-error-messages.ts` therefore maps by the stable code
   plus the failed operation, never by message text.
4. **`levelKind` is a free ≤20-character label** in the configuration contract
   (`MAX_LEVEL_KIND_LENGTH = 20`; only the *coding structure* DTO enumerates
   `ACCOUNT_LEVEL_KINDS`). The editor offers the four vocabulary values
   (`group | general | subsidiary | detail`) plus «بدون نوع», and sends `null`
   for an empty selection — it does not claim the column is an enum.
5. **`POST /accounting-configurations` takes `organizationId` in the BODY**,
   while every read/`PATCH`/`publish`/`DELETE` takes it as a QUERY parameter.
   The API layer sends exactly that shape (an invented parameter would be a 400
   from the global `ValidationPipe`).
6. **`maxDepth` does not exist in this module**: depth is the number of levels.
   None was added.
7. **`effectiveFrom` is an Instant** (`@IsDateString()` + `new Date(...)` in the
   controller), not a BusinessDate. The form takes a Jalali day through
   `DateInput` and converts it with `calendarDayStartInstant(day, timeZone)`
   (never `new Date(day)`, never `toISOString().slice(0,10)`); a day that cannot
   be normalized to a valid local midnight in the organization's IANA zone is
   refused with domain copy instead of being approximated. Updating derives the
   day back with `instantDayInZone(instant, timeZone)`, so an untouched value
   round-trips to the same instant.
8. **Parts of the contract already existed** from ACC-04: the create/publish/
   list/active API functions, both permission codes, `accountingConfigurationActive`
   and the guided `chart-setup-form`. They were extended/reused, not replaced.
   `useActiveAccountingConfiguration` keeps its single definition in
   `features/accounting/master-data/master-data-hooks.ts` and is re-exported by
   `configuration-hooks.ts` (same `accountingConfigurationActive` key) so the
   same server fact never gets two query definitions.
9. **Contract type refinement.** The generated document emits
   `Record<string, never> | null` for the untyped nullable `effectiveFrom` /
   `operationallyUsedAt` and for `levels[].levelKind`. `contracts.ts` refines
   exactly those keys to `string | null` (refinement 1 of its header) so the
   payload and the renderer are typed like the backend DTO declares them. No
   `any`, no cast, no generated-file edit.

## 3) State matrix (as enforced)

| Version state | edit | publish | delete |
| --- | --- | --- | --- |
| `DRAFT` | ✅ (`PATCH`), 422 otherwise | ✅ (`POST /publish`) | ✅ only while `!isOperationallyUsed` |
| `ACTIVE` | — | — | — |
| `SUPERSEDED` | — | — | — |

Publishing is confirmed in a `ConfirmDialog` whose copy states that the
currently active version becomes `SUPERSEDED`, that this version then defines
the account-code shape, and that existing accounts do not change. Deleting is a
danger-confirmed, explicitly irreversible action, shown only for an unused
draft.

Levels are contiguous by construction: rows are added and removed **only at the
tail**, and `validateLevels` additionally rejects duplicate/gapped ordinals, a
digit length outside `1..32`, a digit sum wider than the 32-character account
code, an empty title, and a kind longer than 20 characters — before any request
is sent. The backend remains the final verdict.

## 4) Tests

| File | Coverage |
| --- | --- |
| `configuration-levels.test.ts` | add/remove/renumber, pattern preview rule, body mapping (trimmed title, empty kind → `null`), ordering, title/digit/gap/total-length/depth rejection, valid set |
| `configuration-levels-editor.test.tsx` | rows + preview, add/remove emission, last row not removable, row/set problem rendering, single-row patch |
| `configuration-list-page.test.tsx` | three versions with backend statuses + server pattern, action matrix (DRAFT vs ACTIVE/SUPERSEDED), delete hidden when operationally used, no write action without `Configure`, first-run empty state with CTA, error + working retry, exact list query (server paging/sort) |
| `configuration-form-page.test.tsx` | create body with levels and `effectiveFrom` as ISO UTC Instant, omission when empty, required/digit validation blocking the request, edit through `PATCH` without `code`, published version read-only |
| `configuration-detail-page.test.tsx` | header + levels from the server, server `pattern`, publish dialog copy and call, delete only for unused draft, read-only published version |
| `configuration-error-messages.test.ts` | kernel codes, `BusinessRuleViolation` disambiguation by operation, fallback never renders server text |

## 5) Test execution matrix

| Gate | Environment | Result |
| --- | --- | --- |
| Focused Vitest (`src/features/accounting/configuration`, 32 tests / 6 files) | FAST-LOCAL | Passed |
| `npx tsc --noEmit` (full frontend) | FAST-LOCAL | Passed |
| `npm run lint` (oxlint) | FAST-LOCAL | 0 errors, 0 warnings |
| `npm run format:check` (prettier) | FAST-LOCAL | Passed |
| `npm test` (full Vitest, 799 tests / 117 files) | FAST-LOCAL | Passed |
| `npm run build` | FAST-LOCAL | Passed |
| `python3 scripts/check-date-contract.py` | FAST-LOCAL | Passed |
| `node scripts/check-frontend-design-tokens.mjs` | FAST-LOCAL | Passed |
| Browser E2E (Playwright), docs links, generated-client drift, backend jobs | CI-HEAVY | Delegated to the PR pipeline; not executed locally on purpose |

No heavy, live-DB or browser test was executed locally; the PR check run is the
evidence for those gates, and this report does not claim them green.

## 6) Remaining / not claimed

- Screenshots of the four states are not attached: the browser suite is the
  delegated verification for this change set.
- `docs/frontend/standards.md` was not edited (new patterns are not introduced —
  the pages compose existing patterns). The `no-unstable-nested-components`
  rule did surface during review and the list columns are now built by a
  module-level factory, so no component is created during render.
- No new Open Question was needed: every behavior above is stated by the
  backend contract, not invented.
