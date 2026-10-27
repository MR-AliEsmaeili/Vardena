# ADR-0054: Multi-window workspace dock with keep-alive route windows

Status: Accepted for design — owner decisions recorded in [FDR-01](./FDR-01-workspace-windows.md) (2026-10-26); no production code yet
Date: 2026-10-26
Related: ADR-0002, ADR-0013, ADR-0042, ADR-0051, ADR-0052, [workspace-windows.md](./workspace-windows.md), [FDR-01](./FDR-01-workspace-windows.md), `docs/frontend/architecture/frontend-state-management-audit.md`

## Context

The shell renders exactly one route at a time. Navigating away from a document editor unmounts it, so an operator who must open a report or another form loses every unsaved field. The Product Owner requires several forms/reports to remain open concurrently, shown as a minimal module-coloured strip directly under the header, with no horizontal scrolling and a hard guarantee that unsaved work is never discarded silently.

A plain URL-tab bar is insufficient: it preserves the route but not React Hook Form state, filters, selection or scroll. Persisting drafts in browser storage is forbidden by the frontend security standard and would require an unused backend contract. The state-management audit already names “multiple document editors/drafts open concurrently” as a trigger for a bounded client-owned workspace. No new runtime dependency or global state library is needed for this scope.

## Decision

1. **One active window + a dock (phase 1).** Every open window is an independent work context with its own route, history, form state, filters and scroll. Only the active window is visible; split view for report comparison is deferred to phase 2 with a maximum of two panes. The dock is visible even when exactly one window is open.
2. **Keep-alive via a per-window `MemoryRouter`.** All windows stay mounted. The active one is in normal flow; inactive ones are `display:none`, `inert` and `aria-hidden`. `useNavigate`, `useParams` and `useSearchParams` therefore work inside each window without editing page components.
3. **Shared route tree.** Extract the `/app` child routes into `workspace-route-tree.tsx`; the global router owns only `/app/* → AppShell`, and every window renders the same tree under `/app`. `RequireAuth` stays outside; every `RequirePermission` gate stays unchanged inside the tree.
4. **Bounded client state, no global store.** A feature-scoped `useReducer` + Context in `AppShell` owns `{windows, activeId, pendingCloseId}`. Titles, tones and icons are derived from the path; no API data, form values or tokens enter this state. TanStack Query remains the only server-state cache.
5. **Dock behaviour and module tones.** Tabs compress in one row (full → compact → icon-only), never scroll horizontally; the cap is 12, and a dirty window is never auto-closed. `Ctrl/Cmd+click`, middle click and `/new` destinations open a new window; normal opens reuse by `pathname`. **Every module owns a distinct semantic tone** — no shared or neutral fallback — and the module→tone assignment is user-editable from profile settings. Customisation re-assigns the existing approved `--color-tone-*` tokens and enforces uniqueness, so it never introduces raw colours or dynamically built class names; `workspace` stops sharing indigo with `accounting`.
6. **Unsaved-work guard.** Forms register `formState.isDirty` through `useWorkspaceWindowDirty`; closing a dirty window requires explicit confirmation. Organization or financial-context changes are blocked while a dirty window exists, then reset the workspace so no previous-scope form survives.
7. **Predictable URL; bounded refresh restore.** The browser URL mirrors the active window via `replace` for refresh/deep-link. The **open window list is restored after a refresh** from the versioned `sessionStorage` key `vardena:workspace:v1` — navigation identity only (id, `basePath`, path, active id), never form values, drafts, business data or tokens. Restored paths are re-authorised on mount and mount lazily on first activation, so a refresh cannot fan out to twelve route trees and their queries. Logout, session expiry, "close all" and organisation/financial-context reset clear the key. Browser back/forward integration is phase 3.
8. **Accessibility and printing.** `role="tablist"/"tab"/"tabpanel"`, sibling close buttons, roving tabindex, documented shortcuts, `aria-live` announcements and reduced-motion compliance. The dock is `no-print`; only the active window prints.
9. **Per-window failure isolation.** Each window is wrapped in an error boundary so one crashed surface cannot take down the other windows.

## Consequences

- Operators can switch tasks without losing unsaved forms; the primary scenario is satisfied, and a refresh no longer loses the operator's working set.
- Window state is client-owned but bounded; the decision does not reopen the global-store question. If split view or cross-device persistence adds cross-cutting state, a new ADR must reassess it.
- Up to 12 mounted route trees increase memory/network subscription cost. The cap, shared Query cache, `display:none` and lazy mounting of restored windows bound it; pausing hidden queries is deferred until measured.
- The standards §15 storage whitelist is deliberately widened by exactly two versioned keys (`vardena:workspace:v1` in `sessionStorage`, `vardena:module-tones:v1` in `localStorage`). Form content, business data and tokens remain prohibited, and both keys must be named in the guard/tests so the whitelist cannot drift.
- Per-user colour assignments are device-local until the Owner answers Q-1 in FDR-01. If backend persistence is required, it is implemented through ADR-0013's `customization.user_preferences` (`ui.theme`) and the device-local key is removed rather than migrated.
- Browser back/forward does not traverse per-window history in phase 1; this is an explicit, documented limitation to revisit in phase 3.
- The `/app` route-tree extraction is a regression risk; route-parity tests and the existing page tests are required before the dock ships.
- Phase 1 requires closing the existing dirty-guard gap in `movement-form-page` and `transfer-form-page`, and adding a page-level error boundary (already required by the frontend standard but not yet present).
- No new dependency, no Prisma/API/permission change and no storage of business data are introduced.
