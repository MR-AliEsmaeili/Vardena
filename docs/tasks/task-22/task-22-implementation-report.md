# Task 22 — Frontend Vertical Slice (Login → Session → RTL Shell → Organization Context → Accounting Read Surfaces) — Implementation Report

Status: **READY FOR REVIEW — IMPLEMENTATION COMPLETE** · **NOT ACCEPTED**
(the implementing agent does not self-accept; acceptance is the Repository
Owner's decision — `.vardena/agent-rules.md` AG-06/AG-16, `STATE.md` §6).

Date: 2026-09-26 · Branch `arena/01a0ded9-vardena` · Base `71f430c`
(merge of PR #61 on `main`) · PR **#62** · head `772bdbb` · CI run
**36263120844** (`frontend` PASS, `backend` PASS).

Governing rules: ADR-0002 (fixed stack) · ADR-0007 (session auth) ·
ADR-0014 (OpenAPI is the contract) · ADR-0021/ADR-0025 (organization scope,
deployment pin) · AR-19/AR-21/AR-26/AR-27/AR-28 and §F of
`.vardena/architecture-rules.md` · AG-14 (frontend feature slices).

---

## 1. Scope

The first production-oriented UI slice of the repository, end to end and
against the REAL backend contract:

1. **API client layer** — one Axios instance, environment-based base URL,
   error-envelope normalization, cookie session transport.
2. **Authentication** — login page (React Hook Form + Zod), logout, protected
   routes, expired-session handling. No mock/demo authentication.
3. **Application shell** — responsive Persian/RTL layout with sidebar, top
   bar, user/session info, organization context and logout.
4. **Organization context** — driven by the existing
   `GET /api/v1/organizations` contract (ADR-0025).
5. **Permission-aware UI** — from `GET /api/v1/permissions/effective`; UX only.
6. **Accounting read surfaces** — landing page, chart tree, account statement,
   general ledger, trial balance.
7. **Shared primitives** — loading/error/empty states, page header, filter
   bar, data table, pagination, form field, permission gate, API error
   display.
8. **Quality gates + CI** — lint, typecheck, format, tests, build, and a new
   parallel `frontend` job in `.github/workflows/ci.yml`.

Everything else is explicitly **out of scope** and absent: Treasury, Sales,
Purchasing, base chart, control roles, dimensions, posting rules/mapping,
document create/finalize UI, Inventory, Workflow, RBAC admin, notifications,
reporting, Excel/print, customization, audit UI, and any new backend
capability.

## 2. Backend-change statement

**No Backend production behavior changed.** No file under `backend/` is
modified by this task: no controller, service, DTO, permission, guard, Prisma
schema, migration, seed, dependency or test. No new, duplicated or
frontend-specific endpoint was added, no authorization rule was relaxed, and
no accounting calculation was reimplemented client-side.

The OpenAPI document used to generate the frontend types was produced from a
**temporary, unversioned** script that booted the existing `AppModule` and
called `SwaggerModule.createDocument`; the script was deleted immediately and
`git status` confirms the backend tree is clean.

## 3. Contract-fidelity decisions (no invention)

| Area | Decision | Source of truth |
|---|---|---|
| Auth transport | httpOnly session cookie; `withCredentials: true` only, no token in JS/localStorage/UI | `backend/src/modules/identity` (ADR-0007) |
| Login failure | one generic message for every cause; the UI renders the server answer | `POST /auth/login` returns 401 "Invalid username or password." for all causes |
| Session state | `GET /auth/me` 401 ⇒ state `unauthenticated` (not an error); other failures ⇒ error state | identity controller |
| Permissions | exact-match codes from the backend registry, no wildcard/prefix expansion | `accounting-permissions.ts`, `organization-permissions.ts`; AR-21 |
| Organization | `GET /organizations`; one row ⇒ fixed context, several ⇒ switcher; selection in memory only, never persisted, never treated as authorization | ADR-0025, `assertOrganizationInScope` (Task 19 ODR-3) |
| Chart tree | flat, code-ascending pages nested for display only; **no `sort` sent** (explicit sort ⇒ 400) | `chart-tree.controller.ts` (Task 19 ODR-2) |
| Account statement | `organizationId + accountId + fiscalYearId` required; period/area optional; **no `sort`** (fixed legal order); totals rendered as returned | `account-statement.dto.ts` (Task 17B D1–D5) |
| General ledger / trial balance | required `organizationId + financialAreaId + fiscalYearId`; optional period/account/code/name/date range; sorting limited to the endpoint's allow-list (column id **is** the API sort field) | Task 18 controllers/DTOs |
| Amounts | exact decimal strings; grouping-only display, never `Number()`, never summed — the trial balance shows **no total row** because the contract returns none | AR-05, `docs/accounting/domain-contract.md` |
| Dates | `YYYY-MM-DD` displayed verbatim; Zod mirrors `DATE_ONLY_PATTERN`; no Jalali conversion | `accounting/domain/date-range.ts`; OQ-02 OPEN |
| Errors | branch on `code`, never on `message`; correlation id surfaced | `kernel/errors/*` |
| Paging | server-owned `page`/`pageSize`/`total`; page 1 on any filter/sort/page-size change | `kernel/pagination/*` |

## 4. Files

New package `frontend/` (see `frontend/README.md` for the full layout):
configuration (`package.json`, `package-lock.json`, `vite.config.ts`,
`tsconfig.json`, `vitest.config.ts`, `.oxlintrc.json`, `.prettierrc`,
`.prettierignore`, `.gitignore`, `.env.example`, `index.html`), `src/api/`
(client, errors, contracts, query keys, generated OpenAPI types, four API
modules), `src/app/` (providers, query client, router, navigation, shell,
route guards, home, 404), `src/features/`
(`auth`, `permissions`, `organization`, `accounting/{chart-tree,
account-statement,general-ledger,trial-balance,shared}`), `src/ui/`
(primitives + patterns), `src/lib/` (i18n dictionary, formatters, helpers),
`src/styles/`, `src/test/`, and eleven test files.

Repository files changed: `.github/workflows/ci.yml` (new `frontend` job),
`README.md`, `.vardena/project-context.md`, `docs/architecture.md` (§6 layout
status, §7 implementation note), `docs/modules.md` (PR #61 correction),
`STATE.md` (§2 inventory, §2 CI inventory, §7 task row, §8 in-review entry),
and this report.

### `docs/modules.md` correction (PR #61)

The sentence "Proposed ADRs 0017–0020 are pending acceptance; nothing there is
implemented yet." was true about 0017–0020 but read as a statement about the
whole repository. It now scopes the claim to capabilities that depend on those
ADRs and points at the module map for what does exist. **No ADR status was
changed and no decision was invented.**

## 5. Verification (local, on the implementation head)

| Gate | Command (in `frontend/`) | Result |
|---|---|---|
| Install | `npm ci` / `npm install` | OK (lockfile committed; `npm ci --dry-run` in sync) |
| Lint | `npm run lint` | **0 warnings, 0 errors** (86 files, 191 rules) |
| Typecheck | `npm run typecheck` | clean (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Format | `npm run format:check` | "All matched files use Prettier code style!" |
| Tests | `npm test` | **11 files / 63 tests passed** |
| Build | `npm run build` | OK — `react` 50.69 kB, `forms` 112.40 kB, `data` 136.17 kB, `index` 320.70 kB, CSS 24.08 kB; no chunk-size warning |
| Backend untouched | `cd backend && npm run build`; `git status` | build OK; no backend file modified |

Backend live-database E2E was **not** run locally (no Docker/PostgreSQL in the
environment, and the suites are opt-in via `VARDENA_TEST_DATABASE_URL`); that
coverage belongs to the unchanged `backend` CI job.

**CI on the PR head (`772bdbb`, PR #62): run `36263120844` — `frontend` job
PASS (58s) and `backend` job PASS (3m27s, including Prisma validate/generate,
lint, typecheck, format, unit tests, build, migration rehearsal and the
live-PostgreSQL E2E suites).** An earlier run of the same PR failed only on
`frontend` → `Format check` (Prettier had not been run over
`frontend/README.md`); the fix is commit `772bdbb` and no source behavior was
involved.

### What the tests cover

Auth transitions (validation, generic server rejection, successful session,
logout), protected routing and route-level permission boundaries, menu
filtering by permission, 404, permission gate semantics (AND, no wildcard, no
flash before load), organization context (single, multiple + switch, empty,
missing permission ⇒ no request), API error normalization (envelope, status
fallback, network, terminal vs retryable) and session-expiry notification,
report filter schemas and query building (only declared parameters, no `sort`
for the statement), page-reset rules, exact decimal rendering, empty and error
table states, server pagination and server sorting, and chart-tree nesting
(including orphan handling).

Tests stub the `src/api/*` modules with `vi.mock` and exercise the real
providers; no MSW/HTTP mock layer was introduced, so there is no second,
drifting definition of the contract.

## 6. Architecture-scope confirmations

- Task 22 added no Redux/Zustand/MobX, GraphQL, Next.js, microfrontend, or
  alternative UI/router/data dependency. This records that slice's dependency
  scope, not a permanent prohibition on a justified client-state library; the
  current policy is `docs/frontend/standards.md` §۵.
- One Axios instance; no ad-hoc `fetch`/`axios` in components (AR-28).
- Feature slices mirror backend modules (AR-27); column definitions, schemas
  and hooks live beside their feature, not in a generic "utils" dump.
- One responsive RTL layout — no duplicated mobile pages.
- Frontend permission checks are UX only (AR-21); hidden UI is never treated
  as authorization.
- No secrets in source; no password logging; no token in the UI; no
  `dangerouslySetInnerHTML`.
- All user-facing text comes from `src/lib/i18n.ts` (AR-F); domain terminology
  follows the repository vocabulary (حساب، کد حساب، دفتر کل، تراز آزمایشی،
  گردش حساب، دوره مالی، سال مالی، حوزه مالی، سازمان).
- No ADR promoted, no OQ closed, no accepted task reopened.

## 7. Follow-ups (not fixed here — they need Owner/backend decisions)

1. **OpenAPI annotation gaps** (documentation/annotation only; the wire
   responses are already correct, so no production behavior is affected):
   - every paginated endpoint registers the same schema name
     `PaginatedResponseClass` (from `paginatedResponseOf`), so the generated
     item type collapses to whichever endpoint registered last;
   - `@ApiProperty({ nullable: true })` without an explicit `type` emits
     `Record<string, never> | null` for nullable string ids/fields;
   - `AccountStatementResponseDto.movements` and the `AccountStatementScopeDto`
     members emit as `Record<string, never>`, and `AccountStatementEntryDto` is
     absent from the document.
   The frontend compensates with documented, narrowly-scoped type refinements
   in `src/api/contracts.ts`; fixing the annotations would let those be
   deleted.
2. **Organization context for principals without `Organization.Organization.View`.**
   A session with accounting read permissions but no organization view
   permission cannot discover its organization: the shell shows an explicit
   "no organization" state naming the missing permission. Whether a
   self-service "my organizations" read should exist is an Owner decision
   (candidate OQ).
3. **Frontend Docker/Compose integration** — `docker-compose.yml` was
   deliberately not redesigned; adding a static-serving frontend service (and
   the reverse-proxy rule for `/api`) is a separate, explicitly authorized
   change.
4. **`docs/security.md` §2** still says login "returns user + effective
   permissions"; the code returns the user only and permissions come from
   `GET /permissions/effective`. Reported, not silently edited.
5. **Grid state persistence** (column visibility/order, saved filters) belongs
   to the customization module per AG-14 and is intentionally not stored
   locally.
6. **Localization decision (OQ-02)** remains open: the dictionary and the
   formatters are the single place where the language/calendar decision will
   land.
