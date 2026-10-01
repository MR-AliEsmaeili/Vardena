# Vardena Frontend

React SPA for the Vardena ERP. It contains the accepted **Task 22 vertical
slice** (login → authenticated session → RTL application shell → organization
context → permission-aware navigation → Accounting read surfaces) and the
**Task 32 Dashboard**, whose final merged behavior is the corrective PR #86.
Everything it shows comes from the real backend API; there is no mock
authentication or production demo data. Exact backend decimal strings remain
authoritative; Dashboard summaries use digit-exact presentation aggregation and
never become a second accounting source of truth.

## Stack (fixed — ADR-0002)

React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui-style primitives ·
React Router · TanStack Query · Axios · React Hook Form + Zod ·
TanStack Table · Day.js · lucide-react icons.

State is selected by ownership: backend-owned data lives in TanStack Query,
local interaction state stays in components, and narrowly scoped cross-tree
dependencies may use React Context. The project neither mandates nor forbids a
global client-state library; one may be selected deliberately when complex,
client-owned state genuinely crosses feature boundaries. Do not mirror server
state into a global store or introduce competing global-state libraries.

## Quick start

```bash
npm ci
cp .env.example .env    # optional — the defaults work with the dev proxy
npm run dev             # http://localhost:5173
```

The dev server proxies `/api` to `VITE_DEV_API_PROXY_TARGET`
(default `http://localhost:3000`), so the browser always calls a same-origin
relative URL and the session cookie works without CORS. Start the backend
first (`cd ../backend && npm run start:dev`, or `docker-compose up` from the
repository root).

| Variable                    | Default                 | Meaning                                                              |
| --------------------------- | ----------------------- | -------------------------------------------------------------------- |
| `VITE_API_BASE_URL`         | `/api/v1`               | Base URL the SPA calls. Relative by design — never hard-code a host. |
| `VITE_DEV_API_PROXY_TARGET` | `http://localhost:3000` | Dev-server proxy target for `/api` (dev only).                       |

## Scripts

| Script                            | What it does                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server with the `/api` proxy                                         |
| `npm run build`                   | `tsc --noEmit` then the production bundle in `dist/`                          |
| `npm run preview`                 | Serve the built bundle locally                                                |
| `npm run lint`                    | oxlint (config in `.oxlintrc.json`)                                           |
| `npm run typecheck`               | TypeScript, strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| `npm run format` / `format:check` | Prettier                                                                      |
| `npm test` / `test:watch`         | Vitest + Testing Library (jsdom)                                              |
| `npm run api:types`               | Regenerate `src/api/generated/vardena-api.d.ts` from the OpenAPI document     |

Regenerating the API types (the API must be running, or point the variable at
an exported document):

```bash
npm run api:types                                   # from http://localhost:3000/api/docs-json
VARDENA_OPENAPI_SOURCE=./openapi.json npm run api:types
```

`openapi-typescript` is invoked through `npx` at a pinned version instead of
being a dependency: it peer-requires TypeScript 5 while this package (like the
backend) is on TypeScript 6. The generated file is committed, so nothing has
to run for a normal install.

## Layout

```
src/
├── main.tsx                  # entry point
├── app/                      # composition root: providers, router, shell, route guards
│   ├── App.tsx providers.tsx router.tsx query-client.ts navigation.ts
│   ├── layouts/              # app-shell + the bootstrap stages it runs:
│   │                         #   license-gate, organization-gate, bootstrap-states
│   └── routes/               # require-auth, require-permission, home, 404
├── api/                      # the ONLY HTTP layer
│   ├── client.ts             #   single Axios instance + interceptors
│   ├── errors.ts             #   error envelope → ApiError
│   ├── contracts.ts          #   types derived from the generated OpenAPI document
│   ├── query-keys.ts         #   organization-scoped query keys
│   ├── generated/            #   openapi-typescript output (committed, never edited)
│   └── *.api.ts              #   per-module API functions
├── features/                 # one slice per backend module (AR-27)
│   ├── auth/  permissions/  dashboard/  licensing/
│   ├── organization/         #   context/switcher + admin/ (profile, branches,
│   │                         #   departments, employees, parties)
│   └── accounting/{chart-tree,account-statement,general-ledger,trial-balance,shared}
├── ui/                       # primitives (button, card, input, table, …) + patterns/
├── lib/                      # i18n dictionary, formatters, cn(), small hooks
├── styles/                   # Tailwind entry
└── test/                     # setup, render helpers, fixtures
```

## Conventions

- **One Axios instance** (`api/client.ts`). No `fetch`/`axios` calls inside
  components; every server read goes through TanStack Query.
- **Session = httpOnly cookie** (ADR-0007). The SPA only sets
  `withCredentials`; no token is stored in JS, localStorage or the DOM.
- **Permissions are UX only** (AR-21). `PermissionGate` / `RequirePermission`
  hide what a session cannot use; the backend authorizes every request. Codes
  are copied from the backend registry — no wildcards, no invented codes.
- **Authenticated bootstrap runs in one fixed order** (`app/layouts/`):

  ```
  login → session (GET /auth/me) → license (GET /license/current)
        → organization (GET /organizations) → organization context → workspace
  ```

  `LicenseGate` (`app/layouts/license-gate.tsx`) is the licensing stage and
  sits between the session and the organization stage, so the installation
  license state is known before any organization UI exists. It has exactly
  four states — checking / active / inactive / failed read — and only the
  active one renders its children (the organization gate and the workspace
  behind it). A failed read is never treated as "inactive" and never as
  "active": it is a retryable error state. **License ≠ permission:** an
  inactive installation license also empties the effective permission set
  server-side (`AuthorizationService.effectivePermissionCodes` →
  `LicensingService.filterLicensedPermissions`), so without this stage the
  user would be told they lack permission when the real cause is the
  license; the stage exists so each cause gets its own Persian explainer.
  The license is read **once per authenticated session** through the single
  `useLicenseState()` hook / `queryKeys.licenseState()` entry
  (`features/licensing/`) — not per route, page or feature — and the
  session's existing logout/401 cache reset (`queryClient.clear()` in
  `SessionProvider`) is what evicts it, so no license state can survive into
  the next session.

- **The license is never enforced in the browser** (AR-21, ADR-0030). The
  stage routes the UI and nothing else: it compares no count against
  `organizationLimit`/`userLimit`, derives no entitlement of its own (the
  contract's `entitlements` collection is consumed as-is), stores nothing in
  `localStorage`/env, and has no development fallback. Every licensed
  capability is re-evaluated server-side on each call
  (`LicensingService`, `OrganizationsService.createOrganization`).
- **Organization scope follows the API.** `GET /organizations` decides whether
  the shell shows a fixed organization or a switcher (ADR-0025). The selection
  is in-memory, never persisted, and is only a query parameter — the backend
  re-asserts scope (`assertOrganizationInScope`) and answers 404 for anything
  out of scope.
- **`GET /organizations` returning `[]` is not always a dead end.** In the
  default unpinned deployment mode (ADR-0021) a fresh install legitimately
  starts with zero organizations. `OrganizationGate` still shows the terminal
  "no organization available" explainer by default, but a session that holds
  both `Organization.Organization.Create` and `Organization.Membership.Grant`
  sees the first-organization bootstrap form instead
  (`features/organization/create-first-organization-form.tsx`), which calls
  the existing `POST /organizations` then `POST /organizations/:id/members`
  endpoints — no new endpoint, no invented organization state, no bypass.
  That form is reached only behind an active installation license, because
  the licensing stage above the gate has already answered that question (see
  the bootstrap order), which is why the gate itself only ever decides the
  organization/permission question. `OrganizationsService.createOrganization`
  remains the sole enforcement point. See
  `docs/task-33-organization-first-login-provisioning-report.md`.
- **Amounts are exact decimal strings.** They are displayed digit-for-digit
  (grouping only, `lib/format.ts`), never parsed into a `number`, never summed
  or recomputed. Dates are shown as the API returns them (`YYYY-MM-DD`); no
  calendar conversion (OQ-02 is open).
- **Server owns filtering, paging and sorting.** Only allow-listed sort fields
  are offered, pagination always requests a new page, and no filter that the
  endpoint does not declare exists in the UI.
- **All user-facing text lives in `lib/i18n.ts`** — no inline literals. The UI
  is Persian/RTL (`<html lang="fa" dir="rtl">`); layout uses logical
  properties so one responsive layout serves every breakpoint.

## Organization & master data administration (FE-ORG-01)

`features/organization/admin/` administers the organization module's master
data. Routes, and the permission each one needs — the same permission the
endpoint behind it enforces:

| Route                                     | Permission                                                     |
| ----------------------------------------- | -------------------------------------------------------------- |
| `/app/organization`                       | none (index; each card is gated individually)                  |
| `/app/organization/profile`               | `Organization.Organization.View`                               |
| `/app/organization/<x>s` and `…/<x>s/:id` | `Organization.<X>.View`                                        |
| `/app/organization/<x>s/new`              | `Organization.<X>.Create` **only** — `POST` enforces no `View` |
| `/app/organization/<x>s/:id/edit`         | `Organization.<X>.View` **and** `.Edit`                        |

where `<x>` is `branch`, `department`, `employee` or `party`.

- **There is no delete.** None of these controllers exposes `DELETE`: the
  lifecycle of master data is the `is_active` flag
  (`docs/architecture/domain/master-data-strategy.md` §7.4, OQ-36). Enable and
  disable live on the detail pages behind `ConfirmDialog`.
- **Create omits, update nulls.** The create DTOs have no `null` form for an
  optional reference (it is omitted), while `UpdateDepartmentDto` and
  `UpdateEmployeeDto` take an explicit `null` to detach one. A party's optional
  text fields are omitted when empty — they accept no `null`. The backend runs
  `whitelist` + `forbidNonWhitelisted`, so a request never carries an undeclared
  field.
- **The organization surface is the active context organization only** — no id
  input, no URL id, no organization browser.
- **Failures are classified by error code** in the context of the resource and
  the operation (`admin/admin-error-messages.ts`). The organization services
  raise `businessRule()` / `conflict()` without a `details` payload, so nothing
  finer can be inferred honestly — and the backend `message` is never rendered.
- Reference pickers (department parent, an employee's department/branch) offer
  one bounded window of this organization's **active** records, are disabled
  with an explanation when the session lacks the other resource's `View`, and
  keep an existing inactive reference selectable so an edit cannot silently
  detach it.

Details, audit evidence and the deferred list:
`docs/task-fe-org-01-implementation-report.md`.

## Tests

`vitest` + `@testing-library/react` in jsdom. Tests render the real providers
(query client, session, organization) and stub only the `src/api/*` modules
with `vi.mock`, so what is verified is the application's own behavior:

- login validation, server rejection, successful session, logout;
- protected routing, permission-gated routes and menu entries, 404;
- the licensing bootstrap stage (`app/layouts/license-gate.test.tsx`): no
  license read before a session exists, the checking state, an active
  license continuing into the organization gate, an inactive one stopping
  before it with license — not permission — copy, a failed read with retry
  and its recovery, single-source entitlement consumption, the
  first-organization flow behind an active license, and license-cache
  isolation across logout/login;
- organization context (single vs. multiple, empty, missing permission);
- API error normalization and session-expiry handling;
- report filters → exact query parameters, paging, sorting, empty/error
  states, and exact decimal rendering;
- organization administration: route ↔ endpoint permission alignment,
  URL-owned server-side list state, the exact create/update request bodies,
  the enable/disable confirmation and its failure path, and the error-code →
  Persian copy mapping.

There is no MSW/HTTP-level mock layer: the API modules are the seam, which
keeps the tests fast and free of a second, drifting contract definition.

## Not in this slice

Treasury, Sales, Purchasing, base-chart administration, control roles,
generic multi-dimension administration, posting rules, Inventory
administration, Workflow decision UI, RBAC admin, notifications, a generic
Reporting UI, Excel/print, customization and audit UI.

Not in the organization administration slice either (FE-ORG-01): organization
**membership** administration (deferred by design), an organization list or a
second organization-creation path (`POST /organizations` is owned by the
first-login bootstrap above), bulk import, Excel export, an advanced search
builder, custom columns, saved filters, audit-history UI, attachments, notes,
org-chart visualization, drag/drop hierarchy and bulk enable/disable. Party
fields the DTOs do not declare — national id, economic code, tax
classification, address, bank account (OQ-30, OQ-38) — are absent because the
backend has no contract for them.
The Dashboard does read bounded Inventory/Workflow/Accounting endpoints, but
that does not make those administration or mutation surfaces implemented. The
frontend is also not part of `docker-compose.yml` yet (documented follow-up).
