# Vardena Frontend

React SPA for the Vardena ERP. It is the **first vertical slice** of the UI
(Task 22): login → authenticated session → RTL application shell →
organization context → permission-aware navigation → Accounting read
surfaces. Everything it shows comes from the real backend API; there is no
mock authentication, no demo data and no client-side accounting arithmetic.

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
│   ├── layouts/app-shell.tsx
│   └── routes/               # require-auth, require-permission, home, 404
├── api/                      # the ONLY HTTP layer
│   ├── client.ts             #   single Axios instance + interceptors
│   ├── errors.ts             #   error envelope → ApiError
│   ├── contracts.ts          #   types derived from the generated OpenAPI document
│   ├── query-keys.ts         #   organization-scoped query keys
│   ├── generated/            #   openapi-typescript output (committed, never edited)
│   └── *.api.ts              #   per-module API functions
├── features/                 # one slice per backend module (AR-27)
│   ├── auth/  permissions/  organization/
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
- **Organization scope follows the API.** `GET /organizations` decides whether
  the shell shows a fixed organization or a switcher (ADR-0025). The selection
  is in-memory, never persisted, and is only a query parameter — the backend
  re-asserts scope (`assertOrganizationInScope`) and answers 404 for anything
  out of scope.
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

## Tests

`vitest` + `@testing-library/react` in jsdom. Tests render the real providers
(query client, session, organization) and stub only the `src/api/*` modules
with `vi.mock`, so what is verified is the application's own behavior:

- login validation, server rejection, successful session, logout;
- protected routing, permission-gated routes and menu entries, 404;
- organization context (single vs. multiple, empty, missing permission);
- API error normalization and session-expiry handling;
- report filters → exact query parameters, paging, sorting, empty/error
  states, and exact decimal rendering.

There is no MSW/HTTP-level mock layer: the API modules are the seam, which
keeps the tests fast and free of a second, drifting contract definition.

## Not in this slice

Treasury, Sales, Purchasing, base chart, control roles, dimensions, posting
rules, document create/finalize UI, Inventory, Workflow, RBAC admin,
notifications, reporting, Excel/print, customization and audit UI. The
frontend is also not part of `docker-compose.yml` yet (documented follow-up).
