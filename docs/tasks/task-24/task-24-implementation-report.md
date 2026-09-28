# Task 24 — R-2 Implementation Report

**Subject:** organization-scope enforcement on `GET /api/v1/accounts` (all request paths)
**Owner decision implemented:** **R-2 — APPROVED** (recorded in `docs/tasks/task-24/task-24-scope-design-gate.md`, finding **F-1**)
**Branch:** `arena/01a0e18c-vardena`
**Pull request:** [#67](https://github.com/MR-AliEsmaeili/Vardena/pull/67)
**Commit:** `67e1bc8` **CI:** run `36306140879` — `backend` pass, `frontend` pass
**Status:** READY FOR REVIEW — _not_ accepted. Acceptance is the Owner's act (`STATE.md` §6: "READY FOR REVIEW is not acceptance").

---

## 0. Divergence check — stated framing vs. repository reality

Required by the task: audit first, record any divergence **before** changing code. The audit was executed
against the working tree of `arena/01a0e18c-vardena` (base `main` @ `7754aaa`). Result:

| #   | Framing in the task statement                                            | Repository reality                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Divergence?                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET /api/v1/accounts` does not enforce organization scope on every path | Confirmed. `AccountsService.listAccounts` ran `requireAllPermissions([Accounting.Account.View])` and nothing else; the scope assertion happened only inside the `if (query.parentId …)` branch                                                                                                                                                                                                                                                                            | **No divergence**                                                                                                                                                                                                |
| 2   | "`assertOrganizationInScope` runs only on the `parentId` branch"         | Accurate in effect, indirect in form: the `parentId` branch calls the private helper `mustFindInOrganization(organizationId, parentId)`, and _that_ helper is what calls `organizations.assertOrganizationInScope(organizationId)` before loading the row. There is no direct call to `assertOrganizationInScope` anywhere in `listAccounts`                                                                                                                              | **Wording only** — the mechanism is one indirection deeper than the framing suggests. Recorded here; no behavioural difference                                                                                   |
| 3   | An HTTP guard already pins the deployment organization                   | **Divergent (pre-existing, finding F-3).** A comment in the Task 10.3 pin spec speaks of a "global pin guard", but no `APP_GUARD` of that kind is registered anywhere in the Nest bootstrap. The pin is enforced _only_ inside `OrganizationsService.assertOrganizationInScope`. Consequence: the missing call in `listAccounts` bypassed the **deployment pin** as well as the membership binding — the exposure is slightly wider than "a non-member reads another org" | **Yes — recorded, not fixed here.** F-3 is a separate finding (R-4/R-5 territory); this task only restores the chokepoint on the account list                                                                    |
| 4   | The problem is specific to the account list                              | **Divergent (pre-existing, finding F-2).** The same missing chokepoint exists on `financial-areas`, `fiscal-years`, `accounting-periods` and `coding-structures` list methods                                                                                                                                                                                                                                                                                             | **Yes — deliberately out of scope.** R-2 approves the _account_ list only; F-2 is proposal R-5 and remains an Owner decision. One existing assertion documenting that gap was left intact and annotated (see §4) |
| 5   | Fix must preserve 404 / non-disclosure                                   | Confirmed as the established posture: every by-id account path (`get`, `update`, `enable`, `disable`, `create`) already answers `404 EntityNotFound` for a foreign organization, and `GET /organizations/:id/branches` is the precedent for a **list** answering 404                                                                                                                                                                                                      | **No divergence**                                                                                                                                                                                                |

No other divergence was found. Nothing in the framing had to be re-interpreted in order to apply the fix.

---

## 1. Root cause

`AccountsService.listAccounts` performed **permission** authorization but never performed **scope**
authorization for itself. It inherited scope only as a side effect of an _optional_ filter:

```ts
// before
await this.authorization.requireAllPermissions([ACCOUNT_PERMISSIONS.VIEW]);
if (query.parentId !== undefined && query.parentId !== null) {
  await this.mustFindInOrganization(query.organizationId, query.parentId); // ← scope lived here
}
const { items, total } = await this.repository.list({ where: { organizationId: query.organizationId, … } });
```

`query.organizationId` is an **untrusted, caller-supplied** value. The repository dutifully filters by it, so the
response is always internally consistent — every returned row does belong to the organization that was asked for —
which is exactly why the defect is invisible in a row-shape assertion. The missing question was never "which rows?"
but "**is this caller allowed to name this organization at all?**".

Two guarantees were therefore skipped whenever `parentId` was absent:

1. **ODR-3 (Task 19) principal → membership binding.** A principal holding `Accounting.Account.View` from any
   role, in any organization, could read the full chart of accounts of **every** organization in the deployment by
   changing one query parameter.
2. **ADR-0025 deployment organization pin.** A single-organization deployment could still be induced to serve
   rows belonging to a non-pinned organization.

**Class of defect:** authorization coupled to an optional input (a _conditional_ chokepoint) rather than to the
operation itself. Not a data-leak in the query layer, not a permission-model error.

---

## 2. Which path failed to enforce the scope

| Request                                                                     | Pre-fix behaviour                                                   | Post-fix behaviour                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /accounts?organizationId=<own>`                                        | 200, own rows                                                       | 200, own rows — **unchanged**                                                                                   |
| `GET /accounts?organizationId=<foreign>` (**no `parentId`**)                | **200 + the foreign organization's accounts** ← the defect          | **404 `EntityNotFound`**                                                                                        |
| `GET /accounts?organizationId=<foreign>&isActive=…&level=…&search=…&sort=…` | **200 + foreign accounts** (no optional filter ever asserted scope) | **404 `EntityNotFound`**                                                                                        |
| `GET /accounts?organizationId=<foreign>&parentId=<foreign parent>`          | 404 (scope asserted by `mustFindInOrganization`)                    | 404 — **unchanged**                                                                                             |
| `GET /accounts?organizationId=<own>&parentId=<foreign parent>`              | 404 (non-disclosure of a foreign parent)                            | 404 — **unchanged**                                                                                             |
| `GET /accounts` with no `organizationId`                                    | 400 validation error                                                | 400 — **unchanged** (DTO validation still precedes authorization)                                               |
| Caller without `Accounting.Account.View`                                    | 403 `PermissionDenied`                                              | 403 — **unchanged**; the permission decision still runs **first**, so a missing code is never downgraded to 404 |

---

## 3. The minimal change made

**Reuse, not redesign.** No new authorization mechanism, no new guard, no new decorator, no new error code, no
new repository method. The fix is a single call to the **existing** chokepoint that every other account path
already goes through:

```ts
// backend/src/modules/accounting/application/accounts.service.ts — listAccounts()
await this.authorization.requireAllPermissions([ACCOUNT_PERMISSIONS.VIEW]);
+ await this.organizations.assertOrganizationInScope(query.organizationId);   // ← R-2, every path
  if (query.parentId !== undefined && query.parentId !== null) { … }
```

`OrganizationsService.assertOrganizationInScope(organizationId)` (already injected into `AccountsService`,
already used by `mustFindInOrganization`) performs, in order: the ADR-0025 deployment pin check, the
organization-exists check, and the ODR-3 membership check — raising `AppException.notFound('Organization')`
(`404 EntityNotFound`) for any failure, and short-circuiting to "trusted caller" in system/internal context.

**Two deliberate non-choices, recorded:**

- **`requireUsableOrganization` was NOT used.** It is `assertOrganizationInScope` **plus** an "organization must
  be active" rule that answers **422** for a disabled organization. Using it would have introduced a _new failure
  mode_ on a read surface (listing the chart of a disabled organization would start failing) — an unapproved
  contract change. R-2 asks for scope enforcement, not for a usability rule. `requireUsableOrganization` remains
  correct for the write paths and for `chart-tree`, which already use it.
- **The duplicate lookup in the `parentId` branch was NOT refactored away.** With a `parentId` present, the scope
  is now asserted twice (once here, once inside `mustFindInOrganization`). That is one extra indexed membership
  read on one branch. Removing it would mean editing the shared `mustFindInOrganization` helper used by _every_
  account path — a drive-by refactor of the authorization boundary, explicitly outside this task's mandate. The
  redundancy is intentional and noted here instead.

**Second (documentation-only) edit:** `AccountsController.list` gained an `@ApiNotFoundResponse(...)` annotation
and an `@ApiOperation.description` stating that the scope is asserted on every request. This changes the OpenAPI
_description_ of a status code the endpoint can now return; it changes no route, DTO, schema, status semantics or
permission. It is included because an undocumented 404 on a list endpoint would be a worse deliverable than a
documented one — if the reviewer prefers a strictly one-file diff, this hunk can be dropped without affecting
behaviour or any test.

**Files changed (3):**

| File                                                                           | Change                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `backend/src/modules/accounting/application/accounts.service.ts`               | +1 statement (+10 comment lines) — the fix                 |
| `backend/src/modules/accounting/api/accounts.controller.ts`                    | OpenAPI annotation only (no behaviour)                     |
| `backend/src/modules/accounting/application/coding-structure-accounts.spec.ts` | +9 regression tests; 1 pre-existing assertion updated (§4) |

---

## 4. Tests added / updated

All in `backend/src/modules/accounting/application/coding-structure-accounts.spec.ts`, new suite
**`ODR-3 organization scope on the account list (Task 24 / R-2)`**. The suite drives the **real**
`AuthorizationService`, real RBAC grant rows and the real `OrganizationsService` membership store — it is not a
mock of the boundary. Fixture shape: the actor holds **every** account/structure/configuration permission but is a
member of **Org A only**; Org B is provisioned entirely through the trusted system context so that the actor is a
complete stranger to it, and Org B genuinely **owns two accounts** (an empty page must never be mistaken for an
enforced boundary).

| Req.      | Test                                                                               | Asserts                                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A**     | _returns the caller's own organization accounts (no behaviour change)_             | 200, `total = 2`, codes `['02','02001']`, every `organizationId === orgA`                                                                                                                |
| **B + C** | _refuses a foreign organization with 404 when no parentId filter is supplied_      | First proves via system context that Org B really holds 2 accounts, then the actor's identical call (no `parentId`) fails with `EntityNotFound` — **the exact regression R-2 addresses** |
| **C**     | _refuses a foreign organization identically for every optional filter combination_ | `isActive` / `isPostable` / `level` / `search` / `sort` each → `EntityNotFound`; no optional parameter is a scope carrier                                                                |
| **B**     | _never leaks a foreign organization's accounts into an in-scope list_              | Searching Org B's code `'03'` inside Org A returns `total: 0`, `items: []` — no cross-organization row can reach a legitimate response                                                   |
| **D**     | _keeps the parentId path working inside the caller's organization_                 | `parentId = <own root>` → `total: 1`, the expected child — no regression on the previously-guarded path                                                                                  |
| **D**     | _refuses a foreign organization even when a parentId filter is supplied_           | `organizationId = orgB`, `parentId = <orgB parent>` → `EntityNotFound` (was already correct; now pinned)                                                                                 |
| **E**     | _reports a parent that belongs to another organization as not found_               | `organizationId = orgA`, `parentId = <orgB parent>` → `EntityNotFound`; no disclosure of the foreign parent's existence                                                                  |
| extra     | _keeps the deployment pin (ADR-0025) enforced on the list without a parentId_      | A deployment pinned to Org A refuses a list for a non-pinned organization **even when the actor is a member of both** — closes the pin half of the hole (divergence #3)                  |
| extra     | _still refuses the list with 403 when the View permission is missing_              | Authorization order preserved: permission first (403), scope second (404); no silent downgrade, no new bypass                                                                            |

**Updated existing assertion.** `deployment organization pin over the Task 10.3 surface (ADR-0025) › confines every
chart and structure operation to the pinned organization` asserted `listAccounts(foreign) → { total: 0, items: [] }`,
i.e. it _encoded the pre-fix behaviour_. It now asserts `EntityNotFound` for the account list, with a comment
explaining why an empty page is not evidence of enforcement. Its sibling assertion on `structures.listVersions` was
**left as an empty page on purpose**, annotated as finding F-2 / proposal R-5 — the equivalent gap on the other
accounting list surfaces is not part of R-2 and must not be silently fixed here.

**Proof that the tests actually bind (negative control).** With the single new statement commented out and nothing
else changed, the suite fails exactly where it must:

```
× deployment organization pin … › confines every chart and structure operation to the pinned organization
× ODR-3 … › refuses a foreign organization with 404 when no parentId filter is supplied
× ODR-3 … › refuses a foreign organization identically for every optional filter combination
× ODR-3 … › keeps the deployment pin (ADR-0025) enforced on the list without a parentId
Tests  4 failed | 37 passed (41)
```

With the statement restored: `Tests 41 passed (41)`.

---

## 5. Proof that cross-organization access is impossible on this surface

1. **Single entry point.** `listAccounts` is called from exactly one place in the codebase —
   `AccountsController.list` (verified by grep over `src/`). There is no internal or worker caller that could reach
   the repository query by another route.
2. **Assertion precedes every read.** The new call sits before the `parentId` branch, before `toOffset`, before the
   `where` construction and before `repository.list`. No code path inside `listAccounts` can reach the repository
   without having passed it; there is no early return, no try/catch and no conditional around it.
3. **The identifier is asserted, not merely filtered.** Enforcement now applies to the caller-supplied
   `organizationId` itself, not to the shape of the rows. Both failure modes are therefore closed: naming a
   foreign organization, and naming one outside the deployment pin.
4. **No parameter is a scope carrier.** The dedicated filter-matrix test exercises `isActive`, `isPostable`,
   `level`, `search` and `sort` against a foreign organization; each answers 404. `parentId` has lost its former
   status as the only scope-bearing parameter.
5. **Non-disclosure preserved.** Every refusal is `AppException.notFound('Organization')` → `404 EntityNotFound`,
   identical to the response for an organization id that does not exist. The caller cannot distinguish
   "exists but not yours" from "does not exist"; no 403, no empty 200, no error-detail leak. This matches the
   by-id account paths and the `GET /organizations/:id/branches` precedent.
6. **No wildcard, no bypass added.** The only context that skips the check is the pre-existing system/internal
   context (no HTTP request in flight), which is the established posture of `AuthorizationService` and is untouched
   by this change. The tests use it solely to _plant_ the foreign data they then fail to read.
7. **Whole unit suite green** (1229 tests, 107 files), so no other behaviour depended on the previous leniency.

---

## 6. Did the API contract change?

**Behaviourally: one status code becomes reachable where it previously was not.**

- `GET /api/v1/accounts?organizationId=<out of scope>` → **404 `EntityNotFound`** instead of **200 with foreign
  data**. This _is_ the security fix; it is precisely what R-2 approves, and it aligns the list with every other
  account endpoint and with `GET /organizations/:id/branches`.
- Unchanged: route, HTTP method, query DTO (`parentId | level | isActive | isPostable |
codingStructureVersionId | search | page | pageSize | sort`), response shape (`items`/`total`/`page`/`pageSize`),
  field names and types, sort semantics, pagination, the required `Accounting.Account.View` permission, the
  403 for a missing permission, and the 400 for a missing/invalid `organizationId`.
- **In-scope callers observe no difference whatsoever.**
- OpenAPI: the 404 is now documented on the operation (annotation only).

## 7. Did the schema or a migration change?

**No.** No Prisma model, field, index, constraint or enum was touched; no migration was added, edited or
re-ordered; no seed or bootstrap change. `backend/prisma/` is untouched by this commit. The fix is purely an
application-layer authorization call.

---

## 8. Deliberately out of scope

Not touched, not decided, not "tidied up":

- **F-2 / R-5** — the same missing chokepoint on `financial-areas`, `fiscal-years`, `accounting-periods` and
  `coding-structures` list methods. Still open; still an Owner decision. One existing test annotates it rather
  than hiding it.
- **F-3** — the absent global pin `APP_GUARD` (the spec comment that claims one is wrong). Recorded; not created.
  This fix does not depend on a guard existing.
- **F-4 / B (enable–disable integrity), F-5 (mandatory accounts), F-6 (in-memory lifecycle events)** — untouched.
- **All Account policy questions**: disabling a used/parent/mandatory account, post-use code mutability,
  delete vs. retire, base-chart upgrade. **No policy invented, no OQ resolved** — OQ-25 / OQ-36 and the existing
  decisions remain exactly as they are.
- **R-1, R-3, R-4, R-6** — no action; R-3 (`hasChildren` / `isStructurallyFrozen`) stays deferred.
- Account lifecycle, deletion, code history/reuse, Base Chart and its upgrade, control roles, dimensions,
  posting, ledger, inventory, workflow, treasury — untouched.
- RBAC / permission catalogue / organization model — no redesign, no new permission code, no changed semantics.
- Frontend — no change of any kind.
- No refactor of `mustFindInOrganization` (see §3), no response-shape change, no renaming, no reordering.

**Blockers / Decisions Needed:** none for R-2. The fix required exactly **one** change at the authorization
boundary, so the "stop and report" condition was not triggered. Items above that need a decision are already
carried as F-2…F-6 / R-1…R-6 in the gate document.

---

## 9. CI status

Local fast gates (executed in `backend/`, all green):

| Gate               | Command                                                                               | Result                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Unit — target spec | `npx vitest run src/modules/accounting/application/coding-structure-accounts.spec.ts` | **41 passed**                                                                              |
| Unit — full suite  | `npm test`                                                                            | **1229 passed / 107 files**                                                                |
| Lint               | `npm run lint`                                                                        | **0 errors** (7 pre-existing warnings, none in the changed files)                          |
| Types              | `npm run typecheck`                                                                   | **clean**                                                                                  |
| Format             | `npm run format:check`                                                                | **clean**                                                                                  |
| Build              | `npm run build`                                                                       | **success**                                                                                |
| Prisma validate    | `npm run prisma:validate`                                                             | not runnable locally — requires `DATABASE_URL`; no schema change to validate, CI covers it |

Heavy/long gates — Postgres-backed `migrate deploy`, `bootstrap:system-admin` and the 34 e2e specs — were
**delegated to GitHub CI** on PR #67, per the standing instruction not to block on local E2E.

**GitHub CI — run [`36306140879`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/36306140879) on commit `67e1bc8`: GREEN.**

| Workflow job                                                                                                                                               | Result   | Duration |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------- |
| `backend` (prisma validate → generate → lint → typecheck → format:check → unit → build → `migrate deploy` on postgres:16 → `bootstrap:system-admin` → e2e) | **pass** | 3m56s    |
| `frontend`                                                                                                                                                 | **pass** | 57s      | The e2e suites were inspected for dependence on the old behaviour: the only cross-organization |
| account list in `test/account-structure.e2e-spec.ts` is made by a principal that the fixture seeds as a member of                                          |
| **both** organizations, so it legitimately still expects 200. CI result is reported in the final summary and on                                            |
| the PR.                                                                                                                                                    |

---

## 10. Acceptance checklist (self-check — NOT an acceptance)

| #   | Item                                                       | State                                                                                   |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | R-2 implemented as approved                                | ✅                                                                                      |
| 2   | Organization scope enforced on **all** list paths          | ✅                                                                                      |
| 3   | A missing `parentId` can no longer bypass the scope        | ✅ (negative control proves it)                                                         |
| 4   | Cross-organization regression coverage exists (A–E)        | ✅ 9 tests                                                                              |
| 5   | 404 / non-disclosure preserved; no 403, no empty-page tell | ✅                                                                                      |
| 6   | No new account policy invented                             | ✅                                                                                      |
| 7   | No unnecessary contract / schema / permission change       | ✅ (schema untouched; the 404 is the approved fix; OpenAPI annotation is documentation) |
| 8   | Relevant CI green                                          | ✅ run `36306140879` — `backend` **pass**, `frontend` **pass**                          |
| 9   | Report complete (9 required questions answered)            | ✅                                                                                      |
| 10  | **Agent does not ACCEPT the task**                         | ✅ Status is **READY FOR REVIEW**; acceptance belongs to the Owner                      |
