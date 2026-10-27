# Workspace Windows — Design Bundle

Status: Approved (design) — Owner decisions recorded 2026-10-26 — No production
code changed by this bundle.

This folder is the single home for the multi-window workspace dock design. It is
self-contained: the design document, the architecture decision and the owner
decision record live together and cross-link to each other.

## Contents

| File                                                                                 | What it is                                                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| [workspace-windows.md](./workspace-windows.md)                                       | Implementation spec v0.3: UX, dock behaviour, architecture contracts, W-rules, test plan, phases, DoD, open items. |
| [ADR-0054-multi-window-workspace-dock.md](./ADR-0054-multi-window-workspace-dock.md) | Architecture decision record: keep-alive route windows, per-window `MemoryRouter`, bounded client state.           |
| [FDR-01-workspace-windows.md](./FDR-01-workspace-windows.md)                         | Canonical owner-decision record (`D-n` rows) plus the storage/security resolution and open questions.              |

The main document is an implementation spec: every rule is written so an agent
can implement and test it without inventing defaults; genuine ambiguities are
logged as `O-n` items in its section 14 instead of being guessed.

## Which file wins

`FDR-01` is the decision authority. If the design document or the ADR disagrees
with a `Confirmed` row in FDR-01, FDR-01 wins and the other file is the one to
fix.

## Confirmed owner decisions

1. Dock is visible even with one window.
2. Hard cap of 12 windows.
3. Every module owns a distinct tone, and the assignment is editable in the user
   profile settings.
4. Split view is phase 2, maximum two panes.
5. The open window list is restored after refresh — paths only, never unsaved
   form content.

## Open questions

| ID  | Question                                                         | Blocks             |
| --- | ---------------------------------------------------------------- | ------------------ |
| Q-1 | Module-tone preference device-local, or per-user in the backend? | Phase 1F / phase 4 |
| Q-2 | Should split-view layout also be restored after refresh?         | Phase 2            |
| Q-3 | Is "recently closed" in scope?                                   | Phase 3            |

## Relationship to the rest of the repo

Rules that this design must still obey live outside this folder and are linked
from the documents:

- [`docs/frontend/standards.md`](../docs/frontend/standards.md) — security,
  storage whitelist, accessibility, Rule-as-Code gates.
- [`docs/frontend/design-system.md`](../docs/frontend/design-system.md) — tokens,
  no raw colours, enumerated tone classes.
- [`docs/frontend/layout-and-navigation.md`](../docs/frontend/layout-and-navigation.md)
  — shell, sidebar and header ownership.
- [`docs/frontend/architecture/frontend-state-management-audit.md`](../docs/frontend/architecture/frontend-state-management-audit.md)
  — why the workspace state is client-owned and bounded.
- [`docs/adr/README.md`](../docs/adr/README.md) — ADR index; row 0054 links here.
- [`docs/adr/0013-user-preference-key-value.md`](../docs/adr/0013-user-preference-key-value.md)
  — the target path if colour preferences must sync per user.

The former paths under `docs/frontend/`, `docs/adr/` and `docs/decisions/frontend/`
now contain short pointer files so historical links keep working.
