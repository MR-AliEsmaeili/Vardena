# Frontend loading system — web-service activity and Thinking Orbs

**Status:** implemented for Product Owner review (2026-10-19)
**Scope:** `frontend/` only. No backend, contract or architecture change.
**Decision record:** [ADR-0051](../adr/0051-global-request-loading-system.md)
**Library:** `thinking-orbs@0.3.2` (MIT © 2026 Jakub Antalik)

This document is the operational reference for every loading indicator in the
SPA: where activity is registered, how it is finalized, which surface the user
sees, and what is deliberately excluded.

---

## 0. Audit baseline (2026-10-19)

Verified in the checkout before implementing (not assumed from memory):

| Area | Reality |
| --- | --- |
| Framework | React 19.3, TypeScript 6.0 (strict + `exactOptionalPropertyTypes`), Vite 7.3 |
| Styling / primitives | Tailwind CSS 4.3 (Vite plugin), local shadcn/ui-style primitives in `src/ui/` |
| Server state | TanStack Query 5.104 (`queries.retry` < 2 for non-terminal errors, `staleTime` 30 s, mutations `retry: false`) |
| Transport | Axios 1.20, **one** instance in `src/api/client.ts`; 97 call sites across 6 `*.api.ts` modules; no `fetch`/WebSocket/EventSource |
| Auth | httpOnly session cookie (ADR-0007), `withCredentials`; **no refresh-token flow**; 401 on `/auth/me`, `/auth/login`, `/auth/logout` is a session probe, other 401s clear the query cache and route to login |
| Cancellation | TanStack Query `signal` → Axios `AbortSignal`; `normalizeApiError` maps `ERR_CANCELED` to `RequestAborted` |
| Existing loading UI | `LoadingState`/`FullPageLoading`/`ResolvingState`, `DataTable` skeleton rows, per-mutation `isPending` labels and disabled controls, dashboard widget skeletons, explicit `scopeMissing`/`noPermission` states |
| Existing feedback contract | `docs/frontend/ux/feedback-standard.md` (one primary channel; skeleton/label at section level; errors persistent; Toasts for completed mutations only) |
| Pre-existing dependency governance | ADR-0002 fixed stack; ADR-0029/0030/0041 govern frontend state ownership; new dependency needs an ADR (AR-29/AR-30) |
| Existing tests | 61 files / 426 tests green before the change; feature suites mock `@/api/*`, so the new cross-layer tests drive the real client with a controllable adapter |

The audit found no other loading library and no second HTTP path. The design
therefore registers activity in the existing interceptor pair instead of adding
a wrapper around every hook.

---

## 1. Architecture

```
feature component / TanStack Query
        │  (existing isPending / isFetching state stays untouched)
        ▼
apiGet / apiPost / apiPatch / apiDelete        ← the only HTTP helpers
        │
        ▼
single Axios instance (src/api/client.ts)
  request interceptor  ──►  beginRequest({scope, message}) ──► token
  response interceptor ◄──  endRequest(token)   (success/error/cancel)
  helper `finally`     ◄──  endRequest(token)   (same token, no-op if already ended)
        │
        ▼
src/api/request-activity.ts  (framework-free registry, useSyncExternalStore)
        │
        ├─ GlobalRequestIndicator      one delayed, non-modal panel  (writes)
        ├─ BackgroundActivityIndicator ambient top-bar orb            (reads)
        └─ LocalFetchingIndicator      per-table refresh label        (local)
```

Key invariants:

- **One registration per real HTTP attempt.** A TanStack Query retry or a
  user-triggered retry is a new attempt with a new token. There is no
  double-counting of the same attempt.
- **Exactly-once finalization by token.** `endRequest` deletes the token; a
  second call (interceptor and helper) is a no-op. Counts can never go
  negative, and one request can never end another.
- **No React in the transport.** The registry is a plain module; React only
  subscribes. No provider, store or Context was added.
- **No request from the UI.** The indicators render state; they never call an
  API or refetch anything. The "never creates an extra request" test proves
  that one `apiGet` produces exactly one adapter call.
- **No swallowed errors.** Helpers `await` and rethrow; normalization and
  401/session-expiry behavior is unchanged (finalize happens first).

### Registration and finalization

| Phase | Location | What happens |
| --- | --- | --- |
| Start | request interceptor | `resolveRequestActivity(config)` decides scope/message; stores token on `config.vardenaRequestActivityToken` and in the per-call tracker |
| Primary end | response interceptor (success **and** error) | `endRequest(config.vardenaRequestActivityToken)` before 401 handling/error normalization |
| Safety net | `runTrackedRequest` `finally` | `endRequest(tracker.token)`; covers adapters and cancellation errors that lose the Axios config |
| Retry | every new HTTP call | new interceptor run → new token → independent lifecycle |
| Cancel | Axios abort / query cancellation | response error path and/or helper `finally` end the token; no stuck entry |
| Internal / non-network work | — | never enters the registry (no HTTP call) |

The registry deliberately does **not** time out an in-flight request. A server
operation that never settles is genuinely still running; hiding it would be a
false negative, and inventing a timeout could mask a real problem.

---

## 2. Scope policy (global vs local)

`resolveRequestActivity` is the only policy point:

| Request | Default | Where the user sees it |
| --- | --- | --- |
| `GET` / `HEAD` / `OPTIONS` | `background` | Section skeleton (`LoadingState`) + ambient top-bar orb after 300 ms. Never covers the page. |
| `POST` / `PATCH` / `PUT` / `DELETE` | `global` | Existing local button/dialog state immediately; one global panel after 500 ms if the write is still running. |
| Explicit `{ scope: 'background' }` | override | Auth (`login`, `logout`, `change-password`) and license import: their screens own the channel; no global panel. |
| Explicit `{ scope: 'silent' }` | not tracked | Reserved for a future probe that must not flicker. **No production call uses it today.** |
| Explicit `{ message: 'processing' }` | override | Neutral text for document/inventory/device lifecycle commands. |

Why writes default to global: the user is waiting for a mutation whose
originating control may leave the viewport (dialogs, long server commands).
The panel is additive, delayed, and non-modal; it never replaces the immediate
local feedback. Why reads default to background: tables, filters, polled
dashboards and focus refetches must remain usable while data refreshes.

### Heuristics applied

| Situation | Surface | Example |
| --- | --- | --- |
| Initial data of a page/section | page-shaped local skeleton with orb + label | document detail, report page, admin detail |
| Table refresh / search / paging / sort | local refresh label + dimmed table + `aria-busy` | every `DataTable` |
| Sensitive mutation | operation-scoped control (dialog/button) + delayed global panel | issue/finalize/reverse/delete document, inventory lifecycle |
| Long blocking command | global panel only when it outlives 500 ms | license import, device lifecycle, accounting finalize |
| Polling / background refetch | ambient orb only, never the panel | dashboard widgets, license state |
| Optional/secondary request | local state of that widget | reference pickers, dashboard side widgets |

---

## 3. Visual and accessibility contract

- **One global surface.** `GlobalRequestIndicator` is mounted once in
  `AppProviders`; concurrent writes share it and the panel shows the neutral
  «در حال انجام عملیات…» when messages disagree.
- **Non-modal.** Fixed, `pointer-events-none`, no backdrop, no focus trap, no
  Escape handling: the page and its controls stay reachable. Duplicate submits
  are still prevented by the existing disabled/loading buttons.
- **Aliasing/live region.** The panel is an `<output>` with `aria-live="polite"`
  and `aria-atomic="true"`, kept mounted (empty) while idle so assistive tech
  announces the change. The ambient orb is `aria-hidden` because the section
  owns the announcement.
- **Errors are separate.** No error text, code, raw message or correlation ID
  enters the loading UI. Existing persistent section errors, form alerts and
  Toasts are untouched.
- **RTL.** All positioning uses logical properties (`start`, `end`); the panel
  declares `dir="rtl"`. Numbers/IDs elsewhere keep their existing `dir="ltr"`.
- **Theme.** The wrapper defaults to `theme="auto"`; `index.html` declares
  `<html data-theme="light">`. The library follows the nearest
  `data-theme`/`.dark`/`.light` ancestor and `prefers-color-scheme`. A future
  dark theme flips the root attribute; no orb changes are required. The app is
  light-only today (no dark tokens), so a full dark theme is out of scope.
- **Reduced motion.** `prefers-reduced-motion: reduce` is honored by the
  library with one static frame; no second branch is duplicated in app code.
- **No layout shift.** The global panel is fixed; the ambient orb occupies a
  fixed-size slot; skeleton rows keep the content's shape. The local refresh
  label lives in the pagination/footer row.
- **Thresholds, no artificial delay.** Global `500 ms`, ambient `300 ms`,
  local `300 ms`. Nothing is shown for faster requests; nothing is kept on
  screen after settling. There is **no minimum visible duration** and no timer
  is added to a successful operation.

---

## 4. Coverage matrix

"State owner" is the existing TanStack Query hook; no state was moved. "Loading
type" names the surface(s) rendered by this system in addition to the existing
local state. `bg` = background (ambient orb + section local), `global` = delayed
panel + local control, `local` = section/widget only.

### Bootstrap and identity

| Feature / route | API (method + path) | State owner | Loading type |
| --- | --- | --- | --- |
| App boot (all routes) | `GET /auth/me` | `useSession` (`session-context`) | bg; full-page orb during session check |
| Login `/login` | `POST /auth/login` | `session-context` login mutation + `login-page` | local (full-screen form + button orb); override `background` |
| Logout (shell, gates, change-password) | `POST /auth/logout` | `session-context` logout mutation | local button orb; override `background` |
| Effective permissions | `GET /permissions/effective` | `usePermissions` | bg |
| Change password | `POST /auth/change-password` | `session-context` | local form + button orb; override `background` |
| License gate | `GET /license/current` | `useLicenseState` | bg + resolving orb (64) |
| License import (admin) | `POST /license/import` | `use-import-license` | local form/button orb; override `background` |
| Client devices list/history | `GET /license/devices`, `GET /license/devices/:id/history` | `use-client-devices` | bg + `LoadingState` |
| Device enrollment/replacement lifecycle (7 commands) | `POST /license/devices/...` | `use-client-devices` mutations | global (`processing`) + confirm dialog |

### Organization context and administration

| Feature / route | API (method + path) | State owner | Loading type |
| --- | --- | --- | --- |
| Organization gate | `GET /organizations/mine` | `useOrganization` (`organization-context`) | bg + resolving orb |
| First organization | `POST /organizations`, `POST /organizations/:id/members` | `create-first-organization-form` | global + local form/button orb |
| Organization profile | `GET/PATCH /organizations/:id` | `organization-profile-hooks` | bg / global + `LoadingState` + submit orb |
| Organization enable/disable | `POST /organizations/:id/{enable,disable}` | `organization-profile-hooks` | global + confirm dialog |
| Branches | `GET /branches`, `GET /branches/:id`, `POST /branches`, `PATCH /branches/:id`, `POST /branches/:id/{enable,disable}` | `branch-hooks`, `branch-detail/form-page` | list/detail bg + `LoadingState`; mutations global + submit orb/confirm |
| Departments | same shape under `/departments` | `department-hooks` | same |
| Employees | same shape under `/employees` | `employee-hooks` | same |
| Parties | same shape under `/parties` | `party-hooks` | same |
| Admin reference pickers | bounded `GET` of departments/branches | `admin-references` | local (bg) |
| Membership grant (not surfaced in UI) | `POST /organizations/:id/members` | first-organization flow only | global |

### Dashboard

| Feature | API (method + path) | State owner | Loading type |
| --- | --- | --- | --- |
| KPI cards | `GET /accounting/balances` (aggregated fetches) | `use-dashboard-data` | bg + widget skeleton + `aria-busy` |
| Documents widget | `GET /accounting-documents` | `use-dashboard-data` | bg |
| Inventory widget | `GET /inventory/balances` | `use-dashboard-data` | bg |
| Workflow widget | `GET /workflow/instances` | `use-dashboard-data` | bg |
| Chart/reference data | `GET /financial-areas`, `GET /fiscal-years`, `GET /accounting-periods` | `use-dashboard-references`, `use-dashboard-scope` | bg |

### Accounting

| Feature / route | API (method + path) | State owner | Loading type |
| --- | --- | --- | --- |
| Chart tree | `GET /accounting/chart-tree` | `use-chart-tree` | bg + `LoadingState` |
| Accounts list/detail | `GET /accounts`, `GET /accounts/:id` | `master-data-hooks` | bg + `LoadingState` |
| Financial areas | `GET /financial-areas`, `POST /financial-areas` | `master-data-hooks`, `financial-area-create-form` | bg + `LoadingState`; create global + submit orb |
| Fiscal years | `GET /fiscal-years`, `POST /fiscal-years` | `master-data-hooks`, `fiscal-year-create-form` | same |
| Accounting periods | `GET /accounting-periods` | `master-data-hooks` | bg |
| Account statement | `GET /accounting/account-statements` | `use-account-statement` | bg + `LoadingState` |
| General ledger | `GET /accounting/general-ledger` | `use-general-ledger` | bg + `LoadingState` |
| Trial balance | `GET /accounting/trial-balance` | `use-trial-balance` | bg + `LoadingState` |
| Documents list | `GET /accounting-documents` | `use-documents-list` | bg + table local |
| Document detail/edit | `GET /accounting-documents/:id` | `use-document-detail`, `use-documents-list` | bg + `LoadingState` |
| Create/update document | `POST /accounting-documents`, `PATCH /accounting-documents/:id` | `document-mutations` | global + submit orb |
| Issue / finalize / reverse | `POST /accounting-documents/:id/{issue,finalize,reverse}` | `document-mutations` | global (`processing`) + confirm dialog |
| Delete pre-final document | `DELETE /accounting-documents/:id` | `document-mutations` | global + confirm dialog |
| Postable accounts / detail records | `GET /accounts`, `GET /details`, `GET /details/:id` | `use-accounting-references` | bg (local pickers) |

### Inventory

| Feature / route | API (method + path) | State owner | Loading type |
| --- | --- | --- | --- |
| Warehouses / items / units | `GET /warehouses`, `GET /items`, `GET /units` | `use-inventory-references` | bg (local pickers) |
| Movements list | `GET /inventory/movements` | `use-inventory-movements` | bg + table local |
| Post movement / transfer | `POST /inventory/movements`, `POST /inventory/transfers` | `inventory-mutations` | global + submit orb |
| Kardex | `GET /inventory/kardex` | `use-inventory-references` / page | bg + `LoadingState` |
| Valuation states / backdate check | `GET /inventory/valuation/states`, `GET /inventory/valuation/backdate-check` | `use-inventory-movements` | bg |
| Recalculation | `POST /inventory/valuation/recalculations` | `inventory-mutations` | global (`processing`) + confirm |
| Business documents list/detail | `GET /inventory/business-documents`, `GET .../:id` | `use-inventory-documents` | bg + `LoadingState`/table local |
| Create/update/delete document | `POST`, `PATCH`, `DELETE /inventory/business-documents/:id` | `inventory-document-mutations` | global + submit orb/confirm |
| Finalize / accounting-post / seal / cancel | `POST .../:id/{finalize,accounting-post,seal,cancel}` | `inventory-document-mutations` | global (`processing`) + confirm dialog |

### External services

| Integration | Frontend handling |
| --- | --- |
| Backend REST API (all modules) | the single Axios instance above — covered |
| Legacy ERP / outbound integrations / jobs | owned by the backend (ADR-0003, ADR-0004); the SPA makes no direct call and therefore shows no independent spinner |
| Excel import / print | no frontend implementation yet; when added it must use the same helpers |

There is no `fetch`, `WebSocket` or `EventSource` call in `src/` outside the API
layer; a grep is part of the review evidence.

---

## 5. Intentional exclusions

| Excluded | Reason |
| --- | --- |
| Full-page overlay for reads | Standards §10/§12: initial reads use page-shaped skeletons; covering the page for a table refresh would block independent work. |
| Blocking modal for writes | The Product Owner explicitly rejected unnecessary locking; existing disabled controls already prevent double submit, and dialogs keep their own focus/loading contract. |
| Spinner/skeleton for client-only state changes | No network request means no registration; examples: opening a dialog, sorting client-side rows, switching tabs. |
| Showing errors inside the loading panel | The feedback standard separates failure from progress; errors stay in `ApiErrorAlert`/form alerts/Toasts. |
| Retrying, delaying or debouncing requests | The loading system must never change business behavior or re-send anything. |
| A dark theme | The app has no dark tokens today. The orb is theme-aware (`auto` + root `data-theme`), but building an app-wide dark theme is a separate product task. |
| WebSocket/progress percentages | No such contract exists in the API; inventing one would be a fake capability. |
| Minimum display time | Would artificially prolong completed operations, which the brief forbids. |
| Toast on loading start/finish | Redundant channel; the panel and local states are the primary channel. |

---

## 6. Development and testing

Run from `frontend/`:

```bash
npm run typecheck
npm run lint
npm run format:check
npm test                  # vitest + Testing Library (jsdom)
npm run build
```

Relevant tests:

| Test | Covers |
| --- | --- |
| `src/api/request-activity.test.ts` | registry: start/end, idempotent end, concurrency, unknown token, stable snapshot, subscriptions |
| `src/api/client.test.ts` | real Axios + mocked adapter: success, HTTP failure, network failure, cancellation, retry, concurrency, 401 ordering, background/silent overrides, no extra request |
| `src/ui/patterns/request-activity.test.tsx` | delayed global panel, no flash for fast requests, one panel for concurrent writes, mixed messages, RTL/live region, ambient vs global, local threshold |
| `src/ui/thinking-orb.test.tsx` | real `thinking-orbs`: role/name, decorative mode, reduced-motion static frame, animation loop when allowed |
| `src/ui/button.test.tsx` | double-submit prevention (`disabled`, `aria-busy`, `data-loading`), decorative orb, `asChild` safety |
| Existing feature suites | unchanged behavior of login, session expiry, documents, inventory, admin, dashboard and error copy |

The 15 mandatory scenarios from the brief map as follows: success, HTTP error,
network error, cancel, two concurrent, retry/reuse and no-extra-request live in
`client.test.ts`; fast-request no-flash, reduced motion, theme/RTL, one overlay
and local scope live in the UI tests; double-submit lives in `button.test.tsx`
and the existing form/dialog suites; auth/permissions preservation is covered by
the unchanged session/login/permission tests plus the 401-ordering test.
There is no refresh-token flow in this product (server-side session cookie,
ADR-0007), so "token refresh" is not applicable; the equivalent retry/session
recovery path is tested.

Test harness notes: feature suites mock `@/api/*`, so the registry is exercised
in `client.test.ts` through the real Axios instance and a controllable adapter.
jsdom has no canvas 2D context; `src/test/setup.ts` stubs it to `null` (the orb
DOM still renders), and the orb integration test installs a no-op context.

---

## 7. Known limitations and follow-ups

- **Light theme only.** Theme propagation is implemented (`theme="auto"` plus
  `data-theme` on `<html>`), but no dark palette exists to exercise it.
- **No server timeout.** A genuinely hung backend keeps the panel visible; a
  timeout/abort policy belongs to the transport layer and the product contract,
  not to the loading UI.
- **Coverage depends on the single HTTP layer.** Any future client that bypasses
  `apiGet/apiPost/apiPatch/apiDelete` is invisible to the registry. The
  standards already forbid that, and the review grep is the guard.
- **Bundle cost.** `thinking-orbs` is ESM/CJS, `sideEffects: false`, and the
  wrapper imports only `ThinkingOrb`; the canvas engine adds no runtime service.
- **No visual regression/E2E.** The repository has no Playwright suite; behavior
  (delay, visibility, announcements, reduced motion) is covered in jsdom, while
  pixel-level canvas painting is a manual browser-review item, not an automated
  assertion.

---

## Appendix — verified `thinking-orbs` surface (0.3.2)

Inspected in `node_modules/thinking-orbs` (package metadata, type declarations,
`dist/index.es.js`):

- **Public API:** `ThinkingOrb` component + `OrbState`, `OrbSize`, `OrbTheme`,
  `ThinkingOrbProps` types; export map `.` and `./engine`.
- **Props:** `state` (`working` default, `searching`, `solving`, `listening`,
  `connecting`, `weaving`, `composing`, `breathing`, `shaping`), `size`
  (`64` default, `32`, `20`), `theme` (`auto` default, `light`, `dark`), plus
  `speed`, `paused`, `color`, `dots`, `dotSize`, `frame`, `gravity`,
  `style`, `aria-label` and canvas attributes.
- **Rendering:** one `<canvas role="img">` with the library's default
  `aria-label`; DPR capped at 2; rAF loop; pauses offscreen via
  `IntersectionObserver` and on `visibilitychange`; `prefers-reduced-motion:
  reduce` paints one static frame and returns before scheduling rAF.
- **Packaging:** ESM + CJS, `sideEffects: false`, peer `react >= 18`.
- **License:** MIT, © 2026 Jakub Antalik — reproduced in
  `frontend/THIRD_PARTY_NOTICES.md`.
- **App wrapper:** `src/ui/thinking-orb.tsx` is the only import site; it sets
  `theme="auto"` (root `data-theme`), keeps the library's size presets, and
  marks the canvas decorative when visible status text is present.
