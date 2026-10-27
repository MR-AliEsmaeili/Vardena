# FDR-01 — Workspace windows, dock and module tone customisation

- Date: 2026-10-26
- Authority: Product Owner decisions given in the workspace-windows review of 2026-10-26.
- Status: **approved (design)**. No production code is changed by this record.
- Supersedes: the earlier draft answers in
  [workspace-windows.md §13](./workspace-windows.md#۱۳-وضعیت-تصمیمها) for D-1,
  D-2, D-3, D-5 and D-6.
- Sources: [ADR-0054](./ADR-0054-multi-window-workspace-dock.md),
  [ADR-0013](../docs/adr/0013-user-preference-key-value.md),
  [workspace-windows.md](./workspace-windows.md),
  [standards.md §15](../docs/frontend/standards.md),
  [design-system.md](../docs/frontend/design-system.md),
  [frontend state-management audit](../docs/frontend/architecture/frontend-state-management-audit.md).

This file is the canonical owner-decision record for the workspace dock. If a
design document, ADR or implementation disagrees with a `Confirmed` row below,
this record wins and the other artifact is the one to fix.

## 1. Confirmed decisions

| ID   | Subject                 | Decision                                                                                                                                                                                                                                 | Owner status                                                                              |
| ---- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| D-1  | Dock visibility         | The dock is visible at all times, including when exactly one window is open. It is not hidden or collapsed at N=1.                                                                                                                       | Confirmed 2026-10-26 (was proposed)                                                       |
| D-2  | Window cap              | Hard cap of **12** open windows. At the cap, opening another window requires closing one; a dirty window is never auto-closed.                                                                                                           | Confirmed 2026-10-26 (was proposed)                                                       |
| D-3  | Module tone             | **Every module has its own tone.** No shared, neutral or "workspace fallback" tone is used as a shortcut, and two modules must never resolve to the same tone. Tone assignment is customisable by the user in the profile settings area. | Confirmed 2026-10-26 (overrides the earlier "fixed colours + neutral workspace" proposal) |
| D-4  | Browser back/forward    | Per-window browser history integration stays out of phase 1; revisit in phase 3.                                                                                                                                                         | Unchanged (not re-decided)                                                                |
| D-5  | Split view              | Split view is approved. It ships in **phase 2** with a **maximum of 2 panes**.                                                                                                                                                           | Confirmed 2026-10-26                                                                      |
| D-6  | Reload behaviour        | The **open window list is restored after a browser refresh.** This reverses the earlier "in-memory only" answer. Restore covers window paths and the active window only — never unsaved form values, drafts or query data.               | Confirmed 2026-10-26 (was: no persistence)                                                |
| D-7  | Save-and-close          | Not offered in phase 1; only after a shared save contract exists (phase 3).                                                                                                                                                              | Unchanged                                                                                 |
| D-8  | Mobile behaviour        | One visible active window plus a sheet/popover list; no split view.                                                                                                                                                                      | Unchanged                                                                                 |
| D-9  | Duplicate report window | Allowed deliberately via `Ctrl/Cmd+click`, middle click or `/new`; normal opens still reuse by `pathname`.                                                                                                                               | Unchanged                                                                                 |
| D-10 | Pausing hidden queries  | Deferred to phase 3, and only if measurement proves the need.                                                                                                                                                                            | Unchanged                                                                                 |
| D-11 | Layout model            | One active window plus the dock; every other window stays mounted and hidden (`display:none`, `inert`, `aria-hidden`). Switching windows must not destroy form state.                                                                    | Confirmed (carried from design)                                                           |
| D-12 | Architecture            | Per-window `MemoryRouter`, one shared `/app` route tree, bounded `useReducer` + Context, no Redux/Zustand/MobX, TanStack Query remains the only server-state cache.                                                                      | Confirmed (carried from design)                                                           |

## 2. Owner wording kept verbatim

The colour decision was given as:

> خیر هر ماژولی یک تون باید داشته باشد و در بخش تنظیمات پروفایل کاربری رنگ ها
> باید قابل تغییر باشند

Read as: (a) uniqueness — each module keeps a distinct tone, no shared tone;
(b) the user can change the assignment from their profile settings. It does not
authorise arbitrary colours, raw hex values or a per-user free-form colour
picker; see §3.2.

## 3. How the new decisions are implemented without breaking existing rules

### 3.1 Restoring the window list after refresh (D-6)

Requirements that pull against each other:

- standards §15 whitelists `localStorage` for `theme`, `density` and column
  settings, and allows drafts only in memory/`sessionStorage` with a conscious
  decision;
- the dock must never become a business-data or draft store;
- refresh restore is a confirmed owner requirement.

Resolution:

- **Storage:** `sessionStorage`, versioned key `vardena:workspace:v1`.
  `sessionStorage` satisfies "survives refresh" and dies with the tab/session, so
  a shared workstation does not hand the next operator the previous operator's
  window list. It is also the storage class standards §15 already contemplates
  for short-lived client state.
- **Payload:** only navigation identity — `{version, windows: [{id, basePath,
path}], activeId}`. No titles, no form values, no filter objects beyond what
  is already in the URL, no API payloads, no tokens, no organization names.
- **Validation on read:** JSON parse is guarded; unknown version → ignore; the
  list is capped at 12; ids are de-duplicated; every `path` must start with
  `/app/` and resolve to a known route, otherwise it is dropped; `activeId` must
  exist, otherwise the first window becomes active; an empty result falls back
  to the workspace window.
- **Authorization is re-checked:** a restored path is not a permission grant.
  Each window re-evaluates `RequirePermission`; a forbidden path renders the
  standard 403 surface. The backend remains authoritative (AR-21).
- **Lazy mount:** restored windows are _descriptors_ until first activation.
  Only the restored active window mounts immediately; the others mount on first
  activation and are keep-alive from then on. This avoids a refresh firing up to
  12 route trees and their queries at once.
- **Clearing:** logout and session expiry clear the key; org/financial-context
  reset rewrites it; "close all" clears it.
- **Explicit non-goal:** restored windows do **not** restore unsaved form
  content. A dirty flag is never persisted. The UI must not imply drafts are
  safe across refresh; the existing `beforeunload` guard remains the protection.

Consequence: rule W-08 in the design doc ("no data in `localStorage`/
`sessionStorage`") is narrowed, not deleted. It now forbids form values,
business data and tokens, and permits this one versioned navigation key.

### 3.2 Customisable per-module tones (D-3)

Constraints from the design system:

- colours come only from `--color-tone-*` tokens in `frontend/src/styles/index.css`;
  raw hex/rgb in `.ts`/`.tsx` fails `check-frontend-design-tokens.mjs`;
- the tone → Tailwind class map is **enumerated on purpose** (Tailwind cannot
  see dynamically built class names), so `bg-tone-${x}` is not an option.

Therefore customisation means **re-assigning the existing approved module tones
to modules**, not choosing arbitrary colours:

- six modules (workspace, accounting, inventory, organization, licensing, admin)
  and six distinct tones;
- the settings UI is an assignment grid where each tone can be used once;
  assigning a tone already taken swaps the two modules, so uniqueness — "every
  module has its own tone" — is structurally impossible to violate;
- previews render in both light and dark themes; contrast AA is a gate;
- persistence: see §4, Q-1;
- **workspace stops sharing indigo with accounting.** `--color-tone-workspace-*`
  changes to a slate family in `index.css` (token values only, no component
  edit), and the enumerated class entries stay as they are. This is the minimum
  change that satisfies "no shared tone" without inventing a new design
  language.

## 4. Open questions for the Owner

These are the only unresolved items. They do not block the design; they block
specific implementation phases.

| ID  | Question                                                                                                               | Recommendation                                                                                                            | Blocks             |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Q-1 | Should module-tone assignments follow the user across devices (backend) or stay on this device (localStorage) for now? | Ship device-local `vardena:module-tones:v1` in phase 1; move to ADR-0013 `ui.theme` when the Customization module exists. | Phase 1E / phase 4 |
| Q-2 | In phase 2 split view, should refresh restore also restore which two windows were split, and their pane order?         | Yes — same versioned record, bump to `v2` when split ships.                                                               | Phase 2            |
| Q-3 | Should "recently closed" (reopen a window closed by mistake) be in scope?                                              | Phase 3, list only, no form restoration.                                                                                  | Phase 3            |

If Q-1 is answered "backend", phase 1E must not ship the `localStorage` writer at
all — do not build a device-local store that will be migrated later.

## 5. Consequences

- This bundle is the single home: [workspace-windows.md](./workspace-windows.md)
  (v0.2, D-1/D-2/D-3/D-5/D-6 reflected, W-08 narrowed, §6.12 added, phase plan
  adjusted), [ADR-0054](./ADR-0054-multi-window-workspace-dock.md) (decisions 5
  and 7 changed, now `Accepted for design`) and this record. The former paths
  under `docs/` keep one-line pointer files.
- `docs/frontend/standards.md` §15 now names the two storage keys explicitly; any
  further key needs its own conscious decision, and the guard tests must keep the
  whitelist from widening silently.
- `docs/frontend/design-system.md` records the tone-assignment concept; the
  actual workspace slate values change in `frontend/src/styles/index.css`, and
  the token guard keeps rejecting raw colours.
- `docs/adr/README.md` row 0054 links to this folder; the ADR numbering stays
  reserved even though the full text lives here.
- No Prisma, API, permission or runtime-dependency change is introduced by this
  record. Backend-persisted colour preferences would be a separate ADR-0013
  implementation decision.
