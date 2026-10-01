# FE-ORG-01 — Organization & Master Data Administration (Frontend)

**Task:** FE-ORG-01 — frontend vertical slice for organization administration and
organization-scoped master data.
**Branch:** `arena/01a0f6e4-vardena` (base `main` @ `8af1ebc`, merge of PR #96).
**Pull request:** [#98](https://github.com/MR-AliEsmaeili/Vardena/pull/98).
**Implementation commit:** `a7f9d3e` — *feat(frontend): organization & master data
administration (FE-ORG-01)*.
**Backend / Prisma / migration files changed:** **0**.

The section numbering below (26.1 … 26.8) is the section list the task requested.

---

## 26.1 Main audit — repository state before the change

Read first, as `AGENTS.md` requires: `AGENTS.md`, `docs/frontend/standards.md`
(v2.2, in full), `docs/frontend/reference/README.md`,
`docs/frontend/ux/ux-flow-matrix.md`, `STATE.md` §8/§13,
`docs/architecture/domain/master-data-strategy.md`,
ADR-0006 / 0016 / 0020 / 0021 / 0025 / 0030 / 0038.

| Fact | Evidence |
|---|---|
| HEAD of `main` | `8af1ebc` (merge of PR #96) |
| Only CI workflow | `.github/workflows/ci.yml` (jobs `backend`, `frontend`) |
| Frontend baseline, before any edit | `npm ci` + `npm test` → **33 files / 218 tests, exit 0** |
| Node / npm used locally | v22.22.3 / 10.9.8 |
| Prior FE-ORG work | `grep -r "FE-ORG" *.md` → **no match**; this is the first slice |
| Master-data lifecycle | `docs/architecture/domain/master-data-strategy.md` §7.4 (OQ-36): `is_active`, **no delete** |

Governing constraint taken from the task and honored throughout: *current code is
authoritative; documentation that conflicts with current code loses.* Every
contract statement in §26.2 was read out of the controller/DTO/service source,
not out of a document.

---

## 26.2 Backend contract audit (evidence-based, read from source)

Source read in full:
`backend/src/modules/organization/api/{organizations,branches,departments,employees,parties}.controller.ts`,
their `api/dto/*.dto.ts`, `api/dto/organization-scope.dto.ts`,
`application/{organizations,branches,departments,employees,parties}.service.ts`,
`application/master-data-support.ts`, `application/deployment-scope.guard.ts`,
`domain/{organization-permissions,master-data,party,hierarchy}.ts`,
`kernel/pagination/{page-query.dto,paginated-result}.ts`,
`kernel/errors/error-codes.ts`.

### Routes (prefix `/api/v1`)

All five domains expose exactly: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`,
`POST /:id/enable`, `POST /:id/disable`. **No `DELETE` exists on any of them.**
Every route carries `AuthGuard` + `AuthorizationGuard` + `@RequirePermission`,
and the service re-checks the permission.

| Domain | Base path | Organization scoping | Extra list filters | Sortable fields |
|---|---|---|---|---|
| Organization | `/v1/organizations` | path id only, `@DeploymentOrganizationRoot()` | `isActive?`, `search?` | `code,name,createdAt,updatedAt` |
| Branch | `/v1/branches` | `?organizationId=` (and in the create body) | `isActive?`, `search?` | `code,name,createdAt,updatedAt` |
| Department | `/v1/departments` | `?organizationId=` | `parentDepartmentId?`, `isActive?`, `search?` | `code,name,createdAt,updatedAt` |
| Employee | `/v1/employees` | `?organizationId=` | `departmentId?`, `branchId?`, `isActive?`, `search?` | `employeeCode,firstName,lastName,createdAt,updatedAt` |
| Party | `/v1/parties` | `?organizationId=` | `partyType?` (`person\|organization`), `isCustomer?`, `isSupplier?`, `isActive?`, `search?` | `code,displayName,createdAt,updatedAt` |

### Paging envelope

`PageQueryDto`: `page ≥ 1` (default 1), `pageSize` default 100 / max 500,
`sort` = `field:(asc|desc)` CSV, ≤ 200 chars. Response envelope
`{ items, total, page, pageSize }`. An unknown sort field is **400** with
`details[].field = 'sort'`.

### Write contracts that shaped the UI

- **Length limits** (`domain/master-data.ts`): code / employeeCode 64, name 200,
  person name 120, party name 200, email 320 (`IsEmail`), phone 64.
- The global pipe runs `whitelist` + `forbidNonWhitelisted` ⇒ a request may
  never carry a field the DTO does not declare.
- `UpdateDepartmentDto.parentDepartmentId` and
  `UpdateEmployeeDto.{departmentId,branchId}` accept an explicit **`null`** to
  detach. The **create** DTOs have **no null form** — an unset reference must be
  **omitted**.
- `CreatePartyDto`/`UpdatePartyDto`'s `legalName`/`email`/`phone` accept a string
  or omission, **not** `null`.
- `assertOrganizationInScope` answers **404 for an out-of-scope record, never
  403**.
- **422** (`BusinessRuleViolation`): department parent must exist, be in the same
  organization, be active when newly assigned, and must not create a cycle;
  an employee's department/branch must be usable (other-organization ⇒ 404,
  inactive ⇒ 422); a party needs at least one of `isCustomer`/`isSupplier`.
- **409** (`Conflict`): duplicate code inside the organization.
- Error codes in play: 400 `ValidationFailed`/`BadRequest`, 403
  `PermissionDenied`, 404 `EntityNotFound`, 409 `Conflict`, 422
  `BusinessRuleViolation`.

### Permissions

`Organization.{Organization|Branch|Department|Employee|Party}.{View|Create|Edit|Enable|Disable}`
— 25 codes, of which the 21 non-membership codes are modelled in the frontend
registry. There is **no `*.Delete`**, and **`Create` does not require `View`**.

### Registered contract gap (no workaround applied)

`AppException.businessRule(...)` and `AppException.conflict(...)` in the
organization services are raised **without a `details` payload**; only
`validation(issues)` carries the structured
`ValidationIssue { field, message, code }[]`. There is therefore **no
machine-readable discriminator** for a 409/422 sub-case. The honest consequence,
implemented in `admin-error-messages.ts`: classify by **code × resource ×
operation** and never parse the backend `message`. No sub-case is invented, and
no backend change was requested for it in this slice.

### Deferred by contract, not by preference

`POST /organizations` and the whole `organization-memberships.controller.ts`
surface exist, but membership administration is explicitly out of scope for
FE-ORG-01, and organization **creation** is already owned by the first-login
bootstrap flow shipped in PR #96 (`CreateFirstOrganizationForm`). This slice
therefore exposes the organization as a **profile of the active context
organization**, with no organization browser and no second creation path.

---

## 26.3 Frontend capability audit — what already existed

Nothing in this slice re-implements an existing mechanism.

| Need | Existing mechanism reused | Path |
|---|---|---|
| HTTP | `apiGet/apiPost/apiPatch/apiDelete` + `cleanParams` (drops `undefined\|null\|''`, keeps `false`) | `src/api/client.ts` |
| Types | generated OpenAPI operations/schemas — `npm run api:types` **not** needed, every DTO was already present | `src/api/generated` |
| Query keys | organization id at index 1; `ORGANIZATION_GLOBAL_NAMESPACES` | `src/api/query-keys.ts` |
| Org scope | `useOrganizationId()`, `isOtherOrganizationScope()` | `src/features/organization/*` |
| Permissions | `usePermissions()`, `<PermissionGate>`, `<RequirePermission>` | `src/features/permissions/*` |
| Tables / forms / dialogs / alerts | `DataTable`, `PageHeader`, `FormField`, `ConfirmDialog`, `ApiErrorAlert`, `LoadingState`, `EmptyState`, `Alert`, `Card`, `Badge`, `Select`, `Input`, `Button`, `useToast` | `src/ui`, `src/ui/patterns` |
| Error normalization | `normalizeApiError`, `ApiError` | `src/api/errors.ts` |
| Sorting ↔ URL | `sortingToParam` / `sortingFromParam` | `src/lib/sort-param.ts` |
| Dates / counts | `formatDateTime`, `formatCount` | `src/lib/format.ts` |

Two deliberate non-reuses, both required by the standards:

1. `features/accounting/.../master-data-ui.tsx` was **not** imported —
   `standards.md` §2 forbids feature → feature imports. The two atoms this slice
   needed were re-declared in `features/organization/admin/admin-ui.tsx`.
2. No generic `crudApi<Entity>` and no new state library, HTTP client or
   organization-context implementation was introduced.

---

## 26.4 Scope / contract matrix

Legend: **Built** = backend contract exists and is implemented.
**Deferred** = recorded, not built.

| Capability | Organization | Branch | Department | Employee | Party |
|---|---|---|---|---|---|
| List (server page/sort/search/`isActive`) | n/a (single record) | Built | Built | Built | Built |
| Resource-specific list filters | — | — | `parentDepartmentId` via URL | `departmentId`, `branchId` | `partyType`, capability → `isCustomer`/`isSupplier` |
| Detail | Built (profile) | Built | Built (+ resolves parent) | Built (+ resolves dept & branch) | Built |
| Create | Deferred (owned by the first-login bootstrap) | Built | Built | Built | Built |
| Edit | Built | Built | Built | Built | Built |
| Enable / Disable | Built | Built | Built | Built | Built |
| Delete | **Does not exist** (no endpoint) | — | — | — | — |

| Explicitly out of scope / deferred | Reason |
|---|---|
| Membership administration | Deferred by design in the task statement |
| User / role / permission / licensing administration | Out of scope |
| CRM, Sales, Purchasing, Treasury, Inventory, accounting redesign, workflow designer, notifications, audit UI, custom fields / EAV / generic CRUD framework | Out of scope |
| Bulk import, Excel export, advanced search builder, custom columns, saved filters, audit-history UI, attachments, notes, org-chart visualization, drag/drop hierarchy, bulk enable/disable | Scope-creep guard: recorded, not built |
| National id / economic code / tax classification / address / bank account on a party | No DTO field exists (OQ-30, OQ-38) — would be inventing a backend capability. Already tracked as candidate **C-17** in `docs/roadmap/future-task-candidates.md` ("Party completion", BLOCKED BY OQ), so no new roadmap entry was created |

---

## 26.5 Implementation

### 26.5.1 Routes (`src/app/router.tsx`)

```
/app/organization                      index   — ungated area index
/app/organization/profile                      — Organization.Organization.View
/app/organization/<x>s                         — Organization.<X>.View
/app/organization/<x>s/:id                     — Organization.<X>.View
/app/organization/<x>s/:id/edit                — Organization.<X>.View + .Edit
/app/organization/<x>s/new                     — Organization.<X>.Create   (sibling group)
```

Two shapes matter and are asserted by tests:

- `…/new` is a **sibling** of the View-gated group, because `POST` enforces only
  `*.Create`. A Create-only principal must not be blocked by a View gate the
  backend does not require.
- `…/:id/edit` requires **View + Edit**, because the screen reads the record
  (`GET /:id`) before it can submit the change (`PATCH /:id`).

The accounting routes and the `*` catch-all are untouched; an unknown route under
`/app/organization` still renders the existing not-found page (asserted).

### 26.5.2 New files

```
src/features/organization/admin/
├── admin-list-state.ts            URL-owned page/pageSize/search/status/sort + per-resource extras
├── admin-ui.tsx                   ActiveBadge, DefinitionList/Definition, AdminFilters
├── admin-error-messages.ts        code × resource × operation → Persian copy; server validation → fields
├── admin-lifecycle-actions.tsx    enable/disable behind ConfirmDialog (no delete)
├── admin-form-shell.tsx           form chrome: persistent error summary, submit lock, dirty-exit guard
├── admin-references.ts            bounded ACTIVE department/branch option windows, permission-gated
├── admin-schemas.ts               Zod schemas mirroring the DTO limits exactly
├── party-types.ts                 PARTY_TYPES const tuple (no `enum`) + labels
├── organization-admin-home-page.tsx
├── organization-profile-hooks.ts  / organization-profile-page.tsx
├── branches/     branch-hooks.ts, branches-page.tsx, branch-detail-page.tsx, branch-form-page.tsx
├── departments/  department-hooks.ts, departments-page.tsx, department-detail-page.tsx, department-form-page.tsx
├── employees/    employee-hooks.ts, employees-page.tsx, employee-detail-page.tsx, employee-form-page.tsx
└── parties/      party-hooks.ts, parties-page.tsx, party-detail-page.tsx, party-form-page.tsx
```

Touched existing files: `src/api/contracts.ts`, `src/api/organization.api.ts`,
`src/api/query-keys.ts`, `src/app/router.tsx`, `src/app/navigation.ts`,
`src/features/permissions/permission-codes.ts`, `src/lib/i18n.ts`,
`src/test/fixtures.ts`. No unrelated file was rewritten and no drive-by refactor
was performed.

### 26.5.3 Decisions, and the contract each one follows

1. **No delete anywhere.** Enable/disable only, on the **detail** pages (not
   inline in list rows), behind `ConfirmDialog` with consequence copy, plus a
   permanent `noDeleteHint` line explaining that master data has no delete.
2. **Organization = the active context organization.** The id always comes from
   `OrganizationContext`; there is no id input, no URL id and no organization
   browser, so the screen cannot be pointed outside the active scope. Every
   organization write also invalidates the session-global
   `queryKeys.organizations.all()`, because the organization switcher renders the
   name the mutation just changed.
3. **Server-side everything.** `page`, `pageSize`, `sort`, `search`, `isActive`
   and the per-resource filters live in the URL and are forwarded to the
   endpoint. Nothing is filtered or re-paged client-side; a sort field outside
   the endpoint's allow-list is normalized away instead of being sent.
4. **Create omits, update nulls.** Exactly as §26.2 describes. Each payload shape
   is pinned by a test that compares the **whole** request body, because
   `forbidNonWhitelisted` turns any drift into a production 400.
5. **Reference pickers are bounded and permission-gated.** `admin-references.ts`
   reads one window of 200 **active** records of the current organization; the
   control is disabled with explanatory copy when the session lacks the other
   resource's `*.View` or the read failed, and says `optionsTruncated` when the
   organization has more records than the window. No unbounded fetch is
   performed to enable client-side filtering.
6. **Domain rules are not re-implemented.** Hierarchy/cycle/same-organization/
   active-reference rules stay in the service; the UI surfaces the 422 in the
   words of the rule. The only client-side mirror is the party capability rule
   (`isCustomer || isSupplier`), which is pure form feedback — the service still
   enforces it.
7. **An inactive or unknown current reference stays selectable** on an edit form,
   so an unrelated edit cannot silently detach a department/branch; the self row
   is excluded from the department parent picker.
8. **Detail screens that need a related record** (`department` → parent,
   `employee` → department/branch) are split into an outer page (load/error) and
   an inner view, so a related-record hook is never called conditionally. Each
   related read is gated by **that resource's own** `*.View` and falls back to
   the stored id rather than firing a guaranteed 403.
9. **Errors are never swallowed and never echoed.** Server validation issues are
   mapped onto their own controls through an allow-list of field names (unknown
   fields feed only the summary); everything else goes through
   `adminErrorMessage`. A 401 is left to the existing session handler. The
   correlation id is displayed when present; the backend `message` never is.
10. **i18n only.** Every user-facing string is a key under `t.orgAdmin.*`
    (Persian, RTL, consistent with Vardena terminology: سازمان / شعبه /
    واحد سازمانی / کارکنان / طرف حساب — مشتری، تأمین‌کننده). No inline Persian in
    JSX, logical Tailwind utilities only, no hex/rgb, no `any`, no `enum`.

### 26.5.4 Explicitly **not** done

No admin bypass, no `NODE_ENV` bypass, no localStorage/sessionStorage
authorization, no email-match bypass, no hard-coded license limit, no
client-side license enforcement, no second organization-context implementation,
no mock endpoint, no new backend endpoint, no schema or business-rule change.

---

## 26.6 Verification

### 26.6.1 Local — executed, with the real output

Working directory `frontend/`, Node v22.22.3, npm 10.9.8.

| Step | Command | Result |
|---|---|---|
| Lint | `npm run lint` | **0 warnings, 0 errors** (194 files, oxlint) |
| Typecheck | `npm run typecheck` | **exit 0** (`tsc --noEmit`, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) |
| Format | `npm run format:check` | **All matched files use Prettier code style** |
| Tests | `npm test` | **39 files / 277 tests passed**, exit 0 |
| Build | `npm run build` | **exit 0** (`tsc --noEmit && vite build`, 2262 modules) |

Baseline before the change was **33 files / 218 tests**, so this slice adds
**6 test files / 59 test cases** and leaves every pre-existing test passing
(no pre-existing test was modified or skipped).

Two lint findings raised by the new code were fixed rather than suppressed: a
dangling-underscore identifier in `admin-list-state.ts`, and an explicit
`role="status"` on an `Alert` that already defaults to it.

### 26.6.2 What the new tests actually assert

| File | Cases | Pinned behavior |
|---|---|---|
| `organization-admin-routing.test.tsx` | 18 | every list/detail route opens with only its endpoint permission; `…/new` opens with only `*.Create`; `…/new` and `…/:id/edit` are refused to a View-only session; `…/:id/edit` opens with View+Edit; the area index lists only permitted surfaces; an unknown sub-route still renders not-found |
| `organization-admin-lists.test.tsx` | 12 | default + deep-linked query (`page`, `pageSize`, `sort`, `search`, `isActive`) reaches the endpoint verbatim; applying a filter writes the URL, re-queries and returns to page 1; sorting goes through the URL; a non-allow-listed sort field falls back to the default; empty state; retryable error that never shows the backend message; party capability → `isSupplier`, unknown `partyType` dropped |
| `organization-admin-forms.test.tsx` | 10 | party capability rule blocks the call; create body is **exactly** the declared fields (empty optionals omitted); 409 → duplicate-code copy; server `ValidationFailed` lands on its control plus summary; employee create omits unset references; employee update sends `departmentId: null`; branch picker disabled + never requested without `Branch.View`; department parent picker excludes self; parent cleared → `parentDepartmentId: null`; 422 → hierarchy copy |
| `organization-admin-lifecycle.test.tsx` | 7 | no delete affordance; disable states the consequence before calling; the screen follows the server's record; failure keeps the dialog open with mapped copy; a transition the session cannot perform is hidden; the profile reads/writes only the context organization and refreshes the global list; organization-specific confirm copy; read-only profile without `Organization.Edit`; inactive-organization warning |
| `organization-admin-details.test.tsx` | 4 | related department/branch resolved and linked; stored id shown (and no request sent) without the related `*.View`; explicit "not assigned" copy; 404 rendered as a normalized error without the backend message |
| `admin-error-messages.test.ts` | 8 | the code × resource × operation mapping, correlation-id pass-through, and that no English server message ever reaches the user |

### 26.6.3 GitHub CI

CI workflow `.github/workflows/ci.yml`, triggered by PR #98
(`arena/01a0f6e4-vardena` → `main`).

- **Run:** [`36849761466`](https://github.com/MR-AliEsmaeili/Vardena/actions/runs/36849761466) — jobs `backend` and `frontend`.
- The `frontend` job repeats `npm ci → lint → typecheck → format:check → test →
  build`.
- The `backend` job runs the full backend pipeline including **E2E with the live
  Postgres service** (`npm run test:e2e`) and the migration rehearsal. It is the
  authoritative E2E signal for this change, exactly as
  `docs/testing/test-execution-policy.md` and `docs/testing/e2e-hang-root-cause.md`
  prescribe; E2E was **not** run locally.
- Result: see §26.8. The backend job is expected to be unaffected — the diff
  contains zero backend files — and it runs as the regression proof of that
  claim.

---

## 26.7 Documentation updated

| Document | Change |
|---|---|
| `docs/task-fe-org-01-implementation-report.md` | **New** — this report |
| `frontend/README.md` | New "Organization & master data administration (FE-ORG-01)" section: routes, permission shape, the no-delete rule, and an explicit *"Not in this slice"* list |
| `STATE.md` | New addendum §14 recording the task, the zero-backend-change claim, the verification numbers and the deferred list; nothing above it was rewritten |

No other document was edited. Historical task reports were treated as evidence
only; where a document disagreed with current code, the code won.

---

## 26.8 Limitations, deferred items and final status

### Known limitations (none of them a defect in this slice)

1. **No organization creation screen.** `POST /organizations` exists but
   organization creation is owned by the first-login bootstrap (PR #96); adding
   a second path would duplicate a provisioning flow. Recorded, not built.
2. **Membership administration is absent.** Deferred by design in the task
   statement, although `organization-memberships.controller.ts` exists.
3. **409/422 copy is resource+operation scoped, not sub-case scoped** — the
   registered contract gap of §26.2: the services carry no `details` payload on
   those failures, and parsing the English `message` would be a workaround.
4. **Reference pickers show at most 200 active records** and say so when the
   organization has more. The endpoints are server-paginated and this slice does
   not introduce a typeahead (no backend search-by-prefix contract is assumed).
5. **Department hierarchy is shown as a parent reference, not as a tree.**
   Org-chart visualization and drag/drop re-parenting are on the scope-creep
   guard list.
6. **PR size exceeds the ~400-line guidance** in `docs/frontend/standards.md`.
   One slice over five resources shares a single admin layer; splitting it would
   ship either a feature folder with no routes or routes with missing pages.
   Roughly 45% of the diff is tests and Persian copy. Flagged here deliberately
   rather than silently.

### Final status

**READY FOR CI VERIFICATION** — all local gates pass (lint, typecheck,
format:check, 277 tests, build) and the change is pushed as PR #98 with CI run
`36849761466` in flight; the status moves to READY FOR REVIEW once that run is
green.
